/* IM-Vermietung – Maschinenvermietung: Einsätze erfassen, importieren, auswerten, abrechnen.
   Eigenständige Web-App (ohne Fremdbibliotheken). Daten lokal im Browser + Abgleich mit Dropbox (eigene Datei). */
'use strict';

const APP_VERSION = '1.6', APP_STAND = '14.11.2026';
const CFG = Object.assign({ appKey: '', dataPath: '/vermietung.json' }, window.APP_CONFIG || {});
const COLL = ['kunden', 'maschinen', 'einsaetze', 'einstellungen'];
const EINHEITEN = ['ha', 'h'];
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const QUELLEN = ['Manuell', 'Formular', 'Scan', 'Scan + Formular'];
const DEF_MODEL = 'claude-sonnet-5-5';

/* ================= Hilfsfunktionen ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoDate(new Date());
const fmtDate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const fmtNum = (n, max = 2) => (n === '' || n == null || isNaN(n)) ? '' : Number(n).toLocaleString('de-CH', { maximumFractionDigits: max });
const fmtQty = n => (n == null || isNaN(n)) ? '' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const chf = n => (n == null || isNaN(n)) ? '' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => { if (v === '' || v == null) return null; if (typeof v === 'number') return isFinite(v) ? v : null; const n = parseFloat(String(v).replace(',', '.').replace(/['’\s]/g, '')); return isNaN(n) ? null : n; };
const r2 = n => Math.round(n * 100) / 100;
const ls = (key, val) => { try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch { return null; } };
const lsJson = (key, val) => { if (val === undefined) { try { return JSON.parse(ls(key) || 'null'); } catch { return null; } } ls(key, val === null ? null : JSON.stringify(val)); };
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
// Namen vergleichbar machen (Umlaute, Satzzeichen, Reihenfolge der Wörter)
const fold = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/é|è|ê/g, 'e').replace(/ß/g, 'ss')
  .replace(/gebrüder|gebrueder|gebr\./g, 'gebr ').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = s => fold(s).split(' ').filter(Boolean);
const tokKey = s => tokens(s).sort().join(' ');
function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[b.length];
}
const simil = (a, b) => { const x = tokKey(a), y = tokKey(b); if (!x || !y) return 0; return 1 - lev(x, y) / Math.max(x.length, y.length); };

/* ================= Datenhaltung ================= */
const Store = {
  data: null,
  load() {
    this.data = lsJson('mv_data');
    if (!this.data || typeof this.data !== 'object') this.data = { v: 1 };
    COLL.forEach(c => { if (!Array.isArray(this.data[c])) this.data[c] = []; });
  },
  async seed() { // Startdaten (bereinigte Einsätze 2025/26) einmalig übernehmen – feste IDs, damit mehrere Geräte nichts doppelt anlegen
    if (ls('mv_seeded')) return;
    try {
      const r = await fetch('startdaten.json', { cache: 'no-store' }); if (!r.ok) return;
      const s = await r.json();
      this.data = mergeData(s, this.data); this.save(); ls('mv_seeded', '1');
    } catch (e) { console.warn('Startdaten', e); }
  },
  save() { ls('mv_data', JSON.stringify(this.data)); },
  all(c) { return this.data[c].filter(x => !x.del); },
  get(c, id) { return id ? this.data[c].find(x => x.id === id && !x.del) : null; },
  put(c, obj, { silent } = {}) {
    obj.upd = Date.now();
    const i = this.data[c].findIndex(x => x.id === obj.id);
    if (i >= 0) this.data[c][i] = obj; else this.data[c].push(obj);
    this.save(); Sync.schedule(); if (!silent) App.render();
    return obj;
  },
  putMany(c, list, { silent } = {}) {
    const now = Date.now();
    list.forEach(obj => { obj.upd = now; const i = this.data[c].findIndex(x => x.id === obj.id); if (i >= 0) this.data[c][i] = obj; else this.data[c].push(obj); });
    this.save(); Sync.schedule(); if (!silent) App.render();
  },
  remove(c, ids) {
    const now = Date.now();
    [].concat(ids).forEach(id => { const o = this.data[c].find(x => x.id === id); if (!o) return; Object.keys(o).forEach(k => { if (k !== 'id') delete o[k]; }); o.del = true; o.upd = now; });
    this.save(); Sync.schedule(); App.render();
  },
  cfg() { return Object.assign({ firma: 'Indermühle Lohnarbeiten · Maschinenvermietung', rapportPreise: false }, this.get('einstellungen', 'cfg') || {}); },
  setCfg(patch) { return this.put('einstellungen', Object.assign({ id: 'cfg' }, this.get('einstellungen', 'cfg') || {}, patch), { silent: true }); }
};
function mergeData(a, b) {
  const out = { v: 1 };
  COLL.forEach(c => {
    const m = new Map();
    (a[c] || []).forEach(x => m.set(x.id, x));
    (b[c] || []).forEach(x => { const y = m.get(x.id); if (!y || (x.upd || 0) > (y.upd || 0)) m.set(x.id, x); });
    out[c] = [...m.values()];
  });
  return out;
}
function sameData(a, b) {
  return COLL.every(c => {
    const A = a[c] || [], B = b[c] || [];
    if (A.length !== B.length) return false;
    const m = new Map(B.map(x => [x.id, x.upd || 0]));
    return A.every(x => m.get(x.id) === (x.upd || 0));
  });
}

/* ================= Dropbox-Anmeldung (OAuth 2.0 + PKCE, ohne Server) ================= */
const Auth = {
  configured() { return /^[a-z0-9]{8,30}$/i.test(CFG.appKey || ''); },
  redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); },
  tokens() { return lsJson('mv_tok'); },
  hasSession() { const t = this.tokens(); return !!(t && (t.refresh || t.access)); },
  b64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  async login() {
    if (!this.configured()) { toast('Zuerst den App-Key in config.js eintragen.'); return; }
    if (!window.crypto?.subtle) { toast('Anmeldung nur über https möglich.'); return; }
    const verifier = this.b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = this.b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = this.b64url(crypto.getRandomValues(new Uint8Array(16)));
    lsJson('mv_pkce', { verifier, state });
    const p = new URLSearchParams({ client_id: CFG.appKey, response_type: 'code', redirect_uri: this.redirectUri(), state, code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline' });
    location.assign(`https://www.dropbox.com/oauth2/authorize?${p}`);
  },
  async handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    history.replaceState(null, '', this.redirectUri());
    const msp = lsJson('mv_mspkce'); if (msp && msp.state === q.get('state')) return MS.handleRedirect(q, msp); // Microsoft-Anmeldung
    if (q.has('error')) { toast('Anmeldung abgebrochen: ' + (q.get('error_description') || q.get('error')), 6000); return; }
    const pk = lsJson('mv_pkce'); ls('mv_pkce', null);
    if (!pk || pk.state !== q.get('state')) { toast('Anmeldung ungültig – bitte nochmals versuchen.'); return; }
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CFG.appKey, grant_type: 'authorization_code', code: q.get('code'), redirect_uri: this.redirectUri(), code_verifier: pk.verifier }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast('Anmeldung fehlgeschlagen: ' + (j.error_description || j.error || r.status), 8000); return; }
    this.store(j);
    try { const me = await (await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { Authorization: 'Bearer ' + j.access_token } })).json(); ls('mv_user', me.name?.display_name || me.email || ''); } catch {}
    toast('Mit Dropbox verbunden');
  },
  store(j) { lsJson('mv_tok', { access: j.access_token, refresh: j.refresh_token || this.tokens()?.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 }); },
  async token() {
    const t = this.tokens(); if (!t) return null;
    if (t.access && t.exp - 120000 > Date.now()) return t.access;
    if (!t.refresh) return null;
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CFG.appKey, grant_type: 'refresh_token', refresh_token: t.refresh }) });
    if (r.status === 400 || r.status === 401) { ls('mv_tok', null); return null; }
    if (!r.ok) throw new Error('Dropbox nicht erreichbar (' + r.status + ')');
    const j = await r.json(); this.store(j); return j.access_token;
  },
  async logout() {
    const t = this.tokens();
    if (t?.access && navigator.onLine) { try { await fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t.access } }); } catch {} }
    ls('mv_tok', null); ls('mv_user', null); Sync.setState('login'); App.render();
  }
};
const dbxArg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const Drive = {
  path() { const p = (CFG.dataPath || '/vermietung.json').trim(); return p.startsWith('/') ? p : '/' + p; },
  async req(url, opt = {}) {
    const t = await Auth.token(); if (!t) { const e = new Error('Bitte bei Dropbox anmelden'); e.auth = true; throw e; }
    opt.headers = Object.assign({}, opt.headers, { Authorization: 'Bearer ' + t });
    const r = await fetch(url, Object.assign({ method: 'POST', cache: 'no-store' }, opt));
    if (r.status === 401) { ls('mv_tok', null); const e = new Error('Bitte bei Dropbox anmelden'); e.auth = true; throw e; }
    return r;
  },
  async errSummary(r) { try { return (await r.json()).error_summary || ''; } catch { return ''; } },
  async load() {
    const r = await this.req('https://api.dropboxapi.com/2/files/get_metadata', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: this.path() }) });
    if (r.status === 409) { const s = await this.errSummary(r); if (s.includes('not_found')) return { data: null, etag: null }; throw new Error('Dropbox: ' + s); }
    if (!r.ok) throw new Error('Dropbox: Laden fehlgeschlagen (' + r.status + ')');
    const meta = await r.json();
    const r2 = await this.req('https://content.dropboxapi.com/2/files/download', { headers: { 'Dropbox-API-Arg': dbxArg({ path: 'rev:' + meta.rev }) } });
    if (!r2.ok) throw new Error('Dropbox: Laden fehlgeschlagen (' + r2.status + ')');
    return { data: JSON.parse((await r2.text()) || '{}'), etag: meta.rev };
  },
  async save(data, rev) {
    const arg = { path: this.path(), mode: rev ? { '.tag': 'update', update: rev } : 'add', autorename: false, mute: true };
    const r = await this.req('https://content.dropboxapi.com/2/files/upload', { headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg(arg) }, body: JSON.stringify(data) });
    if (r.status === 409) { const s = await this.errSummary(r); const e = new Error('Dropbox: ' + s); if (s.includes('conflict')) e.conflict = true; throw e; }
    if (!r.ok) throw new Error('Dropbox: Speichern fehlgeschlagen (' + r.status + ')');
    return (await r.json()).rev;
  }
};
const Sync = {
  state: 'idle', last: null, err: '', timer: null, running: false, again: false,
  schedule(ms = 1500) { ls('mv_dirty', '1'); this.setState(); clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); },
  setState(s) {
    if (s) this.state = s;
    const dirty = !!ls('mv_dirty'); let cls = '', txt = '';
    if (!Auth.configured()) { cls = 'warn'; txt = 'Nur lokal'; }
    else if (!Auth.hasSession() || this.state === 'login') { cls = 'warn'; txt = 'Anmelden'; }
    else if (this.state === 'busy') { cls = 'busy'; txt = 'Synchronisiere…'; }
    else if (!navigator.onLine || this.state === 'offline') { cls = 'warn'; txt = dirty ? 'Offline – lokal gespeichert' : 'Offline'; }
    else if (this.state === 'error') { cls = 'err'; txt = 'Sync-Fehler'; }
    else if (dirty) { cls = 'busy'; txt = 'Ungespeichert'; }
    else if (this.last) { cls = 'ok'; txt = 'Dropbox ' + this.last.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }); }
    else txt = 'Dropbox';
    $('#syncDot').className = 'dot ' + cls; $('#syncText').textContent = txt; $('#syncBtn').title = this.err || 'Jetzt synchronisieren';
  },
  async run() {
    if (this.running) { this.again = true; return; }
    if (!Auth.configured() || !Auth.hasSession()) { this.setState(); return; }
    if (!navigator.onLine) { this.setState('offline'); return; }
    this.running = true; this.err = ''; this.setState('busy');
    try {
      for (let i = 0; i < 4; i++) {
        const remote = await Drive.load();
        if (remote.data) {
          const merged = mergeData(Store.data, remote.data), changed = !sameData(merged, Store.data);
          Store.data = merged; Store.save();
          if (changed && !App.busy()) App.render();
          if (sameData(merged, remote.data)) break;
        }
        try { await Drive.save(Store.data, remote.etag); break; } catch (e) { if (!e.conflict || i === 3) throw e; }
      }
      ls('mv_dirty', null); this.last = new Date(); this.setState('ok');
    } catch (e) {
      this.err = e.message || String(e); this.setState(e.auth ? 'login' : (navigator.onLine ? 'error' : 'offline'));
    } finally { this.running = false; if (this.again) { this.again = false; this.run(); } }
  }
};

/* ================= Abgeleitete Angaben ================= */
const kunde = id => Store.get('kunden', id);
const masch = id => Store.get('maschinen', id);
const kName = id => kunde(id)?.name || '(ohne Kunde)';
const kNr = id => kunde(id)?.nr || '';
const kLabel = k => `${k.name}${k.nr ? ' (' + k.nr + ')' : ' (Neukunde)'}`;
const mLabel = m => `${m.artNr} ${m.name}`;
const byName = (a, b) => a.name.localeCompare(b.name, 'de');
const byArt = (a, b) => String(a.artNr || '').localeCompare(String(b.artNr || ''), 'de', { numeric: true }) || byName(a, b);
const kundenSorted = () => Store.all('kunden').sort(byName);
const maschSorted = (all = true) => Store.all('maschinen').filter(m => all || m.aktiv !== false).sort(byArt);
const einhOf = e => e.einheit || masch(e.maschine)?.einheit || 'ha';
// Preis: eigener Preis im Einsatz, sonst Maschinenpreis (nur wenn die Einheit gleich ist)
// PRICE_OV: Preise nur für den gerade gedruckten Rapport (Schlüssel Maschine|Einheit), sonst null
let PRICE_OV = null;
const preisOf = e => { if (e.preis != null) return e.preis; const k = e.maschine + '|' + einhOf(e); if (PRICE_OV && PRICE_OV.has(k)) return PRICE_OV.get(k); const m = masch(e.maschine); return m && m.preis != null && (m.einheit || 'ha') === einhOf(e) ? m.preis : null; };
const betragOf = e => { const p = preisOf(e); return p != null && e.menge != null ? r2(p * e.menge) : null; };
const isDone = e => e.status === 'abgerechnet';
const isStorno = e => e.status === 'storniert';
const isOffen = e => !isDone(e) && !isStorno(e);
const STATUS_TXT = { offen: 'offen', abgerechnet: 'abgerechnet', storniert: 'storniert' };
const statusOf = e => isDone(e) ? 'abgerechnet' : isStorno(e) ? 'storniert' : 'offen';
const statusChip = e => isDone(e) ? `<span class="chip done" title="abgerechnet am ${fmtDate(e.abgerechnetAm)}">abgerechnet</span>` : isStorno(e) ? `<span class="chip storno" title="storniert am ${fmtDate(e.storniertAm)}">storniert</span>` : '<span class="chip info">offen</span>';
function sumUp(list) { // stornierte Einsätze zählen nicht
  list = list.filter(e => !isStorno(e));
  const s = { n: list.length, ha: 0, h: 0, chf: 0, ohnePreis: 0 };
  list.forEach(e => { const u = einhOf(e); if (u === 'h') s.h += e.menge || 0; else s.ha += e.menge || 0; const b = betragOf(e); if (b == null) s.ohnePreis++; else s.chf += b; });
  s.ha = r2(s.ha); s.h = r2(s.h); s.chf = r2(s.chf); return s;
}
const qtyTxt = s => [s.ha ? fmtQty(s.ha) + ' ha' : '', s.h ? fmtQty(s.h) + ' h' : ''].filter(Boolean).join(' · ') || '–';

/* ---------- Filter (Zeitraum, Kunde, Maschine, Status, Suche) ---------- */
function defFilter() { return { von: '', bis: '', kunde: '', maschine: '', status: '', q: '', storno: false }; }
function applyFilter(list, f) { // stornierte nur mit Haken «Stornierte anzeigen» (f.storno) oder Filter «Storniert»
  const q = fold(f.q);
  return list.filter(e => (!f.von || (e.datum && e.datum >= f.von)) && (!f.bis || (e.datum && e.datum <= f.bis)) &&
    (!f.kunde || e.kunde === f.kunde) && (!f.maschine || e.maschine === f.maschine) &&
    ((f.storno && isStorno(e)) || (f.status ? statusOf(e) === f.status : !isStorno(e))) &&
    (!q || fold([e.datum, fmtDate(e.datum), kName(e.kunde), kNr(e.kunde), masch(e.maschine)?.name, masch(e.maschine)?.artNr, e.bem, e.quelle].join(' ')).includes(q)));
}
function yearsOf() { const s = new Set(Store.all('einsaetze').map(e => (e.datum || '').slice(0, 4)).filter(Boolean)); s.add(String(new Date().getFullYear())); return [...s].sort().reverse(); }
function filterBar(key, { status = true, kunde = true, maschine = true, search = true, storno = false } = {}) {
  const f = App.f[key], yr = (f.von && f.bis && f.von.slice(5) === '01-01' && f.bis.slice(5) === '12-31' && f.von.slice(0, 4) === f.bis.slice(0, 4)) ? f.von.slice(0, 4) : (f.von || f.bis ? 'eig' : '');
  return `<div class="filters">
    <select class="input" data-in="fYear" data-k="${key}" title="Zeitraum"><option value="">Alle Jahre</option>${yearsOf().map(y => `<option ${yr === y ? 'selected' : ''}>${y}</option>`).join('')}<option value="eig" ${yr === 'eig' ? 'selected' : ''}>Zeitraum wählen…</option></select>
    ${yr === 'eig' ? `<input class="input" type="date" data-in="fVon" data-k="${key}" value="${esc(f.von)}" title="von"><span class="lbl">bis</span><input class="input" type="date" data-in="fBis" data-k="${key}" value="${esc(f.bis)}" title="bis">` : ''}
    ${kunde ? `<select class="input" data-in="fKunde" data-k="${key}" style="max-width:240px"><option value="">Alle Kunden</option>${kundenSorted().map(k => `<option value="${k.id}" ${f.kunde === k.id ? 'selected' : ''}>${esc(kLabel(k))}</option>`).join('')}</select>` : ''}
    ${maschine ? `<select class="input" data-in="fMasch" data-k="${key}" style="max-width:240px"><option value="">Alle Maschinen</option>${maschSorted().map(m => `<option value="${m.id}" ${f.maschine === m.id ? 'selected' : ''}>${esc(mLabel(m))}</option>`).join('')}</select>` : ''}
    ${status ? `<select class="input" data-in="fStatus" data-k="${key}"><option value="">Alle</option><option value="offen" ${f.status === 'offen' ? 'selected' : ''}>Offen</option><option value="abgerechnet" ${f.status === 'abgerechnet' ? 'selected' : ''}>Abgerechnet</option><option value="storniert" ${f.status === 'storniert' ? 'selected' : ''}>Storniert</option></select>` : ''}
    ${search ? `<input class="input search" type="search" placeholder="Suchen…" value="${esc(f.q)}" data-in="fQ" data-k="${key}">` : ''}
    ${storno ? `<label class="tog"><input type="checkbox" data-in="fStorno" data-k="${key}" ${f.storno ? 'checked' : ''}> Stornierte anzeigen</label>` : ''}
    ${(f.von || f.bis || f.kunde || f.maschine || (status && f.status && !(key === 'abr' && f.status === 'offen')) || f.q) ? `<button class="btn small" data-act="fReset" data-k="${key}">Filter löschen</button>` : ''}
  </div>`;
}

