'use strict';

// Makes the README screenshots in docs/images with made-up demo data.
// Needs Playwright with Chromium:  node tests/screenshots.js
// (Not part of the test run.)

const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'docs', 'images');
const PORT = Number(process.env.PORT) || 8120;
const BASE = `http://127.0.0.1:${PORT}/`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  process.env.DEMO = '1';
  process.env.LANG_HA = 'en';
  process.env.ED_ALLOW_ANY_CLIENT = '1';
  process.env.SUPERVISOR_TOKEN = 'demo';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-shots-'));
  const { fakeHA } = require('./fakeha');
  const wss = fakeHA(0, { demo: true, language: 'en' });
  await new Promise((r) => wss.on('listening', r));
  process.env.HA_WS_URL = `ws://127.0.0.1:${wss.address().port}`;
  const app = require('../energy_dashboard/app/server');
  const srv = await app.start(PORT);
  await new Promise((r) => setTimeout(r, 800));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

  // Wizard (first start)
  await page.goto(BASE);
  await page.waitForSelector('[data-action=lang]');
  await page.click('[data-action=lang][data-value=en]');
  await page.click('[data-action=next]');
  await page.waitForSelector('[data-action=meter]');
  await page.click('[data-action=meter]');
  await shot('wizard-meter.png');
  await page.click('[data-action=next]');
  await page.waitForSelector('[data-action=supplier]');
  await page.click('[data-action=supplier][data-value=anwb]');
  await page.click('[data-action=source]');
  await shot('wizard-supplier.png');

  // The rest of the set-up straight through the API
  const detect = await (await fetch(`${BASE}api/detect`)).json();
  const m = detect.meters[0];
  const src = detect.price_sources[0];
  const body = {
    wizard_done: true,
    language: 'en',
    meter: { meter: m.meter, ...m.roles },
    price: { source: src, price_type: src.price_type, supplier: 'anwb', fee_incl_vat: 0.018, fixed_month: 8.5, compare_tariff: 0.28 },
    modules: [
      { id: 'solar', type: 'solar', name: 'Solar', power_entity: 'sensor.solar_power' },
      { id: 'battery', type: 'battery', name: 'Battery', power_entity: 'sensor.home_battery_power', soc_entity: 'sensor.home_battery_soc' },
      { id: 'car', type: 'ev', name: 'Car', power_entity: 'sensor.car_charger_power', soc_entity: 'sensor.car_battery' },
      { id: 'heatpump', type: 'heatpump', name: 'Heat pump', power_entity: 'sensor.heat_pump_power' },
    ],
    tiles: ['cost', 'usage', 'charging_planner', 'heating_planner'],
    edge: { reference: 'today_tomorrow', band: 25, width: 10, glow: 40 },
  };
  const res = await fetch(`${BASE}api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());

  // Start screen
  await page.goto(BASE);
  await page.waitForTimeout(3500);
  await shot('dashboard.png');

  // Pop-ups
  await page.click('#priceNow');
  await page.waitForTimeout(1200);
  await shot('popup-price.png');
  await page.click('#popClose');
  await page.click('#flowCard');
  await page.waitForTimeout(1500);
  await shot('popup-flows.png');
  await page.click('#popClose');

  // Usage chart
  await page.click('#chartTabs .chip:nth-child(2)');
  await page.waitForTimeout(1200);
  await shot('chart-usage.png');

  // Settings: edge & theme
  await page.click('#openSettings');
  await page.waitForSelector('[data-action=tab]');
  await page.click('[data-action=tab][data-value="4"]');
  await page.waitForTimeout(300);
  await shot('settings-edge.png');
  await page.click('[data-action=cancel]');

  // Night mode (the whole day counts as night for this picture)
  await fetch(`${BASE}api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, theme: { night: 'times', night_from: '00:00', night_to: '23:59', dim: 55 } }) });
  await page.goto(BASE);
  await page.waitForTimeout(3500);
  await shot('night.png');

  await browser.close();
  srv.closeAllConnections();
  srv.close();
  for (const c of wss.clients) c.terminate();
  wss.close();
  if (errors.length) {
    console.error('Page errors:', errors);
    process.exitCode = 1;
  }
  console.log('Screenshots in', OUT);
  setTimeout(() => process.exit(), 200);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
