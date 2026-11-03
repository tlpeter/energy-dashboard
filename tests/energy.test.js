'use strict';

const test = require('node:test');
const assert = require('node:assert');
const energy = require('../energy_dashboard/app/energy');
const settings = require('../energy_dashboard/app/settings');

const H = 3600000;
const W = (v) => ({ state: String(v), attributes: { unit_of_measurement: 'W' } });

test('flows: home = grid + solar − battery charging; rest excludes devices', () => {
  const s = settings.validate({
    meter: { power_net: 'sensor.grid' },
    modules: [
      { id: 'pv', type: 'solar', name: 'PV', power_entity: 'sensor.pv' },
      { id: 'bat', type: 'battery', name: 'Bat', power_entity: 'sensor.bat', soc_entity: 'sensor.soc' },
      { id: 'car', type: 'ev', name: 'Car', power_entity: 'sensor.car' },
    ],
  });
  const st = { 'sensor.grid': W(-500), 'sensor.pv': W(3000), 'sensor.bat': W(1000), 'sensor.soc': { state: '55', attributes: {} }, 'sensor.car': W(1200) };
  const f = energy.flows(s, (id) => st[id] || null);
  assert.strictEqual(f.home_w, 1500);
  assert.strictEqual(f.rest_w, 300);
  assert.strictEqual(f.solar_w, 3000);
  assert.strictEqual(f.battery_w, 1000);
  assert.strictEqual(f.modules.find((m) => m.id === 'bat').soc, 55);
});

test('flows without meter data do not invent a home value', () => {
  const s = settings.validate({ meter: { power_net: 'sensor.grid' } });
  const f = energy.flows(s, () => null);
  assert.strictEqual(f.grid, null);
  assert.strictEqual(f.home_w, null);
});

test('hourly statistics: tariffs summed, both timestamp formats', () => {
  const meter = { energy_import: ['sensor.t1', 'sensor.t2'], energy_export: ['sensor.e'] };
  const stats = {
    'sensor.t1': [{ start: 0, end: H, change: 0.5 }],
    'sensor.t2': [{ start: new Date(0).toISOString(), end: new Date(H).toISOString(), change: 0.25 }, { start: H, change: 1 }],
    'sensor.e': [{ start: H, change: 0.4 }],
  };
  const h = energy.hourly(stats, meter, 0, 3 * H);
  assert.deepStrictEqual(h.map((x) => [x.import, x.export, x.known]), [[0.75, 0, true], [1, 0.4, true], [0, 0, false]]);
});

test('costs: import × hourly average, export with net metering', () => {
  const price = settings.validate({ price: { compare_tariff: 0.30, export_mode: 'net_metering' } }).price;
  const list = [
    { start: 0, end: H / 2, total: 0.2, raw: 0.1 },
    { start: H / 2, end: H, total: 0.4, raw: 0.2 },
  ];
  const c = energy.costs([{ start: 0, import: 2, export: 1, known: true }], list, price);
  assert.ok(Math.abs(c.cost - (2 * 0.3 - 1 * 0.3)) < 1e-9);
  assert.ok(Math.abs(c.saving - ((2 - 1) * 0.30 - c.cost)) < 1e-9);
});

test('costs: hours without a price are reported, not counted as free', () => {
  const price = settings.validate({ price: { compare_tariff: 0.30 } }).price;
  const c = energy.costs([{ start: 0, import: 2, export: 0, known: true }], [], price);
  assert.strictEqual(c.unpriced_kwh, 2);
  assert.strictEqual(c.saving, null);
});

test('export at market price (after net metering)', () => {
  const price = settings.validate({ price: { price_type: 'market_excl_vat', export_mode: 'market', export_fee_incl_vat: -0.02 } }).price;
  const p = { total: 0.3, raw: 0.1 };
  assert.ok(Math.abs(energy.exportPrice(p, price, 'market') - (0.1 * 1.21 - 0.02)) < 1e-9);
});

test('price view: colours, current price, cheapest block, breakdown', () => {
  const s = settings.validate({ price: { price_type: 'market_excl_vat', fee_incl_vat: 0.0242, energy_tax_incl_vat: 0.11085 } });
  const base = Date.UTC(2026, 10, 2, 0);
  const raw = [0.1, 0.05, 0.02, 0.03, 0.2, 0.3];
  const result = {
    interval_minutes: 60,
    window: { start: base, tomorrow: base + 6 * H, end: base + 12 * H },
    prices: raw.map((p, i) => ({ start: base + i * H, end: base + (i + 1) * H, price: p })),
  };
  const v = energy.priceView(result, s, base + 2.5 * H);
  assert.strictEqual(v.current.raw, 0.02);
  assert.ok(v.now_level < 0, 'cheap hour is on the green side');
  assert.strictEqual(v.today.cheap.start, base + 2 * H);
  assert.ok(Math.abs(v.breakdown.market + v.breakdown.fee + v.breakdown.tax + v.breakdown.vat - v.current.total) < 1e-9);
  assert.strictEqual(v.tomorrow, null);
});

