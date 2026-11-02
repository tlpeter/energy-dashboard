'use strict';

// Gas prices (#6).
//
// Sources:
//  - action: EnergyZero or easyEnergy (get_gas_prices), market price excl. VAT;
//  - state:  any sensor whose state is the gas price now (€/m³), for example
//            the "current gas price" sensor of a supplier integration;
//  - fixed:  one all-in price per m³.
// Most dynamic gas contracts have one price per day (06:00–06:00). The app
// therefore uses the last known price when an hour has no price of its own.

const ha = require('./ha');
const prices = require('./prices');
const history = require('./pricehistory');
const { toPriceCfg } = require('./suppliers');

const H = 3600000;

const GAS_ACTIONS = {
  energyzero: { name: 'EnergyZero (gas)', service: 'get_gas_prices', price_type: 'market_excl_vat' },
  easyenergy: { name: 'easyEnergy (gas)', service: 'get_gas_prices', price_type: 'market_excl_vat' },
};

const GAS_UNIT = /^(€|eur)\s*\/\s*m(³|3)$/i;

function detectGasSources(entities, states, services = null) {
  const out = [];
  const seen = new Set();
  for (const e of entities) {
    const def = GAS_ACTIONS[e.platform];
    if (!def || !e.config_entry_id || seen.has(e.config_entry_id)) continue;
    if (services && !(services[e.platform] && services[e.platform][def.service])) continue;
    seen.add(e.config_entry_id);
    out.push({ id: `gas:action:${e.platform}:${e.config_entry_id}`, type: 'action', domain: e.platform, config_entry: e.config_entry_id, name: def.name, price_type: def.price_type });
  }
  const regById = new Map(entities.map((e) => [e.entity_id, e]));
  for (const s of states) {
    if (!s.entity_id.startsWith('sensor.')) continue;
    const unit = String((s.attributes && s.attributes.unit_of_measurement) || '').trim();
    if (!GAS_UNIT.test(unit)) continue;
    const reg = regById.get(s.entity_id);
    const domain = reg ? reg.platform : null;
    out.push({
      id: `gas:state:${s.entity_id}`,
      type: 'state',
      entity_id: s.entity_id,
      name: (s.attributes && s.attributes.friendly_name) || s.entity_id,
      detail: `${s.entity_id} · ${s.state} ${unit}`,
      // Supplier integrations (Frank Energie, Zonneplan) give all-in prices.
      price_type: domain === 'frank_energie' || domain === 'zonneplan_one' ? 'all_in' : 'market_excl_vat',
    });
  }
  return out;
}

function sortSlots(list) {
  const sorted = list.filter((p) => Number.isFinite(p.start) && Number.isFinite(p.price)).sort((a, b) => a.start - b.start);
  return sorted.map((p, i) => ({ start: p.start, end: Number.isFinite(p.end) ? p.end : (sorted[i + 1] ? sorted[i + 1].start : p.start + H), price: p.price }));
}

// Raw gas prices (source units, per m³) for today and tomorrow, plus what the
// history knows. Stores what it fetched.
async function fetchGas(source, tz, getState) {
  const win = { start: prices.localMidnight(tz, 0), tomorrow: prices.localMidnight(tz, 1), end: prices.localMidnight(tz, 2) };
  let list = [];
  if (source.type === 'fixed') {
    return { prices: [{ start: win.start - 2 * 86400000, end: win.end, price: Number(source.price) }], window: win };
  }
  if (source.type === 'action') {
    const def = GAS_ACTIONS[source.domain];
    if (!def) throw new Error(`Unknown gas price integration: ${source.domain}`);
    const call = (end) => ha.callAction(source.domain, def.service, {
      config_entry: source.config_entry, incl_vat: false,
      start: prices.isoLocal(win.start, tz), end: prices.isoLocal(end, tz),
    });
    let r;
    try { r = await call(win.end - 1000); } catch { r = await call(win.tomorrow - 1000); }
    list = sortSlots(((r && r.prices) || []).map((p) => ({ start: Date.parse(p.timestamp), price: Number(p.price) })));
  } else if (source.type === 'state') {
    const s = getState(source.entity_id);
    const v = s ? Number(s.state) : NaN;
    if (!Number.isFinite(v)) throw new Error(`Gas price sensor ${source.entity_id} has no value`);
    const hour = Math.floor(Date.now() / H) * H;
    list = [{ start: hour, end: hour + H, price: v }];
  } else {
    throw new Error('Unknown gas price source');
  }
  try { history.record(source.id, list); } catch (err) { ha.warn('Could not store gas price history:', err.message); }
  const past = history.range(source.id, win.start - 86400000, win.end);
  const byStart = new Map(past.map((p) => [p.start, p]));
  for (const p of list) byStart.set(p.start, p);
  return { prices: sortSlots([...byStart.values()]), window: win };
}