/* ================= App: Ansichten, Auswahl, Ereignisse ================= */
const App = {
  view: 'einsaetze',
  f: {}, sel: new Set(), sort: { key: 'datum', dir: -1 },
  sub: { ausw: 'maschinen', stamm: 'kunden' },
  abr: { rows: new Set() }, // Abrechnung: ausgewählte Zeilen (anfangs keine)
  imp: null, // Prüfliste des laufenden Imports
  busy() { return $('#dlg').open; },
  init() {
    const ui = lsJson('mv_ui') || {};
    this.view = ui.view || 'einsaetze';
    ['einsaetze', 'ausw', 'abr'].forEach(k => { this.f[k] = Object.assign(defFilter(), (ui.f || {})[k] || {}); });
    if (!ui.f || !ui.f.abr) this.f.abr.status = 'offen';
    Object.assign(this.sub, ui.sub || {});
    if (ui.sort) this.sort = ui.sort;
    this.imp = lsJson('mv_imp');
  },
  saveUi() { lsJson('mv_ui', { view: this.view, f: this.f, sub: this.sub, sort: this.sort }); },
  go(v) { this.view = v; this.sel.clear(); this.saveUi(); this.render(); window.scrollTo(0, 0); },
  render() {
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === this.view));
    const V = { einsaetze: viewEinsaetze, import: viewImport, auswertung: viewAuswertung, abrechnung: viewAbrechnung, stamm: viewStamm, mehr: viewMehr }[this.view] || viewEinsaetze;
    const sc = $('.dscroll')?.scrollTop;
    const { tb, html } = V();
    $('#toolbar').innerHTML = tb; $('#content').innerHTML = html;
    if (sc && $('.dscroll')) $('.dscroll').scrollTop = sc;
    $$('[data-ind]').forEach(x => { x.indeterminate = true; });
    selBar();
  }
};

