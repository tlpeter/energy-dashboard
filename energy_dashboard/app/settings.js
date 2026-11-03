'use strict';

// Settings made in the app (wizard and Settings page), in /data/settings.json.
// validate() is the only way in: it fills defaults and refuses odd values, so
// the rest of the app can trust what it reads.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonstore');
const { DATA_DIR } = require('./options');
const { supplier, ENERGY_TAX_2026_INCL_VAT, ENERGY_TAX_GAS_2026_INCL_VAT, VAT_PERCENT } = require('./suppliers');

const FILE = path.join(DATA_DIR, 'settings.json');

const MODULE_TYPES = ['ev', 'heatpump', 'solar', 'battery', 'device'];
const TILES = ['cost', 'usage', 'gas', 'charging_planner', 'heating_planner', 'modules'];
const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;

const DEFAULTS = {
  version: 1,
  wizard_done: false,
  language: 'auto',
  meter: null,
  price: {
    source: null,
    price_type: 'market_excl_vat',
    supplier: null,
    fee_incl_vat: null,
    energy_tax_incl_vat: ENERGY_TAX_2026_INCL_VAT,
    vat_percent: VAT_PERCENT,
    fixed_month: null,
    compare_tariff: null,
    export_mode: 'auto',
    export_fee_incl_vat: 0,
    gas: null,
  },
  modules: [],
  edge: { mode: 'average', reference: 'today_tomorrow', band: 25, green_below: 0.25, red_above: 0.35, very_above: 0.45, width: 10, glow: 40, pulse: false, smooth: true, colors: { cheap: '#17e86e', mid: '#e8d717', expensive: '#e81717', very: '#a855f7', negative: '#3b82f6', use_very: false, use_negative: false } },
  theme: { night: 'sun', night_from: '22:30', night_to: '06:30', dim: 55 },
  idle: { home_seconds: 60, popup_seconds: 30 },
  tiles: ['cost', 'usage', 'charging_planner', 'heating_planner'],
  chart_default: 'price',
};

class SettingsError extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}
const bad = (msg) => { throw new SettingsError(msg); };

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const entity = (v, label, required = false) => {
  if (v === null || v === undefined || v === '') {
    if (required) bad(`${label}: choose a sensor`);
    return null;
  }
  if (typeof v !== 'string' || !ENTITY_RE.test(v)) bad(`${label}: "${v}" is not an entity id`);
  return v;
};
const num = (v, label, min, max, fallback = null) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) bad(`${label}: must be between ${min} and ${max}`);
  return n;
};
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const hhmm = (v, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? v : fallback);
const text = (v, max = 60) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

function validateMeter(m) {
  if (!m) return null;
  if (!isObj(m)) bad('Meter: invalid');
  const out = {
    meter: text(m.meter, 40) || 'manual',
    power_net: entity(m.power_net, 'Grid power (net)'),
    power_import: entity(m.power_import, 'Grid power (import)'),
    power_export: entity(m.power_export, 'Grid power (export)'),
    invert_net: m.invert_net === true,
    energy_import: (Array.isArray(m.energy_import) ? m.energy_import : []).slice(0, 4).map((x) => entity(x, 'Energy import', true)),
    energy_export: (Array.isArray(m.energy_export) ? m.energy_export : []).slice(0, 4).map((x) => entity(x, 'Energy export', true)),
    phases: [0, 1, 2].map((i) => {
      const p = (Array.isArray(m.phases) && isObj(m.phases[i])) ? m.phases[i] : {};
      return { net: entity(p.net, `Phase ${i + 1}`), import: entity(p.import, `Phase ${i + 1} import`), export: entity(p.export, `Phase ${i + 1} export`) };
    }),
    gas: entity(m.gas, 'Gas'),
  };
  if (!out.power_net && !out.power_import) bad('Meter: choose a grid power sensor');
  return out;
}

function validateSource(s) {
  if (!s) return null;
  if (!isObj(s)) bad('Price source: invalid');
  if (s.type === 'fixed') {
    return {
      id: 'fixed', type: 'fixed', mode: oneOf(s.mode, ['single', 'day_night'], 'single'),
      normal: num(s.normal, 'Normal tariff', 0, 5, 0.3),
      low: num(s.low, 'Low tariff', 0, 5, null),
      low_from: hhmm(s.low_from, '23:00'), low_to: hhmm(s.low_to, '07:00'),
      weekend_low: s.weekend_low === true,
    };
  }
  if (s.type === 'action') {
    if (!/^[a-z_]+$/.test(String(s.domain || '')) || !/^[A-Za-z0-9_]+$/.test(String(s.config_entry || ''))) bad('Price source: invalid integration');
    return { id: `action:${s.domain}:${s.config_entry}`, type: 'action', domain: s.domain, config_entry: s.config_entry, select: s.select ? text(s.select, 80) : null };
  }
  if (s.type === 'attribute') {
    const id = entity(s.entity_id, 'Price sensor', true);
    return { id: `attr:${id}`, type: 'attribute', entity_id: id };
  }
  return bad('Price source: unknown type');
}

