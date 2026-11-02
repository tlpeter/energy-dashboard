'use strict';

const test = require('node:test');
const assert = require('node:assert');
const c = require('../energy_dashboard/app/colors');

test('average is yellow, far below green, far above red', () => {
  assert.strictEqual(c.colorFor(0.25, 0.25, 0.25).hue, c.MID_HUE);
  assert.strictEqual(c.colorFor(0.10, 0.25, 0.25).hue, c.GREEN_HUE);
  assert.strictEqual(c.colorFor(0.50, 0.25, 0.25).hue, c.RED_HUE);
});

test('smooth in between and clamped', () => {
  const half = c.colorFor(0.25 * 1.125, 0.25, 0.25); // +12.5 % with a 25 % band = halfway to red
  assert.ok(Math.abs(half.level - 0.5) < 1e-9);
  assert.strictEqual(c.level(9, 0.25, 0.25), 1);
  assert.strictEqual(c.level(-9, 0.25, 0.25), -1);
});

test('missing price gives a neutral colour, not green', () => {
  const x = c.colorFor(null, 0.25, 0.25);
  assert.strictEqual(x.level, null);
});

test('negative and zero reference do not crash', () => {
  assert.strictEqual(c.level(-0.05, 0, 0.25), -1);
  assert.strictEqual(c.level(0.05, -0.02, 0.25), 1);
});

test('reference is time-weighted (15-minute and hourly mixed)', () => {
  const H = 3600000;
  const list = [
    { start: 0, end: H, total: 0.2 },
    { start: H, end: H + H / 4, total: 1.0 },
  ];
  const ref = c.reference(list, 'today_tomorrow', 0, 10 * H);
  assert.ok(Math.abs(ref - (0.2 * 4 + 1.0) / 5) < 1e-9);
});

test('reference modes', () => {
  const H = 3600000;
  const list = [];
  for (let i = 0; i < 48; i++) list.push({ start: i * H, end: (i + 1) * H, total: i < 24 ? 0.2 : 0.4 });
  assert.ok(Math.abs(c.reference(list, 'today', 0, 24 * H) - 0.2) < 1e-9);
  assert.ok(Math.abs(c.reference(list, 'today_tomorrow', 0, 24 * H) - 0.3) < 1e-9);
  assert.ok(Math.abs(c.reference(list, 'next24', 12 * H, 24 * H) - 0.3) < 1e-9);
});

test('cheapest block of two hours', () => {
  const H = 3600000;
  const totals = [0.3, 0.2, 0.1, 0.12, 0.4, 0.5];
  const list = totals.map((t, i) => ({ start: i * H, end: (i + 1) * H, total: t }));
  const b = c.bestBlock(list, 2, 0, 6 * H, true);
  assert.strictEqual(b.start, 2 * H);
  const d = c.bestBlock(list, 2, 0, 6 * H, false);
  assert.strictEqual(d.start, 4 * H);
});

test('a block does not jump over a gap', () => {
  const H = 3600000;
  const list = [{ start: 0, end: H, total: 0.01 }, { start: 3 * H, end: 4 * H, total: 0.01 }, { start: 4 * H, end: 5 * H, total: 0.3 }];
  const b = c.bestBlock(list, 2, 0, 5 * H, true);
  assert.strictEqual(b.start, 3 * H);
});
