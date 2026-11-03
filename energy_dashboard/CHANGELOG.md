# Changelog

## 0.1.7-dev

- Own colours for the price scale in Settings › Edge & theme › Colours: cheap, middle and expensive (default green, yellow, red as before), with a "Default colours" button (#8).
- Optional extra step **very expensive** (default purple): with fixed limits from a third price you set, compared with the average at twice the distance of fully red (#8).
- Optional own colour for **negative prices** (default blue) (#8).
- Colours are now sent as #rrggbb instead of hsl().

## 0.1.6-dev

- Colour of the price: a new choice in Settings › Edge & theme. **Compared with the average** (as before) or **Fixed limits**: fully green at or below a price you set, fully red at or above another, smooth in between. Applies to the edge and the price bars; the text "x% above average" stays (#7).

## 0.1.5-dev

- Gas price and gas costs (#6). In Settings › Supplier & tariff (with a gas meter): EnergyZero or easyEnergy, a sensor with the gas price in €/m³, or a fixed price; purchase fee per m³ (starting values for six suppliers), energy tax on gas 2026 and VAT, with the same warning as #4 when the source already looks all-in.
- Gas tile: m³ today, costs today and the price per m³. Tap it for the gas pop-up: price now with its build-up, m³ per hour, costs today and yesterday.
- Cost tile and cost pop-up: electricity and gas together, both parts shown.

## 0.1.4-dev

- Price chart: tapping a bar opens the price of that hour (or quarter), today or tomorrow: the all-in price, how it compares with the average, the build-up and low/high of that day. The tapped bar is marked. The price at the top still shows the price of now (#5).

## 0.1.3-dev

- Warning when a price source looks all-in or incl. VAT while it is set as a market price: then the fee, energy tax and VAT would be counted twice. Shown in the price pop-up and in Settings › Supplier & tariff, with what the source gives now and the all-in result (#4).
- Diagnostics include the price of the source now and the all-in result (market data, nothing about the house).

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
