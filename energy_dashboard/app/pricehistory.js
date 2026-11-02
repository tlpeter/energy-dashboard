'use strict';

// Price history: every price the app fetches is kept here, so past charging
// sessions can be valued later. Stored per price source, as the source price
// (before purchase fee, energy tax and VAT); those are added when used.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'price_history.json');
const KEEP_DAYS = 400;

let data = null; // { [sourceId]: { [startMs]: [endMs, price] } }
let dirty = false;

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    data = {};
  }
  return data;
}

function save() {
  if (!dirty) return;
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const src of Object.values(data)) {
    for (const k of Object.keys(src)) if (Number(k) < cutoff) delete src[k];
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
  dirty = false;
}

function record(sourceId, prices) {
  load();
  const src = data[sourceId] || (data[sourceId] = {});
  for (const p of prices) {
    if (!Number.isFinite(p.start) || !Number.isFinite(p.price)) continue;
    const prev = src[p.start];
    if (!prev || prev[1] !== p.price || prev[0] !== p.end) {
      src[p.start] = [p.end, p.price];
      dirty = true;
    }
  }
  save();
}

// Prices of a source between from and to: [{start, end, price}] sorted.
function range(sourceId, from, to) {
  load();
  const src = data[sourceId] || {};
  return Object.entries(src)
    .map(([k, [end, price]]) => ({ start: Number(k), end, price }))
    .filter((p) => p.start >= from && p.start < to)
    .sort((a, b) => a.start - b.start);
}

// Which local days (start ms) in the list have no prices yet.
function missingDays(sourceId, dayStarts) {
  load();
  const src = data[sourceId] || {};
  const starts = Object.keys(src).map(Number);
  return dayStarts.filter(([from, to]) => !starts.some((s) => s >= from && s < to));
}

module.exports = { record, range, missingDays };
