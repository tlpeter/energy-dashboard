'use strict';

const test = require('node:test');
const assert = require('node:assert');
const meters = require('../energy_dashboard/app/meters');
const { P1 } = require('./fixtures');

for (const [name, fx] of Object.entries(P1)) {
  test(`P1 detection: ${name}`, () => {
    const found = meters.detectMeters(fx.entities, []);
    assert.strictEqual(found.length, 1, `exactly one ${name} meter`);
    const m = found[0];
    assert.strictEqual(m.meter, name);
    const r = m.roles;
    const e = fx.expect;
    if (e.power_net) assert.strictEqual(r.power_net, e.power_net);
    if (e.power_import) assert.strictEqual(r.power_import, e.power_import);
    if (e.power_export) assert.strictEqual(r.power_export, e.power_export);
    assert.deepStrictEqual(r.energy_import, e.energy_import);
    assert.deepStrictEqual(r.energy_export, e.energy_export);
    if (e.gas) assert.strictEqual(r.gas, e.gas);
    if (e.phases) assert.deepStrictEqual(r.phases.map((p) => p.net), e.phases);
    if (e.phase_import) assert.deepStrictEqual(r.phases.map((p) => p.import).filter(Boolean), e.phase_import);
    // never import and export on the same sensor
    if (r.power_import && r.power_export) assert.notStrictEqual(r.power_import, r.power_export);
  });
}

test('several meters at once are all found', () => {
  const all = Object.values(P1).flatMap((f) => f.entities);
  const found = meters.detectMeters(all, []);
  assert.deepStrictEqual(found.map((m) => m.meter).sort(), Object.keys(P1).sort());
});

test('disabled entities and non-meter devices are ignored', () => {
  const list = P1.homewizard.entities.map((e) => ({ ...e, disabled_by: 'user' }));
  assert.strictEqual(meters.detectMeters(list, []).length, 0);
});

test('grid power: net sensor, kW unit and sign swap', () => {
  const st = { 'sensor.n': { state: '-1.5', attributes: { unit_of_measurement: 'kW' } } };
  const get = (id) => st[id] || null;
  assert.deepStrictEqual(meters.gridPower({ power_net: 'sensor.n', phases: [] }, get), { net_w: -1500, import_w: 0, export_w: 1500, phases_w: null });
  assert.strictEqual(meters.gridPower({ power_net: 'sensor.n', invert_net: true, phases: [] }, get).net_w, 1500);
});

test('grid power: separate import and export', () => {
  const st = {
    'sensor.i': { state: '800', attributes: { unit_of_measurement: 'W' } },
    'sensor.e': { state: '0.2', attributes: { unit_of_measurement: 'kW' } },
    'sensor.l1': { state: '300', attributes: { unit_of_measurement: 'W' } },
  };
  const g = meters.gridPower({ power_import: 'sensor.i', power_export: 'sensor.e', phases: [{ import: 'sensor.l1' }, {}, {}] }, (id) => st[id] || null);
  assert.strictEqual(g.net_w, 600);
  assert.deepStrictEqual(g.phases_w, [300, null, null]);
});

test('grid power: unavailable sensor gives null, not zero', () => {
  const st = { 'sensor.i': { state: 'unavailable', attributes: { unit_of_measurement: 'W' } } };
  assert.strictEqual(meters.gridPower({ power_import: 'sensor.i', phases: [] }, (id) => st[id] || null), null);
});

test('unknown power unit is not guessed', () => {
  assert.strictEqual(meters.powerW('5', 'VA'), null);
  assert.strictEqual(meters.powerW('5', 'kW'), 5000);
});