/* ================= Ansicht Einsätze ================= */
function einsatzList() {
  const f = App.f.einsaetze, s = App.sort;
  const key = { datum: e => e.datum || '', kunde: e => kName(e.kunde), nr: e => +kNr(e.kunde) || 0, art: e => +masch(e.maschine)?.artNr || 0, maschine: e => masch(e.maschine)?.name || '',
    menge: e => e.menge || 0, betrag: e => betragOf(e) ?? -1, quelle: e => e.quelle || '', status: e => e.status || '' }[s.key] || (e => e.datum || '');
  return applyFilter(Store.all('einsaetze'), f).sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * s.dir || (b.datum || '').localeCompare(a.datum || ''); });
}
function viewEinsaetze() {
  const list = einsatzList(), s = sumUp(list), S = App.sort;
  const th = (k, l, cls = '') => `<th class="sort ${cls} ${S.key === k ? 'on' : ''}" data-act="sort" data-k="${k}">${l}${S.key === k ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const allSel = list.length && list.every(e => App.sel.has(e.id));
  const rows = list.map(e => {
    const m = masch(e.maschine), b = betragOf(e);
    return `<tr class="click ${App.sel.has(e.id) ? 'sel' : ''} ${isDone(e) ? 'done' : ''} ${isStorno(e) ? 'storno' : ''}" data-act="editEinsatz" data-id="${e.id}">
      <td class="cb"><input type="checkbox" data-act="selOne" data-id="${e.id}" ${App.sel.has(e.id) ? 'checked' : ''}></td>
      <td>${e.datum ? fmtDate(e.datum) : '<span class="chip warn">ohne Datum</span>'}</td><td class="n">${esc(kNr(e.kunde)) || '<span class="nr">neu</span>'}</td><td>${esc(kName(e.kunde))}</td>
      <td class="n">${esc(m?.artNr || '')}</td><td>${esc(m?.name || '?')}</td><td class="n">${fmtQty(e.menge)}</td><td>${esc(einhOf(e))}</td>
      <td class="n">${b != null ? chf(b) : ''}</td><td class="w">${esc(e.bem || '')}${e.ohneRapport ? ' <span class="chip warn" title="nicht im Rapport">ohne Rapport</span>' : ''}</td><td class="small muted">${esc(e.quelle || '')}</td>
      <td>${statusChip(e)}</td></tr>`;
  }).join('');
  return {
    tb: `<h1>Einsätze</h1><button class="btn" data-act="exportEinsaetze">⬇ Excel</button><button class="btn primary" data-act="newEinsatz">＋ Einsatz</button>`,
    html: filterBar('einsaetze', { storno: true }) + (list.length ? `<div class="mlist">${list.slice(0, App.mMore || 150).map(e => { const m = masch(e.maschine); return `<div class="mcard ${App.sel.has(e.id) ? 'sel' : ''} ${isDone(e) ? 'done' : ''} ${isStorno(e) ? 'storno' : ''}" data-act="editEinsatz" data-id="${e.id}">
        <label class="cb"><input type="checkbox" data-act="selOne" data-id="${e.id}" ${App.sel.has(e.id) ? 'checked' : ''}></label>
        <div class="grow"><div class="t">${esc(kName(e.kunde))} <span class="nr">${esc(kNr(e.kunde) || 'neu')}</span></div><div class="s">${e.datum ? fmtDate(e.datum) : 'ohne Datum'} · ${esc(m?.name || '?')}${e.bem ? ' · ' + esc(e.bem) : ''}</div></div>
        <div class="q">${fmtQty(e.menge)} ${esc(einhOf(e))}${isOffen(e) ? '' : '<div>' + statusChip(e) + '</div>'}</div></div>`; }).join('')}
        ${list.length > (App.mMore || 150) ? `<button class="btn" data-act="mMore" style="width:100%">Weitere ${list.length - (App.mMore || 150)} anzeigen</button>` : ''}
        <div class="msum">${s.n} Einsätze · ${qtyTxt(s)}${s.chf ? ' · CHF ' + chf(s.chf) : ''}</div></div>
      <div class="dscroll"><table class="dtab"><thead><tr>
      <th class="cb"><input type="checkbox" data-act="selAll" ${allSel ? 'checked' : ''} title="Alle auswählen"></th>${th('datum', 'Datum')}${th('nr', 'Kd-Nr.', 'n')}${th('kunde', 'Kunde')}${th('art', 'Art.-Nr.', 'n')}${th('maschine', 'Maschine')}${th('menge', 'Menge', 'n')}<th>Einh.</th>${th('betrag', 'Betrag CHF', 'n')}<th>Bemerkung</th>${th('quelle', 'Quelle')}${th('status', 'Status')}</tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td></td><td colspan="5">${s.n} Einsätze</td><td colspan="3" class="n">${qtyTxt(s)}${s.chf ? ' · CHF ' + chf(s.chf) : ''}</td><td colspan="3">${s.ohnePreis && s.chf ? `<span class="small muted">${s.ohnePreis} ohne Preis</span>` : ''}</td></tr></tfoot></table></div>`
      : `<div class="empty">Keine Einsätze${Store.all('einsaetze').length ? ' für diesen Filter' : ''}.</div>`)
  };
}
function selBar() {
  const bar = $('#selbar'), n = App.sel.size;
  if (App.view !== 'einsaetze' || !n) { bar.hidden = true; return; }
  const list = [...App.sel].map(id => Store.get('einsaetze', id)).filter(Boolean), s = sumUp(list);
  bar.hidden = false;
  bar.innerHTML = `<b>${n} ausgewählt · ${qtyTxt(s)}</b><button class="btn" data-act="selDone">Als abgerechnet</button><button class="btn" data-act="selOpen">Als offen</button><button class="btn" data-act="selStorno">Stornieren</button><button class="btn" data-act="selEdit">Ändern…</button><button class="btn danger" data-act="selDel">Löschen</button><button class="btn" data-act="selClear">✕</button>`;
}

/* ---------- Dialog-Gerüst ---------- */
function openDlg(title, body, foot, { wide = false, onSubmit = null } = {}) {
  const d = $('#dlg'); d.classList.toggle('wide', wide);
  $('#dlgForm').innerHTML = `<div class="dh"><h2>${esc(title)}</h2><button type="button" class="x" data-act="dlgClose" aria-label="Schliessen">×</button></div><div class="db">${body}</div><div class="df">${foot}</div>`;
  $('#dlgForm').onsubmit = ev => { if (!onSubmit) return; ev.preventDefault(); if (onSubmit(new FormData($('#dlgForm')), ev.submitter?.value) !== false) closeDlg(); };
  if (!d.open) d.showModal();
  setTimeout(() => { const f = $('#dlgForm [autofocus]'); if (f && matchMedia('(min-width: 700px)').matches) f.focus(); }, 30);
}
function closeDlg() { const d = $('#dlg'); if (d.open) d.close(); App.render(); }
const optList = (items, val, empty) => (empty != null ? `<option value="">${esc(empty)}</option>` : '') + items.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
const kundeOpts = val => optList(kundenSorted().filter(k => k.aktiv !== false || k.id === val).map(k => [k.id, kLabel(k)]), val, '– Kunde wählen –');
const maschOpts = val => optList(maschSorted().filter(m => m.aktiv !== false || m.id === val).map(m => [m.id, mLabel(m) + ' (' + m.einheit + ')']), val, '– Maschine wählen –');

/* ---------- Einsatz erfassen / bearbeiten ---------- */
function einsatzDialog(id, preset = {}) {
  const e = id ? Store.get('einsaetze', id) : Object.assign({ datum: todayIso(), kunde: App.f.einsaetze.kunde || '', maschine: '', menge: null, einheit: '', bem: '', quelle: 'Manuell', status: 'offen' }, preset);
  if (!e) return;
  const m = masch(e.maschine), o = e.orig || {};
  const origTxt = [o.name && o.name !== kName(e.kunde) ? `Name «${o.name}»` : '', o.maschine && o.maschine !== m?.name ? `Maschine «${o.maschine}»` : '', o.menge != null && o.menge !== '' && num(o.menge) !== e.menge ? `Menge «${o.menge}»` : ''].filter(Boolean).join(', ');
  openDlg(id ? 'Einsatz bearbeiten' : 'Neuer Einsatz', `
    <div class="two"><label class="fld"><span>Datum</span><input class="input" type="date" name="datum" value="${esc(e.datum)}"></label>
      <label class="fld"><span>Status</span><select class="input" name="status">${optList([['offen', 'Offen'], ['abgerechnet', 'Abgerechnet'], ['storniert', 'Storniert']], statusOf(e))}</select></label></div>
    <label class="fld"><span>Kunde</span><div style="display:flex;gap:8px"><select class="input" name="kunde" required autofocus>${kundeOpts(e.kunde)}</select><button type="button" class="btn" data-act="quickKunde" title="Neukunde anlegen">＋</button></div></label>
    <label class="fld"><span>Maschine</span><select class="input" name="maschine" required data-in="einsMasch">${maschOpts(e.maschine)}</select></label>
    <div class="three"><label class="fld"><span>Menge</span><input class="input" name="menge" inputmode="decimal" value="${e.menge ?? ''}" required></label>
      <label class="fld"><span>Einheit</span><select class="input" name="einheit">${optList(EINHEITEN.map(u => [u, u]), einhOf(e))}</select></label>
      <label class="fld"><span>Preis CHF/Einheit</span><input class="input" name="preis" inputmode="decimal" value="${e.preis ?? ''}" placeholder="${m && m.preis != null ? chf(m.preis) + ' (Maschine)' : 'Maschinenpreis'}"></label></div>
    <label class="fld"><span>Bemerkung</span><input class="input" name="bem" value="${esc(e.bem || '')}"></label>
    <label class="tog" style="margin-bottom:12px"><input type="checkbox" name="ohneRapport" ${e.ohneRapport ? 'checked' : ''}> nicht im Rapport und nicht in der Abrechnungsliste</label>
    ${id ? `<div class="box small">Quelle: ${esc(e.quelle || '–')}${e.importAm ? ' · importiert ' + fmtDate(e.importAm) : ''}${isDone(e) && e.abgerechnetAm ? ' · abgerechnet am ' + fmtDate(e.abgerechnetAm) : ''}${isStorno(e) && e.storniertAm ? ' · storniert am ' + fmtDate(e.storniertAm) : ''}${origTxt ? '<br>Ursprünglich: ' + esc(origTxt) : ''}</div>` : ''}`,
    `${id ? '<button type="button" class="btn danger" data-act="delEinsatz" data-id="' + id + '">Löschen</button>' : ''}<span class="spacer"></span>
     ${id ? `${isStorno(e) ? '' : '<button class="btn" value="storno" title="Speichern und als storniert markieren">Stornieren</button>'}${isDone(e) ? '<button class="btn" value="offen">Wieder offen</button>' : '<button class="btn" value="done" title="Speichern und als abgerechnet markieren">✓ Abgerechnet</button>'}` : '<button class="btn" value="weiter">Speichern + weiter</button>'}<button class="btn primary" value="ok">Speichern</button>`,
    { onSubmit: (fd, btn) => {
      const menge = num(fd.get('menge'));
      if (!fd.get('kunde') || !fd.get('maschine') || menge == null) { toast('Kunde, Maschine und Menge angeben'); return false; }
      if (btn === 'storno' && !confirm('Diesen Einsatz stornieren? Er zählt danach nirgends mehr (bleibt aber sichtbar).')) return false;
      if (btn === 'done' && !confirm('Diesen Einsatz als abgerechnet markieren?')) return false;
      const st = btn === 'storno' ? 'storniert' : btn === 'done' ? 'abgerechnet' : btn === 'offen' ? 'offen' : fd.get('status');
      const obj = Object.assign({}, e, { id: e.id || 'e' + uid(), datum: fd.get('datum') || '', kunde: fd.get('kunde'), maschine: fd.get('maschine'), menge, einheit: fd.get('einheit'),
        preis: num(fd.get('preis')), bem: fd.get('bem').trim(), status: st, abgerechnetAm: st === 'abgerechnet' ? (e.abgerechnetAm || todayIso()) : '', storniertAm: st === 'storniert' ? (e.storniertAm || todayIso()) : '' });
      if (obj.preis == null) delete obj.preis;
      if (fd.get('ohneRapport')) obj.ohneRapport = true; else delete obj.ohneRapport;
      Store.put('einsaetze', obj, { silent: true });
      if (btn === 'weiter') { toast('Gespeichert'); setTimeout(() => einsatzDialog(null, { datum: obj.datum, kunde: obj.kunde }), 0); return; }
    } });
}
function quickKunde() {
  const name = prompt('Name des Neukunden (Nachname Vorname):'); if (!name || !name.trim()) return;
  const k = Store.put('kunden', { id: 'k' + uid(), nr: '', name: name.trim(), aliases: [], aktiv: true, bem: 'Neukunde' }, { silent: true });
  const sel = $('#dlgForm select[name=kunde]'); if (sel) { sel.innerHTML = kundeOpts(k.id); sel.value = k.id; }
}
function bulkEdit() {
  const ids = [...App.sel];
  openDlg(`${ids.length} Einsätze ändern`, `<p class="muted small">Nur ausgefüllte Felder werden geändert.</p>
    <label class="fld"><span>Kunde</span><select class="input" name="kunde">${kundeOpts('')}</select></label>
    <label class="fld"><span>Maschine</span><select class="input" name="maschine">${maschOpts('')}</select></label>
    <label class="fld"><span>Datum</span><input class="input" type="date" name="datum"></label>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Ändern</button>`,
    { onSubmit: fd => {
      const p = {}; ['kunde', 'maschine', 'datum'].forEach(k => { if (fd.get(k)) p[k] = fd.get(k); });
      if (!Object.keys(p).length) return;
      Store.putMany('einsaetze', ids.map(id => Object.assign({}, Store.get('einsaetze', id), p)), { silent: true }); App.sel.clear(); toast('Geändert');
    } });
}
function setStatus(ids, st) { // st: offen | abgerechnet | storniert
  Store.putMany('einsaetze', ids.map(id => Store.get('einsaetze', id)).filter(Boolean).map(e => Object.assign({}, e, { status: st,
    abgerechnetAm: st === 'abgerechnet' ? (e.abgerechnetAm || todayIso()) : '', storniertAm: st === 'storniert' ? (e.storniertAm || todayIso()) : '' })));
}

/* ================= Ansicht Stammdaten: Kunden, Maschinen ================= */
function viewStamm() {
  const sub = App.sub.stamm;
  const seg = `<div class="seg">${[['kunden', 'Kunden'], ['maschinen', 'Maschinen']].map(([k, l]) => `<button data-act="sub" data-g="stamm" data-v="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (sub === 'maschinen') {
    const use = countBy('maschine');
    const list = maschSorted();
    return { tb: `<h1>Stammdaten</h1>${seg}<button class="btn primary" data-act="editMasch">＋ Maschine</button>`,
      html: `${list.some(m => m.preis == null) ? '<div class="box warn small">Für einige Maschinen fehlt der Preis – ohne Preis rechnet die Abrechnung nur die Mengen.</div>' : ''}
      <div class="dscroll"><table class="dtab"><thead><tr><th class="n">Art.-Nr.</th><th>Maschine</th><th>Einheit</th><th class="n">Preis CHF</th><th class="n">Einsätze</th><th>Namensvarianten (Import)</th><th>Status</th></tr></thead><tbody>
      ${list.map(m => `<tr class="click ${m.aktiv === false ? 'off' : ''}" data-act="editMasch" data-id="${m.id}"><td class="n">${esc(m.artNr)}</td><td><b>${esc(m.name)}</b></td><td>${esc(m.einheit)}</td>
        <td class="n">${m.preis != null ? chf(m.preis) + ' / ' + esc(m.einheit) : '<span class="chip warn">fehlt</span>'}</td><td class="n">${use.get(m.id) || 0}</td><td class="small muted">${esc((m.aliases || []).join(' · '))}</td><td>${m.aktiv === false ? 'inaktiv' : ''}</td></tr>`).join('')}
      </tbody></table></div>` };
  }
  const use = countBy('kunde'), q = fold(App.kq || ''), only = App.kNeu;
  const list = kundenSorted().filter(k => (!only || !k.nr) && (!q || fold([k.name, k.nr, k.ort, ...(k.aliases || [])].join(' ')).includes(q)));
  return { tb: `<h1>Stammdaten</h1>${seg}<button class="btn" data-act="impKundenliste">Kundenliste importieren…</button><button class="btn primary" data-act="editKunde">＋ Kunde</button>`,
    html: `<div class="filters"><input class="input search" type="search" placeholder="Kunde suchen…" value="${esc(App.kq || '')}" data-in="kq"><label class="tog"><input type="checkbox" data-in="kNeu" ${only ? 'checked' : ''}> nur Neukunden (ohne Kd-Nr.)</label><span class="lbl">${list.length} Kunden</span></div>
    <div class="dscroll"><table class="dtab"><thead><tr><th class="n">Kd-Nr.</th><th>Kunde</th><th>Adresse</th><th class="n">Einsätze</th><th>Namensvarianten (Import)</th></tr></thead><tbody>
    ${list.map(k => `<tr class="click ${k.aktiv === false ? 'off' : ''}" data-act="editKunde" data-id="${k.id}"><td class="n">${k.nr ? esc(k.nr) : '<span class="chip warn">Neukunde</span>'}</td><td><b>${esc(k.name)}</b></td>
      <td class="small">${esc([k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</td><td class="n">${use.get(k.id) || 0}</td><td class="small muted">${esc((k.aliases || []).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Keine Kunden.</td></tr>'}
    </tbody></table></div>` };
}
function countBy(field) { const m = new Map(); Store.all('einsaetze').forEach(e => m.set(e[field], (m.get(e[field]) || 0) + 1)); return m; }
const linesOf = s => [...new Set(String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean))];

function kundeDialog(id) {
  const k = id ? kunde(id) : { nr: '', name: '', aliases: [], aktiv: true };
  const n = id ? Store.all('einsaetze').filter(e => e.kunde === id).length : 0;
  openDlg(id ? 'Kunde bearbeiten' : 'Neuer Kunde', `
    <div class="two"><label class="fld"><span>Kunden-Nr.</span><input class="input" name="nr" value="${esc(k.nr || '')}" inputmode="numeric" placeholder="leer = Neukunde"></label>
      <label class="fld"><span>Status</span><select class="input" name="aktiv">${optList([['1', 'aktiv'], ['0', 'inaktiv']], k.aktiv === false ? '0' : '1')}</select></label></div>
    <label class="fld"><span>Name (Nachname Vorname / Betrieb)</span><input class="input" name="name" value="${esc(k.name)}" required autofocus></label>
    <div class="two"><label class="fld"><span>Strasse</span><input class="input" name="strasse" value="${esc(k.strasse || '')}"></label><label class="fld"><span>Zusatz</span><input class="input" name="zusatz" value="${esc(k.zusatz || '')}"></label></div>
    <div class="three"><label class="fld"><span>PLZ</span><input class="input" name="plz" value="${esc(k.plz || '')}"></label><label class="fld" style="grid-column:span 2"><span>Ort</span><input class="input" name="ort" value="${esc(k.ort || '')}"></label></div>
    <div class="two"><label class="fld"><span>Telefon</span><input class="input" name="tel" value="${esc(k.tel || '')}"></label><label class="fld"><span>E-Mail</span><input class="input" name="mail" value="${esc(k.mail || '')}"></label></div>
    <label class="fld"><span>Namensvarianten (eine pro Zeile)</span><textarea class="input" name="aliases" rows="3">${esc((k.aliases || []).join('\n'))}</textarea><div class="hint">So schreibt der Kunde seinen Namen im Formular oder auf dem Rapport. Beim Import wird er damit automatisch erkannt. Neue Varianten lernt das Programm beim Import selbst.</div></label>
    <label class="fld"><span>Bemerkung</span><input class="input" name="bem" value="${esc(k.bem || '')}"></label>
    ${id ? `<div class="box small">${n} Einsätze</div>` : ''}`,
    `${id ? `<button type="button" class="btn danger" data-act="delKunde" data-id="${id}">Löschen</button><button type="button" class="btn" data-act="mergeKunde" data-id="${id}">Zusammenführen…</button>` : ''}<span class="spacer"></span><button class="btn primary" value="ok">Speichern</button>`,
    { onSubmit: fd => {
      const name = fd.get('name').trim(); if (!name) return false;
      const nr = fd.get('nr').trim();
      if (nr && kundenSorted().some(x => x.nr === nr && x.id !== id) && !confirm(`Die Kunden-Nr. ${nr} ist schon vergeben. Trotzdem speichern?`)) return false;
      const obj = Object.assign({}, k, { id: k.id || 'k' + uid(), nr, name, strasse: fd.get('strasse').trim(), zusatz: fd.get('zusatz').trim(), plz: fd.get('plz').trim(), ort: fd.get('ort').trim(),
        tel: fd.get('tel').trim(), mail: fd.get('mail').trim(), bem: fd.get('bem').trim(), aktiv: fd.get('aktiv') === '1', aliases: linesOf(fd.get('aliases')).filter(a => fold(a) !== fold(name)) });
      Store.put('kunden', obj, { silent: true });
    } });
}
function mergeKundeDialog(id) {
  const k = kunde(id); if (!k) return;
  openDlg('Kunden zusammenführen', `<p>Alle Einsätze und Namensvarianten von <b>${esc(k.name)}</b> werden zum gewählten Kunden verschoben. Danach wird «${esc(k.name)}» gelöscht.</p>
    <label class="fld"><span>Zusammenführen mit</span><select class="input" name="ziel" required>${optList(kundenSorted().filter(x => x.id !== id).map(x => [x.id, kLabel(x)]), '', '– Kunde wählen –')}</select></label>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Zusammenführen</button>`,
    { onSubmit: fd => {
      const z = kunde(fd.get('ziel')); if (!z) return false;
      const moved = Store.all('einsaetze').filter(e => e.kunde === id).map(e => Object.assign({}, e, { kunde: z.id }));
      if (moved.length) Store.putMany('einsaetze', moved, { silent: true });
      Store.put('kunden', Object.assign({}, z, { aliases: [...new Set([...(z.aliases || []), k.name, ...(k.aliases || [])])].filter(a => fold(a) !== fold(z.name)), nr: z.nr || k.nr }), { silent: true });
      Store.remove('kunden', id); toast(`${moved.length} Einsätze zu ${z.name} verschoben`);
    } });
}
function maschDialog(id) {
  const all = Store.all('maschinen'), next = Math.max(100, ...all.map(m => +m.artNr || 0)) + 1;
  const m = id ? masch(id) : { artNr: String(next), name: '', einheit: 'ha', preis: null, aktiv: true, aliases: [] };
  const n = id ? Store.all('einsaetze').filter(e => e.maschine === id).length : 0;
  openDlg(id ? 'Maschine bearbeiten' : 'Neue Maschine', `
    <div class="two"><label class="fld"><span>Art.-Nr.</span><input class="input" name="artNr" value="${esc(m.artNr)}" required></label>
      <label class="fld"><span>Status</span><select class="input" name="aktiv">${optList([['1', 'aktiv'], ['0', 'inaktiv']], m.aktiv === false ? '0' : '1')}</select></label></div>
    <label class="fld"><span>Bezeichnung</span><input class="input" name="name" value="${esc(m.name)}" required autofocus></label>
    <div class="two"><label class="fld"><span>Verrechnung pro</span><select class="input" name="einheit">${optList(EINHEITEN.map(u => [u, u === 'ha' ? 'ha (Fläche)' : 'h (Stunden)']), m.einheit)}</select></label>
      <label class="fld"><span>Preis CHF pro Einheit</span><input class="input" name="preis" inputmode="decimal" value="${m.preis ?? ''}"></label></div>
    <label class="fld"><span>Namensvarianten (eine pro Zeile)</span><textarea class="input" name="aliases" rows="3">${esc((m.aliases || []).join('\n'))}</textarea><div class="hint">z. B. die Bezeichnung im Online-Formular. Beim Import wird die Maschine damit automatisch erkannt.</div></label>
    ${id ? `<div class="box small">${n} Einsätze</div>` : ''}`,
    `${id && !n ? `<button type="button" class="btn danger" data-act="delMasch" data-id="${id}">Löschen</button>` : ''}<span class="spacer"></span><button class="btn primary" value="ok">Speichern</button>`,
    { onSubmit: fd => {
      const name = fd.get('name').trim(); if (!name) return false;
      Store.put('maschinen', Object.assign({}, m, { id: m.id || 'm' + uid(), artNr: fd.get('artNr').trim(), name, einheit: fd.get('einheit'), preis: num(fd.get('preis')), aktiv: fd.get('aktiv') === '1',
        aliases: linesOf(fd.get('aliases')).filter(a => fold(a) !== fold(name)) }), { silent: true });
    } });
}

/* ---------- Kundenliste (Excel, z. B. Export aus AgroFaktura) importieren: Adressen und Kunden-Nr. nachführen ---------- */
async function impKundenliste(file) {
  let rows;
  try { rows = /\.csv$/i.test(file.name) ? readCsv(await file.text()) : await readXlsx(await file.arrayBuffer()); } catch (e) { toast('Datei nicht lesbar: ' + e.message, 6000); return; }
  const h = (rows[0] || []).map(x => fold(x));
  const col = (...names) => { for (const n of names) { const i = h.findIndex(x => x === fold(n)); if (i >= 0) return i; } for (const n of names) { const i = h.findIndex(x => x.includes(fold(n))); if (i >= 0) return i; } return -1; };
  const C = { nr: col('Kunden-Nummer', 'Kundennummer', 'Kd-Nr', 'Nr'), firma: col('Firmenname', 'Firma'), anrede: col('Anrede'), name: col('Name', 'Nachname'), vorname: col('Vorname'),
    str: col('Strasse'), strnr: col('Strassennummer', 'Hausnummer'), zus: col('Adresszusatz'), plz: col('PLZ'), ort: col('Ort'), tel: col('Telefon1', 'Telefon'), mob: col('Mobile', 'Natel', 'Handy'), mail: col('E-Mail', 'Email') };
  if (C.nr < 0 || (C.name < 0 && C.firma < 0)) { toast('Spalten «Kunden-Nummer» und «Name» nicht gefunden', 6000); return; }
  const g = (r, i) => i >= 0 ? String(r[i] ?? '').trim() : '';
  const liste = rows.slice(1).map(r => {
    const nr = g(r, C.nr).replace(/\.0$/, ''); if (!nr) return null;
    const name = [g(r, C.firma), [g(r, C.name), g(r, C.vorname)].filter(Boolean).join(' ')].filter(Boolean).join(' ').trim() || g(r, C.anrede);
    return { nr, name, strasse: [g(r, C.str), g(r, C.strnr)].filter(Boolean).join(' '), zusatz: g(r, C.zus), plz: g(r, C.plz).replace(/\.0$/, ''), ort: g(r, C.ort), tel: g(r, C.tel) || g(r, C.mob), mail: g(r, C.mail) };
  }).filter(Boolean);
  const byNr = new Map(liste.map(x => [x.nr, x]));
  const upd = [], neuVorschlag = [];
  kundenSorted().forEach(k => {
    if (k.nr && byNr.has(k.nr)) { const x = byNr.get(k.nr); const n = Object.assign({}, k, { strasse: x.strasse || k.strasse, zusatz: x.zusatz || k.zusatz, plz: x.plz || k.plz, ort: x.ort || k.ort, tel: x.tel || k.tel, mail: x.mail || k.mail });
      if (['strasse', 'zusatz', 'plz', 'ort', 'tel', 'mail'].some(f => (n[f] || '') !== (k[f] || ''))) upd.push(n); }
    else if (!k.nr) { // Neukunde: gleicher Name in der Liste?
      const hit = liste.find(x => tokKey(x.name) === tokKey(k.name) || (k.aliases || []).some(a => tokKey(a) === tokKey(x.name)));
      if (hit) neuVorschlag.push([k, hit]);
    }
  });
  openDlg('Kundenliste importieren', `<p>${liste.length} Kunden in «${esc(file.name)}» gelesen.</p>
    <div class="box">${upd.length} bestehende Kunden erhalten eine aktualisierte Adresse (Abgleich über die Kunden-Nr.).</div>
    ${neuVorschlag.length ? `<p><b>Neukunden mit gleichem Namen in der Liste</b> – Kunden-Nr. übernehmen?</p>${neuVorschlag.map(([k, x], i) => `<label class="tog" style="display:flex;margin:6px 0"><input type="checkbox" name="nv" value="${i}" checked> ${esc(k.name)} → Nr. ${esc(x.nr)} ${esc(x.name)}, ${esc(x.ort)}</label>`).join('')}` : '<p class="muted small">Keine Neukunden mit gleichem Namen gefunden.</p>'}
    <p class="muted small">Kunden ohne Einsätze werden nicht übernommen – die Vermietung führt nur ihre eigenen Kunden.</p>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Übernehmen</button>`,
    { onSubmit: fd => {
      const pick = new Set(fd.getAll('nv').map(Number));
      const nv = neuVorschlag.filter((_, i) => pick.has(i)).map(([k, x]) => Object.assign({}, k, { nr: x.nr, strasse: x.strasse, zusatz: x.zusatz, plz: x.plz, ort: x.ort, tel: x.tel, mail: x.mail, bem: k.bem === 'Neukunde' ? '' : k.bem }));
      const all = [...upd, ...nv]; if (all.length) Store.putMany('kunden', all, { silent: true });
      toast(`${upd.length} Adressen aktualisiert, ${nv.length} Kunden-Nr. vergeben`, 5000);
    } });
}

/* ================= Ansicht Auswertung ================= */
function viewAuswertung() {
  const sub = App.sub.ausw, list = applyFilter(Store.all('einsaetze'), App.f.ausw), s = sumUp(list);
  const seg = `<div class="seg">${[['maschinen', 'Pro Maschine'], ['kunden', 'Pro Kunde'], ['monate', 'Pro Monat'], ['matrix', 'Kunde × Maschine']].map(([k, l]) => `<button data-act="sub" data-g="ausw" data-v="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const kpis = `<div class="kpis"><div class="kpi"><b>${s.n}</b><span>Einsätze</span></div><div class="kpi"><b>${fmtQty(s.ha)}</b><span>Hektaren</span></div><div class="kpi"><b>${fmtQty(s.h)}</b><span>Stunden</span></div>
    <div class="kpi"><b>${new Set(list.map(e => e.kunde)).size}</b><span>Kunden</span></div>${s.chf ? `<div class="kpi"><b>${chf(s.chf)}</b><span>CHF${s.ohnePreis ? ` (${s.ohnePreis} ohne Preis)` : ''}</span></div>` : ''}</div>`;
  const T = auswTables(list)[sub];
  const tab = `<div class="dscroll"><table class="dtab"><thead><tr>${T.head.map((h, i) => `<th class="${T.num[i] ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${T.rows.map(r => `<tr class="${r.click ? 'click' : ''}" ${r.click ? `data-act="auswJump" data-t="${r.click[0]}" data-id="${r.click[1]}"` : ''}>${r.cells.map((c, i) => `<td class="${T.num[i] ? 'n' : ''}">${T.fmt[i] ? T.fmt[i](c) : esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
    ${T.foot ? `<tfoot><tr>${T.foot.map((c, i) => `<td class="${T.num[i] ? 'n' : ''}">${T.fmt[i] && c !== '' ? T.fmt[i](c) : esc(c ?? '')}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
  return { tb: `<h1>Auswertung</h1>${seg}<button class="btn" data-act="exportAusw">⬇ Excel</button>`, html: filterBar('ausw', { search: false }) + kpis + (list.length ? tab : '<div class="empty">Keine Einsätze für diesen Filter.</div>') };
}
// Tabellen der Auswertung (Bildschirm und Excel gleich)
function auswTables(list) {
  const q = n => n ? fmtQty(n) : '–', c = n => n ? chf(n) : '', d = x => x ? fmtDate(x) : '';
  const M = maschSorted().filter(m => list.some(e => e.maschine === m.id));
  const K = kundenSorted().filter(k => list.some(e => e.kunde === k.id));
  const anyChf = list.some(e => betragOf(e) != null);
  const maschinen = { head: ['Art.-Nr.', 'Maschine', 'Einheit', 'Einsätze', 'Menge', 'Ø pro Einsatz', 'Kunden', 'Erster Einsatz', 'Letzter Einsatz', ...(anyChf ? ['Betrag CHF'] : [])],
    num: [1, 0, 0, 1, 1, 1, 1, 0, 0, 1], fmt: [null, null, null, null, q, q, null, d, d, c], rows: [], foot: null };
  M.forEach(m => {
    const L = list.filter(e => e.maschine === m.id), menge = r2(L.reduce((a, e) => a + (e.menge || 0), 0)), ds = L.map(e => e.datum).filter(Boolean).sort();
    maschinen.rows.push({ click: ['maschine', m.id], cells: [m.artNr, m.name, m.einheit, L.length, menge, L.length ? r2(menge / L.length) : 0, new Set(L.map(e => e.kunde)).size, ds[0], ds[ds.length - 1], ...(anyChf ? [sumUp(L).chf] : [])] });
  });
  const s = sumUp(list);
  maschinen.foot = ['', 'Total', '', s.n, '', '', new Set(list.map(e => e.kunde)).size, '', '', ...(anyChf ? [s.chf] : [])];
  const kunden = { head: ['Kd-Nr.', 'Kunde', 'Einsätze', 'ha', 'h', 'Erster Einsatz', 'Letzter Einsatz', 'offen', ...(anyChf ? ['Betrag CHF'] : [])],
    num: [1, 0, 1, 1, 1, 0, 0, 1, 1], fmt: [null, null, null, q, q, d, d, null, c], rows: [], foot: ['', 'Total', s.n, s.ha, s.h, '', '', list.filter(isOffen).length, ...(anyChf ? [s.chf] : [])] };
  K.forEach(k => { const L = list.filter(e => e.kunde === k.id), t = sumUp(L), ds = L.map(e => e.datum).filter(Boolean).sort();
    kunden.rows.push({ click: ['kunde', k.id], cells: [k.nr || 'neu', k.name, t.n, t.ha, t.h, ds[0], ds[ds.length - 1], L.filter(isOffen).length, ...(anyChf ? [t.chf] : [])] }); });
  const months = [...new Set(list.map(e => (e.datum || '').slice(0, 7)).filter(Boolean))].sort();
  const mLab = x => `${MONATE[+x.slice(5) - 1]} ${x.slice(2, 4)}`;
  const monate = { head: ['Art.-Nr.', 'Maschine', 'Einheit', ...months.map(mLab), ...(list.some(e => !e.datum) ? ['ohne Datum'] : []), 'Total'], rows: [], num: [], fmt: [] };
  const mc = monate.head.length; monate.num = Array.from({ length: mc }, (_, i) => i === 0 || i > 2 ? 1 : 0); monate.fmt = Array.from({ length: mc }, (_, i) => i > 2 ? q : null);
  M.forEach(m => { const L = list.filter(e => e.maschine === m.id), v = months.map(x => r2(L.filter(e => (e.datum || '').startsWith(x)).reduce((a, e) => a + (e.menge || 0), 0)));
    if (list.some(e => !e.datum)) v.push(r2(L.filter(e => !e.datum).reduce((a, e) => a + (e.menge || 0), 0)));
    monate.rows.push({ click: ['maschine', m.id], cells: [m.artNr, m.name, m.einheit, ...v, r2(L.reduce((a, e) => a + (e.menge || 0), 0))] }); });
  const matrix = { head: ['Kd-Nr.', 'Kunde', ...M.map(m => `${m.artNr} ${m.name} (${m.einheit})`)], rows: [], num: [1, 0, ...M.map(() => 1)], fmt: [null, null, ...M.map(() => q)] };
  K.forEach(k => matrix.rows.push({ click: ['kunde', k.id], cells: [k.nr || 'neu', k.name, ...M.map(m => r2(list.filter(e => e.kunde === k.id && e.maschine === m.id).reduce((a, e) => a + (e.menge || 0), 0)))] }));
  matrix.foot = ['', 'Total', ...M.map(m => r2(list.filter(e => e.maschine === m.id).reduce((a, e) => a + (e.menge || 0), 0)))];
  return { maschinen, kunden, monate, matrix };
}
function exportAusw() {
  const list = applyFilter(Store.all('einsaetze'), App.f.ausw), T = auswTables(list);
  const sh = (name, t) => ({ name, rows: [t.head, ...t.rows.map(r => r.cells.map(v => v ?? '')), ...(t.foot ? [t.foot] : [])] });
  download(`Vermietung_Auswertung_${todayIso()}.xlsx`, xlsxBlob([sh('Pro Maschine', T.maschinen), sh('Pro Kunde', T.kunden), sh('Pro Monat', T.monate), sh('Kunde x Maschine', T.matrix), { name: 'Einsätze', rows: einsatzRows(list) }]));
}
function einsatzRows(list) {
  return [['Datum', 'Kd-Nr.', 'Kunde', 'Art.-Nr.', 'Maschine', 'Menge', 'Einheit', 'Preis CHF', 'Betrag CHF', 'Bemerkung', 'Quelle', 'Status', 'Abgerechnet/storniert am', 'ID'],
    ...list.slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || '')).map(e => { const m = masch(e.maschine) || {}; return [e.datum ? fmtDate(e.datum) : '', kNr(e.kunde) ? +kNr(e.kunde) || kNr(e.kunde) : '', kName(e.kunde), +m.artNr || m.artNr || '', m.name || '', e.menge, einhOf(e), preisOf(e) ?? '', betragOf(e) ?? '', e.bem || '', e.quelle || '', statusOf(e), e.abgerechnetAm ? fmtDate(e.abgerechnetAm) : (e.storniertAm ? fmtDate(e.storniertAm) : ''), e.id]; })];
}

/* ================= Import: Online-Formular (Excel) und Papierrapporte (Scan) ================= */
function matchKunde(text) {
  const t = String(text || '').trim(); if (!t) return { id: '', q: '' };
  const K = kundenSorted(), f = fold(t), tk = tokKey(t);
  let k = K.find(x => fold(x.name) === f); if (k) return { id: k.id, q: 'exakt' };
  k = K.find(x => (x.aliases || []).some(a => fold(a) === f)); if (k) return { id: k.id, q: 'variante' };
  k = K.find(x => tokKey(x.name) === tk || (x.aliases || []).some(a => tokKey(a) === tk)); if (k) return { id: k.id, q: 'variante' };
  let best = null, bs = 0;
  K.forEach(x => [x.name, ...(x.aliases || [])].forEach(n => { const s = simil(n, t); if (s > bs) { bs = s; best = x; } }));
  return bs >= 0.82 ? { id: best.id, q: 'ähnlich' } : { id: '', q: '' };
}
function matchMaschine(text) {
  const t = String(text || '').replace(/:\s*$/, '').trim(); if (!t) return { id: '', q: '' };
  const M = maschSorted(), f = fold(t);
  let m = M.find(x => fold(x.name) === f || fold(x.artNr) === f); if (m) return { id: m.id, q: 'exakt' };
  m = M.find(x => (x.aliases || []).some(a => fold(a) === f)); if (m) return { id: m.id, q: 'variante' };
  let best = null, bs = 0;
  M.forEach(x => [x.name, ...(x.aliases || [])].forEach(n => {
    const a = tokens(n), b = tokens(t), common = a.filter(w => b.includes(w)).length;
    const s = Math.max(simil(n, t), common / Math.max(a.length, b.length) * 0.95);
    if (s > bs) { bs = s; best = x; }
  }));
  return bs >= 0.6 ? { id: best.id, q: 'ähnlich' } : { id: '', q: '' };
}
// Menge mit Einheit lesen: «2,5», «3 h», «45 min», «240 a», «1.5 ha»
function parseMenge(v, defUnit) {
  if (typeof v === 'number') return { menge: Math.round(v * 1e4) / 1e4, einheit: defUnit };
  const s = String(v || '').trim().toLowerCase(); if (!s) return { menge: null, einheit: defUnit };
  let n = num((s.match(/[\d.,']+/) || [''])[0]); if (n != null) n = Math.round(n * 1e4) / 1e4;
  if (n == null) return { menge: null, einheit: defUnit };
  if (/min/.test(s)) return { menge: r2(n / 60), einheit: 'h', note: `${v} → ${fmtNum(n / 60)} h` };
  if (/\bstd|\bh\b|stunde/.test(s)) return { menge: n, einheit: 'h' };
  if (/\bha\b|hektar/.test(s)) return { menge: n, einheit: 'ha' };
  if (/\ba\b|aren/.test(s)) return { menge: r2(n / 100), einheit: 'ha', note: `${v} → ${fmtNum(n / 100)} ha` };
  return { menge: n, einheit: defUnit };
}
// Datum aus Excel-Zahl, «dd.mm.yyyy», ISO oder Text
function parseDatum(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Math.round((parseFloat(s) - 25569) * 864e5)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return '';
}
// Prüfung einer Importzeile: schon vorhanden? (gleicher Kunde, gleiche Maschine, gleiches Datum)
function impCheck(r, i, rows) {
  r.status = 'neu'; r.dupInfo = ''; r.dupId = '';
  const E = Store.all('einsaetze');
  const sigHit = r.sig && E.find(e => e.orig?.sig === r.sig);
  if (sigHit) { r.status = 'dup'; r.dupInfo = 'bereits importiert'; r.dupId = sigHit.id; return; }
  if (!r.kId || r.kId === '__new') return;
  if (!r.mId) { // Maschine noch nicht zugeordnet: gleicher Kunde, gleiches Datum, gleiche Menge?
    const hit = E.find(e => e.kunde === r.kId && (e.datum || '') === (r.datum || '') && r.menge != null && Math.abs((e.menge || 0) - r.menge) < 0.005);
    if (hit) { r.status = 'dup'; r.dupInfo = `gleicher Einsatz vorhanden (${masch(hit.maschine)?.name || '?'})`; r.dupId = hit.id; }
    return;
  }
  const same = E.filter(e => e.kunde === r.kId && e.maschine === r.mId && (e.datum || '') === (r.datum || ''));
  const hit2 = same.find(e => r.menge != null && Math.abs((e.menge || 0) - r.menge) < 0.005);
  if (hit2) { r.status = 'dup'; r.dupInfo = 'gleicher Einsatz vorhanden'; r.dupId = hit2.id; return; }
  if (same.length) { r.status = 'aehnlich'; r.dupInfo = `am gleichen Tag schon ${same.map(e => fmtQty(e.menge) + ' ' + einhOf(e)).join(', ')} erfasst`; return; }
  if (rows.slice(0, i).some(o => o.kId === r.kId && o.mId === r.mId && o.datum === r.datum && o.menge === r.menge)) { r.status = 'dup'; r.dupInfo = 'doppelt in dieser Datei'; }
}
function impRow(o) {
  const k = o.kCanon && matchKunde(o.kCanon).q === 'exakt' ? matchKunde(o.kCanon) : matchKunde(o.kText);
  const m = o.mCanon && matchMaschine(o.mCanon).id ? matchMaschine(o.mCanon) : matchMaschine(o.mText);
  const mm = masch(m.id), pm = parseMenge(o.menge, o.einheit || mm?.einheit || 'ha');
  const notes = [o.note, pm.note].filter(Boolean);
  return { kText: o.kText || '', kId: k.id || (o.kText ? '__new' : ''), kQ: k.q, newName: o.kText || '', mText: o.mText || '', mId: m.id, mQ: m.q,
    datum: o.datum || '', menge: pm.menge, einheit: pm.einheit, bem: o.bem || '', raw: o.raw ?? o.menge ?? '', sig: o.sig || '', unsicher: !!o.unsicher, note: notes.join('; '), page: o.page ?? null, abg: !!o.abg, sel: true };
}
function impStart(src, file, objs) {
  const rows = objs.map(impRow);
  rows.forEach((r, i) => { impCheck(r, i, rows); if (r.status === 'dup') r.sel = false; if (r.status === 'aehnlich') r.sel = false; });
  App.imp = { src, file, am: todayIso(), rows, abgNeu: true, abgVorh: false }; lsJson('mv_imp', App.imp);
  App.go('import');
  const n = rows.filter(r => r.status === 'dup').length;
  toast(`${rows.length} Zeilen gelesen${n ? `, ${n} schon vorhanden` : ''}`, 4000);
}

/* ---------- Online-Formular: Excel-Datei einlesen, Spalten zuordnen ---------- */
const FORM_FIELDS = [['kunde', 'Kunde / Name Mieter'], ['maschine', 'Maschine'], ['datum', 'Datum des Einsatzes'], ['menge', 'Menge (Fläche oder Stunden)'], ['bem', 'Bemerkung'], ['abg', 'Abgerechnet (optional)'], ['id', 'Antwort-ID (optional)']];
const truthy = v => /^(1|true|wahr|ja|yes|x|✓)$/i.test(String(v ?? '').trim());
// Excel-Export des Online-Formulars (Microsoft Forms) direkt einlesen; Spalten werden erkannt, sonst Zuordnungsdialog
async function impForm(file) {
  let rows;
  try { rows = /\.csv$/i.test(file.name) ? readCsv(await file.text()) : await readXlsx(await file.arrayBuffer(), /form|antwort|response/i); } catch (e) { toast('Datei nicht lesbar: ' + e.message, 6000); return; }
  rows = rows.filter(r => r.some(c => String(c ?? '').trim()));
  if (!rows.length) { toast('Die Datei ist leer'); return; }
  const w = Math.max(...rows.map(r => r.length));
  const kw = /name|kunde|mieter|maschine|datum|menge|bemerk|zeit|id|e-mail|fläche|stunden/i;
  const hasHead = rows[0].filter(c => String(c).trim() && num(c) == null && kw.test(String(c))).length >= 2;
  const head = hasHead ? rows[0].map(x => String(x).replace(/ /g, ' ').trim()) : [], data = hasHead ? rows.slice(1) : rows;
  const map = {}, used = new Set(), sample = i => data.slice(0, 80).map(r => r[i]).filter(v => String(v ?? '').trim());
  const filled = i => i >= 0 && sample(i).length >= Math.min(3, data.length) * 0.5;
  const byHead = (re, not, need = true) => head.findIndex((h, j) => !used.has(j) && re.test(h) && !(not && not.test(h)) && (!need || filled(j)));
  const take = (f, i) => { if (i >= 0 && !used.has(i)) { map[f] = i; used.add(i); } };
  const saved = head.length ? (Store.cfg().formMap || {})[head.join('|')] : null;
  let sicher = !!saved;
  if (saved) { Object.assign(map, saved); Object.values(saved).forEach(i => used.add(i)); }
  else {
    if (head.length) {
      take('id', head.findIndex(h => /^id$/i.test(h)));
      take('abg', byHead(/abgerechnet|verrechnet|bezahlt|erledigt/i, null, false));
      take('maschine', byHead(/maschine|gerät|geraet/i));
      take('datum', byHead(/mietdatum|datum|einsatztag|wann/i, /start|fertig|änderung|aenderung|abschluss/i));
      take('menge', byHead(/menge|fläche|flaeche|hektar|\bha\b|stunden|anzahl/i));
      take('bem', byHead(/bemerk|notiz|kommentar|mitteilung/i, null, false));
      take('kunde', byHead(/mieter|kunde/i, /e-?mail|maschine/i));
      take('kunde', byHead(/name|betrieb/i, /e-?mail|maschine/i));
      sicher = ['kunde', 'maschine', 'menge', 'datum'].every(f => map[f] != null);
    }
    const score = (i, fn) => { const s = sample(i); return s.length ? s.filter(fn).length / s.length : 0; };
    const free = () => Array.from({ length: w }, (_, i) => i).filter(i => !used.has(i));
    const best = fn => free().map(i => [i, score(i, fn)]).sort((a, b) => b[1] - a[1])[0] || [-1, 0];
    if (map.maschine == null) { const [i, s] = best(v => !!matchMaschine(v).id); if (s >= 0.5) take('maschine', i); }
    if (map.datum == null) { const [i, s] = best(v => !!parseDatum(v)); if (s >= 0.6) take('datum', i); }
    if (map.menge == null) { const [i, s] = best(v => { const n = num(v); return n != null && n > 0 && n < 2000 && !/^\d{5}$/.test(String(v)); }); if (s >= 0.6) take('menge', i); }
    if (map.kunde == null) { const [i, s] = best(v => num(v) == null && /[a-zäöü]{2,}/i.test(String(v)) && !/^(true|false|wahr|falsch)$/i.test(String(v))); if (s >= 0.5) take('kunde', i); }
    if (map.bem == null) { const [i, s] = best(v => num(v) == null && String(v).length > 2 && !/^(true|false|wahr|falsch)$/i.test(String(v))); if (s > 0) take('bem', i); }
  }
  App.formRaw = { name: file.name, head, data, w, map };
  if (sicher) formBuild(map); else formMapDialog();
}
function formMapDialog() {
  const F = App.formRaw; if (!F) return;
  const { head, data, w, map } = F, colName = i => `Spalte ${xCol(i)}${head[i] ? ': ' + head[i] : ''}`;
  const opts = val => `<option value="">– keine –</option>` + Array.from({ length: w }, (_, i) => `<option value="${i}" ${val === i ? 'selected' : ''}>${esc(colName(i))}</option>`).join('');
  const prev = data.slice(0, 3).map(r => `<tr>${Array.from({ length: w }, (_, i) => `<td class="small">${esc(String(r[i] ?? '').slice(0, 40))}</td>`).join('')}</tr>`).join('');
  openDlg('Online-Formular: Spalten zuordnen', `<p class="muted small">«${esc(F.name)}» – ${data.length} Antworten. Bitte prüfen, welche Spalte was enthält. Die Zuordnung wird für die nächste Datei gemerkt.</p>
    ${FORM_FIELDS.map(([f, l]) => `<label class="fld"><span>${l}</span><select class="input" name="${f}">${opts(map[f])}</select></label>`).join('')}
    <div class="dscroll" style="max-height:200px"><table class="dtab"><thead><tr>${Array.from({ length: w }, (_, i) => `<th>${esc(xCol(i))}${head[i] ? ' ' + esc(head[i].slice(0, 20)) : ''}</th>`).join('')}</tr></thead><tbody>${prev}</tbody></table></div>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Weiter zur Prüfliste</button>`,
    { wide: true, onSubmit: fd => {
      const mp = {}; FORM_FIELDS.forEach(([f]) => { const v = fd.get(f); if (v !== '' && v != null) mp[f] = +v; });
      if (mp.kunde == null || mp.maschine == null || mp.menge == null) { toast('Kunde, Maschine und Menge zuordnen'); return false; }
      if (head.length) { const fm = Object.assign({}, Store.cfg().formMap || {}); fm[head.join('|')] = mp; Store.setCfg({ formMap: fm }); }
      setTimeout(() => formBuild(mp), 0);
    } });
}
function formBuild(mp) {
  const F = App.formRaw; F.map = mp;
  const g = (r, f) => mp[f] != null ? r[mp[f]] ?? '' : '';
  const objs = F.data.map(r => ({ kText: String(g(r, 'kunde')).replace(/\s+/g, ' ').trim(), mText: String(g(r, 'maschine')).replace(/ /g, ' ').replace(/:\s*$/, '').trim(),
    datum: parseDatum(g(r, 'datum')), menge: g(r, 'menge'), raw: g(r, 'menge'), bem: String(g(r, 'bem')).replace(/\s+/g, ' ').trim(), abg: mp.abg != null ? truthy(g(r, 'abg')) : false,
    sig: mp.id != null && String(g(r, 'id')).trim() ? 'F' + String(g(r, 'id')).trim() : 'F:' + fold(r.join(' ')) })).filter(o => o.kText || o.mText);
  impStart('Formular', F.name, objs);
}

/* ---------- Formular-Excel per Freigabelink (OneDrive/SharePoint): öffnen und direkt abrufen ----------
   Der Link wird in den App-Einstellungen gespeichert (cfg.formLink, nur in der eigenen Dropbox-Datei).
   Öffnen in Excel im Browser holt dort die neuesten Formular-Antworten in die Datei; danach «Abrufen» lädt sie ohne Herunterladen. */
const formLink = () => Store.cfg().formLink || '';
/* Microsoft-Anmeldung (OAuth 2.0 + PKCE, ohne Server) – damit lässt sich die Formular-Datei über Microsoft Graph sicher abrufen,
   auch wenn Microsoft den anonymen Zugriff über den Freigabelink sperrt (Fehler 401). Client-ID aus der App-Registrierung (Azure/Entra). */
const MS = {
  clientId() { return Store.cfg().msClientId || ''; },
  configured() { return /^[0-9a-f-]{36}$/i.test(this.clientId()); },
  tokens() { return lsJson('mv_mstok'); },
  hasSession() { const t = this.tokens(); return !!(t && (t.refresh || (t.access && t.exp > Date.now()))); },
  scope: 'openid offline_access Files.Read.All',
  base: 'https://login.microsoftonline.com/common/oauth2/v2.0',
  async login(after) {
    if (!this.configured()) { toast('Zuerst unter Mehr › Microsoft die Client-ID eintragen'); App.go('mehr'); return; }
    const verifier = Auth.b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = Auth.b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = 'ms' + Auth.b64url(crypto.getRandomValues(new Uint8Array(16)));
    lsJson('mv_mspkce', { verifier, state, after: after || '' });
    const p = new URLSearchParams({ client_id: this.clientId(), response_type: 'code', redirect_uri: Auth.redirectUri(), scope: this.scope, state, code_challenge: challenge, code_challenge_method: 'S256', response_mode: 'query' });
    location.assign(`${this.base}/authorize?${p}`);
  },
  async handleRedirect(q, pk) {
    ls('mv_mspkce', null);
    if (q.has('error')) { toast('Microsoft-Anmeldung abgebrochen: ' + (q.get('error_description') || q.get('error')).slice(0, 200), 8000); return; }
    const r = await fetch(`${this.base}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId(), grant_type: 'authorization_code', code: q.get('code'), redirect_uri: Auth.redirectUri(), code_verifier: pk.verifier, scope: this.scope }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast('Microsoft-Anmeldung fehlgeschlagen: ' + (j.error_description || j.error || r.status).toString().slice(0, 200), 9000); return; }
    this.store(j); toast('Mit Microsoft verbunden');
    if (pk.after === 'formFetch') App.afterBoot = () => { App.go('import'); formFetch(); };
  },
  store(j) { lsJson('mv_mstok', { access: j.access_token, refresh: j.refresh_token || this.tokens()?.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 }); },
  async token() {
    const t = this.tokens(); if (!t) return null;
    if (t.access && t.exp - 120000 > Date.now()) return t.access;
    if (!t.refresh) return null;
    const r = await fetch(`${this.base}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId(), grant_type: 'refresh_token', refresh_token: t.refresh, scope: this.scope }) });
    if (!r.ok) { ls('mv_mstok', null); return null; } // Refresh-Token abgelaufen (bei Browser-Apps nach 24 h) → neu anmelden
    const j = await r.json(); this.store(j); return j.access_token;
  },
  logout() { ls('mv_mstok', null); App.render(); toast('Von Microsoft abgemeldet'); },
  async download(link) { // Freigabelink → Graph driveItem → downloadUrl (CORS-fähig) → Datei
    const tok = await this.token(); if (!tok) { await this.login('formFetch'); return null; }
    const enc = 'u!' + btoa(unescape(encodeURIComponent(link.trim()))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    const r = await fetch(`https://graph.microsoft.com/v1.0/shares/${enc}/driveItem?$select=name,@microsoft.graph.downloadUrl`, { headers: { Authorization: 'Bearer ' + tok, Prefer: 'redeemSharingLink' } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { ls('mv_mstok', null); await this.login('formFetch'); return null; }
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Microsoft Graph Fehler ' + r.status));
    const url = j['@microsoft.graph.downloadUrl']; if (!url) throw new Error('Keine Download-Adresse erhalten');
    const d = await fetch(url); if (!d.ok) throw new Error('Download fehlgeschlagen (' + d.status + ')');
    return d.arrayBuffer();
  }
};
function shareDownloadUrls(link) {
  const u = link.trim(), out = [];
  if (/sharepoint\.com/i.test(u)) { const base = u.split('#')[0]; out.push(base + (base.includes('?') ? '&' : '?') + 'download=1'); }
  if (/1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(u)) {
    const enc = 'u!' + btoa(unescape(encodeURIComponent(u))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    out.push(`https://api.onedrive.com/v1.0/shares/${enc}/root/content`);
    if (!/sharepoint/i.test(u)) out.push(`https://api.onedrive.com/v1.0/shares/${enc}/driveItem/content`);
  }
  if (!out.length) out.push(u);
  return out;
}
async function formFetch() {
  const link = formLink(); if (!link) { toast('Zuerst den Freigabelink eintragen'); return; }
  App.formBusy = true; App.render();
  let buf = null, err = '';
  if (MS.configured()) { // mit Microsoft-Anmeldung über Graph
    try { buf = await MS.download(link); if (!buf) return; } catch (e) { err = e.message; }
    App.formBusy = false;
    if (!buf) { App.formFail = err; App.render(); toast('Abrufen fehlgeschlagen: ' + err, 8000); return; }
    App.formFail = ''; App.render();
    return impForm(new File([buf], 'Formular (OneDrive).xlsx'));
  }
  for (const url of shareDownloadUrls(link)) {
    try {
      const r = await fetch(url, { cache: 'no-store', redirect: 'follow' });
      if (!r.ok) { err = 'Fehler ' + r.status; continue; }
      const b = await r.arrayBuffer(), h = new Uint8Array(b, 0, 2);
      if (h[0] === 0x50 && h[1] === 0x4b) { buf = b; break; } // «PK» = xlsx
      err = 'Der Link liefert keine Excel-Datei (Anmeldung nötig?)';
    } catch (e) { err = 'Zugriff vom Browser aus nicht möglich'; }
  }
  App.formBusy = false; App.render();
  if (!buf) { App.formFail = err || 'unbekannter Fehler'; App.render(); toast('Abrufen fehlgeschlagen: ' + App.formFail, 7000); return; }
  App.formFail = '';
  await impForm(new File([buf], 'Formular (Freigabelink).xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
function formLinkDialog() {
  openDlg('Freigabelink des Formular-Excels', `<p class="muted small">In Excel (OneDrive) die Datei mit den Formular-Antworten öffnen › <b>Freigeben</b> › <b>Link kopieren</b> – am besten «Jeder mit dem Link» und <b>nur anzeigen</b> (nicht bearbeiten). Den Link hier einfügen.</p>
    <label class="fld"><span>Freigabelink</span><input class="input" name="link" value="${esc(formLink())}" placeholder="https://1drv.ms/x/… oder https://…sharepoint.com/…" autofocus></label>
    <p class="small muted">Der Link wird nur in deinen App-Daten (Dropbox) gespeichert, nicht im öffentlichen Programmcode. Wer den Link hat, kann die Antworten lesen.</p>`,
    `${formLink() ? '<button class="btn danger" value="del">Link entfernen</button>' : ''}<span class="spacer"></span><button class="btn primary" value="ok">Speichern</button>`,
    { onSubmit: (fd, btn) => { Store.setCfg({ formLink: btn === 'del' ? '' : String(fd.get('link') || '').trim() }); App.formFail = ''; toast(btn === 'del' ? 'Link entfernt' : 'Link gespeichert'); } });
}

/* ---------- Papierrapport scannen (übernommen aus dem Programm ScanListe 3) ----------
   Handschriftliche Einsatzlisten im Heft: Datum | Name | Fläche/Menge | Bemerkung, pro Liste eine oder mehrere Maschinen.
   Wie ScanListe: Maschinen vorher ankreuzen (mehrere = je Eintrag eine Zeile pro Maschine), Mulcher-Einheit h/ha wählbar,
   Mengen-Einheit der Liste, Drehen («90° rechts» bei quer liegenden Heften), Heft-Doppelseite halbieren, Aren → ha,
   Zahlen ohne Einheit = Aren (einstellbar), Wiederholungszeichen auflösen, Rückseiten-Durchschlag ignorieren. */
const apiKey = () => ls('mv_apikey') || '';
const SCAN_MODELLE = [['claude-sonnet-5-5', 'Sonnet (empfohlen)'], ['claude-opus-5-5', 'Opus (beste Handschrift-Erkennung)'], ['claude-haiku-5-5', 'Haiku (schnell und günstig)']];
const DREHUNGEN = [['0', 'keine'], ['90', '90° rechts'], ['-90', '90° links'], ['180', '180°']];
const CLAUDE_MAX_EDGE = 1568;
const isMulcher = m => /mulch/i.test(m?.name || '');
function scanOpt() { return Object.assign({ drehen: '90', halbieren: true, ohneEinheit: 'a', masch: [], mulch: {}, listEinheit: '' }, lsJson('mv_scanopt') || {}); }
function setScanOpt(p) { lsJson('mv_scanopt', Object.assign(scanOpt(), p)); }
const scanUnit = (m, o) => isMulcher(m) ? (o.mulch[m.id] || m.einheit) : m.einheit;
function listUnit(o) { if (o.listEinheit) return o.listEinheit; const m = o.masch.map(masch).filter(Boolean)[0]; return m ? scanUnit(m, o) : 'ha'; }
function b64(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); }); }
const canvasJpeg = (cv, q = 0.9) => new Promise(r => cv.toBlob(r, 'image/jpeg', q));
// Bild drehen, ggf. halbieren (Heft-Doppelseite) → Teile für Claude + Vorschaubild der ganzen Seite
async function imageParts(file, o) {
  const bmp = await createImageBitmap(file), w = bmp.width, h = bmp.height;
  const crops = !o.halbieren ? [['ganzer Scan', 0, 0, w, h]]
    : h >= w ? [['obere Hälfte des Scans', 0, 0, w, Math.floor(h / 2)], ['untere Hälfte des Scans', 0, Math.floor(h / 2), w, h - Math.floor(h / 2)]]
      : [['linke Hälfte des Scans', 0, 0, Math.floor(w / 2), h], ['rechte Hälfte des Scans', Math.floor(w / 2), 0, w - Math.floor(w / 2), h]];
  const rot = (sx, sy, sw, sh, max) => {
    const a = +o.drehen, q = Math.abs(a) === 90, k = Math.min(1, max / Math.max(sw, sh));
    const tw = Math.round(sw * k), th = Math.round(sh * k), cv = document.createElement('canvas');
    cv.width = q ? th : tw; cv.height = q ? tw : th;
    const c = cv.getContext('2d'); c.translate(cv.width / 2, cv.height / 2); c.rotate(a * Math.PI / 180); c.drawImage(bmp, sx, sy, sw, sh, -tw / 2, -th / 2, tw, th);
    return cv;
  };
  const parts = [];
  for (const [label, x, y, cw, ch] of crops) parts.push({ label, data: await b64(await canvasJpeg(rot(x, y, cw, ch, CLAUDE_MAX_EDGE))) });
  const prev = rot(0, 0, w, h, 1400).toDataURL('image/jpeg', 0.8);
  return { parts, prev };
}
const SCAN_TOOL = { name: 'eintraege_erfassen', description: 'Speichert alle Zeilen der handschriftlichen Einsatzliste.',
  input_schema: { type: 'object', required: ['eintraege'], properties: {
    eintraege: { type: 'array', description: 'Alle ausgefüllten Tabellenzeilen von oben nach unten.', items: { type: 'object',
      required: ['datum', 'name', 'menge', 'einheit', 'original', 'bemerkung', 'unsicher', 'hinweis'], properties: {
        datum: { type: 'string', description: 'Datum als TT.MM.JJJJ' },
        name: { type: 'string', description: 'Name (Kunde, Hof, Firma) wie geschrieben, Wiederholungszeichen aufgelöst' },
        kunde: { type: 'string', description: 'Passender bekannter Kunde aus der Liste (genau so geschrieben) oder leer' },
        menge: { type: ['number', 'null'], description: 'Zahl aus der Flächen-/Mengen-Spalte; null wenn leer' },
        einheit: { type: 'string', enum: ['a', 'ha', 'h', 'm2', ''], description: 'Einheit wie notiert: a = Aren (a, are, aren, ARE), ha, h = Stunden, m2; leer wenn keine notiert' },
        original: { type: 'string', description: "Inhalt der Flächen-/Mengen-Zelle genau wie geschrieben, z.B. '235 are'" },
        bemerkung: { type: 'string', description: 'Echte Bemerkung (ohne die Einheit der Menge)' },
        unsicher: { type: 'boolean', description: 'true wenn etwas in dieser Zeile schlecht lesbar oder ergänzt ist' },
        hinweis: { type: 'string', description: 'Kurz, was unsicher oder ergänzt ist; sonst leer' } } } },
    kommentar: { type: 'string', description: 'Optional: allgemeine Auffälligkeiten der Seite' } } } };
function scanPrompt(labels, isPdf) {
  const year = new Date().getFullYear(), today = fmtDate(todayIso());
  const K = kundenSorted().map(k => k.name + ((k.aliases || []).length ? ' (auch: ' + k.aliases.join(', ') + ')' : '')).join('; ');
  return 'Die Bilder zeigen eine Seite aus einem handschriftlich geführten Maschinen-Einsatzheft eines Schweizer Landwirtschafts- bzw. Lohnunternehmerbetriebs. ' +
    'Darauf ist eine Tabelle mit den Spalten Datum | Name | Fläche (bzw. Menge oder Stunden) | Bemerkung; jede Zeile ist ein Einsatz bei einem Kunden.\n' +
    (isPdf ? 'Die Datei kann mehrere Seiten haben – lies alle Seiten. ' : `Der Scan wurde in ${labels.length} Bildausschnitt(e) geteilt (${labels.join(', ')}). `) +
    'Ein Ausschnitt kann leer sein oder nur blass durchscheinende, spiegelverkehrte Schrift von der Rückseite zeigen – diese ignorierst du vollständig. Steht die Tabelle trotz Drehung noch quer, lies sie trotzdem korrekt.\n\n' +
    'Regeln:\n- Jede ausgefüllte Tabellenzeile ist ein Eintrag, in der Reihenfolge von oben nach unten. Leere Zeilen weglassen. Notizen ausserhalb der Tabelle (z.B. Summen am Rand) nicht als Eintrag erfassen.\n' +
    `- Datum immer als TT.MM.JJJJ. Fehlt das Jahr, nimm das Jahr der Nachbarzeilen, sonst ${year}. Fehlt der Monat, ergänze ihn aus der Zeile darüber und setze unsicher=true.\n` +
    '- Wiederholungszeichen (" oder ,, oder „ oder dito oder ein Strich) bedeuten: gleicher Wert wie in der Zeile darüber – schreibe den Wert aus und vermerke es im Hinweis.\n' +
    '- menge ist nur die Zahl; die Einheit gehört in einheit. Aren-Schreibweisen (a, are, aren, ARE) → "a". Steht die Einheit in der Bemerkungsspalte (z.B. \'are\'), gehört sie zur Menge und nicht in die Bemerkung. Ist keine Einheit notiert, bleibt einheit leer.\n' +
    '- Durchgestrichenes ignorieren; bei Korrekturen den gültigen Wert nehmen.\n' +
    '- Namen (Personen, Höfe, Firmen, Gemeinden) so genau wie möglich ablesen; bei unsicheren Buchstaben unsicher=true und im Hinweis die Alternative nennen.\n' +
    (K ? `- Bekannte Kunden (nur als Lesehilfe, nichts erzwingen): ${K}. Passt ein Name sicher zu einem davon, trage ihn in «kunde» ein, sonst bleibt «kunde» leer. In «name» steht immer, was wirklich geschrieben ist.\n` : '') +
    '- Erfinde nichts. Unleserliches mit [?] kennzeichnen.\n' +
    `Heute ist der ${today}. Antworte ausschliesslich, indem du das Werkzeug eintraege_erfassen einmal mit allen Zeilen aufrufst (auch wenn die Seite leer ist: dann mit einer leeren Liste).`;
}
async function claudeCall(body) {
  const key = apiKey(); if (!key) throw new Error('Kein API-Schlüssel – unter Mehr › Scan eintragen');
  let last = '';
  for (let i = 0; i < 3; i++) {
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    } catch (e) { last = 'Keine Verbindung zu Claude'; await new Promise(r => setTimeout(r, 2000)); continue; }
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    last = (j.error && j.error.message) || ('Fehler ' + r.status);
    if (r.status === 401) throw new Error('API-Schlüssel ungültig');
    if (![429, 500, 502, 503, 529].includes(r.status)) break;
    await new Promise(r => setTimeout(r, 4000 * (i + 1)));
  }
  throw new Error(last);
}
function parseEntries(resp) { // Werkzeug-Aufruf, notfalls JSON im Text
  let data = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'eintraege_erfassen')?.input;
  if (!data) { const t = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join(''); try { data = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { data = null; } }
  if (!data || !('eintraege' in data)) return null;
  let e = data.eintraege; if (typeof e === 'string') { try { e = JSON.parse(e); } catch { e = []; } }
  return { eintraege: (e || []).filter(x => x && typeof x === 'object'), kommentar: String(data.kommentar || '') };
}
async function claudeReadPage(content) {
  const body = { model: ls('mv_model') || DEF_MODEL, max_tokens: 16000, tools: [SCAN_TOOL], tool_choice: { type: 'tool', name: 'eintraege_erfassen' }, messages: [{ role: 'user', content }] };
  for (let a = 0; a < 2; a++) {
    const resp = await claudeCall(body), res = parseEntries(resp);
    if (res) return res;
    if (resp.stop_reason === 'max_tokens') throw new Error('Die Antwort war zu lang und wurde abgeschnitten.');
    body.messages = [body.messages[0], { role: 'assistant', content: resp.content || [{ type: 'text', text: '…' }] }, { role: 'user', content: 'Bitte rufe jetzt das Werkzeug eintraege_erfassen mit allen Zeilen auf.' }];
    delete body.tool_choice;
  }
  throw new Error('Claude hat keine auswertbare Antwort geliefert.');
}
// Notierte Menge in die Einheit der Liste umrechnen (wie ScanListe convert_menge)
function convertMenge(menge, einheit, ziel, ohne) {
  if (menge == null) return { wert: null, hinweis: 'Menge fehlt' };
  let e = String(einheit || '').trim().toLowerCase(), hinweis = '';
  if (ziel === 'ha') {
    if (!e) { e = ohne; if (e === 'a' && menge < 10 && menge !== Math.trunc(menge)) hinweis = 'ohne Einheit, als Aren gewertet – evtl. ha?'; }
    if (e === 'a') return { wert: Math.round(menge / 100 * 1e4) / 1e4, hinweis };
    if (e === 'ha') return { wert: menge, hinweis };
    if (e === 'm2') return { wert: Math.round(menge / 1e4 * 1e4) / 1e4, hinweis };
    return { wert: menge, hinweis: `Einheit «${e}» passt nicht zu ha` };
  }
  if (!e || e === 'h') return { wert: menge, hinweis: '' };
  return { wert: menge, hinweis: `Einheit «${e}» passt nicht zu h` };
}
async function scanFiles(files) {
  if (!apiKey()) { toast('Zuerst unter Mehr › Scan den Claude-API-Schlüssel eintragen'); App.go('mehr'); return; }
  const o = scanOpt(), M = o.masch.map(masch).filter(Boolean), ziel = listUnit(o), out = [];
  App.scanPages = App.scanPages && App.imp ? App.scanPages : [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i], isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      App.scanBusy = `${i + 1} / ${files.length}: ${f.name}`; App.render();
      let content, labels = [];
      if (isPdf) content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await b64(f) } }];
      else {
        const { parts, prev } = await imageParts(f, o); labels = parts.map(p => p.label);
        content = parts.flatMap((p, n) => [{ type: 'text', text: `Bild ${n + 1}: ${p.label}` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.data } }]);
        App.scanPages.push({ name: f.name, url: prev });
      }
      content.push({ type: 'text', text: scanPrompt(labels, isPdf) });
      const page = isPdf ? null : App.scanPages.length - 1;
      const { eintraege, kommentar } = await claudeReadPage(content);
      eintraege.forEach(e => {
        const m0 = num(e.menge), { wert, hinweis } = convertMenge(m0, e.einheit, ziel, o.ohneEinheit);
        const original = String(e.original || '').trim() || (m0 != null ? `${fmtNum(m0, 4)} ${e.einheit || ''}`.trim() : '');
        const base = { kText: String(e.name || '').trim(), kCanon: String(e.kunde || '').trim(), datum: parseDatum(e.datum), raw: original, bem: String(e.bemerkung || '').trim(), page,
          unsicher: !!e.unsicher || !!hinweis, note: [e.hinweis, hinweis, files.length > 1 ? f.name : ''].filter(Boolean).join(' · ') };
        if (!M.length) { out.push(Object.assign({}, base, { mText: '', menge: wert, einheit: ziel })); return; }
        M.forEach(m => { // je Maschine eine Zeile; andere Einheit als die Liste → keine Menge, prüfen
          const u = scanUnit(m, o), ok = u === ziel;
          out.push(Object.assign({}, base, { mText: m.name, mCanon: m.name, menge: ok ? wert : null, einheit: u, unsicher: base.unsicher || !ok,
            note: [base.note, ok ? '' : `Einheit der Liste (${ziel}) passt nicht zu ${m.name} (${u}) – Menge eintragen`].filter(Boolean).join(' · ') }));
        });
      });
      if (kommentar) toast(`${f.name}: ${kommentar}`, 6000);
    }
  } catch (e) { App.scanBusy = ''; App.render(); toast('Scan fehlgeschlagen: ' + e.message, 8000); if (!out.length) return; }
  App.scanBusy = '';
  if (!out.length) { App.render(); toast('Auf dem Scan wurden keine Einträge gefunden', 5000); return; }
  App.pageSel = out.find(r => r.page != null)?.page ?? null;
  impStart('Scan', files.map(f => f.name).join(', '), out);
}
async function claudeTest() {
  try { const r = await claudeCall({ model: ls('mv_model') || DEF_MODEL, max_tokens: 20, messages: [{ role: 'user', content: 'Antworte nur mit: OK' }] });
    toast('Verbindung OK – Antwort: ' + (r.content || []).map(b => b.text || '').join('').trim(), 5000); } catch (e) { toast('Verbindung fehlgeschlagen: ' + e.message, 7000); }
}

