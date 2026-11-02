# Changelog

## 0.1.2-dev

- Parts that are not set up are not shown: Solar and Battery only appear in the energy flows when you added them, and the Solar forecast tab only with a solar device. Without them the flows use the free space (#2).
- Tiles: more tiles get more columns (up to four, never more than two rows), so the labels at the top are no longer cut off; text values such as a planner status wrap to two lines (#3).

## 0.1.1-dev

- README with screenshots (made-up demo data) (#1).
- Repository URL with `#dev` in the README and DOCS: Home Assistant needs it for the test version (#1).
- Usage chart: import and export of the same hour are both shown (import up, export down); hours still to come stay empty.
- Demo mode for the fake Home Assistant and a script that makes the screenshots (`tests/screenshots.js`).

## 0.1.0-dev

First test version.

- Start screen for a wall tablet (1280×800 landscape and up): live energy flows, the price now, a chart (prices today/tomorrow, usage, solar forecast) and tiles.
- Coloured edge around the screen: a smooth scale from green (cheap) to red (expensive), compared with the average of today, today + tomorrow or the next 24 hours. Sensitivity, width, glow and pulsing are settings.
- Tap anything for a pop-up with details; pop-ups close by themselves and the screen returns to the start after a set time.
- Night mode after sunset or between times, with a dimmed screen.
- Set-up wizard and Settings: language (English / Nederlands), P1 meter (HomeWizard, DSMR, DSMR Reader, SlimmeLezer/ESPHome, P1 Monitor, Tibber Pulse, or sensors you choose), supplier with starting values for the purchase fee, price source, devices (car, heat pump, solar, battery, any device), edge, theme and tiles.
- Costs of today and yesterday from Home Assistant's statistics and the all-in price; savings compared with a fixed tariff you enter; net metering until 2027.
- Shows the sensors of Smart Charging Planner and Smart Heating Planner when they are there.
- Read-only: the app never changes anything in Home Assistant.
