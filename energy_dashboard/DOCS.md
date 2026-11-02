# Energy Dashboard

An interactive energy dashboard for a wall tablet. **Test version.**

## Install

1. In Home Assistant: **Settings → Apps → App store** (older versions: Add-ons → Add-on store) → ⋮ → **Repositories**.
2. Add `https://github.com/tlpeter/energy-dashboard#dev` (the test version; `main` has no app yet) and close.
3. Open **Energy Dashboard (dev)** → **Install** → **Start**. Switch on **Show in sidebar**.
4. Open it from the sidebar. The set-up wizard starts by itself.

## The wizard (and Settings)

Everything can be changed later with the gear at the top right.

1. **Language**: like Home Assistant, Nederlands or English.
2. **Smart meter (P1)**: the app looks for HomeWizard, DSMR (the official integration), DSMR Reader, SlimmeLezer/ESPHome, P1 Monitor and Tibber Pulse and fills in the sensors. Check them; anything can be changed. *Swap sign* is for meters that show export as a positive number. The meter readings (kWh) are used for today's usage and costs.
3. **Supplier & tariff**: pick your supplier; the purchase fee, energy tax 2026 and VAT are filled in with starting values. **Check them against your contract**: suppliers change their fees often, and for many suppliers we do not know the fee. Then choose the price source (an integration in Home Assistant such as EnergyZero, Nord Pool, Tibber, Frank Energie or Zonneplan) or a fixed tariff. *Compare with fixed tariff* shows what you save.
4. **Devices**: add a car, heat pump, solar panels, a home battery or any device with a power sensor. Signs: solar + = producing, battery + = charging, devices + = using.
5. **Edge & theme**: what the price is compared with, at how many % it is fully green or red, the width and glow of the edge, night mode, the timers and which tiles are on the start screen.

## On the tablet (Kiosk Satellite)

The dashboard is a page of this app inside Home Assistant (ingress), so it uses your normal Home Assistant login and needs no certificate or extra port.
Open it on the tablet from the sidebar, or point the kiosk app to the app's page: `/<app id>` as shown in the address bar when you open the app from the sidebar (for example `/abcd1234_energy_dashboard`). *Whether Kiosk Satellite accepts an app page as its "dashboard" has not been checked yet.*

## Read-only

The app only reads from Home Assistant: states, the entity and device lists, statistics, the solar forecast and prices. Every command is on an allowlist in the code; anything else is refused.

## What is tested

Automated tests with made-up data cover the meter detection for every P1 integration above, the colours, the prices and costs, the settings and the whole app against a fake Home Assistant. That is not the same as a real meter: tell us which meter you tested, also when it works.
