'use strict';

// A fake Home Assistant for tests and for previewing the page:
// node tests/fakeha.js starts it together with the app on port 8099.
// DEMO=1 gives a fuller, made-up house (solar, battery, car, heat pump, a
// realistic price curve) for screenshots; LANG=en|nl sets the HA language.

const WebSocket = require('../energy_dashboard/app/node_modules/ws');
const { P1, reg } = require('./fixtures');

const H = 3600000;
const sent = [];

// Local hour in Amsterdam, for the demo price curve.
const hourAms = (t) => Number(new Date(t).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Amsterdam' })) % 24;
const dayAms = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' });
const CURVE = [0.09, 0.08, 0.07, 0.07, 0.07, 0.08, 0.11, 0.15, 0.17, 0.13, 0.09, 0.06, 0.04, 0.03, 0.04, 0.07, 0.11, 0.17, 0.21, 0.18, 0.14, 0.12, 0.11, 0.10];
const USE = [0.3, 0.3, 0.3, 0.2, 0.2, 0.3, 0.6, 0.9, 0.5, 0.4, 0.3, 0.2, 0.1, 0.1, 0.2, 0.4, 3.9, 4.6, 1.4, 1.1, 0.9, 0.7, 0.5, 0.4];
const EXP = [0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.5, 1.1, 1.6, 1.9, 1.7, 1.2, 0.6, 0.1, 0, 0, 0, 0, 0, 0, 0];
const SUN = [0, 0, 0, 0, 0, 0, 0, 50, 400, 1100, 1900, 2500, 2800, 2600, 2100, 1400, 600, 100, 0, 0, 0, 0, 0, 0];

function fakeHA(port = 0, opts = {}) {
  const demo = opts.demo === true;
  const wss = new WebSocket.Server({ port });
  const entities = [...P1.homewizard.entities, reg('energyzero', 'sensor.energyzero_today_average_price', null, { config_entry_id: 'ezentry' })];
  const states = [
    { entity_id: 'sensor.p1_meter_power', state: '1250', attributes: { unit_of_measurement: 'W', device_class: 'power', friendly_name: 'P1 power' } },
    { entity_id: 'sensor.p1_meter_power_phase_1', state: '400', attributes: { unit_of_measurement: 'W', device_class: 'power' } },
    { entity_id: 'sensor.p1_meter_energy_import', state: '1000', attributes: { unit_of_measurement: 'kWh', device_class: 'energy' } },
    { entity_id: 'sensor.p1_meter_energy_export', state: '10', attributes: { unit_of_measurement: 'kWh', device_class: 'energy' } },
    { entity_id: 'sensor.car_charger_power', state: '3.7', attributes: { unit_of_measurement: 'kW', device_class: 'power', friendly_name: 'Charger' } },
    { entity_id: 'sensor.smart_charging_status', state: 'Charging', attributes: { friendly_name: 'Smart charging status' } },
    { entity_id: 'sun.sun', state: 'above_horizon', attributes: {} },
  ];
  if (demo) {
    const set = (id, state, attributes) => {
      const i = states.findIndex((x) => x.entity_id === id);
      const s = { entity_id: id, state: String(state), attributes };
      if (i >= 0) states[i] = s; else states.push(s);
    };
    const pw = (name) => ({ unit_of_measurement: 'W', device_class: 'power', state_class: 'measurement', friendly_name: name });
    set('sensor.p1_meter_power', 3600, pw('P1 power'));
    set('sensor.p1_meter_power_phase_1', 1900, pw('P1 power phase 1'));
    set('sensor.p1_meter_power_phase_2', 1100, pw('P1 power phase 2'));
    set('sensor.p1_meter_power_phase_3', 600, pw('P1 power phase 3'));
    set('sensor.car_charger_power', 3700, pw('Charger power'));
    set('sensor.heat_pump_power', 900, pw('Heat pump power'));
    set('sensor.solar_power', 2400, pw('Solar power'));
    set('sensor.home_battery_power', 800, pw('Battery power'));
    set('sensor.home_battery_soc', 64, { unit_of_measurement: '%', device_class: 'battery', friendly_name: 'Battery level' });
    set('sensor.car_battery', 58, { unit_of_measurement: '%', device_class: 'battery', friendly_name: 'Car battery' });
    set('sensor.smart_charging_status', 'Charging now', { friendly_name: 'Smart Charging status' });
    set('sensor.smart_charging_next_start', 'unknown', { friendly_name: 'Smart Charging next start' });
    set('sensor.smart_charging_planned_cost', 2.84, { friendly_name: 'Smart Charging planned cost', unit_of_measurement: 'EUR' });
    set('sensor.smart_heating_status', 'Pre-heating', { friendly_name: 'Smart Heating status' });
    set('sensor.smart_heating_target', 21.5, { friendly_name: 'Smart Heating target', unit_of_measurement: '°C' });
  }
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'auth_required' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      sent.push(m);
      const ok = (result) => ws.send(JSON.stringify({ id: m.id, type: 'result', success: true, result }));
      if (m.type === 'auth') { ws.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.11.0' })); return; }
      switch (m.type) {
        case 'get_config': return ok({ time_zone: 'Europe/Amsterdam', currency: 'EUR', language: opts.language || 'nl' });
        case 'config/entity_registry/list': return ok(entities);
        case 'config/device_registry/list': return ok([{ id: 'dev_homewizard', name: 'P1 meter' }]);
        case 'get_states': return ok(states);
        case 'get_services': return ok({ energyzero: { get_energy_prices: {} } });
        case 'subscribe_entities': {
          ok(null);
          const a = {};
          for (const s of states) if (m.entity_ids.includes(s.entity_id)) a[s.entity_id] = { s: s.state, a: s.attributes, lc: 1 };
          ws.send(JSON.stringify({ id: m.id, type: 'event', event: { a } }));
          return undefined;
        }
        case 'unsubscribe_events': return ok(null);
        case 'call_service': {
          if (m.domain === 'energyzero') {
            const start = Date.parse(m.service_data.start);
            const end = Date.parse(m.service_data.end);
            const prices = [];
            const first = dayAms(start);
            for (let t = start, i = 0; t < end; t += H, i++) {
              const price = demo ? CURVE[hourAms(t)] * (dayAms(t) === first ? 1 : 0.9) + (dayAms(t) === first ? 0 : 0.01) : 0.05 + (i % 24) * 0.01;
              prices.push({ timestamp: new Date(t).toISOString(), price: Math.round(price * 10000) / 10000 });
            }
            return ok({ response: { prices } });
          }
          return ws.send(JSON.stringify({ id: m.id, type: 'result', success: false, error: { message: 'not in fake' } }));
        }
        case 'recorder/statistics_during_period': {
          const from = Date.parse(m.start_time);
          const out = {};
          for (const id of m.statistic_ids) {
            out[id] = [];
            const to = Math.min(Date.parse(m.end_time), Date.now());
            if (demo && m.period === 'hour') {
              for (let t = from; t < to; t += H) out[id].push({ start: t, end: t + H, change: id.includes('import') ? USE[hourAms(t)] : id.includes('export') ? EXP[hourAms(t)] : 0 });
            } else if (demo) {
              for (let t = from; t < to; t += 300000) {
                const h = hourAms(t);
                const base = id.includes('car') ? (h >= 16 && h < 18 ? 3700 : h >= 15 ? 3700 : 0) : id.includes('export') ? EXP[h] * 1000 : USE[h] * 1000;
                out[id].push({ start: t, end: t + 300000, mean: base + Math.sin(t / 900000) * 120 });
              }
            } else if (m.period === 'hour') for (let i = 0; i < 3; i++) out[id].push({ start: from + i * H, end: from + (i + 1) * H, change: id.includes('import') ? 1 : 0.5 });
            else out[id].push({ start: from, end: from + 300000, mean: 1000 });
          }
          return ok(out);
        }
        case 'energy/get_prefs':
          return ok({ energy_sources: demo ? [{ type: 'solar', stat_energy_from: 'sensor.solar_energy', config_entry_solar_forecast: ['forecast_entry'] }] : [] });
        case 'energy/solar_forecast': {
          const wh = {};
          const day0 = Date.now() - (Date.now() % (24 * H)) - 2 * H;
          for (let t = day0; t < day0 + 48 * H; t += H) wh[new Date(t).toISOString()] = SUN[hourAms(t)] * (t < day0 + 24 * H ? 1 : 0.7);
          return ok({ forecast_entry: { wh_hours: wh } });
        }
        default:
          return ws.send(JSON.stringify({ id: m.id, type: 'result', success: false, error: { message: `unknown ${m.type}` } }));
      }
    });
  });
  return wss;
}


module.exports = { fakeHA, sent, H };

if (require.main === module) {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const wss = fakeHA(0, { demo: process.env.DEMO === '1', language: process.env.LANG_HA || 'nl' });
  wss.on('listening', async () => {
    process.env.HA_WS_URL = `ws://127.0.0.1:${wss.address().port}`;
    process.env.SUPERVISOR_TOKEN = 'preview';
    process.env.ED_ALLOW_ANY_CLIENT = '1';
    process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'ed-preview-'));
    await require('../energy_dashboard/app/server').start(Number(process.env.PORT) || 8099);
    console.log('Preview on http://127.0.0.1:' + (process.env.PORT || 8099), 'data in', process.env.DATA_DIR);
  });
}