// Gas price (#6): source + surcharges, like electricity. Fixed = all-in per m³.
function validateGas(g) {
  if (!g) return null;
  if (!isObj(g)) bad('Gas price: invalid');
  let source = null;
  const s = g.source;
  if (s) {
    if (!isObj(s)) bad('Gas price source: invalid');
    if (s.type === 'fixed') source = { id: 'gas:fixed', type: 'fixed', price: num(s.price, 'Gas price per m³', 0, 10, null) };
    else if (s.type === 'action') {
      if (!['energyzero', 'easyenergy'].includes(s.domain) || !/^[A-Za-z0-9_]+$/.test(String(s.config_entry || ''))) bad('Gas price source: invalid integration');
      source = { id: `gas:action:${s.domain}:${s.config_entry}`, type: 'action', domain: s.domain, config_entry: s.config_entry };
    } else if (s.type === 'state') {
      const id = entity(s.entity_id, 'Gas price sensor', true);
      source = { id: `gas:state:${id}`, type: 'state', entity_id: id };
    } else bad('Gas price source: unknown type');
    if (source.type === 'fixed' && source.price === null) bad('Gas price per m³: fill in a price');
  }
  return {
    source,
    price_type: source && source.type === 'fixed' ? 'all_in' : oneOf(g.price_type, ['market_excl_vat', 'market_incl_vat', 'all_in'], 'market_excl_vat'),
    fee_incl_vat: num(g.fee_incl_vat, 'Gas purchase fee', -1, 2, null),
    energy_tax_incl_vat: num(g.energy_tax_incl_vat, 'Gas energy tax', 0, 3, ENERGY_TAX_GAS_2026_INCL_VAT),
    vat_percent: num(g.vat_percent, 'Gas VAT', 0, 50, VAT_PERCENT),
    fixed_month: num(g.fixed_month, 'Gas fixed costs per month', 0, 200, null),
  };
}

function validatePrice(p) {
  const x = isObj(p) ? p : {};
  const sup = x.supplier && supplier(x.supplier) ? x.supplier : null;
  return {
    source: validateSource(x.source),
    price_type: oneOf(x.price_type, ['market_excl_vat', 'market_incl_vat', 'all_in'], 'market_excl_vat'),
    supplier: sup,
    fee_incl_vat: num(x.fee_incl_vat, 'Purchase fee', -1, 1, null),
    energy_tax_incl_vat: num(x.energy_tax_incl_vat, 'Energy tax', 0, 1, ENERGY_TAX_2026_INCL_VAT),
    vat_percent: num(x.vat_percent, 'VAT', 0, 50, VAT_PERCENT),
    fixed_month: num(x.fixed_month, 'Fixed costs per month', 0, 200, null),
    compare_tariff: num(x.compare_tariff, 'Compare tariff', 0, 5, null),
    export_mode: oneOf(x.export_mode, ['auto', 'net_metering', 'market'], 'auto'),
    export_fee_incl_vat: num(x.export_fee_incl_vat, 'Export fee', -1, 1, 0),
    gas: validateGas(x.gas),
  };
}

function validateModule(m, i) {
  if (!isObj(m)) bad(`Device ${i + 1}: invalid`);
  const type = oneOf(m.type, MODULE_TYPES, null) || bad(`Device ${i + 1}: unknown type`);
  const id = /^[a-z0-9_-]{1,40}$/.test(String(m.id || '')) ? m.id : `${type}_${i + 1}`;
  return {
    id,
    type,
    name: text(m.name, 30) || type,
    power_entity: entity(m.power_entity, `${m.name || type}: power`, true),
    soc_entity: ['ev', 'battery'].includes(type) ? entity(m.soc_entity, `${m.name || type}: battery level`) : null,
    energy_entity: entity(m.energy_entity, `${m.name || type}: energy`),
    invert: m.invert === true,
    enabled: m.enabled !== false,
  };
}

