# Changelog

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
