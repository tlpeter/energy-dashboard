'use strict';

// Options from the app's Configuration tab in Home Assistant (/data/options.json).
// Everything else is set inside the app (Settings) and stored in /data/settings.json.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DEFAULTS = { log_level: 'info' };

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'options.json'), 'utf8'));
    const merged = { ...DEFAULTS, ...raw };
    if (!['debug', 'info', 'warning', 'error'].includes(merged.log_level)) merged.log_level = 'info';
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { options: load(), DATA_DIR };
