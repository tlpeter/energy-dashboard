'use strict';

// The coloured edge: a smooth scale from green (cheap) via yellow to red
// (expensive), compared with a reference (an average of prices).
//
// band: how far from the reference (as a fraction, 0.25 = 25 %) the colour is
// fully green or fully red.

// Default colours (#8): the green, yellow and red of the first versions;
// purple for "very expensive" and blue for negative prices, both off by default.
const DEFAULT_COLORS = {
  cheap: '#17e86e',
  mid: '#e8d717',
  expensive: '#e81717',
  very: '#a855f7',
  negative: '#3b82f6',
};
const NEUTRAL = '#6b7785';

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Mixing in OKLab (#9): tints in between stay clear instead of turning
// muddy, which happens when sRGB values are simply averaged.
const toLin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v) => { const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, c)) * 255); };
function rgbToOklab([r, g, b]) {
  const [lr, lg, lb] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
function mix(a, b, f) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return a || b;
  if (f <= 0) return `#${x.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  if (f >= 1) return `#${y.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const p = rgbToOklab(x);
  const q = rgbToOklab(y);
  const c = oklabToRgb(p.map((v, i) => v + (q[i] - v) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// palette: { cheap, mid, expensive, very, negative, use_very, use_negative }
function paletteOf(p) {
  const x = p || {};
  const pick = (k) => (hexToRgb(x[k]) ? String(x[k]).toLowerCase() : DEFAULT_COLORS[k]);
  return { cheap: pick('cheap'), mid: pick('mid'), expensive: pick('expensive'), very: pick('very'), negative: pick('negative'), use_very: x.use_very === true, use_negative: x.use_negative === true };
}

// level: -1 cheap … 0 middle … 1 expensive … 2 very expensive.
function colorAt(lv, palette) {
  const p = paletteOf(palette);
  if (lv === null || !Number.isFinite(lv)) return NEUTRAL;
  if (lv <= 0) return mix(p.mid, p.cheap, Math.min(1, -lv));
  if (lv <= 1) return mix(p.mid, p.expensive, lv);
  return p.use_very ? mix(p.expensive, p.very, Math.min(1, lv - 1)) : p.expensive;
}

function deviation(price, reference) {
  if (!Number.isFinite(price) || !Number.isFinite(reference)) return null;
  if (Math.abs(reference) < 1e-9) return price > 0 ? Infinity : price < 0 ? -Infinity : 0;
  return (price - reference) / Math.abs(reference);
}

// -1 (fully cheap) … 0 (average) … +1 (fully expensive) … +2 (very, if used)
function level(price, reference, band, maxLevel = 1) {
  const d = deviation(price, reference);
  if (d === null) return null;
  const b = Math.max(0.01, Number(band) || 0.25);
  return Math.max(-1, Math.min(maxLevel, d / b));
}

function result(price, lv, palette) {
  const p = paletteOf(palette);
  if (lv === null) return { level: null, negative: false, css: NEUTRAL };
  if (p.use_negative && Number.isFinite(price) && price < 0) return { level: -1, negative: true, css: p.negative };
  return { level: lv, negative: false, css: colorAt(lv, p) };
}

// Compared with the average; "very expensive" at twice the red distance.
function colorFor(price, reference, band, palette) {
  const p = paletteOf(palette);
  return result(price, level(price, reference, band, p.use_very ? 2 : 1), p);
}

// Fixed limits (#7): fully green at or below `low`, fully red at or above
// `high`, a smooth scale in between (yellow halfway); with "very expensive"
// on, red goes on to that colour at `veryAbove` (#8).
function levelFixed(price, low, high, veryAbove = null) {
  if (!Number.isFinite(price) || !Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  if (price > high && Number.isFinite(veryAbove) && veryAbove > high) return Math.min(2, 1 + (price - high) / (veryAbove - high));
  const mid = (low + high) / 2;
  return Math.max(-1, Math.min(1, (price - mid) / ((high - low) / 2)));
}

function colorFixed(price, low, high, palette, veryAbove = null) {
  const p = paletteOf(palette);
  return result(price, levelFixed(price, low, high, p.use_very ? veryAbove : null), p);
}

// The reference the edge compares with.
//  today: average of today; today_tomorrow: today + tomorrow (when known);
//  next24: the coming 24 hours from now.
function reference(prices, mode, now, tomorrowStart) {
  const list = (prices || []).filter((p) => Number.isFinite(p.total));
  let pick;
  if (mode === 'today') pick = list.filter((p) => p.start < tomorrowStart);
  else if (mode === 'next24') pick = list.filter((p) => p.end > now && p.start < now + 86400000);
  else pick = list;
  if (!pick.length) pick = list;
  if (!pick.length) return null;
  // time-weighted: 15-minute and hourly prices count by their length
  let sum = 0;
  let len = 0;
  for (const p of pick) {
    const d = Math.max(1, p.end - p.start);
    sum += p.total * d;
    len += d;
  }
  return sum / len;
}

// Cheapest (or most expensive) block of `hours` length in a list of prices.
function bestBlock(prices, hours, from, to, cheapest = true) {
  const list = (prices || []).filter((p) => p.start >= from && p.end <= to && Number.isFinite(p.total))
    .sort((a, b) => a.start - b.start);
  const span = hours * 3600000;
  let best = null;
  for (let i = 0; i < list.length; i++) {
    const start = list[i].start;
    let sum = 0;
    let len = 0;
    let ok = true;
    let j = i;
    let cursor = start;
    while (len < span) {
      const p = list[j];
      if (!p || p.start > cursor + 1000) { ok = false; break; }
      const take = Math.min(p.end - p.start, span - len);
      sum += p.total * take;
      len += take;
      cursor = p.end;
      j++;
    }
    if (!ok) continue;
    const avg = sum / len;
    if (!best || (cheapest ? avg < best.average : avg > best.average)) best = { start, end: start + span, average: avg };
  }
  return best;
}

module.exports = { deviation, level, levelFixed, colorFixed, colorFor, colorAt, paletteOf, mix, reference, bestBlock, DEFAULT_COLORS, NEUTRAL };