/* ---------- Ansicht Import (Auswahl der Quelle oder Prüfliste) ---------- */
function viewImport() {
  if (App.imp) return viewPruef();
  const o = scanOpt(), sel = new Set(o.masch), lu = listUnit(o);
  const mrow = m => { const on = sel.has(m.id), u = scanUnit(m, o);
    return `<label class="srow ${on ? 'on' : ''}"><input type="checkbox" data-in="scanM" value="${m.id}" ${on ? 'checked' : ''}><span class="grow">${esc(m.name)}</span>
      ${isMulcher(m) ? `<select class="input" data-in="scanMulch" data-id="${m.id}" style="width:auto;min-height:32px;padding:3px 8px" title="Einheit für diesen Mulcher">${optList(EINHEITEN.map(x => [x, x]), u)}</select>` : `<span class="nr">${esc(u)}</span>`}
      ${on && u !== lu ? '<span class="chip warn" title="andere Einheit als die Liste – erhält keine Menge">prüfen</span>' : ''}</label>`; };
  return { tb: `<h1>Import</h1>`, html: `<div class="cols">
    <div class="panel"><h2>Einsatzheft scannen</h2><p>Handschriftliche Listen (Datum | Name | Fläche | Bemerkung). Claude liest jede Zeile – danach prüfst du alles in der Prüfliste.</p>
      ${apiKey() ? '' : '<div class="box warn small">Noch kein Claude-API-Schlüssel auf diesem Gerät – unter <a href="#" data-act="go" data-v="mehr">Mehr › Scan</a> eintragen.</div>'}
      <div class="fld"><span>1. Maschine(n) dieser Liste ankreuzen</span><div class="slist">${maschSorted(false).map(mrow).join('')}</div>
        <div class="hint">Mehrere angekreuzt = pro Eintrag eine Zeile je Maschine. ${sel.size ? `<a href="#" data-act="scanClear">Auswahl löschen</a>` : ''}</div></div>
      <div class="three"><label class="fld"><span>Mengen-Einheit der Liste</span><select class="input" data-in="scanOpt" data-k="listEinheit">${optList([['', `automatisch (${listUnit(Object.assign({}, o, { listEinheit: '' }))})`], ['ha', 'ha (Fläche)'], ['h', 'h (Stunden)']], o.listEinheit)}</select></label>
        <label class="fld"><span>Ausrichtung</span><select class="input" data-in="scanOpt" data-k="drehen">${optList(DREHUNGEN, o.drehen)}</select></label>
        <label class="fld"><span>Zahl ohne Einheit</span><select class="input" data-in="scanOpt" data-k="ohneEinheit">${optList([['a', 'gilt als Aren'], ['ha', 'gilt als ha']], o.ohneEinheit)}</select></label></div>
      <label class="tog" style="margin-bottom:12px"><input type="checkbox" data-in="scanHalb" ${o.halbieren ? 'checked' : ''}> Heft-Doppelseite (jede Hälfte einzeln und grösser an Claude)</label>
      ${App.scanBusy ? `<div class="box"><span class="spin"></span> Lese ${esc(App.scanBusy)} …</div>` : `<div class="btns"><label class="btn primary">2. Scan / Foto wählen…<input type="file" accept="image/*,application/pdf" multiple data-in="impScanFile" hidden></label>
        <label class="btn">📷 Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-in="impScanFile" hidden></label></div>`}
      <p class="small">Tipp: Scannen mit 300 dpi in Farbe (blaue Kugelschreiber-Schrift), z. B. mit der HP-Software oder «Windows Scan» als JPG/PNG oder PDF. Drehen und Halbieren gelten für Bilder; PDF wird unverändert gelesen. Wird eine Heftseite später nochmals gescannt, sind die schon übernommenen Zeilen als «vorhanden» markiert.</p></div>
    <div class="panel"><h2>Online-Formular</h2>
      ${formLink() ? `<p>Formular-Excel verknüpft. <b>1.</b> Öffnen – Excel im Browser holt dabei die neuesten Antworten in die Datei. <b>2.</b> Abrufen – die App liest die Datei direkt und zeigt die Prüfliste.</p>
        <div class="btns"><a class="btn" href="${esc(formLink())}" target="_blank" rel="noopener">📄 1. Formular-Excel öffnen</a>
          ${App.formBusy ? '<span class="btn" disabled><span class="spin"></span> Lade…</span>' : '<button class="btn primary" data-act="formFetch">⬇ 2. Abrufen und importieren</button>'}
          <button class="btn small" data-act="formLink">Link ändern</button></div>
        ${App.formFail ? `<div class="box warn small" style="margin-top:10px">Direktes Abrufen hat nicht geklappt (${esc(App.formFail)}).
          ${MS.configured() ? '' : 'Microsoft lässt den anonymen Zugriff über diesen Link nicht zu. Abhilfe: <a href="#" data-act="go" data-v="mehr">Mehr › Microsoft</a> einrichten – dann ruft die App die Datei mit deiner Microsoft-Anmeldung ab. '}
          Sofort geht es so: Formular-Excel öffnen › <b>Datei › Speichern unter › Kopie herunterladen</b> und die Datei hier unten wählen.</div>` : ''}
        ${MS.configured() ? `<p class="small muted" style="margin-top:8px">Abruf mit Microsoft-Anmeldung${MS.hasSession() ? ' (angemeldet)' : ' – beim ersten Abrufen erscheint die Microsoft-Anmeldung'}.</p>` : ''}`
      : `<p>Die Excel-Datei mit den Formular-Antworten kann per Freigabelink verknüpft werden – dann lässt sie sich von hier öffnen und direkt importieren.</p>
        <div class="btns"><button class="btn primary" data-act="formLink">🔗 Freigabelink eintragen…</button></div>`}
      <p class="small" style="margin-top:12px">Oder eine heruntergeladene Datei einlesen (.xlsx/.csv). Es kann immer der ganze Export eingelesen werden – schon importierte Antworten werden erkannt und weggelassen.</p>
      <div class="btns"><label class="btn">Excel-Datei wählen…<input type="file" accept=".xlsx,.csv" data-in="impFormFile" hidden></label></div></div>
  </div>` };
}
function viewPruef() {
  const I = App.imp, rows = I.rows, nSel = rows.filter(r => r.sel).length, pages = App.scanPages || [];
  const pv = pages.length && rows.some(r => r.page != null) ? (pages[App.pageSel ?? 0] || pages[0]) : null;
  const cnt = s => rows.filter(r => r.status === s).length;
  const kq = { exakt: '', variante: '<span class="chip ok" title="über Namensvariante erkannt">Variante</span>', 'ähnlich': '<span class="chip warn" title="ähnlicher Name – bitte prüfen">ähnlich?</span>' };
  const body = rows.map((r, i) => {
    const st = r.status === 'dup' ? `<span class="chip done" title="${esc(r.dupInfo)}">vorhanden</span>` : r.status === 'aehnlich' ? `<span class="chip warn" title="${esc(r.dupInfo)}">ähnlich</span>` : '<span class="chip info">neu</span>';
    const kOpt = `<option value="">– wählen –</option><option value="__new" ${r.kId === '__new' ? 'selected' : ''}>＋ Neukunde anlegen</option>` + kundenSorted().map(k => `<option value="${k.id}" ${r.kId === k.id ? 'selected' : ''}>${esc(kLabel(k))}</option>`).join('');
    const mOpt = `<option value="">– wählen –</option>` + maschSorted().map(m => `<option value="${m.id}" ${r.mId === m.id ? 'selected' : ''}>${esc(mLabel(m))}</option>`).join('');
    const bad = r.sel && (!r.kId || !r.mId || r.menge == null || (r.kId === '__new' && !r.newName.trim()));
    return `<tr class="${r.status === 'dup' ? 'off' : ''} ${bad ? 'dup' : ''}">
      <td class="cb"><input type="checkbox" data-in="impSel" data-i="${i}" ${r.sel ? 'checked' : ''}></td>
      <td style="min-width:170px">${st}${r.unsicher ? ' <span class="chip warn">unsicher</span>' : ''}${r.abg ? ' <span class="chip done" title="im Formular als abgerechnet markiert">abgerechnet</span>' : ''}${r.page != null && pages[r.page] ? ` <button type="button" class="btn small ${App.pageSel === r.page ? 'primary' : ''}" data-act="pageSel" data-p="${r.page}" title="Seite anzeigen">📄 ${r.page + 1}</button>` : ''}${r.dupInfo ? `<div class="small muted">${esc(r.dupInfo)}</div>` : ''}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td>
      <td><input class="input" type="date" value="${esc(r.datum)}" data-in="impF" data-i="${i}" data-f="datum" style="width:150px"></td>
      <td style="min-width:220px"><div class="small muted">«${esc(r.kText)}» ${kq[r.kQ] || ''}</div><select class="input" data-in="impF" data-i="${i}" data-f="kId">${kOpt}</select>
        ${r.kId === '__new' ? `<input class="input" value="${esc(r.newName)}" data-in="impF" data-i="${i}" data-f="newName" placeholder="Name Neukunde" style="margin-top:4px">` : ''}</td>
      <td style="min-width:200px"><div class="small muted">«${esc(r.mText)}» ${kq[r.mQ] || ''}</div><select class="input" data-in="impF" data-i="${i}" data-f="mId">${mOpt}</select></td>
      <td><input class="input" inputmode="decimal" value="${r.menge ?? ''}" data-in="impF" data-i="${i}" data-f="menge" style="width:80px">${r.raw !== '' && r.raw != null && !(num(r.raw) != null && r.menge != null && Math.abs(num(r.raw) - r.menge) < 1e-6) ? `<div class="small muted">«${esc(r.raw)}»</div>` : ''}</td>
      <td><select class="input" data-in="impF" data-i="${i}" data-f="einheit" style="min-width:72px">${optList(EINHEITEN.map(u => [u, u]), r.einheit)}</select></td>
      <td><input class="input" value="${esc(r.bem)}" data-in="impF" data-i="${i}" data-f="bem" style="min-width:140px"></td></tr>`;
  }).join('');
  return { tb: `<h1>Prüfliste ${esc(I.src)}</h1><button class="btn" data-act="impCancel">Verwerfen</button><button class="btn primary" data-act="impSave" ${nSel || I.abgVorh ? '' : 'disabled'}>${nSel} Einsätze übernehmen</button>`,
    html: `<div class="box small">«${esc(I.file)}» · ${rows.length} Zeilen: ${cnt('neu')} neu${cnt('aehnlich') ? `, ${cnt('aehnlich')} ähnlich (nicht angekreuzt – bitte prüfen)` : ''}${cnt('dup') ? `, ${cnt('dup')} schon vorhanden (nicht angekreuzt)` : ''}.
      Kunde und Maschine werden über Namen und Namensvarianten erkannt. Was du hier zuordnest, merkt sich das Programm als neue Namensvariante.</div>
    ${(() => { const nA = rows.filter(r => r.abg && r.status !== 'dup').length, vA = rows.filter(r => r.abg && r.status === 'dup' && r.dupId && isOffen(Store.get('einsaetze', r.dupId) || {})).length;
      return nA || vA ? `<div class="box small">${nA ? `<label class="tog"><input type="checkbox" data-in="impOpt" data-k="abgNeu" ${I.abgNeu !== false ? 'checked' : ''}> ${nA} neue Einsätze sind im Formular als «abgerechnet» markiert – so übernehmen</label><br>` : ''}
        ${vA ? `<label class="tog"><input type="checkbox" data-in="impOpt" data-k="abgVorh" ${I.abgVorh ? 'checked' : ''}> ${vA} schon vorhandene, hier noch offene Einsätze sind im Formular abgerechnet – in der App ebenfalls als abgerechnet markieren</label>` : ''}</div>` : ''; })()}
    <div class="filters"><button class="btn small" data-act="impAll" data-v="1">Alle neuen ankreuzen</button><button class="btn small" data-act="impAll" data-v="0">Keine</button>${I.src === 'Formular' && App.formRaw ? '<button class="btn small" data-act="formRemap">Spalten neu zuordnen…</button>' : ''}</div>
    <div class="${pv ? 'scanwrap' : ''}">${pv ? `<div class="pview"><div class="small muted">${esc(pv.name)} – Seite ${pages.indexOf(pv) + 1} von ${pages.length}</div><img src="${pv.url}" alt="Scan" data-act="pageBig"></div>` : ''}
    <div class="dscroll"><table class="dtab"><thead><tr><th class="cb"></th><th>Status</th><th>Datum</th><th>Kunde</th><th>Maschine</th><th>Menge</th><th>Einh.</th><th>Bemerkung</th></tr></thead><tbody>${body}</tbody></table></div></div>` };
}
function impSave() {
  const I = App.imp, rows = I.rows.filter(r => r.sel);
  const bad = rows.filter(r => !r.kId || !r.mId || r.menge == null || (r.kId === '__new' && !r.newName.trim()));
  if (bad.length) { toast(`${bad.length} angekreuzte Zeilen ohne Kunde, Maschine oder Menge (rot markiert)`, 5000); return; }
  const newK = new Map(), kUpd = new Map(), mUpd = new Map();
  rows.filter(r => r.kId === '__new').forEach(r => { const key = tokKey(r.newName); if (!newK.has(key)) newK.set(key, { id: 'k' + uid(), nr: '', name: r.newName.trim(), aliases: [], aktiv: true, bem: 'Neukunde' }); r._k = newK.get(key).id; });
  const learn = (map, coll, id, text, getter) => {
    if (!text) return; const o = map.get(id) || Object.assign({}, getter(id)); if (!o.id) return;
    if (fold(o.name) !== fold(text) && !(o.aliases || []).some(a => fold(a) === fold(text))) { o.aliases = [...(o.aliases || []), text]; map.set(id, o); }
  };
  rows.forEach(r => {
    const kid = r._k || r.kId;
    if (!r._k) learn(kUpd, 'kunden', kid, r.kText, kunde); else { const k = [...newK.values()].find(x => x.id === kid); if (k && fold(r.kText) !== fold(k.name) && !k.aliases.some(a => fold(a) === fold(r.kText))) k.aliases.push(r.kText); }
    learn(mUpd, 'maschinen', r.mId, r.mText, masch);
  });
  if (newK.size || kUpd.size) Store.putMany('kunden', [...newK.values(), ...kUpd.values()], { silent: true });
  if (mUpd.size) Store.putMany('maschinen', [...mUpd.values()], { silent: true });
  const quelle = I.src === 'Scan' ? 'Scan' : 'Formular';
  Store.putMany('einsaetze', rows.map(r => ({ id: 'e' + uid() + Math.random().toString(36).slice(2, 5), datum: r.datum, kunde: r._k || r.kId, maschine: r.mId, menge: r.menge, einheit: r.einheit, bem: r.bem,
    quelle, status: r.abg && I.abgNeu !== false ? 'abgerechnet' : 'offen', abgerechnetAm: r.abg && I.abgNeu !== false ? todayIso() : '', importAm: todayIso(), orig: { name: r.kText, maschine: r.mText, menge: r.raw, sig: r.sig || '' } })), { silent: true });
  let nV = 0;
  if (I.abgVorh) { const ids = I.rows.filter(r => r.abg && r.status === 'dup' && r.dupId && isOffen(Store.get('einsaetze', r.dupId) || {})).map(r => r.dupId); nV = ids.length; if (nV) setStatus(ids, 'abgerechnet'); }
  App.imp = null; ls('mv_imp', null);
  toast(`${rows.length} Einsätze übernommen${nV ? `, ${nV} vorhandene als abgerechnet markiert` : ''}${newK.size ? `, ${newK.size} Neukunden angelegt` : ''}`, 5000);
  App.f.einsaetze = Object.assign(defFilter(), { q: '' }); App.sort = { key: 'datum', dir: -1 }; App.go('einsaetze');
}

