'use strict';

// What the dashboard shows: live flows, prices with colours, today's usage
// and costs, the solar forecast and the planners. Pure functions where
// possible, so the tests can run them without Home Assistant.

const meters = require('./meters');
const colors = require('./colors');
const prices = require('./prices');
const { toPriceCfg } = require('./suppliers');
const settingsMod = require('./settings');

// ---------------------------------------------------------------- live flows

function modulePower(mod, getState) {
  const s = getState(mod.power_entity);
  if (!s) return null;
  const w = meters.powerW(s.state, s.attributes && s.attributes.unit_of_measurement);
  return w === null ? null : w * (mod.invert ? -1 : 1);
}

function moduleSoc(mod, getState) {
  if (!mod.soc_entity) return null;
  const s = getState(mod.soc_entity);
  const n = s ? Number(s.state) : NaN;
  return Number.isFinite(n) ? n : null;
}

// Signs: grid + = import; solar + = production; battery + = charging;
// consumers (ev, heatpump, device) + = using power.
function flows(settings, getState) {
  const grid = meters.gridPower(settings.meter, getState);
  const mods = settings.modules.filter((m) => m.enabled).map((m) => ({
    id: m.id, type: m.type, name: m.name,
    power_w: modulePower(m, getState),
    soc: moduleSoc(m, getState),
  }));
  const sum = (types) => mods.filter((m) => types.includes(m.type) && m.power_w !== null)
    .reduce((a, m) => a + m.power_w, 0);
  const solar = sum(['solar']);
  const battery = sum(['battery']);
  const consumers = sum(['ev', 'heatpump', 'device']);
  const home = grid ? grid.net_w + Math.max(0, solar) - battery : null;
  return {
    grid,
    solar_w: mods.some((m) => m.type === 'solar') ? Math.max(0, solar) : null,
    battery_w: mods.some((m) => m.type === 'battery') ? battery : null,
    home_w: home,
    rest_w: home === null ? null : Math.max(0, home - consumers),
    modules: mods,
  };
}

function watchedEntities(settings) {
  const ids = meters.meterEntities(settings.meter);
  for (const m of settings.modules) if (m.enabled) ids.push(m.power_entity, m.soc_entity);
  ids.push('sun.sun');
  return ids.filter(Boolean);
}

// -------------------------------------------------------------------- prices

// result: prices.fetchPrices() output. Adds total, colour and the reference.
function priceView(result, settings, now = Date.now()) {
  const cfg = toPriceCfg(settings.price);
  const list = result.prices.map((p) => ({ start: p.start, end: p.end, raw: p.price, total: prices.totalPrice(p.price, cfg) }));
  const win = result.window;
  const ref = colors.reference(list, settings.edge.reference, now, win.tomorrow);
  const band = settings.edge.band / 100;
  for (const p of list) {
    const c = colors.colorFor(p.total, ref, band);
    p.color = c.css;
    p.level = c.level;
  }
  const current = list.find((p) => p.start <= now && now < p.end) || null;
  const today = list.filter((p) => p.start < win.tomorrow);
  const tomorrow = list.filter((p) => p.start >= win.tomorrow);
  const avg = (l) => (l.length ? l.reduce((s, p) => s + p.total * (p.end - p.start), 0) / l.reduce((s, p) => s + (p.end - p.start), 0) : null);
  const min = (l) => (l.length ? l.reduce((a, b) => (b.total < a.total ? b : a)) : null);
  const max = (l) => (l.length ? l.reduce((a, b) => (b.total > a.total ? b : a)) : null);
  const vatF = 1 + cfg.vat_percent / 100;
  const breakdown = current ? {
    market: settings.price.price_type === 'all_in' ? null : (settings.price.price_type === 'market_incl_vat' ? current.raw / vatF : current.raw),
    fee: settings.price.price_type === 'all_in' ? null : cfg.purchase_fee,
    tax: settings.price.price_type === 'all_in' ? null : cfg.energy_tax,
    vat: settings.price.price_type === 'all_in' ? null : current.total - current.total / vatF,
    total: current.total,
  } : null;
  return {
    interval_minutes: result.interval_minutes,
    window: win,
    prices: list,
    reference: ref,
    band: settings.edge.band,
    current,
    now_color: current ? current.color : '#6b7785',
    now_level: current ? current.level : null,
    deviation: current && ref ? colors.deviation(current.total, ref) : null,
    today: { average: avg(today), low: min(today), high: max(today), cheap: colors.bestBlock(list, 2, win.start, win.tomorrow, true), dear: colors.bestBlock(list, 3, win.start, win.tomorrow, false) },
    tomorrow: tomorrow.length ? { average: avg(tomorrow), low: min(tomorrow), high: max(tomorrow), cheap: colors.bestBlock(list, 2, win.tomorrow, win.end, true) } : null,
    next_cheap: colors.bestBlock(list, 2, Math.floor(now / 900000) * 900000, win.end, true),
    breakdown,
    warnings: result.warnings || [],
  };
}

