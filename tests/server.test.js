'use strict';

// End-to-end: the real server against a fake Home Assistant (WebSocket).
// Checks the wizard data, saving settings, live flows, prices with colours,
// today's costs, and that only ingress may connect. Fixture-based: this is
// not a test against a real Home Assistant or a real meter.

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');

const { fakeHA, sent } = require('./fakeha');

function request(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* html */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('end to end against a fake Home Assistant', async (t) => {
  const wss = fakeHA();
  await new Promise((r) => wss.on('listening', r));
  process.env.HA_WS_URL = `ws://127.0.0.1:${wss.address().port}`;
  process.env.SUPERVISOR_TOKEN = 'test-token';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-e2e-'));
  process.env.ED_RECONNECT_MS = '100000';
  process.env.ED_TEST = '1';
  const app = require('../energy_dashboard/app/server');
  const ha = require('../energy_dashboard/app/ha');
  const srv = await app.start(0);
  const port = srv.address().port;
  t.after(() => { srv.closeAllConnections(); srv.close(); for (const c of wss.clients) c.terminate(); wss.close(); });

  await until(() => ha.state.connected);

  await t.test('the page and status load', async () => {
    const page = await request(port, 'GET', '/');
    assert.strictEqual(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);
    const st = await request(port, 'GET', '/api/status');
    assert.strictEqual(st.json.wizard_done, false);
    assert.strictEqual(st.json.language, 'nl');
  });

  let detect;
  await t.test('wizard data: the HomeWizard meter and EnergyZero are found', async () => {
    detect = (await request(port, 'GET', '/api/detect')).json;
    assert.strictEqual(detect.meters.length, 1);
    assert.strictEqual(detect.meters[0].meter, 'homewizard');
    assert.strictEqual(detect.meters[0].sample_w.net_w, 1250);
    assert.ok(detect.price_sources.some((s) => s.domain === 'energyzero'));
    assert.ok(detect.suppliers.length >= 15);
    assert.ok(detect.sensors.some((s) => s.entity_id === 'sensor.car_charger_power'));
    assert.strictEqual(detect.planners.charging_planner.length, 1);
  });

  await t.test('a bad setting is refused with a clear message', async () => {
    const r = await request(port, 'POST', '/api/settings', { meter: { meter: 'manual' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.json.error, /grid power/);
  });

  await t.test('saving the wizard result', async () => {
    const m = detect.meters[0];
    const src = detect.price_sources.find((s) => s.domain === 'energyzero');
    const r = await request(port, 'POST', '/api/settings', {
      wizard_done: true,
      meter: { meter: m.meter, ...m.roles },
      price: { source: src, price_type: src.price_type, supplier: 'anwb', fee_incl_vat: 0.018, compare_tariff: 0.3 },
      modules: [{ id: 'car', type: 'ev', name: 'Car', power_entity: 'sensor.car_charger_power' }],
      tiles: ['cost', 'usage', 'charging_planner'],
    });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.wizard_done, true);
  });

  await t.test('live flows from the subscription', async () => {
    const live = await until(async () => {
      const r = (await request(port, 'GET', '/api/live')).json;
      return r.flows && r.flows.grid && r.flows.modules.length && r.flows.modules[0].power_w !== null ? r : null;
    });
    assert.strictEqual(live.flows.grid.net_w, 1250);
    assert.strictEqual(live.flows.modules[0].power_w, 3700);
    assert.strictEqual(live.flows.home_w, 1250);
    assert.strictEqual(live.flows.rest_w, 0);
    assert.strictEqual(live.night, false);
  });

  await t.test('prices: today + tomorrow, all-in, coloured', async () => {
    const pv = await until(async () => {
      const r = (await request(port, 'GET', '/api/prices')).json;
      return r.prices && r.prices.length ? r : null;
    });
    assert.ok(pv.prices.length >= 24);
    const p = pv.prices[0];
    assert.ok(Math.abs(p.total - (p.raw * 1.21 + 0.018 + 0.11085)) < 1e-9);
    assert.match(p.color, /^#[0-9a-f]{6}$/);
    assert.ok(pv.current, 'a current price');
    assert.ok(pv.today.cheap);
    const live = (await request(port, 'GET', '/api/live')).json;
    assert.match(live.price.color, /^#[0-9a-f]{6}$/);
  });

  await t.test('today: usage and costs from statistics', async () => {
    const d = (await request(port, 'GET', '/api/day?offset=0')).json;
    assert.strictEqual(d.import_kwh, 3);
    assert.strictEqual(d.export_kwh, 1.5);
    assert.ok(d.priced);
    assert.ok(Number.isFinite(d.cost));
    const bad = await request(port, 'GET', '/api/day?offset=5');
    assert.strictEqual(bad.status, 400);
  });

  await t.test('gas: price from EnergyZero, all-in, and costs today (#6)', async () => {
    const det = (await request(port, 'GET', '/api/detect')).json;
    const gsrc = det.gas_sources.find((x) => x.type === 'action' && x.domain === 'energyzero');
    assert.ok(gsrc, 'EnergyZero gas found');
    const cur = (await request(port, 'GET', '/api/settings')).json;
    const r = await request(port, 'POST', '/api/settings', { ...cur, price: { ...cur.price, gas: { source: gsrc, price_type: gsrc.price_type, fee_incl_vat: 0.0591 } } });
    assert.strictEqual(r.status, 200, r.text);
    const g = await until(async () => {
      const x = (await request(port, 'GET', '/api/gas')).json;
      return x.current ? x : null;
    });
    assert.ok(Math.abs(g.current.total - (0.45 * 1.21 + 0.0591 + 0.7268)) < 1e-9);
    assert.strictEqual(g.plausibility, null);
    const d = (await request(port, 'GET', '/api/day?offset=0')).json;
    assert.strictEqual(d.gas_m3, 1.5);
    assert.ok(Math.abs(d.gas_cost - 1.5 * g.current.total) < 1e-9);
    const live = (await request(port, 'GET', '/api/live')).json;
    assert.ok(Math.abs(live.gas_price - g.current.total) < 1e-9);
  });

  await t.test('history only for configured devices', async () => {
    assert.strictEqual((await request(port, 'GET', '/api/history?key=car')).status, 200);
    assert.strictEqual((await request(port, 'GET', '/api/history?key=sensor.anything')).status, 400);
  });

  await t.test('diagnostics contain no entity ids', async () => {
    const d = (await request(port, 'GET', '/api/diagnostics')).text;
    assert.ok(!/sensor\./.test(d));
    assert.match(d, /homewizard/);
  });

  await t.test('cross-site or non-JSON writes are refused', async () => {
    const r1 = await request(port, 'POST', '/api/settings', { language: 'en' }, { 'Sec-Fetch-Site': 'cross-site' });
    assert.strictEqual(r1.status, 403);
    const r2 = await request(port, 'POST', '/api/settings', null, { 'Content-Type': 'text/plain' });
    assert.strictEqual(r2.status, 403);
  });

  await t.test('the app never sent a write command to Home Assistant', () => {
    const types = new Set(sent.map((m) => m.type));
    for (const ty of types) assert.ok(ty === 'auth' || ha.READ_ONLY_COMMANDS.has(ty) || ty === 'call_service', ty);
    for (const m of sent.filter((x) => x.type === 'call_service')) assert.ok(['energyzero.get_energy_prices', 'energyzero.get_gas_prices'].includes(`${m.domain}.${m.service}`));
  });
});