/* ================= Ansicht Abrechnung: Kundenrapporte, Abrechnungsliste ================= */
/* Auswahl: einzelne Zeilen (App.abr.rows, anfangs leer). Kunde ankreuzen = alle seine Zeilen (ohne stornierte und ohne «nicht im Rapport»).
   Nur ausgewählte Zeilen kommen in Rapport und Abrechnungsliste. */
function abrGroups() { // L = Einsätze im Filter, R = davon ausgewählt (nie stornierte)
  const list = applyFilter(Store.all('einsaetze'), App.f.abr), g = new Map(), S = App.abr.rows;
  list.forEach(e => { if (!g.has(e.kunde)) g.set(e.kunde, []); g.get(e.kunde).push(e); });
  return [...g.entries()].map(([id, L]) => { L.sort((a, b) => (a.datum || '').localeCompare(b.datum || '')); return { k: kunde(id) || { id, name: '(unbekannt)', nr: '' }, L, R: L.filter(e => S.has(e.id) && !isStorno(e)) }; })
    .sort((a, b) => a.k.name.localeCompare(b.k.name, 'de'));
}
const abrWahl = g => g.L.filter(e => !isStorno(e) && !e.ohneRapport); // Standardauswahl beim Ankreuzen des Kunden
const abrIsSel = id => { const g = abrGroups().find(x => x.k.id === id); return !!(g && g.R.length); };
const abrOpen = () => (App.abr.open = App.abr.open || new Set());
function abrToggleKunde(id) {
  const g = abrGroups().find(x => x.k.id === id); if (!g) return;
  const S = App.abr.rows, all = g.R.length && g.R.length >= abrWahl(g).length;
  if (g.R.length) g.L.forEach(e => S.delete(e.id)); else abrWahl(g).forEach(e => S.add(e.id));
  if (!all && g.R.length) { /* teilweise ausgewählt → alle abwählen */ }
}
function viewAbrechnung() {
  const G = abrGroups(), sel = G.filter(g => g.R.length), all = sumUp(sel.flatMap(g => g.R)), preise = Store.cfg().rapportPreise, anyPreis = Store.all('maschinen').some(m => m.preis != null);
  const open = abrOpen();
  const rows = G.map(g => { const s = sumUp(g.R.length ? g.R : abrWahl(g)), hints = [], aus = g.L.filter(e => e.ohneRapport && !isStorno(e)).length, nSt = g.L.filter(isStorno).length, isOpen = open.has(g.k.id);
    const nW = g.L.filter(e => !isStorno(e)).length, full = g.R.length && g.R.length === nW, part = g.R.length && !full;
    if (!g.k.nr) hints.push('<span class="chip warn">Neukunde</span>');
    if (aus) hints.push(`<span class="chip warn" title="im Einsatz als «nicht im Rapport» markiert">${aus} nicht im Rapport</span>`);
    if (s.ohnePreis && anyPreis) hints.push(`<span class="chip warn">${s.ohnePreis} ohne Preis</span>`);
    if (g.L.some(e => !e.datum)) hints.push('<span class="chip warn">ohne Datum</span>');
    if (nSt) hints.push(`<span class="chip storno">${nSt} storniert</span>`);
    if (g.L.some(isDone)) hints.push(`<span class="chip done">${g.L.filter(isDone).length} abgerechnet</span>`);
    const head = `<tr class="click ${g.R.length ? 'sel' : ''}" data-act="abrToggle" data-id="${g.k.id}"><td class="cb"><input type="checkbox" ${g.R.length ? 'checked' : ''} ${part ? 'data-ind="1"' : ''} tabindex="-1"></td>
      <td><button type="button" class="btn small" data-act="abrExp" data-id="${g.k.id}" title="Zeilen anzeigen und einzeln auswählen">${isOpen ? '▾' : '▸'} ${g.R.length ? g.R.length + ' / ' : ''}${nW}${nSt ? ' +' + nSt : ''}</button></td>
      <td class="n">${esc(g.k.nr || '')}</td><td><b>${esc(g.k.name)}</b></td><td class="n">${s.ha ? fmtQty(s.ha) : ''}</td><td class="n">${s.h ? fmtQty(s.h) : ''}</td><td class="n">${s.chf ? chf(s.chf) : ''}</td><td>${hints.join(' ')}</td>
      <td><button class="btn small" data-act="abrOne" data-id="${g.k.id}" title="Rapport nur für diesen Kunden (ausgewählte Zeilen, sonst alle)" ${nW ? '' : 'disabled'}>Rapport</button></td></tr>`;
    const sub = isOpen ? g.L.map(e => { const m = masch(e.maschine) || {}, b = betragOf(e), st = isStorno(e), on = App.abr.rows.has(e.id) && !st;
      return `<tr class="sub click ${on ? 'sel' : ''} ${st ? 'off storno' : ''} ${isDone(e) ? 'done' : ''}" data-act="abrEntry" data-id="${e.id}" title="Anklicken = Details"><td></td>
        <td class="cb" style="text-align:left"><input type="checkbox" data-act="abrRow" data-id="${e.id}" ${on ? 'checked' : ''} ${st ? 'disabled' : ''} title="${st ? 'storniert – nie im Rapport' : 'Zeile auswählen (Rapport, Abrechnungsliste, abrechnen)'}">${e.ohneRapport ? ' <span class="chip warn small">nicht im Rapport</span>' : ''}</td>
        <td class="small">${e.datum ? fmtDate(e.datum) : 'ohne Datum'}</td><td class="small">${esc(m.artNr || '')} ${esc(m.name || '?')}${e.bem ? ' · ' + esc(e.bem) : ''}</td>
        <td class="n small">${einhOf(e) === 'ha' ? fmtQty(e.menge) : ''}</td><td class="n small">${einhOf(e) === 'h' ? fmtQty(e.menge) : ''}</td><td class="n small">${b != null && !st ? chf(b) : ''}</td>
        <td class="small">${statusChip(e)}</td><td class="small muted">Details ›</td></tr>`; }).join('') : '';
    return head + sub; }).join('');
  const allSel = G.length && G.every(g => g.R.length), nOffen = sel.reduce((a, g) => a + g.L.filter(isOffen).length, 0), nHak = sel.reduce((a, g) => a + g.R.filter(isOffen).length, 0);
  const nZ = sel.reduce((a, g) => a + g.R.length, 0);
  return { tb: `<h1>Abrechnung</h1>`,
    html: filterBar('abr', { search: false, maschine: false, kunde: false, storno: true }) +
    `<div class="filters"><button class="btn primary" data-act="abrPrint" ${sel.length ? '' : 'disabled'}>🖨 Rapporte (${sel.length})</button><button class="btn" data-act="abrList" ${sel.length ? '' : 'disabled'}>🖨 Abrechnungsliste</button>
      <button class="btn" data-act="abrXlsx" ${sel.length ? '' : 'disabled'}>⬇ Abrechnungsliste Excel</button><button class="btn" data-act="abrDoneSel" ${nHak ? '' : 'disabled'} title="nur die ausgewählten offenen Zeilen">✓ Ausgewählte Zeilen abgerechnet (${nHak})</button>
      <button class="btn" data-act="abrDone" ${nOffen ? '' : 'disabled'} title="alle offenen Einsätze der Kunden mit ausgewählten Zeilen – auch die nicht ausgewählten">✓ Alle Einsätze dieser Kunden abgerechnet (${nOffen})</button>
      ${G.length ? `<button class="btn small" data-act="abrExpAll">${G.every(g => open.has(g.k.id)) ? 'Alle zuklappen' : 'Alle Zeilen zeigen'}</button>` : ''}</div>
    ${anyPreis ? '' : '<div class="box warn small">Noch keine Preise erfasst – Rapporte und Abrechnungsliste zeigen nur Mengen. Preise unter <a href="#" data-act="goMasch">Stammdaten › Maschinen</a> eintragen.</div>'}
    <p class="muted small">Kunde ankreuzen = alle seine Zeilen auswählen; mit ▸ aufklappen und Zeilen einzeln an- oder abwählen. Nur ausgewählte Zeilen kommen in Rapport und Abrechnungsliste.
      Zeile anklicken = Details (bearbeiten, stornieren, als abgerechnet markieren). Rapport: eine Seite pro Kunde, ohne Seitenzahlen; vor dem Drucken lassen sich die Artikelpreise nur für diesen Ausdruck anpassen.</p>
    ${G.length ? `<div class="dscroll"><table class="dtab"><thead><tr><th class="cb"><input type="checkbox" data-act="abrAll" ${allSel ? 'checked' : ''} title="alle Kunden auswählen / keine"></th><th>Zeilen</th><th class="n">Kd-Nr.</th><th>Kunde</th><th class="n">ha</th><th class="n">h</th><th class="n">CHF</th><th>Hinweise</th><th></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td></td><td>${nZ}</td><td colspan="2">${sel.length} von ${G.length} Kunden ausgewählt</td><td class="n">${fmtQty(all.ha)}</td><td class="n">${fmtQty(all.h)}</td><td class="n">${all.chf ? chf(all.chf) : ''}</td><td colspan="2"></td></tr></tfoot></table></div>`
      : '<div class="empty">Keine Einsätze für diesen Zeitraum.</div>'}` };
}
function zeitraum(L) { const ds = L.map(e => e.datum).filter(Boolean).sort(); return ds.length ? `${fmtDate(ds[0])} – ${fmtDate(ds[ds.length - 1])}` : ''; }
function sumByArt(L) { // pro Artikel (Maschine), Einheit und Preis zusammenfassen
  const m = new Map();
  L.forEach(e => { const ma = masch(e.maschine) || {}, u = einhOf(e), p = preisOf(e), key = [e.maschine, u, p].join('|');
    if (!m.has(key)) m.set(key, { art: ma.artNr || '', name: ma.name || '?', einheit: u, preis: p, menge: 0, n: 0 });
    const x = m.get(key); x.menge = r2(x.menge + (e.menge || 0)); x.n++; });
  return [...m.values()].map(x => Object.assign(x, { betrag: x.preis != null ? r2(x.preis * x.menge) : null })).sort((a, b) => String(a.art).localeCompare(String(b.art), 'de', { numeric: true }));
}
function rapportHtml(k, L, preise) {
  const S = sumByArt(L), s = sumUp(L), pc = preise ? 2 : 0;
  return `<div class="bill"><img class="lhead" src="logo.jpg" alt="Indermühle Lohnarbeiten · Maschinenvermietung">
    <h2>Rapport Maschinenmiete</h2>
    <div class="meta"><b>${esc(k.name)}</b> · ${k.nr ? 'Kunden-Nr. ' + esc(k.nr) : 'Neukunde'}${zeitraum(L) ? ' · Zeitraum ' + zeitraum(L) : ''} · ${L.length} Einsätze · Stand ${fmtDate(todayIso())}</div>
    <table class="btab"><thead><tr><th>Datum</th><th class="n">Art.-Nr.</th><th>Maschine</th><th class="n">Menge</th><th>Einheit</th><th>Bemerkung</th>${preise ? '<th class="n">Preis</th><th class="n">Betrag CHF</th>' : ''}</tr></thead><tbody>
    ${L.map(e => { const m = masch(e.maschine) || {}, p = preisOf(e), b = betragOf(e); return `<tr><td>${e.datum ? fmtDate(e.datum) : 'ohne Datum'}</td><td class="n">${esc(m.artNr || '')}</td><td>${esc(m.name || '')}</td><td class="n">${fmtQty(e.menge)}</td><td>${esc(einhOf(e))}</td><td>${esc(e.bem || '')}</td>${preise ? `<td class="n">${p != null ? chf(p) : ''}</td><td class="n">${b != null ? chf(b) : ''}</td>` : ''}</tr>`; }).join('')}
    </tbody></table>
    <h3>Zusammenfassung</h3>
    <table class="btab"><thead><tr><th class="n">Art.-Nr.</th><th>Maschine</th><th class="n">Einsätze</th><th class="n">Menge</th><th>Einheit</th>${preise ? '<th class="n">Preis</th><th class="n">Betrag CHF</th>' : ''}</tr></thead><tbody>
    ${S.map(x => `<tr><td class="n">${esc(x.art)}</td><td>${esc(x.name)}</td><td class="n">${x.n}</td><td class="n">${fmtQty(x.menge)}</td><td>${esc(x.einheit)}</td>${preise ? `<td class="n">${x.preis != null ? chf(x.preis) : ''}</td><td class="n">${x.betrag != null ? chf(x.betrag) : ''}</td>` : ''}</tr>`).join('')}
    ${s.ha ? `<tr class="tot"><td></td><td>Total Fläche</td><td></td><td class="n">${fmtQty(s.ha)}</td><td>ha</td>${pc ? '<td></td><td></td>' : ''}</tr>` : ''}
    ${s.h ? `<tr class="${s.ha ? '' : 'tot'}"><td></td><td><b>Total Stunden</b></td><td></td><td class="n"><b>${fmtQty(s.h)}</b></td><td><b>h</b></td>${pc ? '<td></td><td></td>' : ''}</tr>` : ''}
    ${preise && s.chf ? `<tr class="tot"><td></td><td>Total CHF${s.ohnePreis ? ' (ohne ' + s.ohnePreis + ' Einsätze ohne Preis)' : ''}</td><td></td><td></td><td></td><td></td><td class="n">${chf(s.chf)}</td></tr>` : ''}
    </tbody></table></div>`;
}
function abrListHtml(G) {
  G = G.filter(g => g.R.length).map(g => Object.assign({}, g, { L: g.R }));
  const tot = sumUp(G.flatMap(g => g.L));
  return `<div class="bill alist"><img class="lhead" src="logo.jpg" alt=""><h2>Abrechnungsliste Maschinenvermietung</h2>
    <div class="meta">${G.length} Kunden${zeitraum(G.flatMap(g => g.L)) ? ' · Zeitraum ' + zeitraum(G.flatMap(g => g.L)) : ''} · Stand ${fmtDate(todayIso())}${tot.chf ? ' · Total CHF ' + chf(tot.chf) : ''}</div>
    ${G.map(g => { const S = sumByArt(g.L), s = sumUp(g.L); return `<div class="akd"><h3>${g.k.nr ? 'Kd-Nr. ' + esc(g.k.nr) : 'Neukunde'} – ${esc(g.k.name)}</h3>
      <table class="btab"><thead><tr><th class="n" style="width:16mm">Art.-Nr.</th><th>Bezeichnung</th><th class="n" style="width:22mm">Menge</th><th style="width:16mm">Einheit</th><th class="n" style="width:22mm">Preis</th><th class="n" style="width:28mm">Betrag CHF</th></tr></thead><tbody>
      ${S.map(x => `<tr><td class="n">${esc(x.art)}</td><td>${esc(x.name)}</td><td class="n">${fmtQty(x.menge)}</td><td>${esc(x.einheit)}</td><td class="n">${x.preis != null ? chf(x.preis) : ''}</td><td class="n">${x.betrag != null ? chf(x.betrag) : ''}</td></tr>`).join('')}
      ${s.chf ? `<tr class="tot"><td></td><td>Total</td><td></td><td></td><td></td><td class="n">${chf(s.chf)}</td></tr>` : ''}</tbody></table></div>`; }).join('')}</div>`;
}
function printHtml(html) {
  const pa = $('#printArea'); pa.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const imgs = [...pa.querySelectorAll('img')].filter(i => !i.complete);
  Promise.race([Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))), new Promise(r => setTimeout(r, 3000))])
    .then(() => setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50));
}
// Vor dem Druck: Artikelpreise nur für diesen Ausdruck anpassen (Stammdaten bleiben unverändert)
function prePrint(kind, ids) {
  const G = abrGroups().filter(g => ids ? ids.includes(g.k.id) : g.R.length).map(g => (ids && !g.R.length) ? Object.assign({}, g, { R: abrWahl(g) }) : g).filter(g => g.R.length);
  if (!G.length) { toast('Keine Einträge für den Rapport – Kunden ankreuzen'); return; }
  const arts = new Map(); let eigen = 0;
  G.flatMap(g => g.R).forEach(e => { if (e.preis != null) { eigen++; return; }
    const k = e.maschine + '|' + einhOf(e), m = masch(e.maschine) || {};
    if (!arts.has(k)) arts.set(k, { k, art: m.artNr || '', name: m.name || '?', einheit: einhOf(e), std: m.preis != null && (m.einheit || 'ha') === einhOf(e) ? m.preis : null, menge: 0, n: 0 });
    const x = arts.get(k); x.menge = r2(x.menge + (e.menge || 0)); x.n++; });
  const A = [...arts.values()].sort((a, b) => String(a.art).localeCompare(String(b.art), 'de', { numeric: true }));
  const title = { rapport: G.length === 1 ? `Rapport ${G[0].k.name}` : `${G.length} Kundenrapporte`, liste: 'Abrechnungsliste', xlsx: 'Abrechnungsliste Excel' }[kind];
  openDlg(title + ' – Preise', `<p class="muted small">Preise gelten <b>nur für diesen Ausdruck</b> – die Maschinenpreise in den Stammdaten bleiben unverändert. Leer = ohne Preis.</p>
    ${kind === 'rapport' ? `<label class="tog" style="margin-bottom:10px"><input type="checkbox" name="preise" ${Store.cfg().rapportPreise ? 'checked' : ''}> Preise und Beträge im Rapport anzeigen</label>` : ''}
    <div class="dscroll" style="max-height:none"><table class="dtab"><thead><tr><th class="n">Art.-Nr.</th><th>Maschine</th><th class="n">Menge</th><th class="n">Standard</th><th class="n">Preis CHF</th></tr></thead><tbody>
    ${A.map((x, i) => `<tr><td class="n">${esc(x.art)}</td><td>${esc(x.name)}<div class="small muted">${x.n} Einsätze</div></td><td class="n">${fmtQty(x.menge)} ${esc(x.einheit)}</td>
      <td class="n">${x.std != null ? chf(x.std) : '–'}</td><td class="n"><input class="input" name="p${i}" inputmode="decimal" value="${x.std ?? ''}" style="width:110px;text-align:right"> <span class="small">/ ${esc(x.einheit)}</span></td></tr>`).join('')}
    </tbody></table></div>${eigen ? `<p class="small muted">${eigen} Einsätze haben einen eigenen Preis im Einsatz – dieser bleibt.</p>` : ''}`,
    `<span class="spacer"></span><button class="btn primary" value="ok">${kind === 'xlsx' ? '⬇ Excel erstellen' : '🖨 Drucken'}</button>`,
    { wide: true, onSubmit: fd => {
      PRICE_OV = new Map(A.map((x, i) => [x.k, num(fd.get('p' + i))]));
      try {
        if (kind === 'rapport') {
          const preise = !!fd.get('preise'); if (preise !== !!Store.cfg().rapportPreise) Store.setCfg({ rapportPreise: preise });
          document.title = G.length === 1 ? `Rapport ${G[0].k.name}` : `Kundenrapporte ${todayIso()}`;
          printHtml(G.map(g => rapportHtml(g.k, g.R, preise)).join(''));
          setTimeout(() => { document.title = 'IM-Vermietung'; }, 3000);
        } else if (kind === 'liste') printHtml(abrListHtml(G));
        else abrXlsx(G);
      } finally { PRICE_OV = null; }
    } });
}
function abrXlsx(G) {
  G = G.map(g => Object.assign({}, g, { L: g.R }));
  const rows = [['Kd-Nr.', 'Kunde', 'Art.-Nr.', 'Bezeichnung', 'Menge', 'Einheit', 'Preis CHF', 'Betrag CHF', 'Einsätze']];
  G.forEach(g => sumByArt(g.L).forEach(x => rows.push([g.k.nr ? +g.k.nr || g.k.nr : 'Neukunde', g.k.name, +x.art || x.art, x.name, x.menge, x.einheit, x.preis ?? '', x.betrag ?? '', x.n])));
  download(`Abrechnungsliste_${todayIso()}.xlsx`, xlsxBlob([{ name: 'Abrechnungsliste', rows }, { name: 'Einsätze', rows: einsatzRows(G.flatMap(g => g.L)) }]));
}
function abrDoneSel() { // nur angehakte Zeilen («im Rapport») der angekreuzten Kunden
  const L = abrGroups().flatMap(g => g.R).filter(isOffen);
  if (!L.length || !confirm(`${L.length} ausgewählte Einsätze als abgerechnet markieren (Datum heute)?`)) return;
  setStatus(L.map(e => e.id), 'abgerechnet'); toast(`${L.length} Einsätze als abgerechnet markiert`);
}
function abrDone() {
  const L = abrGroups().filter(g => g.R.length).flatMap(g => g.L).filter(isOffen);
  const S = App.abr.rows, aus = L.filter(e => !S.has(e.id)).length;
  if (!L.length || !confirm(`${L.length} offene Einsätze als abgerechnet markieren (Datum heute)?${aus ? `\nDavon ${aus} nicht ausgewählt.` : ''}`)) return;
  setStatus(L.map(e => e.id), 'abgerechnet'); toast(`${L.length} Einsätze als abgerechnet markiert`);
}

