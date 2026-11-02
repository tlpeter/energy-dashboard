'use strict';

// Home Assistant WebSocket client (through the Supervisor).
//
// SAFETY: Energy Dashboard only READS. Every command and every action the app
// may send is on an allowlist below; anything else is refused in code, even
// if another part of the app asks for it. There is no control path at all.

const WebSocket = require('ws');
const { options } = require('./options');

const HA_WS_URL = process.env.HA_WS_URL || 'ws://supervisor/core/websocket';
const TOKEN = process.env.SUPERVISOR_TOKEN || process.env.HA_TOKEN || '';
const RECONNECT_MS = Math.max(50, Number(process.env.ED_RECONNECT_MS) || 10000);

const state = {
  connected: false,
  version: null,
  timeZone: 'UTC',
  currency: 'EUR',
  language: 'en',
  lastError: null,
};

let socket = null;
let nextId = 1;
const pending = new Map();
const connectListeners = [];
const entityListeners = [];

const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 };
const threshold = LEVELS[options.log_level] || LEVELS.info;
const recentLines = [];
function recentLog() { return recentLines.slice(); }
function logAt(level, args) {
  if (LEVELS[level] < threshold) return;
  const line = [new Date().toISOString(), level.toUpperCase(), ...args];
  recentLines.push(line.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  if (recentLines.length > 300) recentLines.shift();
  (level === 'error' || level === 'warning' ? console.error : console.log)(...line);
}
const log = (...a) => logAt('info', a);
const debug = (...a) => logAt('debug', a);
const warn = (...a) => logAt('warning', a);

// SAFETY: the only WebSocket commands the app sends. All of them read.
const READ_ONLY_COMMANDS = new Set([
  'get_states',
  'get_config',
  'config/entity_registry/list',
  'config/device_registry/list',
  'recorder/statistics_during_period',
  'history/history_during_period',
  'get_services',
  'energy/solar_forecast',
  'energy/get_prefs',
  'subscribe_entities',
  'unsubscribe_events',
]);

// SAFETY: actions (services) the app may call. They only return prices.
const READ_ONLY_ACTIONS = new Set([
  'energyzero.get_energy_prices',
  'easyenergy.get_energy_usage_prices',
  'tibber.get_prices',
  'nordpool.get_prices_for_date',
]);
const ACTION_TOKEN = Symbol('read-only action');

function isAllowed(message, token) {
  if (READ_ONLY_COMMANDS.has(message.type)) return true;
  return message.type === 'call_service' && token === ACTION_TOKEN && message.return_response === true &&
    READ_ONLY_ACTIONS.has(`${message.domain}.${message.service}`);
}

function call(message, timeoutMs = 20000, token = null) {
  return new Promise((resolve, reject) => {
    if (!isAllowed(message, token)) {
      warn('Refused command', message.type, message.domain || '', message.service || '', '- not on the read-only list');
      reject(new Error(`Command ${message.type} is not allowed: the app only reads data`));
      return;
    }
    if (!state.connected || !socket) {
      reject(new Error('Not connected to Home Assistant'));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject, message });
    socket.send(JSON.stringify({ id, ...message }));
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Timeout waiting for Home Assistant'));
      }
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });
}

async function callAction(domain, service, serviceData, target = null) {
  const name = `${domain}.${service}`;
  if (!READ_ONLY_ACTIONS.has(name)) {
    warn('Refused action', name);
    throw new Error(`Action ${name} is not allowed: the app only reads data`);
  }
  const message = { type: 'call_service', domain, service, service_data: serviceData, return_response: true };
  if (target) message.target = target;
  const result = await call(message, 20000, ACTION_TOKEN);
  return result && result.response;
}

// Live states of chosen entities (subscribe_entities, compressed format).
let subscriptionId = null;
let subscribedIds = [];
const live = new Map(); // entity_id -> { state, attributes, last_changed }

