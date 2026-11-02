'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ha = require('../energy_dashboard/app/ha');

test('only read commands are allowed', () => {
  assert.ok(ha.isAllowed({ type: 'get_states' }, null));
  assert.ok(!ha.isAllowed({ type: 'call_service', domain: 'switch', service: 'turn_on' }, null));
  assert.ok(!ha.isAllowed({ type: 'call_service', domain: 'energyzero', service: 'get_energy_prices' }, null), 'needs the internal token');
  assert.ok(!ha.isAllowed({ type: 'config/entity_registry/update' }, null));
  assert.ok(!ha.isAllowed({ type: 'execute_script' }, null));
});

test('call refuses a write even when connected state is faked', async () => {
  ha.state.connected = true;
  await assert.rejects(ha.call({ type: 'call_service', domain: 'light', service: 'turn_on' }), /only reads/);
  ha.state.connected = false;
});

test('callAction refuses actions that are not on the price list', async () => {
  await assert.rejects(ha.callAction('switch', 'turn_on', {}), /not allowed/);
});

test('compressed entity updates are applied', () => {
  ha._live.clear();
  ha.applyCompressed({ a: { 'sensor.x': { s: '5', a: { unit_of_measurement: 'W' }, lc: 1 } } });
  ha.applyCompressed({ c: { 'sensor.x': { '+': { s: '7', lc: 2 } } } });
  assert.strictEqual(ha.liveState('sensor.x').state, '7');
  assert.strictEqual(ha.liveState('sensor.x').attributes.unit_of_measurement, 'W');
  ha.applyCompressed({ r: ['sensor.x'] });
  assert.strictEqual(ha.liveState('sensor.x'), null);
});
