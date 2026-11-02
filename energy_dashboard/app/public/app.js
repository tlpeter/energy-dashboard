'use strict';

// Energy Dashboard — the start screen, the chart, the tiles and the pop-ups.
// Plain JavaScript without a build step. All URLs are relative, because the
// page is served under the Home Assistant ingress path.

(function () {
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  const S = {
    status: null,
    settings: null,
    lang: 'en',
    t: window.makeT('en'),
    live: null,
    prices: null,
    day: null,
    solar: null,
    planners: null,
    chartTab: 'price',
    chartDay: 0, // 0 today, 1 tomorrow (prices) / -1 yesterday (usage)
    popup: null,
    lastTouch: Date.now(),
    popupAt: 0,
  };
  window.ED = S;

  // ---------------------------------------------------------------- helpers

  async function api(path, opts) {
    const res = await fetch(path, { cache: 'no-store', ...(opts || {}) });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
    return body;
  }
  S.api = api;

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  S.esc = esc;

  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  const locale = () => (S.lang === 'nl' ? 'nl-NL' : 'en-GB');
  const tz = () => (S.status && S.status.time_zone) || undefined;
  function num(v, digits = 2) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  S.num = num;
  function power(w) {
    if (w === null || w === undefined || !Number.isFinite(w)) return { v: '—', u: '' };
    const a = Math.abs(w);
    if (a < 1000) return { v: String(Math.round(a)), u: 'W' };
    return { v: num(a / 1000, a < 10000 ? 1 : 0), u: 'kW' };
  }
  function hhmm(ms) {
    return new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: tz() });
  }
  S.hhmm = hhmm;
  function hourOf(ms) {
    return Number(new Date(ms).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: tz() })) % 24;
  }

  function setLanguage() {
    const pref = S.settings ? S.settings.language : 'auto';
    const ha = (S.status && S.status.language) || navigator.language || 'en';
    S.lang = pref === 'auto' ? (String(ha).toLowerCase().startsWith('nl') ? 'nl' : 'en') : pref;
    S.t = window.makeT(S.lang);
    document.documentElement.lang = S.lang;
  }
  S.setLanguage = setLanguage;

  // ---------------------------------------------------------------- edge

  function applyEdge() {
    const root = document.documentElement.style;
    const edge = S.settings ? S.settings.edge : null;
    const color = S.live && S.live.price ? S.live.price.color : '#6b7785';
    root.setProperty('--edge', color || '#6b7785');
    if (edge) {
      root.setProperty('--edge-w', `${edge.width}px`);
      root.setProperty('--glow', `${edge.glow}px`);
    }
    const lv = S.live && S.live.price ? S.live.price.level : null;
    $('frame').classList.toggle('pulse', !!(edge && edge.pulse && lv !== null && Math.abs(lv) >= 1));
    const dim = S.live && S.live.night && S.settings ? S.settings.theme.dim / 100 : 1;
    root.setProperty('--dim', String(dim));
  }

  // ---------------------------------------------------------------- header

  function renderHeader() {
    const t = S.t;
    const now = new Date();
    $('clock').textContent = now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: tz() });
    $('date').textContent = now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz() });
    $('priceLabel').textContent = t('price_now');
    $('priceUnit').textContent = t('per_kwh');
    const p = S.live && S.live.price;
    $('priceValue').textContent = p && p.now !== null ? `€ ${num(p.now)}` : '—';
    let dev = '';
    if (p && Number.isFinite(p.deviation)) {
      const pct = Math.round(p.deviation * 100);
      dev = pct === 0 ? t('at_avg') : t(pct < 0 ? 'below_avg' : 'above_avg', { p: Math.abs(pct) });
    } else if (!p) dev = t('no_prices');
    $('priceDev').textContent = dev;
    $('cheapLabel').textContent = t('cheapest_block');
    const nc = p && p.next_cheap;
    $('cheapValue').textContent = nc ? `${hhmm(nc.start)} – ${hhmm(nc.end)} · € ${num(nc.average)}` : '—';
    $('openSettings').setAttribute('aria-label', t('settings'));
  }

  // ---------------------------------------------------------------- flows

  const TYPE_COLOR = { grid: 'var(--grid)', home: 'var(--home)', solar: 'var(--solar)', battery: 'var(--battery)', ev: 'var(--ev)', heatpump: 'var(--heatpump)', device: 'var(--device)' };
  const SLOTS = [[440, 260], [260, 440], [430, 420], [90, 430]];

  function node(svg, x, y, r, color, value, sub, label, labelY, dim) {
    const g = el('g', { opacity: dim ? 0.45 : 1 }, svg);
    el('circle', { cx: x, cy: y, r, fill: '#0d1218', stroke: color, 'stroke-width': 2.5, 'stroke-dasharray': dim ? '5 5' : null }, g);
    const v = el('text', { x, y: y - 2, 'text-anchor': 'middle', fill: '#e8eef5', 'font-size': r > 55 ? 24 : 20, 'font-weight': 800 }, g);
    v.textContent = value;
    const s = el('text', { x, y: y + 18, 'text-anchor': 'middle', fill: '#9fb0c2', 'font-size': 12 }, g);
    s.textContent = sub;
    const l = el('text', { x, y: labelY, 'text-anchor': 'middle', fill: '#c9d4e0', 'font-size': 14, 'font-weight': 700 }, g);
    l.textContent = label;
  }

  function link(svg, a, b, color, watts, reverse) {
    el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: color, 'stroke-opacity': 0.22, 'stroke-width': 6 }, svg);
    if (!watts || Math.abs(watts) < 20) return;
    const speed = Math.max(0.35, 2.6 - Math.log10(Math.abs(watts)) * 0.6);
    const line = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: color, 'stroke-width': 4, 'stroke-linecap': 'round', class: `fl${reverse ? ' rev' : ''}` }, svg);
    line.style.setProperty('--speed', `${speed.toFixed(2)}s`);
  }

  function renderFlow() {
    const t = S.t;
    $('flowTitle').textContent = t('flows');
    $('flowLive').textContent = t('live');
    const svg = $('flow');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const f = S.live && S.live.flows;
    const HOME = [260, 260];
    const GRID = [80, 260];
    const SOLAR = [110, 90];
    const BATT = [410, 90];
    const grid = f && f.grid;
    const mods = (f && f.modules) || [];
    const consumers = mods.filter((m) => ['ev', 'heatpump', 'device'].includes(m.type)).slice(0, SLOTS.length);

    // lines first, nodes on top
    const has = (type) => mods.some((m) => m.type === type);
    const ghost = (a, b) => el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#2a3340', 'stroke-width': 3, 'stroke-dasharray': '4 8' }, svg);
    if (has('solar')) link(svg, SOLAR, HOME, 'var(--solar)', f && f.solar_w, false); else ghost(SOLAR, HOME);
    if (has('battery')) link(svg, HOME, BATT, 'var(--battery)', f && f.battery_w, f && f.battery_w < 0); else ghost(HOME, BATT);
    link(svg, GRID, HOME, 'var(--grid)', grid && grid.net_w, grid && grid.net_w < 0);
    consumers.forEach((m, i) => link(svg, HOME, SLOTS[i], TYPE_COLOR[m.type], m.power_w, m.power_w < 0));

    const solarMod = mods.find((m) => m.type === 'solar');
    const battMod = mods.find((m) => m.type === 'battery');
    const sp = power(f && f.solar_w);
    node(svg, SOLAR[0], SOLAR[1], 40, 'var(--solar)', solarMod ? sp.v : '', solarMod ? sp.u : t('not_set'), t('solar'), SOLAR[1] - 52, !solarMod);
    const bp = power(f && f.battery_w);
    const bsub = battMod ? `${bp.u}${battMod.soc !== null ? ` · ${Math.round(battMod.soc)}%` : ''}` : t('not_set');
    node(svg, BATT[0], BATT[1], 40, 'var(--battery)', battMod ? bp.v : '', bsub, t('battery'), BATT[1] - 52, !battMod);

    const gp = power(grid && grid.net_w);
    const gsub = grid ? `${gp.u} ${grid.net_w < 0 ? t('exporting') : t('importing')}` : t('not_set');
    node(svg, GRID[0], GRID[1], 52, 'var(--grid)', grid ? gp.v : '—', gsub, t('grid'), GRID[1] + 76, !grid);
    const hp = power(f && f.home_w);
    node(svg, HOME[0], HOME[1], 62, 'var(--home)', hp.v, hp.u, t('home'), HOME[1] - 80, false);
    consumers.forEach((m, i) => {
      const p = power(m.power_w);
      const sub = `${p.u}${m.soc !== null ? ` · ${Math.round(m.soc)}%` : ''}`;
      const [x, y] = SLOTS[i];
      node(svg, x, y, 46, TYPE_COLOR[m.type], p.v, sub, m.name, y + 68 > 515 ? y - 58 : y + 68, false);
    });
  }

  // ---------------------------------------------------------------- chart

  function chips(container, items, current, onPick, soft) {
    container.textContent = '';
    for (const [key, label] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip${soft ? ' soft' : ''}${key === current ? ' on' : ''}`;
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); onPick(key); });
      container.appendChild(b);
    }
  }

  function axis(labels) {
    const a = $('chartAxis');
    a.textContent = '';
    for (const l of labels) {
      const s = document.createElement('span');
      s.textContent = l;
      a.appendChild(s);
    }
  }

  // list: [{ v, c, o, ring, neg, negC }] — v up from zero, neg (optional) down.
  function bars(svg, list, opts) {
    const W = 600;
    const H = 220;
    const n = list.length;
    if (!n) return;
    const max = Math.max(0.0001, ...list.map((x) => Math.max(0, x.v)), opts.max || 0);
    const min = Math.min(0, ...list.map((x) => Math.min(x.v, -(x.neg || 0))));
    const span = max - min;
    const zero = H - 4 - ((0 - min) / span) * (H - 12);
    const gap = n > 48 ? 1 : 3;
    const bw = (W - gap * (n - 1)) / n;
    const rect = (i, v, c, x) => {
      if (!v) return;
      const h = Math.max(2, (Math.abs(v) / span) * (H - 12));
      el('rect', { x: i * (bw + gap), y: v >= 0 ? zero - h : zero, width: Math.max(1, bw), height: h, rx: Math.min(4, bw / 3), fill: c, opacity: x.o ?? 1, stroke: x.ring ? '#e8eef5' : null, 'stroke-width': x.ring ? 2 : null }, svg);
    };
    list.forEach((x, i) => {
      if (x.v === null) return;
      rect(i, x.v === 0 && !x.neg ? 0.000001 * span : x.v, x.c, x);
      if (x.neg) rect(i, -x.neg, x.negC, x);
    });
    el('line', { x1: 0, x2: W, y1: zero, y2: zero, stroke: '#243040', 'stroke-width': 1 }, svg);
    if (Number.isFinite(opts.avg)) {
      const y = zero - (opts.avg / span) * (H - 12);
      el('line', { x1: 0, x2: W, y1: y, y2: y, stroke: '#8b98a8', 'stroke-width': 1, 'stroke-dasharray': '4 4' }, svg);
    }
  }

  function renderChart() {
    const t = S.t;
    const svg = $('chart');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    $('chartNote').textContent = '';
    chips($('chartTabs'), [['price', t('tab_price')], ['usage', t('tab_usage')], ['solar', t('tab_solar')]], S.chartTab, (k) => {
      S.chartTab = k;
      S.chartDay = 0;
      renderChart();
    });
    const dayItems = S.chartTab === 'usage' ? [[-1, t('yesterday')], [0, t('today')]] : [[0, t('today')], [1, t('tomorrow')]];
    chips($('dayTabs'), dayItems, S.chartDay, (k) => {
      S.chartDay = k;
      if (S.chartTab === 'usage') loadDay().then(renderChart);
      else renderChart();
    }, true);
    axis(['00', '06', '12', '18', '24']);
    const now = Date.now();

    if (S.chartTab === 'price') {
      const pv = S.prices;
      if (!pv || !pv.prices || !pv.prices.length) { $('chartNote').textContent = t('no_prices'); return; }
      const w = pv.window;
      const from = S.chartDay === 1 ? w.tomorrow : w.start;
      const to = S.chartDay === 1 ? w.end : w.tomorrow;
      const list = pv.prices.filter((p) => p.start >= from && p.start < to);
      if (!list.length) { $('chartNote').textContent = t('tomorrow_not_yet'); return; }
      const allMax = Math.max(...pv.prices.map((p) => p.total));
      bars(svg, list.map((p) => ({ v: p.total, c: p.color, o: p.end <= now ? 0.4 : 1, ring: p.start <= now && now < p.end })), { avg: pv.reference, max: allMax });
      return;
    }
    if (S.chartTab === 'usage') {
      const d = S.day;
      if (!d || !d.hours) { $('chartNote').textContent = t('loading'); return; }
      bars(svg, d.hours.map((h) => (h.known ? { v: h.import, c: 'var(--grid)', neg: h.export, negC: 'var(--solar)' } : { v: null })), {});
      return;
    }
    // solar
    const hasSolar = S.settings && S.settings.modules.some((m) => m.enabled && m.type === 'solar');
    if (!hasSolar) { $('chartNote').textContent = `${t('no_solar')} — ${t('no_solar_hint')}`; return; }
    const sol = S.solar;
    if (!sol || !sol.hours || !sol.hours.length) { $('chartNote').textContent = t('no_forecast'); return; }
    const w = S.prices && S.prices.window;
    if (!w) return;
    const from = S.chartDay === 1 ? w.tomorrow : w.start;
    const list = [];
    for (let h = 0; h < 24; h++) {
      const start = from + h * 3600000;
      const hit = sol.hours.find((x) => x.start === start);
      list.push({ v: hit ? hit.wh / 1000 : 0, c: 'var(--solar)', o: start + 3600000 <= now ? 0.4 : 1 });
    }
    bars(svg, list, {});
  }

  // ---------------------------------------------------------------- tiles

  function tile(label, value, sub, subColor, onClick, extra) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card tile';
    b.innerHTML = `<span class="lbl">${esc(label)}</span><span class="val">${value}</span>${extra || ''}<span class="sub" style="color:${subColor || 'var(--muted)'}">${esc(sub || '')}</span>`;
    b.addEventListener('click', onClick);
    return b;
  }

  function plannerSummary(list, key) {
    if (!list) return null;
    const get = (suffix) => list.find((x) => x.entity_id.endsWith(suffix));
    if (key === 'charging_planner') {
      const st = get('smart_charging_status');
      const next = get('smart_charging_next_start');
      const cost = get('smart_charging_planned_cost');
      return {
        value: esc(st ? st.state : list[0].state),
        sub: next && next.state && next.state !== 'unknown' ? `→ ${hhmm(Date.parse(next.state))}${cost && cost.state !== 'unknown' ? ` · € ${num(Number(cost.state))}` : ''}` : '',
      };
    }
    const first = list[0];
    return { value: esc(`${first.state}${first.unit ? ` ${first.unit}` : ''}`), sub: first.name };
  }

  function renderTiles() {
    const t = S.t;
    const box = $('tiles');
    box.textContent = '';
    const st = S.settings;
    if (!st) return;
    const d = S.day && S.day.offset === 0 ? S.day : S.today;
    for (const key of st.tiles) {
      if (key === 'cost') {
        const sav = d && Number.isFinite(d.saving) ? d.saving : null;
        const sub = sav === null ? (d && d.export_kwh > 0.05 ? t('exported', { v: num(d.export_kwh, 1) }) : '') : (sav >= 0 ? t('saved_vs', { v: num(sav) }) : t('extra_vs', { v: num(-sav) }));
        box.appendChild(tile(t('cost_today'), d && d.priced ? `€ ${num(d.cost)}` : '—', sub, sav !== null && sav < 0 ? 'var(--bad)' : 'var(--good)', () => openPopup('cost')));
      } else if (key === 'usage') {
        const f = S.live && S.live.flows;
        let bar = '';
        if (f && f.modules.length && f.home_w > 0) {
          const parts = f.modules.filter((m) => ['ev', 'heatpump', 'device'].includes(m.type) && m.power_w > 0)
            .map((m) => `<span style="flex:${Math.round(m.power_w)};background:${TYPE_COLOR[m.type]}"></span>`).join('');
          bar = `<span class="bar">${parts}<span style="flex:${Math.round(f.rest_w || 0)};background:var(--home)"></span></span>`;
        }
        box.appendChild(tile(t('usage_today'), d ? `${num(d.import_kwh, 1)} <small>kWh</small>` : '—', d && d.export_kwh > 0.05 ? t('exported', { v: num(d.export_kwh, 1) }) : '', null, () => openPopup('usage'), bar));
      } else if (key === 'gas') {
        if (!st.meter || !st.meter.gas) continue;
        box.appendChild(tile(t('gas_today'), d && d.gas_m3 !== null ? `${num(d.gas_m3, 2)} <small>m³</small>` : '—', '', null, () => openPopup('usage')));
      } else if (key === 'charging_planner' || key === 'heating_planner') {
        const list = S.planners ? S.planners[key] : null;
        const sum = plannerSummary(list, key);
        box.appendChild(tile(t(key), sum ? sum.value : '—', sum ? sum.sub : t('not_found'), null, () => openPopup(`planner:${key}`)));
      } else if (key === 'modules') {
        const f = S.live && S.live.flows;
        for (const m of (f ? f.modules : [])) {
          const p = power(m.power_w);
          box.appendChild(tile(m.name, `${p.v} <small>${p.u}</small>`, m.soc !== null ? `${Math.round(m.soc)}%` : t(m.type), TYPE_COLOR[m.type], () => openPopup(`module:${m.id}`)));
        }
      }
    }
  }

  // ---------------------------------------------------------------- pop-ups

  function miniChart(series, colorsList) {
    const W = 760;
    const H = 180;
    const all = series.flat().filter((p) => Number.isFinite(p.v));
    if (!all.length) return `<div class="hint">—</div>`;
    const t0 = Math.min(...all.map((p) => p.t));
    const t1 = Math.max(...all.map((p) => p.t));
    const max = Math.max(1, ...all.map((p) => p.v));
    const min = Math.min(0, ...all.map((p) => p.v));
    const x = (tt) => ((tt - t0) / Math.max(1, t1 - t0)) * W;
    const y = (v) => H - 6 - ((v - min) / (max - min)) * (H - 12);
    const lines = series.map((s, i) => `<polyline fill="none" stroke="${colorsList[i] || '#4da3ff'}" stroke-width="2" points="${s.filter((p) => Number.isFinite(p.v)).map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}"></polyline>`).join('');
    return `<svg class="mini-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#243040"></line>${lines}</svg>`;
  }

  function stat(k, v, color) {
    return `<div class="stat"><div class="k">${esc(k)}</div><div class="v"${color ? ` style="color:${color}"` : ''}>${v}</div></div>`;
  }

  async function popupContent(kind) {
    const t = S.t;
    if (kind === 'price') {
      const pv = S.prices;
      if (!pv || !pv.current) return { title: t('tab_price'), html: `<div class="hint">${esc(t('no_prices'))}</div>` };
      const b = pv.breakdown;
      let bar = '';
      if (b && b.market !== null) {
        const parts = [[t('market'), b.market, '#4da3ff'], [t('fee'), b.fee, '#8fc4ff'], [t('tax'), b.tax, '#ffc699'], [t('vat'), b.vat, '#ff9a4d']];
        const tot = parts.reduce((s, p) => s + Math.max(0, p[1]), 0) || 1;
        bar = `<div class="small muted">${esc(t('build_up'))}</div><div class="stack-bar">${parts.map((p) => `<span style="flex:${Math.max(0.02, Math.max(0, p[1]) / tot)};background:${p[2]}">${esc(p[0])} € ${num(p[1], 3)}</span>`).join('')}</div>`;
      }
      const tags = [];
      if (pv.today.cheap) tags.push(`<span class="tag good">${esc(t('cheap'))}: ${hhmm(pv.today.cheap.start)}–${hhmm(pv.today.cheap.end)} · € ${num(pv.today.cheap.average)}</span>`);
      if (pv.today.dear) tags.push(`<span class="tag bad">${esc(t('expensive'))}: ${hhmm(pv.today.dear.start)}–${hhmm(pv.today.dear.end)} · € ${num(pv.today.dear.average)}</span>`);
      if (pv.tomorrow && pv.tomorrow.cheap) tags.push(`<span class="tag good">${esc(t('tomorrow'))}: ${hhmm(pv.tomorrow.cheap.start)}–${hhmm(pv.tomorrow.cheap.end)} · € ${num(pv.tomorrow.cheap.average)}</span>`);
      const warn = (pv.warnings || []).map((w) => `<div class="warn">${esc(w)}</div>`).join('');
      return {
        title: t('tab_price'),
        html: `<div class="stats">${stat(t('now'), `€ ${num(pv.current.total)}`, pv.now_color)}${stat(t('average'), `€ ${num(pv.today.average)}`)}${stat(t('lowest'), pv.today.low ? `€ ${num(pv.today.low.total)}` : '—', 'var(--good)')}${stat(t('highest'), pv.today.high ? `€ ${num(pv.today.high.total)}` : '—', 'var(--bad)')}</div>${bar}<div class="tags">${tags.join('')}</div>${warn}`,
      };
    }
    if (kind === 'flow') {
      const f = S.live && S.live.flows;
      const ph = f && f.grid && f.grid.phases_w;
      const phases = ph ? `<div class="stats">${ph.map((w, i) => (w === null ? '' : stat(t('phase', { n: i + 1 }), `${power(w).v} ${power(w).u}`))).join('')}</div>` : '';
      const hist = await api('api/history?key=grid').catch(() => null);
      const d = S.today;
      return {
        title: t('flows'),
        html: `${phases}<div class="stats">${stat(t('import_today'), d ? `${num(d.import_kwh, 1)} kWh` : '—')}${stat(t('export_today'), d ? `${num(d.export_kwh, 1)} kWh` : '—')}${stat(t('home'), `${power(f && f.home_w).v} ${power(f && f.home_w).u}`, 'var(--home)')}${stat(t('rest'), `${power(f && f.rest_w).v} ${power(f && f.rest_w).u}`)}</div><div class="small muted">${esc(t('last_24h'))}</div>${hist ? miniChart(hist.series, ['#4da3ff', '#f5c542']) : ''}`,
      };
    }
    if (kind === 'cost' || kind === 'usage') {
      const [today, yday] = await Promise.all([api('api/day?offset=0'), api('api/day?offset=-1').catch(() => null)]);
      const fixed = today.fixed_per_day ? stat(t('fixed_costs'), `€ ${num(today.fixed_per_day)}`) : '';
      const rows = `<div class="stats">${stat(t('today'), today.priced ? `€ ${num(today.cost)}` : '—')}${stat(t('yesterday'), yday && yday.priced ? `€ ${num(yday.cost)}` : '—')}${stat(t('import_today'), `${num(today.import_kwh, 1)} kWh`)}${stat(t('export_today'), `${num(today.export_kwh, 1)} kWh`)}${fixed}${today.gas_m3 !== null ? stat(t('gas_today'), `${num(today.gas_m3, 2)} m³`) : ''}</div>`;
      const series = [today.hours.map((h) => ({ t: h.start, v: h.known ? h.import : null })), today.hours.map((h) => ({ t: h.start, v: h.known ? h.export : null }))];
      const note = today.unpriced_kwh > 0.01 ? `<div class="hint">${esc(t('not_priced'))}</div>` : '';
      return { title: kind === 'cost' ? t('cost') : t('tab_usage'), html: `${rows}${miniChart(series, ['#4da3ff', '#f5c542'])}${note}` };
    }
    if (kind.startsWith('module:')) {
      const id = kind.slice(7);
      const m = S.settings.modules.find((x) => x.id === id);
      const live = S.live && S.live.flows.modules.find((x) => x.id === id);
      const hist = await api(`api/history?key=${encodeURIComponent(id)}`).catch(() => null);
      const p = power(live && live.power_w);
      return {
        title: m ? m.name : id,
        html: `<div class="stats">${stat(t('now'), `${p.v} ${p.u}`, TYPE_COLOR[m ? m.type : 'device'])}${live && live.soc !== null ? stat('%', `${Math.round(live.soc)}%`) : ''}</div><div class="small muted">${esc(t('last_24h'))}</div>${hist ? miniChart(hist.series, ['#b38cff']) : ''}`,
      };
    }
    if (kind.startsWith('planner:')) {
      const key = kind.slice(8);
      const list = S.planners ? S.planners[key] : null;
      if (!list) return { title: t(key), html: `<div class="hint">${esc(t('not_found'))}</div>` };
      return { title: t(key), html: `<div class="stats">${list.slice(0, 12).map((x) => stat(x.name.replace(/^Smart (Charging|Heating)( Planner)?\s*/i, ''), esc(`${x.state}${x.unit ? ` ${x.unit}` : ''}`))).join('')}</div>` };
    }
    return { title: '', html: '' };
  }

  async function openPopup(kind) {
    S.popup = kind;
    S.popupAt = Date.now();
    $('popTitle').textContent = '…';
    $('popBody').innerHTML = `<div class="hint">${esc(S.t('loading'))}</div>`;
    $('popup').hidden = false;
    $('popClose').setAttribute('aria-label', S.t('close'));
    try {
      const c = await popupContent(kind);
      if (S.popup !== kind) return;
      $('popTitle').textContent = c.title;
      $('popBody').innerHTML = c.html;
    } catch (err) {
      $('popBody').innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
  }
  function closePopup() {
    S.popup = null;
    $('popup').hidden = true;
  }
  S.closePopup = closePopup;

  // ---------------------------------------------------------------- idle

  function tickIdle() {
    const st = S.settings;
    if (!st) return;
    const now = Date.now();
    if (S.popup) {
      const limit = st.idle.popup_seconds * 1000;
      const left = Math.max(0, Math.ceil((limit - (now - Math.max(S.popupAt, S.lastTouch))) / 1000));
      $('popTimer').textContent = limit ? S.t('closes_in', { s: left }) : '';
      if (limit && left <= 0) closePopup();
    }
    const home = st.idle.home_seconds * 1000;
    if (home && now - S.lastTouch > home && $('setup').hidden) {
      if (S.popup) closePopup();
      if (S.chartTab !== st.chart_default || S.chartDay !== 0) {
        S.chartTab = st.chart_default;
        S.chartDay = 0;
        renderChart();
      }
    }
  }

  // ---------------------------------------------------------------- loading

  async function loadLive() {
    try {
      S.live = await api('api/live');
      $('banner').hidden = true;
    } catch (err) {
      $('banner').textContent = err.message.includes('Not connected') ? S.t('not_connected') : err.message;
      $('banner').hidden = false;
    }
    applyEdge();
    renderHeader();
    renderFlow();
    renderTiles();
  }

  async function loadPrices() {
    try { S.prices = await api('api/prices'); } catch { /* keep the last */ }
    renderChart();
  }

  async function loadDay() {
    try {
      const off = S.chartTab === 'usage' ? S.chartDay : 0;
      const d = await api(`api/day?offset=${off}`);
      d.offset = off;
      S.day = d;
      if (off === 0) S.today = d;
    } catch { /* keep the last */ }
  }

  async function loadToday() {
    try {
      const d = await api('api/day?offset=0');
      d.offset = 0;
      S.today = d;
      if (!S.day || S.day.offset === 0) S.day = d;
    } catch { /* keep */ }
    renderTiles();
    if (S.chartTab === 'usage') renderChart();
  }

  async function loadSlow() {
    try { S.planners = await api('api/planners'); } catch { /* none */ }
    try { S.solar = await api('api/solar'); } catch { /* none */ }
    renderTiles();
    if (S.chartTab === 'solar') renderChart();
  }

  async function reloadAll() {
    S.settings = await api('api/settings');
    setLanguage();
    S.chartTab = S.settings.chart_default;
    S.chartDay = 0;
    await Promise.all([loadLive(), loadPrices(), loadToday(), loadSlow()]);
  }
  S.reloadAll = reloadAll;

  async function start() {
    for (let i = 0; ; i++) {
      try {
        S.status = await api('api/status');
        if (S.status.connected) break;
      } catch { /* retry */ }
      $('banner').textContent = window.makeT('en')('not_connected');
      $('banner').hidden = false;
      await new Promise((r) => setTimeout(r, Math.min(10000, 1000 + i * 1000)));
    }
    S.settings = await api('api/settings');
    setLanguage();
    if (!S.settings.wizard_done) {
      window.EDWizard.open(true);
    }
    await reloadAll();
    setInterval(loadLive, 2000);
    setInterval(loadPrices, 60000);
    setInterval(loadToday, 5 * 60000);
    setInterval(loadSlow, 60000);
    setInterval(tickIdle, 1000);
  }

  // ---------------------------------------------------------------- events

  for (const ev of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(ev, () => { S.lastTouch = Date.now(); }, { passive: true });
  }
  $('priceNow').addEventListener('click', () => openPopup('price'));
  $('chartBtn').addEventListener('click', () => openPopup(S.chartTab === 'price' ? 'price' : 'usage'));
  $('flowCard').addEventListener('click', () => openPopup('flow'));
  $('popClose').addEventListener('click', closePopup);
  $('popup').addEventListener('click', (e) => { if (e.target === $('popup')) closePopup(); });
  $('openSettings').addEventListener('click', () => window.EDWizard.open(false));

  window.addEventListener('DOMContentLoaded', () => start());
}());
