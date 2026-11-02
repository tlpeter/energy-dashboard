'use strict';

// Dutch energy suppliers for the wizard.
//
// fee: purchase fee (inkoopvergoeding) per kWh INCLUDING VAT, as suppliers
// publish it; fixed: fixed delivery costs per month incl. VAT. null means
// "not known to us, fill it in yourself". These are starting values only:
// suppliers change them often. The user can always change them.
// Checked: November 2026 (public comparison tables and supplier pages).
//
// integration: the Home Assistant integration that gives this supplier's
// prices, when there is one; the wizard then selects that price source.

const CHECKED = '2026-11';

// Energy tax on electricity 2026, first band, per kWh (Belastingdienst).
const ENERGY_TAX_2026_INCL_VAT = 0.11085;
const VAT_PERCENT = 21;

const SUPPLIERS = [
  { id: 'frank_energie', name: 'Frank Energie', dynamic: true, fee: 0.0182, fixed: null, integration: 'frank_energie' },
  { id: 'tibber', name: 'Tibber', dynamic: true, fee: 0.0248, fixed: 5.99, integration: 'tibber' },
  { id: 'zonneplan', name: 'Zonneplan', dynamic: true, fee: 0.0200, fixed: 6.25, integration: 'zonneplan_one' },
  { id: 'anwb', name: 'ANWB Energie', dynamic: true, fee: 0.0180, fixed: 8.50, integration: null },
  { id: 'nextenergy', name: 'NextEnergy', dynamic: true, fee: 0.0219, fixed: 5.99, integration: null },
  { id: 'eneco', name: 'Eneco', dynamic: true, fee: 0.0185, fixed: null, integration: null },
  { id: 'energyzero', name: 'EnergyZero', dynamic: true, fee: null, fixed: null, integration: 'energyzero' },
  { id: 'easyenergy', name: 'easyEnergy', dynamic: true, fee: null, fixed: null, integration: 'easyenergy' },
  { id: 'vattenfall', name: 'Vattenfall', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'essent', name: 'Essent', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'budget_energie', name: 'Budget Energie', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'coolblue', name: 'Coolblue Energie', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'vandebron', name: 'Vandebron', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'greenchoice', name: 'Greenchoice', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'pure_energie', name: 'Pure Energie', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'energie_vanons', name: 'Energie VanOns', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'mijndomein', name: 'Mijndomein Energie', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'engie', name: 'ENGIE', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'oxxio', name: 'Oxxio', dynamic: true, fee: null, fixed: null, integration: null },
  { id: 'other', name: 'Other / manual', dynamic: true, fee: null, fixed: null, integration: null },
];

function supplier(id) {
  return SUPPLIERS.find((s) => s.id === id) || null;
}

// Settings defaults when a supplier is picked in the wizard. Values are
// stored incl. VAT in the settings (as on the bill); prices.js wants them
// excl. VAT, see toPriceCfg().
function presetFor(id) {
  const s = supplier(id) || supplier('other');
  return {
    supplier: s.id,
    fee_incl_vat: s.fee,
    fixed_month: s.fixed,
    energy_tax_incl_vat: ENERGY_TAX_2026_INCL_VAT,
    vat_percent: VAT_PERCENT,
  };
}

// The settings → the cfg prices.totalPrice() understands.
function toPriceCfg(price) {
  const vat = Number(price.vat_percent ?? VAT_PERCENT);
  const f = 1 + vat / 100;
  return {
    price_type: price.price_type || 'market_excl_vat',
    purchase_fee: (Number(price.fee_incl_vat) || 0) / f,
    energy_tax: (Number(price.energy_tax_incl_vat) || 0) / f,
    vat_percent: vat,
  };
}

module.exports = { SUPPLIERS, CHECKED, ENERGY_TAX_2026_INCL_VAT, VAT_PERCENT, supplier, presetFor, toPriceCfg };
