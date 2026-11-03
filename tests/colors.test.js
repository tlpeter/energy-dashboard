'use strict';

const test = require('node:test');
const assert = require('node:assert');
const c = require('../energy_dashboard/app/colors');

const D = c.DEFAULT_COLORS;

test('average is yellow, far below green, far above red', () => {
  assert.strictEqual(c.colorFor(0.25, 0.25, 0.25).css, D.mid);
  assert.strictEqual(c.colorFor(0.10, 0.25, 0.25).css, D.cheap);
  assert.strictEqual(c.colorFor(0.50, 0.25, 0.25).css, D.expensive);
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

test('fixed limits: green at or below, red at or above, smooth between (#7)', () => {
  assert.strictEqual(c.colorFixed(0.20, 0.25, 0.35).css, D.cheap);
  assert.strictEqual(c.colorFixed(0.25, 0.25, 0.35).css, D.cheap);
  assert.strictEqual(c.colorFixed(0.30, 0.25, 0.35).css, D.mid);
  assert.strictEqual(c.colorFixed(0.40, 0.25, 0.35).css, D.expensive);
  assert.ok(Math.abs(c.levelFixed(0.325, 0.25, 0.35) - 0.5) < 1e-9);
  assert.strictEqual(c.colorFixed(0.3, 0.35, 0.25).level, null, 'wrong order gives no colour');
});

test('own colours and a smooth mix between them (#8)', () => {
  const pal = { cheap: '#0000ff', mid: '#ffffff', expensive: '#000000' };
  assert.strictEqual(c.colorFixed(0.10, 0.2, 0.4, pal).css, '#0000ff');
  assert.strictEqual(c.colorFixed(0.35, 0.2, 0.4, pal).css, c.mix('#ffffff', '#000000', 0.5));
  assert.strictEqual(c.colorAt(0, {}), D.mid, 'invalid or missing colours fall back to the defaults');
});

test('very expensive: purple above the third limit, off by default (#8)', () => {
  const on = { use_very: true };
  assert.strictEqual(c.colorFixed(0.60, 0.25, 0.35, {}, 0.45).css, D.expensive, 'off: stays red');
  assert.strictEqual(c.colorFixed(0.45, 0.25, 0.35, on, 0.45).css, D.very);
  assert.strictEqual(c.colorFixed(0.40, 0.25, 0.35, on, 0.45).css, c.mix(D.expensive, D.very, 0.5));
  assert.strictEqual(c.colorFixed(0.35, 0.25, 0.35, on, 0.45).css, D.expensive);
  // compared with the average: purple at twice the red distance
  assert.strictEqual(c.colorFor(0.50, 0.25, 0.5, on).css, D.very);
  assert.strictEqual(c.colorFor(0.50, 0.25, 0.5, {}).css, D.expensive);
});

test('negative prices: own colour only when switched on (#8)', () => {
  assert.strictEqual(c.colorFixed(-0.02, 0.25, 0.35, { use_negative: true }).css, D.negative);
  assert.strictEqual(c.colorFixed(-0.02, 0.25, 0.35, {}).css, D.cheap);
  assert.strictEqual(c.colorFor(-0.02, 0.25, 0.25, { use_negative: true, negative: '#123456' }).css, '#123456');
});