// ------------------------------------------------------------ usage and cost

const tsMs = (v) => (typeof v === 'number' ? v : Date.parse(v));

// stats: recorder result { statistic_id: [{ start, end, change }] }
// → per hour: { start, import, export } in kWh.
function hourly(stats, meter, from, to) {
  const hours = new Map();
  for (let t = from; t < to; t += 3600000) hours.set(t, { start: t, import: 0, export: 0, known: false });
  const add = (ids, key) => {
    for (const id of ids || []) {
      for (const row of (stats && stats[id]) || []) {
        const t = tsMs(row.start);
        const h = hours.get(t);
        const c = Number(row.change);
        if (!h || !Number.isFinite(c)) continue;
        h[key] += c;
        h.known = true;
      }
    }
  };
  add(meter && meter.energy_import, 'import');
  add(meter && meter.energy_export, 'export');
  return [...hours.values()];
}

// Time-weighted average all-in price over [from, to).
function priceOver(list, from, to) {
  let sum = 0;
  let len = 0;
  for (const p of list) {
    const a = Math.max(from, p.start);
    const b = Math.min(to, p.end);
    if (b <= a) continue;
    sum += p.total * (b - a);
    len += b - a;
  }
  return len ? sum / len : null;
}

function exportPrice(p, price, mode) {
  if (mode === 'net_metering') return p.total;
  const f = 1 + (Number(price.vat_percent) || 0) / 100;
  const fee = Number(price.export_fee_incl_vat) || 0;
  if (price.price_type === 'all_in') return p.total - (Number(price.energy_tax_incl_vat) || 0) - (Number(price.fee_incl_vat) || 0) + fee;
  return (price.price_type === 'market_incl_vat' ? p.raw : p.raw * f) + fee;
}

// Costs of the given hours with the given (all-in) prices.
function costs(hours, priceList, price, now = Date.now()) {
  const mode = settingsMod.exportMode(price, now);
  let cost = 0;
  let imp = 0;
  let exp = 0;
  let unpriced = 0;
  for (const h of hours) {
    if (!h.known) continue;
    imp += h.import;
    exp += h.export;
    const slots = priceList.filter((p) => p.end > h.start && p.start < h.start + 3600000);
    if (!slots.length) { unpriced += h.import; continue; }
    const avgBuy = priceOver(slots, h.start, h.start + 3600000);
    const sell = slots.map((p) => ({ ...p, total: exportPrice(p, price, mode) }));
    const avgSell = priceOver(sell, h.start, h.start + 3600000);
    cost += h.import * avgBuy - h.export * avgSell;
  }
  const compare = Number(price.compare_tariff);
  const saving = Number.isFinite(compare) && compare > 0 && !unpriced
    ? (imp * compare - (mode === 'net_metering' ? exp * compare : 0)) - cost
    : null;
  return { import_kwh: imp, export_kwh: exp, cost, saving, unpriced_kwh: unpriced, export_mode: mode };
}

// Solar forecast (energy/solar_forecast) → per hour Wh, summed over entries.
function solarHours(forecast) {
  const out = new Map();
  for (const entry of Object.values(forecast || {})) {
    for (const [iso, wh] of Object.entries((entry && entry.wh_hours) || {})) {
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) continue;
      out.set(t, (out.get(t) || 0) + Number(wh || 0));
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([start, wh]) => ({ start, wh }));
}

// -------------------------------------------------------------------- planners

const PLANNERS = {
  charging_planner: /^(sensor|binary_sensor)\.smart_charging_[a-z0-9_]+$/,
  heating_planner: /^(sensor|binary_sensor)\.smart_heating_[a-z0-9_]+$/,
};

function planners(states) {
  const out = {};
  for (const [key, re] of Object.entries(PLANNERS)) {
    const list = states.filter((s) => re.test(s.entity_id)).map((s) => ({
      entity_id: s.entity_id,
      name: (s.attributes && s.attributes.friendly_name) || s.entity_id,
      state: s.state,
      unit: (s.attributes && s.attributes.unit_of_measurement) || null,
    }));
    out[key] = list.length ? list : null;
  }
  return out;
}

module.exports = { flows, watchedEntities, priceView, hourly, priceOver, exportPrice, costs, solarHours, planners, PLANNERS };
