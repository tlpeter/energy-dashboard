'use strict';

// Set-up wizard (first start) and Settings (the gear): the same sections,
// once as steps, once as tabs. Works on a copy of the settings; nothing is
// stored until Finish / Save.

(function () {
  const ED = window.ED;
  const $ = (id) => document.getElementById(id);
  const STEPS = ['language', 'meter', 'supplier', 'devices', 'edge', 'done'];
  const TAB_STEPS = ['language', 'meter', 'supplier', 'devices', 'edge'];
  const TITLES = { language: 'w_language', meter: 'w_meter', supplier: 'w_supplier', devices: 'w_devices', edge: 'w_edge', done: 'w_done' };
  const TILE_KEYS = ['cost', 'usage', 'gas', 'charging_planner', 'heating_planner', 'modules'];
  const TILE_LABEL = { cost: 'cost_today', usage: 'usage_today', gas: 'gas_today', charging_planner: 'charging_planner', heating_planner: 'heating_planner', modules: 'w_devices' };

  const W = { wizard: true, step: 0, draft: null, detect: null, error: '', search: '' };

  const esc = (v) => ED.esc(v);
  const t = (k, v) => ED.t(k, v);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // -------------------------------------------------------------- inputs

  function sensorOptions(filter, current) {
    const list = (W.detect ? W.detect.sensors : []).filter(filter);
    if (current && !list.some((s) => s.entity_id === current)) list.unshift({ entity_id: current, name: current });
    return [`<option value="">${esc(t('none'))}</option>`]
      .concat(list.map((s) => `<option value="${esc(s.entity_id)}"${s.entity_id === current ? ' selected' : ''}>${esc(s.name)} (${esc(s.entity_id)})</option>`)).join('');
  }
  const isPower = (s) => s.device_class === 'power' || /^k?W$/.test(String(s.unit || ''));
  const isEnergy = (s) => s.device_class === 'energy' || /^k?Wh$/.test(String(s.unit || ''));
  const isGas = (s) => s.device_class === 'gas' || s.unit === 'm³';
  const isPct = (s) => s.device_class === 'battery' || s.unit === '%';

  function field(label, control, hint) {
    return `<label class="field"><span>${esc(label)}${hint ? `<br><span class="hint">${esc(hint)}</span>` : ''}</span>${control}</label>`;
  }
  function select(path, options) {
    return `<select data-path="${path}">${options}</select>`;
  }
  function numberInput(path, value, step = 'any') {
    return `<input type="number" inputmode="decimal" step="${step}" data-path="${path}" value="${value === null || value === undefined ? '' : esc(value)}">`;
  }
  function textInput(path, value) {
    return `<input type="text" data-path="${path}" value="${esc(value ?? '')}">`;
  }
  function check(path, on) {
    return `<input type="checkbox" data-path="${path}"${on ? ' checked' : ''}>`;
  }
  function choice(action, value, on, label, small) {
    return `<button type="button" class="choice${on ? ' on' : ''}" data-action="${action}" data-value="${esc(value)}">${esc(label)}${small ? `<small>${esc(small)}</small>` : ''}</button>`;
  }

  // Write an input back into the draft (data-path="a.b.0.c").
  function setPath(path, raw, type) {
    const parts = path.split('.');
    let o = W.draft;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (o[k] === null || o[k] === undefined) o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      o = o[k];
    }
    let v = raw;
    if (type === 'checkbox') v = !!raw;
    else if (type === 'number') v = raw === '' ? null : Number(raw);
    else if (v === '') v = null;
    o[parts[parts.length - 1]] = v;
  }

  // -------------------------------------------------------------- sections

  function secLanguage() {
    const l = W.draft.language;
    return `<div class="panel"><h3>${esc(t('w_language_q'))}</h3><div class="choices">${choice('lang', 'auto', l === 'auto', t('lang_auto'))}${choice('lang', 'nl', l === 'nl', 'Nederlands')}${choice('lang', 'en', l === 'en', 'English')}</div></div>`;
  }

  function fmtW(w) {
    if (w === null || w === undefined || !Number.isFinite(w.net_w)) return '';
    return t('w_now', { v: `${Math.round(w.net_w)} W` });
  }

  function secMeter() {
    const d = W.detect;
    const m = W.draft.meter || { meter: 'manual', energy_import: [], energy_export: [], phases: [{}, {}, {}] };
    W.draft.meter = m;
    const found = d.meters.map((x) => choice('meter', x.id, m.source_id === x.id, x.name, [x.detail, fmtW(x.sample_w)].filter(Boolean).join(' · ')));
    found.push(choice('meter', 'manual', m.meter === 'manual' && !m.source_id, t('w_meter_manual')));
    const ei = m.energy_import || [];
    const ee = m.energy_export || [];
    const phases = (m.phases || [{}, {}, {}]);
    return `<div class="panel"><h3>${esc(t('w_meter_q'))}</h3>
      <div class="hint">${esc(d.meters.length ? t('w_meter_found') : t('w_meter_none'))}</div>
      <div class="choices">${found.join('')}</div></div>
      <div class="panel">
        ${field(t('power_net'), select('meter.power_net', sensorOptions(isPower, m.power_net)))}
        ${field(t('power_import'), select('meter.power_import', sensorOptions(isPower, m.power_import)))}
        ${field(t('power_export'), select('meter.power_export', sensorOptions(isPower, m.power_export)))}
        ${field(t('invert_net'), check('meter.invert_net', m.invert_net))}
        ${[0, 1].map((i) => field(`${t('energy_import')} ${i + 1}`, select(`meter.energy_import.${i}`, sensorOptions(isEnergy, ei[i])))).join('')}
        ${[0, 1].map((i) => field(`${t('energy_export')} ${i + 1}`, select(`meter.energy_export.${i}`, sensorOptions(isEnergy, ee[i])))).join('')}
        ${[0, 1, 2].map((i) => field(`${t('phase', { n: i + 1 })} (W)`, select(`meter.phases.${i}.${phases[i] && phases[i].import ? 'import' : 'net'}`, sensorOptions(isPower, phases[i] && (phases[i].net || phases[i].import))))).join('')}
        ${field(t('gas'), select('meter.gas', sensorOptions(isGas, m.gas)))}
      </div>`;
  }

  function secSupplier() {
    const d = W.detect;
    const p = W.draft.price;
    const q = W.search.toLowerCase();
    const sups = d.suppliers.filter((s) => !q || s.name.toLowerCase().includes(q));
    const supHtml = sups.map((s) => choice('supplier', s.id, p.supplier === s.id, s.id === 'other' ? (ED.lang === 'nl' ? 'Anders / handmatig' : s.name) : s.name)).join('');
    const src = p.source;
    const srcId = src ? src.id : null;
    const sources = d.price_sources.map((s) => choice('source', s.id, srcId === s.id, s.name, s.detail || ''));
    sources.push(choice('source', 'fixed', srcId === 'fixed', t('fixed_tariff')));
    const preset = d.suppliers.find((s) => s.id === p.supplier);
    const presetNote = preset ? (preset.fee === null ? t('preset_unknown') : t('preset_note', { d: d.suppliers_checked })) : '';
    const fixed = srcId === 'fixed' ? `${field(t('fixed_normal'), numberInput('price.source.normal', src.normal))}${field(t('fixed_low'), numberInput('price.source.low', src.low))}` : '';
    const allIn = p.price_type === 'all_in' || srcId === 'fixed';
    return `<div class="panel"><h3>${esc(t('w_supplier_q'))}</h3>
        <input class="search" type="text" data-action="search" placeholder="${esc(t('search'))}" value="${esc(W.search)}">
        <div class="choices">${supHtml}</div>
        ${presetNote ? `<div class="hint">${esc(presetNote)}</div>` : ''}
      </div>
      <div class="panel"><h3>${esc(t('w_source'))}</h3>
        ${d.price_sources.length ? '' : `<div class="hint">${esc(t('w_source_none'))}</div>`}
        <div class="choices">${sources.join('')}</div>
        ${fixed}
        ${srcId && srcId !== 'fixed' ? field(t('price_type'), select('price.price_type', [['market_excl_vat', 'pt_excl'], ['market_incl_vat', 'pt_incl'], ['all_in', 'pt_allin']].map(([v, k]) => `<option value="${v}"${p.price_type === v ? ' selected' : ''}>${esc(t(k))}</option>`).join(''))) : ''}
      </div>
      <div class="panel">
        ${allIn ? '' : field(t('fee_incl'), numberInput('price.fee_incl_vat', p.fee_incl_vat))}
        ${allIn ? '' : field(t('tax_incl'), numberInput('price.energy_tax_incl_vat', p.energy_tax_incl_vat))}
        ${allIn ? '' : field(t('vat_pct'), numberInput('price.vat_percent', p.vat_percent))}
        ${field(t('fixed_month'), numberInput('price.fixed_month', p.fixed_month))}
        ${field(t('compare_tariff'), numberInput('price.compare_tariff', p.compare_tariff))}
        ${field(t('export_mode'), select('price.export_mode', [['auto', 'em_auto'], ['net_metering', 'em_net'], ['market', 'em_market']].map(([v, k]) => `<option value="${v}"${p.export_mode === v ? ' selected' : ''}>${esc(t(k))}</option>`).join('')))}
        ${field(t('export_fee'), numberInput('price.export_fee_incl_vat', p.export_fee_incl_vat))}
      </div>`;
  }

  const TYPES = ['ev', 'heatpump', 'solar', 'battery', 'device'];
  function secDevices() {
    const mods = W.draft.modules;
    const rows = mods.map((m, i) => `<div class="dev-row">
        ${field(t('device_type'), select(`modules.${i}.type`, TYPES.map((ty) => `<option value="${ty}"${m.type === ty ? ' selected' : ''}>${esc(t(ty))}</option>`).join('')))}
        ${field(t('device_name'), textInput(`modules.${i}.name`, m.name))}
        ${field(t('power_sensor'), select(`modules.${i}.power_entity`, sensorOptions(isPower, m.power_entity)))}
        ${['ev', 'battery'].includes(m.type) ? field(t('soc_sensor'), select(`modules.${i}.soc_entity`, sensorOptions(isPct, m.soc_entity))) : '<span></span>'}
        ${field(t('invert'), check(`modules.${i}.invert`, m.invert))}
        <div class="row">
          <button type="button" class="btn small" data-action="dev-up" data-value="${i}">${esc(t('up'))}</button>
          <button type="button" class="btn small" data-action="dev-down" data-value="${i}">${esc(t('down'))}</button>
          <button type="button" class="btn small danger" data-action="dev-remove" data-value="${i}">${esc(t('remove'))}</button>
        </div></div>`).join('');
    return `<div class="panel"><h3>${esc(t('w_devices_q'))}</h3>${rows}
      <div><button type="button" class="btn" data-action="dev-add">+ ${esc(t('add_device'))}</button></div></div>`;
  }

  function secEdge() {
    const e = W.draft.edge;
    const th = W.draft.theme;
    const opt = (list, cur) => list.map(([v, k]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${esc(t(k))}</option>`).join('');
    const tiles = TILE_KEYS.map((k) => {
      const on = W.draft.tiles.includes(k);
      return `<div class="row" style="justify-content:space-between"><label class="row"><input type="checkbox" data-action="tile" data-value="${k}"${on ? ' checked' : ''}> ${esc(t(TILE_LABEL[k]))}</label>
        ${on ? `<span class="row"><button type="button" class="btn small" data-action="tile-up" data-value="${k}">${esc(t('up'))}</button><button type="button" class="btn small" data-action="tile-down" data-value="${k}">${esc(t('down'))}</button></span>` : ''}</div>`;
    }).join('');
    return `<div class="panel"><h3>${esc(t('w_edge_q'))}</h3>
        ${field(t('edge_ref'), select('edge.reference', opt([['today', 'ref_today'], ['today_tomorrow', 'ref_tt'], ['next24', 'ref_24']], e.reference)))}
        ${field(t('edge_band'), numberInput('edge.band', e.band, 1))}
        ${field(t('edge_width'), numberInput('edge.width', e.width, 1))}
        ${field(t('edge_glow'), numberInput('edge.glow', e.glow, 1))}
        ${field(t('edge_pulse'), check('edge.pulse', e.pulse))}
      </div>
      <div class="panel">
        ${field(t('night'), select('theme.night', opt([['off', 'night_off'], ['sun', 'night_sun'], ['times', 'night_times']], th.night)))}
        ${th.night === 'times' ? field(t('night_from'), `<input type="text" data-path="theme.night_from" value="${esc(th.night_from)}" placeholder="22:30">`) + field(t('night_to'), `<input type="text" data-path="theme.night_to" value="${esc(th.night_to)}" placeholder="06:30">`) : ''}
        ${field(t('night_dim'), numberInput('theme.dim', th.dim, 1))}
        ${field(t('idle_home'), numberInput('idle.home_seconds', W.draft.idle.home_seconds, 1))}
        ${field(t('idle_popup'), numberInput('idle.popup_seconds', W.draft.idle.popup_seconds, 1))}
      </div>
      <div class="panel"><h3>${esc(t('tiles'))}</h3>${tiles}</div>`;
  }

  function secDone() {
    return `<div class="panel"><h3>${esc(t('w_done'))}</h3><div>${esc(t('w_done_text'))}</div></div>`;
  }

  const SECTIONS = { language: secLanguage, meter: secMeter, supplier: secSupplier, devices: secDevices, edge: secEdge, done: secDone };

  // -------------------------------------------------------------- render

  function render() {
    const root = $('setup');
    const list = W.wizard ? STEPS : TAB_STEPS;
    const key = list[W.step];
    let head;
    if (W.wizard) {
      const bars = list.map((s, i) => `<div class="bar1${i < W.step ? ' done' : i === W.step ? ' cur' : ''}"></div>`).join('');
      const labs = list.map((s, i) => `<span class="lab${i === W.step ? ' cur' : ''}">${esc(t(TITLES[s]))}</span>`).join('');
      head = `<div class="hint">${esc(t('w_title'))} · ${esc(t('w_step', { n: W.step + 1, t: list.length }))}</div><h1>${esc(t(TITLES[key]))}</h1>
        <div class="steps" style="grid-template-columns:repeat(${list.length},minmax(0,1fr))">${bars}${labs}</div>`;
    } else {
      head = `<div class="row" style="justify-content:space-between"><h1>${esc(t('settings'))}</h1><span class="hint">${esc(t('version', { v: (ED.status && ED.status.version) || '' }))}</span></div>
        <div class="tabs">${list.map((s, i) => `<button type="button" class="chip soft${i === W.step ? ' on' : ''}" data-action="tab" data-value="${i}">${esc(t(TITLES[s]))}</button>`).join('')}</div>`;
    }
    const body = W.detect ? SECTIONS[key]() : `<div class="hint">${esc(t('loading'))}</div>`;
    const err = W.error ? `<div class="err">${esc(W.error)}</div>` : '';
    let actions;
    if (W.wizard) {
      const last = W.step === list.length - 1;
      actions = `<div class="actions"><button type="button" class="btn" data-action="prev"${W.step === 0 ? ' hidden' : ''}>${esc(t('back'))}</button>
        <button type="button" class="btn primary" data-action="${last ? 'finish' : 'next'}">${esc(last ? t('finish') : t('next'))}</button></div>`;
    } else {
      actions = `<div class="actions"><span class="row"><button type="button" class="btn" data-action="cancel">${esc(t('cancel'))}</button>
        <button type="button" class="btn" data-action="diag">${esc(t('diagnostics'))}</button></span>
        <button type="button" class="btn primary" data-action="save">${esc(t('save'))}</button></div>`;
    }
    root.innerHTML = `${head}${err}${body}${actions}`;
  }

  // -------------------------------------------------------------- actions

  function pickMeter(id) {
    if (id === 'manual') {
      W.draft.meter = { meter: 'manual', power_net: null, power_import: null, power_export: null, invert_net: false, energy_import: [], energy_export: [], phases: [{}, {}, {}], gas: null };
      return;
    }
    const m = W.detect.meters.find((x) => x.id === id);
    if (!m) return;
    W.draft.meter = { meter: m.meter, source_id: m.id, invert_net: false, ...clone(m.roles) };
  }

  function pickSupplier(id) {
    const s = W.detect.suppliers.find((x) => x.id === id);
    if (!s) return;
    const p = W.draft.price;
    p.supplier = id;
    p.fee_incl_vat = s.preset.fee_incl_vat;
    p.fixed_month = s.preset.fixed_month;
    p.energy_tax_incl_vat = s.preset.energy_tax_incl_vat;
    p.vat_percent = s.preset.vat_percent;
    // The supplier's own integration, when it is installed.
    if (s.integration) {
      const src = W.detect.price_sources.find((x) => x.domain === s.integration);
      if (src) pickSource(src.id);
    }
  }

  function pickSource(id) {
    const p = W.draft.price;
    if (id === 'fixed') {
      p.source = { id: 'fixed', type: 'fixed', mode: 'single', normal: (p.source && p.source.normal) || null, low: null };
      p.price_type = 'all_in';
      return;
    }
    const s = W.detect.price_sources.find((x) => x.id === id);
    if (!s) return;
    p.source = s.type === 'action'
      ? { id: s.id, type: 'action', domain: s.domain, config_entry: s.config_entry }
      : { id: s.id, type: 'attribute', entity_id: s.entity_id };
    p.price_type = s.price_type || 'market_excl_vat';
  }

  // Tidy the draft before it goes to the server.
  function cleaned() {
    const d = clone(W.draft);
    if (d.meter) {
      delete d.meter.source_id;
      d.meter.energy_import = (d.meter.energy_import || []).filter(Boolean);
      d.meter.energy_export = (d.meter.energy_export || []).filter(Boolean);
      if (d.price && d.price.source && d.price.source.type === 'fixed' && d.price.source.low) d.price.source.mode = 'day_night';
    }
    return d;
  }

  async function saveDraft(done) {
    W.error = '';
    const body = cleaned();
    if (done) body.wizard_done = true;
    try {
      const saved = await ED.api('api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      W.draft = clone(saved);
      return true;
    } catch (err) {
      W.error = err.message;
      render();
      return false;
    }
  }

  async function close(reload) {
    $('setup').hidden = true;
    if (reload) await ED.reloadAll();
  }

  async function onAction(action, value) {
    const list = W.wizard ? STEPS : TAB_STEPS;
    switch (action) {
      case 'lang':
        W.draft.language = value;
        ED.settings = { ...ED.settings, language: value };
        ED.setLanguage();
        break;
      case 'meter': pickMeter(value); break;
      case 'supplier': pickSupplier(value); break;
      case 'source': pickSource(value); break;
      case 'dev-add':
        W.draft.modules.push({ id: `dev_${Date.now().toString(36)}`, type: 'ev', name: t('ev'), power_entity: null, soc_entity: null, invert: false, enabled: true });
        break;
      case 'dev-remove': W.draft.modules.splice(Number(value), 1); break;
      case 'dev-up':
      case 'dev-down': {
        const i = Number(value);
        const j = action === 'dev-up' ? i - 1 : i + 1;
        const m = W.draft.modules;
        if (j >= 0 && j < m.length) [m[i], m[j]] = [m[j], m[i]];
        break;
      }
      case 'tile': {
        const tl = W.draft.tiles;
        if (tl.includes(value)) tl.splice(tl.indexOf(value), 1); else tl.push(value);
        break;
      }
      case 'tile-up':
      case 'tile-down': {
        const tl = W.draft.tiles;
        const i = tl.indexOf(value);
        const j = action === 'tile-up' ? i - 1 : i + 1;
        if (i >= 0 && j >= 0 && j < tl.length) [tl[i], tl[j]] = [tl[j], tl[i]];
        break;
      }
      case 'tab': W.step = Number(value); W.error = ''; break;
      case 'prev': W.step = Math.max(0, W.step - 1); W.error = ''; break;
      case 'next':
        // Save after every step, so a mistake shows on the step that made it.
        if (W.step >= 1 && !(await saveDraft(false))) return;
        W.step = Math.min(list.length - 1, W.step + 1);
        break;
      case 'finish':
        if (await saveDraft(true)) { await close(true); return; }
        return;
      case 'save':
        if (await saveDraft(W.draft.wizard_done)) { await close(true); return; }
        return;
      case 'cancel':
        ED.settings = await ED.api('api/settings');
        ED.setLanguage();
        await close(false);
        return;
      case 'diag': {
        const data = await ED.api('api/diagnostics');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'energy-dashboard-diagnostics.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      default: return;
    }
    render();
  }

  // -------------------------------------------------------------- events

  const root = $('setup');
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.tagName === 'INPUT') return;
    onAction(b.dataset.action, b.dataset.value);
  });
  root.addEventListener('change', (e) => {
    const n = e.target;
    if (n.dataset.action === 'tile') { onAction('tile', n.dataset.value); return; }
    if (!n.dataset.path) return;
    setPath(n.dataset.path, n.type === 'checkbox' ? n.checked : n.value, n.type);
    // Some choices change which fields are shown.
    if (/^modules\.\d+\.type$|^theme\.night$|^price\.price_type$/.test(n.dataset.path)) render();
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.action === 'search') {
      W.search = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const s = root.querySelector('[data-action="search"]');
      if (s) { s.focus(); s.setSelectionRange(pos, pos); }
    }
  });

  window.EDWizard = {
    async open(wizard) {
      W.wizard = wizard;
      W.step = 0;
      W.error = '';
      W.search = '';
      W.draft = clone(ED.settings);
      W.detect = null;
      $('setup').hidden = false;
      ED.closePopup();
      render();
      try {
        W.detect = await ED.api('api/detect');
      } catch (err) {
        W.error = err.message;
        W.detect = { meters: [], price_sources: [], suppliers: [], sensors: [], planners: {} };
      }
      render();
    },
  };
}());
