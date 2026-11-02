'use strict';

const test = require('node:test');
const assert = require('node:assert');
const gas = require('../energy_dashboard/app/gas');
const settings = require('../energy_dashboard/app/settings');

const H = 3600000;

test('gas sources: EnergyZero/easyEnergy actions and €/m³ sensors', () => {
  const entities = [
    { platform: 'energyzero', entity_id: 'sensor.ez_gas', config_entry_id: 'e1' },
    { platform: 'frank_energie', entity_id: 'sensor.frank_gas_price', config_entry_id: 'f1' },
  ];
  const states = [
    { entity_id: 'sensor.frank_gas_price', state: '1.32', attributes: { unit_of_measurement: '€/m³', friendly_name: 'Gas price' } },
    { entity_id: 'sensor.template_gas', state: '0.48', attributes: { unit_of_measurement: 'EUR/m3' } },
    { entity_id: 'sensor.power', state: '5', attributes: { unit_of_measurement: 'W' } },
  ];
  const list = gas.detectGasSources(entities, states, { energyzero: { get_gas_prices: {} } });
  assert.deepStrictEqual(list.map((x) => x.id), ['gas:action:energyzero:e1', 'gas:state:sensor.frank_gas_price', 'gas:state:sensor.template_gas']);
  assert.strictEqual(list[1].price_type, 'all_in', 'supplier integration is all-in');
  assert.strictEqual(list[2].price_type, 'market_excl_vat');
  assert.strictEqual(gas.detectGasSources(entities, states, {}).filter((x) => x.type === 'action').length, 0, 'no action without the service');
});

test('gas settings: validated; fixed price needs a value and is all-in', () => {
  assert.throws(() => settings.validate({ price: { gas: { source: { type: 'fixed' } } } }), /fill in a price/);
  const s = settings.validate({ price: { gas: { source: { type: 'fixed', price: '1,35' }, price_type: 'market_excl_vat' } } });
  assert.strictEqual(s.price.gas.source.price, 1.35);
  assert.strictEqual(s.price.gas.price_type, 'all_in');
  assert.strictEqual(s.price.gas.energy_tax_incl_vat, 0.7268);
  assert.throws(() => settings.validate({ price: { gas: { source: { type: 'action', domain: 'switch', config_entry: 'x' } } } }), /invalid integration/);
  assert.strictEqual(settings.validate({}).price.gas, null);
});

test('gas all-in: market excl. VAT + fee + tax, then VAT', () => {
  const g = settings.validate({ price: { gas: { source: { type: 'state', entity_id: 'sensor.g' }, price_type: 'market_excl_vat', fee_incl_vat: 0.0591 } } }).price.gas;
  const v = gas.gasView({ prices: [{ start: 0, end: 24 * H, price: 0.45 }] }, g, 12 * H);
  assert.ok(Math.abs(v.current.total - (0.45 * 1.21 + 0.0591 + 0.7268)) < 1e-9);
  const p = v.current.parts;
  assert.ok(Math.abs(p.market + p.fee + p.tax + p.vat - p.total) < 1e-9);
  assert.strictEqual(v.plausibility, null);
});

test('gas plausibility: an all-in price set as market price is flagged', () => {
  const g = settings.validate({ price: { gas: { source: { type: 'state', entity_id: 'sensor.g' }, price_type: 'market_excl_vat' } } }).price.gas;
  const v = gas.gasView({ prices: [{ start: 0, end: H, price: 1.35 }] }, g, H / 2);
  assert.strictEqual(v.plausibility.code, 'looks_all_in');
});

test('gas costs: m³ per hour × price; one daily price covers the day', () => {
  const g = settings.validate({ price: { gas: { source: { type: 'fixed', price: 1.4 } } } }).price.gas;
  const list = gas.withTotals([{ start: 0, end: 6 * H, price: 1.4 }], g);
  const c = gas.gasCosts([{ start: 0, change: 0.5 }, { start: H, change: 0.25 }], list, 0, 4 * H);
  assert.strictEqual(c.m3, 0.75);
  assert.ok(Math.abs(c.cost - 0.75 * 1.4) < 1e-9);
  assert.strictEqual(c.unpriced_m3, 0);
});

test('gas costs: the last known price is used for later hours, but not forever', () => {
  const list = [{ start: 0, end: H, total: 1.3 }];
  assert.strictEqual(gas.slotAt(list, 5 * H).total, 1.3);
  assert.strictEqual(gas.slotAt(list, 40 * H), null);
  const c = gas.gasCosts([{ start: 40 * H, change: 1 }], list, 40 * H, 41 * H);
  assert.strictEqual(c.unpriced_m3, 1);
});

test('the gas actions are on the read-only list', () => {
  const ha = require('../energy_dashboard/app/ha');
  assert.ok(ha.READ_ONLY_ACTIONS.has('energyzero.get_gas_prices'));
  assert.ok(ha.READ_ONLY_ACTIONS.has('easyenergy.get_gas_prices'));
});