/* ================= Ansicht Mehr: Dropbox, Scan, Datensicherung ================= */
function viewMehr() {
  const user = ls('mv_user');
  const conn = Auth.configured() ? (Auth.hasSession()
    ? `<p>Verbunden${user ? ' als <b>' + esc(user) + '</b>' : ''}. Daten: Dropbox › Apps › (Dropbox-App) › <b>${esc(Drive.path().slice(1))}</b> – getrennt von den Daten des IM-Verwalters.</p><div class="btns"><button class="btn" data-act="sync">Jetzt synchronisieren</button><button class="btn danger" data-act="logout">Abmelden</button></div>`
    : `<p>Noch nicht angemeldet. Nach der Anmeldung werden alle Daten in deiner Dropbox gespeichert und zwischen PC, iPhone und Tablet abgeglichen.</p><div class="btns"><button class="btn primary" data-act="login">Mit Dropbox anmelden</button></div>`)
    : '<p>Dropbox ist noch nicht eingerichtet (App-Key in config.js fehlt) – die App speichert nur auf diesem Gerät.</p>';
  const n = c => Store.all(c).length;
  return { tb: '<h1>Mehr</h1>', html: `<div class="cols"><div>
    <div class="panel"><h2>Dropbox</h2>${conn}<p style="margin-top:12px">Diese Adresse muss in der Dropbox-App (App Console › Settings › Redirect URIs) eingetragen sein:</p><code class="mono">${esc(Auth.redirectUri())}</code></div>
    <div class="panel"><h2>Microsoft (Formular-Excel)</h2>
      <p>Damit «Abrufen und importieren» die Formular-Datei direkt aus OneDrive lesen kann, braucht es eine kostenlose App-Registrierung bei Microsoft (einmalig):</p>
      <ol class="small" style="margin:6px 0 10px;padding-left:20px;color:var(--muted)">
        <li><b>entra.microsoft.com</b> (oder portal.azure.com) › <b>App-Registrierungen › Neue Registrierung</b></li>
        <li>Name «IM-Vermietung», Kontotypen: <b>Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten</b></li>
        <li>Umleitungs-URI: Plattform <b>Single-Page-Anwendung (SPA)</b>, Adresse siehe unten → Registrieren</li>
        <li>Die <b>Anwendungs-ID (Client-ID)</b> kopieren und hier eintragen</li></ol>
      <code class="mono">${esc(Auth.redirectUri())}</code>
      <label class="fld" style="margin-top:10px"><span>Anwendungs-ID (Client-ID)</span><input class="input" data-in="msClient" value="${esc(MS.clientId())}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label>
      <p>${MS.configured() ? (MS.hasSession() ? '✓ Mit Microsoft angemeldet' : 'Noch nicht angemeldet – die Anmeldung erscheint beim ersten Abrufen.') : 'Noch keine Client-ID eingetragen.'}</p>
      <div class="btns">${MS.configured() ? (MS.hasSession() ? '<button class="btn danger" data-act="msLogout">Abmelden</button>' : '<button class="btn" data-act="msLogin">Mit Microsoft anmelden</button>') : ''}</div></div>
    <div class="panel"><h2>Scan (Claude)</h2><p>Für das Auslesen von Papierrapporten braucht es einen eigenen API-Schlüssel von console.anthropic.com. Er wird nur auf diesem Gerät gespeichert, nicht in Dropbox.</p>
      <label class="fld"><span>API-Schlüssel</span><input class="input" type="password" autocomplete="off" data-in="apiKey" value="${esc(apiKey())}" placeholder="sk-ant-…"></label>
      <label class="fld"><span>Modell</span><select class="input" data-in="model">${optList(SCAN_MODELLE.some(([v]) => v === (ls('mv_model') || DEF_MODEL)) ? SCAN_MODELLE : [...SCAN_MODELLE, [ls('mv_model'), ls('mv_model')]], ls('mv_model') || DEF_MODEL)}</select></label>
      <p>${apiKey() ? '✓ Schlüssel gespeichert' : 'Kein Schlüssel gespeichert'} · Die Scans werden zur Auswertung an Anthropic gesendet; Abrechnung pro Scan über console.anthropic.com (getrennt vom Claude-Abo).</p>
      <div class="btns"><button class="btn" data-act="claudeTest" ${apiKey() ? '' : 'disabled'}>Verbindung testen</button></div></div>
  </div><div>
    <div class="panel"><h2>Daten</h2><p>${n('einsaetze')} Einsätze · ${n('kunden')} Kunden · ${n('maschinen')} Maschinen</p>
      <div class="btns"><button class="btn" data-act="exportAll">⬇ Alles als Excel</button><button class="btn" data-act="backup">⬇ Datensicherung (.json)</button><label class="btn">Wiederherstellen…<input type="file" accept=".json" data-in="restoreFile" hidden></label></div>
      <p class="small">Dropbox führt zusätzlich einen Versionsverlauf der Datei vermietung.json.</p></div>
    <div class="panel"><h2>Über</h2><p>IM-Vermietung v${APP_VERSION} (${APP_STAND}) – eigenständige App für die Maschinenvermietung von Indermühle Lohnarbeiten · Maschinenvermietung, Schüpfen. Eigene Kunden, Maschinen und Einsätze, unabhängig vom IM-Verwalter.</p>
      <div class="btns"><button class="btn" data-act="reload">App neu laden</button></div></div>
  </div></div>` };
}
function exportAll() {
  const K = kundenSorted(), M = maschSorted(), use = countBy('kunde'), useM = countBy('maschine');
  download(`IM-Vermietung-Daten_${todayIso()}.xlsx`, xlsxBlob([
    { name: 'Einsätze', rows: einsatzRows(Store.all('einsaetze')) },
    { name: 'Kunden', rows: [['Kd-Nr.', 'Name', 'Strasse', 'Zusatz', 'PLZ', 'Ort', 'Telefon', 'E-Mail', 'Einsätze', 'Namensvarianten', 'Bemerkung', 'Aktiv', 'ID'], ...K.map(k => [k.nr ? +k.nr || k.nr : '', k.name, k.strasse, k.zusatz, k.plz, k.ort, k.tel, k.mail, use.get(k.id) || 0, (k.aliases || []).join('; '), k.bem, k.aktiv === false ? 'nein' : 'ja', k.id])] },
    { name: 'Maschinen', rows: [['Art.-Nr.', 'Bezeichnung', 'Einheit', 'Preis CHF', 'Einsätze', 'Namensvarianten', 'Aktiv', 'ID'], ...M.map(m => [+m.artNr || m.artNr, m.name, m.einheit, m.preis ?? '', useM.get(m.id) || 0, (m.aliases || []).join('; '), m.aktiv === false ? 'nein' : 'ja', m.id])] }]));
}
async function restore(file) {
  let d; try { d = JSON.parse(await file.text()); } catch { toast('Keine gültige Datensicherung'); return; }
  if (!d || !COLL.some(c => Array.isArray(d[c]))) { toast('Keine gültige Datensicherung'); return; }
  if (!confirm(`Datensicherung mit ${(d.einsaetze || []).filter(x => !x.del).length} Einsätzen wiederherstellen? Der aktuelle Stand wird ersetzt (auch in Dropbox).`)) return;
  const now = Date.now(), cur = Store.data;
  COLL.forEach(c => { // was in der Sicherung fehlt, wird gelöscht – alles mit neuer Zeit, damit es beim Abgleich gewinnt
    const ids = new Set((d[c] || []).map(x => x.id));
    d[c] = (d[c] || []).map(x => Object.assign({}, x, { upd: now }));
    (cur[c] || []).forEach(x => { if (!ids.has(x.id)) d[c].push({ id: x.id, del: true, upd: now }); });
  });
  Store.data = { v: 1, ...Object.fromEntries(COLL.map(c => [c, d[c]])) }; Store.save(); Sync.schedule(100); App.render(); toast('Datensicherung wiederhergestellt');
}

