'use strict';

// The coloured edge: a smooth scale from green (cheap) via yellow to red
// (expensive), compared with a reference (an average of prices).
//
// band: how far from the reference (as a fraction, 0.25 = 25 %) the colour is
// fully green or fully red.

const GREEN_HUE = 145;
const MID_HUE = 55;
const RED_HUE = 0;

function deviation(price, reference) {
  if (!Number.isFinite(price) || !Number.isFinite(reference)) return null;
  if (Math.abs(reference) < 1e-9) return price > 0 ? Infinity : price < 0 ? -Infinity : 0;
  return (price - reference) / Math.abs(reference);
}

// -1 (fully cheap) … 0 (average) … +1 (fully expensive)
function level(price, reference, band) {
  const d = deviation(price, reference);
  if (d === null) return null;
  const b = Math.max(0.01, Number(band) || 0.25);
  return Math.max(-1, Math.min(1, d / b));
}

function hueFor(lv) {
  if (lv === null) return null;
  return lv < 0 ? MID_HUE + (-lv) * (GREEN_HUE - MID_HUE) : MID_HUE - lv * (MID_HUE - RED_HUE);
}

function colorFor(price, reference, band) {
  const lv = level(price, reference, band);
  if (lv === null) return { level: null, hue: null, css: '#6b7785' };
  const hue = hueFor(lv);
  return { level: lv, hue: Math.round(hue), css: `hsl(${Math.round(hue)} 82% 50%)` };
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

module.exports = { deviation, level, hueFor, colorFor, reference, bestBlock, GREEN_HUE, MID_HUE, RED_HUE };
