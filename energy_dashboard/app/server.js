'use strict';

// Energy Dashboard — web server, served only through Home Assistant ingress.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ha = require('./ha');
const prices = require('./prices');
const meters = require('./meters');
const energy = require('./energy');
const gas = require('./gas');
const settingsMod = require('./settings');
const { SUPPLIERS, CHECKED, presetFor } = require('./suppliers');
const pkg = require('./package.json');

const PORT = Number(process.env.PORT) || 8099;
const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_VERSION = pkg.version;

let settings = settingsMod.load();
const cache = { prices: null, pricesAt: 0, pricesError: null, pricesDay: null, solar: null, solarAt: 0, gas: null, gasAt: 0, gasError: null };

// ------------------------------------------------------------------ helpers

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

function readBody(req, limit = 200000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(badRequest('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(badRequest('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const tz = () => ha.state.timeZone || 'UTC';
const getState = (id) => ha.liveState(id);

async function rewatch() {
  try {
    const ids = energy.watchedEntities(settings);
    const g = settings.price.gas;
    if (g && g.source && g.source.type === 'state') ids.push(g.source.entity_id);
    await ha.watchEntities(ids);
  } catch (err) {
    ha.warn('Could not watch entities:', err.message);
  }
}

// ------------------------------------------------------------------ prices

async function refreshPrices(force = false) {
  const src = settings.price.source;
  if (!src) { cache.prices = null; return null; }
  const today = prices.localDate(Date.now(), tz());
  const fresh = Date.now() - cache.pricesAt < 15 * 60000 && cache.pricesDay === today;
  if (!force && fresh && cache.prices) return cache.prices;
  try {
    cache.prices = await prices.fetchPrices(src, tz());
    cache.pricesAt = Date.now();
    cache.pricesDay = today;
    cache.pricesError = null;
  } catch (err) {
    cache.pricesError = err.message;
    ha.warn('Prices:', err.message);
  }
  return cache.prices;
}

// Gas prices (#6): every 15 minutes, like electricity.
async function refreshGas(force = false) {
  const g = settings.price.gas;
  if (!g || !g.source || !(settings.meter && settings.meter.gas)) { cache.gas = null; return null; }
  if (!force && cache.gas && Date.now() - cache.gasAt < 15 * 60000) return cache.gas;
  try {
    let st = ha.liveState(g.source.entity_id || '');
    if (g.source.type === 'state' && !st) {
      const all = await ha.call({ type: 'get_states' });
      st = all.find((x) => x.entity_id === g.source.entity_id) || null;
    }
    cache.gas = await gas.fetchGas(g.source, tz(), () => st);
    cache.gasAt = Date.now();
    cache.gasError = null;
  } catch (err) {
    cache.gasError = err.message;
    ha.warn('Gas prices:', err.message);
  }
  return cache.gas;
}

function currentGasView() {
  const g = settings.price.gas;
  if (!g || !cache.gas) return null;
  return gas.gasView(cache.gas, g);
}

function currentPriceView() {
  if (!cache.prices) return null;
  return energy.priceView(cache.prices, settings);
}

// ------------------------------------------------------------------ night

function isNight(now = new Date()) {
  const t = settings.theme;
  if (t.night === 'off') return false;
  if (t.night === 'sun') {
    const sun = getState('sun.sun');
    return !!(sun && sun.state === 'below_horizon');
  }
  const p = prices.tzParts(now.getTime(), tz());
  const min = p.h * 60 + p.mi;
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const from = toMin(t.night_from);
  const to = toMin(t.night_to);
  return from <= to ? min >= from && min < to : min >= from || min < to;
}

// ------------------------------------------------------------------ usage

async function statsFor(ids, from, to, period = 'hour', types = ['change']) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  return ha.call({
    type: 'recorder/statistics_during_period',
    start_time: new Date(from).toISOString(),
    end_time: new Date(to).toISOString(),
    statistic_ids: list,
    period,
    types,
  }, 30000);
}

async function day(offset) {
  const zone = tz();
  const from = prices.localMidnight(zone, offset);
  const to = prices.localMidnight(zone, offset + 1);
  const meter = settings.meter;
  const ids = meter ? [...meter.energy_import, ...meter.energy_export, meter.gas] : [];
  const stats = await statsFor(ids, from, Math.min(to, Date.now() + 3600000));
  const hours = energy.hourly(stats, meter, from, to);
  const view = currentPriceView();
  let list = [];
  if (offset === 0 && view) list = view.prices;
  else if (settings.price.source) {
    const { toPriceCfg } = require('./suppliers');
    const cfg = toPriceCfg(settings.price);
    const raw = settings.price.source.type === 'fixed'
      ? prices.fixedTariff(settings.price.source, { start: from, end: to }, zone)
      : require('./pricehistory').range(settings.price.source.id, from, to);
    list = raw.map((p) => ({ ...p, raw: p.price, total: prices.totalPrice(p.price, cfg) }));
  }
  const c = energy.costs(hours, list, settings.price);
  const gasRows = meter && meter.gas && stats[meter.gas] ? stats[meter.gas] : [];
  let gasList = [];
  const g = settings.price.gas;
  if (g && g.source) {
    if (offset === 0) await refreshGas();
    if (cache.gas) gasList = gas.withTotals(cache.gas.prices, g);
    if (offset < 0 && g.source.type !== 'fixed') {
      gasList = gas.withTotals(gas.sortSlots(require('./pricehistory').range(g.source.id, from - 86400000, to)), g);
    }
  }
  const gc = gas.gasCosts(gasRows, gasList, from, to);
  const fixedPerDay = Number(settings.price.fixed_month) ? Number(settings.price.fixed_month) * 12 / 365 : null;
  return {
    from, to,
    hours: hours.map((h) => ({ start: h.start, import: h.import, export: h.export, known: h.known })),
    ...c,
    gas_m3: meter && meter.gas ? gc.m3 : null,
    gas_cost: meter && meter.gas && gasList.length ? gc.cost : null,
    gas_unpriced_m3: gc.unpriced_m3,
    gas_hours: meter && meter.gas ? gc.hours.map((h) => ({ start: h.start, m3: h.m3, known: h.known })) : null,
    gas_fixed_per_day: g && Number(g.fixed_month) ? Number(g.fixed_month) * 12 / 365 : null,
    fixed_per_day: fixedPerDay,
    priced: list.length > 0,
  };
}

async function solar() {
  if (!settings.modules.some((m) => m.enabled && m.type === 'solar')) return null;
  if (cache.solar && Date.now() - cache.solarAt < 30 * 60000) return cache.solar;
  try {
    const prefs = await ha.call({ type: 'energy/get_prefs' });
    const entries = [];
    for (const s of (prefs && prefs.energy_sources) || []) {
      if (s.type === 'solar' && Array.isArray(s.config_entry_solar_forecast)) entries.push(...s.config_entry_solar_forecast);
    }
    if (!entries.length) { cache.solar = { hours: [], note: 'no_forecast' }; cache.solarAt = Date.now(); return cache.solar; }
    const raw = await ha.call({ type: 'energy/solar_forecast' });
    const picked = Object.fromEntries(Object.entries(raw || {}).filter(([k]) => entries.includes(k)));
    cache.solar = { hours: energy.solarHours(picked) };
    cache.solarAt = Date.now();
  } catch (err) {
    ha.warn('Solar forecast:', err.message);
    cache.solar = { hours: [], note: 'error' };
  }
  return cache.solar;
}

// What the wizard can choose from.
async function detect() {
  const [entities, devices, states, services] = await Promise.all([
    ha.call({ type: 'config/entity_registry/list' }),
    ha.call({ type: 'config/device_registry/list' }),
    ha.call({ type: 'get_states' }),
    ha.call({ type: 'get_services' }).catch(() => null),
  ]);
  const stateById = new Map(states.map((s) => [s.entity_id, s]));
  const sensors = states
    .filter((s) => /^sensor\./.test(s.entity_id))
    .map((s) => ({
      entity_id: s.entity_id,
      name: (s.attributes && s.attributes.friendly_name) || s.entity_id,
      device_class: (s.attributes && s.attributes.device_class) || null,
      unit: (s.attributes && s.attributes.unit_of_measurement) || null,
      state_class: (s.attributes && s.attributes.state_class) || null,
    }))
    .filter((s) => ['power', 'energy', 'battery', 'gas'].includes(s.device_class) || /^(k?W|k?Wh|%|m³)$/.test(String(s.unit || '')));
  const found = meters.detectMeters(entities, devices).map((m) => ({
    ...m,
    sample_w: meters.gridPower({ ...m.roles }, (id) => stateById.get(id) || null),
  }));
  let gasSources = [];
  try {
    gasSources = gas.detectGasSources(entities, states, services);
  } catch (err) {
    ha.warn('Gas price detection:', err.message);
  }
  let sources = [];
  try {
    sources = prices.detectPriceSources(entities, devices, states, tz(), services);
  } catch (err) {
    ha.warn('Price source detection:', err.message);
  }
  return {
    meters: found,
    price_sources: sources,
    gas_sources: gasSources,
    suppliers: SUPPLIERS.map((s) => ({ ...s, preset: presetFor(s.id) })),
    suppliers_checked: CHECKED,
    sensors,
    has_sun: stateById.has('sun.sun'),
    planners: energy.planners(states),
    language: ha.state.language,
  };
}

// The 24-hour power curve of the grid or one device (5-minute means).
async function historyFor(key) {
  let ids;
  if (key === 'grid') {
    const m = settings.meter;
    ids = m ? [m.power_net || m.power_import, m.power_export].filter(Boolean) : [];
  } else {
    const mod = settings.modules.find((x) => x.id === key);
    if (!mod) throw badRequest('Unknown device');
    ids = [mod.power_entity];
  }
  const to = Date.now();
  const from = to - 24 * 3600000;
  const stats = await statsFor(ids, from, to, '5minute', ['mean']);
  return { ids, series: ids.map((id) => ((stats && stats[id]) || []).map((r) => ({ t: typeof r.start === 'number' ? r.start : Date.parse(r.start), v: r.mean }))) };
}

function diagnostics() {
  // Allowlist only: no entity ids, names or numbers from the house.
  return {
    app_version: APP_VERSION,
    ha_version: ha.state.version,
    connected: ha.state.connected,
    language: settings.language,
    meter_type: settings.meter ? settings.meter.meter : null,
    meter_roles: settings.meter ? {
      net: !!settings.meter.power_net, import: !!settings.meter.power_import, export: !!settings.meter.power_export,
      energy_import: settings.meter.energy_import.length, energy_export: settings.meter.energy_export.length,
      phases: settings.meter.phases.filter((p) => p.net || p.import).length, gas: !!settings.meter.gas,
    } : null,
    price_source_type: settings.price.source ? settings.price.source.type : null,
    price_domain: settings.price.source ? settings.price.source.domain || null : null,
    price_type: settings.price.price_type,
    supplier: settings.price.supplier,
    modules: settings.modules.map((m) => m.type),
    prices_ok: !!cache.prices,
    prices_error: cache.pricesError ? 'yes' : 'no',
    interval_minutes: cache.prices ? cache.prices.interval_minutes : null,
    // Prices are market data, not data about the house.
    gas_source_type: settings.price.gas && settings.price.gas.source ? settings.price.gas.source.type : null,
    gas_price_type: settings.price.gas ? settings.price.gas.price_type : null,
    gas_error: cache.gasError ? 'yes' : 'no',
    gas_sample: (() => {
      const v = currentGasView();
      if (!v || !v.current) return null;
      const r = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
      return { source_value_now: r(v.current.raw), all_in_now: r(v.current.total), plausibility: v.plausibility ? v.plausibility.code : null };
    })(),
    price_sample: (() => {
      const v = currentPriceView();
      if (!v || !v.current) return null;
      const r = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
      return { source_value_now: r(v.current.raw), all_in_now: r(v.current.total), plausibility: v.plausibility ? v.plausibility.code : null };
    })(),
  };
}

// ------------------------------------------------------------------ routes

const routes = {
  'GET /api/status': async () => ({
    version: APP_VERSION,
    connected: ha.state.connected,
    ha_version: ha.state.version,
    language: ha.state.language,
    time_zone: tz(),
    wizard_done: settings.wizard_done,
  }),
  'GET /api/settings': async () => settings,
  'POST /api/settings': async (req) => {
    const body = await readBody(req);
    settings = settingsMod.save(body);
    cache.pricesAt = 0;
    cache.solarAt = 0;
    cache.gasAt = 0;
    await rewatch();
    refreshPrices(true).catch(() => {});
    refreshGas(true).catch(() => {});
    return settings;
  },
  'GET /api/detect': detect,
  'GET /api/live': async () => {
    const view = currentPriceView();
    return {
      at: Date.now(),
      flows: energy.flows(settings, getState),
      night: isNight(),
      price: view ? {
        now: view.current ? view.current.total : null,
        color: view.now_color,
        level: view.now_level,
        deviation: view.deviation,
        reference: view.reference,
        next_cheap: view.next_cheap,
      } : null,
      prices_error: cache.pricesError,
      gas_price: (() => { const v = currentGasView(); return v && v.current ? v.current.total : null; })(),
    };
  },
  'GET /api/prices': async () => {
    await refreshPrices();
    return currentPriceView() || { prices: [], error: cache.pricesError || (settings.price.source ? 'loading' : 'no_source') };
  },
  'GET /api/day': async (req, url) => {
    const off = Number(url.searchParams.get('offset') || 0);
    if (!Number.isInteger(off) || off > 0 || off < -31) throw badRequest('Invalid day');
    return day(off);
  },
  'GET /api/gas': async () => {
    await refreshGas();
    const v = currentGasView();
    return v ? { current: v.current, plausibility: v.plausibility, error: cache.gasError } : { current: null, error: cache.gasError || (settings.price.gas && settings.price.gas.source ? 'loading' : 'no_source') };
  },
  'GET /api/solar': async () => (await solar()) || { hours: [], note: 'off' },
  'GET /api/planners': async () => energy.planners(await ha.call({ type: 'get_states' })),
  'GET /api/history': async (req, url) => historyFor(String(url.searchParams.get('key') || '')),
  'GET /api/diagnostics': async () => diagnostics(),
};

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/wizard.js', ['wizard.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

// SAFETY: only the Home Assistant ingress proxy may talk to the app.
const INGRESS_PROXY = new Set(['172.30.32.2', '::ffff:172.30.32.2', '127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ALLOW_ANY_CLIENT = process.env.ED_ALLOW_ANY_CLIENT === '1'; // development only

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

async function handle(req, res) {
  const remote = req.socket.remoteAddress;
  if (!ALLOW_ANY_CLIENT && !INGRESS_PROXY.has(remote)) {
    ha.warn('Refused request from', remote);
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const site = String(req.headers['sec-fetch-site'] || '');
    if (site === 'cross-site' || type !== 'application/json') {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
  }
  const route = routes[`${req.method} ${url.pathname}`];
  if (route) {
    if (url.pathname !== '/api/status' && !ha.state.connected) {
      sendJson(res, 503, { error: 'Not connected to Home Assistant' });
      return;
    }
    try {
      sendJson(res, 200, await route(req, url));
    } catch (err) {
      if (!err.status) ha.warn('Error on', url.pathname, '-', err.message);
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }
  if (req.method === 'GET' && STATIC_FILES.has(url.pathname)) {
    const [file, type] = STATIC_FILES.get(url.pathname);
    fs.readFile(path.join(PUBLIC_DIR, file), (err, data) => {
      if (err) { res.writeHead(500); res.end('Could not load page'); return; }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': CSP,
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    ha.warn('Request failed:', err.message);
    try { sendJson(res, 500, { error: 'Internal error' }); } catch { /* already sent */ }
  });
});

function start(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      ha.log(`Energy Dashboard ${APP_VERSION} listening on port ${server.address().port}`);
      ha.onConnect(async () => {
        settings = settingsMod.load();
        await rewatch();
        await refreshPrices(true);
        await refreshGas(true);
      });
      const timer = setInterval(() => {
        if (!ha.state.connected) return;
        refreshPrices().catch(() => {});
        refreshGas().catch(() => {});
      }, 60000);
      timer.unref();
      ha.connect();
      resolve(server);
    });
  });
}

if (require.main === module) start();

module.exports = { server, start, routes, handle, _cache: cache };
