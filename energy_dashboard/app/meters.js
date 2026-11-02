'use strict';

// Smart meter (P1) detection.
//
// Every supported P1 integration names its sensors differently, and some use
// the same word for opposite directions ("delivered" is import for DSMR Reader
// and the SlimmeLezer, but export for the official DSMR integration). So every
// integration has its own rules. A rule looks at the registry translation_key
// first (the same in every language) and then at the entity id and name.
//
// Result per meter: { power_import, power_export, power_net, energy_import[],
// energy_export[], phases: [{ net|import|export } x3], gas }.

const t = (re) => re; // readability

const METERS = {
  homewizard: {
    name: 'HomeWizard P1',
    platform: 'homewizard',
    rules: {
      power_net: t(/^(active_power_w|active_power|power)$|_power$/),
      phase_net: t(/(?:active_power_l|active_power_phase_?w?_?|power_phase_?)([123])(?:_w)?$/),
      energy_import_total: t(/total_energy_import_kwh$|^total_energy_import$|energy_import$/),
      energy_import_tariff: t(/(?:total_energy_import_t|energy_import_tariff_?)([1-4])(?:_kwh)?$/),
      energy_export_total: t(/total_energy_export_kwh$|^total_energy_export$|energy_export$/),
      energy_export_tariff: t(/(?:total_energy_export_t|energy_export_tariff_?)([1-4])(?:_kwh)?$/),
      gas: t(/total_gas_m3$|^total_gas$|_gas$/),
    },
  },
  dsmr: {
    name: 'DSMR Slimme Meter',
    platform: 'dsmr',
    rules: {
      power_import: t(/current_electricity_usage$/),
      power_export: t(/current_electricity_delivery$/),
      phase_import: t(/instantaneous_active_power_l([123])_positive$/),
      phase_export: t(/instantaneous_active_power_l([123])_negative$/),
      energy_import_total: t(/electricity_imported_total$/),
      energy_import_tariff: t(/electricity_used_tariff_([12])$/),
      energy_export_total: t(/electricity_exported_total$/),
      energy_export_tariff: t(/electricity_delivered_tariff_([12])$/),
      gas: t(/gas_meter_reading$|hourly_gas_meter_reading$/),
    },
  },
  dsmr_reader: {
    name: 'DSMR Reader',
    platform: 'dsmr_reader',
    rules: {
      power_import: t(/electricity_currently_delivered$/),
      power_export: t(/electricity_currently_returned$/),
      phase_import: t(/phase_currently_delivered_l([123])$/),
      phase_export: t(/phase_currently_returned_l([123])$/),
      energy_import_tariff: t(/reading_electricity_delivered_([12])$/),
      energy_export_tariff: t(/reading_electricity_returned_([12])$/),
      gas: t(/reading_extra_device_delivered$|consumption_gas_currently_delivered$/),
    },
  },
  esphome: {
    name: 'SlimmeLezer / ESPHome P1',
    platform: 'esphome',
    perDevice: true,
    rules: {
      power_import: t(/power_(?:delivered|consumed)$/),
      power_export: t(/power_(?:returned|produced)$/),
      phase_import: t(/power_(?:delivered|consumed)_(?:phase_)?l?([123])$/),
      phase_export: t(/power_(?:returned|produced)_(?:phase_)?l?([123])$/),
      energy_import_tariff: t(/energy_(?:delivered|consumed)_tariff_?([12])$/),
      energy_export_tariff: t(/energy_(?:returned|produced)_tariff_?([12])$/),
      gas: t(/gas_(?:delivered|consumed)$/),
    },
  },
  p1_monitor: {
    name: 'P1 Monitor',
    platform: 'p1_monitor',
    rules: {
      power_import: t(/(?:^|_)power_consumption$/),
      power_export: t(/(?:^|_)power_production$/),
      phase_import: t(/power_consumed_phase_l([123])$/),
      phase_export: t(/power_produced_phase_l([123])$/),
      energy_import_tariff: t(/energy_consumption_(high|low)$/),
      energy_export_tariff: t(/energy_production_(high|low)$/),
      gas: t(/gas_consumption$/),
    },
  },
  tibber: {
    name: 'Tibber Pulse',
    platform: 'tibber',
    perDevice: true,
    rules: {
      power_import: t(/(?:^|_)power$/),
      power_export: t(/power_production$/),
      energy_import_total: t(/last_meter_consumption$/),
      energy_export_total: t(/last_meter_production$/),
    },
  },
};

const POWER_UNITS = { w: 1, kw: 1000, mw: 1000000 };
const ENERGY_UNITS = { wh: 0.001, kwh: 1, mwh: 1000 };

function powerW(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const f = POWER_UNITS[String(unit || 'W').toLowerCase()];
  return f ? n * f : null;
}

function energyKwh(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const f = ENERGY_UNITS[String(unit || 'kWh').toLowerCase()];
  return f ? n * f : null;
}

// The texts a rule is matched against: translation key first, then the id
// without "sensor." and the original name in snake case.
function keysOf(reg) {
  const snake = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return [reg.translation_key, reg.entity_id.replace(/^sensor\./, ''), snake(reg.original_name)]
    .filter(Boolean).map((x) => String(x).toLowerCase());
}