function applyCompressed(event) {
  const changed = [];
  if (event.a) {
    for (const [id, s] of Object.entries(event.a)) {
      live.set(id, { state: s.s, attributes: s.a || {}, last_changed: (s.lc || 0) * 1000 });
      changed.push(id);
    }
  }
  if (event.c) {
    for (const [id, diff] of Object.entries(event.c)) {
      const cur = live.get(id) || { state: null, attributes: {} };
      const plus = diff['+'] || {};
      const minus = diff['-'] || {};
      const next = { ...cur, attributes: { ...cur.attributes } };
      if ('s' in plus) next.state = plus.s;
      if (plus.a) Object.assign(next.attributes, plus.a);
      if (minus.a) for (const k of minus.a) delete next.attributes[k];
      if (plus.lc) next.last_changed = plus.lc * 1000;
      live.set(id, next);
      changed.push(id);
    }
  }
  if (event.r) for (const id of event.r) { live.delete(id); changed.push(id); }
  return changed;
}

async function watchEntities(ids) {
  const wanted = [...new Set(ids.filter((x) => /^[a-z_]+\.[a-z0-9_]+$/.test(String(x))))].sort();
  if (state.connected && subscriptionId !== null && wanted.join() === subscribedIds.join()) return;
  subscribedIds = wanted;
  if (!state.connected) return;
  if (subscriptionId !== null) {
    const old = subscriptionId;
    subscriptionId = null;
    await call({ type: 'unsubscribe_events', subscription: old }).catch(() => {});
  }
  live.clear();
  if (!wanted.length) return;
  subscriptionId = nextId; // the id call() is about to use; events carry it
  try {
    await call({ type: 'subscribe_entities', entity_ids: wanted });
  } catch (err) {
    subscriptionId = null;
    subscribedIds = [];
    throw err;
  }
  debug('Watching', wanted.length, 'entities');
}

function liveState(entityId) {
  return live.get(entityId) || null;
}

function onConnect(fn) { connectListeners.push(fn); }
function onEntities(fn) { entityListeners.push(fn); }

function connect() {
  if (!TOKEN) {
    state.lastError = 'No SUPERVISOR_TOKEN found. Is homeassistant_api enabled?';
    log(state.lastError);
    return;
  }
  log('Connecting to Home Assistant');
  socket = new WebSocket(HA_WS_URL);
  socket.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'auth_required') {
      socket.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
    } else if (msg.type === 'auth_ok') {
      state.connected = true;
      state.version = msg.ha_version;
      state.lastError = null;
      subscriptionId = null;
      log('Connected to Home Assistant', state.version);
      try {
        const config = await call({ type: 'get_config' });
        state.timeZone = config.time_zone || 'UTC';
        state.currency = config.currency || 'EUR';
        state.language = config.language || 'en';
      } catch (err) {
        warn('Could not read HA config:', err.message);
      }
      for (const fn of connectListeners) Promise.resolve().then(fn).catch((err) => warn('On connect:', err.message));
    } else if (msg.type === 'auth_invalid') {
      state.lastError = 'Authentication failed';
      log(state.lastError);
      socket.close();
    } else if (msg.type === 'event' && msg.id === subscriptionId && msg.event) {
      const changed = applyCompressed(msg.event);
      for (const fn of entityListeners) {
        try { fn(changed); } catch (err) { warn('Entity update failed:', err.message); }
      }
    } else if (msg.type === 'result' && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.success) resolve(msg.result);
      else reject(new Error(msg.error ? msg.error.message : 'Unknown error'));
    }
  });
  socket.on('error', (err) => {
    state.lastError = err.message;
    warn('WebSocket error:', err.message);
  });
  socket.on('close', () => {
    if (state.connected) log('Connection to Home Assistant closed');
    state.connected = false;
    subscriptionId = null;
    for (const { reject } of pending.values()) reject(new Error('Connection closed'));
    pending.clear();
    const again = setTimeout(connect, RECONNECT_MS);
    if (again.unref && process.env.ED_TEST === '1') again.unref();
  });
}

module.exports = {
  state, call, callAction, connect, onConnect, onEntities, watchEntities, liveState, applyCompressed,
  isAllowed, recentLog, log, debug, warn, READ_ONLY_COMMANDS, READ_ONLY_ACTIONS, _live: live,
};