/* ================= Excel lesen (.xlsx, .csv) und schreiben – ohne Bibliothek ================= */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}
async function unzip(buf) { // minimaler ZIP-Leser (Zentralverzeichnis)
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Keine gültige Excel-Datei');
  const n = dv.getUint16(eocd + 10, true); let off = dv.getUint32(eocd + 16, true); const out = {};
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), loc = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
    out[name] = { method, csize, loc };
    off += 46 + nlen + xlen + clen;
  }
  return async name => {
    const e = out[name]; if (!e) return null;
    const start = e.loc + 30 + dv.getUint16(e.loc + 26, true) + dv.getUint16(e.loc + 28, true);
    const data = u8.subarray(start, start + e.csize);
    return new TextDecoder().decode(e.method === 0 ? data : await inflateRaw(data));
  };
}
// prefer: RegExp für den Blattnamen (z. B. Formular-Antworten), sonst erstes Blatt
async function readXlsx(buf, prefer) {
  const get = await unzip(buf), xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const ss = await get('xl/sharedStrings.xml');
  const strings = ss ? [...xml(ss).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  let sheet = 'xl/worksheets/sheet1.xml';
  try {
    const wb = xml(await get('xl/workbook.xml')), rels = xml(await get('xl/_rels/workbook.xml.rels'));
    const shs = [...wb.getElementsByTagName('sheet')], sh = (prefer && shs.find(x => prefer.test(x.getAttribute('name') || ''))) || shs[0];
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const t = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (t) sheet = 'xl/' + t.replace(/^\/?xl\//, '').replace(/^\//, '');
  } catch { }
  const sx = await get(sheet); if (!sx) throw new Error('Tabellenblatt nicht gefunden');
  const col = r => { let c = 0; for (const ch of r.replace(/\d+$/, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  return [...xml(sx).getElementsByTagName('row')].map(row => {
    const out = [];
    [...row.getElementsByTagName('c')].forEach(c => {
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const val = t === 's' ? strings[+v] ?? '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map(x => x.textContent).join('') : v;
      out[col(c.getAttribute('r') || 'A1')] = val;
    });
    return Array.from(out, x => x ?? '');
  });
}
function readCsv(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) { // ZIP ohne Kompression (für Excel ausreichend)
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  files.forEach(f => {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  });
  const csize = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const xCol = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function xSheet(rows) {
  const widths = rows[0].map((_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 400).map(r => String(r.at(c) ?? '').length + 2))));
  const cell = (v, r, c) => {
    const ref = xCol(c) + (r + 1);
    if (v == null || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${r === 0 ? ' s="1"' : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xEsc(v)}</t></is></c>`;
  };
  const last = xCol(rows[0].length - 1) + rows.length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('')}</sheetData>
${rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`;
}
function xlsxBlob(sheets) {
  const names = sheets.map(s => s.name.replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31));
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${names.map((n, i) => sheets[i].rows.length > 1 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xEsc(n)}'!$A$1:$${xCol(sheets[i].rows[0].length - 1)}$${sheets[i].rows.length}</definedName></definedNames>` : '').join('').replace(/<\/definedNames><definedNames>/g, '')}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F6B3A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xSheet(s.rows) }))
  ];
  return zipStore(files);
}

/* ================= Ereignisse ================= */
function setF(k, patch) { Object.assign(App.f[k], patch); if (k === 'einsaetze') App.sel.clear(); App.saveUi(); rerenderKeepFocus(); }
function rerenderKeepFocus() {
  const a = document.activeElement, key = a && a.dataset && a.dataset.in ? `[data-in="${a.dataset.in}"]${a.dataset.k ? `[data-k="${a.dataset.k}"]` : ''}` : null, pos = a && a.selectionStart;
  App.render();
  if (key && /^(fQ|kq)$/.test(a.dataset.in)) { const n = $(key); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }
}
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, id = t.dataset.id;
  if (t.tagName === 'A') ev.preventDefault();
  switch (act) {
    case 'go': App.go(t.dataset.v); break;
    case 'sync': if (!Auth.configured()) { App.go('mehr'); } else if (!Auth.hasSession()) Auth.login(); else Sync.run(); break;
    case 'login': Auth.login(); break;
    case 'logout': if (confirm('Von Dropbox abmelden? Die Daten bleiben auf diesem Gerät.')) Auth.logout(); break;
    case 'reload': location.reload(); break;
    case 'goMasch': App.sub.stamm = 'maschinen'; App.go('stamm'); break;
    case 'mMore': App.mMore = (App.mMore || 150) + 300; App.render(); break;
    case 'newEinsatz': einsatzDialog(null); break;
    case 'editEinsatz': if (ev.target.closest('.cb')) return; einsatzDialog(id); break;
    case 'selOne': ev.stopPropagation(); App.sel.has(id) ? App.sel.delete(id) : App.sel.add(id); App.render(); break;
    case 'selAll': { const L = einsatzList(), all = L.every(e => App.sel.has(e.id)); L.forEach(e => all ? App.sel.delete(e.id) : App.sel.add(e.id)); App.render(); break; }
    case 'selClear': App.sel.clear(); App.render(); break;
    case 'selDone': setStatus([...App.sel], 'abgerechnet'); App.sel.clear(); App.render(); break;
    case 'selOpen': setStatus([...App.sel], 'offen'); App.sel.clear(); App.render(); break;
    case 'selStorno': if (confirm(`${App.sel.size} Einsätze stornieren?`)) { setStatus([...App.sel], 'storniert'); App.sel.clear(); App.render(); } break;
    case 'selEdit': bulkEdit(); break;
    case 'selDel': if (confirm(`${App.sel.size} Einsätze löschen?`)) { Store.remove('einsaetze', [...App.sel]); App.sel.clear(); App.render(); } break;
    case 'sort': { const k = t.dataset.k; App.sort = App.sort.key === k ? { key: k, dir: -App.sort.dir } : { key: k, dir: k === 'datum' ? -1 : 1 }; App.saveUi(); App.render(); break; }
    case 'fReset': App.f[t.dataset.k] = Object.assign(defFilter(), t.dataset.k === 'abr' ? { status: 'offen' } : {}); App.saveUi(); App.render(); break;
    case 'exportEinsaetze': download(`Einsaetze_${todayIso()}.xlsx`, xlsxBlob([{ name: 'Einsätze', rows: einsatzRows(einsatzList()) }])); break;
    case 'dlgClose': closeDlg(); break;
    case 'delEinsatz': if (confirm('Diesen Einsatz löschen?')) { $('#dlg').close(); Store.remove('einsaetze', id); } break;
    case 'quickKunde': quickKunde(); break;
    case 'sub': App.sub[t.dataset.g] = t.dataset.v; App.saveUi(); App.render(); break;
    case 'editKunde': kundeDialog(id); break;
    case 'editMasch': maschDialog(id); break;
    case 'delKunde': if (Store.all('einsaetze').some(e => e.kunde === id)) { toast('Kunde hat Einsätze – zuerst zusammenführen oder Einsätze löschen', 5000); break; } if (confirm('Kunde löschen?')) { $('#dlg').close(); Store.remove('kunden', id); } break;
    case 'mergeKunde': mergeKundeDialog(id); break;
    case 'delMasch': if (confirm('Maschine löschen?')) { $('#dlg').close(); Store.remove('maschinen', id); } break;
    case 'impKundenliste': pickFile('.xlsx,.csv', impKundenliste); break;
    case 'auswJump': App.f.einsaetze = Object.assign(defFilter(), { von: App.f.ausw.von, bis: App.f.ausw.bis, status: App.f.ausw.status, [t.dataset.t]: id }); App.go('einsaetze'); break;
    case 'exportAusw': exportAusw(); break;
    case 'impCancel': if (confirm('Prüfliste verwerfen? Es wird nichts übernommen.')) { App.imp = null; ls('mv_imp', null); App.render(); } break;
    case 'impSave': impSave(); break;
    case 'formRemap': formMapDialog(); break;
    case 'formFetch': formFetch(); break;
    case 'formLink': formLinkDialog(); break;
    case 'msLogin': MS.login(); break;
    case 'msLogout': MS.logout(); break;
    case 'impAll': App.imp.rows.forEach(r => { r.sel = t.dataset.v === '1' && r.status === 'neu'; }); lsJson('mv_imp', App.imp); App.render(); break;
    case 'abrToggle': abrToggleKunde(id); App.render(); break;
    case 'abrAll': { const G = abrGroups(); if (G.every(g => g.R.length)) G.forEach(g => g.L.forEach(e => App.abr.rows.delete(e.id))); else G.forEach(g => abrWahl(g).forEach(e => App.abr.rows.add(e.id))); App.render(); break; }
    case 'abrRow': ev.stopPropagation(); t.checked ? App.abr.rows.add(id) : App.abr.rows.delete(id); App.render(); break;
    case 'abrExp': ev.stopPropagation(); { const o = abrOpen(); o.has(id) ? o.delete(id) : o.add(id); App.render(); } break;
    case 'abrExpAll': { const o = abrOpen(), ids = abrGroups().map(g => g.k.id); if (ids.every(x => o.has(x))) o.clear(); else ids.forEach(x => o.add(x)); App.render(); break; }
    case 'scanClear': setScanOpt({ masch: [] }); App.render(); break;
    case 'pageSel': App.pageSel = +t.dataset.p; App.render(); break;
    case 'pageBig': { const p = (App.scanPages || [])[App.pageSel ?? 0]; if (p) openDlg(p.name, `<img class="bigimg" src="${p.url}" alt="Scan">`, '<span class="spacer"></span><button class="btn" value="ok">Schliessen</button>', { wide: true }); break; }
    case 'claudeTest': claudeTest(); break;
    case 'abrOne': prePrint('rapport', [id]); break;
    case 'abrPrint': prePrint('rapport'); break;
    case 'abrList': prePrint('liste'); break;
    case 'abrXlsx': prePrint('xlsx'); break;
    case 'abrEntry': einsatzDialog(id); break;
    case 'abrDoneSel': abrDoneSel(); break;
    case 'abrDone': abrDone(); break;
    case 'exportAll': exportAll(); break;
    case 'backup': download(`IM-Vermietung-Sicherung_${todayIso()}.json`, JSON.stringify(Store.data), 'application/json'); break;
  }
});
function pickFile(accept, fn) { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => i.files[0] && fn(i.files[0]); i.click(); }
let qTimer;
function onInput(ev) { // nur Texteingaben während des Tippens; alles andere über «change»
  const t = ev.target, k = t.dataset && t.dataset.k, v = t.value;
  switch (t.dataset && t.dataset.in) {
    case 'fQ': clearTimeout(qTimer); qTimer = setTimeout(() => setF(k, { q: v }), 250); break;
    case 'kq': clearTimeout(qTimer); qTimer = setTimeout(() => { App.kq = v; rerenderKeepFocus(); }, 250); break;
    case 'impF': if (t.tagName === 'INPUT' && t.type !== 'date') impField(t, v, false); break;
  }
}
function onChange(t, k, v) {
  switch (t.dataset.in) {
    case 'fYear': if (v === 'eig') setF(k, { von: App.f[k].von || `${new Date().getFullYear()}-01-01`, bis: App.f[k].bis || todayIso() }); else setF(k, { von: v ? v + '-01-01' : '', bis: v ? v + '-12-31' : '' }); break;
    case 'fVon': setF(k, { von: v }); break;
    case 'fBis': setF(k, { bis: v }); break;
    case 'fKunde': setF(k, { kunde: v }); break;
    case 'fMasch': setF(k, { maschine: v }); break;
    case 'fStatus': setF(k, { status: v }); break;
    case 'fStorno': setF(k, { storno: t.checked }); break;
    case 'kNeu': App.kNeu = t.checked; App.render(); break;
    case 'einsMasch': { const m = masch(v), u = $('#dlgForm select[name=einheit]'), p = $('#dlgForm input[name=preis]'); if (m && u) u.value = m.einheit; if (p) p.placeholder = m && m.preis != null ? chf(m.preis) + ' (Maschine)' : 'Maschinenpreis'; break; }
    case 'impFormFile': if (t.files[0]) impForm(t.files[0]); t.value = ''; break;
    case 'impScanFile': if (t.files.length) scanFiles([...t.files]); t.value = ''; break;
    case 'scanM': { const o = scanOpt(), s = new Set(o.masch); t.checked ? s.add(v) : s.delete(v); setScanOpt({ masch: maschSorted().map(m => m.id).filter(x => s.has(x)) }); App.render(); break; }
    case 'scanMulch': { const o = scanOpt(); o.mulch[t.dataset.id] = v; setScanOpt({ mulch: o.mulch }); App.render(); break; }
    case 'scanOpt': setScanOpt({ [t.dataset.k]: v }); App.render(); break;
    case 'scanHalb': setScanOpt({ halbieren: t.checked }); break;
    case 'impOpt': App.imp[k] = t.checked; lsJson('mv_imp', App.imp); App.render(); break;
    case 'impSel': App.imp.rows[+t.dataset.i].sel = t.checked; lsJson('mv_imp', App.imp); App.render(); break;
    case 'impF': impField(t, v, true); break;
    case 'abrPreise': Store.setCfg({ rapportPreise: t.checked }); break;
    case 'apiKey': ls('mv_apikey', v.trim() || null); App.render(); toast(v.trim() ? 'API-Schlüssel gespeichert' : 'API-Schlüssel entfernt'); break;
    case 'model': ls('mv_model', v.trim() || null); break;
    case 'msClient': Store.setCfg({ msClientId: v.trim() }); App.render(); toast(v.trim() ? 'Client-ID gespeichert' : 'Client-ID entfernt'); break;
    case 'restoreFile': if (t.files[0]) restore(t.files[0]); t.value = ''; break;
  }
}
function impField(t, v, commit) {
  const I = App.imp, i = +t.dataset.i, r = I.rows[i], f = t.dataset.f;
  if (f === 'menge') r.menge = num(v); else r[f] = v;
  if (f === 'kId') r.kQ = '';
  if (f === 'mId') { r.mQ = ''; const m = masch(v); if (m) r.einheit = m.einheit; }
  lsJson('mv_imp', I);
  if (commit && ['kId', 'mId', 'datum', 'menge'].includes(f)) { const was = r.status; impCheck(r, i, I.rows); if (r.status !== was && r.status === 'dup') r.sel = false; App.render(); }
}
document.addEventListener('input', onInput);
document.addEventListener('change', ev => { const t = ev.target; if (!t.dataset || !t.dataset.in) return; if (t.dataset.in === 'fQ' || t.dataset.in === 'kq') return; onChange(t, t.dataset.k, t.value); });
$('#tabs').addEventListener('click', ev => { const b = ev.target.closest('button[data-view]'); if (b) App.go(b.dataset.view); });
$('#dlg').addEventListener('close', () => App.render());
document.addEventListener('keydown', ev => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'n' && !$('#dlg').open) { ev.preventDefault(); einsatzDialog(null); } });
window.addEventListener('online', () => Sync.run());
window.addEventListener('offline', () => Sync.setState('offline'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.run(); });
window.addEventListener('storage', ev => { if (ev.key === 'mv_data') { Store.load(); if (!App.busy()) App.render(); } });

/* ================= Start ================= */
(async function boot() {
  $('#appVer').textContent = 'v' + APP_VERSION;
  Store.load(); App.init();
  try { await Auth.handleRedirect(); } catch (e) { toast('Anmeldung fehlgeschlagen: ' + e.message, 6000); }
  await Store.seed();
  App.render(); Sync.setState(); Sync.run();
  if (App.afterBoot) { const f = App.afterBoot; App.afterBoot = null; setTimeout(f, 300); }
  setInterval(() => { if (document.visibilityState === 'visible') Sync.run(); }, 5 * 60 * 1000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