function emptyRoles() {
  return { power_import: null, power_export: null, power_net: null, energy_import: [], energy_export: [], phases: [{}, {}, {}], gas: null };
}

// Fill roles for one group of registry entries (one integration, or one
// device for integrations that hold other devices too).
function assign(def, entries) {
  const roles = emptyRoles();
  const tariffs = { import: [], export: [] };
  const totals = { import: null, export: null };
  for (const reg of entries) {
    if (!reg.entity_id.startsWith('sensor.') || reg.disabled_by) continue;
    const keys = keysOf(reg);
    const hit = (re) => { for (const k of keys) { const m = k.match(re); if (m) return m; } return null; };
    const r = def.rules;
    let m;
    if (r.phase_net && (m = hit(r.phase_net))) { roles.phases[Number(m[1]) - 1].net = reg.entity_id; continue; }
    if (r.phase_import && (m = hit(r.phase_import))) { roles.phases[Number(m[1]) - 1].import = reg.entity_id; continue; }
    if (r.phase_export && (m = hit(r.phase_export))) { roles.phases[Number(m[1]) - 1].export = reg.entity_id; continue; }
    if (r.energy_import_tariff && (m = hit(r.energy_import_tariff))) { tariffs.import.push([m[1], reg.entity_id]); continue; }
    if (r.energy_export_tariff && (m = hit(r.energy_export_tariff))) { tariffs.export.push([m[1], reg.entity_id]); continue; }
    if (r.energy_import_total && hit(r.energy_import_total)) { totals.import = totals.import || reg.entity_id; continue; }
    if (r.energy_export_total && hit(r.energy_export_total)) { totals.export = totals.export || reg.entity_id; continue; }
    if (r.power_export && hit(r.power_export)) { roles.power_export = roles.power_export || reg.entity_id; continue; }
    if (r.power_import && hit(r.power_import)) { roles.power_import = roles.power_import || reg.entity_id; continue; }
    if (r.power_net && hit(r.power_net)) { roles.power_net = roles.power_net || reg.entity_id; continue; }
    if (r.gas && hit(r.gas)) { roles.gas = roles.gas || reg.entity_id; continue; }
  }
  // A total meter reading counts once; otherwise the tariff readings together.
  const byTariff = (list) => list.sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map((x) => x[1]);
  roles.energy_import = totals.import ? [totals.import] : byTariff(tariffs.import);
  roles.energy_export = totals.export ? [totals.export] : byTariff(tariffs.export);
  return roles;
}

function usable(roles) {
  return !!(roles.power_net || roles.power_import);
}

// All P1 meters found in the entity registry.
function detectMeters(entities, devices = []) {
  const deviceName = new Map(devices.map((d) => [d.id, d.name_by_user || d.name || '']));
  const found = [];
  for (const [id, def] of Object.entries(METERS)) {
    const mine = entities.filter((e) => e.platform === def.platform);
    if (!mine.length) continue;
    const groups = new Map();
    for (const e of mine) {
      const key = def.perDevice ? (e.device_id || e.entity_id) : (e.config_entry_id || 'all');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    for (const [key, list] of groups) {
      const roles = assign(def, list);
      if (!usable(roles)) continue;
      const dev = list.find((e) => e.device_id);
      found.push({
        id: `${id}:${key}`,
        meter: id,
        name: def.name,
        detail: dev ? deviceName.get(dev.device_id) || null : null,
        roles,
      });
    }
  }
  return found;
}

// Grid power now in watts, positive = taking from the grid.
// getState(entity_id) -> { state, attributes } | null
function gridPower(meter, getState) {
  if (!meter) return null;
  const read = (id) => {
    if (!id) return null;
    const s = getState(id);
    if (!s) return null;
    return powerW(s.state, s.attributes && s.attributes.unit_of_measurement);
  };
  const sign = meter.invert_net ? -1 : 1;
  const net = read(meter.power_net);
  let total;
  if (net !== null) total = net * sign;
  else {
    const imp = read(meter.power_import);
    if (imp === null) return null;
    total = imp - (read(meter.power_export) || 0);
  }
  const phases = (meter.phases || []).map((p) => {
    const n = read(p && p.net);
    if (n !== null) return n * sign;
    const i = read(p && p.import);
    if (i === null) return null;
    return i - (read(p && p.export) || 0);
  });
  return {
    net_w: total,
    import_w: Math.max(0, total),
    export_w: Math.max(0, -total),
    phases_w: phases.some((x) => x !== null) ? phases : null,
  };
}

// Every entity a meter needs to be watched live.
function meterEntities(meter) {
  if (!meter) return [];
  const ids = [meter.power_net, meter.power_import, meter.power_export, meter.gas];
  for (const p of meter.phases || []) if (p) ids.push(p.net, p.import, p.export);
  return ids.filter(Boolean);
}

module.exports = { METERS, detectMeters, assign, gridPower, meterEntities, powerW, energyKwh, keysOf };