// Settings.price.gas → the cfg prices.totalPrice() understands.
function gasCfg(gas) {
  if (gas.source && gas.source.type === 'fixed') return { price_type: 'all_in', purchase_fee: 0, energy_tax: 0, vat_percent: gas.vat_percent };
  return toPriceCfg(gas);
}

// The gas price (all-in) that applies at time t: the slot that contains t,
// otherwise the last one before it (one price per day is normal).
function slotAt(list, t, maxAge = 30 * H) {
  let best = null;
  for (const p of list) {
    if (p.start <= t && t < p.end) return p;
    if (p.start <= t && t - p.start <= maxAge && (!best || p.start > best.start)) best = p;
  }
  return best;
}

function withTotals(list, gas) {
  const cfg = gasCfg(gas);
  const f = 1 + (Number(cfg.vat_percent) || 0) / 100;
  const allIn = cfg.price_type === 'all_in';
  return list.map((p) => {
    const total = prices.totalPrice(p.price, cfg);
    return {
      ...p,
      raw: p.price,
      total,
      parts: allIn ? null : {
        market: cfg.price_type === 'market_incl_vat' ? p.price / f : p.price,
        fee: cfg.purchase_fee, tax: cfg.energy_tax, vat: total - total / f, total,
      },
    };
  });
}

// What the gas pop-up and tiles need about the price.
function gasView(result, gas, now = Date.now()) {
  if (!result) return null;
  const list = withTotals(result.prices, gas);
  const current = slotAt(list, now);
  let plausibility = null;
  const cfg = gasCfg(gas);
  if (cfg.price_type !== 'all_in' && current) {
    const f = 1 + (Number(cfg.vat_percent) || 0) / 100;
    const market = cfg.price_type === 'market_incl_vat' ? current.raw / f : current.raw;
    // A market gas price excl. VAT above € 1.00/m³ is very unusual.
    if (market > 1.0) plausibility = { code: 'looks_all_in' };
  }
  return { current, prices: list, plausibility };
}

// m³ per hour × the all-in price of that hour.
// stats rows: [{ start, change }] of the gas meter.
function gasCosts(rows, list, from, to) {
  let m3 = 0;
  let cost = 0;
  let unpriced = 0;
  const hours = [];
  for (let t = from; t < to; t += H) hours.push({ start: t, m3: 0, known: false });
  for (const r of rows || []) {
    const t = typeof r.start === 'number' ? r.start : Date.parse(r.start);
    const h = hours.find((x) => x.start === t);
    const c = Number(r.change);
    if (!h || !Number.isFinite(c)) continue;
    h.m3 += c;
    h.known = true;
  }
  for (const h of hours) {
    if (!h.known) continue;
    m3 += h.m3;
    const p = slotAt(list, h.start + H / 2);
    if (!p) { unpriced += h.m3; continue; }
    cost += h.m3 * p.total;
  }
  return { m3, cost: list.length ? cost : null, unpriced_m3: unpriced, hours };
}

module.exports = { GAS_ACTIONS, detectGasSources, fetchGas, gasView, gasCosts, slotAt, withTotals, gasCfg, sortSlots };