test('solar forecast is summed per hour over entries', () => {
  const iso = (h) => new Date(Date.UTC(2026, 10, 2, h)).toISOString();
  const f = { a: { wh_hours: { [iso(10)]: 500, [iso(11)]: 800 } }, b: { wh_hours: { [iso(10)]: 100 } } };
  assert.deepStrictEqual(energy.solarHours(f).map((x) => x.wh), [600, 800]);
});

test('planners: only the apps\' own sensors', () => {
  const p = energy.planners([
    { entity_id: 'sensor.smart_charging_status', state: 'Charging', attributes: { friendly_name: 'Status' } },
    { entity_id: 'sensor.other', state: '1', attributes: {} },
  ]);
  assert.strictEqual(p.charging_planner.length, 1);
  assert.strictEqual(p.heating_planner, null);
});

test('plausibility: a source that is already all-in is flagged (#4)', () => {
  const base = Date.UTC(2026, 10, 2, 0);
  const mk = (raw) => ({ interval_minutes: 60, window: { start: base, tomorrow: base + 24 * H, end: base + 48 * H }, prices: raw.map((p, i) => ({ start: base + i * H, end: base + (i + 1) * H, price: p })) });
  const allInValues = Array.from({ length: 24 }, (_, i) => 0.37 + (i % 6) * 0.02);
  const incl = settings.validate({ price: { price_type: 'market_incl_vat', fee_incl_vat: 0.018 } });
  assert.strictEqual(energy.priceView(mk(allInValues), incl, base + H).plausibility.code, 'looks_all_in');
  const marketValues = Array.from({ length: 24 }, (_, i) => 0.06 + (i % 6) * 0.02);
  assert.strictEqual(energy.priceView(mk(marketValues), incl, base + H).plausibility, null);
  const allIn = settings.validate({ price: { price_type: 'all_in' } });
  assert.strictEqual(energy.priceView(mk(allInValues), allIn, base + H).plausibility, null);
});

test('every price slot has its own build-up (#5)', () => {
  const s = settings.validate({ price: { price_type: 'market_excl_vat', fee_incl_vat: 0.0242, energy_tax_incl_vat: 0.11085 } });
  const base = Date.UTC(2026, 10, 2, 0);
  const result = { interval_minutes: 60, window: { start: base, tomorrow: base + 2 * H, end: base + 4 * H }, prices: [0.1, 0.2, 0.05, 0.3].map((p, i) => ({ start: base + i * H, end: base + (i + 1) * H, price: p })) };
  const v = energy.priceView(result, s, base + 0.5 * H);
  for (const p of v.prices) {
    const b = p.parts;
    assert.strictEqual(b.market, p.raw);
    assert.ok(Math.abs(b.market + b.fee + b.tax + b.vat - p.total) < 1e-9);
  }
  assert.notStrictEqual(v.prices[3].parts.total, v.breakdown.total);
});

test('fixed limits colour the prices regardless of the average (#7)', () => {
  const base = Date.UTC(2026, 10, 3, 0);
  const result = { interval_minutes: 60, window: { start: base, tomorrow: base + 24 * H, end: base + 48 * H }, prices: Array.from({ length: 24 }, (_, i) => ({ start: base + i * H, end: base + (i + 1) * H, price: 0.40 + i * 0.001 })) };
  const s = settings.validate({ price: { price_type: 'all_in' }, edge: { mode: 'fixed', green_below: 0.25, red_above: 0.35 } });
  const v = energy.priceView(result, s, base);
  assert.strictEqual(v.now_level, 1, '€ 0.40 is red with these limits, even at the lowest of the day');
  const avg = energy.priceView(result, settings.validate({ price: { price_type: 'all_in' } }), base);
  assert.ok(avg.now_level < 0, 'compared with the average it is the cheap side');
});

test('fixed limits: red must be above green', () => {
  assert.throws(() => settings.validate({ edge: { mode: 'fixed', green_below: 0.4, red_above: 0.3 } }), /higher/);
});

test('smooth: bars carry neighbour colours and the edge moves towards the next hour (#9)', () => {
  const base = Date.UTC(2026, 10, 3, 0);
  const result = { interval_minutes: 60, window: { start: base, tomorrow: base + 3 * H, end: base + 6 * H }, prices: [0.20, 0.30, 0.40].map((p, i) => ({ start: base + i * H, end: base + (i + 1) * H, price: p })) };
  const s = settings.validate({ price: { price_type: 'all_in' }, edge: { mode: 'fixed', green_below: 0.2, red_above: 0.4 } });
  const v = energy.priceView(result, s, base + 1.5 * H);
  assert.strictEqual(v.prices[0].color_left, v.prices[0].color, 'first bar has no neighbour on the left');
  assert.notStrictEqual(v.prices[1].color_left, v.prices[1].color);
  assert.strictEqual(v.now_color, v.prices[1].color, 'in the middle of the hour: its own colour');
  const late = energy.priceView(result, s, base + 1.9 * H);
  assert.notStrictEqual(late.now_color, late.prices[1].color, 'later in the hour: towards the next');
  const off = energy.priceView(result, settings.validate({ price: { price_type: 'all_in' }, edge: { mode: 'fixed', green_below: 0.2, red_above: 0.4, smooth: false } }), base + 1.9 * H);
  assert.strictEqual(off.now_color, off.prices[1].color);
});
