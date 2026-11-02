'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-settings-'));
const settings = require('../energy_dashboard/app/settings');
const sup = require('../energy_dashboard/app/suppliers');

test('empty settings get safe defaults', () => {
  const s = settings.validate({});
  assert.strictEqual(s.wizard_done, false);
  assert.strictEqual(s.meter, null);
  assert.strictEqual(s.edge.band, 25);
  assert.strictEqual(s.price.vat_percent, 21);
  assert.deepStrictEqual(s.modules, []);
});

test('a meter needs a grid power sensor', () => {
  assert.throws(() => settings.validate({ meter: { meter: 'manual' } }), /grid power/);
  const s = settings.validate({ meter: { meter: 'homewizard', power_net: 'sensor.a', energy_import: ['sensor.b'] } });
  assert.strictEqual(s.meter.power_net, 'sensor.a');
  assert.strictEqual(s.meter.phases.length, 3);
});

test('entity ids are checked', () => {
  assert.throws(() => settings.validate({ meter: { power_net: 'sensor.a; DROP' } }), /not an entity id/);
  assert.throws(() => settings.validate({ modules: [{ type: 'ev', name: 'Car' }] }), /choose a sensor/);
});

test('odd values are refused, unknown keys dropped', () => {
  assert.throws(() => settings.validate({ edge: { band: 500 } }), /between/);
  const s = settings.validate({ language: 'fr', hack: 1, tiles: ['cost', 'cost', 'evil'] });
  assert.strictEqual(s.language, 'auto');
  assert.strictEqual(s.hack, undefined);
  assert.deepStrictEqual(s.tiles, ['cost']);
});

test('module names cannot carry HTML', () => {
  const s = settings.validate({ modules: [{ type: 'device', name: '<img src=x onerror=alert(1)>', power_entity: 'sensor.p' }] });
  assert.ok(!/[<>]/.test(s.modules[0].name));
});

test('save and load round trip', () => {
  const saved = settings.save({ wizard_done: true, language: 'nl', price: { supplier: 'tibber', fee_incl_vat: 0.0248 } });
  const loaded = settings.load();
  assert.deepStrictEqual(loaded, saved);
  assert.strictEqual(loaded.price.supplier, 'tibber');
});

test('comma decimals are accepted', () => {
  const s = settings.validate({ price: { fee_incl_vat: '0,0182' } });
  assert.strictEqual(s.price.fee_incl_vat, 0.0182);
});

test('every supplier has a preset; known fees are plausible', () => {
  for (const s of sup.SUPPLIERS) {
    const p = sup.presetFor(s.id);
    assert.strictEqual(p.supplier, s.id);
    if (s.fee !== null) assert.ok(s.fee > 0 && s.fee < 0.1, `${s.id} fee`);
  }
  assert.strictEqual(new Set(sup.SUPPLIERS.map((s) => s.id)).size, sup.SUPPLIERS.length);
});

test('all-in price: market excl. VAT + fee + tax, then VAT', () => {
  const prices = require('../energy_dashboard/app/prices');
  const cfg = sup.toPriceCfg({ price_type: 'market_excl_vat', fee_incl_vat: 0.0242, energy_tax_incl_vat: 0.11085, vat_percent: 21 });
  const total = prices.totalPrice(0.10, cfg);
  assert.ok(Math.abs(total - (0.10 * 1.21 + 0.0242 + 0.11085)) < 1e-9);
  const allIn = sup.toPriceCfg({ price_type: 'all_in', fee_incl_vat: 0.02 });
  assert.strictEqual(prices.totalPrice(0.31, allIn), 0.31);
});

test('net metering until the end of 2026, market price after', () => {
  const p = { export_mode: 'auto' };
  assert.strictEqual(settings.exportMode(p, Date.UTC(2026, 10, 2)), 'net_metering');
  assert.strictEqual(settings.exportMode(p, Date.UTC(2027, 0, 1, 12)), 'market');
  assert.strictEqual(settings.exportMode({ export_mode: 'market' }, Date.UTC(2026, 5, 1)), 'market');
});
