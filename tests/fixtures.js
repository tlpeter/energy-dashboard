'use strict';

// Made-up entity registries for every supported P1 integration. Entity ids,
// names and devices are invented; the translation keys follow what each
// integration uses. These are fixtures, not proof that a real meter works.

const reg = (platform, entity_id, translation_key, extra = {}) => ({
  platform, entity_id, translation_key, original_name: null, device_id: extra.device_id || `dev_${platform}`,
  config_entry_id: extra.config_entry_id || `entry_${platform}`, disabled_by: null, ...extra,
});

const P1 = {
  homewizard: {
    entities: [
      reg('homewizard', 'sensor.p1_meter_power', 'active_power_w'),
      reg('homewizard', 'sensor.p1_meter_power_phase_1', 'active_power_phase_w', { original_name: 'Power phase 1' }),
      reg('homewizard', 'sensor.p1_meter_power_phase_2', 'active_power_phase_w', { original_name: 'Power phase 2' }),
      reg('homewizard', 'sensor.p1_meter_power_phase_3', 'active_power_phase_w', { original_name: 'Power phase 3' }),
      reg('homewizard', 'sensor.p1_meter_energy_import', 'total_energy_import_kwh'),
      reg('homewizard', 'sensor.p1_meter_energy_import_tariff_1', 'total_energy_import_tariff_kwh', { original_name: 'Energy import tariff 1' }),
      reg('homewizard', 'sensor.p1_meter_energy_import_tariff_2', 'total_energy_import_tariff_kwh', { original_name: 'Energy import tariff 2' }),
      reg('homewizard', 'sensor.p1_meter_energy_export', 'total_energy_export_kwh'),
      reg('homewizard', 'sensor.gas_meter_gas', 'total_gas_m3'),
      reg('homewizard', 'sensor.p1_meter_wi_fi_ssid', 'wifi_ssid'),
    ],
    expect: {
      power_net: 'sensor.p1_meter_power',
      phases: ['sensor.p1_meter_power_phase_1', 'sensor.p1_meter_power_phase_2', 'sensor.p1_meter_power_phase_3'],
      energy_import: ['sensor.p1_meter_energy_import'],
      energy_export: ['sensor.p1_meter_energy_export'],
      gas: 'sensor.gas_meter_gas',
    },
  },
  dsmr: {
    entities: [
      reg('dsmr', 'sensor.electricity_meter_power_consumption', 'current_electricity_usage'),
      reg('dsmr', 'sensor.electricity_meter_power_production', 'current_electricity_delivery'),
      reg('dsmr', 'sensor.electricity_meter_energy_consumption_tarif_1', 'electricity_used_tariff_1'),
      reg('dsmr', 'sensor.electricity_meter_energy_consumption_tarif_2', 'electricity_used_tariff_2'),
      reg('dsmr', 'sensor.electricity_meter_energy_production_tarif_1', 'electricity_delivered_tariff_1'),
      reg('dsmr', 'sensor.electricity_meter_energy_production_tarif_2', 'electricity_delivered_tariff_2'),
      reg('dsmr', 'sensor.electricity_meter_power_consumption_phase_l1', 'instantaneous_active_power_l1_positive'),
      reg('dsmr', 'sensor.electricity_meter_power_production_phase_l1', 'instantaneous_active_power_l1_negative'),
      reg('dsmr', 'sensor.electricity_meter_power_consumption_phase_l2', 'instantaneous_active_power_l2_positive'),
      reg('dsmr', 'sensor.gas_meter_gas_consumption', 'gas_meter_reading'),
    ],
    expect: {
      power_import: 'sensor.electricity_meter_power_consumption',
      power_export: 'sensor.electricity_meter_power_production',
      energy_import: ['sensor.electricity_meter_energy_consumption_tarif_1', 'sensor.electricity_meter_energy_consumption_tarif_2'],
      energy_export: ['sensor.electricity_meter_energy_production_tarif_1', 'sensor.electricity_meter_energy_production_tarif_2'],
      phase_import: ['sensor.electricity_meter_power_consumption_phase_l1', 'sensor.electricity_meter_power_consumption_phase_l2'],
      gas: 'sensor.gas_meter_gas_consumption',
    },
  },
  dsmr_reader: {
    entities: [
      reg('dsmr_reader', 'sensor.dsmr_reading_electricity_currently_delivered', null),
      reg('dsmr_reader', 'sensor.dsmr_reading_electricity_currently_returned', null),
      reg('dsmr_reader', 'sensor.dsmr_reading_electricity_delivered_1', null),
      reg('dsmr_reader', 'sensor.dsmr_reading_electricity_delivered_2', null),
      reg('dsmr_reader', 'sensor.dsmr_reading_electricity_returned_1', null),
      reg('dsmr_reader', 'sensor.dsmr_reading_electricity_returned_2', null),
      reg('dsmr_reader', 'sensor.dsmr_reading_phase_currently_delivered_l1', null),
      reg('dsmr_reader', 'sensor.dsmr_reading_phase_currently_returned_l1', null),
      reg('dsmr_reader', 'sensor.dsmr_reading_extra_device_delivered', null),
    ],
    expect: {
      power_import: 'sensor.dsmr_reading_electricity_currently_delivered',
      power_export: 'sensor.dsmr_reading_electricity_currently_returned',
      energy_import: ['sensor.dsmr_reading_electricity_delivered_1', 'sensor.dsmr_reading_electricity_delivered_2'],
      energy_export: ['sensor.dsmr_reading_electricity_returned_1', 'sensor.dsmr_reading_electricity_returned_2'],
      phase_import: ['sensor.dsmr_reading_phase_currently_delivered_l1'],
      gas: 'sensor.dsmr_reading_extra_device_delivered',
    },
  },
  esphome: {
    entities: [
      reg('esphome', 'sensor.slimmelezer_power_consumed', null, { original_name: 'Power Consumed', device_id: 'dev_slim' }),
      reg('esphome', 'sensor.slimmelezer_power_produced', null, { original_name: 'Power Produced', device_id: 'dev_slim' }),
      reg('esphome', 'sensor.slimmelezer_energy_consumed_tariff_1', null, { original_name: 'Energy Consumed Tariff 1', device_id: 'dev_slim' }),
      reg('esphome', 'sensor.slimmelezer_energy_consumed_tariff_2', null, { original_name: 'Energy Consumed Tariff 2', device_id: 'dev_slim' }),
      reg('esphome', 'sensor.slimmelezer_energy_produced_tariff_1', null, { original_name: 'Energy Produced Tariff 1', device_id: 'dev_slim' }),
      reg('esphome', 'sensor.slimmelezer_power_consumed_phase_1', null, { original_name: 'Power Consumed Phase 1', device_id: 'dev_slim' }),
      reg('esphome', 'sensor.slimmelezer_gas_consumed', null, { original_name: 'Gas Consumed', device_id: 'dev_slim' }),
      // another ESPHome device that is not a meter
      reg('esphome', 'sensor.mailbox_wifi_signal', null, { original_name: 'WiFi Signal', device_id: 'dev_other' }),
      reg('esphome', 'sensor.desk_power', null, { original_name: 'Desk power', device_id: 'dev_other' }),
    ],
    expect: {
      power_import: 'sensor.slimmelezer_power_consumed',
      power_export: 'sensor.slimmelezer_power_produced',
      energy_import: ['sensor.slimmelezer_energy_consumed_tariff_1', 'sensor.slimmelezer_energy_consumed_tariff_2'],
      energy_export: ['sensor.slimmelezer_energy_produced_tariff_1'],
      phase_import: ['sensor.slimmelezer_power_consumed_phase_1'],
      gas: 'sensor.slimmelezer_gas_consumed',
    },
  },
  p1_monitor: {
    entities: [
      reg('p1_monitor', 'sensor.smartmeter_power_consumption', 'power_consumption'),
      reg('p1_monitor', 'sensor.smartmeter_power_production', 'power_production'),
      reg('p1_monitor', 'sensor.smartmeter_energy_consumption_high', 'energy_consumption_high'),
      reg('p1_monitor', 'sensor.smartmeter_energy_consumption_low', 'energy_consumption_low'),
      reg('p1_monitor', 'sensor.smartmeter_energy_production_high', 'energy_production_high'),
      reg('p1_monitor', 'sensor.smartmeter_energy_production_low', 'energy_production_low'),
      reg('p1_monitor', 'sensor.phases_power_consumed_phase_l1', 'power_consumed_phase_l1'),
      reg('p1_monitor', 'sensor.smartmeter_gas_consumption', 'gas_consumption'),
    ],
    expect: {
      power_import: 'sensor.smartmeter_power_consumption',
      power_export: 'sensor.smartmeter_power_production',
      energy_import: ['sensor.smartmeter_energy_consumption_high', 'sensor.smartmeter_energy_consumption_low'],
      energy_export: ['sensor.smartmeter_energy_production_high', 'sensor.smartmeter_energy_production_low'],
      phase_import: ['sensor.phases_power_consumed_phase_l1'],
      gas: 'sensor.smartmeter_gas_consumption',
    },
  },
  tibber: {
    entities: [
      reg('tibber', 'sensor.power_exampleroad_1', 'power', { device_id: 'dev_pulse' }),
      reg('tibber', 'sensor.power_production_exampleroad_1', 'power_production', { device_id: 'dev_pulse' }),
      reg('tibber', 'sensor.last_meter_consumption_exampleroad_1', 'last_meter_consumption', { device_id: 'dev_pulse' }),
      reg('tibber', 'sensor.last_meter_production_exampleroad_1', 'last_meter_production', { device_id: 'dev_pulse' }),
      reg('tibber', 'sensor.accumulated_consumption_exampleroad_1', 'accumulated_consumption', { device_id: 'dev_pulse' }),
      // Tibber price sensor on another device: not a meter
      reg('tibber', 'sensor.electricity_price_exampleroad_1', null, { device_id: 'dev_home' }),
    ],
    expect: {
      power_import: 'sensor.power_exampleroad_1',
      power_export: 'sensor.power_production_exampleroad_1',
      energy_import: ['sensor.last_meter_consumption_exampleroad_1'],
      energy_export: ['sensor.last_meter_production_exampleroad_1'],
    },
  },
};

module.exports = { P1, reg };
