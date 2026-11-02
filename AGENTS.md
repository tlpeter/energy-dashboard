# Working on this repository

Rules for everyone who works on this repository: people, Claude and Codex.

## The project

**Energy Dashboard** is a Home Assistant app (add-on): an interactive energy dashboard for a wall tablet (kiosk), served through Home Assistant ingress. It shows the grid (P1 meter), devices, prices with a coloured edge (green = cheap, red = expensive), costs and the plans of Smart Charging Planner and Smart Heating Planner. The UI is in English and Dutch (a setting). The owner (Peter) is not a developer: explain changes in plain words, step by step.

- The app is in `energy_dashboard/app`: Node, `server.js`, port 8099 (ingress), settings in `/data/settings.json`.
- Price code (`prices.js`, `pricehistory.js`) comes from Smart Charging Planner; keep them in step.

## Hard rules

- **Push only when the owner says so** ("push", "push dev", "push main", "uitbrengen").
- **GitHub is the source of truth.** Before starting a new request, check the current `main` and `dev` branches and build on the latest commits of others.
- **The app only reads from Home Assistant.** Every command and action is on an allowlist in `ha.js`. Controlling devices is not built; when it is, it gets its own switch, off by default.
- **Generic**: everything is chosen in the wizard or Settings (meter, supplier, devices). Never hard-code one house.
- **Everything public is anonymous.** No real entity ids, addresses or diagnostics from the owner's house in code, tests, issues or docs.
- **Every version gets a changelog entry**, short and in plain words.
- Say which checks are fixture-tested and which are physically verified; never claim more.

## Branches and versions

- `dev` is the test version and `main` is the stable version.
- On `dev`: `name` is `Energy Dashboard (dev)`, `panel_title` is `Energy (dev)`, `description` starts with `TEST VERSION: `, the version ends in `-dev`. Bump it on every change in `config.yaml` (with `-dev`), `app/package.json` and `app/package-lock.json` (without).
- Release zip: `energy-dashboard-vX.Y.Z.zip`, the contents of `energy_dashboard`, no top folder.
