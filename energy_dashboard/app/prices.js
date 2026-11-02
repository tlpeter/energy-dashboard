'use strict';

// Price sources.
//
// Every source ends up in the same internal format: a list of
// { start, end, price } with start/end in milliseconds (UTC) and the price
// in currency per kWh, for today and tomorrow.
//
// Two kinds of sources:
//   - action: an integration action that returns prices (EnergyZero,
//     easyEnergy, Tibber, Nord Pool). Found through the entity registry.
//   - attribute: a sensor that keeps a list of prices in its attributes
//     (ENTSO-e, Nord Pool custom, EPEX Spot, Frank Energie, Zonneplan and
//     others). Found by scanning attributes, so unknown integrations work too.

const ha = require('./ha');
const history = require('./pricehistory');

// ---------------------------------------------------------------------------
// Time zone helpers ("today" means today in Home Assistant's time zone)
// ---------------------------------------------------------------------------

function tzParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function tzOffsetMs(ms, tz) {
  const p = tzParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// A clock time (hh:mm) on a local day, dayOffset days from today.
function localTimeOn(tz, dayOffset, hour, minute, now = Date.now()) {
  const p = tzParts(now, tz);
  return localDateTime(tz, p.y, p.m, p.d + dayOffset, hour, minute);
}

// A local date and time in the time zone, as milliseconds (UTC).
function localDateTime(tz, y, m, d, hour = 0, minute = 0, second = 0) {
  const guess = Date.UTC(y, m - 1, d, hour, minute, second);
  let ms = guess - tzOffsetMs(guess, tz);
  ms = guess - tzOffsetMs(ms, tz);
  return ms;
}

// Parse a date-time string. Without an offset it is read as local time.
function parseLocal(value, tz) {
  const str = String(value || '').trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) return Date.parse(str.replace(' ', 'T'));
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return localDateTime(tz, +m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
}

// Start of the local day, dayOffset days from today.
function localMidnight(tz, dayOffset = 0, now = Date.now()) {
  return localTimeOn(tz, dayOffset, 0, 0, now);
}

function isoLocal(ms, tz) {
  const p = tzParts(ms, tz);
  const off = tzOffsetMs(ms, tz) / 60000;
  const sign = off >= 0 ? '+' : '-';
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function localDate(ms, tz) {
  return isoLocal(ms, tz).slice(0, 10);
}

// With a time zone, a string without an offset ("2026-10-03 13:00:00") is
// read as local time in that zone, not in the container's time zone.
function parseTime(v, tz) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const str = String(v).trim();
  if (tz && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(str) && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) return parseLocal(str, tz);
  return Date.parse(str.replace(' ', 'T'));
}

// ---------------------------------------------------------------------------
// Action sources
// ---------------------------------------------------------------------------

// More than one home (Tibber) or market area (Nord Pool) in one answer: use
// the one the user chose, never silently the first (#16). With one, use it.
// The result (an array) carries .choice = { label, key, keys } for the page.
function choiceError(message, label, keys) {
  const err = new Error(message);
  err.status = 400;
  err.choice = { label, key: null, keys };
  return err;
}
function pickEntry(map, wanted, label) {
  const keys = Object.keys(map || {});
  if (wanted) {
    if (Object.prototype.hasOwnProperty.call(map || {}, wanted)) return { key: wanted, list: map[wanted] || [], keys };
    throw choiceError(`${label} "${wanted}" is not in the answer of this price source any more (found: ${keys.join(', ') || 'none'}). Choose the ${label.toLowerCase()} again in Settings › Prices.`, label, keys);
  }
  if (keys.length > 1) throw choiceError(`This price source has more than one ${label.toLowerCase()} (${keys.join(', ')}). Choose one in Settings › Prices.`, label, keys);
  return { key: keys[0] || null, list: keys.length ? map[keys[0]] || [] : [], keys };
}
function withChoice(list, label, picked) {
  list.choice = { label, key: picked.key, keys: picked.keys };
  return list;
}

const ACTION_SOURCES = {
  energyzero: {
    name: 'EnergyZero',
    service: 'get_energy_prices',
    price_type: 'market_excl_vat',
    unit: 'kWh',
    async fetch(entry, win, tz) {
      const call = (end) => ha.callAction('energyzero', 'get_energy_prices', {
        config_entry: entry, incl_vat: false, start: isoLocal(win.start, tz), end: isoLocal(end, tz),
      });
      let r;
      try {
        r = await call(win.end - 1000);
      } catch (err) {
        ha.debug('EnergyZero: today + tomorrow failed, trying today only:', err.message);
        r = await call(win.tomorrow - 1000);
      }
      return (r.prices || []).map((p) => ({ start: parseTime(p.timestamp), price: validPrice(p.price) ? Number(p.price) : NaN }));
    },
  },
  easyenergy: {
    name: 'easyEnergy',
    service: 'get_energy_usage_prices',
    price_type: 'market_excl_vat',
    unit: 'kWh',
    async fetch(entry, win, tz) {
      const call = (end) => ha.callAction('easyenergy', 'get_energy_usage_prices', {
        config_entry: entry, incl_vat: false, start: isoLocal(win.start, tz), end: isoLocal(end, tz),
      });
      let r;
      try {
        r = await call(win.end - 1000);
      } catch (err) {
        ha.debug('easyEnergy: today + tomorrow failed, trying today only:', err.message);
        r = await call(win.tomorrow - 1000);
      }
      return (r.prices || []).map((p) => ({ start: parseTime(p.timestamp), price: validPrice(p.price) ? Number(p.price) : NaN }));
    },
  },
  tibber: {
    name: 'Tibber',
    service: 'get_prices',
    price_type: 'all_in',
    unit: 'kWh',
    async fetch(entry, win, tz, select = null) {
      const data = { start: isoLocal(win.start, tz), end: isoLocal(win.end, tz) };
      let r;
      try {
        r = await ha.callAction('tibber', 'get_prices', data);
      } catch (err) {
        ha.debug('Tibber: retrying with config_entry:', err.message);
        r = await ha.callAction('tibber', 'get_prices', { ...data, config_entry: entry });
      }
      const picked = pickEntry((r && r.prices) || {}, select, 'Home');
      return withChoice(picked.list.map((p) => ({ start: parseTime(p.start_time), price: validPrice(p.price) ? Number(p.price) : NaN })), 'Home', picked);
    },
  },
  nordpool: {
    name: 'Nord Pool',
    // Home Assistant's own Nord Pool integration. The HACS integration
    // (custom-components/nordpool) uses the same platform name but has no
    // such action: its sensors are offered as attribute sources instead (#17).
    service: 'get_prices_for_date',
    price_type: 'market_excl_vat',
    unit: 'MWh',
    async fetch(entry, win, tz, select = null) {
      const out = [];
      let picked = null;
      for (const day of [win.start, win.tomorrow]) {
        try {
          const r = await ha.callAction('nordpool', 'get_prices_for_date', {
            config_entry: entry, date: localDate(day, tz),
          });
          // An empty answer (tomorrow before publication): no prices that day,
          // not a missing area.
          if (!Object.keys(r || {}).length) continue;
          picked = pickEntry(r || {}, select, 'Area');
          for (const p of picked.list) {
            out.push({ start: parseTime(p.start), end: parseTime(p.end), price: validPrice(p.price) ? Number(p.price) : NaN });
          }
        } catch (err) {
          // Tomorrow's prices are published around 13:00; before that this fails.
          if (err.choice) throw err;
          ha.debug('Nord Pool: no prices for', localDate(day, tz), '-', err.message);
          if (day === win.start) throw err;
        }
      }
      return picked ? withChoice(out, 'Area', picked) : out;
    },
  },
};

// ---------------------------------------------------------------------------
// Attribute sources
// ---------------------------------------------------------------------------

const TIME_KEYS = ['start', 'start_time', 'startsAt', 'starts_at', 'time', 'from', 'datetime', 'timestamp', 'date', 'hour'];
const END_KEYS = ['end', 'end_time', 'endsAt', 'ends_at', 'till', 'to', 'until'];
const PRICE_KEYS = ['price', 'value', 'price_per_kwh', 'electricity_price', 'total', 'market_price', 'marketprice', 'energy_price', 'price_incl_vat'];

// Integrations whose attribute prices are known to be all-in.
const ALL_IN_DOMAINS = new Set(['frank_energie', 'zonneplan_one']);

// Entries marked as a forecast, e.g. { time, price, source: 'forecast' }.
const MARK_KEYS = ['source', 'type', 'kind', 'status', 'price_type', 'origin'];
const FORECAST_RE = /forecast|predict|voorspel|estimat|expected/i;
const isForecast = (x) => MARK_KEYS.some((k) => typeof x[k] === 'string' && FORECAST_RE.test(x[k])) || x.forecast === true || x.is_forecast === true;

// Local clock times in a repeated/missing DST hour do not identify a price slot.
// Departures keep their existing clock-time policy; price input must be unambiguous.
function priceTime(value, tz, warnings = []) {
  const text = String(value ?? '').trim();
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (tz && local) {
    const want = local.slice(1).map((x) => Number(x || 0));
    const guess = Date.UTC(want[0], want[1] - 1, want[2], want[3], want[4], want[5]);
    const offsets = new Set([-86400000, 0, 86400000].map((d) => tzOffsetMs(guess + d, tz)));
    const candidates = [...offsets].map((off) => guess - off).filter((ms) => {
      const got = tzParts(ms, tz);
      return [got.y, got.m, got.d, got.h, got.mi, got.s].every((v, i) => v === want[i]);
    });
    if (candidates.length !== 1) {
      warnings.push(`The price time ${text} (${tz}) is ambiguous or does not exist at a clock change. Use UTC or timestamps with an explicit offset; that slot was skipped.`);
      return NaN;
    }
    return candidates[0];
  }
  return parseTime(value, tz);
}

const validPrice = (v) => v !== null && v !== undefined && typeof v !== 'boolean'
  && !(typeof v === 'string' && !v.trim()) && Number.isFinite(Number(v));

function parseList(list, tz) {
  if (!Array.isArray(list) || list.length < 4) return null;
  const first = list.find((x) => x && typeof x === 'object');
  if (!first) return null;
  const tKey = TIME_KEYS.find((k) => k in first);
  const pKey = PRICE_KEYS.find((k) => k in first);
  if (!tKey || !pKey) return null;
  const eKey = END_KEYS.find((k) => k in first);
  const out = [];
  out.warnings = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const start = priceTime(x[tKey], tz, out.warnings);
    if (!validPrice(x[pKey])) {
      out.warnings.push('A missing or invalid price was skipped; it is not a free charging slot.');
      continue;
    }
    const price = Number(x[pKey]);
    if (!Number.isFinite(start)) continue;
    const end = eKey ? priceTime(x[eKey], tz, out.warnings) : undefined;
    if (eKey && (!Number.isFinite(end) || end <= start)) {
      out.warnings.push('A price interval with an invalid end was skipped.');
      continue;
    }
    const item = { start, end, price };
    if (isForecast(x)) item.forecast = true;
    out.push(item);
  }
  return out.length || out.warnings.length ? out : null;
}

