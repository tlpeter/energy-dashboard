'use strict';

// A fake Home Assistant for tests and for previewing the page:
// node tests/fakeha.js starts it together with the app on port 8099.

const WebSocket = require('../energy_dashboard/app/node_modules/ws');
const { P1, reg } = require('./fixtures');

const H = 3600000;
const sent = [];

function fakeHA(port = 0) {
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
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'auth_required' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      sent.push(m);
      const ok = (result) => ws.send(JSON.stringify({ id: m.id, type: 'result', success: true, result }));
      if (m.type === 'auth') { ws.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.11.0' })); return; }
      switch (m.type) {
        case 'get_config': return ok({ time_zone: 'Europe/Amsterdam', currency: 'EUR', language: 'nl' });
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
            for (let t = start, i = 0; t < end; t += H, i++) prices.push({ timestamp: new Date(t).toISOString(), price: 0.05 + (i % 24) * 0.01 });
            return ok({ response: { prices } });
          }
          return ws.send(JSON.stringify({ id: m.id, type: 'result', success: false, error: { message: 'not in fake' } }));
        }
        case 'recorder/statistics_during_period': {
          const from = Date.parse(m.start_time);
          const out = {};
          for (const id of m.statistic_ids) {
            out[id] = [];
            if (m.period === 'hour') for (let i = 0; i < 3; i++) out[id].push({ start: from + i * H, end: from + (i + 1) * H, change: id.includes('import') ? 1 : 0.5 });
            else out[id].push({ start: from, end: from + 300000, mean: 1000 });
          }
          return ok(out);
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
  const wss = fakeHA(0);
  wss.on('listening', async () => {
    process.env.HA_WS_URL = `ws://127.0.0.1:${wss.address().port}`;
    process.env.SUPERVISOR_TOKEN = 'preview';
    process.env.ED_ALLOW_ANY_CLIENT = '1';
    process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'ed-preview-'));
    await require('../energy_dashboard/app/server').start(Number(process.env.PORT) || 8099);
    console.log('Preview on http://127.0.0.1:' + (process.env.PORT || 8099), 'data in', process.env.DATA_DIR);
  });
}