// Colours of the price scale (#8): #rrggbb only.
function validateColors(c) {
  const x = isObj(c) ? c : {};
  const d = DEFAULTS.edge.colors;
  const hex = (v, k) => {
    if (v === null || v === undefined || v === '') return d[k];
    if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) bad(`Colour ${k}: use #rrggbb`);
    return String(v).toLowerCase();
  };
  return {
    cheap: hex(x.cheap, 'cheap'), mid: hex(x.mid, 'mid'), expensive: hex(x.expensive, 'expensive'),
    very: hex(x.very, 'very'), negative: hex(x.negative, 'negative'),
    use_very: x.use_very === true, use_negative: x.use_negative === true,
  };
}

function validate(input) {
  const x = isObj(input) ? input : {};
  const modules = (Array.isArray(x.modules) ? x.modules : []).slice(0, 12).map(validateModule);
  const ids = new Set();
  for (const m of modules) {
    if (ids.has(m.id)) m.id = `${m.id}_${ids.size}`;
    ids.add(m.id);
  }
  const e = isObj(x.edge) ? x.edge : {};
  const t = isObj(x.theme) ? x.theme : {};
  if (e.mode === 'fixed') {
    const lo = num(e.green_below, 'Green at or below', -1, 5, DEFAULTS.edge.green_below);
    const hi = num(e.red_above, 'Red at or above', -1, 5, DEFAULTS.edge.red_above);
    if (!(hi > lo)) bad('Red at or above must be higher than green at or below');
    const c = isObj(e.colors) ? e.colors : {};
    const very = num(e.very_above, 'Very expensive at or above', -1, 10, DEFAULTS.edge.very_above);
    if (c.use_very === true && !(very > hi)) bad('Very expensive at or above must be higher than red at or above');
  }
  const idle = isObj(x.idle) ? x.idle : {};
  return {
    version: 1,
    wizard_done: x.wizard_done === true,
    language: oneOf(x.language, ['auto', 'en', 'nl'], 'auto'),
    meter: validateMeter(x.meter),
    price: validatePrice(x.price),
    modules,
    edge: {
      mode: oneOf(e.mode, ['average', 'fixed'], DEFAULTS.edge.mode),
      green_below: num(e.green_below, 'Green at or below', -1, 5, DEFAULTS.edge.green_below),
      red_above: num(e.red_above, 'Red at or above', -1, 5, DEFAULTS.edge.red_above),
      very_above: num(e.very_above, 'Very expensive at or above', -1, 10, DEFAULTS.edge.very_above),
      colors: validateColors(e.colors),
      reference: oneOf(e.reference, ['today', 'today_tomorrow', 'next24'], DEFAULTS.edge.reference),
      band: num(e.band, 'Edge sensitivity', 5, 100, DEFAULTS.edge.band),
      width: num(e.width, 'Edge width', 0, 40, DEFAULTS.edge.width),
      glow: num(e.glow, 'Edge glow', 0, 150, DEFAULTS.edge.glow),
      pulse: e.pulse === true,
      smooth: e.smooth !== false,
    },
    theme: {
      night: oneOf(t.night, ['off', 'sun', 'times'], DEFAULTS.theme.night),
      night_from: hhmm(t.night_from, DEFAULTS.theme.night_from),
      night_to: hhmm(t.night_to, DEFAULTS.theme.night_to),
      dim: num(t.dim, 'Night brightness', 15, 100, DEFAULTS.theme.dim),
    },
    idle: {
      home_seconds: num(idle.home_seconds, 'Back to home', 0, 3600, DEFAULTS.idle.home_seconds),
      popup_seconds: num(idle.popup_seconds, 'Close pop-ups', 0, 3600, DEFAULTS.idle.popup_seconds),
    },
    tiles: (Array.isArray(x.tiles) ? x.tiles : DEFAULTS.tiles).filter((k, i, a) => TILES.includes(k) && a.indexOf(k) === i),
    chart_default: oneOf(x.chart_default, ['price', 'usage', 'solar'], 'price'),
  };
}

function load() {
  const raw = readJson(FILE, null);
  if (!raw) return validate({});
  try {
    return validate(raw);
  } catch {
    return validate({});
  }
}

function save(input) {
  const clean = validate(input);
  writeJsonAtomic(FILE, clean);
  return clean;
}

// Export valuation: net metering (salderen) ends on 1 January 2027 in NL.
function exportMode(price, now = Date.now()) {
  if (price.export_mode && price.export_mode !== 'auto') return price.export_mode;
  return now < Date.UTC(2026, 11, 31, 23, 0, 0) ? 'net_metering' : 'market';
}

module.exports = { load, save, validate, exportMode, DEFAULTS, MODULE_TYPES, TILES, SettingsError, FILE };