function pricesFromAttributes(attributes, tz) {
  const merged = new Map();
  const keys = [];
  const warnings = [];
  for (const [key, value] of Object.entries(attributes || {})) {
    const parsed = parseList(value, tz);
    if (!parsed) continue;
    keys.push(key);
    warnings.push(...parsed.warnings);
    for (const p of parsed) if (!merged.has(p.start)) merged.set(p.start, p);
  }
  return { keys, prices: [...merged.values()], warnings: [...new Set(warnings)] };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

// services: Home Assistant's get_services result. An action source is only
// offered when its action really exists (null: not known, offer it as before).
function hasAction(services, domain) {
  if (!services) return true;
  const def = ACTION_SOURCES[domain];
  return !!(def && services[domain] && services[domain][def.service]);
}

function detectPriceSources(entities, devices, states, tz, services = null) {
  const candidates = [];
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  // Action sources: one per config entry of a known integration.
  const seen = new Set();
  const offered = new Set();
  for (const e of entities) {
    const def = ACTION_SOURCES[e.platform];
    if (!def || !e.config_entry_id || seen.has(e.config_entry_id) || !hasAction(services, e.platform)) continue;
    offered.add(e.platform);
    seen.add(e.config_entry_id);
    const device = e.device_id && deviceById.get(e.device_id);
    candidates.push({
      id: `action:${e.platform}:${e.config_entry_id}`,
      type: 'action',
      domain: e.platform,
      config_entry: e.config_entry_id,
      name: def.name,
      detail: device ? device.name_by_user || device.name : null,
      price_type: def.price_type,
    });
  }

  // Attribute sources: any sensor with a list of timed prices.
  const regById = new Map(entities.map((e) => [e.entity_id, e]));
  for (const s of states) {
    if (!s.entity_id.startsWith('sensor.')) continue;
    if (/gas/.test(s.entity_id)) continue;
    const { keys, prices } = pricesFromAttributes(s.attributes, tz);
    if (!keys.length) continue;
    const forecastCount = prices.filter((p) => p.forecast).length;
    const lastStart = prices.reduce((m, p) => Math.max(m, p.start), 0);
    const reg = regById.get(s.entity_id);
    const domain = reg ? reg.platform : null;
    if (domain && offered.has(domain)) continue; // already offered as action
    const hacsNordPool = domain === 'nordpool' && s.attributes && s.attributes.currency && s.attributes.raw_today;
    candidates.push({
      id: `attr:${s.entity_id}`,
      type: 'attribute',
      domain,
      entity_id: s.entity_id,
      name: (s.attributes && s.attributes.friendly_name) || s.entity_id,
      detail: `${s.entity_id} · ${keys.join(', ')} · ${prices.length} prices${forecastCount ? ` (${forecastCount} marked as forecast)` : ''}`,
      // The HACS Nord Pool sensor includes VAT unless it was turned off there.
      price_type: domain && ALL_IN_DOMAINS.has(domain) ? 'all_in' : hacsNordPool ? 'market_incl_vat' : 'market_excl_vat',
      ...(hacsNordPool ? { note: 'Nord Pool (HACS) includes VAT by default. If you turned VAT off in that integration, choose "Market price, excl. VAT".' } : {}),
      // Prices for more than today and tomorrow: usable as a forecast.
      forecast_capable: lastStart >= localMidnight(tz, 2),
      forecast_marked: forecastCount,
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Fetching and normalising
// ---------------------------------------------------------------------------

// The unit of a price sensor. The HACS Nord Pool sensor says it in separate
// attributes (currency "EUR", unit "kWh", price_in_cents), which are clearer
// than its display unit; other sensors use their unit_of_measurement.
function unitHint(attributes) {
  const a = attributes || {};
  if (a.currency && /^(kWh|MWh)$/i.test(String(a.unit || ''))) return `${a.currency}${a.price_in_cents === true ? 'ct' : ''}/${a.unit}`;
  return a.unit_of_measurement;
}

// Convert only declared energy units. Never guess a unit from the price size.
function toPerKwh(prices, unitHint, warnings, currency = ha.state.currency) {
  const raw = String(unitHint || '').trim();
  const unit = raw.toLowerCase().replace(/\s+/g, '');
  const energyUnit = /^(?:(?:[a-z]{3}|[€£$])\/)?(kwh|mwh)$/.exec(unit);
  const cents = /^(?:[a-z]{3})?(?:ct|cents?|pence)(?:\/(?:kwh|mwh))?$/.test(unit);
  const mwh = energyUnit ? energyUnit[1] === 'mwh' : cents && /\/mwh$/.test(unit);
  const kwh = energyUnit && energyUnit[1] === 'kwh';
  if (!mwh && !kwh && !cents) {
    throw new Error('Price unit is missing or unsupported. Set an explicit currency/kWh, currency/MWh or cents/kWh unit on the source; prices were not guessed.');
  }
  const named = (raw.match(/\b([A-Z]{3})(?=\b|ct)/) || [])[1];
  const declared = named && !['KWH', 'MWH'].includes(named) ? named : raw.includes('€') ? 'EUR' : raw.includes('£') || unit.includes('pence') ? 'GBP' : null;
  if (declared && currency && declared !== String(currency).toUpperCase()) {
    throw new Error(`Price currency ${declared} differs from Home Assistant currency ${currency}. Select a matching source; currency conversion is not supported.`);
  }
  const factor = (mwh ? 1 / 1000 : 1) * (cents ? 1 / 100 : 1);
  return prices.map((p) => ({ ...p, price: p.price * factor }));
}

function finalise(prices, win) {
  const sorted = prices.filter((p) => Number.isFinite(p.start) && validPrice(p.price)).sort((a, b) => a.start - b.start);
  let step = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].start - sorted[i - 1].start;
    if (d > 0 && d < step) step = d;
  }
  if (!Number.isFinite(step)) step = 3600000;
  return {
    interval_minutes: Math.round(step / 60000),
    prices: sorted
      .map((p) => ({ start: p.start, end: Number.isFinite(p.end) ? p.end : p.start + step, price: p.price }))
      .filter((p) => p.start >= win.start && p.start < win.end && p.end > p.start),
  };
}

// A fixed tariff, or a day/night (peak/off-peak) tariff, for people without
// a dynamic contract. Prices are all-in per kWh, as on the energy bill.
// source: { mode: 'single'|'day_night', normal, low, low_from: 'HH:MM',
//           low_to: 'HH:MM', weekend_low: bool }
function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) % 1440;
}

function fixedTariff(source, win, tz) {
  const from = minutesOf(source.low_from);
  const to = minutesOf(source.low_to);
  const quarter = from % 60 !== 0 || to % 60 !== 0;
  const step = (quarter ? 15 : 60) * 60000;
  const inLow = (min) => (from <= to ? min >= from && min < to : min >= from || min < to);
  const out = [];
  for (let t = win.start; t < win.end; t += step) {
    const p = tzParts(t, tz);
    let low = false;
    if (source.mode === 'day_night') {
      const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
      low = (source.weekend_low && (weekday === 0 || weekday === 6)) || inLow(p.h * 60 + p.mi);
    }
    out.push({ start: t, end: t + step, price: low ? Number(source.low) : Number(source.normal) });
  }
  return out;
}

async function fetchPrices(source, tz) {
  const win = {
    start: localMidnight(tz, 0),
    tomorrow: localMidnight(tz, 1),
    end: localMidnight(tz, 2),
  };
  const warnings = [];
  let raw;
  let unit;

  if (source.type === 'fixed') {
    // Nothing to fetch and nothing to store: the tariff is the same every day.
    const prices = fixedTariff(source, win, tz);
    return { prices, interval_minutes: Math.round((prices[0] ? prices[0].end - prices[0].start : 3600000) / 60000), window: win, warnings };
  }

  if (source.type === 'action') {
    const def = ACTION_SOURCES[source.domain];
    if (!def) throw new Error(`Unknown price integration: ${source.domain}`);
    raw = await def.fetch(source.config_entry, win, tz, source.select || null);
    unit = def.unit;
  } else if (source.type === 'attribute') {
    const states = await ha.call({ type: 'get_states' });
    const s = states.find((x) => x.entity_id === source.entity_id);
    if (!s) throw new Error(`Sensor ${source.entity_id} not found`);
    const parsed = pricesFromAttributes(s.attributes, tz);
    const all = parsed.prices;
    warnings.push(...parsed.warnings);
    // Entries marked as a forecast are not real prices; the forecast
    // setting decides whether they are used.
    raw = all.filter((p) => !p.forecast);
    if (raw.length < all.length) ha.debug('Price source', source.id, 'skipped', all.length - raw.length, 'forecast entries');
    unit = unitHint(s.attributes);
  } else {
    throw new Error('Unknown source type');
  }

  ha.debug('Price source', source.id, 'returned', raw.length, 'prices; unit hint:', unit);
  if (raw.some((p) => !validPrice(p.price))) warnings.push('Invalid price values were skipped; they are not free charging slots.');
  const { interval_minutes, prices } = finalise(toPerKwh(raw, unit, warnings), win);
  try {
    history.record(source.id, prices);
  } catch (err) {
    ha.warn('Could not store price history:', err.message);
  }
  return { prices, interval_minutes, window: win, warnings, choice: (raw && raw.choice) || null };
}

// Forecast: a sensor with expected prices for the coming days. Only the part
// after the last real price is used (fromMs), up to 7 days ahead. Nothing is
// stored in the price history: these are not real prices.
async function fetchForecast(forecast, tz, fromMs) {
  const states = await ha.call({ type: 'get_states' });
  const s = states.find((x) => x.entity_id === forecast.entity_id);
  if (!s) throw new Error(`Forecast sensor ${forecast.entity_id} not found`);
  const parsed = pricesFromAttributes(s.attributes, tz);
  const warnings = [...parsed.warnings];
  const raw = parsed.prices;
  const unit = unitHint(s.attributes);
  const win = { start: fromMs, end: localMidnight(tz, 8) };
  const { prices } = finalise(toPerKwh(raw, unit, warnings), win);
  return { prices, warnings };
}

// Past days for action sources (they can look back); stored in the history.
// dayRanges: [[startMs, endMs], ...] of local days.
async function backfill(source, dayRanges, tz) {
  if (source.type !== 'action') return 0;
  const def = ACTION_SOURCES[source.domain];
  if (!def) return 0;
  let filled = 0;
  for (const [start, end] of history.missingDays(source.id, dayRanges)) {
    try {
      const raw = await def.fetch(source.config_entry, { start, tomorrow: end, end }, tz, source.select || null);
      const { prices } = finalise(toPerKwh(raw, def.unit, []), { start, end });
      history.record(source.id, prices);
      filled += prices.length ? 1 : 0;
    } catch (err) {
      ha.debug('Backfill failed for', localDate(start, tz), '-', err.message);
    }
  }
  return filled;
}

// All-in price per kWh from the source price and the user's surcharges.
function totalPrice(raw, cfg) {
  const fee = Number(cfg.purchase_fee) || 0;
  const tax = Number(cfg.energy_tax) || 0;
  const vat = 1 + (Number(cfg.vat_percent ?? 21) || 0) / 100;
  if (cfg.price_type === 'all_in') return raw;
  if (cfg.price_type === 'market_incl_vat') return raw + (fee + tax) * vat;
  return (raw + fee + tax) * vat;
}

// How a price is built, step by step (#26): input → fees and tax → VAT → margin.
function priceBreakdown(raw, cfg, margin = 0, start = null) {
  const type = cfg.price_type || 'market_excl_vat';
  const fee = Number(cfg.purchase_fee) || 0;
  const tax = Number(cfg.energy_tax) || 0;
  const vatPct = Number(cfg.vat_percent ?? 21) || 0;
  const total = totalPrice(raw, cfg);
  return {
    ...(start != null ? { start } : {}),
    input: raw,
    basis: type,
    fee: type === 'all_in' ? 0 : fee,
    tax: type === 'all_in' ? 0 : tax,
    vat_percent: type === 'all_in' ? 0 : vatPct,
    vat_on: type === 'market_excl_vat' ? 'price, fee and tax' : type === 'market_incl_vat' ? 'fee and tax only' : 'nothing (already all-in)',
    total,
    margin: Number(margin) || 0,
    compared: total + (Number(margin) || 0),
  };
}

function summarise(result, cfg, now = Date.now()) {
  const { prices, window: win, interval_minutes, warnings } = result;
  const withTotal = prices.map((p) => ({ ...p, total: totalPrice(p.price, cfg) }));
  const today = withTotal.filter((p) => p.start < win.tomorrow);
  const tomorrow = withTotal.filter((p) => p.start >= win.tomorrow);
  const current = withTotal.find((p) => p.start <= now && now < p.end) || null;
  const pick = (list, fn) => (list.length ? list.reduce((a, b) => (fn(b.total, a.total) ? b : a)) : null);
  const checkDay = (list, start, end, label) => {
    if (!list.length) return; // tomorrow may not have been published yet
    const expected = Math.round((end - start) / (interval_minutes * 60000));
    if (list.length < expected) warnings.push(`Only ${list.length} of ${expected} prices found for ${label}.`);
    let covered = start;
    let gap = false;
    let overlap = false;
    for (const p of [...list].sort((a, b) => a.start - b.start)) {
      if (p.start > covered + 1) gap = true;
      if (p.start < covered - 1) overlap = true;
      covered = Math.max(covered, Math.min(end, p.end));
    }
    if (covered < end - 1) gap = true;
    if (gap) warnings.push(`Price coverage for ${label} has a gap. Check timestamps, offsets and missing slots.`);
    if (overlap) warnings.push(`Price coverage for ${label} has overlapping intervals.`);
  };
  checkDay(today, win.start, win.tomorrow, 'today');
  checkDay(tomorrow, win.tomorrow, win.end, 'tomorrow');
  return {
    interval_minutes,
    count_today: today.length,
    count_tomorrow: tomorrow.length,
    tomorrow_available: tomorrow.length > 0,
    current,
    lowest_today: pick(today, (a, b) => a < b),
    highest_today: pick(today, (a, b) => a > b),
    average_today: today.length ? today.reduce((s, p) => s + p.total, 0) / today.length : null,
    warnings: [...new Set(warnings)],
  };
}

module.exports = {
  fixedTariff, fetchForecast,
  detectPriceSources, hasAction, unitHint, pickEntry, fetchPrices, backfill, summarise, totalPrice, priceBreakdown,
  localMidnight, localTimeOn, localDateTime, parseLocal, tzParts, isoLocal, localDate,
  pricesFromAttributes, ACTION_SOURCES, priceTime, toPerKwh,
};
