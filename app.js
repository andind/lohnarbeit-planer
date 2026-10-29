/* Lohnarbeit-Planer – App-Logik (ohne Fremdbibliotheken)
   Daten: lokal im Browser (offline) + Synchronisation mit Dropbox. */
'use strict';

// Version (bei jedem Update erhöhen – gleich wie CACHE in sw.js und VERSION im NAS-Dienst)
const APP_VERSION = '46', APP_STAND = '29.10.2026';
const CFG = Object.assign({ appKey: '', dataPath: '/planung.json' }, window.APP_CONFIG || {});
const COLL = ['kunden', 'maschinen', 'personal', 'auftraege', 'einstellungen', 'pausen', 'parzellen', 'produkte', 'felder'];
const STATUS = { offen: 'Offen', geplant: 'Geplant', erledigt: 'Erledigt', verrechnet: 'Verrechnet' };
const EINHEITEN = ['ha', 'h', 'Stk', 'm³', 't', 'km', 'Ballen', 'pauschal'];
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const ARBEITEN = ['Mulchen', 'Wegränder mulchen', 'Grubbern', 'Flachgrubbern', 'Eggen', 'Striegeln', 'Walzen',
  'Säen', 'Dreschen', 'Pressen', 'Kompaktlader-Arbeiten', 'Transport', 'Traktorarbeit'];
const KULTUREN = ['Weizen', 'Gerste', 'Triticale', 'Dinkel', 'Roggen', 'Hafer', 'Raps', 'Silomais', 'Körnermais',
  'Zuckerrüben', 'Kartoffeln', 'Soja', 'Sonnenblumen', 'Eiweisserbsen', 'Ackerbohnen', 'Kunstwiese', 'Naturwiese',
  'Zwischenfrucht', 'Gründüngung', 'Stoppeln'];
const PAUSEN_TEXTE = ['Mittag', 'Znüni', 'Zvieri', 'Tanken', 'Service', 'Umsetzen', 'Reparatur'];
const FARBEN = ['#1f77b4', '#d9480f', '#2b8a3e', '#9c36b5', '#c2255c', '#0b7285', '#e67700', '#5f3dc4'];
// [Name, Verrechnungseinheit, Arbeitsarten]
const SEED_MASCHINEN = [
  ['Kompaktlader Gehl', 'h', ['Kompaktlader-Arbeiten']], ['Kurzscheibenegge Amazone', 'ha', ['Eggen']],
  ['Grubber Ott 7 Zinken', 'ha', ['Grubbern']], ['Grubber Lemken mit Stabkrümler', 'ha', ['Grubbern']],
  ['Strohstriegel 6m', 'ha', ['Striegeln']], ['Cambridge Walze 6.3m/5m', 'ha', ['Walzen']],
  ['Cambridge Walze 5m mit Sägerät', 'ha', ['Säen', 'Walzen']], ['Prismenwalze 6m', 'ha', ['Walzen']],
  ['Mulcher', 'ha', ['Mulchen']], ['Mulcher für Wegränder', 'h', ['Wegränder mulchen']],
  ['Flachgrubber AgriFarm 4.5m', 'ha', ['Flachgrubbern']], ['Traktor mit Bedienung', 'h', ['Traktorarbeit', 'Transport']]
];

/* ================= Hilfsfunktionen ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayIso = () => isoDate(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return addDays(x, -((x.getDay() + 6) % 7)); };
const kw = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 864e5 + 1) / 7); };
const fmtDate = (s, opt = { weekday: 'short', day: '2-digit', month: '2-digit' }) => s ? parseDate(s).toLocaleDateString('de-CH', opt) : '';
const fmtNum = n => (n === '' || n == null || isNaN(n)) ? '' : Number(n).toLocaleString('de-CH', { maximumFractionDigits: 2 });
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.').replace(/['’\s]/g, '')); return isNaN(n) ? null : n; };
const norm = s => String(s || '').trim().toLowerCase();
const uniqSort = arr => [...new Set(arr.filter(Boolean).map(s => String(s).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function ls(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch { return null; }
}

/* ================= Datenhaltung ================= */
const Store = {
  data: null,
  load() {
    try { this.data = JSON.parse(ls('lp_data') || 'null'); } catch { this.data = null; }
    if (!this.data || typeof this.data !== 'object') this.data = { v: 2 };
    COLL.forEach(c => { if (!Array.isArray(this.data[c])) this.data[c] = []; });
    if (!ls('lp_seeded')) {
      SEED_MASCHINEN.forEach(([name, einheit, arbeitsarten], i) => {
        const id = 'm' + (101 + i);
        if (!this.data.maschinen.some(m => m.id === id)) this.data.maschinen.push({ id, upd: 1, artNr: String(101 + i), name, einheit, arbeitsarten, monate: [], aktiv: true });
      });
      ls('lp_seeded', '1');
    }
    this.migrate();
    this.save();
  },
  // Ältere Datenstände (v1) still angleichen – ohne Änderungszeit zu setzen, damit alle Geräte gleich migrieren
  migrate() {
    this.data.maschinen.forEach((m, i) => {
      if (m.del) return;
      if (!Array.isArray(m.arbeitsarten)) {
        const seed = /^m1\d\d$/.test(m.id) && SEED_MASCHINEN[+m.id.slice(1) - 101];
        m.arbeitsarten = seed && seed[0] === m.name ? seed[2].slice() : [];
      }
      if (!Array.isArray(m.monate)) m.monate = [];
    });
    // frühere Produktliste (Einstellungen) in eigene Sammlung übernehmen
    const cfgDoc = this.data.einstellungen.find(x => x.id === 'cfg' && !x.del);
    (cfgDoc && Array.isArray(cfgDoc.produkte) ? cfgDoc.produkte : []).forEach(p => {
      if (!p || !p.name || this.data.produkte.some(x => !x.del && x.name === p.name)) return;
      this.data.produkte.push({ id: 'pr-' + p.name.toLowerCase().replace(/[^a-z0-9äöü]+/g, '-'), upd: 1, name: p.name, einheit: p.einheit || 'l', preis: 0, aktuell: true });
    });
    this.data.auftraege.forEach(a => {
      if (a.del) return;
      if (a.maschine === undefined) a.maschine = Array.isArray(a.maschinen) ? (a.maschinen[0] || '') : '';
      if (a.flaeche === undefined) a.flaeche = a.einheit === 'ha' ? a.menge ?? null : null;
      if (a.wunsch === undefined) a.wunsch = a.wunschVon || a.wunschBis || '';
    });
  },
  save() { ls('lp_data', JSON.stringify(this.data)); },
  all(c) { return this.data[c].filter(x => !x.del); },
  get(c, id) { return this.data[c].find(x => x.id === id && !x.del); },
  put(c, obj, { silent } = {}) {
    obj.upd = Date.now();
    const i = this.data[c].findIndex(x => x.id === obj.id);
    if (i >= 0) this.data[c][i] = obj; else this.data[c].push(obj);
    this.save(); Sync.schedule(); if (!silent) App.render();
    return obj;
  },
  putMany(c, list) {
    const now = Date.now();
    list.forEach(obj => { obj.upd = now; const i = this.data[c].findIndex(x => x.id === obj.id); if (i >= 0) this.data[c][i] = obj; else this.data[c].push(obj); });
    this.save(); Sync.schedule(); App.render();
  },
  remove(c, id) {
    const o = this.data[c].find(x => x.id === id);
    if (!o) return;
    Object.keys(o).forEach(k => { if (k !== 'id') delete o[k]; });
    o.del = true; o.upd = Date.now();
    this.save(); Sync.schedule(); App.render();
  },
  cfg() { return Object.assign({ beginn: '07:00', ende: '19:00', pauseVon: '', pauseBis: '' }, this.get('einstellungen', 'cfg') || {}); },
  setCfg(patch, opt = { silent: true }) { return this.put('einstellungen', Object.assign({ id: 'cfg' }, this.get('einstellungen', 'cfg') || {}, patch), opt); },
  nextAuftragNr() {
    const y = new Date().getFullYear();
    const max = this.data.auftraege.reduce((m, a) => {
      const r = /^(\d{4})-(\d+)$/.exec(a.nr || ''); return r && +r[1] === y ? Math.max(m, +r[2]) : m;
    }, 0);
    return `${y}-${String(max + 1).padStart(3, '0')}`;
  }
};

function mergeData(a, b) {
  const out = { v: 2 };
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
  configured() { return /^[a-z0-9]{8,30}$/i.test(CFG.appKey || '') && !/HIER/i.test(CFG.appKey); },
  redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); },
  tokens() { try { return JSON.parse(ls('lp_tok') || 'null'); } catch { return null; } },
  hasSession() { const t = this.tokens(); return !!(t && (t.refresh || t.access)); },
  b64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  async login() {
    if (!this.configured()) { toast('Zuerst den App-Key in config.js eintragen (siehe Anleitung).'); return; }
    if (!window.crypto?.subtle) { toast('Anmeldung nur über https möglich.'); return; }
    const verifier = this.b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = this.b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = this.b64url(crypto.getRandomValues(new Uint8Array(16)));
    ls('lp_pkce', JSON.stringify({ verifier, state }));
    const p = new URLSearchParams({
      client_id: CFG.appKey, response_type: 'code', redirect_uri: this.redirectUri(), state,
      code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline'
    });
    location.assign(`https://www.dropbox.com/oauth2/authorize?${p}`);
  },
  async handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    history.replaceState(null, '', this.redirectUri());
    if (q.has('error')) { toast('Anmeldung abgebrochen: ' + (q.get('error_description') || q.get('error')), 6000); return; }
    let pk; try { pk = JSON.parse(ls('lp_pkce') || 'null'); } catch { pk = null; }
    ls('lp_pkce', null);
    if (!pk || pk.state !== q.get('state')) { toast('Anmeldung ungültig – bitte nochmals versuchen.'); return; }
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CFG.appKey, grant_type: 'authorization_code', code: q.get('code'),
        redirect_uri: this.redirectUri(), code_verifier: pk.verifier })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast('Anmeldung fehlgeschlagen: ' + (j.error_description || j.error || r.status), 8000); return; }
    this.store(j);
    try {
      const me = await (await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { Authorization: 'Bearer ' + j.access_token } })).json();
      ls('lp_user', me.name?.display_name || me.email || '');
    } catch {}
    toast('Mit Dropbox verbunden');
  },
  store(j) { ls('lp_tok', JSON.stringify({ access: j.access_token, refresh: j.refresh_token || this.tokens()?.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 })); },
  async token() {
    const t = this.tokens(); if (!t) return null;
    if (t.access && t.exp - 120000 > Date.now()) return t.access;
    if (!t.refresh) return null;
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {   // Netzfehler werfen → Sitzung bleibt erhalten
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CFG.appKey, grant_type: 'refresh_token', refresh_token: t.refresh })
    });
    if (r.status === 400 || r.status === 401) { ls('lp_tok', null); return null; } // Zugriff widerrufen → neu anmelden
    if (!r.ok) throw new Error('Dropbox nicht erreichbar (' + r.status + ')');
    const j = await r.json(); this.store(j); return j.access_token;
  },
  async logout() {
    const t = this.tokens();
    if (t?.access && navigator.onLine) { try { await fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t.access } }); } catch {} }
    ls('lp_tok', null); ls('lp_user', null); App.render(); Sync.setState('login');
  }
};

/* ================= Dropbox-Dateizugriff ================= */
// Header-Argumente müssen reines ASCII sein (Dropbox-Vorgabe)
const dbxArg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const Drive = {
  path() { const p = (CFG.dataPath || '/planung.json').trim(); return p.startsWith('/') ? p : '/' + p; },
  async req(url, opt = {}) {
    const t = await Auth.token(); if (!t) { const e = new Error('Bitte bei Dropbox anmelden'); e.auth = true; throw e; }
    opt.headers = Object.assign({}, opt.headers, { Authorization: 'Bearer ' + t });
    const r = await fetch(url, Object.assign({ method: 'POST', cache: 'no-store' }, opt));
    if (r.status === 401) { ls('lp_tok', null); const e = new Error('Bitte bei Dropbox anmelden'); e.auth = true; throw e; }
    return r;
  },
  async errSummary(r) { try { return (await r.json()).error_summary || ''; } catch { return ''; } },
  async load() {
    // 1) aktuelle Revision ermitteln, 2) genau diese Revision laden (kein Wettlauf mit anderen Geräten)
    const r = await this.req('https://api.dropboxapi.com/2/files/get_metadata', {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: this.path() })
    });
    if (r.status === 409) { const s = await this.errSummary(r); if (s.includes('not_found')) return { data: null, etag: null }; throw new Error('Dropbox: ' + s); }
    if (!r.ok) throw new Error('Dropbox: Laden fehlgeschlagen (' + r.status + ')');
    const meta = await r.json();
    const r2 = await this.req('https://content.dropboxapi.com/2/files/download', { headers: { 'Dropbox-API-Arg': dbxArg({ path: 'rev:' + meta.rev }) } });
    if (!r2.ok) throw new Error('Dropbox: Laden fehlgeschlagen (' + r2.status + ')');
    const txt = await r2.text();
    return { data: JSON.parse(txt || '{}'), etag: meta.rev };
  },
  async readJson(path) { // beliebige Datei aus dem App-Ordner lesen (z.B. jd-sync.json)
    const r = await this.req('https://content.dropboxapi.com/2/files/download', { headers: { 'Dropbox-API-Arg': dbxArg({ path }) } });
    if (!r.ok) throw new Error('nicht gefunden');
    return JSON.parse(await r.text());
  },
  async writeJson(path, obj) {
    const r = await this.req('https://content.dropboxapi.com/2/files/upload', { headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg({ path, mode: 'overwrite', mute: true }) }, body: JSON.stringify(obj) });
    if (!r.ok) throw new Error('Dropbox ' + r.status);
  },
  async save(data, rev) {
    const arg = { path: this.path(), mode: rev ? { '.tag': 'update', update: rev } : 'add', autorename: false, mute: true };
    const r = await this.req('https://content.dropboxapi.com/2/files/upload', {
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg(arg) }, body: JSON.stringify(data)
    });
    if (r.status === 409) { const s = await this.errSummary(r); const e = new Error('Dropbox: ' + s); if (s.includes('conflict')) e.conflict = true; throw e; }
    if (!r.ok) throw new Error('Dropbox: Speichern fehlgeschlagen (' + r.status + ')');
    return (await r.json()).rev;
  }
};

/* ================= Synchronisation ================= */
const Sync = {
  state: 'idle', last: null, err: '', timer: null, running: false, again: false,
  schedule(ms = 1500) { ls('lp_dirty', '1'); this.setState(); clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); },
  setState(s) {
    if (s) this.state = s;
    const dirty = !!ls('lp_dirty');
    let cls = '', txt = '';
    if (!Auth.configured()) { cls = 'warn'; txt = 'Nur lokal'; }
    else if (!Auth.hasSession() || this.state === 'login') { cls = 'warn'; txt = 'Anmelden'; }
    else if (this.state === 'busy') { cls = 'busy'; txt = 'Synchronisiere…'; }
    else if (!navigator.onLine || this.state === 'offline') { cls = 'warn'; txt = dirty ? 'Offline – lokal gespeichert' : 'Offline'; }
    else if (this.state === 'error') { cls = 'err'; txt = 'Sync-Fehler'; }
    else if (dirty) { cls = 'busy'; txt = 'Ungespeichert'; }
    else if (this.last) { cls = 'ok'; txt = 'Dropbox ' + this.last.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }); }
    else { cls = ''; txt = 'Dropbox'; }
    $('#syncDot').className = 'dot ' + cls; $('#syncText').textContent = txt;
    $('#syncBtn').title = this.err || 'Jetzt synchronisieren';
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
          const merged = mergeData(Store.data, remote.data);
          const changed = !sameData(merged, Store.data);
          Store.data = merged; Store.migrate(); Store.save();
          if (changed) App.render();
          if (sameData(merged, remote.data)) break;
        }
        try { await Drive.save(Store.data, remote.etag); break; }
        catch (e) { if (!e.conflict || i === 3) throw e; }
      }
      ls('lp_dirty', null); this.last = new Date(); this.setState('ok');
    } catch (e) {
      this.err = e.message || String(e);
      this.setState(e.auth ? 'login' : (navigator.onLine ? 'error' : 'offline'));
      if (e.auth) App.render();
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.run(); }
    }
  }
};

/* ================= Abgeleitete Angaben ================= */
const kundeName = id => { const k = Store.get('kunden', id); return k ? k.name : '(ohne Kunde)'; };
const kundeLabel = k => `${k.name}${k.ort ? ' – ' + k.ort : ''}${k.nr ? ' (' + k.nr + ')' : ''}`;
const maschine = id => id ? Store.get('maschinen', id) : null;
const byArtNr = (a, b) => (a.artNr || '').localeCompare(b.artNr || '', 'de', { numeric: true }) || a.name.localeCompare(b.name, 'de');
const byPrio = (a, b) => (a.prio ?? 9999) - (b.prio ?? 9999) || byArtNr(a, b);
const statusOf = a => a.status || (a.datum ? 'geplant' : 'offen');
const isOpen = a => ['offen', 'geplant'].includes(statusOf(a));
function mapsUrl(q) { return `https://maps.apple.com/?q=${encodeURIComponent(q)}`; }
function monthsLabel(arr) {
  const on = Array.from({ length: 12 }, (_, i) => !arr || !arr.length || arr.includes(i + 1));
  if (on.every(Boolean)) return 'ganzes Jahr';
  const runs = [];
  for (let i = 0; i < 12; i++) {
    if (on[i] && !on[(i + 11) % 12]) { let j = i; while (on[(j + 1) % 12] && (j + 1) % 12 !== i) j = (j + 1) % 12; runs.push(i === j ? MONATE[i] : `${MONATE[i]}–${MONATE[j]}`); }
  }
  return runs.join(', ');
}
const inSeason = (m, iso) => !m.monate || !m.monate.length || m.monate.includes(parseDate(iso).getMonth() + 1);
const fits = (m, arbeit) => !arbeit || !(m.arbeitsarten || []).length || m.arbeitsarten.some(x => norm(x) === norm(arbeit));
const defaultDauer = (m, fl) => (m && m.leistung > 0 && fl > 0) ? Math.ceil(fl / m.leistung * 4) / 4 : null;
const dauerOf = a => a.dauer ?? defaultDauer(maschine(a.maschine), a.flaeche);
const hrs = n => n == null ? '' : fmtNum(n) + ' h';
const wishTxt = a => a.wunsch ? `Wunsch ${fmtDate(a.wunsch)}` : 'kein Wunschdatum';
const wishLate = a => a.wunsch && a.wunsch < todayIso() && !a.datum;
const artKultur = a => `${esc(a.arbeit || '')}${a.kultur ? `${a.arbeit ? ' · ' : ''}<span class="kultur">${esc(a.kultur)}</span>` : ''}`;

/* ---------- Listen: Arbeitsarten & Kulturen (bearbeitbar unter «Mehr») ---------- */
// Doppelte entfernen, eigene Reihenfolge behalten
const uniqKeep = arr => { const seen = new Set(); return arr.map(v => String(v || '').trim()).filter(v => v && !seen.has(norm(v)) && seen.add(norm(v))); };
const Lists = {
  arbeitsarten() {
    const c = Store.cfg();
    const l = Array.isArray(c.arbeitsarten) ? c.arbeitsarten.slice()
      : uniqSort([...ARBEITEN, ...Store.all('maschinen').flatMap(m => m.arbeitsarten || []), ...Store.all('auftraege').map(a => a.arbeit)]);
    if (!l.some(x => /spritz|pflanzenschutz/i.test(x))) l.push('Spritzen'); // für das Modul Spritzen
    return l;
  },
  produkte() { return Store.all('produkte').filter(p => p.aktuell !== false).sort((a, b) => a.name.localeCompare(b.name, 'de')); },
  duesen() { const l = Store.cfg().duesen; return Array.isArray(l) ? l.slice() : []; },
  traktoren() { const l = Store.cfg().traktoren; return Array.isArray(l) ? l.slice() : []; },
  kulturen() {
    const c = Store.cfg();
    return Array.isArray(c.kulturen) ? c.kulturen.slice() : uniqSort([...KULTUREN, ...Store.all('auftraege').map(a => a.kultur)]);
  },
  // neue Werte automatisch in die Liste aufnehmen
  ensure(kind, values) {
    const cur = this[kind](); const add = values.map(v => String(v || '').trim()).filter(v => v && !cur.some(x => norm(x) === norm(v)));
    if (add.length || !Array.isArray(Store.cfg()[kind])) Store.setCfg({ [kind]: uniqKeep([...cur, ...add]) });
  }
};

/* ---------- Zeitachse ---------- */
const toMin = t => { if (t == null || t === '') return null; const [h, m] = String(t).split(':').map(Number); return isNaN(h) ? null : h * 60 + (m || 0); };
const fromMin = m => m >= 1440 ? '24:00' : `${pad(Math.floor(m / 60))}:${pad(Math.round(m % 60))}`;
const lenOf = a => Math.round((dauerOf(a) || 1) * 60);
// Ablauf einer Maschine an einem Tag. Aufträge überlappen nie: wer in einen laufenden Auftrag fällt,
// wird direkt dahinter angedockt. Aufträge ohne feste Startzeit docken ab Arbeitsbeginn bzw. am vorherigen an.
function schedule(d, mid) {
  const orders = Store.all('auftraege').filter(a => a.datum === d && (a.maschine || '') === mid)
    .sort((x, y) => (toMin(x.zeit) ?? 9999) - (toMin(y.zeit) ?? 9999) || (x.nr || '').localeCompare(y.nr || ''));
  const beginn = toMin(Store.cfg().beginn) ?? 420;
  let prevEnd = null;
  const items = orders.map(a => {
    const want = toMin(a.zeit), fixed = want != null;
    let t = fixed ? want : (prevEnd ?? beginn);
    if (prevEnd != null && t < prevEnd) t = prevEnd;
    const end = t + lenOf(a); prevEnd = end;
    return { a, start: t, end: Math.min(1440, end), fixed, pushed: fixed && t !== want, noDur: !dauerOf(a), over: end > 1440 };
  });
  return { items };
}
const startOf = a => a.datum ? (schedule(a.datum, a.maschine || '').items.find(i => i.a.id === a.id)?.start ?? null) : null;
function capacity() { const c = Store.cfg(); return Math.max(0, (toMin(c.ende) ?? 1140) - (toMin(c.beginn) ?? 420)); }
// Magnet: Startzeit rastet an Arbeitsbeginn, am Ende eines Auftrags oder so ein, dass das Ende an den nächsten Auftrag stösst
function snapStart(d, mid, exclude, desired, len) {
  const SNAP = 30, b = toMin(Store.cfg().beginn) ?? 420;
  const others = schedule(d, mid).items.filter(it => !exclude.includes(it.a.id));
  const cands = [b, ...others.map(o => o.end), ...others.map(o => o.start - len)].filter(c => c >= 0 && c <= 1425);
  let best = null;
  cands.forEach(c => { if (Math.abs(c - desired) <= SNAP && (best == null || Math.abs(c - desired) < Math.abs(best - desired))) best = c; });
  return best ?? Math.max(0, Math.min(1425, Math.round(desired / 15) * 15));
}
function machinesFor(iso, arbeit, keepId) {
  const day = iso || todayIso();
  const list = Store.all('maschinen').filter(m => (m.aktiv !== false && inSeason(m, day)) || m.id === keepId).sort(byPrio);
  return { passend: list.filter(m => fits(m, arbeit)), andere: list.filter(m => !fits(m, arbeit)) };
}

// Aufträge ohne feste Startzeit an ihrer aktuellen Position festhalten (bevor ein anderer mit Uhrzeit dazukommt)
function freezeDay(d, mid, exclude) {
  return schedule(d, mid).items.filter(it => !it.fixed && !exclude.includes(it.a.id)).map(it => ({ ...it.a, zeit: fromMin(it.start) }));
}
// Aufträge an einer Stelle einfügen; alle folgenden rutschen nach hinten.
// opt: { minute } (Tagesansicht, Zeigerposition) | { beforeId } (auf einen Auftrag gezogen) | {} (am Ende anhängen)
function insertAt(d, mid, list, opt = {}) {
  const ids = list.map(a => a.id), b = toMin(Store.cfg().beginn) ?? 420;
  const items = schedule(d, mid).items.filter(it => !ids.includes(it.a.id));
  let idx = items.length, t0 = items.length ? items[items.length - 1].end : b;
  if (opt.beforeId) {
    const i = items.findIndex(it => it.a.id === opt.beforeId);
    if (i >= 0) { idx = i; t0 = items[i].start; }
  } else if (opt.minute != null) {
    const m = opt.minute, hit = items.findIndex(it => m >= it.start && m < it.end);
    if (hit >= 0) { const it = items[hit]; if (m < (it.start + it.end) / 2) { idx = hit; t0 = it.start; } else { idx = hit + 1; t0 = it.end; } }
    else { idx = items.filter(it => it.start < m).length; t0 = snapStart(d, mid, ids, opt.top ?? m, lenOf(list[0])); }
  }
  if (idx > 0) t0 = Math.max(t0, items[idx - 1].end);
  const out = [];
  items.slice(0, idx).forEach(it => out.push({ ...it.a, zeit: fromMin(it.start) }));
  let t = t0;
  list.forEach(a => { Object.assign(a, { datum: d, maschine: mid, status: 'geplant', zeit: fromMin(Math.min(1425, t)) }); t += lenOf(a); out.push(a); });
  items.slice(idx).forEach(it => { const s = Math.max(it.start, t); out.push({ ...it.a, zeit: fromMin(Math.min(1425, s)) }); t = s + lenOf(it.a); });
  return out;
}
// nur geänderte Aufträge speichern
function putChanged(list) {
  const keys = ['datum', 'zeit', 'maschine', 'status', 'dauer', 'dauerManuell'];
  const ch = list.filter(a => { const o = Store.get('auftraege', a.id); return !o || keys.some(k => (o[k] ?? '') !== (a[k] ?? '')); });
  if (ch.length) Store.putMany('auftraege', ch); else App.render();
}
function setMachineDauer(a, mid) {
  if ((a.maschine || '') !== mid || !a.dauerManuell) { a.dauer = defaultDauer(maschine(mid), a.flaeche); a.dauerManuell = false; }
}
/* ---------- Verschieben (einzeln oder mehrere) ---------- */
// tgt: { unplan:true } | { datum, mid, minute?, top?, beforeId? }
function moveOrders(ids, draggedId, tgt) {
  const list = ids.map(id => Store.get('auftraege', id)).filter(a => a && isOpen(a)).map(a => ({ ...a }));
  if (!list.length) return;
  if (tgt.unplan) { list.forEach(a => { a.datum = ''; a.zeit = ''; a.status = 'offen'; }); Store.putMany('auftraege', list); return; }
  const drag = list.find(a => a.id === draggedId) || list[0];
  const groupShift = list.length > 1 && list.every(a => a.datum);
  const dragMid = drag.maschine || '';
  const target = a => {
    if (!groupShift) return { datum: tgt.datum, mid: tgt.mid };
    const delta = Math.round((parseDate(tgt.datum) - parseDate(drag.datum)) / 864e5);
    return { datum: isoDate(addDays(parseDate(a.datum), delta)), mid: (a.maschine || '') === dragMid ? tgt.mid : (a.maschine || '') };
  };
  const plan = list.map(a => ({ a, ...target(a) }));
  const misfit = plan.filter(p => { const m = maschine(p.mid); return m && p.a.arbeit && !fits(m, p.a.arbeit) && p.mid !== (p.a.maschine || ''); });
  if (misfit.length && !confirm(misfit.length === 1
    ? `«${maschine(misfit[0].mid).name}» ist nicht für «${misfit[0].a.arbeit}» erfasst. Trotzdem einplanen?`
    : `${misfit.length} Aufträge passen nicht zur Arbeitsart der Maschine. Trotzdem verschieben?`)) return;
  if (!groupShift) { // einzeln oder aus «nicht eingeplant»: als Block einfügen, Folgende rutschen nach
    const ordered = [drag, ...list.filter(a => a !== drag)];
    ordered.forEach(a => setMachineDauer(a, tgt.mid));
    putChanged(insertAt(tgt.datum, tgt.mid, ordered, { minute: tgt.minute, top: tgt.top, beforeId: tgt.beforeId }));
    return;
  }
  // Gruppe bereits eingeplanter Aufträge: Abstände bleiben, danach Überlappungen nach hinten auflösen
  const starts = Object.fromEntries(list.map(a => [a.id, startOf(a)]));
  const moving = list.map(a => a.id);
  plan.forEach(p => { setMachineDauer(p.a, p.mid); p.a.maschine = p.mid; p.a.datum = p.datum; p.a.status = 'geplant'; });
  const keys = [...new Set(plan.map(p => p.datum + '|' + p.mid))];
  const frozen = keys.flatMap(k => { const [d, m] = k.split('|'); return freezeDay(d, m, moving); });
  if (tgt.minute != null && starts[drag.id] != null) {
    const delta = snapStart(tgt.datum, tgt.mid, moving, tgt.top ?? tgt.minute, lenOf(drag)) - starts[drag.id];
    plan.forEach(p => { const s = starts[p.a.id]; p.a.zeit = fromMin(Math.max(0, Math.min(1425, s + delta))); });
  } else plan.forEach(p => { p.a.zeit = fromMin(starts[p.a.id] ?? (toMin(Store.cfg().beginn) ?? 420)); });
  Store.putMany('auftraege', [...frozen, ...list]);
  const settled = keys.flatMap(k => { const [d, m] = k.split('|'); return schedule(d, m).items.filter(it => it.pushed).map(it => ({ ...it.a, zeit: fromMin(it.start) })); });
  if (settled.length) Store.putMany('auftraege', settled);
}
// Nicht eingeplanten Auftrag an einer freien Stelle einsetzen (Auswahl nach langem Drücken)
function placeFromPicker(id, d, mid, minute) {
  const a = { ...Store.get('auftraege', id) }; if (!a.id) return;
  setMachineDauer(a, mid);
  putChanged(insertAt(d, mid, [a], minute == null ? {} : { minute, top: minute }));
  toast(`${kundeName(a.kunde)} eingeplant`);
}

/* ================= App / Ansichten ================= */
let PX = 0.75; // Pixel pro Minute in der Tages-Zeitachse (45 px pro Stunde bei Zoom 100 %)
const ZOOM_MIN = 0.4, ZOOM_MAX = 3;
const App = {
  view: ls('lp_view') || 'auftraege',
  filter: { auftraege: 'offen', q: '', kq: '', aview: ls('lp_aview') || 'karten' },
  al: { von: '', bis: '', k: '', a: '', c: '', m: '', f: '', grp: '', sort: 'desc', limit: 300 },
  jdb: { minHa: ls('lp_jdbmin') || '', rows: null, meta: null, von: null, bis: null, k: [], a: [], f: [], m: [], c: [], q: '', grp: '', sort: 'desc', limit: 300, open: null },
  plan: { axW: ls('lp_axW') || 'tage', axT: ls('lp_axT') || 'senkrecht', side: ls('lp_pside') !== '0', mode: ls('lp_pmode') || 'woche', date: new Date(), aa: '', nurBelegt: false },
  lastView: null, tlScroll: null, resetScroll: false, sel: new Set(), selMode: false, fs: false, zoom: +(ls('lp_zoom') || 1),
  spray: { von: todayIso(), bis: isoDate(addDays(new Date(), 6)), off: new Set(), tab: 'plan', stamm: 'produkte', jq: '', jy: '', jsort: 'desc', jf: null, jfOpen: false, jlimit: 200,
    ak: '', av: `${new Date().getFullYear()}-01-01`, ab: todayIso(), ag: false, ny: 0, nk: '', nc: '', ngep: false, pk: '', pall: false, prq: '', prall: false },
  alimit: 150,
  go(v) { this.view = v; ls('lp_view', v); this.lastView = null; this.tlScroll = null; window.scrollTo(0, 0); this.render(); },
  render() {
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === this.view));
    const fresh = this.lastView !== this.view; this.lastView = this.view;
    const v = Views[this.view] || Views.auftraege;
    const tl = $('.cal'); if (tl && !this.resetScroll) this.tlScroll = { top: tl.scrollTop, left: tl.scrollLeft };
    if (this.resetScroll) { this.tlScroll = null; this.resetScroll = false; }
    document.body.classList.toggle('fs-plan', this.fs && this.view === 'plan');
    if (fresh) $('#toolbar').innerHTML = v.toolbar();
    if (v.refreshToolbar) v.refreshToolbar();
    $('#content').innerHTML = v.content();
    if (v.after) v.after();
    renderSelbar();
    Sync.setState();
  }
};

const Views = {
  /* ---------- Aufträge ---------- */
  auftraege: {
    toolbar() {
      const segs = [['offen', 'Offen'], ['erledigt', 'Erledigt'], ['verrechnet', 'Verrechnet'], ['alle', 'Alle']];
      return `<h1>Aufträge</h1>
        <div class="seg" id="aSeg">${segs.map(([k, l]) => `<button type="button" data-act="aFilter" data-v="${k}">${l} <span class="cnt" data-c="${k}"></span></button>`).join('')}</div>
        <input class="input search" type="search" placeholder="Suchen: Kunde, Arbeit, Kultur…" value="${esc(App.filter.q)}" data-in="aSearch">
        <div class="seg" id="aView"><button type="button" data-act="aView" data-v="karten">▦ Karten</button><button type="button" data-act="aView" data-v="liste">☰ Liste</button></div>`;
    },
    refreshToolbar() {
      $$('#aSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === App.filter.auftraege));
      $$('#aView button').forEach(b => b.classList.toggle('on', b.dataset.v === (App.filter.aview || 'karten')));
      const all = Store.all('auftraege'); const c = { offen: 0, erledigt: 0, verrechnet: 0, alle: all.length };
      all.forEach(a => { const s = statusOf(a); if (isOpen(a)) c.offen++; else c[s]++; });
      $$('#aSeg .cnt').forEach(e => { e.textContent = c[e.dataset.c] ? `(${c[e.dataset.c]})` : ''; });
    },
    content() {
      if (App.filter.aview === 'liste') return alContent();
      const f = App.filter.auftraege, q = norm(App.filter.q);
      const list = Store.all('auftraege').filter(a => {
        const s = statusOf(a);
        if (f === 'offen' && !isOpen(a)) return false;
        if ((f === 'erledigt' || f === 'verrechnet') && s !== f) return false;
        if (!q) return true;
        return [a.nr, kundeName(a.kunde), a.arbeit, a.kultur, a.notiz, maschine(a.maschine)?.name].join(' ').toLowerCase().includes(q);
      }).sort((x, y) => f === 'offen'
        ? (!!x.datum - !!y.datum) || (x.datum || x.wunsch || '9999').localeCompare(y.datum || y.wunsch || '9999') || (x.zeit || '99').localeCompare(y.zeit || '99')
        : (y.erledigtAm || y.datum || '').localeCompare(x.erledigtAm || x.datum || ''));
      if (!list.length) return `<div class="empty">${q ? 'Keine Treffer.' : 'Keine Aufträge in dieser Ansicht.'}<br><br><button class="btn primary" data-act="newOrder">＋ Neuer Auftrag</button></div>`;
      const more = n => n > App.alimit ? `<div class="btns" style="margin-top:12px"><button class="btn" data-act="aMore">Weitere anzeigen (${n - App.alimit} übrig)</button></div>` : '';
      if (f !== 'offen') return `<p class="nr">${list.length} Aufträge</p><div class="list grid">${list.slice(0, App.alimit).map(orderCard).join('')}</div>${more(list.length)}`;
      const unpl = list.filter(a => !a.datum), pl = list.filter(a => a.datum);
      return (unpl.length ? `<div class="section-h">Noch nicht eingeplant (${unpl.length})</div><div class="list grid">${unpl.map(orderCard).join('')}</div>` : '') +
        (pl.length ? `<div class="section-h">Eingeplant (${pl.length})</div><div class="list grid">${pl.map(orderCard).join('')}</div>` : '');
    }
  },

  /* ---------- Planung ---------- */
  plan: {
    toolbar() {
      return `<h1>Planung</h1>
        <div class="seg" id="pSeg"><button type="button" data-act="pMode" data-v="tag">Tag</button><button type="button" data-act="pMode" data-v="woche">Woche</button></div>
        <div class="weekhead">
          <button class="btn small" data-act="pNav" data-d="-1" aria-label="Zurück">◀</button>
          <span class="lbl" id="pLbl"></span>
          <button class="btn small" data-act="pNav" data-d="1" aria-label="Weiter">▶</button>
          <button class="btn small" data-act="pNav" data-d="0">Heute</button>
          <input class="input" type="date" id="pDate" data-in="pDate" style="width:auto;min-height:34px;padding:4px 8px" aria-label="Datum wählen">
        </div>
        <div class="weekhead">
          <button class="btn small" id="selModeBtn" data-act="selMode">☐ Mehrere auswählen</button>
          <span class="zoomctl"><button class="btn small" data-act="zoom" data-d="-1" aria-label="Verkleinern">−</button><span class="zv" id="zv"></span><button class="btn small" data-act="zoom" data-d="1" aria-label="Vergrössern">＋</button></span>
          <button class="btn small" data-act="fs" title="Kalender im Vollbild">⛶ Vollbild</button>
          <button class="btn small" data-act="planExport" title="Aktuelle Ansicht als PDF oder Bild">⤓ Export</button>
          <button class="btn small sidebtn" data-act="pSide" title="Nicht eingeplante Aufträge ein-/ausblenden">◧ Offene</button>
        </div>`;
    },
    refreshToolbar() {
      const P = App.plan;
      $$('#pSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === P.mode));
      const days = this.days();
      $('#pLbl').textContent = this.label();
      $('#zv').textContent = Math.round(App.zoom * 100) + ' %';
      $('#pDate').value = isoDate(P.date);
      $('.sidebtn')?.classList.toggle('primary', P.side !== false);
      const sb = $('#selModeBtn'); sb.classList.toggle('primary', App.selMode); sb.textContent = App.selMode ? '☑ Auswahl aktiv' : '☐ Mehrere auswählen';
    },
    label(short) {
      const P = App.plan, days = this.days();
      return P.mode === 'tag'
        ? parseDate(days[0]).toLocaleDateString('de-CH', short ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : `KW ${kw(parseDate(days[0]))} · ${parseDate(days[0]).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })} – ${parseDate(days[6]).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })}`;
    },
    days() {
      const P = App.plan;
      if (P.mode === 'tag') return [isoDate(P.date)];
      const mo = mondayOf(P.date); return Array.from({ length: 7 }, (_, i) => isoDate(addDays(mo, i)));
    },
    columns(days) {
      const P = App.plan;
      const used = new Set(Store.all('auftraege').filter(a => a.datum && days.includes(a.datum)).map(a => a.maschine || ''));
      const ms = Store.all('maschinen').filter(m => (m.aktiv !== false && days.some(d => inSeason(m, d))) || used.has(m.id))
        .filter(m => (!P.aa || (fits(m, P.aa) && (m.arbeitsarten || []).length)) && (!P.nurBelegt || used.has(m.id)))
        .sort(byPrio);
      const cols = ms.map(m => ({ id: m.id, m }));
      if (used.has('') && !P.aa) cols.push({ id: '', m: null });
      return cols;
    },
    head(c) {
      return c.m
        ? (c.m.kurz
          ? `<div class="mh kurz" data-act="machinePlan" data-id="${c.m.id}" title="${esc(c.m.name)} – Tagesplan als Bild für den Fahrer"><b>${esc(c.m.kurz)} <span class="pic">🖼</span></b></div>`
          : `<div class="mh" data-act="machinePlan" data-id="${c.m.id}" title="Tagesplan als Bild für den Fahrer"><b>${esc(c.m.name)} <span class="pic">🖼</span></b><small>${esc((c.m.arbeitsarten || []).join(', ') || '—')}${c.m.leistung ? ` · ${fmtNum(c.m.leistung)} ha/h` : ''}</small></div>`)
        : '<b>Ohne Maschine</b><small>Datum gesetzt, Maschine fehlt</small>';
    },
    content() {
      const P = App.plan, days = this.days(), cols = this.columns(days);
      App.tlH = P.mode === 'tag' && P.axT === 'waagrecht';
      PX = (App.tlH ? 1.2 : 0.75) * App.zoom;
      let grid;
      if (!cols.length) grid = `<div class="empty">${P.nurBelegt || P.aa ? 'Keine passenden Maschinen – Filter oben anpassen.' : 'In diesem Zeitraum ist keine Maschine in Saison.<br>Saison unter <b>Maschinen</b> anpassen.'}</div>`;
      else grid = P.mode === 'tag' ? (App.tlH ? this.dayTimelineH(days[0], cols) : this.dayTimeline(days[0], cols)) : (P.axW === 'maschinen' ? this.weekGridM(days, cols) : this.weekGrid(days, cols));
      const unpl = Store.all('auftraege').filter(a => isOpen(a) && !a.datum)
        .sort((x, y) => (x.wunsch || '9999').localeCompare(y.wunsch || '9999'));
      if (App.fs) return `<div class="fsview">
        <div class="fsbar">
          <button class="btn small" data-act="pNav" data-d="-1" aria-label="Zurück">◀</button>
          <span class="lbl">${esc(this.label(true))}</span>
          <button class="btn small" data-act="pNav" data-d="1" aria-label="Weiter">▶</button>
          <div class="seg"><button type="button" data-act="pMode" data-v="tag" class="${P.mode === 'tag' ? 'on' : ''}">Tag</button><button type="button" data-act="pMode" data-v="woche" class="${P.mode === 'woche' ? 'on' : ''}">Woche</button></div>
          <span class="zoomctl"><button class="btn small" data-act="zoom" data-d="-1" aria-label="Verkleinern">−</button><span class="zv">${Math.round(App.zoom * 100)} %</span><button class="btn small" data-act="zoom" data-d="1" aria-label="Vergrössern">＋</button></span>
          <button class="btn small fsclose" data-act="fs" aria-label="Vollbild schliessen">✕</button>
        </div>${grid}</div>`;
      return `<div class="planwrap ${App.plan.side === false ? 'noside' : ''}">
        <div>${grid}</div>
        <aside class="unplanned" data-drop="">
          <h3>Noch nicht eingeplant (${unpl.length})</h3>
          <div class="slot">${unpl.map(unplCard).join('') || '<div class="none">Alles eingeplant 👍</div>'}</div>
        </aside></div>`;
    },
    // ---- Woche: Maschinen nebeneinander, pro Tag eine 24h-Leiste und die Aufträge
    // eine Zelle (Tag × Maschine) der Wochenansicht
    weekCell(d, col) {
      const today = todayIso(), c = Store.cfg(), b = toMin(c.beginn) ?? 420, e = toMin(c.ende) ?? 1140;
      const pct = m => (m / 1440 * 100).toFixed(2) + '%';
      const off = col.m && !inSeason(col.m, d);
      const { items } = schedule(d, col.id);
      const strip = items.length ? `<div class="strip" title="0–24 Uhr">
          <i class="night" style="left:0;width:${pct(b)}"></i><i class="night" style="left:${pct(e)};right:0"></i>
          ${items.map(it => `<i class="job ${App.sel.has(it.a.id) ? 'sel' : ''}" style="left:${pct(it.start)};width:${pct(it.end - it.start)}" title="${esc(kundeName(it.a.kunde))} ${fromMin(it.start)}–${fromMin(it.end)}"></i>`).join('')}
          <span class="ticks"><em>0</em><em>6</em><em>12</em><em>18</em><em>24</em></span></div>` : '';
      return `<div class="g-cell ${off ? 'off' : ''} ${d === today ? 'today' : ''}" ${off ? '' : `data-drop="${d}|${col.id}"`}>
        ${strip}${items.map(it => planCard(it)).join('')}
        ${off && !items.length ? '<span class="nr">ausser Saison</span>' : ''}</div>`;
    },
    dayHead(d, cls) {
      return `<div class="${cls} ${d === todayIso() ? 'today' : ''}" data-act="dayView" data-d="${d}" title="Tagesansicht"><b>${fmtDate(d, { weekday: 'short' })}</b><small>${fmtDate(d, { day: '2-digit', month: '2-digit' })}</small></div>`;
    },
    // ---- Woche: Tage als Zeilen, Maschinen nebeneinander
    weekGrid(days, cols) {
      const head = `<div class="g-corner"></div>` + cols.map(col => `<div class="g-head">${this.head(col)}</div>`).join('');
      const rows = days.map(d => this.dayHead(d, 'g-day') + cols.map(col => this.weekCell(d, col)).join('')).join('');
      return `<div class="gridwrap cal" id="cal"><div class="pgrid" style="zoom:${App.zoom};grid-template-columns: 64px repeat(${cols.length}, minmax(140px, 1fr))">${head}${rows}</div></div>`;
    },
    // ---- Woche getauscht: Maschinen als Zeilen, Tage nebeneinander
    weekGridM(days, cols) {
      const head = `<div class="g-corner"></div>` + days.map(d => this.dayHead(d, 'g-head g-dayh')).join('');
      const rows = cols.map(col => `<div class="g-day g-mrow">${this.head(col)}</div>` + days.map(d => this.weekCell(d, col)).join('')).join('');
      return `<div class="gridwrap cal" id="cal"><div class="pgrid axm" style="zoom:${App.zoom};grid-template-columns: var(--mcol, 150px) repeat(${days.length}, minmax(150px, 1fr))">${head}${rows}</div></div>`;
    },
    // ---- Tag: senkrechte Zeitachse 0–24 Uhr, Maschinen als Spalten
    dayTimeline(d, cols) {
      const c = Store.cfg(), b = toMin(c.beginn) ?? 420, e = toMin(c.ende) ?? 1140, H = 1440 * PX, cap = capacity();
      const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes(), isToday = d === todayIso();
      const axis = Array.from({ length: 25 }, (_, h) => `<span style="top:${h * 60 * PX}px">${pad(h)}:00</span>`).join('');
      const heads = [], bodies = [];
      cols.forEach(col => {
        const off = col.m && !inSeason(col.m, d);
        const { items } = schedule(d, col.id);
        const used = items.reduce((s, it) => s + it.end - it.start, 0);
        const blocks = items.map(it => this.blkHtml(it, false)).join('');

        heads.push(`<div class="tl-head">${this.head(col)}</div>`);
        bodies.push(`<div class="tl-col ${off ? 'off' : ''}" style="height:${H}px" ${off ? '' : `data-drop="${d}|${col.id}" data-tl="1"`}>
            <i class="night" style="top:0;height:${b * PX}px"></i><i class="night" style="top:${e * PX}px;bottom:0"></i>
            ${blocks}${isToday ? `<i class="now" style="top:${nowMin * PX}px"></i>` : ''}
            ${off ? '<span class="nr" style="position:absolute;top:8px;left:8px">ausser Saison</span>' : ''}
          </div>`);
      });
      const cw = Math.round(170 * Math.max(0.5, Math.min(1.6, App.zoom)));
      return `<div class="tlwrap cal" id="tlwrap"><div class="tl" style="--hh:${60 * PX}px;grid-template-columns:52px repeat(${cols.length}, minmax(${cw}px, 1fr))">
        <div class="tl-corner" data-act="weekView" title="Wochenansicht">Woche</div>${heads.join('')}<div class="tl-axis" data-act="weekView" title="Wochenansicht" style="height:${H}px">${axis}</div>${bodies.join('')}
      </div></div>`;
    },
    // Auftragsblock in der Tagesansicht (senkrecht: Höhe = Dauer, waagrecht: Breite = Dauer)
    blkHtml(it, horiz) {
      const s = it.start, q = it.end, a = it.a, st = statusOf(a), len = Math.max(20, (q - s) * PX - 2);
      const h = horiz ? 999 : len, w = horiz ? len : 999;
      const op = isOpen(a), info = it.pushed && op ? `⤵ angedockt (gewünscht ${esc(a.zeit)})` : it.noDur && op ? '⚠ Dauer fehlt (1 h angenommen)' : it.over && op ? '⚠ läuft über Mitternacht' : '';
      const pos = horiz ? `left:${s * PX + 1}px;width:${len}px` : `top:${s * PX + 1}px;height:${len}px`;
      const big = w > 90;
      return `<div class="blk ${st} ${(it.noDur || it.over) && op ? 'warn' : ''} ${App.sel.has(a.id) ? 'sel' : ''}" style="${pos}" data-act="editOrder" data-id="${a.id}" ${isOpen(a) ? 'draggable="true"' : ''} title="${esc(kfText(a))} ${fromMin(s)}–${fromMin(q)}${horiz ? ' · ' + esc(artKultur(a).replace(/<[^>]+>/g, '')) : ''}">
        <b>${fromMin(s)}–${fromMin(q)}${horiz ? '</b><b>' : ' '}${kfHtml(a)}${it.fixed ? ' 📌' : ''}</b>
        ${h > 34 && big ? `<span>${artKultur(a)}${a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : ''}${dauerOf(a) ? ` · ${hrs(dauerOf(a))}` : ''}${st === 'erledigt' || st === 'verrechnet' ? ' · ✓' : ''}</span>` : ''}
        ${h > 54 && big && info ? `<span class="w">${info}</span>` : ''}
        ${h > 54 && big ? sprayShort(a, { noFeld: true }) : ''}
        ${h > 70 && big && a.notiz ? `<span class="note">${esc(a.notiz)}</span>` : ''}
      </div>`;
    },
    // ---- Tag getauscht: waagrechte Zeitachse 0–24 Uhr, Maschinen als Zeilen
    dayTimelineH(d, cols) {
      const c = Store.cfg(), b = toMin(c.beginn) ?? 420, e = toMin(c.ende) ?? 1140, Wd = 1440 * PX;
      const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes(), isToday = d === todayIso();
      const rh = Math.round(112 * Math.max(0.7, Math.min(1.5, App.zoom)));
      const axis = Array.from({ length: 25 }, (_, h) => `<span style="left:${h * 60 * PX}px">${pad(h)}:00</span>`).join('');
      const rows = cols.map(col => {
        const off = col.m && !inSeason(col.m, d);
        const { items } = schedule(d, col.id);
        return `<div class="tl-head tlh-m">${this.head(col)}</div>
          <div class="tl-col tlh-lane ${off ? 'off' : ''}" style="height:${rh}px" ${off ? '' : `data-drop="${d}|${col.id}" data-tl="x"`}>
            <i class="night" style="left:0;width:${b * PX}px"></i><i class="night" style="left:${e * PX}px;right:0"></i>
            ${items.map(it => this.blkHtml(it, true)).join('')}${isToday ? `<i class="now" style="left:${nowMin * PX}px"></i>` : ''}
            ${off ? '<span class="nr" style="position:absolute;top:8px;left:8px">ausser Saison</span>' : ''}
          </div>`;
      }).join('');
      return `<div class="tlwrap tlh cal" id="tlwrapH"><div class="tl" style="--hw:${60 * PX}px;grid-template-columns:var(--mcol, 160px) ${Wd}px">
        <div class="tl-corner" data-act="weekView" title="Wochenansicht">Woche</div><div class="tl-axis tlh-axis" data-act="weekView" title="Wochenansicht">${axis}</div>${rows}
      </div></div>`;
    },
    after() {
      const cal = $('.cal');
      if (cal) {
        if (App.zoomAnchor) { App.zoomAnchor(cal); App.zoomAnchor = null; }
        else if (App.tlScroll) { cal.scrollTop = App.tlScroll.top; cal.scrollLeft = App.tlScroll.left; }
        else if (cal.id === 'tlwrap') cal.scrollTop = Math.max(0, ((toMin(Store.cfg().beginn) ?? 420) - 60) * PX);
        else if (cal.id === 'tlwrapH') cal.scrollLeft = Math.max(0, ((toMin(Store.cfg().beginn) ?? 420) - 60) * PX);
        attachPinch(cal);
      }
      let grabY = 0; // Abstand Mauszeiger ↔ Oberkante des gezogenen Blocks
      $$('[draggable="true"]').forEach(el => el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move';
        grabY = el.classList.contains('blk') ? (App.tlH ? e.clientX - el.getBoundingClientRect().left : e.clientY - el.getBoundingClientRect().top) : 0;
        const n = App.sel.has(el.dataset.id) ? App.sel.size : 1;
        if (n > 1) { const g = document.createElement('div'); g.className = 'dragcount'; g.textContent = `${n} Aufträge`; document.body.appendChild(g); e.dataTransfer.setDragImage(g, 10, 10); setTimeout(() => g.remove(), 0); }
      }));
      $$('[data-drop]').forEach(el => {
        el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop'); });
        el.addEventListener('dragleave', () => el.classList.remove('drop'));
        el.addEventListener('drop', e => {
          e.preventDefault(); el.classList.remove('drop');
          planDrop(el, e.dataTransfer.getData('text/plain'), App.tlH ? e.clientX : e.clientY, grabY, e.target);
        });
      });
      // Tablet/Handy: Ziehen mit dem Finger (lange drücken, dann ziehen)
      if (matchMedia('(pointer: coarse)').matches) $$('[draggable="true"]').forEach(el => { el.removeAttribute('draggable'); touchDrag(el); });
      // Langes Drücken (bzw. Rechtsklick) auf freie Stelle → passende, nicht eingeplante Aufträge
      $$('.tl-col[data-drop], .g-cell[data-drop]').forEach(el => {
        let timer = null, sx = 0, sy = 0, fired = false;
        const open = y => {
          if (fired || Dlg.el.open) return; fired = true;
          const [d, mid] = el.dataset.drop.split('|');
          const minute = el.dataset.tl ? Math.max(0, (y - (el.dataset.tl === 'x' ? el.getBoundingClientRect().left : el.getBoundingClientRect().top)) / UIZ() / PX) : null;
          if (navigator.vibrate) try { navigator.vibrate(15); } catch { }
          pickerDialog(d, mid, minute);
        };
        el.addEventListener('pointerdown', e => {
          if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.blk,.pcard,.load,.strip')) return;
          sx = e.clientX; sy = e.clientY; fired = false; clearTimeout(timer);
          timer = setTimeout(() => open(el.dataset.tl === 'x' ? sx : sy), 550);
        });
        el.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clearTimeout(timer); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => el.addEventListener(n, () => clearTimeout(timer)));
        el.addEventListener('contextmenu', e => { if (e.target.closest('.blk,.pcard')) return; e.preventDefault(); clearTimeout(timer); fired = false; open(el.dataset.tl === 'x' ? e.clientX : e.clientY); });
      });
    }
  },

  /* ---------- Spritzen ---------- */
  spritzen: sprayView(),
  jdbericht: jdBerichtView(),

  /* ---------- Kunden ---------- */
  kunden: {
    toolbar() {
      return `<h1>Kunden</h1>
        <input class="input search" type="search" placeholder="Kunde suchen…" value="${esc(App.filter.kq)}" data-in="kSearch">
        <label class="tog"><input type="checkbox" data-in="kAll" ${App.filter.kall ? 'checked' : ''}> auch inaktive</label>
        <button class="btn primary" data-act="jdRequest" title="Fordert beim NAS-Dienst einen Abgleich mit MyJohnDeere an">⟳ Jetzt abgleichen</button>
        <button class="btn" data-act="jdSync">Abgleich prüfen…</button>
        ${jdLock() ? '' : `<button class="btn" data-act="importKunden">Import (Excel/CSV)</button>
        <button class="btn primary" data-act="editKunde">＋ Kunde</button>`}`;
    },
    content() {
      const q = norm(App.filter.kq);
      const list = Store.all('kunden').filter(k => (App.filter.kall || k.aktiv !== false) && (!q || [k.nr, k.name, k.adresse, k.ort, k.tel].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      const st = Store.cfg().jdStand;
      const info = st ? `<p class="nr">Kunden und Felder werden in MyJohnDeere gepflegt · Stand ${new Date(st).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}</p>` : '';
      const nInakt = Store.all('kunden').filter(k => k.aktiv === false).length;
      if (!list.length) return info + `<div class="empty">${q ? 'Keine Treffer.' : nInakt && !App.filter.kall ? `Alle ${nInakt} Kunden sind inaktiv gesetzt.<br>«auch inaktive» oben ankreuzen, um sie anzuzeigen.` : 'Noch keine Kunden.<br>Kunden und Felder kommen über den MyJohnDeere-Abgleich.'}</div>`;
      const open = {};
      Store.all('auftraege').forEach(a => { if (isOpen(a)) open[a.kunde] = (open[a.kunde] || 0) + 1; });
      const fl = {}; Store.all('felder').forEach(f => { if (f.aktiv !== false) { const x = fl[f.kunde] || (fl[f.kunde] = { n: 0, ha: 0 }); x.n++; x.ha += f.flaeche || 0; } });
      return info + `<div class="rows kgrid">${list.map(k => `
        <div class="rowi ${k.aktiv === false ? 'off' : ''}" data-act="editKunde" data-id="${k.id}">
          <span class="num">${esc(k.nr || '')}</span>
          <div class="grow"><div class="t">${esc(k.name)}</div><div class="s">${esc([k.adresse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</div>
            <div class="links">${k.tel ? `<a href="tel:${esc(k.tel.replace(/\s/g, ''))}" data-stop>📞 ${esc(k.tel)}</a>` : ''}${(k.adresse || k.ort) ? `<a href="${mapsUrl([k.adresse, k.plz, k.ort].filter(Boolean).join(', '))}" target="_blank" rel="noopener" data-stop>📍 Karte</a>` : ''}</div></div>
          ${fl[k.id] ? `<span class="chip">🌾 ${fl[k.id].n} · ${fmtNum(r2(fl[k.id].ha))} ha</span>` : ''}${k.jdId || k.jdName ? '<span class="chip jd">JD</span>' : ''}
          ${open[k.id] ? `<span class="chip">${open[k.id]} offen</span>` : ''}
        </div>`).join('')}</div>`;
    }
  },

  /* ---------- Maschinen ---------- */
  maschinen: {
    toolbar() { return `<h1>Maschinen</h1><button class="btn primary" data-act="editMaschine">＋ Maschine</button>`; },
    content() {
      const list = Store.all('maschinen').sort(byPrio);
      if (!list.length) return '<div class="empty">Noch keine Maschinen erfasst.</div>';
      const month = new Date().getMonth() + 1;
      return `<div class="rows">${list.map(m => {
        const season = !m.monate?.length || m.monate.includes(month);
        return `<div class="rowi ${m.aktiv === false ? 'off' : ''}" data-act="editMaschine" data-id="${m.id}">
          <span class="updown"><button type="button" class="x" data-act="mUp" data-id="${m.id}" aria-label="Nach oben">▲</button><button type="button" class="x" data-act="mDown" data-id="${m.id}" aria-label="Nach unten">▼</button></span>
          <span class="num">${esc(m.artNr || '')}</span>
          <div class="grow"><div class="t">${esc(m.name)}${m.kurz ? ` <span class="chip">${esc(m.kurz)}</span>` : ''}</div>
            <div class="s">${esc((m.arbeitsarten || []).join(', ') || 'keine Arbeitsart')}${m.leistung ? ` · ${fmtNum(m.leistung)} ha/h` : ''} · pro ${esc(m.einheit || '—')}${m.ansatz ? ` CHF ${fmtNum(m.ansatz)}` : ''}</div></div>
          <span class="chip ${season ? '' : 'muted'}" title="Saison">${esc(monthsLabel(m.monate))}</span>
        </div>`; }).join('')}</div>
        <p class="nr" style="margin-top:10px">Mit ▲▼ legst du die Priorität fest – in dieser Reihenfolge erscheinen die Maschinen in der Planung und in der Auswahl. In der Planung stehen nur Maschinen, die in Saison und aktiv sind.</p>`;
    }
  },

  /* ---------- Mehr ---------- */
  mehr: {
    toolbar() { return `<h1>Mehr</h1>`; },
    content() {
      const user = ls('lp_user'), c = Store.cfg();
      const conn = Auth.configured()
        ? (Auth.hasSession()
          ? `<p>Verbunden${user ? ' als <b>' + esc(user) + '</b>' : ''}. Die Daten liegen im App-Ordner deiner Dropbox: <b>Apps › (Name deiner Dropbox-App) › ${esc(Drive.path().slice(1))}</b>.</p>
             <div class="btns"><button class="btn primary" data-act="sync">Jetzt synchronisieren</button><button class="btn" data-act="logout">Abmelden</button></div>
             ${Sync.err ? `<p style="color:var(--danger)">Letzter Fehler: ${esc(Sync.err)}</p>` : ''}`
          : `<p>Noch nicht angemeldet. Nach der Anmeldung werden alle Daten in deiner Dropbox gespeichert und zwischen PC und iPhone abgeglichen.</p>
             <div class="btns"><button class="btn primary" data-act="login">Mit Dropbox anmelden</button></div>`)
        : `<p>Dropbox ist noch nicht eingerichtet – die App speichert vorerst nur auf diesem Gerät. Trage den App-Key in <b>config.js</b> ein (Anleitung, Schritt 2–3).</p>`;
      const y = new Date().getFullYear();
      const listPanel = (kind, title, hint) => `<div class="panel"><h2>${title}</h2><p>${hint}</p>
        <div class="chips static">${Lists[kind]().map(x => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="nr">Keine Einträge</span>'}</div>
        <div class="btns"><button class="btn" data-act="editList" data-kind="${kind}">Bearbeiten</button></div></div>`;
      return `<div class="cols"><div>
        <div class="panel"><h2>Arbeitszeit</h2>
          <div class="two">
            <label class="fld"><span>Arbeitsbeginn</span><input class="input" type="time" value="${esc(c.beginn)}" data-in="cfg" data-k="beginn"></label>
            <label class="fld"><span>Arbeitsende</span><input class="input" type="time" value="${esc(c.ende)}" data-in="cfg" data-k="ende"></label>
          </div>
          <p>Aufträge ohne feste Startzeit docken ab Arbeitsbeginn aneinander.</p></div>
        ${uiScalePanel()}
        <div class="panel"><h2>Planung: Achsen</h2>
          <div class="two">
            <label class="fld"><span>Wochenansicht</span><select class="input" data-plain data-in="axW"><option value="tage">Tage untereinander, Maschinen nebeneinander</option><option value="maschinen" ${App.plan.axW === 'maschinen' ? 'selected' : ''}>Maschinen untereinander, Tage nebeneinander</option></select></label>
            <label class="fld"><span>Tagesansicht</span><select class="input" data-plain data-in="axT"><option value="senkrecht">Zeitachse senkrecht, Maschinen nebeneinander</option><option value="waagrecht" ${App.plan.axT === 'waagrecht' ? 'selected' : ''}>Zeitachse waagrecht, Maschinen untereinander</option></select></label>
          </div>
          <p class="nr">Gilt für dieses Gerät. Ziehen, Mehrfachauswahl und Zoom funktionieren in beiden Anordnungen.</p></div>
        ${listPanel('arbeitsarten', 'Arbeitsarten', 'Auswahl bei Aufträgen und Maschinen. Umbenennen ändert auch bestehende Aufträge und Maschinen.')}
        ${listPanel('kulturen', 'Kulturen', 'Auswahl bei Aufträgen. Umbenennen ändert auch bestehende Aufträge.')}
      </div><div>
        <div class="panel"><h2>Dropbox</h2>${conn}
          <p style="margin-top:12px">Redirect-URI für die Dropbox-App:</p><code class="mono">${esc(Auth.redirectUri())}</code></div>
        <div class="panel"><h2>Export für Excel / Rechnung</h2>
          <p>Erledigte Aufträge als CSV – mit Art.-Nr., Fläche, Stunden und Verrechnungsmenge.</p>
          <div class="two" style="margin-top:10px">
            <label class="fld"><span>Von</span><input class="input" type="date" id="exVon" value="${y}-01-01"></label>
            <label class="fld"><span>Bis</span><input class="input" type="date" id="exBis" value="${todayIso()}"></label></div>
          <label class="fld"><span>Umfang</span><select class="input" id="exArt"><option value="offen">Nur noch nicht verrechnete</option><option value="alle">Alle erledigten und verrechneten</option></select></label>
          <label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="exMark"> Exportierte danach als «verrechnet» markieren</label>
          <div class="btns"><button class="btn primary" data-act="export">CSV herunterladen</button></div></div>
        <div class="panel"><h2>Datensicherung</h2>
          <p>Zusätzliche Sicherung aller Daten als Datei. Dropbox führt zudem selbst einen Versionsverlauf der Datendatei.</p>
          <p><b>Alles als Excel:</b> sämtliche Daten in einer Excel-Datei mit je einem Blatt für Aufträge, Spritzprodukte, Kunden, Felder, Parzellen, Produkte, Preisverlauf, Maschinen und Listen – zum Auswerten, Archivieren oder Weitergeben.</p>
          <div class="btns"><button class="btn primary" data-act="exportAllXlsx">Alles als Excel (.xlsx)</button><button class="btn" data-act="backup">Sicherung herunterladen (zum Einlesen)</button><button class="btn" data-act="restore">Sicherung einlesen</button></div>
          <p class="nr">Zum Zurückspielen dient die Sicherungsdatei (.json); die Excel-Datei ist zum Lesen und Auswerten gedacht.</p></div>
        <div class="panel"><h2>Version</h2>${versionInfo()}</div>
        <div class="panel"><h2>Als App installieren</h2>
          <p><b>iPhone:</b> In Safari öffnen › Teilen-Symbol › «Zum Home-Bildschirm».</p>
          <p><b>Windows:</b> In Edge oder Chrome öffnen › Menü › «Apps» › «Diese Seite als App installieren».</p></div>
      </div></div>`;
    }
  }
};

/* ---------- Karten ---------- */
function timeRange(a) {
  if (!a.datum) return '';
  const it = schedule(a.datum, a.maschine || '').items.find(x => x.a.id === a.id);
  return it ? `${fromMin(it.start)}–${fromMin(it.end)}` : '';
}
function orderCard(a) {
  const s = statusOf(a), m = maschine(a.maschine), k = Store.get('kunden', a.kunde);
  const when = a.datum
    ? `<span class="chip">📅 ${fmtDate(a.datum)} ${timeRange(a)}</span>${m ? `<span class="chip">${esc(m.name)}</span>` : '<span class="chip warn">keine Maschine</span>'}${dauerOf(a) ? `<span class="chip">⏱ ${hrs(dauerOf(a))}</span>` : ''}`
    : `<span class="chip ${wishLate(a) ? 'warn' : ''}">${wishTxt(a)}</span>`;
  return `<article class="card" data-act="editOrder" data-id="${a.id}">
    <div class="row1"><div class="title">${esc(kundeName(a.kunde))}</div><span class="badge ${s}">${STATUS[s]}</span></div>
    <div class="sub">${artKultur(a) || '—'}${a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : ''}${feldById(a.kfeld) ? ` · 🌾 ${esc(feldById(a.kfeld).name)}` : ''}</div>
    ${sprayShort(a)}${a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}
    <div class="meta">${when}<span class="nr" style="margin-left:auto">${esc(a.nr || '')}</span></div>
    ${isOpen(a) ? `<div class="actions">
      ${!a.datum ? `<button class="btn small primary" data-act="planOrder" data-id="${a.id}">Einplanen</button>` : `<button class="btn small" data-act="done" data-id="${a.id}">✓ Erledigt</button>`}
      ${k && (k.adresse || k.ort) ? `<a class="btn small" href="${mapsUrl([k.adresse, k.plz, k.ort].filter(Boolean).join(', '))}" target="_blank" rel="noopener" data-stop>📍 Karte</a>` : ''}
      ${k?.tel ? `<a class="btn small" href="tel:${esc(k.tel.replace(/\s/g, ''))}" data-stop>📞</a>` : ''}</div>` : ''}
  </article>`;
}
// Planung: Feldname hinter dem Kunden
const feldOf = a => a.feld || (a.kfeld && typeof feldById === 'function' && feldById(a.kfeld) ? feldById(a.kfeld).name : '');
const kfHtml = a => `${esc(kundeName(a.kunde))}${feldOf(a) ? `<span class="kfeld"> · ${esc(feldOf(a))}</span>` : ''}`;
const kfText = a => kundeName(a.kunde) + (feldOf(a) ? ' · ' + feldOf(a) : '');
function planCard(it) {
  const a = it.a, s = statusOf(a), d = dauerOf(a);
  return `<div class="pcard ${s} ${App.sel.has(a.id) ? 'sel' : ''}" data-act="editOrder" data-id="${a.id}" ${isOpen(a) ? 'draggable="true"' : ''}>
    <div class="tm">${fromMin(it.start)}–${fromMin(it.end)}${it.fixed ? ' 📌' : ''}${it.pushed ? ' ⤵' : ''}</div>
    <b>${kfHtml(a)}</b>
    <div class="sub">${artKultur(a)}</div>
    <div class="sub">${a.flaeche ? fmtNum(a.flaeche) + ' ha' : ''}${a.flaeche && (d || isOpen(a)) ? ' · ' : ''}${d ? '⏱ ' + hrs(d) : isOpen(a) ? '⏱ Dauer fehlt' : ''}${s === 'erledigt' || s === 'verrechnet' ? ' · ✓' : ''}</div>
    ${sprayShort(a, { noFeld: true })}${a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}
  </div>`;
}
function unplCard(a) {
  return `<div class="pcard unpl ${App.sel.has(a.id) ? 'sel' : ''}" data-act="planOrder" data-id="${a.id}" draggable="true">
    <b>${kfHtml(a)}</b>
    <div class="sub">${artKultur(a)}${a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : ''}</div>
    <div class="meta"><span class="chip ${wishLate(a) ? 'warn' : ''}">${wishTxt(a)}</span></div>
    ${sprayShort(a, { noFeld: true })}${a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}
  </div>`;
}

/* ================= Dialoge ================= */
const Dlg = {
  el: null, form: null, onSubmit: null,
  open(title, body, footer, onSubmit) {
    // frisches Formular: Ereignisse früherer Fenster wirken nicht nach
    const nf = this.form.cloneNode(false); this.form.replaceWith(nf); this.form = nf;
    this.form.innerHTML = `<div class="dh"><h2>${title}</h2><button type="button" class="x" data-act="close" aria-label="Schliessen">×</button></div>
      <div class="db">${body}</div><div class="df">${footer}</div>`;
    this.onSubmit = onSubmit;
    if (!this.el.open) this.el.showModal();
    this.form.querySelector('.db').scrollTop = 0;
    const first = this.form.querySelector('[autofocus]'); if (first && matchMedia('(pointer:fine)').matches) first.focus();
  },
  close() { this.el.close(); this.onSubmit = null; }
};
const saveFooter = (extra = '') => `${extra}<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Speichern</button>`;

function machineOptions(iso, arbeit, selected) {
  const { passend, andere } = machinesFor(iso, arbeit, selected);
  const opt = m => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}${m.leistung ? ` (${fmtNum(m.leistung)} ha/h)` : ''}</option>`;
  return `<option value="">— keine —</option>` +
    (passend.length ? `<optgroup label="${arbeit ? 'Passend für ' + esc(arbeit) : 'In Saison'}">${passend.map(opt).join('')}</optgroup>` : '') +
    (andere.length ? `<optgroup label="Andere Maschinen in Saison">${andere.map(opt).join('')}</optgroup>` : '');
}

function orderDialog(id, { plan, kunde: kundeId, pre, arbeit } = {}) {
  const isNew = !id;
  const a = isNew ? { id: uid(), nr: Store.nextAuftragNr(), status: 'offen', kunde: kundeId || '', arbeit: arbeit || '' } : structuredClone(Store.get('auftraege', id));
  if (!a) return;
  if (isNew && pre) { a.maschine = pre.maschine || ''; a.zeit = pre.zeit || ''; plan = true; }
  const k = a.kunde && Store.get('kunden', a.kunde);
  const s = statusOf(a), done = s === 'erledigt' || s === 'verrechnet';
  const planDate = a.datum || pre?.datum || (plan ? (a.wunsch && a.wunsch >= todayIso() ? a.wunsch : (App.view === 'plan' ? isoDate(App.plan.date) : todayIso())) : '');
  const body = `
    <label class="fld"><span>Kunde</span>
      <div class="combo">
        <input class="input combo-in" name="kunde" value="${esc(k ? kundeLabel(k) : '')}" placeholder="Name, Ort oder Nr. eingeben" autocomplete="off" autocapitalize="words" spellcheck="false" required ${isNew && !kundeId ? 'autofocus' : ''}>
        <div class="ksug combo-sug" id="kSug" hidden></div>
      </div>
      <div class="hint" id="kHint"></div></label>
    <label class="fld" hidden><span>Feld</span><select class="input" name="kfeld"></select></label>
    <div class="two">
      <label class="fld"><span>Arbeit *</span><select class="input" name="arbeit" required>
        <option value="">— bitte wählen —</option>${listOptions(Lists.arbeitsarten(), a.arbeit)}</select></label>
      <label class="fld"><span>Kultur</span><select class="input" name="kultur">
        <option value="">—</option>${listOptions(Lists.kulturen(), a.kultur)}</select></label>
    </div>
    <div class="two">
      <label class="fld"><span>Fläche (ha)</span><input class="input" name="flaeche" inputmode="decimal" value="${a.flaeche ?? ''}" placeholder="z.B. 4.5"></label>
      <label class="fld"><span>Wunschdatum</span><input class="input" type="date" name="wunsch" value="${a.wunsch || ''}"></label>
    </div>
    ${sprayBox(a)}
    <label class="fld"><span>Bemerkungen</span><textarea class="input" name="notiz" placeholder="Zufahrt, Besonderheiten, Ansprechperson…">${esc(a.notiz || '')}</textarea></label>

    <details class="box" id="planBox" ${a.datum || plan ? 'open' : ''}>
      <summary><b>${a.datum ? 'Einplanung' : 'Direkt einplanen'}</b></summary>
      <div style="margin-top:10px">
        <div class="two">
          <label class="fld"><span>Datum</span><input class="input" type="date" name="datum" value="${planDate}"></label>
          <label class="fld"><span>Startzeit (leer = automatisch)</span><input class="input" type="time" name="zeit" value="${a.zeit || ''}" step="900"></label>
        </div>
        <label class="fld"><span>Maschine</span><select class="input" name="maschine"></select><div class="hint" id="mHint"></div></label>
        <label class="fld"><span>Dauer (h)</span><input class="input" name="dauer" inputmode="decimal" value="${a.dauerManuell ? (a.dauer ?? '') : ''}" style="max-width:200px"><div class="sub2" id="dHint"></div></label>
        ${a.datum ? '<a href="#" data-act="unplan">Einplanung entfernen</a>' : ''}
      </div>
    </details>
    ${isNew ? '' : `
    <div class="box">
      <label class="fld" style="margin-bottom:${done ? 12 : 0}px"><span>Status</span><select class="input" name="status">${Object.entries(STATUS).map(([v, l]) => `<option value="${v}" ${s === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div id="doneBox" ${done ? '' : 'hidden'}>
        <div class="three">
          <label class="fld"><span>Erledigt am</span><input class="input" type="date" name="erledigtAm" value="${a.erledigtAm || ''}"></label>
          <label class="fld"><span>Fläche eff. (ha)</span><input class="input" name="flaecheEff" inputmode="decimal" value="${a.flaecheEff ?? ''}"></label>
          <label class="fld"><span>Stunden eff.</span><input class="input" name="stundenEff" inputmode="decimal" value="${a.stundenEff ?? ''}"></label>
        </div></div>
    </div>`}
    <p class="nr">Auftrag ${esc(a.nr || '')}</p>`;
  const footer = saveFooter(isNew ? '' : `<button type="button" class="btn danger" data-act="delOrder" data-id="${a.id}">Löschen</button><button type="button" class="btn" data-act="dupOrder" data-id="${a.id}">Kopie</button>`);

  Dlg.open(isNew ? 'Neuer Auftrag' : 'Auftrag', body, footer, fd => {
    const kTxt = (fd.get('kunde') || '').trim();
    const kunde = findKunde(kTxt);
    if (!kunde) { toast('Kunde nicht gefunden – bitte aus den Vorschlägen wählen.', 4000); Dlg.form.kunde.focus(); return false; }
    const planOpen = $('#planBox', Dlg.form).open;
    const o = Object.assign(a, {
      kunde: kunde.id, arbeit: fd.get('arbeit'), kultur: fd.get('kultur'),
      flaeche: num(fd.get('flaeche')), wunsch: fd.get('wunsch'), notiz: fd.get('notiz').trim(), kfeld: fd.get('kfeld') || ''
    });
    if (planOpen && fd.get('datum')) {
      const m = maschine(fd.get('maschine')); const manual = num(fd.get('dauer'));
      Object.assign(o, { datum: fd.get('datum'), zeit: fd.get('zeit'), maschine: m?.id || '', dauerManuell: manual != null, dauer: manual ?? defaultDauer(m, o.flaeche) });
    } else if (!o.datum || planOpen) { Object.assign(o, { datum: '', zeit: '' }); }
    if (isSpray(o)) Object.assign(o, readSpray(Dlg.form));
    if (!isNew) {
      o.status = fd.get('status');
      if (o.status === 'erledigt' || o.status === 'verrechnet') {
        o.erledigtAm = fd.get('erledigtAm') || o.datum || todayIso(); if (!o.datum) o.datum = o.erledigtAm;
        o.flaecheEff = num(fd.get('flaecheEff')); o.stundenEff = num(fd.get('stundenEff'));
      }
    }
    if (isOpen(o)) o.status = o.datum ? 'geplant' : 'offen';
    if (o.datum && o.zeit && isOpen(o)) { const fr = freezeDay(o.datum, o.maschine || '', [o.id]); if (fr.length) Store.putMany('auftraege', fr); }
    Store.put('auftraege', o);
    toast(o.datum && isOpen(o) ? `Eingeplant am ${fmtDate(o.datum)} ${timeRange(o)}` : 'Auftrag gespeichert');
    return true;
  });

  // ---- Live-Verhalten
  const f = Dlg.form;
  const fillMachines = () => {
    const cur = f.maschine.value || a.maschine || '';
    f.maschine.innerHTML = machineOptions(f.datum.value, f.arbeit.value.trim(), cur);
    const { passend } = machinesFor(f.datum.value, f.arbeit.value.trim());
    if (!f.maschine.value && !cur && f.datum.value && passend.length === 1 && f.arbeit.value.trim()) f.maschine.value = passend[0].id;
    $('#mHint', f).textContent = f.datum.value && f.arbeit.value.trim() && !passend.length ? `Keine Maschine für «${f.arbeit.value.trim()}» im ${MONATE[parseDate(f.datum.value).getMonth()]} in Saison.` : '';
    showDauer();
  };
  const showDauer = () => {
    const m = maschine(f.maschine.value), fl = num(f.flaeche.value), d = defaultDauer(m, fl);
    f.dauer.placeholder = d != null ? fmtNum(d) : '';
    $('#dHint', f).innerHTML = d != null
      ? `Standard: ${hrs(d)} (${fmtNum(fl)} ha ÷ ${fmtNum(m.leistung)} ha/h)${f.dauer.value ? ' · <a href="#" data-act="dauerReset">zurücksetzen</a>' : ''}`
      : (m && !m.leistung ? 'Keine Flächenleistung erfasst – Dauer von Hand eingeben.' : '');
  };
  const checkKunde = () => {
    const t = f.kunde.value.trim();
    $('#kHint', f).textContent = !t || findKunde(t) || !$('#kSug', f).hidden ? '' : 'Kein ähnlicher Kunde gefunden. Neue Kunden werden in MyJohnDeere erfasst.';
  };
  wireKundeSuggest(f, checkKunde);
  f.arbeit.addEventListener('change', fillMachines);
  f.datum.addEventListener('change', fillMachines);
  f.maschine.addEventListener('change', showDauer);
  f.flaeche.addEventListener('input', showDauer);
  f.dauer.addEventListener('input', showDauer);
  $('#planBox', f).addEventListener('toggle', e => { if (e.target.open && !f.datum.value) { f.datum.value = f.wunsch.value || todayIso(); fillMachines(); } });
  if (f.status) f.status.addEventListener('change', () => {
    const dn = ['erledigt', 'verrechnet'].includes(f.status.value);
    $('#doneBox', f).hidden = !dn; f.status.closest('.fld').style.marginBottom = dn ? '12px' : '0';
    if (dn) {
      if (!f.erledigtAm.value) f.erledigtAm.value = f.datum.value || a.datum || todayIso();
      if (!f.flaecheEff.value && num(f.flaeche.value) != null) f.flaecheEff.value = num(f.flaeche.value);
      if (!f.stundenEff.value) { const d = num(f.dauer.value) ?? defaultDauer(maschine(f.maschine.value), num(f.flaeche.value)); if (d != null) f.stundenEff.value = d; }
    }
  });
  fillMachines(); checkKunde(); wireSpray(f); wireFeld(f, a);
  if (plan) setTimeout(() => $('#planBox', f)?.scrollIntoView({ block: 'nearest' }), 60);
}

/* ---------- Kundensuche mit Vorschlägen ähnlicher Kunden ---------- */
const fold = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function lev(a, b) { // Tippfehler-Abstand
  if (Math.abs(a.length - b.length) > 2) return 9;
  let p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[b.length];
}
// Ähnlichkeit: jedes eingegebene Wort muss zu einem Wort von Name, Ort, Nr. passen (Anfang, enthalten oder Tippfehler); Reihenfolge egal
const kundeScore = (k, toks) => textScore([k.name, k.ort, k.nr, k.jdName !== k.name ? k.jdName : ''].join(' '), toks);
const tokensOf = t => fold(t).split(' ').filter(Boolean);
function textScore(text, toks) {
  const ws = fold(text).split(' ').filter(Boolean);
  const words = [...new Set([...ws, ...ws.map(w => w.replace(/([aou])e/g, '$1'))])]; // «Häni» passt auf «haeni» und «hani»
  let s = 0;
  for (const t of toks) {
    let best = 0;
    for (const w of words) {
      if (w === t) best = Math.max(best, 4);
      else if (w.startsWith(t)) best = Math.max(best, 3);
      else if (t.length >= 3 && w.includes(t)) best = Math.max(best, 2);
      else if (t.length >= 3) { const d = Math.min(lev(t, w), lev(t, w.slice(0, t.length))); if (d <= (t.length >= 6 ? 2 : 1)) best = Math.max(best, 1.5 - d * 0.4); }
    }
    if (!best) return 0;
    s += best;
  }
  return s;
}
function similarKunden(text, n = 6) {
  const toks = fold(text).split(' ').filter(Boolean); if (!toks.length) return [];
  return Store.all('kunden').filter(k => k.aktiv !== false).map(k => ({ k, s: kundeScore(k, toks) })).filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.k.name.localeCompare(b.k.name, 'de')).slice(0, n).map(x => x.k);
}
function wireKundeSuggest(f, after) {
  // Tippen → ähnliche Kunden; Antippen bzw. Pfeil nach unten → ganze Kundenliste wie ein Dropdown
  const inp = f.kunde, box = $('#kSug', f); let hits = [], idx = -1;
  const allK = () => Store.all('kunden').filter(k => k.aktiv !== false).sort((x, y) => x.name.localeCompare(y.name, 'de'));
  const show = full => {
    const t = inp.value.trim(), exact = findKunde(t), isExact = exact && kundeLabel(exact) === t;
    hits = full || !t ? (full ? allK() : []) : isExact ? [] : similarKunden(t, 30);
    idx = full ? hits.findIndex(k => exact && k.id === exact.id) : (hits.length ? 0 : -1);
    box.innerHTML = hits.map((k, i) => `<button type="button" tabindex="-1" class="${i === idx ? 'on' : ''}" data-ki="${i}"><b>${esc(k.name)}</b>${k.ort || k.nr ? ` <span>${esc([k.ort, k.nr].filter(Boolean).join(' · '))}</span>` : ''}</button>`).join('');
    box.hidden = !hits.length; box.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); after && after();
  };
  const pick = k => { inp.value = kundeLabel(k); box.hidden = true; hits = []; inp.dispatchEvent(new Event('input', { bubbles: true })); box.hidden = true; after && after(); };
  const mark = () => { [...box.children].forEach((b, i) => b.classList.toggle('on', i === idx)); box.children[idx]?.scrollIntoView({ block: 'nearest' }); };
  inp.addEventListener('input', e => { if (e.isTrusted) show(false); });
  inp.addEventListener('pointerdown', () => { if (!box.hidden && document.activeElement === inp) { box.hidden = true; return; } setTimeout(() => show(!inp.value.trim() || !!findKunde(inp.value)), 0); });
  inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement === inp) return; box.hidden = true; after && after(); }, 150));
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && box.hidden) { show(true); e.preventDefault(); return; }
    if (box.hidden || !hits.length) return;
    if (e.key === 'ArrowDown') { idx = (idx + 1) % hits.length; mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = (idx - 1 + hits.length) % hits.length; mark(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { if (idx >= 0) { if (e.key === 'Enter') e.preventDefault(); pick(hits[idx]); } }
    else if (e.key === 'Escape') { box.hidden = true; e.preventDefault(); e.stopPropagation(); }
  });
  box.addEventListener('pointerdown', e => e.preventDefault()); // Fokus im Feld behalten
  box.addEventListener('click', e => { const b = e.target.closest('[data-ki]'); if (b) pick(hits[+b.dataset.ki]); });
}

/* ---------- Auswahlfelder mit Suche und Vorschlägen (gleiches Prinzip wie beim Kunden) ----------
   Ersetzt die Anzeige eines <select> durch ein Suchfeld; das <select> bleibt (versteckt) Träger des Werts,
   damit Formulare und bestehende Logik unverändert funktionieren. */
const Combo = {
  eligible: sel => sel.matches('dialog select.input, select[data-combo]') && !sel.matches('[data-plain], [multiple], [name="status"]'),
  scan(root) { (root.matches?.('select') ? [root] : [...(root.querySelectorAll?.('select') || [])]).forEach(s => { if (!s._combo && Combo.eligible(s)) Combo.enhance(s); }); },
  enhance(sel) {
    sel._combo = true;
    const wrap = document.createElement('div'); wrap.className = 'combo';
    if (sel.style.width) wrap.style.width = sel.style.width; if (sel.style.minWidth) wrap.style.minWidth = sel.style.minWidth; if (sel.style.maxWidth) wrap.style.maxWidth = sel.style.maxWidth;
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    const inp = document.createElement('input');
    inp.className = 'input combo-in'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('enterkeyhint', 'done');
    if (sel.getAttribute('aria-label')) inp.setAttribute('aria-label', sel.getAttribute('aria-label'));
    const box = document.createElement('div'); box.className = 'ksug combo-sug'; box.hidden = true;
    wrap.prepend(inp); wrap.append(box); // Suchfeld zuerst, damit ein Klick auf die Beschriftung es fokussiert
    sel.hidden = true; sel.tabIndex = -1;
    if (sel.required) { sel.required = false; inp.required = true; }
    const blank = () => [...sel.options].find(o => o.value === '');
    const label = o => !o || o.value === '' ? '' : o.textContent.trim();
    const sync = () => { if (document.activeElement !== inp) inp.value = label(sel.options[sel.selectedIndex]); const b = blank(); inp.placeholder = b ? b.textContent.trim() : 'Suchen…'; };
    // programmatische Änderungen (sel.value = …, neue Optionen) übernehmen
    const P = HTMLSelectElement.prototype;
    ['value', 'selectedIndex'].forEach(k => { const d = Object.getOwnPropertyDescriptor(P, k); Object.defineProperty(sel, k, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); sync(); } }); });
    new MutationObserver(() => { sync(); if (!box.hidden) show(inp.value.trim() === label(sel.options[sel.selectedIndex]) ? '' : inp.value); }).observe(sel, { childList: true, subtree: true });
    sel.addEventListener('change', sync);
    let hits = [], idx = -1;
    const show = q => {
      const opts = [...sel.options].filter(o => !o.disabled), toks = tokensOf(q || '');
      hits = !toks.length ? opts : opts.map((o, i) => ({ o, i, s: textScore(o.textContent, toks) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.o);
      hits = hits.slice(0, 100);
      idx = toks.length ? (hits.length ? 0 : -1) : hits.indexOf(sel.options[sel.selectedIndex]);
      box.innerHTML = hits.map((o, i) => { const g = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : ''; return `<button type="button" tabindex="-1" class="${i === idx ? 'on' : ''}${o.value === '' ? ' blank' : ''}" data-ki="${i}">${esc(o.textContent.trim())}${g && toks.length ? ` <span>${esc(g)}</span>` : ''}</button>`; }).join('')
        || '<div class="none">Keine Übereinstimmung</div>';
      box.hidden = false;
      box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    };
    const pick = o => {
      box.hidden = true; hits = [];
      const changed = sel.value !== o.value || sel.options[sel.selectedIndex] !== o;
      o.selected = true; inp.value = label(o);
      if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    };
    const mark = () => { [...box.children].forEach((b, i) => b.classList.toggle('on', i === idx)); box.children[idx]?.scrollIntoView({ block: 'nearest' }); };
    inp.addEventListener('focus', () => { show(''); setTimeout(() => inp.select(), 0); });
    inp.addEventListener('click', () => { if (box.hidden) show(''); });
    inp.addEventListener('input', () => show(inp.value));
    inp.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement === inp) return;
      box.hidden = true;
      const t = inp.value.trim(), cur = sel.options[sel.selectedIndex];
      if (!t) { const b = blank(); if (b && cur !== b) pick(b); else sync(); return; }
      if (t === label(cur)) return;
      const exact = [...sel.options].find(o => fold(o.textContent) === fold(t));
      const best = exact || (similarHits(sel, t).length === 1 ? similarHits(sel, t)[0] : null);
      if (best) pick(best); else { inp.value = label(cur); toast('Bitte einen Eintrag aus der Liste wählen'); }
    }, 150));
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (box.hidden) show(''); else if (hits.length) { idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; mark(); } e.preventDefault(); }
      else if (e.key === 'Enter') { if (!box.hidden) { e.preventDefault(); if (hits[idx]) pick(hits[idx]); } }
      else if (e.key === 'Tab') { if (!box.hidden && hits[idx] && fold(inp.value) && fold(inp.value) !== fold(label(sel.options[sel.selectedIndex]))) pick(hits[idx]); }
      else if (e.key === 'Escape' && !box.hidden) { box.hidden = true; inp.value = label(sel.options[sel.selectedIndex]); e.preventDefault(); e.stopPropagation(); }
    });
    box.addEventListener('pointerdown', e => e.preventDefault());
    box.addEventListener('click', e => { const b = e.target.closest('[data-ki]'); if (b) pick(hits[+b.dataset.ki]); });
    sync();
  }
};
const similarHits = (sel, t) => { const toks = tokensOf(t); return [...sel.options].filter(o => o.value !== '' && textScore(o.textContent, toks) > 0); };
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && Combo.scan(n)))).observe(document.documentElement, { childList: true, subtree: true });

/* ---------- Auswahllisten im Auftrag (nur bestehende Einträge) ---------- */
const findKunde = t => { t = String(t || '').trim(); if (!t) return null; const all = Store.all('kunden').sort((a, b) => (a.aktiv === false) - (b.aktiv === false)); return all.find(k => kundeLabel(k) === t) || all.find(k => norm(k.name) === norm(t)) || null; };
const kundenOptions = () => Store.all('kunden').filter(k => k.aktiv !== false).sort((x, y) => x.name.localeCompare(y.name, 'de')).map(k => `<option value="${esc(kundeLabel(k))}">`).join('');
// bestehender Wert bleibt wählbar, auch wenn er inzwischen nicht mehr in der Liste steht
const listOptions = (list, cur) => (cur && !list.includes(cur) ? [cur, ...list] : list).map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');

/* ---------- Neuer Kunde direkt aus dem Auftrag (zweites Fenster) ---------- */
function quickKundeDialog() {
  let d2 = $('#dlg2');
  if (!d2) { d2 = document.createElement('dialog'); d2.id = 'dlg2'; document.body.appendChild(d2); }
  const typed = Dlg.form.kunde.value.trim();
  d2.innerHTML = `<form id="dlg2Form"><div class="dh"><h2>Neuer Kunde</h2><button type="button" class="x" data-k2="close" aria-label="Schliessen">×</button></div>
    <div class="db">
      <div class="two"><label class="fld"><span>Kunden-Nr.</span><input class="input" name="nr"></label>
        <label class="fld"><span>Telefon</span><input class="input" name="tel" type="tel"></label></div>
      <label class="fld"><span>Name / Betrieb *</span><input class="input" name="name" value="${esc(findKunde(typed) ? '' : typed)}" required></label>
      <label class="fld"><span>Adresse</span><input class="input" name="adresse"></label>
      <div class="two"><label class="fld"><span>PLZ</span><input class="input" name="plz" inputmode="numeric"></label>
        <label class="fld"><span>Ort</span><input class="input" name="ort"></label></div>
    </div>
    <div class="df"><span class="spacer"></span><button type="button" class="btn" data-k2="close">Abbrechen</button><button type="submit" class="btn primary">Kunde speichern</button></div></form>`;
  const f2 = $('#dlg2Form');
  f2.addEventListener('click', e => { if (e.target.closest('[data-k2="close"]')) d2.close(); });
  f2.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(f2), k = { id: uid() };
    ['nr', 'name', 'adresse', 'plz', 'ort', 'tel'].forEach(x => { k[x] = (fd.get(x) || '').trim(); });
    const dup = Store.all('kunden').find(x => norm(x.name) === norm(k.name) && (!k.ort || norm(x.ort) === norm(k.ort)));
    if (dup && !confirm(`«${kundeLabel(dup)}» gibt es schon. Trotzdem neu anlegen?`)) return;
    Store.put('kunden', k, { silent: true });
    const f = Dlg.form; f.kunde.value = kundeLabel(k); $('#kHint', f).textContent = ''; $('#kSug', f).hidden = true;
    f.kunde.dispatchEvent(new Event('input')); d2.close(); toast('Kunde angelegt');
  });
  d2.showModal();
  if (matchMedia('(pointer:fine)').matches) f2.name.focus();
}

function doneDialog(id) {
  const a = structuredClone(Store.get('auftraege', id)); if (!a) return;
  const ms = Store.all('maschinen').filter(m => m.aktiv !== false || m.id === a.maschine).sort(byPrio);
  const body = `
    <p style="margin-top:0"><b>${esc(kundeName(a.kunde))}</b> · ${artKultur(a)}</p>
    <label class="fld"><span>Erledigt am</span><input class="input" type="date" name="erledigtAm" value="${a.datum && a.datum <= todayIso() ? a.datum : todayIso()}"></label>
    <label class="fld"><span>Maschine</span><select class="input" name="maschine"><option value="">—</option>${ms.map(m => `<option value="${m.id}" ${m.id === a.maschine ? 'selected' : ''}>${esc(m.name)} (pro ${esc(m.einheit)})</option>`).join('')}</select></label>
    <div class="two">
      <label class="fld"><span>Fläche effektiv (ha)</span><input class="input" name="flaecheEff" inputmode="decimal" value="${a.flaecheEff ?? a.flaeche ?? ''}" autofocus></label>
      <label class="fld"><span>Stunden effektiv</span><input class="input" name="stundenEff" inputmode="decimal" value="${a.stundenEff ?? dauerOf(a) ?? ''}"></label>
    </div>
    <label class="fld"><span>Bemerkungen</span><textarea class="input" name="notiz">${esc(a.notiz || '')}</textarea></label>`;
  Dlg.open('Erledigt melden', body, saveFooter(), fd => {
    Object.assign(a, { status: 'erledigt', erledigtAm: fd.get('erledigtAm') || todayIso(), maschine: fd.get('maschine'),
      flaecheEff: num(fd.get('flaecheEff')), stundenEff: num(fd.get('stundenEff')), notiz: fd.get('notiz').trim() });
    if (!a.datum) a.datum = a.erledigtAm;
    Store.put('auftraege', a); toast('Als erledigt gemeldet'); return true;
  });
}

function listDialog(kind) {
  const title = { kulturen: 'Kulturen bearbeiten', duesen: 'Düsen bearbeiten', traktoren: 'Traktoren bearbeiten' }[kind] || 'Arbeitsarten bearbeiten';
  const field = { arbeitsarten: 'arbeit', kulturen: 'kultur', duesen: 'duese', traktoren: 'traktor' }[kind];
  const row = (v, i) => `<div class="lrow"><span class="updown"><button type="button" class="x" data-act="lrowUp" aria-label="Nach oben">▲</button><button type="button" class="x" data-act="lrowDown" aria-label="Nach unten">▼</button></span><input class="input" name="v" value="${esc(v)}" data-orig="${i == null ? '' : esc(v)}"><button type="button" class="x" data-act="lrowDel" aria-label="Entfernen">×</button></div>`;
  const body = `<div class="links" style="margin:0 0 10px"><a href="#" data-act="lrowSort">Alphabetisch sortieren</a></div>
    <p class="nr" style="margin-top:0">Mit ▲▼ legst du die Reihenfolge in den Auswahllisten fest. Umbenennen ändert auch alle Aufträge${kind === 'arbeitsarten' ? ' und Maschinen' : ''} mit diesem Eintrag. Entfernen löscht nur den Vorschlag – bestehende Aufträge bleiben unverändert.</p>
    <div id="lrows">${Lists[kind]().map((v, i) => row(v, i)).join('')}</div>
    <button type="button" class="btn small" data-act="lrowAdd">＋ Eintrag</button>`;
  Dlg.open(title, body, saveFooter(), () => {
    const inputs = $$('#lrows input', Dlg.form);
    const renames = inputs.filter(i => i.dataset.orig && i.value.trim() && i.value.trim() !== i.dataset.orig).map(i => [i.dataset.orig, i.value.trim()]);
    const vals = uniqKeep(inputs.map(i => i.value));
    const now = Date.now();
    renames.forEach(([from, to]) => {
      if (kind === 'arbeitsarten') {
        Store.data.maschinen.forEach(m => { if (!m.del && (m.arbeitsarten || []).includes(from)) { m.arbeitsarten = uniqSort(m.arbeitsarten.map(x => x === from ? to : x)); m.upd = now; } });
        Store.data.auftraege.forEach(a => { if (!a.del && a.arbeit === from) { a.arbeit = to; a.upd = now; } });
      } else Store.data.auftraege.forEach(a => { if (!a.del && a[field] === from) { a[field] = to; a.upd = now; } });
      if (kind === 'kulturen') Store.data.parzellen.forEach(p => { if (!p.del && p.kultur === from) { p.kultur = to; p.upd = now; } });
    });
    Store.setCfg({ [kind]: vals }, { silent: false });
    toast(renames.length ? `Gespeichert, ${renames.length} umbenannt` : 'Gespeichert'); return true;
  });
  Dlg.form._row = row;
}

function kundeDialog(id) {
  if (!id && jdLock()) { toast('Neue Kunden werden in MyJohnDeere erfasst.'); return; }
  const k = id ? { ...Store.get('kunden', id) } : { id: uid() };
  const lock = jdLock() || !!k.jdId || !!k.jdName;
  const body = `
    <div class="two"><label class="fld"><span>Kunden-Nr.</span><input class="input" name="nr" value="${esc(k.nr || '')}"></label>
      <label class="fld"><span>Anrede</span><input class="input" name="anrede" value="${esc(k.anrede || '')}" placeholder="Herr / Frau / Familie"></label></div>
    <label class="fld"><span>Name / Betrieb${lock ? ' <small class="nr">(aus MyJohnDeere)</small>' : ''}</span><input class="input" name="name" value="${esc(k.name || '')}" required ${lock ? 'readonly' : 'autofocus'}></label>
    ${id ? `<div id="felderBox">${felderSection(k.id)}</div>` : ''}
    <div class="two"><label class="fld"><span>Telefon</span><input class="input" name="tel" type="tel" value="${esc(k.tel || '')}"></label>
      <label class="fld"><span>Handy</span><input class="input" name="handy" type="tel" value="${esc(k.handy || '')}"></label></div>
    <label class="fld"><span>Adresse</span><input class="input" name="adresse" value="${esc(k.adresse || '')}"></label>
    <div class="two"><label class="fld"><span>PLZ</span><input class="input" name="plz" inputmode="numeric" value="${esc(k.plz || '')}"></label>
      <label class="fld"><span>Ort</span><input class="input" name="ort" value="${esc(k.ort || '')}"></label></div>
    <label class="fld"><span>E-Mail</span><input class="input" name="mail" type="email" value="${esc(k.mail || '')}"></label>
    <label class="fld"><span>Notizen</span><textarea class="input" name="notiz">${esc(k.notiz || '')}</textarea></label>
    <div class="box"><h4>🧪 Preise Spritzen (pro ha)</h4>
      <div class="three"><label class="fld"><span>Spritze CHF</span><input class="input" name="preisSpritze" inputmode="decimal" value="${k.preisSpritze ?? ''}"></label>
        <label class="fld"><span>Fahrer CHF</span><input class="input" name="preisFahrer" inputmode="decimal" value="${k.preisFahrer ?? ''}"></label>
        <label class="fld"><span>Traktor CHF</span><input class="input" name="preisTraktor" inputmode="decimal" value="${k.preisTraktor ?? ''}"></label></div>
      <label class="fld" style="margin:0"><span>Zuschlag Mittel (%)</span><input class="input" name="zuschlag" inputmode="decimal" value="${k.zuschlag != null ? r2(k.zuschlag * 100) : ''}" style="max-width:140px"></label></div>
    <label class="tog"><input type="checkbox" name="aktiv" ${k.aktiv !== false ? 'checked' : ''}> Aktiv (inaktive Kunden werden in Listen und bei neuen Aufträgen nicht mehr angezeigt)</label>
`;
  Dlg.open(id ? (lock ? 'Kunde' : 'Kunde bearbeiten') : 'Neuer Kunde', body,
    saveFooter(id ? `${lock ? '' : `<button type="button" class="btn danger" data-act="delKunde" data-id="${k.id}">Löschen</button>`}<button type="button" class="btn" data-act="newOrderFor" data-id="${k.id}">＋ Auftrag</button>` : ''), fd => {
      if (!lock) k.name = (fd.get('name') || '').trim();
      ['nr', 'anrede', 'adresse', 'plz', 'ort', 'tel', 'handy', 'mail', 'notiz'].forEach(x => { k[x] = (fd.get(x) || '').trim(); });
      ['preisSpritze', 'preisFahrer', 'preisTraktor'].forEach(x => { k[x] = num(fd.get(x)); });
      k.zuschlag = num(fd.get('zuschlag')) != null ? num(fd.get('zuschlag')) / 100 : null;
      const war = k.aktiv !== false; k.aktiv = !!fd.get('aktiv'); if (k.aktiv) delete k.manInaktiv; else if (war) k.manInaktiv = true; // von Hand inaktiv gesetzt: der MyJohnDeere-Abgleich aktiviert ihn nicht wieder
      Store.put('kunden', k); return true;
    });
}

function maschineDialog(id) {
  const m = id ? structuredClone(Store.get('maschinen', id)) : { id: uid(), einheit: 'ha', aktiv: true, arbeitsarten: [], monate: [] };
  const mon = m.monate?.length ? m.monate : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const arbeiten = uniqKeep([...Lists.arbeitsarten(), ...(m.arbeitsarten || [])]);
  const body = `
    <div class="three"><label class="fld"><span>Art.-Nr.</span><input class="input" name="artNr" value="${esc(m.artNr || '')}"></label>
      <label class="fld"><span>Priorität (1 = zuerst)</span><input class="input" name="prio" inputmode="numeric" value="${m.prio ?? ''}"></label>
      <label class="fld"><span>Verrechnung pro</span><select class="input" name="einheit">${EINHEITEN.map(e => `<option ${m.einheit === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label></div>
    <div class="two"><label class="fld"><span>Bezeichnung</span><input class="input" name="name" value="${esc(m.name || '')}" required ${id ? '' : 'autofocus'}></label>
      <label class="fld"><span>Kurzname für die Planung</span><input class="input" name="kurz" maxlength="14" value="${esc(m.kurz || '')}" placeholder="z.B. Spritze, 6R"></label></div>
    <div class="two">
      <label class="fld"><span>Flächenleistung (ha/h)</span><input class="input" name="leistung" inputmode="decimal" value="${m.leistung ?? ''}" placeholder="z.B. 2.5"></label>
      <label class="fld"><span>Ansatz CHF pro ${esc(m.einheit || 'Einheit')}</span><input class="input" name="ansatz" inputmode="decimal" value="${m.ansatz ?? ''}"></label>
    </div>
    <p class="nr" style="margin:-6px 0 14px">Aus der Flächenleistung berechnet die Planung die Dauer: Fläche ÷ Leistung (auf ¼ h aufgerundet).</p>
    <div class="fld"><span>Arbeitsarten</span>
      <div class="chips" id="aaChips">${arbeiten.map(x => `<label><input type="checkbox" name="aa" value="${esc(x)}" ${(m.arbeitsarten || []).includes(x) ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}</div>
      <input class="input" name="aaNeu" placeholder="Weitere Arbeitsart, z.B. Dreschen (mehrere mit Komma)" style="margin-top:8px"></div>
    <div class="fld"><span>Saison (Monate, in denen die Maschine verfügbar ist)</span>
      <div class="chips months">${MONATE.map((n, i) => `<label><input type="checkbox" name="mon" value="${i + 1}" ${mon.includes(i + 1) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
      <div class="links" style="margin-top:8px"><a href="#" data-act="monAll">Ganzes Jahr</a><a href="#" data-act="monNone">Keine</a></div></div>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="aktiv" ${m.aktiv !== false ? 'checked' : ''}> Aktiv (in Planung und Auswahl anzeigen)</label>`;
  Dlg.open(id ? 'Maschine bearbeiten' : 'Neue Maschine', body,
    saveFooter(id ? `<button type="button" class="btn danger" data-act="delMaschine" data-id="${m.id}">Löschen</button>` : ''), fd => {
      const monate = fd.getAll('mon').map(Number);
      if (!monate.length && !confirm('Keine Monate gewählt – die Maschine wäre nie verfügbar. Als «ganzes Jahr» speichern?')) return false;
      Object.assign(m, {
        artNr: fd.get('artNr').trim(), prio: num(fd.get('prio')), name: fd.get('name').trim(), kurz: String(fd.get('kurz') || '').trim(), einheit: fd.get('einheit'), leistung: num(fd.get('leistung')),
        ansatz: num(fd.get('ansatz')), aktiv: !!fd.get('aktiv'),
        arbeitsarten: uniqSort([...fd.getAll('aa'), ...fd.get('aaNeu').split(',')]),
        monate: monate.length === 12 || !monate.length ? [] : monate.sort((x, y) => x - y)
      });
      Lists.ensure('arbeitsarten', m.arbeitsarten);
      Store.put('maschinen', m); return true;
    });
}

/* ================= Zoom & Vollbild ================= */
function setZoom(z) {
  z = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 100) / 100;
  if (z === App.zoom) return;
  const cal = $('.cal'), old = App.zoom;
  if (cal) { // Bildmitte festhalten
    const cx = cal.scrollLeft + cal.clientWidth / 2, cy = cal.scrollTop + cal.clientHeight / 2, r = z / old;
    const dayCols = cal.id === 'tlwrap';
    if (cal.id === 'tlwrapH') { App.zoomAnchor = c => { c.scrollLeft = Math.max(0, cx * r - c.clientWidth / 2); c.scrollTop = Math.max(0, cy - c.clientHeight / 2); }; App.zoom = z; ls('lp_zoom', String(z)); App.render(); return; }
    App.zoomAnchor = c => {
      c.scrollTop = Math.max(0, cy * r - c.clientHeight / 2);
      c.scrollLeft = Math.max(0, (dayCols ? cx * Math.max(0.5, Math.min(1.6, z)) / Math.max(0.5, Math.min(1.6, old)) : cx * r) - c.clientWidth / 2);
    };
  }
  App.zoom = z; ls('lp_zoom', String(z)); App.render();
}
// Zwei-Finger-Zoom (iPhone/Tablet) und Ctrl+Mausrad bzw. Trackpad-Pinch (PC)
function attachPinch(cal) {
  const inner = cal.firstElementChild; let d0 = 0, scale = 1;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  cal.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      d0 = dist(e.touches); scale = 1;
      const r = cal.getBoundingClientRect();
      inner.style.transformOrigin = `${(e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left + cal.scrollLeft}px ${(e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top + cal.scrollTop}px`;
    }
  }, { passive: true });
  cal.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !d0) return;
    e.preventDefault();
    scale = Math.max(ZOOM_MIN / App.zoom, Math.min(ZOOM_MAX / App.zoom, dist(e.touches) / d0));
    inner.style.transform = `scale(${scale})`; // nur Vorschau, gerechnet wird beim Loslassen
  }, { passive: false });
  const end = e => { if (d0 && e.touches.length < 2) { d0 = 0; inner.style.transform = ''; if (Math.abs(scale - 1) > 0.03) setZoom(App.zoom * scale); } };
  cal.addEventListener('touchend', end); cal.addEventListener('touchcancel', end);
  ['gesturestart', 'gesturechange'].forEach(n => cal.addEventListener(n, e => e.preventDefault()));
  cal.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(App.zoom * Math.exp(-e.deltaY / 300)); } }, { passive: false });
}

/* ================= Mehrfachauswahl ================= */
function toggleSel(id) { if (App.sel.has(id)) App.sel.delete(id); else App.sel.add(id); App.render(); }
function clearSel() { App.sel.clear(); App.selMode = false; App.render(); }
function renderSelbar() {
  const bar = $('#selbar'); if (!bar) return;
  [...App.sel].forEach(id => { const a = Store.get('auftraege', id); if (!a || !isOpen(a)) App.sel.delete(id); });
  const n = App.sel.size;
  if (App.view !== 'plan' || (!n && !App.selMode)) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = n
    ? `<b>${n} ausgewählt</b>
       <button class="btn small primary" data-act="bulkMove">Verschieben…</button>
       <button class="btn small" data-act="bulkDay" data-d="-1">◀ 1 Tag</button>
       <button class="btn small" data-act="bulkDay" data-d="1">1 Tag ▶</button>
       <button class="btn small" data-act="bulkUnplan">Ausplanen</button>
       <button class="btn small ghost" data-act="selClear">Aufheben</button>`
    : `<span>Aufträge antippen, um sie auszuwählen</span><button class="btn small ghost" data-act="selClear">Fertig</button>`;
}
function bulkShiftDays(delta) {
  const list = [...App.sel].map(id => Store.get('auftraege', id)).filter(a => a && a.datum).map(a => ({ ...a, datum: isoDate(addDays(parseDate(a.datum), delta)) }));
  if (!list.length) { toast('Nur eingeplante Aufträge lassen sich um Tage verschieben'); return; }
  Store.putMany('auftraege', list); toast(`${list.length} Aufträge verschoben`);
}
function bulkMoveDialog() {
  const sel = [...App.sel].map(id => Store.get('auftraege', id)).filter(Boolean);
  const first = sel.find(a => a.datum)?.datum || isoDate(App.plan.date);
  const ms = Store.all('maschinen').filter(m => m.aktiv !== false).sort(byPrio);
  const body = `<p style="margin-top:0">${sel.length} Aufträge: ${sel.map(a => esc(kundeName(a.kunde))).join(', ')}</p>
    <div class="two">
      <label class="fld"><span>Datum</span><input class="input" type="date" name="datum" value="${first}" required></label>
      <label class="fld"><span>Startzeit (leer = automatisch andocken)</span><input class="input" type="time" name="zeit" step="900"></label>
    </div>
    <label class="fld"><span>Maschine</span><select class="input" name="maschine"><option value="*">— jeweils unverändert —</option>${ms.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
    <p class="nr">Alle Aufträge kommen auf dieses Datum und docken nacheinander an (ab der Startzeit bzw. am Ende der bestehenden Aufträge).</p>`;
  Dlg.open('Auswahl verschieben', body, saveFooter(), fd => {
    const datum = fd.get('datum'), mid = fd.get('maschine'), z = toMin(fd.get('zeit'));
    const list = sel.map(a => ({ ...a })).sort((x, y) => (x.datum || '9').localeCompare(y.datum || '9') || (startOf(x) ?? 9999) - (startOf(y) ?? 9999));
    const misfit = mid !== '*' && maschine(mid) ? list.filter(a => a.arbeit && !fits(maschine(mid), a.arbeit)) : [];
    if (misfit.length && !confirm(`${misfit.length} Aufträge passen nicht zur Arbeitsart von «${maschine(mid).name}». Trotzdem verschieben?`)) return false;
    const cursor = {}, ids = list.map(a => a.id);
    const frozen = z == null ? [] : [...new Set(list.map(a => mid === '*' ? (a.maschine || '') : mid))].flatMap(m => freezeDay(datum, m, ids));
    list.forEach(a => {
      const newMid = mid === '*' ? (a.maschine || '') : mid;
      if ((a.maschine || '') !== newMid || !a.dauerManuell) { a.dauer = defaultDauer(maschine(newMid), a.flaeche); a.dauerManuell = false; }
      Object.assign(a, { datum, maschine: newMid, status: 'geplant' });
      if (z != null) { const t = cursor[newMid] ?? z; a.zeit = fromMin(Math.min(1425, t)); cursor[newMid] = t + lenOf(a); } else a.zeit = '';
    });
    Store.putMany('auftraege', [...frozen, ...list]); toast(`${list.length} Aufträge verschoben`); return true;
  });
}

/* ================= Maschinen-Priorität ================= */
function moveMachine(id, dir) {
  const list = Store.all('maschinen').sort(byPrio);
  const i = list.findIndex(m => m.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const changed = list.map((m, k) => ({ ...m, prio: k + 1 })).filter((m, k) => Store.get('maschinen', m.id).prio !== k + 1);
  Store.putMany('maschinen', changed);
}

/* ================= Tagesplan als Bild (für den Fahrer) ================= */
function wrapLines(ctx, text, maxW) {
  const out = [];
  String(text || '').split('\n').forEach(par => {
    let line = '';
    par.split(/\s+/).forEach(w => {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    });
    out.push(line);
  });
  return out;
}
function drawDayPlan(mid, d) {
  const m = maschine(mid), { items } = schedule(d, mid);
  const W = 1080, P = 48, TW = 200, cs = getComputedStyle(document.documentElement);
  const F = (w, s) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const green = '#2f6b3a', ink = '#1d211e', muted = '#5c625d', line = '#dedbd3';
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  // Inhalt vorbereiten (zweimal: messen, dann zeichnen)
  const run = draw => {
    let y = 0;
    const text = (t, x, font, color, yy) => { if (draw) { ctx.font = font; ctx.fillStyle = color; ctx.fillText(t, x, yy); } };
    // Kopf
    if (draw) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, cv.height); ctx.fillStyle = green; ctx.fillRect(0, 0, W, 190); }
    text('Tagesplan', P, F('600', 30), '#d9ead9', 62);
    text(m ? m.name : 'Ohne Maschine', P, F('700', 52), '#ffffff', 124);
    text(parseDate(d).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), P, F('500', 30), '#ffffff', 168);
    y = 190 + 36;
    const total = items.reduce((s, it) => s + it.end - it.start, 0);
    ctx.font = F('500', 28);
    text(items.length ? `${items.length} ${items.length > 1 ? 'Aufträge' : 'Auftrag'} · ${fmtNum(total / 60)} h · ${fromMin(items[0].start)} bis ${fromMin(items[items.length - 1].end)} Uhr` : 'Keine Aufträge eingeplant', P, F('500', 28), muted, y + 10);
    y += 44;
    items.forEach((it, idx) => {
      const a = it.a, k = Store.get('kunden', a.kunde) || {};
      const x = P + TW, w = W - x - P;
      const top = y + 24;
      let yy = top + 40;
      const lines = [];
      ctx.font = F('700', 36); lines.push([kundeName(a.kunde), F('700', 36), ink, 46]);
      const adr = [k.adresse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      if (adr) { ctx.font = F('400', 28); wrapLines(ctx, adr, w).forEach(l => lines.push([l, F('400', 28), muted, 38])); }
      if (k.tel) lines.push(['Tel. ' + k.tel, F('400', 28), muted, 38]);
      if (feldOf(a)) { ctx.font = F('600', 28); wrapLines(ctx, 'Feld: ' + feldOf(a), w).forEach(l => lines.push([l, F('600', 28), ink, 38])); }
      ctx.font = F('600', 30);
      const work = [a.arbeit, a.kultur].filter(Boolean).join(' · ') + (a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : '') + (dauerOf(a) ? ` · ${hrs(dauerOf(a))}` : '');
      wrapLines(ctx, work, w).forEach(l => lines.push([l, F('600', 30), green, 42]));
      if (isSpray(a)) {
        if (a.feld) lines.push(['Feld: ' + a.feld, F('600', 28), ink, 40]);
        sprayRows(a).forEach(r => { ctx.font = F('400', 28); wrapLines(ctx, `• ${r.name}: ${r.ha}${r.tot ? '  →  ' + r.tot : ''}`, w).forEach(l => lines.push([l, F('500', 28), ink, 38])); });
      }
      if (a.notiz) { ctx.font = F('italic 400', 28); wrapLines(ctx, a.notiz, w).forEach(l => lines.push([l, F('italic 400', 28), ink, 38])); }
      const hBlock = Math.max(130, 24 + lines.reduce((s, l) => s + l[3], 0) + 20);
      if (draw) {
        ctx.fillStyle = idx % 2 ? '#ffffff' : '#f6f5f1'; ctx.fillRect(0, y, W, hBlock + 24);
        ctx.fillStyle = green; ctx.fillRect(P, top, 6, hBlock - 24);
        ctx.font = F('700', 40); ctx.fillStyle = ink; ctx.fillText(fromMin(it.start), P + 26, top + 40);
        ctx.font = F('500', 30); ctx.fillStyle = muted; ctx.fillText('– ' + fromMin(it.end), P + 26, top + 80);
        lines.forEach(([t, f, c, lh], i) => { ctx.font = f; ctx.fillStyle = c; ctx.fillText(t, x, yy); yy += lh; });
        ctx.fillStyle = line; ctx.fillRect(P, y + hBlock + 23, W - 2 * P, 1);
      }
      y += hBlock + 24;
    });
    y += 30;
    text(`Erstellt ${new Date().toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })} · Lohnarbeit-Planer`, P, F('400', 22), muted, y);
    return y + 36;
  };
  cv.width = W; cv.height = run(false); run(true);
  return cv;
}
function machinePlanDialog(mid, d) {
  const m = maschine(mid); if (!m) return;
  d = d || isoDate(App.plan.date);
  const nav = `<div class="weekhead" style="margin-bottom:10px">
      <button type="button" class="btn small" data-act="mpNav" data-d="-1" data-id="${mid}" data-date="${d}">◀</button>
      <input class="input" type="date" value="${d}" data-in="mpDate" data-id="${mid}" style="width:auto;min-height:34px;padding:4px 8px">
      <button type="button" class="btn small" data-act="mpNav" data-d="1" data-id="${mid}" data-date="${d}">▶</button></div>`;
  showImage(`Tagesplan ${m.name}`, drawDayPlan(mid, d), `Tagesplan_${m.name.replace(/[^\wäöüÄÖÜ.-]+/g, '_')}_${d}.png`, `Tagesplan ${m.name} ${fmtDate(d)}`, nav);
}
async function machinePlanOut(kind) {
  const { cv, fname, title } = Dlg.plan || {}; if (!cv) return;
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if (kind === 'save') { download(fname, blob); return; }
  if (kind === 'copy') { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Bild kopiert – z.B. in WhatsApp einfügen'); } catch { toast('Kopieren nicht möglich – bitte «Bild speichern»'); } return; }
  const file = new File([blob], fname, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title }); } catch (e) { if (e.name !== 'AbortError') toast('Teilen nicht möglich'); } }
  else download(fname, blob);
}

/* ================= Export / Import ================= */
function csvCell(v) { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function exportCsv() {
  const von = $('#exVon').value || '0000', bis = $('#exBis').value || '9999', nurOffen = $('#exArt').value === 'offen', mark = $('#exMark').checked;
  const list = Store.all('auftraege').filter(a => {
    const s = statusOf(a); if (!(s === 'erledigt' || (!nurOffen && s === 'verrechnet'))) return false;
    const d = a.erledigtAm || a.datum || ''; return d >= von && d <= bis;
  }).sort((x, y) => (x.erledigtAm || '').localeCompare(y.erledigtAm || ''));
  if (!list.length) { toast('Keine passenden erledigten Aufträge.'); return; }
  const head = ['Auftrag-Nr', 'Datum', 'Kunden-Nr', 'Kunde', 'Ort Kunde', 'Arbeit', 'Kultur', 'Feld', 'Produkte', 'Art.-Nr', 'Maschine', 'Fläche ha', 'Stunden h', 'Verrechnungsmenge', 'Einheit', 'Ansatz CHF', 'Betrag CHF', 'Status', 'Bemerkung'];
  const rows = [head];
  list.forEach(a => {
    const k = Store.get('kunden', a.kunde) || {}, m = maschine(a.maschine) || {};
    const fl = a.flaecheEff ?? a.flaeche, st = a.stundenEff ?? dauerOf(a);
    const menge = m.einheit === 'h' ? st : m.einheit === 'ha' ? fl : '';
    const betrag = m.ansatz && menge != null && menge !== '' ? Math.round(m.ansatz * menge * 100) / 100 : '';
    const prods = isSpray(a) ? [a.wasser ? `Wasser ${a.wasser} l/ha` : '', ...prodList(a).map(p => `${p.name} ${p.menge ?? ''} ${p.einheit || prodUnit(p.name)}/ha`)].filter(Boolean).join('; ') : '';
    rows.push([a.nr, a.erledigtAm || a.datum, k.nr, k.name, k.ort, a.arbeit, a.kultur, isSpray(a) ? a.feld || '' : '', prods, m.artNr, m.name, fl ?? '', st ?? '', menge ?? '', m.einheit, m.ansatz ?? '', betrag, STATUS[statusOf(a)], a.notiz]);
  });
  const csv = '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
  download(`Lohnarbeiten_${von}_bis_${bis}.csv`, csv, 'text/csv;charset=utf-8');
  if (mark) { list.forEach(a => { if (statusOf(a) === 'erledigt') { a.status = 'verrechnet'; a.upd = Date.now(); } }); Store.save(); Sync.schedule(); App.render(); }
  toast(`${list.length} Aufträge exportiert`);
}
/* ================= Modul Spritzen ================= */
const PROD_EINHEITEN = ['l', 'kg', 'g', 'ml', 'Stk'];
const isSprayName = s => /spritz|pflanzenschutz/i.test(s || '');
const isSpray = a => !!a && isSprayName(a.arbeit);
const sprayArbeit = () => Lists.arbeitsarten().find(isSprayName) || 'Spritzen';
const prodList = a => (a.produkte || []).filter(p => p.name);
const prodNames = a => prodList(a).map(p => p.name);
const r2 = n => Math.round(n * 100) / 100;
// Anzeige in der Planung: nur Produktnamen, ohne Aufwandmengen
function sprayShort(a, { noFeld } = {}) {
  if (!isSpray(a)) return '';
  const parts = [];
  if (a.feld && !noFeld) parts.push(`Feld ${esc(a.feld)}`);
  if (prodNames(a).length) parts.push('🧪 ' + prodNames(a).map(esc).join(', '));
  return parts.length ? `<div class="prods">${parts.join(' · ')}</div>` : '';
}
// Detail mit Mengen (Modul Spritzen, Tagesplan-Bild)
function sprayRows(a) {
  const fl = a.flaeche || 0, rows = [];
  if (a.wasser) rows.push({ name: 'Wasser', ha: `${fmtNum(a.wasser)} l/ha`, tot: fl ? `${fmtNum(r2(a.wasser * fl))} l` : '' });
  prodList(a).forEach(p => { const u = p.einheit || prodUnit(p.name); rows.push({ name: p.name, ha: p.menge != null ? `${fmtNum(p.menge)} ${u}/ha` : '–', tot: fl && p.menge != null ? `${fmtNum(r2(p.menge * fl))} ${u}` : '' }); });
  return rows;
}
function sprayTable(a) {
  const rows = sprayRows(a); if (!rows.length) return '';
  return `<table class="stab"><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.ha)}</td><td><b>${esc(r.tot)}</b></td></tr>`).join('')}</tbody></table>`;
}

/* ---------- Auftragsdialog: Bereich Spritzen ---------- */

/* ---------- Kleines Zweitfenster (über einem offenen Dialog) ---------- */
function smallDialog(title, body, okLabel, onSubmit) {
  let d2 = $('#dlg2');
  if (!d2) { d2 = document.createElement('dialog'); d2.id = 'dlg2'; document.body.appendChild(d2); }
  d2.innerHTML = `<form id="dlg2Form"><div class="dh"><h2>${title}</h2><button type="button" class="x" data-k2="close" aria-label="Schliessen">×</button></div>
    <div class="db">${body}</div>
    <div class="df"><span class="spacer"></span><button type="button" class="btn" data-k2="close">Abbrechen</button><button type="submit" class="btn primary">${okLabel}</button></div></form>`;
  const f2 = $('#dlg2Form');
  f2.addEventListener('click', e => { if (e.target.closest('[data-k2="close"]')) d2.close(); });
  f2.addEventListener('submit', e => { e.preventDefault(); if (onSubmit(new FormData(f2)) !== false) d2.close(); });
  d2.showModal();
  const first = f2.querySelector('input'); if (first && matchMedia('(pointer:fine)').matches) first.focus();
}

/* ---------- Ansicht «Spritzen» ---------- */
function sprayDays() {
  const S = App.spray, out = [];
  let d = parseDate(S.von); const end = parseDate(S.bis < S.von ? S.von : S.bis);
  while (d <= end && out.length < 62) { out.push(isoDate(d)); d = addDays(d, 1); }
  return out;
}
function sprayNeed(days) { // { prods: [{name, einheit, perDay:{d:n}, tot}], wasser:{perDay,tot}, flaeche:{perDay,tot}, missing }
  const prods = new Map(), wasser = { perDay: {}, tot: 0 }, flaeche = { perDay: {}, tot: 0 }; let missing = 0;
  Store.all('auftraege').filter(a => isSpray(a) && isOpen(a) && a.datum && days.includes(a.datum)).forEach(a => {
    const fl = a.flaeche; if (!fl) { missing++; return; }
    flaeche.perDay[a.datum] = (flaeche.perDay[a.datum] || 0) + fl; flaeche.tot += fl;
    if (a.wasser) { const w = a.wasser * fl; wasser.perDay[a.datum] = (wasser.perDay[a.datum] || 0) + w; wasser.tot += w; }
    prodList(a).forEach(p => {
      if (p.menge == null) return;
      const u = p.einheit || prodUnit(p.name), key = p.name + '|' + u, v = p.menge * fl;
      const e = prods.get(key) || { name: p.name, einheit: u, perDay: {}, tot: 0 };
      e.perDay[a.datum] = (e.perDay[a.datum] || 0) + v; e.tot += v; prods.set(key, e);
    });
  });
  const order = Lists.produkte().map(p => p.name);
  const list = [...prods.values()].sort((x, y) => ((order.indexOf(x.name) + 1 || 999) - (order.indexOf(y.name) + 1 || 999)) || x.name.localeCompare(y.name, 'de'));
  return { prods: list, wasser, flaeche, missing };
}
function sprayCard(a) {
  const s = statusOf(a), m = maschine(a.maschine);
  return `<article class="card" data-act="editOrder" data-id="${a.id}">
    <div class="row1"><div class="title">${a.datum ? `<span class="tmx">${timeRange(a)}</span> ` : ''}${esc(kundeName(a.kunde))}</div><span class="badge ${s}">${STATUS[s]}</span></div>
    <div class="sub">${a.feld ? `Feld <b>${esc(a.feld)}</b> · ` : ''}${a.kultur ? `<span class="kultur">${esc(a.kultur)}</span> · ` : ''}${a.flaeche ? fmtNum(a.flaeche) + ' ha' : '<span style="color:var(--warn)">Fläche fehlt</span>'}</div>
    ${sprayTable(a) || '<div class="nr" style="margin-top:6px">Noch keine Produkte erfasst.</div>'}
    ${a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}
    <div class="meta">${a.datum ? (m ? `<span class="chip">${esc(m.name)}</span>` : '<span class="chip warn">keine Maschine</span>') : `<span class="chip ${wishLate(a) ? 'warn' : ''}">${wishTxt(a)}</span>`}
      <span class="nr" style="margin-left:auto">${esc(a.nr || '')}</span></div>
    ${!a.datum ? `<div class="actions"><button class="btn small primary" data-act="planOrder" data-id="${a.id}">Einplanen</button></div>` : ''}
  </article>`;
}
function sprayView() {
  return {
    toolbar() {
      return `<h1>Spritzen</h1>
        <button class="btn primary" data-act="newSpray">＋ Spritzauftrag</button>`;
    },
    content() {
      const t = App.spray.tab;
      const body = t === 'journal' ? journalContent() : t === 'abrechnung' ? abrechnungContent() : t === 'nachweis' ? nachweisContent() : t === 'stamm' ? stammContent() : this.planContent();
      return spTabs() + body;
    },
    planContent() {
      const S = App.spray, days = sprayDays(), sel = days.filter(d => !S.off.has(d));
      const need = sprayNeed(sel), showDays = sel.length > 1 && sel.length <= 7;
      const dayHead = d => fmtDate(d, { weekday: 'short', day: '2-digit', month: '2-digit' });
      const cell = (o, d, u) => o.perDay[d] ? `${fmtNum(r2(o.perDay[d]))}` : '';
      const table = need.prods.length || need.wasser.tot
        ? `<div class="tscroll"><table class="need"><thead><tr><th>Produkt</th>${showDays ? sel.map(d => `<th>${dayHead(d)}</th>`).join('') : ''}<th>Total</th><th></th></tr></thead><tbody>
            ${need.prods.map(p => `<tr><td>${esc(p.name)}</td>${showDays ? sel.map(d => `<td>${cell(p, d)}</td>`).join('') : ''}<td><b>${fmtNum(r2(p.tot))}</b></td><td>${esc(p.einheit)}</td></tr>`).join('')}
            ${need.wasser.tot ? `<tr class="water"><td>Wasser</td>${showDays ? sel.map(d => `<td>${cell(need.wasser, d)}</td>`).join('') : ''}<td><b>${fmtNum(r2(need.wasser.tot))}</b></td><td>l</td></tr>` : ''}
            <tr class="area"><td>Fläche</td>${showDays ? sel.map(d => `<td>${cell(need.flaeche, d)}</td>`).join('') : ''}<td><b>${fmtNum(r2(need.flaeche.tot))}</b></td><td>ha</td></tr>
          </tbody></table></div>`
        : '<p class="nr">Für die ausgewählten Tage sind keine Spritzaufträge mit Produkten eingeplant.</p>';
      const planned = Store.all('auftraege').filter(a => isSpray(a) && a.datum && sel.includes(a.datum) && statusOf(a) !== 'verrechnet')
        .sort((x, y) => x.datum.localeCompare(y.datum) || (startOf(x) ?? 0) - (startOf(y) ?? 0));
      const unpl = Store.all('auftraege').filter(a => isSpray(a) && isOpen(a) && !a.datum).sort((x, y) => (x.wunsch || '9999').localeCompare(y.wunsch || '9999'));
      const noMachine = !Store.all('maschinen').some(m => m.aktiv !== false && (m.arbeitsarten || []).some(isSprayName));
      const groups = sel.filter(d => planned.some(a => a.datum === d)).map(d => {
        const list = planned.filter(a => a.datum === d), fl = list.reduce((s, a) => s + (a.flaeche || 0), 0);
        return `<div class="section-h">${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })} · ${list.length} ${list.length > 1 ? 'Aufträge' : 'Auftrag'} · ${fmtNum(r2(fl))} ha</div>
          <div class="list grid">${list.map(sprayCard).join('')}</div>`;
      }).join('');
      return `${noMachine ? '<div class="panel hintp">Tipp: Lege unter <b>Maschinen</b> eine Feldspritze mit der Arbeitsart «Spritzen» an – dann kannst du Spritzaufträge in der Planung einplanen.</div>' : ''}
        <div class="cols"><div>
          <div class="panel"><h2>Tage auswählen</h2>
            <div class="two"><label class="fld"><span>Von</span><input class="input" type="date" value="${S.von}" data-in="spVon"></label>
              <label class="fld"><span>Bis</span><input class="input" type="date" value="${S.bis}" data-in="spBis"></label></div>
            <div class="seg" style="margin-bottom:10px">${[['heute', 'Heute'], ['morgen', 'Morgen'], ['woche', 'Diese Woche'], ['next', 'Nächste Woche']].map(([k, l]) => `<button type="button" data-act="spPreset" data-v="${k}">${l}</button>`).join('')}</div>
            ${days.length > 1 ? `<div class="chips daychips">${days.map(d => `<label><input type="checkbox" data-in="spDay" value="${d}" ${S.off.has(d) ? '' : 'checked'}><span>${fmtDate(d, { weekday: 'short', day: 'numeric', month: 'numeric' })}</span></label>`).join('')}</div>` : ''}
          </div>
          <div class="panel"><h2>Produktbedarf</h2>
            <p>${sel.length} ${sel.length === 1 ? 'Tag' : 'Tage'} · eingeplante, noch offene Spritzaufträge</p>
            ${table}
            ${need.missing ? `<p style="color:var(--warn)">⚠ ${need.missing} ${need.missing > 1 ? 'Aufträge ohne Fläche wurden' : 'Auftrag ohne Fläche wurde'} nicht mitgerechnet.</p>` : ''}
            ${need.prods.length || need.wasser.tot ? `<div class="btns"><button class="btn" data-act="spImg">Als Bild teilen</button><button class="btn" data-act="spCsv">CSV</button></div>` : ''}
          </div>
        </div><div>
          ${groups || '<div class="panel"><p>Keine Spritzaufträge an den ausgewählten Tagen eingeplant.</p></div>'}
          ${unpl.length ? `<div class="section-h">Noch nicht eingeplant (${unpl.length})</div><div class="list grid">${unpl.map(sprayCard).join('')}</div>` : ''}
        </div></div>`;
    }
  };
}
function sprayPreset(k) {
  const t = new Date(); t.setHours(0, 0, 0, 0); let von = t, bis = t;
  if (k === 'morgen') { von = bis = addDays(t, 1); }
  if (k === 'woche') { von = mondayOf(t); bis = addDays(von, 6); }
  if (k === 'next') { von = addDays(mondayOf(t), 7); bis = addDays(von, 6); }
  App.spray.von = isoDate(von); App.spray.bis = isoDate(bis); App.spray.off.clear(); App.render();
}
function sprayNeedTable() {
  const sel = sprayDays().filter(d => !App.spray.off.has(d)), need = sprayNeed(sel);
  const rows = need.prods.map(p => [p.name, fmtNum(r2(p.tot)), p.einheit]);
  if (need.wasser.tot) rows.push(['Wasser', fmtNum(r2(need.wasser.tot)), 'l']);
  rows.push(['Fläche', fmtNum(r2(need.flaeche.tot)), 'ha']);
  const range = sel.length === 1 ? fmtDate(sel[0], { weekday: 'long', day: 'numeric', month: 'long' }) : `${fmtDate(sel[0], { day: 'numeric', month: 'short' })} – ${fmtDate(sel[sel.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })} (${sel.length} Tage)`;
  return { sel, need, rows, range };
}
function sprayCsv() {
  const { sel, need } = sprayNeedTable();
  const head = ['Produkt', ...sel, 'Total', 'Einheit'];
  const line = (n, o, u) => [n, ...sel.map(d => o.perDay[d] ? r2(o.perDay[d]) : ''), r2(o.tot), u];
  const rows = [head, ...need.prods.map(p => line(p.name, p, p.einheit))];
  if (need.wasser.tot) rows.push(line('Wasser', need.wasser, 'l'));
  rows.push(line('Fläche', need.flaeche, 'ha'));
  download(`Produktbedarf_${sel[0]}_bis_${sel[sel.length - 1]}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
function sprayImage() {
  const { rows, range, sel } = sprayNeedTable();
  const W = 1080, P = 48, F = (w, s) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  cv.width = W; cv.height = 190 + 40 + rows.length * 64 + 90;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, cv.height);
  ctx.fillStyle = '#2f6b3a'; ctx.fillRect(0, 0, W, 190);
  ctx.font = F('600', 30); ctx.fillStyle = '#d9ead9'; ctx.fillText('Produktbedarf Spritzen', P, 62);
  ctx.font = F('700', 44); ctx.fillStyle = '#fff'; ctx.fillText(range, P, 128);
  let y = 230;
  rows.forEach(([n, v, u], i) => {
    if (i % 2 === 0) { ctx.fillStyle = '#f6f5f1'; ctx.fillRect(0, y - 44, W, 64); }
    const total = n === 'Fläche';
    ctx.font = F(total ? '600' : '500', 34); ctx.fillStyle = total ? '#5c625d' : '#1d211e'; ctx.fillText(n, P, y);
    ctx.font = F('700', 36); ctx.textAlign = 'right'; ctx.fillStyle = '#1d211e'; ctx.fillText(v, W - P - 110, y);
    ctx.font = F('500', 32); ctx.textAlign = 'left'; ctx.fillStyle = '#5c625d'; ctx.fillText(u, W - P - 90, y);
    y += 64;
  });
  ctx.font = F('400', 22); ctx.fillStyle = '#5c625d'; ctx.fillText(`Erstellt ${new Date().toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })} · Lohnarbeit-Planer`, P, y + 30);
  showImage('Produktbedarf', cv, `Produktbedarf_${sel[0]}_bis_${sel[sel.length - 1]}.png`, `Produktbedarf ${range}`);
}
function showImage(title, cv, fname, shareTitle, topHtml = '') {
  const canShare = !!(navigator.canShare && navigator.share);
  const body = `${topHtml}<img class="planimg" alt="${esc(title)}" src="${cv.toDataURL('image/png')}">`;
  const footer = `<span class="spacer"></span>
    ${canShare ? `<button type="button" class="btn primary" data-act="mpShare">Teilen…</button>` : ''}
    <button type="button" class="btn ${canShare ? '' : 'primary'}" data-act="mpSave">Bild speichern</button>
    ${navigator.clipboard && window.ClipboardItem ? '<button type="button" class="btn" data-act="mpCopy">Kopieren</button>' : ''}`;
  Dlg.open(esc(title), body, footer, () => true);
  Dlg.plan = { cv, fname, title: shareTitle || title };
}

/* ---------- Langes Drücken auf freie Stelle: passende, nicht eingeplante Aufträge ---------- */
function pickerDialog(d, mid, minute, all = false) {
  const m = maschine(mid);
  const list = Store.all('auftraege').filter(a => isOpen(a) && !a.datum && (all || !m || fits(m, a.arbeit)))
    .sort((x, y) => (x.wunsch || '9999').localeCompare(y.wunsch || '9999') || (x.nr || '').localeCompare(y.nr || ''));
  const hidden = all ? 0 : Store.all('auftraege').filter(a => isOpen(a) && !a.datum).length - list.length;
  const where = `${fmtDate(d, { weekday: 'short', day: '2-digit', month: '2-digit' })}${minute != null ? ' · ab ' + fromMin(Math.round(minute / 15) * 15) : ''} · ${esc(m ? m.name : 'ohne Maschine')}`;
  const body = `<p style="margin-top:0" class="nr">${where}${m && !all && (m.arbeitsarten || []).length ? ` · nur ${esc(m.arbeitsarten.join(', '))}` : ''}</p>
    ${list.length ? `<div class="rows">${list.map(a => `<div class="rowi" data-act="pickPlace" data-id="${a.id}">
        <div class="grow"><div class="t">${esc(kundeName(a.kunde))}</div>
          <div class="s">${artKultur(a)}${a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : ''}${(defaultDauer(m, a.flaeche) ?? a.dauer) ? ` · ${hrs(defaultDauer(m, a.flaeche) ?? a.dauer)}` : ''}</div>
          ${sprayShort(a)}${a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}</div>
        <span class="chip ${wishLate(a) ? 'warn' : ''}">${a.wunsch ? fmtDate(a.wunsch) : 'kein Wunsch'}</span></div>`).join('')}</div>`
      : `<div class="empty" style="padding:20px">Keine passenden Aufträge offen.</div>`}
    <div class="links" style="margin-top:12px">${hidden > 0 ? `<a href="#" data-act="pickAll">Alle ${hidden + list.length} offenen anzeigen</a>` : ''}<a href="#" data-act="pickNew">＋ Neuer Auftrag hier</a></div>`;
  Dlg.open('Auftrag einsetzen', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button>`, () => true);
  Dlg.pick = { d, mid, minute };
}

/* ================= Spritzen: Erfassung wie ErfassungPS, Stammdaten, Abrechnung, ÖLN-Nachweis ================= */
const round05 = x => Math.round((x || 0) / 0.05) * 0.05;
const chf = x => (Math.round((x || 0) * 100) / 100).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const prodById = id => id ? Store.get('produkte', id) : null;
const prodByName = n => Store.all('produkte').find(p => p.name === n) || null;
const prodOf = p => prodById(p.pid) || prodByName(p.name);
const prodUnit = name => (prodByName(name) || {}).einheit || 'l';
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'de');
const kundeOf = a => Store.get('kunden', a.kunde) || {};
// Erntejahr: ab 1. September zählt das Folgejahr
const ernteDefault = iso => { if (!iso) return null; const d = parseDate(iso), y = d.getFullYear(); return d.getMonth() >= 8 ? y + 1 : y; };
const ernteOf = a => a.erntejahr || ernteDefault(a.erledigtAm || a.datum, a.kultur);
const flOf = a => a.flaecheEff ?? a.flaeche ?? 0;
const sprayOrders = () => Store.all('auftraege').filter(isSpray);

/* ---------- Produktzeilen im Auftrag ---------- */
function prodOptions(curPid, curName) {
  const list = Store.all('produkte').filter(p => p.aktuell !== false).sort(byName);
  const cur = curPid ? prodById(curPid) : (curName ? prodByName(curName) : null);
  const opts = list.map(p => `<option value="${p.id}" ${cur && cur.id === p.id ? 'selected' : ''}>${esc(p.name)}${p.zulassung ? ' – ' + esc(p.zulassung) : ''}</option>`);
  if (cur && cur.aktuell === false) opts.unshift(`<option value="${cur.id}" selected>${esc(cur.name)} (nicht aktuell)</option>`);
  else if (!cur && curName) opts.unshift(`<option value="n:${esc(curName)}" selected>${esc(curName)}</option>`);
  return opts.join('');
}
const prodRow = (p = {}) => `<div class="prow"><select class="input" name="pname"><option value="">— Produkt —</option>${prodOptions(p.pid, p.name)}</select>
  <input class="input" name="pmenge" inputmode="decimal" value="${p.menge ?? ''}" placeholder="Menge"><span class="u">${esc(p.name ? (p.einheit || prodUnit(p.name)) : 'l')}/ha</span>
  <label class="noeln" title="Nicht ÖLN-konform"><input type="checkbox" name="poeln" ${p.nichtOeln ? 'checked' : ''}><span>⚠ÖLN</span></label>
  <button type="button" class="x" data-act="prodDel" aria-label="Entfernen">×</button></div>`;
const optList = (list, cur) => (cur && !list.includes(cur) ? [cur, ...list] : list).map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
function parzOptions(kid, cur) {
  const list = Store.all('parzellen').filter(p => p.kunde === kid && (p.aktiv !== false || p.id === cur)).sort(byName);
  return `<option value="">— keine —</option>` + list.map(p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}${p.flaeche ? ` · ${fmtNum(p.flaeche)} ha` : ''}${p.kultur ? ` · ${esc(p.kultur)}` : ''}</option>`).join('');
}
function sprayBox(a) {
  const ps = prodList(a);
  return `<div class="box spraybox" id="sprayBox" ${isSpray(a) ? '' : 'hidden'}>
    <h4>🧪 Spritzen</h4>
    <div class="two">
      <label class="fld"><span>Parzelle</span><div class="withbtn"><select class="input" name="parzelle">${parzOptions(a.kunde, a.parzelle)}</select>
        <button type="button" class="btn" data-act="parzNew" title="Neue Parzelle" aria-label="Neue Parzelle">＋</button></div></label>
      <label class="fld"><span>Feld (Bezeichnung)</span><input class="input" name="feld" value="${esc(a.feld || '')}" placeholder="z.B. Grossacker"></label>
    </div>
    <div class="two">
      <label class="fld"><span>Wassermenge (l/ha)</span><input class="input" name="wasser" inputmode="decimal" value="${a.wasser ?? ''}" placeholder="z.B. 200"></label>
      <label class="fld"><span>Stadium</span><input class="input" name="stadium" value="${esc(a.stadium || '')}" placeholder="z.B. BBCH 31"></label>
    </div>
    <div class="three">
      <label class="fld"><span>Düse</span><select class="input" name="duese"><option value="">—</option>${optList(Lists.duesen(), a.duese)}</select></label>
      <label class="fld"><span>Traktor</span><select class="input" name="traktor"><option value="">—</option>${optList(Lists.traktoren(), a.traktor)}</select></label>
      <label class="fld"><span>Erntejahr</span><input class="input" name="erntejahr" inputmode="numeric" value="${a.erntejahr ?? ernteDefault(a.datum || a.wunsch || todayIso()) ?? ''}" data-auto="${a.erntejahr == null ? 1 : 0}"></label>
    </div>
    <div class="checks"><label><input type="checkbox" name="nichtOeln" ${a.nichtOeln ? 'checked' : ''}> Nicht ÖLN-konform</label></div>
    <div class="fld" style="margin:10px 0 6px"><span>Produkte und Aufwandmenge pro ha</span></div>
    <div id="prodRows">${(ps.length ? ps : [{}]).map(prodRow).join('')}</div>
    <div class="links" style="margin-top:4px"><a href="#" data-act="prodAdd">＋ weiteres Produkt</a><a href="#" data-act="prodNew">Neues Produkt erfassen</a></div>
    <div id="sprayTot" class="sprtot"></div>
  </div>`;
}
function readSpray(f) {
  const produkte = $$('.prow', f).map(r => {
    const v = r.querySelector('select').value; if (!v) return null;
    const p = v.startsWith('n:') ? null : prodById(v), name = p ? p.name : v.slice(2);
    return { pid: p ? p.id : '', name, menge: num(r.querySelector('input[name="pmenge"]').value), einheit: p ? p.einheit : prodUnit(name), nichtOeln: r.querySelector('input[name="poeln"]').checked };
  }).filter(Boolean);
  const ej = num(f.erntejahr.value);
  return {
    parzelle: f.parzelle.value, feld: f.feld.value.trim(), wasser: num(f.wasser.value), stadium: f.stadium.value.trim(),
    duese: f.duese.value, traktor: f.traktor.value, nichtOeln: f.nichtOeln.checked,
    erntejahr: ej || ernteDefault(f.datum.value || f.wunsch.value || todayIso(), f.kultur.value), produkte
  };
}
function wireSpray(f) {
  const box = $('#sprayBox', f); if (!box) return;
  const upd = () => {
    box.hidden = !isSprayName(f.arbeit.value);
    $$('.prow', f).forEach(r => { const v = r.querySelector('select').value, p = v && !v.startsWith('n:') ? prodById(v) : null; r.querySelector('.u').textContent = (p ? p.einheit : v ? prodUnit(v.slice(2)) : 'l') + '/ha'; });
    const s = readSpray(f), fl = num(f.flaeche.value);
    const rows = sprayRows({ arbeit: 'Spritzen', flaeche: fl, ...s }).filter(r => r.tot);
    $('#sprayTot', f).innerHTML = fl && rows.length ? `<b>Bedarf für ${fmtNum(fl)} ha:</b> ${rows.map(r => `${esc(r.name)} ${esc(r.tot)}`).join(' · ')}` : (s.produkte.length ? '<span class="nr">Fläche eintragen, um den Bedarf zu berechnen.</span>' : '');
    const ej = ernteDefault(f.datum.value || f.wunsch.value || todayIso());
    if (f.erntejahr.dataset.auto === '1') f.erntejahr.value = ej ?? ''; else f.erntejahr.placeholder = ej ?? '';
  };
  const refreshParz = () => { const k = findKunde(f.kunde.value); const cur = f.parzelle.value; f.parzelle.innerHTML = parzOptions(k ? k.id : '', cur); };
  f.arbeit.addEventListener('change', upd);
  f.kunde.addEventListener('input', refreshParz);
  f.parzelle.addEventListener('change', () => {
    const p = Store.get('parzellen', f.parzelle.value); if (!p) return;
    f.feld.value = p.name;
    if (p.kultur && !f.kultur.value) { if (![...f.kultur.options].some(o => o.value === p.kultur)) f.kultur.insertAdjacentHTML('beforeend', `<option>${esc(p.kultur)}</option>`); f.kultur.value = p.kultur; }
    if (p.flaeche && !f.flaeche.value) { f.flaeche.value = p.flaeche; f.flaeche.dispatchEvent(new Event('input', { bubbles: true })); }
    upd();
  });
  f.erntejahr.addEventListener('input', () => { f.erntejahr.dataset.auto = f.erntejahr.value.trim() ? '0' : '1'; });
  f.addEventListener('input', e => { if (e.target.closest('#sprayBox') || e.target.name === 'flaeche') upd(); });
  f.addEventListener('change', e => { if (['pname', 'kultur', 'datum', 'wunsch', 'erledigtAm'].includes(e.target.name)) upd(); });
  f._sprayUpd = upd; f._refreshParz = refreshParz; upd();
}

/* ---------- Produkte ---------- */
function productDialog(id, { fromOrder } = {}) {
  const p = id ? { ...Store.get('produkte', id) } : { id: uid(), einheit: 'l', aktuell: true, preis: 0 };
  const units = [...new Set([...PROD_EINHEITEN, p.einheit].filter(Boolean))];
  const body = `<label class="fld"><span>Produktname *</span><input class="input" name="name" value="${esc(p.name || '')}" required></label>
    <label class="fld"><span>Zulassungs-Nr. / Art</span><input class="input" name="zulassung" value="${esc(p.zulassung || '')}" placeholder="z.B. HZ, W-7294"></label>
    <div class="three">
      <label class="fld"><span>Einheit</span><select class="input" name="einheit">${units.map(u => `<option ${u === p.einheit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
      <label class="fld"><span>Preis CHF / Einheit</span><input class="input" name="preis" inputmode="decimal" value="${p.preis ?? ''}"></label>
      <label class="fld"><span>Inventar</span><input class="input" name="inventar" inputmode="decimal" value="${p.inventar ?? ''}"></label>
    </div>
    ${id ? `<label class="fld"><span>Änderungen von Name, Zulassung und Preis gelten ab</span><input class="input" type="date" name="ab" value="${todayIso()}" style="max-width:220px"></label>
    ${prodNext(p) ? `<p class="hintp panel">Geplante Änderung ab ${fmtDate(prodNext(p).ab, { day: '2-digit', month: '2-digit', year: 'numeric' })}: ${esc(prodNext(p).name)} · CHF ${chf(prodNext(p).preis)}</p>` : ''}` : ''}
    <label class="tog"><input type="checkbox" name="aktuell" ${p.aktuell !== false ? 'checked' : ''}> Aktuell (in der Auswahl anzeigen)</label>
    <div id="verlauf">${id ? verlaufHtml(p) : ''}</div>`;
  const save = fd => {
    const name = String(fd.get('name') || '').trim(); if (!name) return false;
    if (Store.all('produkte').some(x => x.id !== p.id && norm(x.name) === norm(name)) && !confirm(`«${name}» gibt es schon. Trotzdem speichern?`)) return false;
    const old = p.name, zulassung = String(fd.get('zulassung') || '').trim(), preis = num(fd.get('preis')) ?? 0;
    let q = { ...p, einheit: fd.get('einheit'), inventar: num(fd.get('inventar')), aktuell: !!fd.get('aktuell') };
    if (!id) Object.assign(q, { name, zulassung, preis, geaendert: todayIso() });
    else if (name !== p.name || zulassung !== (p.zulassung || '') || Math.abs(preis - (p.preis || 0)) > 0.0001 || p._vchanged) {
      // Änderung mit Gültigkeitsdatum: frühere Aufträge behalten Preis und Namen von damals
      const ab = fd.get('ab') || todayIso();
      q = name !== p.name || zulassung !== (p.zulassung || '') || Math.abs(preis - (p.preis || 0)) > 0.0001 ? prodSetFrom(q, ab, { name, zulassung, preis }) : q;
      if (old !== q.name || prodAt(q, ab).name !== old) prodRenameOrders([{ p: q, ab: ab < todayIso() ? ab : VERLAUF_START, oldName: old }]);
    }
    delete q._vchanged;
    if (q.inventar !== p.inventar) q.inventarAm = todayIso();
    Store.put('produkte', q, { silent: !!fromOrder });
    return q;
  };
  if (fromOrder) {
    smallDialog('Neues Produkt', body, 'Produkt speichern', fd => {
      const r = save(fd); if (!r) return false;
      const f = Dlg.form;
      $$('select[name="pname"]', f).forEach(s => { const v = s.value; s.innerHTML = `<option value="">— Produkt —</option>${prodOptions(v.startsWith('n:') ? '' : v, v.startsWith('n:') ? v.slice(2) : '')}`; s.value = v; });
      const empty = $$('select[name="pname"]', f).find(s => !s.value);
      if (empty) empty.value = r.id; else $('#prodRows', f).insertAdjacentHTML('beforeend', prodRow({ pid: r.id, name: r.name }));
      f._sprayUpd && f._sprayUpd(); toast('Produkt erfasst');
    });
    return;
  }
  Dlg.open(id ? 'Produkt bearbeiten' : 'Neues Produkt', body,
    saveFooter(id ? `<button type="button" class="btn danger" data-act="prodDelete" data-id="${p.id}">Löschen</button>` : ''), fd => !!save(fd));
  // Verlaufseintrag löschen (wird beim Speichern übernommen)
  $('#verlauf', Dlg.form)?.addEventListener('click', e => {
    const b = e.target.closest('[data-vdel]'); if (!b) return;
    if (!confirm('Diesen Eintrag aus dem Verlauf löschen?')) return;
    p.verlauf = (p.verlauf || []).filter(x => x.ab !== b.dataset.vdel);
    const cur = prodAt(p, todayIso()); Object.assign(p, { name: cur.name, zulassung: cur.zulassung, preis: cur.preis, _vchanged: true });
    const f = Dlg.form; f.name.value = p.name; f.zulassung.value = p.zulassung || ''; f.preis.value = p.preis ?? '';
    $('#verlauf', f).innerHTML = verlaufHtml(p);
  });
}
function newProductDialog() { productDialog(null, { fromOrder: true }); }
function productsDialog() { App.spray.tab = 'stamm'; App.spray.stamm = 'produkte'; App.go('spritzen'); }

/* ---------- Parzellen ---------- */
function parzelleDialog(id, { kunde, fromOrder } = {}) {
  const p = id ? { ...Store.get('parzellen', id) } : { id: uid(), kunde: kunde || '', aktiv: true };
  const ks = Store.all('kunden').filter(k => k.aktiv !== false || k.id === p.kunde).sort(byName);
  const body = `<label class="fld"><span>Kunde *</span><select class="input" name="kunde" required><option value="">—</option>${ks.map(k => `<option value="${k.id}" ${k.id === p.kunde ? 'selected' : ''}>${esc(kundeLabel(k))}</option>`).join('')}</select></label>
    <label class="fld"><span>Parzellenname *</span><input class="input" name="name" value="${esc(p.name || '')}" required></label>
    <div class="two">
      <label class="fld"><span>Kultur</span><select class="input" name="kultur"><option value="">—</option>${optList(Lists.kulturen(), p.kultur)}</select></label>
      <label class="fld"><span>Fläche (ha)</span><input class="input" name="flaeche" inputmode="decimal" value="${p.flaeche ?? ''}"></label>
    </div>
    <label class="fld" id="pfFeld"><span>Feld aus der Kundenkartei</span><select class="input" name="feldId">${feldOptions(p.kunde, p.feldId)}</select></label>
    <label class="tog"><input type="checkbox" name="aktiv" ${p.aktiv !== false ? 'checked' : ''}> Aktiv (in der Auswahl anzeigen)</label>`;
  const save = fd => {
    Object.assign(p, { feldId: fd.get('feldId') || '', kunde: fd.get('kunde'), name: String(fd.get('name') || '').trim(), kultur: fd.get('kultur'), flaeche: num(fd.get('flaeche')), aktiv: !!fd.get('aktiv') });
    if (!p.kunde || !p.name) { toast('Kunde und Name angeben'); return false; }
    Store.put('parzellen', p, { silent: !!fromOrder }); return p;
  };
  if (fromOrder) {
    smallDialog('Neue Parzelle', body, 'Parzelle speichern', fd => {
      const r = save(fd); if (!r) return false;
      const f = Dlg.form; f._refreshParz && f._refreshParz(); f.parzelle.value = r.id; f.parzelle.dispatchEvent(new Event('change')); toast('Parzelle erfasst');
    });
    return;
  }
  Dlg.open(id ? 'Parzelle bearbeiten' : 'Neue Parzelle', body,
    saveFooter(id ? `<button type="button" class="btn danger" data-act="parzDelete" data-id="${p.id}">Löschen</button>` : ''), fd => !!save(fd));
  const f = Dlg.form; f.kunde.addEventListener('change', () => { f.feldId.innerHTML = feldOptions(f.kunde.value, ''); });
}

/* ---------- Unteransichten des Moduls ---------- */
const SP_TABS = [['plan', 'Planung'], ['journal', 'Journal'], ['abrechnung', 'Abrechnung'], ['nachweis', 'ÖLN-Nachweis'], ['stamm', 'Stammdaten']];
function spTabs() { return `<div class="seg sptabs">${SP_TABS.map(([k, l]) => `<button type="button" data-act="spTab" data-v="${k}" class="${App.spray.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`; }
const yearsOf = () => [...new Set(sprayOrders().map(ernteOf).filter(Boolean))].sort((a, b) => b - a);

// Journal: alle Spritzaufträge durchsuchen

// Abrechnung pro Kunde und Zeitraum (Formeln wie ErfassungPS)

// ÖLN-Nachweis / Spritzprotokoll
// Briefkopf (Logo mit Adresse) oben auf der ersten Seite jedes Berichts
const LETTERHEAD = '<img class="lhead" src="logo.jpg" alt="Indermühle Lohnarbeiten · Maschinenvermietung">';
function printHtml(title, html, { noTitle } = {}) {
  let pa = $('#printArea'); if (!pa) { pa = document.createElement('div'); pa.id = 'printArea'; document.body.appendChild(pa); }
  pa.innerHTML = `${noTitle ? '' : `<h1 class="ptitle">${esc(title)}</h1>`}${html}<p class="pfoot">Erstellt ${new Date().toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })} · Lohnarbeit-Planer v${APP_VERSION}</p>`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // erst drucken, wenn das Logo geladen ist
  const imgs = [...pa.querySelectorAll('img')].filter(i => !i.complete);
  Promise.race([Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))), new Promise(r => setTimeout(r, 3000))])
    .then(() => setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50));
}

// Stammdaten
function stammContent() {
  const S = App.spray; if (S.stamm === 'import') S.stamm = 'produkte'; const sub = S.stamm;
  const segs = `<div class="seg" style="margin-bottom:12px">${[['produkte', 'Produkte'], ['inventar', 'Inventar'], ['parzellen', 'Parzellen'], ['geraete', 'Düsen & Traktoren']].map(([k, l]) => `<button type="button" data-act="spStamm" data-v="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (sub === 'inventar') return segs + invStockContent();
  if (sub === 'parzellen') {
    const list = Store.all('parzellen').filter(p => (!S.pk || p.kunde === S.pk) && (S.pall || p.aktiv !== false)).sort((a, b) => kundeName(a.kunde).localeCompare(kundeName(b.kunde), 'de') || byName(a, b));
    return segs + `<div class="filters"><select class="input" data-combo data-in="spPk" style="width:auto;min-width:200px"><option value="">Alle Kunden</option>${Store.all('kunden').filter(k => k.aktiv !== false || k.id === S.pk).sort(byName).map(k => `<option value="${k.id}" ${k.id === S.pk ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
        <label class="tog"><input type="checkbox" data-in="spPall" ${S.pall ? 'checked' : ''}> auch inaktive</label><button class="btn primary" data-act="parzAdd">＋ Parzelle</button></div>
      <div class="rows">${list.map(p => `<div class="rowi ${p.aktiv === false ? 'off' : ''}" data-act="parzEdit" data-id="${p.id}"><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(kundeName(p.kunde))}${p.kultur ? ' · ' + esc(p.kultur) : ''}${feldById(p.feldId) ? ` · 🌾 Feld ${esc(feldById(p.feldId).name)}` : ''}</div></div><span class="num" style="width:auto">${p.flaeche ? fmtNum(p.flaeche) + ' ha' : ''}</span></div>`).join('') || '<div class="empty">Keine Parzellen.</div>'}</div>`;
  }
  if (sub === 'geraete') {
    const panel = (kind, title) => `<div class="panel"><h2>${title}</h2><div class="chips static">${Lists[kind]().map(x => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="nr">Keine Einträge</span>'}</div>
      <div class="btns"><button class="btn" data-act="editList" data-kind="${kind}">Bearbeiten</button></div></div>`;
    return segs + `<div class="cols"><div>${panel('duesen', 'Düsen')}</div><div>${panel('traktoren', 'Traktoren')}</div></div>`;
  }
  const q = norm(S.prq);
  const use = prodUsage(), U = id => use.get(id) || { last: '', n: 0 };
  const srt = S.prs || 'name';
  const list = Store.all('produkte').filter(p => (S.prall || p.aktuell !== false) && (!q || [p.name, p.zulassung].join(' ').toLowerCase().includes(q)))
    .sort(srt === 'name' ? byName : srt === 'alt' ? (a, b) => U(a.id).last.localeCompare(U(b.id).last) || byName(a, b) : (a, b) => U(b.id).last.localeCompare(U(a.id).last) || byName(a, b));
  const seit = S.prseit || isoDate(addDays(new Date(), -730));
  const alte = prodUnused(seit, use);
  return segs + `<div class="filters"><input class="input search" type="search" placeholder="Produkt suchen…" value="${esc(S.prq)}" data-in="spPrq">
      <select class="input" data-plain data-in="spPrs" style="width:auto"><option value="name" ${srt === 'name' ? 'selected' : ''}>Sortierung: Name</option><option value="alt" ${srt === 'alt' ? 'selected' : ''}>Letzter Einsatz: am längsten her zuerst</option><option value="neu" ${srt === 'neu' ? 'selected' : ''}>Letzter Einsatz: neueste zuerst</option></select>
      <label class="tog"><input type="checkbox" data-in="spPrall" ${S.prall ? 'checked' : ''}> auch nicht aktuelle</label><button class="btn primary" data-act="prodAddNew">＋ Produkt</button></div>
    ${srt !== 'name' ? `<div class="panel deact"><label class="fld inl"><span>Nicht mehr verwendet seit</span><input class="input" type="date" data-in="spPrSeit" value="${seit}"></label>
      <button class="btn ${alte.length ? 'primary' : ''}" data-act="prodDeactOld" ${alte.length ? '' : 'disabled'}>${alte.length} Produkte auf «nicht aktuell» setzen</button>
      <span class="nr">Produkte mit Inventar-Bestand bleiben aktuell. Einzelne Produkte mit dem Schalter «aktuell» in der Zeile.</span></div>` : ''}
    <div class="btns" style="margin:0 0 10px"><button class="btn" data-act="invPrint" title="Liste aller aktuellen Produkte mit Spalte zum Abhaken beim Zählen">Zählliste drucken / PDF</button><button class="btn" data-act="invCsv">Inventar CSV</button><button class="btn" data-act="prodImport">Preisliste importieren…</button></div>
    <p class="nr">${list.length} Produkte · Lagerwert Inventar CHF <span id="invTot">${chf(invTotal())}</span> · Bestand direkt eintragen, übrige Angaben durch Antippen der Zeile.</p>
    <div class="rows">${list.map(p => { const nx = prodNext(p); return `<div class="rowi prow2 ${p.aktuell === false ? 'off' : ''}" data-act="prodEdit" data-id="${p.id}"><div class="grow"><div class="t">${esc(p.name) || '<i class="nr">(ohne Name)</i>'}</div>
        <div class="s">${esc(p.zulassung || '')}${p.zulassung ? ' · ' : ''}CHF ${chf(p.preis)} / ${esc(p.einheit)} · <span class="${U(p.id).last && U(p.id).last >= seit ? '' : 'old'}">${U(p.id).last ? `zuletzt ${fmtDate(U(p.id).last, { day: '2-digit', month: '2-digit', year: 'numeric' })} (${U(p.id).n}×)` : 'nie verwendet'}</span>${nx ? ` · <span class="nxt">ab ${fmtDate(nx.ab, { day: '2-digit', month: '2-digit', year: '2-digit' })}: CHF ${chf(nx.preis)}${nx.name !== p.name ? ' · ' + esc(nx.name) : ''}</span>` : ''}</div></div>
      <div class="jedit" data-stop><label class="akt"><span>aktuell</span><input type="checkbox" data-in="spPrAkt" data-id="${p.id}" ${p.aktuell !== false ? 'checked' : ''}></label><label><span>Inventar ${esc(p.einheit || '')}</span><input class="input" data-in="spInv" data-id="${p.id}" inputmode="decimal" value="${p.inventar ?? ''}"></label></div>
      <span class="num invw">${p.inventar > 0 && p.preis ? 'CHF ' + chf(p.inventar * p.preis) : ''}</span></div>`; }).join('') || '<div class="empty">Keine Produkte.</div>'}</div>`;
}

// Kunden mit Spritzaufträgen – optional nur mit Daten in einem Zeitraum bzw. Erntejahr
const dOf = a => a.erledigtAm || a.datum || '';
function kundenMitSpritz(filter) {
  const ids = new Set(sprayOrders().filter(a => dOf(a) && (!filter || filter(a))).map(a => a.kunde));
  return Store.all('kunden').filter(k => ids.has(k.id)).sort(byName);
}
const billFilter = (S = App.spray) => a => dOf(a) >= S.av && dOf(a) <= S.ab && (['erledigt', 'verrechnet'].includes(statusOf(a)) || (S.ag && statusOf(a) === 'geplant'));
// Nachweis: nicht ÖLN-konforme Aufträge und Produkte erscheinen nur in der Abrechnung
const nwProds = a => prodList(a).filter(p => !p.nichtOeln);
const nwOk = a => !a.nichtOeln && !(prodList(a).length && !nwProds(a).length);
const nwFilter = (S = App.spray) => a => ernteOf(a) === +S.ny && (S.ngep || statusOf(a) !== 'geplant') && nwOk(a);
// Sortierung Erntejahr › Kultur › Parzelle › Datum
const byKulturParz = (a, b) => (ernteOf(a) || 0) - (ernteOf(b) || 0) || (a.kultur || '~').localeCompare(b.kultur || '~', 'de') || (a.feld || '~').localeCompare(b.feld || '~', 'de') || dOf(a).localeCompare(dOf(b));
const groupBy = (list, key) => { const m = new Map(); list.forEach(x => { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return [...m.entries()]; };

const MONATE_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
// Journal: chronologisch nach Ausführung; Erntejahr und Fläche direkt bearbeitbar
const byWhen = (a, b) => dOf(a).localeCompare(dOf(b)) || (a.zeit || '').localeCompare(b.zeit || '') || (a.nr || '').localeCompare(b.nr || '');
// Filter im Journal (Standard: geplante Aufträge ausgeblendet)
const JF_DEFAULT = { k: '', p: '', f: '', c: '', pr: '', st: 'ohne', von: '', bis: '' };
const jFeldOf = a => a.kfeld || (Store.get('parzellen', a.parzelle) || {}).feldId || '';
function journalFilter(S, skip = '') {
  const F = S.jf, y = S.jy || '';
  return a => (skip === 'k' || !F.k || a.kunde === F.k)
    && (skip === 'p' || !F.p || (a.feld || '') === F.p)
    && (skip === 'f' || !F.f || jFeldOf(a) === F.f)
    && (skip === 'c' || !F.c || (a.kultur || '') === F.c)
    && (skip === 'pr' || !F.pr || prodNames(a).includes(F.pr))
    && (skip === 'y' || !y || ernteOf(a) === +y)
    && (skip === 'st' || !F.st || (F.st === 'ohne' ? statusOf(a) !== 'geplant' : statusOf(a) === F.st))
    && (!F.von || dOf(a) >= F.von) && (!F.bis || dOf(a) <= F.bis);
}
function journalContent() {
  const S = App.spray; S.jf = S.jf || { ...JF_DEFAULT };
  const F = S.jf, q = norm(S.jq), y = S.jy || '', desc = S.jsort !== 'asc';
  const base = sprayOrders().filter(a => dOf(a));
  const all = base.filter(journalFilter(S)).filter(a => !q || [kundeName(a.kunde), a.feld, a.kultur, a.notiz, a.stadium, a.nr, ...prodNames(a)].join(' ').toLowerCase().includes(q));
  const list = all.slice().sort((a, b) => desc ? byWhen(b, a) : byWhen(a, b)), shown = list.slice(0, S.jlimit);
  const row = a => `<div class="rowi jrow" data-act="editOrder" data-id="${a.id}">
      <span class="num jd">${fmtDate(dOf(a), { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
      <div class="grow"><div class="t">${esc(kundeName(a.kunde))}${a.feld ? ` <span class="nr">· ${esc(a.feld)}</span>` : ''}</div>
        <div class="s">${esc(a.kultur || 'ohne Kultur')}${a.stadium ? ` · ${esc(a.stadium)}` : ''} · ${prodList(a).map(p => `${esc(p.name)} ${fmtNum(p.menge)} ${esc(p.einheit || '')}`).join(', ') || 'keine Produkte'}</div></div>
      <div class="jedit" data-stop>
        <label><span>Erntejahr</span><span class="jstep"><button type="button" class="jsb" data-act="spJEjStep" data-id="${a.id}" data-d="-1" aria-label="Erntejahr minus 1">−</button><input class="input" data-in="spJEj" data-id="${a.id}" inputmode="numeric" value="${ernteOf(a) ?? ''}" title="Pfeiltasten ↑ ↓ ändern das Jahr"><button type="button" class="jsb" data-act="spJEjStep" data-id="${a.id}" data-d="1" aria-label="Erntejahr plus 1">+</button></span></label>
        <label><span>Fläche ha</span><input class="input" data-in="spJFl" data-id="${a.id}" inputmode="decimal" value="${flOf(a) || ''}"></label>
      </div>
      <span class="badge ${statusOf(a)}">${STATUS[statusOf(a)]}</span></div>`;
  const ha = l => fmtNum(r2(l.reduce((s, a) => s + flOf(a), 0)));
  const body = groupBy(shown, a => dOf(a).slice(0, 7)).map(([m, ma]) => `<div class="grp"><div class="grp-p">${esc(m ? MONATE_LANG[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4) : '')} <small>${ma.length} · ${ha(ma)} ha</small></div>
      <div class="rows">${ma.map(row).join('')}</div></div>`).join('');
  // Auswahllisten nur mit Werten, die bei den übrigen Filtern vorkommen
  const pool = k => base.filter(journalFilter(S, k));
  const uniq = arr => [...new Set(arr.filter(Boolean))].sort((x, z) => String(x).localeCompare(String(z), 'de'));
  const opt = (list, cur, label = x => x, val = x => x) => list.map(x => `<option value="${esc(val(x))}" ${String(val(x)) === String(cur) ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
  const kList = uniq(pool('k').map(a => a.kunde)).map(id => Store.get('kunden', id)).filter(Boolean).sort(byName);
  const fList = uniq(pool('f').map(jFeldOf)).map(feldById).filter(Boolean).sort(byName);
  const sel = (k, label, opts, all = 'Alle', combo = true) => `<label class="fld"><span>${label}</span><select class="input" ${combo ? 'data-combo' : ''} data-in="spJf" data-k="${k}"><option value="">${all}</option>${opts}</select></label>`;
  const active = [F.k && 'Kunde', F.p && 'Parzelle', F.f && 'Feld', F.c && 'Kultur', F.pr && 'Produkt', y && 'Erntejahr', F.st !== 'ohne' && 'Status', (F.von || F.bis) && 'Zeitraum'].filter(Boolean);
  const panel = `<div class="panel jfilter">
      <div class="jfgrid">
        ${sel('k', 'Kunde', opt(kList, F.k, k => k.name, k => k.id), 'Alle Kunden')}
        ${sel('p', 'Parzelle', opt(uniq(pool('p').map(a => a.feld)), F.p), 'Alle Parzellen')}
        ${sel('f', 'Feld (MyJohnDeere)', opt(fList, F.f, f => f.name + (F.k ? '' : ' · ' + kundeName(f.kunde)), f => f.id), 'Alle Felder')}
        ${sel('c', 'Kultur', opt(uniq(pool('c').map(a => a.kultur)), F.c), 'Alle Kulturen')}
        ${sel('pr', 'Produkt', opt(uniq(pool('pr').flatMap(prodNames)), F.pr), 'Alle Produkte')}
        <label class="fld"><span>Erntejahr</span><select class="input" data-in="spJy"><option value="">Alle Erntejahre</option>${uniq(pool('y').map(ernteOf)).sort((x, z) => z - x).map(v => `<option ${+y === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="fld"><span>Status</span><select class="input" data-plain data-in="spJf" data-k="st">${[['ohne', 'Ohne geplante'], ['', 'Alle'], ['geplant', 'Nur geplante'], ['erledigt', 'Nur erledigte'], ['verrechnet', 'Nur verrechnete']].map(([v, l]) => `<option value="${v}" ${F.st === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="fld"><span>Von</span><input class="input" type="date" data-in="spJf" data-k="von" value="${esc(F.von)}"></label>
        <label class="fld"><span>Bis</span><input class="input" type="date" data-in="spJf" data-k="bis" value="${esc(F.bis)}"></label>
      </div>
      <div class="btns"><button class="btn" data-act="spJfReset" ${active.length ? '' : 'disabled'}>Filter zurücksetzen</button></div></div>`;
  return `<div class="filters"><input class="input search" type="search" placeholder="Suchen: Kunde, Parzelle, Kultur, Produkt…" value="${esc(S.jq)}" data-in="spJq">
      <button class="btn ${S.jfOpen ? 'primary' : ''}" data-act="spJfToggle">☰ Filter${active.length ? ` (${active.length})` : ''}</button>
      <select class="input" data-in="spJsort" style="width:auto"><option value="desc" ${desc ? 'selected' : ''}>Neueste zuerst</option><option value="asc" ${desc ? '' : 'selected'}>Älteste zuerst</option></select></div>
    ${S.jfOpen ? panel : ''}
    <p class="nr">${list.length} Spritzaufträge · ${ha(list)} ha${active.length ? ` · gefiltert nach ${active.join(', ')}` : ''}${F.st === 'ohne' ? ' · ohne geplante' : ''} · Erntejahr und Fläche direkt ändern, übrige Angaben durch Antippen der Zeile.</p>
    ${body || '<div class="empty">Keine Treffer.</div>'}
    ${list.length > shown.length ? `<div class="btns" style="margin-top:10px"><button class="btn" data-act="spMore">Weitere ${Math.min(200, list.length - shown.length)} anzeigen</button></div>` : ''}`;
}
// Erntejahr im Journal per Pfeiltaste bzw. −/+ um ein Jahr ändern (speichert sofort)
function journalStep(inp, d) {
  const cur = num(inp.value) || ernteDefault(todayIso());
  inp.value = cur + d; journalEdit(inp);
}
// Direktbearbeitung im Journal
function journalEdit(el) {
  const a = Store.get('auftraege', el.dataset.id); if (!a) return;
  const v = num(el.value);
  if (el.dataset.in === 'spJEj') {
    if (!v || v < 1990 || v > 2100 || v !== Math.round(v)) { toast('Erntejahr bitte vierstellig eingeben, z.B. 2027'); el.value = ernteOf(a) ?? ''; return; }
    a.erntejahr = v;
  } else {
    if (v == null || v < 0) { toast('Fläche bitte als Zahl eingeben'); el.value = flOf(a) || ''; return; }
    if (a.flaecheEff != null || ['erledigt', 'verrechnet'].includes(statusOf(a))) a.flaecheEff = v; else a.flaeche = v;
    el.value = v;
  }
  Store.put('auftraege', { ...a }, { silent: true });
  el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 900);
}

// Abrechnung: gegliedert nach Erntejahr, Kultur und Parzelle, ohne Preisherleitung
function billing(kid, von, bis, mitGeplant) {
  const k = Store.get('kunden', kid) || {};
  const preisHa = (k.preisSpritze || 0) + (k.preisFahrer || 0) + (k.preisTraktor || 0), zu = k.zuschlag || 0;
  const f = billFilter({ av: von, ab: bis, ag: mitGeplant });
  const orders = sprayOrders().filter(a => a.kunde === kid && dOf(a) && f(a)).sort(byKulturParz);
  let tA = 0, tM = 0;
  const rows = orders.map(a => {
    const fl = flOf(a), arbeit = round05(fl * preisHa);
    const mittel = prodList(a).map(p => {
      const pr = prodAt(prodOf(p), dOf(a)) || {}, preis = pr.preis || 0, preisZ = round05(preis * zu + preis), menge = (p.menge || 0) * fl, betrag = round05(menge * preisZ);
      return { name: p.name, zulassung: pr.zulassung || '', mengeHa: p.menge, einheit: p.einheit || pr.einheit || '', menge, preis, preisZ, betrag };
    });
    const m = mittel.reduce((s, x) => s + x.betrag, 0); tA += arbeit; tM += m;
    return { a, fl, arbeit, mittel, mittelTot: m };
  });
  return { k, preisHa, zu, rows, tA, tM, total: tA + tM };
}
// Gliederung Erntejahr › Kultur › Parzelle: je Kultur eine eigene Tabelle (bleibt im Ausdruck möglichst auf einer Seite),
// je Parzelle ein Block, der nie getrennt wird – lieber eine Seite mehr als ein unübersichtlicher Umbruch
const BILL_COLS = '<colgroup><col style="width:10%"><col style="width:28%"><col style="width:16%"><col style="width:11%"><col style="width:11%"><col style="width:10%"><col style="width:14%"></colgroup>';
const NW_COLS = '<colgroup><col style="width:10%"><col style="width:7%"><col style="width:11%"><col style="width:26%"><col style="width:16%"><col style="width:12%"><col style="width:18%"></colgroup>';
function billingHtml(b, von, bis) {
  const sum = rs => rs.reduce((s, r) => s + r.arbeit + r.mittelTot, 0);
  const fl = rs => fmtNum(r2(rs.reduce((s, r) => s + r.fl, 0)));
  const jobRows = r => `<tr class="job click" data-act="editOrder" data-id="${r.a.id}"><td>${fmtDate(dOf(r.a), { day: '2-digit', month: '2-digit', year: '2-digit' })}</td><td>Arbeit Spritzen</td><td></td>
      <td></td><td class="n">${fmtNum(r.fl)} ha</td><td class="n">${chf(b.preisHa)}</td><td class="n"><b>${chf(r.arbeit)}</b></td></tr>
    ${r.mittel.map(m => `<tr class="mit click" data-act="editOrder" data-id="${r.a.id}"><td></td><td>${esc(m.name)}</td><td class="nr">${esc(m.zulassung)}</td><td class="n">${m.mengeHa != null ? fmtNum(m.mengeHa) + ' ' + esc(m.einheit) : ''}</td><td class="n">${fmtNum(r2(m.menge))} ${esc(m.einheit)}</td><td class="n">${chf(m.preisZ)}</td><td class="n">${chf(m.betrag)}</td></tr>`).join('')}`;
  const head = `<thead><tr><th>Datum</th><th>Position</th><th>Zulassung</th><th class="n">Menge/ha</th><th class="n">Menge</th><th class="n">Ansatz</th><th class="n">Betrag CHF</th></tr></thead>`;
  const body = groupBy(b.rows, r => ernteOf(r.a) || '').map(([j, jr]) => `<section class="jblk">
      <h3 class="gj"><span>Erntejahr ${esc(j || '–')}</span><span>${fl(jr)} ha · CHF ${chf(sum(jr))}</span></h3>
      ${groupBy(jr, r => r.a.kultur || '').map(([k, kr], ki) => `<div class="kblk"><table class="btab fx">${BILL_COLS}${ki === 0 ? head : ''}
        <tbody><tr class="gk"><td colspan="4">${esc(k || 'ohne Kultur')}</td><td class="n">${fl(kr)} ha</td><td></td><td class="n">${chf(sum(kr))}</td></tr></tbody>
        ${groupBy(kr, r => r.a.feld || '').map(([p, pr]) => `<tbody class="pblk"><tr class="gp"><td colspan="7">${esc(p || 'ohne Parzelle')}</td></tr>${pr.map(jobRows).join('')}</tbody>`).join('')}
      </table></div>`).join('')}</section>`).join('');
  return `<div class="bill">${LETTERHEAD}<div class="bill-h"><div><b>${esc(b.k.anrede ? b.k.anrede + ' ' : '')}${esc(b.k.name || '')}</b><br>${esc(b.k.adresse || '')}<br>${esc([b.k.plz, b.k.ort].filter(Boolean).join(' '))}</div>
      <div class="r"><b class="doctitle">Abrechnung</b><br>Spritzarbeiten ${fmtDate(von, { day: '2-digit', month: '2-digit', year: 'numeric' })} – ${fmtDate(bis, { day: '2-digit', month: '2-digit', year: 'numeric' })}</div></div>
    ${body}
    <div class="totblk"><table class="btab fx">${BILL_COLS}<tbody class="tots">
      <tr><td colspan="6">Total Arbeit (${fl(b.rows)} ha)</td><td class="n">${chf(b.tA)}</td></tr>
      <tr><td colspan="6">Total Mittel</td><td class="n">${chf(b.tM)}</td></tr>
      <tr class="tot"><td colspan="6">Total CHF</td><td class="n">${chf(b.total)}</td></tr></tbody></table></div></div>`;
}
function abrechnungContent() {
  const S = App.spray, ks = kundenMitSpritz(billFilter(S));
  if (S.ak && !ks.some(k => k.id === S.ak)) S.ak = '';
  const head = `<div class="filters">
      <label class="fld inl"><span>Von</span><input class="input" type="date" value="${S.av}" data-in="spAv"></label>
      <label class="fld inl"><span>Bis</span><input class="input" type="date" value="${S.ab}" data-in="spAb"></label>
      <label class="tog"><input type="checkbox" data-in="spAg" ${S.ag ? 'checked' : ''}> auch geplante</label>
      <select class="input" data-combo data-in="spAk" style="width:auto;min-width:200px"><option value="">Alle Kunden (Übersicht, ${ks.length})</option>${ks.map(k => `<option value="${k.id}" ${k.id === S.ak ? 'selected' : ''}>${esc(kundeLabel(k))}</option>`).join('')}</select></div>`;
  if (!S.ak) {
    const sums = ks.map(k => ({ k, b: billing(k.id, S.av, S.ab, S.ag) })).filter(x => x.b.rows.length);
    const tot = sums.reduce((s, x) => s + x.b.total, 0);
    return head + (sums.length ? `<div class="tscroll"><table class="need"><thead><tr><th>Kunde</th><th>Aufträge</th><th>Fläche ha</th><th>Arbeit</th><th>Mittel</th><th>Total CHF</th><th></th></tr></thead><tbody>
      ${sums.map(x => `<tr class="click" data-act="spAkSel" data-id="${x.k.id}"><td>${esc(x.k.name)}</td><td>${x.b.rows.length}</td><td>${fmtNum(r2(x.b.rows.reduce((s, r) => s + r.fl, 0)))}</td><td>${chf(x.b.tA)}</td><td>${chf(x.b.tM)}</td><td><b>${chf(x.b.total)}</b></td><td></td></tr>`).join('')}
      <tr class="area"><td>Total</td><td></td><td></td><td></td><td></td><td><b>${chf(tot)}</b></td><td></td></tr></tbody></table></div>
      <div class="btns"><button class="btn" data-act="spBillCsv">CSV (alle)</button><button class="btn" data-act="spBillPrintAll">Alle drucken / PDF</button></div>`
      : '<div class="empty">Keine erledigten Spritzaufträge in diesem Zeitraum.</div>');
  }
  const b = billing(S.ak, S.av, S.ab, S.ag);
  const offen = b.rows.filter(r => statusOf(r.a) === 'erledigt').length;
  return head + `${!b.preisHa ? '<p class="hintp panel">Für diesen Kunden sind keine Spritzpreise erfasst – unter <b>Kunden</b> ergänzen.</p>' : ''}
    <p class="nr">Zeile antippen, um den Auftrag zu bearbeiten.</p>
    <div class="panel">${billingHtml(b, S.av, S.ab)}
    <div class="btns"><button class="btn primary" data-act="spBillPrint">Drucken / PDF</button><button class="btn" data-act="spBillCsv">CSV</button>
      ${offen ? `<button class="btn" data-act="spBillMark">${offen} als verrechnet markieren</button>` : ''}</div></div>`;
}
function billingCsv() {
  const S = App.spray, ids = S.ak ? [S.ak] : kundenMitSpritz(billFilter(S)).map(k => k.id);
  const rows = [['Kunde', 'Erntejahr', 'Kultur', 'Parzelle', 'Datum', 'Fläche ha', 'Position', 'Zulassung', 'Menge/ha', 'Menge', 'Einheit', 'Ansatz CHF', 'Betrag CHF', 'Auftrag']];
  ids.forEach(id => { const b = billing(id, S.av, S.ab, S.ag); b.rows.forEach(r => {
    const d = dOf(r.a);
    rows.push([b.k.name, ernteOf(r.a), r.a.kultur, r.a.feld, d, r.fl, 'Arbeit Spritzen', '', '', r.fl, 'ha', b.preisHa.toFixed(2), r.arbeit.toFixed(2), r.a.nr]);
    r.mittel.forEach(m => rows.push([b.k.name, ernteOf(r.a), r.a.kultur, r.a.feld, d, r.fl, m.name, m.zulassung, m.mengeHa ?? '', r2(m.menge), m.einheit, m.preisZ.toFixed(2), m.betrag.toFixed(2), r.a.nr]));
  }); });
  download(`Abrechnung_Spritzen_${S.av}_bis_${S.ab}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}

// ÖLN-Nachweis: ohne Hinweise auf nicht ÖLN-konforme Behandlungen; Zeilen öffnen den Auftrag
function nachweisRows() {
  const S = App.spray, f = nwFilter(S);
  return sprayOrders().filter(a => dOf(a) && f(a) && (!S.nk || a.kunde === S.nk) && (!S.nc || a.kultur === S.nc))
    .sort((a, b) => kundeName(a.kunde).localeCompare(kundeName(b.kunde), 'de') || byKulturParz(a, b));
}
function nachweisHtml(list) {
  const head = `<thead><tr><th>Datum</th><th class="n">ha</th><th>Stadium</th><th>Produkt</th><th>Zulassung</th><th class="n">Menge/ha</th><th>Bemerkung</th></tr></thead>`;
  const ha = l => fmtNum(r2(l.reduce((s, a) => s + flOf(a), 0)));
  const job = a => { const ps = nwProds(a).length ? nwProds(a) : [{}]; return ps.map((p, i) => `<tr class="${i ? 'mit' : 'job'} click" data-act="editOrder" data-id="${a.id}">
      <td>${i ? '' : fmtDate(dOf(a), { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
      <td class="n">${i ? '' : fmtNum(flOf(a))}</td><td>${i ? '' : esc(a.stadium || '')}</td>
      <td>${esc(p.name || '–')}</td><td>${esc(prodAt(prodOf(p), dOf(a)).zulassung || '')}</td>
      <td class="n">${p.menge != null ? fmtNum(p.menge) + ' ' + esc(p.einheit || '') : ''}</td><td>${i ? '' : esc(a.notiz || '')}</td></tr>`).join(''); };
  return groupBy(list, a => a.kunde).map(([kid, ol]) => {
    const k = Store.get('kunden', kid) || {};
    return `<div class="bill nachweis">${LETTERHEAD}<div class="bill-h"><div><b>${esc(k.name || '')}</b>${k.ort ? ', ' + esc([k.plz, k.ort].filter(Boolean).join(' ')) : ''}</div>
      <div class="r">Pflanzenschutz-Nachweis Erntejahr ${esc(App.spray.ny)}${App.spray.nc ? ' · ' + esc(App.spray.nc) : ''}</div></div>
      ${groupBy(ol, a => ernteOf(a) || '').map(([j, ja]) => `<section class="jblk">
        <h3 class="gj"><span>Erntejahr ${esc(j || '–')}</span><span>${ja.length} Behandlungen · ${ha(ja)} ha</span></h3>
        ${groupBy(ja, a => a.kultur || '').map(([kk, ka], ki) => `<div class="kblk"><table class="btab fx">${NW_COLS}${ki === 0 ? head : ''}
          <tbody><tr class="gk"><td colspan="5">${esc(kk || 'ohne Kultur')}</td><td class="n" colspan="2">${ka.length} × · ${ha(ka)} ha</td></tr></tbody>
          ${groupBy(ka, a => a.feld || '').map(([pp, pa]) => `<tbody class="pblk"><tr class="gp"><td colspan="7">${esc(pp || 'ohne Parzelle')}</td></tr>${pa.map(job).join('')}</tbody>`).join('')}
        </table></div>`).join('')}</section>`).join('')}
    </div>`;
  }).join('');
}
function nachweisContent() {
  const S = App.spray, ys = yearsOf(); if (!S.ny) S.ny = ys[0] || new Date().getFullYear();
  const f = nwFilter(S), ks = kundenMitSpritz(f);
  if (S.nk && !ks.some(k => k.id === S.nk)) S.nk = '';
  const list = nachweisRows(), kult = [...new Set(sprayOrders().filter(a => dOf(a) && f(a) && (!S.nk || a.kunde === S.nk)).map(a => a.kultur).filter(Boolean))].sort();
  if (S.nc && !kult.includes(S.nc)) S.nc = '';
  return `<div class="filters">
      <select class="input" data-in="spNy" style="width:auto">${(ys.length ? ys : [S.ny]).map(v => `<option ${+S.ny === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select class="input" data-combo data-in="spNk" style="width:auto;min-width:180px"><option value="">Alle Kunden (${ks.length})</option>${ks.map(k => `<option value="${k.id}" ${k.id === S.nk ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
      <select class="input" data-combo data-in="spNc" style="width:auto"><option value="">Alle Kulturen</option>${kult.map(c => `<option ${c === S.nc ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label class="tog"><input type="checkbox" data-in="spNgep" ${S.ngep ? 'checked' : ''}> auch geplante</label></div>
    <p class="nr">${list.length} Behandlungen · ${new Set(list.map(a => a.kunde)).size} Kunden · Zeile antippen, um den Auftrag zu bearbeiten.</p>
    ${list.length ? `<div class="btns" style="margin-bottom:10px"><button class="btn primary" data-act="spNwPrint">Drucken / PDF</button><button class="btn" data-act="spNwCsv">CSV</button></div><div class="panel">${nachweisHtml(list)}</div>` : '<div class="empty">Keine Behandlungen für diese Auswahl.</div>'}`;
}
function nachweisCsv() {
  const rows = [['Erntejahr', 'Kunde', 'Ort', 'Datum', 'Parzelle', 'Kultur', 'Fläche ha', 'Stadium', 'Produkt', 'Zulassung', 'Menge/ha', 'Einheit', 'Wasser l/ha', 'Düse', 'Bemerkung']];
  nachweisRows().forEach(a => { const k = kundeOf(a); (nwProds(a).length ? nwProds(a) : [{}]).forEach(p => rows.push([ernteOf(a), k.name, k.ort, dOf(a), a.feld, a.kultur, flOf(a), a.stadium, p.name, (prodOf(p) || {}).zulassung, p.menge, p.einheit, a.wasser, a.duese, a.notiz])); });
  download(`OELN-Nachweis_${App.spray.ny}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
/* ================= Produkte: Preisverlauf mit Gültigkeit, Import von Preislisten, Inventar ================= */
// Verlauf je Produkt: p.verlauf = [{ ab:'YYYY-MM-DD', name, zulassung, preis }], ältester Eintrag ab '1900-01-01' = bisheriger Stand.
const VERLAUF_START = '1900-01-01';
function prodAt(pr, iso) {
  if (!pr) return {};
  const d = iso || todayIso();
  const v = (pr.verlauf || []).filter(e => e.ab <= d).sort((a, b) => a.ab.localeCompare(b.ab)).pop();
  return v ? { ...pr, name: v.name ?? pr.name, zulassung: v.zulassung ?? pr.zulassung, preis: v.preis ?? pr.preis } : pr;
}
const prodNext = pr => (pr.verlauf || []).filter(e => e.ab > todayIso()).sort((a, b) => a.ab.localeCompare(b.ab))[0] || null;
// neuen Stand ab Datum eintragen; Aufträge ab diesem Datum erhalten den neuen Namen
function prodSetFrom(pr, ab, vals) {
  const p = { ...pr, verlauf: (pr.verlauf || []).map(e => ({ ...e })) };
  if (!p.verlauf.length) p.verlauf.push({ ab: VERLAUF_START, name: pr.name, zulassung: pr.zulassung || '', preis: pr.preis || 0 });
  const prev = prodAt(p, ab);
  const e = { ab, name: vals.name ?? prev.name, zulassung: vals.zulassung ?? prev.zulassung, preis: vals.preis ?? prev.preis };
  const i = p.verlauf.findIndex(x => x.ab === ab);
  if (i >= 0) p.verlauf[i] = e; else p.verlauf.push(e);
  p.verlauf.sort((a, b) => a.ab.localeCompare(b.ab));
  const cur = prodAt(p, todayIso());
  Object.assign(p, { name: cur.name, zulassung: cur.zulassung, preis: cur.preis, geaendert: todayIso() });
  return p;
}
// Namensänderung in Aufträgen ab dem Gültigkeitsdatum nachführen (frühere Aufträge behalten den damaligen Namen)
function prodRenameOrders(list) {
  const ch = new Map();
  list.forEach(({ p, ab, oldName }) => {
    Store.all('auftraege').forEach(a => {
      if (!prodList(a).some(x => x.pid === p.id || (!x.pid && x.name === oldName))) return;
      const d = dOf(a) || a.wunsch || todayIso(); const nm = prodAt(p, d).name;
      const cur = ch.get(a.id) || a;
      const produkte = cur.produkte.map(x => (x.pid === p.id || (!x.pid && x.name === oldName)) && x.name !== nm && d >= ab ? { ...x, pid: p.id, name: nm } : x);
      if (produkte.some((x, i) => x !== cur.produkte[i])) ch.set(a.id, { ...cur, produkte });
    });
  });
  if (ch.size) Store.putMany('auftraege', [...ch.values()]);
  return ch.size;
}
// beim Start: fällig gewordene Änderungen übernehmen
function prodApplyDue() {
  const due = Store.all('produkte').filter(p => p.verlauf && p.verlauf.length).map(p => ({ p, cur: prodAt(p, todayIso()) }))
    .filter(({ p, cur }) => cur.name !== p.name || (cur.zulassung || '') !== (p.zulassung || '') || (cur.preis || 0) !== (p.preis || 0));
  if (!due.length) return 0;
  const ren = due.filter(({ p, cur }) => cur.name !== p.name).map(({ p, cur }) => ({ p: { ...p, name: cur.name }, ab: (p.verlauf.filter(e => e.ab <= todayIso()).pop() || {}).ab || todayIso(), oldName: p.name }));
  Store.putMany('produkte', due.map(({ p, cur }) => ({ ...p, name: cur.name, zulassung: cur.zulassung, preis: cur.preis })));
  if (ren.length) prodRenameOrders(ren);
  return due.length;
}

/* ---------- Verwendung der Produkte (letzter Einsatz) ---------- */
function prodUsage() {
  const byN = new Map(Store.all('produkte').map(p => [fold(p.name), p.id])), m = new Map();
  sprayOrders().forEach(a => { const d = dOf(a); if (!d) return; prodList(a).forEach(x => { const id = x.pid && Store.get('produkte', x.pid) ? x.pid : byN.get(fold(x.name)); if (!id) return; const u = m.get(id) || { last: '', n: 0 }; u.n++; if (d > u.last) u.last = d; m.set(id, u); }); });
  return m;
}
const prodUnused = (seit, use = prodUsage()) => Store.all('produkte').filter(p => p.aktuell !== false && !(p.inventar > 0) && !((use.get(p.id) || {}).last >= seit));
function prodDeactOld() {
  const seit = App.spray.prseit || isoDate(addDays(new Date(), -730)), list = prodUnused(seit);
  if (!list.length) return;
  if (!confirm(`${list.length} Produkte, die seit ${fmtDate(seit, { day: '2-digit', month: '2-digit', year: 'numeric' })} nicht mehr verwendet wurden, auf «nicht aktuell» setzen?\n\nSie erscheinen dann nicht mehr in der Auswahl beim Erfassen; bestehende Aufträge und Berichte bleiben unverändert.`)) return;
  Store.putMany('produkte', list.map(p => ({ ...p, aktuell: false })));
  toast(`${list.length} Produkte auf «nicht aktuell» gesetzt`);
}
function prodAktToggle(el) {
  const p = Store.get('produkte', el.dataset.id); if (!p) return;
  Store.put('produkte', { ...p, aktuell: el.checked }, { silent: true });
  el.closest('.rowi')?.classList.toggle('off', !el.checked);
}

/* ---------- Inventar ---------- */
const invProducts = all => Store.all('produkte').filter(p => (p.name || '').trim() && (all || p.aktuell !== false || p.inventar > 0)).sort(byName);
const invTotal = () => Store.all('produkte').reduce((s, p) => s + (p.inventar > 0 ? p.inventar * (p.preis || 0) : 0), 0);
function invEdit(el) {
  const p = Store.get('produkte', el.dataset.id); if (!p) return;
  const t = el.value.trim(), v = t === '' ? null : num(t);
  if (t !== '' && (v == null || v < 0)) { toast('Inventar bitte als Zahl eingeben'); el.value = p.inventar ?? ''; return; }
  Store.put('produkte', { ...p, inventar: v, inventarAm: todayIso() }, { silent: true });
  el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 900);
  const tot = $('#invTot'); if (tot) tot.textContent = chf(invTotal());
  const w = el.closest('.rowi')?.querySelector('.invw'); if (w) w.textContent = v > 0 && p.preis ? 'CHF ' + chf(v * p.preis) : '';
}
function inventoryHtml() {
  const list = invProducts(App.spray.invAll).filter(p => App.spray.invAll || p.inventar > 0 || p.aktuell !== false);
  const rows = list.map(p => `<tr><td>${esc(p.name)}</td><td class="nr">${esc(p.zulassung || '')}</td><td class="n">${p.inventar != null ? fmtNum(p.inventar) : ''}</td><td>${esc(p.einheit || '')}</td>
    <td class="n">${chf(p.preis)}</td><td class="n">${p.inventar > 0 ? chf(p.inventar * (p.preis || 0)) : ''}</td><td class="cnt"></td></tr>`).join('');
  return `<div class="bill inv"><div class="bill-h"><div><b>Inventarliste Pflanzenschutzmittel</b></div><div class="r">Stand ${fmtDate(todayIso(), { day: '2-digit', month: '2-digit', year: 'numeric' })}</div></div>
    <table class="btab"><thead><tr><th>Produkt</th><th>Zulassung</th><th class="n">Bestand</th><th>Einheit</th><th class="n">Preis CHF</th><th class="n">Wert CHF</th><th>Gezählt</th></tr></thead>
    <tbody>${rows}<tr class="tot invsum"><td colspan="5"><b>Lagerwert total</b></td><td class="n"><b>${chf(invTotal())}</b></td><td></td></tr></tbody></table></div>`;
}
function inventoryCsv() {
  const rows = [['Produkt', 'Zulassung', 'Bestand', 'Einheit', 'Preis CHF', 'Wert CHF', 'Inventar erfasst am']];
  invProducts(true).forEach(p => rows.push([p.name, p.zulassung, p.inventar ?? '', p.einheit, (p.preis || 0).toFixed(2), p.inventar > 0 ? (p.inventar * (p.preis || 0)).toFixed(2) : '', p.inventarAm || '']));
  download(`Inventar_${todayIso()}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}

/* ---------- Dateien lesen: Excel (.xlsx) und CSV ---------- */
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
async function readXlsx(buf) {
  const get = await unzip(buf), xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const ss = await get('xl/sharedStrings.xml');
  const strings = ss ? [...xml(ss).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  // erstes Tabellenblatt laut Arbeitsmappe
  let sheet = 'xl/worksheets/sheet1.xml';
  try {
    const wb = xml(await get('xl/workbook.xml')), rels = xml(await get('xl/_rels/workbook.xml.rels'));
    const rid = wb.getElementsByTagName('sheet')[0].getAttribute('r:id') || wb.getElementsByTagName('sheet')[0].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
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
async function readTable(file) {
  const buf = await file.arrayBuffer();
  const sig = new Uint8Array(buf.slice(0, 4)); // ZIP-Kennung «PK\3\4» = Excel
  if (sig[0] === 0x50 && sig[1] === 0x4b && sig[2] === 3 && sig[3] === 4) return readXlsx(buf);
  if (/\.xlsx?$/i.test(file.name)) throw new Error(/\.xls$/i.test(file.name) ? 'Bitte in Excel als .xlsx oder .csv speichern' : 'Keine gültige Excel-Datei');
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  return readCsv(text.replace(/^﻿/, ''));
}

/* ---------- Import Preisliste: Produktname, Zulassung, Preis ab Datum ---------- */
const parsePrice = v => { if (v == null || v === '') return null; if (typeof v === 'number') return v; const s = String(v).replace(/CHF|Fr\.?|\s|'|’/gi, ''); const m = s.match(/-?\d+(?:[.,]\d+)?/); return m ? +m[0].replace(',', '.') : null; };
const zulKey = z => { const m = String(z || '').toUpperCase().replace(/\s/g, '').match(/[A-Z]{0,2}-?\d{3,6}(?:-\d+)?/); return m ? m[0].replace(/^([A-Z]+)(\d)/, '$1-$2') : ''; };
const IMP_FIELDS = [['name', 'Produktname *', /produkt|bezeichnung|handelsname|artikel(?!.*n(r|um))|^name/i], ['zulassung', 'Zulassungs-Nr.', /zulass|bewillig|w-?nr|kenn|reg/i],
  ['preis', 'Preis CHF', /preis|chf|netto|betrag|fr\./i], ['einheit', 'Einheit', /einheit|^me$|unit|^eh$/i]];
function impGuess(rows) {
  let hi = 0, best = -1;
  rows.slice(0, 15).forEach((r, i) => { const sc = IMP_FIELDS.filter(([, , re]) => r.some(c => re.test(String(c || '').trim()))).length; if (sc > best) { best = sc; hi = i; } });
  const head = rows[hi] || [], map = {};
  IMP_FIELDS.forEach(([k, , re]) => { const i = head.findIndex((c, j) => re.test(String(c || '').trim()) && !Object.values(map).includes(j)); map[k] = i; });
  if (best < 1) { map.name = 0; return { hi: -1, map }; }
  return { hi, map };
}
function impMatch(rows, hi, map, { neu }) {
  const ps = Store.all('produkte'), byZ = new Map(), dupZ = new Set();
  ps.forEach(p => { const z = zulKey(p.zulassung); if (!z) return; if (byZ.has(z)) dupZ.add(z); byZ.set(z, p); });
  const used = new Set();
  return rows.slice(hi + 1).map((r, i) => {
    const cell = k => map[k] >= 0 ? String(r[map[k]] ?? '').trim() : '';
    const name = cell('name'); if (!name) return null;
    const zul = cell('zulassung'), preis = map.preis >= 0 ? parsePrice(r[map.preis]) : null, einheit = cell('einheit');
    const zk = zulKey(zul);
    let p = ps.find(x => !used.has(x.id) && fold(x.name) === fold(name));
    if (!p && zk && byZ.has(zk) && !dupZ.has(zk) && !used.has(byZ.get(zk).id)) p = byZ.get(zk);
    if (p) used.add(p.id);
    const zulCh = p && zul && (zulKey(zul) || zulKey(p.zulassung) ? zulKey(zul) !== zulKey(p.zulassung) : fold(zul) !== fold(p.zulassung));
    const ch = p ? [name !== p.name && 'Name', zulCh && 'Zulassung', preis != null && Math.abs(preis - (p.preis || 0)) > 0.0001 && 'Preis'].filter(Boolean) : [];
    return { ri: hi + 1 + i, name, zul, preis, einheit, p, ch, art: p ? (ch.length ? 'aendern' : 'gleich') : (neu ? 'neu' : 'ohne') };
  }).filter(Boolean);
}
async function prodImportStart() {
  const file = await pickFile('.xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); if (!file) return;
  let rows; try { rows = await readTable(file); while (rows.length && !rows[rows.length - 1].some(c => String(c ?? '').trim())) rows.pop(); } catch (e) { toast('Datei konnte nicht gelesen werden: ' + e.message, 5000); return; }
  if (!rows.length) { toast('Die Datei enthält keine Daten'); return; }
  const g = impGuess(rows), cols = Math.max(...rows.slice(0, 50).map(r => r.length));
  const head = g.hi >= 0 ? rows[g.hi] : [];
  const colOpt = (k, cur) => `<option value="-1">— keine —</option>` + Array.from({ length: cols }, (_, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${esc(String(head[i] || '').trim() || 'Spalte ' + String.fromCharCode(65 + i))}</option>`).join('');
  const body = `<p class="nr" style="margin-top:0">${esc(file.name)} · ${rows.slice(g.hi + 1).filter(r => r.some(c => String(c ?? '').trim())).length} Zeilen</p>
    <div class="two"><label class="fld"><span>Gültig ab *</span><input class="input" type="date" name="ab" value="${todayIso()}" required></label>
      <label class="fld"><span>Überschriften in Zeile</span><input class="input" name="hi" inputmode="numeric" value="${g.hi + 1}"></label></div>
    <div class="two">${IMP_FIELDS.map(([k, l]) => `<label class="fld"><span>${l}</span><select class="input" data-plain name="col_${k}">${colOpt(k, g.map[k])}</select></label>`).join('')}</div>
    <div class="checks"><label><input type="checkbox" name="neu" checked> Produkte, die es noch nicht gibt, neu anlegen</label>
      <label><input type="checkbox" name="alt"> Produkte, die nicht in der Liste stehen, auf «nicht aktuell» setzen</label></div>
    <div id="impPrev"></div>`;
  Dlg.open('Produkte aktualisieren', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Übernehmen</button>`, fd => {
    const st = read(); if (!st.ab) { toast('Gültig-ab-Datum angeben'); return false; }
    const all = impMatch(rows, st.hi, st.map, { neu: st.neu });
    // Abwahl merken: beim nächsten Import sind dieselben Produkte wieder abgewählt
    const mem = Store.cfg().impSkip || { ids: [], names: [] }, ids = new Set(mem.ids), names = new Set(mem.names);
    all.filter(r => r.art === 'aendern' || r.art === 'neu').forEach(r => {
      const off = skip.has(r.ri);
      if (r.p) off ? ids.add(r.p.id) : ids.delete(r.p.id); else off ? names.add(fold(r.name)) : names.delete(fold(r.name));
    });
    Store.setCfg({ impSkip: { ids: [...ids], names: [...names] } });
    const res = all.filter(r => !skip.has(r.ri));
    const upd = [], ren = [];
    res.filter(r => r.art === 'aendern').forEach(r => {
      const vals = { name: r.name }; if (r.ch.includes('Zulassung')) vals.zulassung = r.zul; if (r.ch.includes('Preis')) vals.preis = r.preis;
      const np = prodSetFrom(r.p, st.ab, vals); if (r.einheit && !r.p.einheit) np.einheit = r.einheit;
      np.aktuell = true; upd.push(np); if (r.name !== r.p.name) ren.push({ p: np, ab: st.ab, oldName: r.p.name });
    });
    const neu = res.filter(r => r.art === 'neu').map(r => {
      const base = { id: uid(), name: r.name, zulassung: r.zul, preis: r.preis || 0, einheit: r.einheit || 'l', aktuell: true };
      return st.ab > todayIso() ? { ...base, verlauf: [{ ab: VERLAUF_START, name: r.name, zulassung: r.zul, preis: 0 }, { ab: st.ab, name: r.name, zulassung: r.zul, preis: r.preis || 0 }], preis: 0 } : base;
    });
    const inList = new Set(res.filter(r => r.p).map(r => r.p.id));
    const alt = st.alt ? Store.all('produkte').filter(p => !inList.has(p.id) && p.aktuell !== false).map(p => ({ ...p, aktuell: false })) : [];
    if (!upd.length && !neu.length && !alt.length) { toast('Keine Änderungen'); return true; }
    Store.putMany('produkte', [...upd, ...neu, ...alt]);
    const nr = ren.length ? prodRenameOrders(ren) : 0;
    toast(`Produkte aktualisiert ab ${fmtDate(st.ab, { day: '2-digit', month: '2-digit', year: 'numeric' })}: ${upd.length} geändert, ${neu.length} neu${alt.length ? `, ${alt.length} nicht mehr aktuell` : ''}${nr ? ` · ${nr} Aufträge umbenannt` : ''}`, 6000);
    return true;
  });
  const f = Dlg.form;
  // abgewählte Zeilen (Zeilennummer der Datei); Vorbelegung aus dem letzten Import
  const mem = Store.cfg().impSkip || { ids: [], names: [] }, memIds = new Set(mem.ids), memNames = new Set(mem.names);
  const skip = new Set(impMatch(rows, g.hi, g.map, { neu: true }).filter(r => r.p ? memIds.has(r.p.id) : memNames.has(fold(r.name))).map(r => r.ri));
  const read = () => ({ ab: f.ab.value, hi: Math.max(0, (num(f.hi.value) || 1)) - 1, neu: f.neu.checked, alt: f.alt.checked,
    map: Object.fromEntries(IMP_FIELDS.map(([k]) => [k, +f['col_' + k].value])) });
  const prev = () => {
    const st = read();
    if (st.map.name < 0) { $('#impPrev', f).innerHTML = '<p class="hintp panel">Bitte die Spalte mit dem Produktnamen wählen.</p>'; return; }
    const res = impMatch(rows, st.hi, st.map, { neu: st.neu }).map(r => (r.art === 'aendern' || r.art === 'neu') && skip.has(r.ri) ? { ...r, aus: r.art, art: 'aus' } : r);
    const cnt = k => res.filter(r => r.art === k).length, wahl = res.filter(r => r.art === 'aendern' || r.art === 'neu' || r.art === 'aus');
    const future = st.ab > todayIso();
    const cb = r => r.art === 'aendern' || r.art === 'neu' || r.art === 'aus' ? `<input type="checkbox" data-ri="${r.ri}" ${r.art === 'aus' ? '' : 'checked'} aria-label="übernehmen">` : '';
    const line = r => `<tr class="${r.art}"><td class="cbx">${cb(r)}</td><td>${r.p && r.name !== r.p.name ? `${esc(r.p.name)} → <b>${esc(r.name)}</b>` : esc(r.name)}</td>
      <td class="nr">${r.ch.includes('Zulassung') ? `${esc(r.p.zulassung || '–')} → <b>${esc(r.zul)}</b>` : esc(r.zul || r.p?.zulassung || '')}</td>
      <td class="n">${r.preis == null ? '' : r.p && Math.abs(r.preis - (r.p.preis || 0)) > 0.0001 ? `${chf(r.p.preis)} → <b>${chf(r.preis)}</b>` : chf(r.preis)}</td>
      <td>${r.art === 'aus' ? `ausgeschlossen <span class="nr">(${r.aus === 'neu' ? 'neu' : 'ändern'})</span>` : { aendern: 'ändern', gleich: 'unverändert', neu: 'neu', ohne: 'übersprungen' }[r.art]}</td></tr>`;
    const order = { aendern: 0, neu: 1, aus: 2, ohne: 3, gleich: 4 };
    const shown = res.slice().sort((a, b) => order[a.art] - order[b.art] || a.ri - b.ri);
    const act = shown.filter(r => r.art !== 'gleich' && r.art !== 'ohne'), rest = shown.filter(r => r.art === 'gleich' || r.art === 'ohne').slice(0, 150);
    const allOn = wahl.length && wahl.every(r => r.art !== 'aus');
    $('#impPrev', f).innerHTML = `<p><b>${cnt('aendern')} ändern</b> · ${cnt('neu')} neu${cnt('aus') ? ` · <b>${cnt('aus')} ausgeschlossen</b>` : ''} · ${cnt('gleich')} unverändert${cnt('ohne') ? ` · ${cnt('ohne')} übersprungen` : ''}${future ? ` · gilt erst ab ${fmtDate(st.ab, { day: '2-digit', month: '2-digit', year: 'numeric' })}, bis dahin bleiben die bisherigen Angaben` : ''}</p>
      <p class="nr">Häkchen entfernen, um ein Produkt von der Aktualisierung bzw. Neuerfassung auszuschliessen – die Abwahl bleibt für den nächsten Import gespeichert.
        Abrechnungen verwenden den Preis, der am Tag des Auftrags gültig war; Aufträge ab dem Gültigkeitsdatum erhalten den neuen Produktnamen.</p>
      <div class="tscroll"><table class="btab imptab"><thead><tr><th class="cbx">${wahl.length ? `<input type="checkbox" data-riall ${allOn ? 'checked' : ''} aria-label="alle übernehmen" title="alle an/aus">` : ''}</th><th>Produkt</th><th>Zulassung</th><th class="n">Preis CHF</th><th></th></tr></thead><tbody>
      ${[...act, ...rest].map(line).join('')}</tbody></table></div>`;
    const ha = $('input[data-riall]', f); if (ha) ha.indeterminate = !allOn && wahl.some(r => r.art !== 'aus');
  };
  f.addEventListener('input', e => { if (e.target.dataset.ri == null && e.target.dataset.riall == null) prev(); });
  f.addEventListener('change', e => {
    if (e.target.dataset.ri != null) { const ri = +e.target.dataset.ri; e.target.checked ? skip.delete(ri) : skip.add(ri); }
    else if (e.target.dataset.riall != null) { const st = read(); impMatch(rows, st.hi, st.map, { neu: st.neu }).filter(r => r.art === 'aendern' || r.art === 'neu').forEach(r => e.target.checked ? skip.delete(r.ri) : skip.add(r.ri)); }
    const db = f.querySelector('.db'), y = db && db.scrollTop; prev(); if (db) db.scrollTop = y;
  });
  prev();
}

/* ---------- Preisverlauf im Produktfenster ---------- */
function verlaufHtml(p) {
  const v = (p.verlauf || []).slice().sort((a, b) => b.ab.localeCompare(a.ab));
  if (v.length < 2) return '';
  return `<div class="fld" style="margin-top:10px"><span>Verlauf (Abrechnungen verwenden den am Auftragstag gültigen Stand)</span></div>
    <div class="tscroll"><table class="btab vtab"><thead><tr><th>Gültig ab</th><th>Name</th><th>Zulassung</th><th class="n">Preis CHF</th><th></th></tr></thead><tbody>
    ${v.map(e => `<tr class="${e.ab > todayIso() ? 'future' : ''}"><td>${e.ab === VERLAUF_START ? 'bisher' : fmtDate(e.ab, { day: '2-digit', month: '2-digit', year: 'numeric' })}</td><td>${esc(e.name || '')}</td><td>${esc(e.zulassung || '')}</td><td class="n">${chf(e.preis)}</td>
      <td>${e.ab === VERLAUF_START ? '' : `<button type="button" class="x" data-vdel="${esc(e.ab)}" aria-label="Eintrag löschen">×</button>`}</td></tr>`).join('')}</tbody></table></div>`;
}
/* ================= Aufträge als Liste: Filter, Gruppierung, Export Excel/PDF (wie Modul Bericht) ================= */
const aDate = a => a.erledigtAm || a.datum || a.wunsch || '';
const aFeld = a => a.feld || (a.kfeld && feldById(a.kfeld) ? feldById(a.kfeld).name : '');
const aStatusOk = (a, f) => f === 'alle' || (f === 'offen' ? isOpen(a) : statusOf(a) === f);
function alFilter(L, skip = '') {
  const q = norm(App.filter.q), sf = App.filter.auftraege;
  return a => aStatusOk(a, sf) && (!L.von || aDate(a) >= L.von) && (!L.bis || (aDate(a) && aDate(a) <= L.bis))
    && (skip === 'k' || !L.k || a.kunde === L.k) && (skip === 'a' || !L.a || a.arbeit === L.a) && (skip === 'c' || !L.c || (a.kultur || '') === L.c)
    && (skip === 'm' || !L.m || (a.maschine || '') === L.m) && (skip === 'f' || !L.f || aFeld(a) === L.f)
    && (!q || [a.nr, kundeName(a.kunde), a.arbeit, a.kultur, a.notiz, aFeld(a), maschine(a.maschine)?.name, ...prodNames(a)].join(' ').toLowerCase().includes(q));
}
const AL_GRP = [['', 'keine'], ['kunde', 'Kunde'], ['arbeit', 'Arbeit'], ['maschine', 'Maschine'], ['kultur', 'Kultur'], ['status', 'Status'], ['monat', 'Monat']];
const alKey = (a, g) => g === 'kunde' ? kundeName(a.kunde) : g === 'arbeit' ? a.arbeit || '' : g === 'maschine' ? (maschine(a.maschine)?.name || '') : g === 'kultur' ? a.kultur || '' : g === 'status' ? STATUS[statusOf(a)] : g === 'monat' ? aDate(a).slice(0, 7) : '';
const alLabel = (k, g) => g === 'monat' && k ? `${MONATE_LANG[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : (k || '–');
const alFl = a => a.flaecheEff ?? a.flaeche ?? null;
const alHa = l => r2(l.reduce((s, a) => s + (alFl(a) || 0), 0));
const alStd = a => a.stundenEff ?? a.dauer ?? null;
function alList() {
  const L = App.al;
  return Store.all('auftraege').filter(alFilter(L)).sort((x, y) => {
    const c = (aDate(x) || '9999').localeCompare(aDate(y) || '9999') || (x.zeit || '').localeCompare(y.zeit || '') || (x.nr || '').localeCompare(y.nr || '');
    return L.sort === 'asc' ? c : -c;
  });
}
function alTable(list, { print } = {}) {
  const g = App.al.grp;
  const ck = !print, sel = App.alSel || new Set();
  const allOn = ck && list.length && list.every(a => sel.has(a.id));
  const head = `<thead><tr>${ck ? `<th class="ck" data-stop><input type="checkbox" data-in="alSelAll" title="Alle angezeigten auswählen" ${allOn ? 'checked' : ''}></th>` : ''}<th>Datum</th><th>Nr.</th><th>Kunde</th><th>Feld / Parzelle</th><th>Arbeit</th><th>Kultur</th><th class="n">ha</th><th>Maschine</th><th class="n">Std.</th><th>Status</th><th>Bemerkung</th></tr></thead>`;
  const row = a => `<tr class="${print ? '' : 'click'}${ck && sel.has(a.id) ? ' alsel' : ''}" ${print ? '' : `data-act="editOrder" data-id="${a.id}"`}>${ck ? `<td class="ck" data-stop><input type="checkbox" data-in="alSel" value="${a.id}" ${sel.has(a.id) ? 'checked' : ''}></td>` : ''}<td>${aDate(a) ? fmtDate(aDate(a), { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''}${!a.datum && a.wunsch ? ' <span class="nr">W</span>' : ''}</td>
    <td class="nr">${esc(a.nr || '')}</td><td>${esc(kundeName(a.kunde))}</td><td>${esc(aFeld(a))}</td><td>${esc(a.arbeit || '')}${prodList(a).length ? `<br><span class="nr">${esc(prodNames(a).join(', '))}</span>` : ''}</td><td>${esc(a.kultur || '')}</td>
    <td class="n">${alFl(a) != null ? fmtNum(alFl(a)) : ''}</td><td>${esc(maschine(a.maschine)?.name || '')}</td><td class="n">${alStd(a) != null ? fmtNum(r2(alStd(a))) : ''}</td>
    <td>${print ? STATUS[statusOf(a)] : `<span class="badge ${statusOf(a)}">${STATUS[statusOf(a)]}</span>`}</td><td>${esc(a.notiz || '')}</td></tr>`;
  if (!g) return `<table class="btab altab">${head}<tbody>${list.map(row).join('')}</tbody></table>`;
  const groups = groupBy(list.slice().sort((x, y) => String(alKey(x, g)).localeCompare(String(alKey(y, g)), 'de') * (g === 'monat' && App.al.sort !== 'asc' ? -1 : 1)), a => alKey(a, g));
  return `<table class="btab altab">${head}${groups.map(([k, l]) => `<tbody class="pblk"><tr class="gk"><td colspan="${ck ? 7 : 6}">${esc(alLabel(k, g))}</td><td class="n">${fmtNum(alHa(l))}</td><td colspan="4">${l.length} ${l.length === 1 ? 'Auftrag' : 'Aufträge'}</td></tr>${l.map(row).join('')}</tbody>`).join('')}</table>`;
}
/* ---------- Mehrfachauswahl: Status mehrerer Aufträge ändern ---------- */
function alSelToggle(el) {
  const S = App.alSel || (App.alSel = new Set());
  if (el.dataset.in === 'alSelAll') { const ids = alList().slice(0, App.al.limit || 300).map(a => a.id); ids.forEach(id => el.checked ? S.add(id) : S.delete(id)); }
  else if (el.checked) S.add(el.value); else S.delete(el.value);
  App.render();
}
function alSelAllList() { const S = App.alSel || (App.alSel = new Set()); alList().forEach(a => S.add(a.id)); App.render(); }
function alSetStatus(st) {
  const S = App.alSel || new Set(), list = alList().filter(a => S.has(a.id));
  if (!list.length) return;
  const ch = [], skip = [];
  list.forEach(a => {
    if (statusOf(a) === st) return;
    if (st === 'geplant' && !a.datum) { skip.push(a); return; }
    ch.push(a);
  });
  if (!ch.length) { toast(skip.length ? 'Aufträge ohne Datum können nicht auf «Geplant» gesetzt werden – zuerst einplanen.' : `Alle ausgewählten Aufträge sind bereits «${STATUS[st]}».`); return; }
  const hint = st === 'offen' && ch.some(a => a.datum) ? '\nDie Einplanung (Datum, Zeit) wird dabei entfernt.' : (st === 'erledigt' || st === 'verrechnet') && ch.some(a => !a.datum && !a.erledigtAm) ? '\nAufträge ohne Datum erhalten das heutige Datum als «erledigt am».' : '';
  if (!confirm(`${ch.length} ${ch.length === 1 ? 'Auftrag' : 'Aufträge'} auf «${STATUS[st]}» setzen?${skip.length ? `\n${skip.length} ohne Datum werden nicht auf «Geplant» gesetzt.` : ''}${hint}`)) return;
  ch.forEach(a => {
    if (st === 'erledigt' || st === 'verrechnet') { if (!a.erledigtAm) a.erledigtAm = a.datum || todayIso(); if (!a.datum) a.datum = a.erledigtAm; }
    else { a.erledigtAm = ''; if (st === 'offen') { a.datum = ''; a.zeit = ''; } }
    a.status = st;
  });
  S.clear();
  Store.putMany('auftraege', ch);
  toast(`${ch.length} ${ch.length === 1 ? 'Auftrag' : 'Aufträge'} auf «${STATUS[st]}» gesetzt${skip.length ? ` · ${skip.length} übersprungen (ohne Datum)` : ''}`);
}
function alSelBar(list) {
  const S = App.alSel || (App.alSel = new Set());
  const ids = new Set(list.map(a => a.id)); [...S].forEach(id => { if (!ids.has(id)) S.delete(id); });
  if (!S.size) return `<p class="nr" style="margin:0 0 8px">Tipp: Aufträge links ankreuzen, um den Status mehrerer Aufträge gleichzeitig zu ändern.</p>`;
  return `<div class="panel alselbar"><b>${S.size} ausgewählt</b>
    <span class="alsl">Status setzen:</span>
    ${Object.entries(STATUS).map(([v, l]) => `<button type="button" class="btn mini st-${v}" data-act="alSetStatus" data-v="${v}"><span class="badge ${v}">${l}</span></button>`).join('')}
    ${S.size < list.length ? `<button type="button" class="btn mini" data-act="alSelAllList">Alle ${list.length} auswählen</button>` : ''}
    <button type="button" class="btn mini" data-act="alSelNone">Auswahl aufheben</button></div>`;
}
function alPreset(v) {
  const L = App.al, t = new Date(), y = t.getFullYear();
  if (v === 'jahr') { L.von = `${y}-01-01`; L.bis = `${y}-12-31`; }
  else if (v === 'vorjahr') { L.von = `${y - 1}-01-01`; L.bis = `${y - 1}-12-31`; }
  else if (v === '30') { L.von = isoDate(addDays(t, -30)); L.bis = todayIso(); }
  else if (v === 'woche') { const mo = addDays(t, -((t.getDay() + 6) % 7)); L.von = isoDate(mo); L.bis = isoDate(addDays(mo, 6)); }
  else { L.von = ''; L.bis = ''; }
  App.render();
}
function alCsv() {
  const rows = [['Nr.', 'Datum', 'Wunschdatum', 'Zeit', 'Kunde', 'Feld / Parzelle', 'Arbeit', 'Kultur', 'Fläche ha', 'Maschine', 'Stunden', 'Status', 'Produkte', 'Bemerkung']];
  alList().forEach(a => rows.push([a.nr, a.erledigtAm || a.datum || '', a.wunsch || '', a.zeit || '', kundeName(a.kunde), aFeld(a), a.arbeit, a.kultur, alFl(a) ?? '', maschine(a.maschine)?.name || '', alStd(a) != null ? r2(alStd(a)) : '', STATUS[statusOf(a)], prodList(a).map(p => `${p.name} ${p.menge ?? ''} ${p.einheit || ''}/ha`.trim()).join(', '), a.notiz]));
  const L = App.al;
  download(`Auftraege_${L.von || 'alle'}_${L.bis || ''}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
function alPrint() {
  const L = App.al, list = alList(), d = x => fmtDate(x, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const title = `Aufträge${L.von || L.bis ? ` ${L.von ? d(L.von) : '…'} – ${L.bis ? d(L.bis) : '…'}` : ''}`;
  const filt = [App.filter.auftraege !== 'alle' && 'Status: ' + ({ offen: 'offen' }[App.filter.auftraege] || STATUS[App.filter.auftraege]), L.k && 'Kunde: ' + kundeName(L.k), L.a && 'Arbeit: ' + L.a, L.c && 'Kultur: ' + L.c, L.m && 'Maschine: ' + (maschine(L.m)?.name || ''), L.f && 'Feld: ' + L.f, App.filter.q && 'Suche: ' + App.filter.q].filter(Boolean).join(' · ');
  printHtml(title, `<div class="bill alprint">${LETTERHEAD}<div class="bill-h"><div><b>${esc(L.k ? kundeName(L.k) : 'Auftragsliste')}</b>${filt ? `<br><span class="nr">${esc(filt)}</span>` : ''}</div><div class="r">${esc(title)}<br>${list.length} Aufträge · ${fmtNum(alHa(list))} ha</div></div>
    ${alTable(list, { print: true })}</div>`, { noTitle: true });
}
function alContent() {
  const L = App.al, all = Store.all('auftraege'), list = alList(), shown = list.slice(0, L.limit || 300);
  const uniq = (fn, skip) => [...new Set(all.filter(alFilter(L, skip)).map(fn).filter(Boolean))].sort((x, y) => String(x).localeCompare(String(y), 'de'));
  const opt = (vals, cur, lab = v => v) => vals.map(v => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(lab(v))}</option>`).join('');
  const kIds = uniq(a => a.kunde, 'k').sort((x, y) => kundeName(x).localeCompare(kundeName(y), 'de')), mIds = uniq(a => a.maschine, 'm');
  const sel = (k, label, opts, allTxt) => `<label class="fld"><span>${label}</span><select class="input" data-combo data-in="al" data-k="${k}"><option value="">${allTxt}</option>${opts}</select></label>`;
  const sums = groupBy(list, a => a.arbeit || '–').sort((x, y) => y[1].length - x[1].length).map(([a, l]) => `<span class="chip">${esc(a)}: ${l.length} · ${fmtNum(alHa(l))} ha</span>`).join('');
  return `<div class="panel jfilter"><div class="jfgrid">
      <label class="fld"><span>Von</span><input class="input" type="date" data-in="al" data-k="von" value="${esc(L.von)}"></label>
      <label class="fld"><span>Bis</span><input class="input" type="date" data-in="al" data-k="bis" value="${esc(L.bis)}"></label>
      ${sel('k', 'Kunde', opt(kIds, L.k, kundeName), 'Alle Kunden')}${sel('f', 'Feld / Parzelle', opt(uniq(aFeld, 'f'), L.f), 'Alle Felder')}
      ${sel('a', 'Arbeit', opt(uniq(a => a.arbeit, 'a'), L.a), 'Alle Arbeiten')}${sel('c', 'Kultur', opt(uniq(a => a.kultur, 'c'), L.c), 'Alle Kulturen')}
      ${sel('m', 'Maschine', opt(mIds, L.m, id => maschine(id)?.name || id), 'Alle Maschinen')}
      <label class="fld"><span>Gruppieren nach</span><select class="input" data-plain data-in="al" data-k="grp">${AL_GRP.map(([v, l]) => `<option value="${v}" ${L.grp === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="fld"><span>Sortierung</span><select class="input" data-plain data-in="al" data-k="sort"><option value="desc">Neueste zuerst</option><option value="asc" ${L.sort === 'asc' ? 'selected' : ''}>Älteste zuerst</option></select></label>
    </div>
    <div class="btns"><span class="seg mini">${[['woche', 'Diese Woche'], ['30', '30 Tage'], ['jahr', 'Dieses Jahr'], ['vorjahr', 'Vorjahr'], ['alle', 'Alles']].map(([v, l]) => `<button type="button" data-act="alPreset" data-v="${v}">${l}</button>`).join('')}</span>
      <button class="btn" data-act="alReset">Filter zurücksetzen</button></div>
    <p class="nr" style="margin:6px 0 0">Datum = erledigt am, sonst eingeplant, sonst Wunschdatum (W). Status über die Schaltflächen oben, Suche im Suchfeld oben.</p></div>
    <p><b>${list.length} Aufträge · ${fmtNum(alHa(list))} ha</b></p>
    <div class="chips static" style="margin-bottom:10px">${sums}</div>
    ${list.length ? `<div class="btns" style="margin-bottom:10px"><button class="btn primary" data-act="alPrint">Drucken / PDF</button><button class="btn" data-act="alCsv">Excel (CSV)</button></div>
    ${alSelBar(list)}
    <div class="panel tscroll">${alTable(shown)}</div>
    ${list.length > shown.length ? `<div class="btns" style="margin-top:10px"><button class="btn" data-act="alMore">Weitere ${Math.min(300, list.length - shown.length)} anzeigen</button></div>` : ''}` : '<div class="empty">Keine Aufträge für diese Auswahl.</div>'}`;
}

/* ---------- Inventar-Auswertung: nur Produkte mit Bestand ---------- */
function invStock() {
  const use = prodUsage(), S = App.spray;
  const list = Store.all('produkte').filter(p => p.inventar > 0 && (p.name || '').trim());
  return list.sort(S.invs === 'wert' ? (a, b) => b.inventar * (b.preis || 0) - a.inventar * (a.preis || 0) || byName(a, b) : byName).map(p => ({ p, wert: p.inventar * (p.preis || 0), last: (use.get(p.id) || {}).last || '' }));
}
function invStockHtml({ print } = {}) {
  const rows = invStock(), tot = rows.reduce((s, r) => s + r.wert, 0);
  const d = x => fmtDate(x, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `<div class="bill inv"><div class="bill-h"><div><b>Inventar Pflanzenschutzmittel</b><br><span class="nr">nur Produkte mit Bestand</span></div><div class="r">Stand ${d(todayIso())}<br>${rows.length} Produkte · CHF ${chf(tot)}</div></div>
    <table class="btab"><thead><tr><th>Produkt</th><th>Zulassung</th><th class="n">Bestand</th><th>Einheit</th><th class="n">Preis CHF</th><th class="n">Wert CHF</th><th>Zuletzt verwendet</th><th>Erfasst am</th></tr></thead>
    <tbody>${rows.map(({ p, wert, last }) => `<tr class="${print ? '' : 'click'}" ${print ? '' : `data-act="prodEdit" data-id="${p.id}"`}><td>${esc(p.name)}${p.aktuell === false ? ' <span class="nr">(nicht aktuell)</span>' : ''}</td><td class="nr">${esc(p.zulassung || '')}</td><td class="n">${fmtNum(p.inventar)}</td><td>${esc(p.einheit || '')}</td>
      <td class="n">${chf(p.preis)}</td><td class="n">${chf(wert)}</td><td>${last ? d(last) : 'nie'}</td><td class="nr">${p.inventarAm ? d(p.inventarAm) : ''}</td></tr>`).join('')}
    <tr class="tot invsum"><td colspan="5"><b>Lagerwert total</b></td><td class="n"><b>${chf(tot)}</b></td><td colspan="2"></td></tr></tbody></table></div>`;
}
function invStockCsv() {
  const rows = [['Produkt', 'Zulassung', 'Bestand', 'Einheit', 'Preis CHF', 'Wert CHF', 'Zuletzt verwendet', 'Inventar erfasst am']];
  invStock().forEach(({ p, wert, last }) => rows.push([p.name, p.zulassung, p.inventar, p.einheit, (p.preis || 0).toFixed(2), wert.toFixed(2), last, p.inventarAm || '']));
  download(`Inventar_Bestand_${todayIso()}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
function invStockContent() {
  const S = App.spray, rows = invStock();
  return `<div class="filters"><select class="input" data-plain data-in="spInvs" style="width:auto"><option value="name">Sortierung: Name</option><option value="wert" ${S.invs === 'wert' ? 'selected' : ''}>Sortierung: Wert (höchster zuerst)</option></select>
      <button class="btn primary" data-act="invStockPrint" ${rows.length ? '' : 'disabled'}>Drucken / PDF</button><button class="btn" data-act="invStockCsv" ${rows.length ? '' : 'disabled'}>Excel (CSV)</button></div>
    <p class="nr">Bestand wird in der Produkteliste eingetragen. Zeile antippen, um das Produkt zu öffnen.</p>
    ${rows.length ? `<div class="panel tscroll">${invStockHtml()}</div>` : '<div class="empty">Kein Produkt mit Bestand erfasst.</div>'}`;
}
/* ================= Planung exportieren: aktuelle Ansicht als PDF oder Bild ================= */
const mLabel = m => m ? (m.kurz || m.name) : 'Ohne Maschine';
function planExportData() {
  const V = Views.plan, days = V.days(), cols = V.columns(days);
  const cell = (d, col) => schedule(d, col.id).items.map(it => {
    const a = it.a;
    return { zeit: `${fromMin(it.start)}–${fromMin(it.end)}`, kunde: kfText(a),
      info: [a.arbeit, a.kultur, a.flaeche ? fmtNum(a.flaeche) + ' ha' : ''].filter(Boolean).join(' · '),
      prod: isSpray(a) ? prodNames(a).join(', ') : '', status: statusOf(a) };
  });
  const rows = days.map(d => ({ d, cells: cols.map(col => cell(d, col)) }));
  const unpl = Store.all('auftraege').filter(a => isOpen(a) && !a.datum).sort((x, y) => (x.wunsch || '9999').localeCompare(y.wunsch || '9999'));
  return { title: `Planung ${V.label()}`, mode: App.plan.mode, days, cols, rows, unpl };
}
function planExportDialog() {
  const body = `<p style="margin-top:0">Exportiert die aktuelle Ansicht <b>${esc(Views.plan.label())}</b> mit allen Maschinen und Aufträgen.</p>
    <label class="tog"><input type="checkbox" name="unpl" ${App.plan.expUnpl ? 'checked' : ''}> Nicht eingeplante Aufträge anhängen</label>
    <label class="tog"><input type="checkbox" name="leer" ${App.plan.expLeer ? 'checked' : ''}> Auch Maschinen ohne Aufträge zeigen</label>`;
  Dlg.open('Planung exportieren', body, `<span class="spacer"></span><button type="button" class="btn" data-act="planExpImg">Als Bild</button><button type="button" class="btn primary" data-act="planExpPdf">Als PDF / Drucken</button>`, () => true);
}
function planExportOpts() { const f = Dlg.form; App.plan.expUnpl = !!f.unpl?.checked; App.plan.expLeer = !!f.leer?.checked; }
function planExportFiltered() {
  const x = planExportData();
  if (!App.plan.expLeer) {
    const keep = x.cols.map((c, i) => x.rows.some(r => r.cells.at(i).length));
    if (keep.some(Boolean)) { x.cols = x.cols.filter((c, i) => keep.at(i)); x.rows = x.rows.map(r => ({ ...r, cells: r.cells.filter((c, i) => keep.at(i)) })); }
  }
  if (!App.plan.expUnpl) x.unpl = [];
  return x;
}
function planExportPdf() {
  planExportOpts(); const x = planExportFiltered(); Dlg.close();
  const dayLbl = d => fmtDate(d, { weekday: 'short', day: '2-digit', month: '2-digit' });
  const it = c => `<div class="pxi"><b>${esc(c.zeit)}</b> ${esc(c.kunde)}<br><span>${esc(c.info)}</span>${c.prod ? `<br><span class="pxp">${esc(c.prod)}</span>` : ''}</div>`;
  const table = `<table class="btab pxt"><thead><tr>${x.mode === 'woche' ? '<th style="width:86px">Tag</th>' : ''}${x.cols.map(c => `<th>${esc(mLabel(c.m))}</th>`).join('')}</tr></thead><tbody>
    ${x.rows.map(r => `<tr>${x.mode === 'woche' ? `<td class="pxd"><b>${esc(dayLbl(r.d))}</b></td>` : ''}${r.cells.map(c => `<td>${c.map(it).join('') || ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const un = x.unpl.length ? `<h3 class="pxh">Noch nicht eingeplant (${x.unpl.length})</h3><table class="btab"><tbody>${x.unpl.map(a => `<tr><td>${a.wunsch ? fmtDate(a.wunsch, { day: '2-digit', month: '2-digit' }) : '–'}</td><td>${esc(kfText(a))}</td><td>${esc([a.arbeit, a.kultur, a.flaeche ? fmtNum(a.flaeche) + ' ha' : ''].filter(Boolean).join(' · '))}</td><td class="nr">${esc(a.notiz || '')}</td></tr>`).join('')}</tbody></table>` : '';
  printHtml(x.title, `<style>@page { size: A4 landscape; margin: 10mm 10mm 14mm; }</style><div class="planexp"><div class="bill-h"><div><b>${esc(x.title)}</b></div><div class="r">Stand ${new Date().toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}</div></div>${table}${un}</div>`, { noTitle: true });
}
function drawPlanOverview(x) {
  const F = (w, s) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const green = '#2f6b3a', ink = '#1d211e', muted = '#5c625d', line = '#dedbd3', soft = '#f6f5f1';
  const week = x.mode === 'woche', DW = week ? 150 : 0, P = 32, n = Math.max(1, x.cols.length);
  const CW = Math.max(240, Math.min(n <= 3 ? 420 : 320, Math.floor((1200 - 2 * P - DW) / n)));
  const W = P * 2 + DW + CW * Math.max(1, x.cols.length);
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const cellLines = c => { const out = []; c.forEach(i => { out.push([i.zeit, F('700', 22), green, 30]); ctx.font = F('600', 22); wrapLines(ctx, i.kunde, CW - 28).forEach(l => out.push([l, F('600', 22), ink, 28])); ctx.font = F('400', 19); wrapLines(ctx, i.info, CW - 28).forEach(l => out.push([l, F('400', 19), muted, 25])); if (i.prod) { ctx.font = F('italic 400', 18); wrapLines(ctx, i.prod, CW - 28).forEach(l => out.push([l, F('italic 400', 18), muted, 24])); } out.push(['', '', '', 12]); }); return out; };
  const run = draw => {
    let y = 0;
    if (draw) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, cv.height); ctx.fillStyle = green; ctx.fillRect(0, 0, W, 110); ctx.font = F('700', 34); ctx.fillStyle = '#fff'; ctx.fillText(x.title, P, 54); ctx.font = F('400', 20); ctx.fillStyle = '#d9ead9'; ctx.fillText(`Stand ${new Date().toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}`, P, 88); }
    y = 110;
    // Kopfzeile mit Maschinen
    const hh = 56;
    if (draw) { ctx.fillStyle = soft; ctx.fillRect(0, y, W, hh); ctx.font = F('700', 24); ctx.fillStyle = ink; x.cols.forEach((c, i) => { let t = mLabel(c.m); while (t.length > 3 && ctx.measureText(t).width > CW - 28) t = t.slice(0, -2) + '…'; ctx.fillText(t, P + DW + i * CW + 14, y + 36); }); }
    y += hh;
    x.rows.forEach((r, ri) => {
      const ls = r.cells.map(cellLines), h = Math.max(week ? 70 : 90, 16 + Math.max(0, ...ls.map(l => l.reduce((s, q) => s + q[3], 0))));
      if (draw) {
        if (ri % 2) { ctx.fillStyle = '#fbfaf7'; ctx.fillRect(0, y, W, h); }
        ctx.fillStyle = line; ctx.fillRect(P, y + h - 1, W - 2 * P, 1);
        if (week) { ctx.font = F('700', 24); ctx.fillStyle = ink; ctx.fillText(fmtDate(r.d, { weekday: 'short' }), P, y + 36); ctx.font = F('400', 20); ctx.fillStyle = muted; ctx.fillText(fmtDate(r.d, { day: '2-digit', month: '2-digit' }), P, y + 62); }
        ls.forEach((l, i) => { let yy = y + 34; const x0 = P + DW + i * CW + 14; if (i) { ctx.fillStyle = line; ctx.fillRect(P + DW + i * CW, y + 8, 1, h - 16); } l.forEach(([t, f, c, lh]) => { if (t) { ctx.font = f; ctx.fillStyle = c; ctx.fillText(t, x0, yy); } yy += lh; }); });
      }
      y += h;
    });
    if (x.unpl.length) {
      y += 40; if (draw) { ctx.font = F('700', 26); ctx.fillStyle = ink; ctx.fillText(`Noch nicht eingeplant (${x.unpl.length})`, P, y); }
      y += 14;
      x.unpl.forEach(a => { y += 34; if (draw) { ctx.font = F('600', 21); ctx.fillStyle = ink; ctx.fillText(`${a.wunsch ? fmtDate(a.wunsch, { day: '2-digit', month: '2-digit' }) + '  ' : ''}${kfText(a)}`, P, y); ctx.font = F('400', 20); ctx.fillStyle = muted; ctx.fillText([a.arbeit, a.kultur, a.flaeche ? fmtNum(a.flaeche) + ' ha' : ''].filter(Boolean).join(' · '), P + Math.min(420, W / 2), y); } });
    }
    y += 50; if (draw) { ctx.font = F('400', 18); ctx.fillStyle = muted; ctx.fillText('Lohnarbeit-Planer', P, y); }
    return y + 24;
  };
  cv.width = W; cv.height = 10; const H = run(false); cv.height = H; run(true);
  return cv;
}
function planExportImg() {
  planExportOpts(); const x = planExportFiltered();
  const fname = `${x.title.replace(/[^\wäöüÄÖÜ.-]+/g, '_')}.png`;
  showImage(x.title, drawPlanOverview(x), fname, x.title);
}
/* ================= Tablet/Handy: Aufträge mit dem Finger ziehen ================= */
function planDrop(el, id, clientY, grabY, target) {
  if (!Store.get('auftraege', id)) return;
  const ids = App.sel.has(id) && App.sel.size > 1 ? [...App.sel] : [id];
  if (!el.dataset.drop) { moveOrders(ids, id, { unplan: true }); return; }
  const [d, mid] = el.dataset.drop.split('|');
  let minute = null, top = null, beforeId = null;
  if (el.dataset.tl) { const r0 = el.getBoundingClientRect(), r = el.dataset.tl === 'x' ? { top: r0.left } : r0; const z = UIZ(); minute = Math.max(0, (clientY - r.top) / z / PX); top = Math.max(0, (clientY - grabY - r.top) / z / PX); }
  else { const over = target && target.closest && target.closest('.pcard[data-id]'); if (over && over.dataset.id !== id) beforeId = over.dataset.id; }
  moveOrders(ids, id, { datum: d, mid, minute, top, beforeId });
}
function touchDrag(el) {
  el.classList.add('tdrag');
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || App.selMode) return;
    const sx = e.clientX, sy = e.clientY, r0 = el.getBoundingClientRect(), grab = el.classList.contains('blk') ? (App.tlH ? e.clientX - r0.left : e.clientY - r0.top) : 0;
    let on = false, ghost = null, over = null, lx = sx, ly = sy;
    const timer = setTimeout(() => {
      on = true; App.tdrag = true;
      try { navigator.vibrate && navigator.vibrate(15); } catch { }
      ghost = el.cloneNode(true); ghost.classList.add('tghost');
      const z = UIZ(); Object.assign(ghost.style, { position: 'fixed', left: r0.left / z + 'px', top: r0.top / z + 'px', width: r0.width / z + 'px', height: el.classList.contains('blk') ? r0.height / z + 'px' : '', margin: 0, zIndex: 80, pointerEvents: 'none' });
      const n = App.sel.has(el.dataset.id) ? App.sel.size : 1;
      if (n > 1) ghost.insertAdjacentHTML('afterbegin', `<span class="tcount">${n}</span>`);
      document.body.appendChild(ghost); el.classList.add('dragging');
    }, 320);
    const cal = el.closest('.cal');
    const move = ev => {
      lx = ev.clientX; ly = ev.clientY;
      if (!on) { if (Math.hypot(lx - sx, ly - sy) > 8) end(false); return; }
      ghost.style.transform = `translate(${(lx - sx) / UIZ()}px, ${(ly - sy) / UIZ()}px)`;
      const t = document.elementFromPoint(lx, ly), d = t && t.closest('[data-drop]');
      if (d !== over) { over && over.classList.remove('drop'); over = d; over && over.classList.add('drop'); }
      const c = $('.cal'); // am Rand automatisch weiterscrollen
      if (c) { const r = c.getBoundingClientRect(), m = 48; if (ly > r.bottom - m) c.scrollTop += 14; else if (ly < r.top + m) c.scrollTop -= 14; if (lx > r.right - m) c.scrollLeft += 14; else if (lx < r.left + m) c.scrollLeft -= 14; }
    };
    const end = drop => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      if (!on) return;
      App.tdrag = false; App.noClickUntil = Date.now() + 450;
      ghost && ghost.remove(); el.classList.remove('dragging'); over && over.classList.remove('drop');
      if (drop && over && Math.hypot(lx - sx, ly - sy) > 12) { const t = document.elementFromPoint(lx, ly); planDrop(over, el.dataset.id, App.tlH ? lx : ly, grab, t); }
    };
    const up = () => end(true), cancel = () => end(false);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
/* ================= Alle Daten als Excel-Datei (.xlsx) exportieren ================= */
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
// Alle Daten des Planers in Tabellen
function exportAllSheets() {
  const yn = b => b === false ? 'nein' : 'ja', K = id => Store.get('kunden', id) || {}, M = id => maschine(id) || {};
  const ord = Store.all('auftraege').slice().sort((a, b) => (b.erledigtAm || b.datum || b.wunsch || '').localeCompare(a.erledigtAm || a.datum || a.wunsch || ''));
  const auftraege = [['Auftrag-Nr', 'Status', 'Kunde', 'Kunden-Nr', 'Arbeit', 'Kultur', 'Feld / Parzelle', 'Fläche ha', 'Fläche eff. ha', 'Wunschdatum', 'Datum', 'Startzeit', 'Dauer h', 'Stunden eff.', 'Erledigt am', 'Maschine', 'Erntejahr', 'Wasser l/ha', 'Stadium', 'Düse', 'Traktor', 'Nicht ÖLN-konform', 'Produkte', 'Bemerkung', 'ID'],
    ...ord.map(a => [a.nr, STATUS[statusOf(a)], K(a.kunde).name, K(a.kunde).nr, a.arbeit, a.kultur, a.feld || (a.kfeld && feldById(a.kfeld) ? feldById(a.kfeld).name : ''), a.flaeche, a.flaecheEff, a.wunsch, a.datum, a.zeit, a.dauer, a.stundenEff, a.erledigtAm, M(a.maschine).name,
      isSpray(a) ? ernteOf(a) : '', a.wasser, a.stadium, a.duese, a.traktor, a.nichtOeln ? 'ja' : '', prodList(a).map(p => `${p.name} ${p.menge ?? ''} ${p.einheit || ''}/ha`.trim()).join(', '), a.notiz, a.id])];
  const spritz = [['Auftrag-Nr', 'Datum', 'Kunde', 'Parzelle', 'Kultur', 'Erntejahr', 'Fläche ha', 'Produkt', 'Zulassung', 'Menge/ha', 'Einheit', 'Menge total', 'Nicht ÖLN-konform', 'Status', 'Auftrag-ID']];
  ord.filter(isSpray).forEach(a => prodList(a).forEach(p => { const fl = a.flaecheEff ?? a.flaeche; spritz.push([a.nr, a.erledigtAm || a.datum || a.wunsch, K(a.kunde).name, a.feld, a.kultur, ernteOf(a), fl, p.name, prodAt(prodOf(p), a.erledigtAm || a.datum).zulassung || '', p.menge, p.einheit, p.menge != null && fl != null ? r2(p.menge * fl) : '', (p.nichtOeln || a.nichtOeln) ? 'ja' : '', STATUS[statusOf(a)], a.id]); }));
  const kunden = [['Name', 'Kunden-Nr', 'Anrede', 'Adresse', 'PLZ', 'Ort', 'Telefon', 'Handy', 'E-Mail', 'Spritze CHF/ha', 'Fahrer CHF/ha', 'Traktor CHF/ha', 'Mittelzuschlag', 'Aktiv', 'MyJohnDeere-Name', 'MyJohnDeere-ID', 'Notiz', 'ID'],
    ...Store.all('kunden').sort(byName).map(k => [k.name, k.nr, k.anrede, k.adresse, k.plz, k.ort, k.tel, k.handy, k.mail, k.preisSpritze, k.preisFahrer, k.preisTraktor, k.zuschlag, yn(k.aktiv), k.jdName, k.jdId, k.notiz, k.id])];
  const felder = [['Kunde', 'Feld', 'Betrieb', 'Fläche ha', 'Aktiv', 'MyJohnDeere-ID', 'ID'], ...Store.all('felder').sort((a, b) => (K(a.kunde).name || '').localeCompare(K(b.kunde).name || '', 'de') || byName(a, b)).map(f => [K(f.kunde).name, f.name, f.betrieb, f.flaeche, yn(f.aktiv), f.jdId, f.id])];
  const parz = [['Kunde', 'Parzelle', 'Kultur', 'Fläche ha', 'Feld (MyJohnDeere)', 'Aktiv', 'ID'], ...Store.all('parzellen').sort((a, b) => (K(a.kunde).name || '').localeCompare(K(b.kunde).name || '', 'de') || byName(a, b)).map(p => [K(p.kunde).name, p.name, p.kultur, p.flaeche, feldById(p.feldId)?.name || '', yn(p.aktiv), p.id])];
  const use = prodUsage();
  const prod = [['Produkt', 'Zulassung', 'Einheit', 'Preis CHF', 'Inventar', 'Wert CHF', 'Inventar erfasst am', 'Zuletzt verwendet', 'Einsätze', 'Aktuell', 'ID'], ...Store.all('produkte').sort(byName).map(p => [p.name, p.zulassung, p.einheit, p.preis, p.inventar, p.inventar > 0 ? r2(p.inventar * (p.preis || 0)) : '', p.inventarAm, (use.get(p.id) || {}).last || '', (use.get(p.id) || {}).n || 0, yn(p.aktuell), p.id])];
  const verlauf = [['Produkt', 'Gültig ab', 'Name', 'Zulassung', 'Preis CHF']];
  Store.all('produkte').sort(byName).forEach(p => (p.verlauf || []).forEach(e => verlauf.push([p.name, e.ab === VERLAUF_START ? 'bisher' : e.ab, e.name, e.zulassung, e.preis])));
  const masch = [['Bezeichnung', 'Kurzname', 'Art.-Nr', 'Priorität', 'Verrechnung pro', 'Ansatz CHF', 'Flächenleistung ha/h', 'Arbeitsarten', 'Saison', 'Aktiv', 'ID'], ...Store.all('maschinen').sort(byPrio).map(m => [m.name, m.kurz, m.artNr, m.prio, m.einheit, m.ansatz, m.leistung, (m.arbeitsarten || []).join(', '), monthsLabel(m.monate), yn(m.aktiv), m.id])];
  const c = Store.cfg(), listen = [['Liste', 'Eintrag']];
  [['Arbeitsart', Lists.arbeitsarten()], ['Kultur', Lists.kulturen()], ['Düse', Lists.duesen()], ['Traktor', Lists.traktoren()]].forEach(([n, l]) => l.forEach(x => listen.push([n, x])));
  listen.push(['Einstellung', `Arbeitsbeginn ${c.beginn || ''}`], ['Einstellung', `Arbeitsende ${c.ende || ''}`], ['Export', `Stand ${new Date().toLocaleString('de-CH')}`]);
  return [{ name: 'Aufträge', rows: auftraege }, { name: 'Spritzprodukte', rows: spritz }, { name: 'Kunden', rows: kunden }, { name: 'Felder', rows: felder }, { name: 'Parzellen', rows: parz },
    { name: 'Produkte', rows: prod }, { name: 'Preisverlauf', rows: verlauf }, { name: 'Maschinen', rows: masch }, { name: 'Listen', rows: listen }];
}
function exportAllXlsx() {
  try {
    const sh = exportAllSheets();
    download(`Lohnarbeit-Daten_${todayIso()}.xlsx`, xlsxBlob(sh));
    toast(`Excel-Datei erstellt: ${sh.map(s => `${s.name} ${s.rows.length - 1}`).join(' · ')}`, 6000);
  } catch (e) { toast('Excel-Export fehlgeschlagen: ' + e.message, 6000); }
}
/* ================= Kunden und Felder aus MyJohnDeere ================= */
// Sobald ein Abgleich mit MyJohnDeere eingelesen wurde, werden Kunden und Felder nur noch dort gepflegt.
const jdLock = () => !!Store.cfg().jdStand;
const felderOf = (kid, alle) => Store.all('felder').filter(f => f.kunde === kid && (alle || f.aktiv !== false)).sort(byName);
const feldById = id => id ? Store.get('felder', id) : null;
const feldLabel = f => `${f.name}${f.flaeche ? ` · ${fmtNum(f.flaeche)} ha` : ''}${f.betrieb ? ` · ${f.betrieb}` : ''}`;
function feldOptions(kid, cur) {
  const list = Store.all('felder').filter(f => f.kunde === kid && (f.aktiv !== false || f.id === cur)).sort(byName);
  return `<option value="">— kein Feld —</option>` + list.map(f => `<option value="${f.id}" ${f.id === cur ? 'selected' : ''}>${esc(feldLabel(f))}</option>`).join('');
}
const parzOfFeld = fid => Store.all('parzellen').filter(p => p.feldId === fid).sort(byName);

// Feld-Auswahl im Auftrag
function wireFeld(f, a) {
  const sel = f.kfeld; if (!sel) return;
  const box = sel.closest('.fld');
  const refresh = () => {
    const k = findKunde(f.kunde.value), cur = sel.value || a.kfeld || '';
    sel.innerHTML = feldOptions(k ? k.id : '', cur);
    box.hidden = !(k && Store.all('felder').some(x => x.kunde === k.id && (x.aktiv !== false || x.id === cur)));
  };
  f.kunde.addEventListener('input', refresh);
  sel.addEventListener('change', () => {
    const fd = feldById(sel.value);
    if (fd && fd.flaeche && !f.flaeche.value) { f.flaeche.value = fd.flaeche; f.flaeche.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  if (f.parzelle) f.parzelle.addEventListener('change', () => { const p = Store.get('parzellen', f.parzelle.value); if (p && p.feldId && feldById(p.feldId)) { refresh(); sel.value = p.feldId; } });
  refresh();
}

// Kundenkarte: Felder anzeigen, Pflanzenschutz-Parzellen zuweisen
function felderSection(kid) {
  const fs = felderOf(kid, true).sort((a, b) => (a.aktiv === false) - (b.aktiv === false));
  if (!fs.length) return `<div class="box"><h4>🌾 Felder</h4><p class="nr" style="margin:0">${jdLock() ? 'Für diesen Kunden sind in MyJohnDeere keine Felder erfasst.' : 'Felder werden aus MyJohnDeere übernommen (Kunden › MyJohnDeere-Abgleich).'}</p></div>`;
  const tot = fs.filter(f => f.aktiv !== false).reduce((s, f) => s + (f.flaeche || 0), 0);
  return `<div class="box"><h4>🌾 Felder aus MyJohnDeere <small class="nr">${fs.filter(f => f.aktiv !== false).length} · ${fmtNum(r2(tot))} ha</small></h4>
    <div class="feldlist">${fs.map(f => { const ps = parzOfFeld(f.id); return `<div class="feldrow ${f.aktiv === false ? 'off' : ''}">
      <div class="grow"><b>${esc(f.name)}</b> <span class="nr">${f.flaeche ? fmtNum(f.flaeche) + ' ha' : ''}${f.betrieb ? ' · ' + esc(f.betrieb) : ''}${f.aktiv === false ? ' · archiviert' : ''}</span>
        <div class="s">${ps.length ? '🧪 ' + ps.map(p => esc(p.name)).join(', ') : '<span class="nr">keine Pflanzenschutz-Parzelle zugewiesen</span>'}</div></div>
      <button type="button" class="btn small" data-act="feldAssign" data-id="${f.id}">Parzellen zuweisen</button></div>`; }).join('')}</div></div>`;
}
function feldAssignDialog(fid) {
  const fd = feldById(fid); if (!fd) return;
  const ps = Store.all('parzellen').filter(p => p.kunde === fd.kunde && (p.aktiv !== false || p.feldId === fid)).sort(byName);
  const body = ps.length ? `<p class="nr" style="margin-top:0">Pflanzenschutz-Parzellen von ${esc(kundeName(fd.kunde))}, die zum Feld <b>${esc(fd.name)}</b> gehören. Mehrere sind möglich.</p>
    <div class="checklist">${ps.map(p => { const other = p.feldId && p.feldId !== fid ? feldById(p.feldId) : null; return `<label><input type="checkbox" name="p" value="${p.id}" ${p.feldId === fid ? 'checked' : ''}>
      <span><b>${esc(p.name)}</b> <span class="nr">${p.flaeche ? fmtNum(p.flaeche) + ' ha' : ''}${p.kultur ? ' · ' + esc(p.kultur) : ''}${other ? ` · zurzeit bei «${esc(other.name)}»` : ''}</span></span></label>`; }).join('')}</div>`
    : '<p>Dieser Kunde hat noch keine Pflanzenschutz-Parzellen (Spritzen › Stammdaten › Parzellen).</p>';
  smallDialog(`Parzellen → ${esc(fd.name)}`, body, 'Zuweisen', data => {
    const on = new Set(data.getAll('p'));
    const ch = ps.filter(p => on.has(p.id) !== (p.feldId === fid)).map(p => ({ ...p, feldId: on.has(p.id) ? fid : '' }));
    if (ch.length) Store.putMany('parzellen', ch);
    const box = Dlg.el.open && $('#felderBox', Dlg.form); if (box) box.innerHTML = felderSection(fd.kunde);
    toast(ch.length ? 'Zuweisung gespeichert' : 'Keine Änderung');
  });
}

/* ---------- Abgleich: Datei «jd-sync.json» (vom NAS-Dienst in den Dropbox-Ordner geschrieben) ---------- */
// Format: { format:'jd-sync', stand, org:{id,name}, clients:[{id,name}], farms:[{id,name,client}], fields:[{id,name,client,farm,flaeche,archived}] }
async function jdSyncOpen() {
  let d = null, src = '';
  if (Auth.configured() && Auth.hasSession() && navigator.onLine) {
    try { d = await Drive.readJson('/jd-sync.json'); src = 'Dropbox'; } catch (e) { d = null; }
  }
  if (!d) {
    if (!confirm('Im Dropbox-Ordner wurde keine Abgleichsdatei «jd-sync.json» gefunden. Datei manuell wählen?')) return;
    const file = await pickFile('.json,application/json'); if (!file) return;
    try { d = JSON.parse(await readText(file)); src = file.name; } catch { toast('Datei konnte nicht gelesen werden'); return; }
  }
  if (d.format !== 'jd-sync' || !Array.isArray(d.clients)) { toast('Keine gültige MyJohnDeere-Abgleichsdatei'); return; }
  jdSyncDialog(d, src);
}
// Wiedererkennung über die Felder: passen die Feldnamen des Mandanten zu den Feldern eines noch nicht verknüpften Kunden?
// (z.B. wenn der Name in MyJohnDeere vor der ersten Verknüpfung geändert wurde)
function jdFieldMatch(c, d, cand) {
  const jf = (d && d.fields || []).filter(f => f.client === c.id && !f.archived); if (!jf.length) return '';
  let best = '', bestN = 0, bestS = 0;
  cand.forEach(k => {
    const own = Store.all('felder').filter(x => x.kunde === k.id);
    const hits = jf.filter(f => own.some(x => norm(x.jdName || x.name) === norm(f.name)
      && (jf.length > 1 || (f.flaeche != null && x.flaeche != null && Math.abs(f.flaeche - x.flaeche) <= 0.05)))).length;
    const sc = hits / jf.length;
    if (sc > bestS || (sc === bestS && hits > bestN)) { best = k.id; bestS = sc; bestN = hits; }
  });
  return bestS >= 0.5 && (bestN >= 2 || jf.length === 1) ? best : '';
}
function jdMatch(c, d) {
  const ks = Store.all('kunden');
  const linked = ks.find(k => k.jdId === c.id); if (linked) return linked.id;
  const byName = ks.find(k => !k.jdId && k.jdName && norm(k.jdName) === norm(c.name)); if (byName) return byName.id; // aus Excel-Export übernommen
  const n = norm(c.name), sw = n.split(/\s+/).reverse().join(' ');
  const hit = ks.find(k => !k.jdId && (norm(k.name) === n || norm(k.name) === sw)); if (hit) return hit.id;
  return jdFieldMatch(c, d, ks.filter(k => !k.jdId));
}
// Vom Abgleich doppelt angelegte Kunden (Name in MyJohnDeere vor der ersten Verknüpfung geändert) zurückführen:
// der neu angelegte Kunde wird entfernt, sofern er noch nicht verwendet wird; der bisherige Kunde übernimmt die Verknüpfung.
function jdRepair(d) {
  let n = 0;
  (d.clients || []).forEach(c => {
    const dup = Store.all('kunden').find(k => k.jdId === c.id && k.id.startsWith('jdk-')); if (!dup) return;
    if (Store.all('auftraege').some(a => a.kunde === dup.id) || Store.all('parzellen').some(p => p.kunde === dup.id)) return;
    const dupF = Store.all('felder').filter(f => f.kunde === dup.id);
    if (dupF.some(f => Store.all('parzellen').some(p => p.feldId === f.id))) return;
    const old = jdFieldMatch(c, d, Store.all('kunden').filter(k => !k.jdId && k.id !== dup.id)); if (!old) return;
    if (dupF.length) Store.putMany('felder', dupF.map(f => ({ id: f.id, del: true })));
    Store.putMany('kunden', [{ id: dup.id, del: true }]);
    n++;
  });
  return n;
}
// Abgleich anwenden. map(c) → '+' (neu), '-' (überspringen) oder Kunden-ID
function jdApply(d, map) {
  const farms = Object.fromEntries((d.farms || []).map(f => [f.id, f.name]));
  const kOut = [], fOut = [], ids = new Set((d.clients || []).map(c => c.id));
  let neu = 0, fNeu = 0, fUpd = 0, fArch = 0, kInakt = 0, react = 0;
  const same = (a, b, keys) => keys.every(x => (a[x] ?? '') === (b[x] ?? ''));
  d.clients.forEach(c => {
    const v = map(c, d); if (!v || v === '-') return;
    const old = v === '+' ? null : Store.get('kunden', v);
    const k = old ? { ...old } : { id: 'jdk-' + c.id, aktiv: true };
    if (!old) neu++;
    Store.all('kunden').filter(x => x.jdId === c.id && x.id !== k.id).forEach(x => kOut.push({ ...x, jdId: '' }));
    Object.assign(k, { jdId: c.id, jdName: c.name, name: c.name });
    // in MyJohnDeere vorhanden → aktiv (ausser von Hand inaktiv gesetzt); vom Abgleich inaktiv gesetzte Kunden kommen so zurück
    if (c.archived) k.aktiv = false; else if (!k.manInaktiv && k.aktiv === false) { k.aktiv = true; react++; }
    if (!old || !same(old, k, ['jdId', 'jdName', 'name', 'aktiv'])) kOut.push(k);
    const seen = new Set();
    (d.fields || []).filter(f => f.client === c.id).forEach(f => {
      // bestehendes Feld per ID oder (aus dem Excel-Export) per Name wiederverwenden – Parzellen-Zuweisungen bleiben erhalten
      const of = Store.data.felder.find(x => x.id === 'jdf-' + f.id && !x.del) || Store.data.felder.find(x => !x.del && x.jdId === f.id)
        || Store.data.felder.find(x => !x.del && x.kunde === k.id && !x.jdId && !seen.has(x.id) && norm(x.jdName || x.name) === norm(f.name));
      const id = of ? of.id : 'jdf-' + f.id; seen.add(id);
      const nf = { ...(of || {}), id, kunde: k.id, jdId: f.id, jdName: f.name, name: f.name, betrieb: farms[f.farm] || '', flaeche: f.flaeche != null ? r2(+f.flaeche) : (of ? of.flaeche ?? null : null), aktiv: !f.archived };
      if (!of) fNeu++; else if (!same(of, nf, ['kunde', 'jdId', 'name', 'betrieb', 'flaeche', 'aktiv'])) fUpd++; else return;
      fOut.push(nf);
    });
    Store.all('felder').filter(x => x.kunde === k.id && (x.jdId || x.jdName) && !seen.has(x.id) && x.aktiv !== false).forEach(x => { fArch++; fOut.push({ ...x, aktiv: false }); });
  });
  if (d.full !== false && d.clients.length) Store.all('kunden').filter(k => k.jdId && !ids.has(k.jdId) && k.aktiv !== false && !kOut.some(x => x.id === k.id)).forEach(k => { kInakt++; kOut.push({ ...k, aktiv: false }); });
  if (kOut.length) Store.putMany('kunden', kOut);
  if (fOut.length) Store.putMany('felder', fOut);
  Store.setCfg({ jdStand: d.stand || new Date().toISOString(), jdOrg: d.org?.name || '', jdDienst: d.dienst || '' }, { silent: false });
  Store.setCfg({ jdEbene: d.kundenEbene || '' }, { silent: true });
  return { neu, fNeu, fUpd, fArch, kInakt, react, changed: kOut.length + fOut.length };
}
const jdSummary = r => `${r.neu} Kunden neu${r.react ? `, ${r.react} wieder aktiv` : ''}${r.kInakt ? `, ${r.kInakt} inaktiv` : ''}, ${r.fNeu} Felder neu, ${r.fUpd} geändert, ${r.fArch} archiviert`;
// Beim Start: neue Abgleichsdatei vom NAS automatisch übernehmen
async function jdAuto() {
  if (!Auth.configured() || !Auth.hasSession() || !navigator.onLine) return;
  let d; try { d = await Drive.readJson('/jd-sync.json'); } catch { return; }
  if (!d || d.format !== 'jd-sync' || !Array.isArray(d.clients)) return;
  // Schutz: Datei mit anderer Kundenebene (Mandanten statt Betriebe) oder in der viele bisherige Kunden fehlen,
  // wird nicht automatisch übernommen – sonst würden Felder umgehängt und Kunden inaktiv gesetzt.
  const ids = new Set(d.clients.map(c => c.id)), linked = Store.all('kunden').filter(k => k.jdId && k.aktiv !== false);
  const fehlen = linked.filter(k => !ids.has(k.jdId)).length, cE = Store.cfg().jdEbene;
  if ((cE && d.kundenEbene && cE !== d.kundenEbene) || (linked.length >= 5 && fehlen > linked.length * 0.3)) {
    if (d.stand !== jdAuto._warned) { jdAuto._warned = d.stand; toast(`MyJohnDeere-Abgleich NICHT übernommen: ${cE && cE !== d.kundenEbene ? `die Datei enthält ${d.kundenEbene === 'farms' ? 'Betriebe' : 'Mandanten'} statt ${cE === 'farms' ? 'Betriebe' : 'Mandanten'} als Kunden` : `${fehlen} von ${linked.length} Kunden fehlen in der Datei`}. Bitte im NAS-Dienst prüfen; übernehmen nur über «Abgleich prüfen…».`, 12000); }
    return;
  }
  const rep = jdRepair(d);
  const inaktivDa = Store.all('kunden').some(k => k.jdId && ids.has(k.jdId) && k.aktiv === false && !k.manInaktiv && !d.clients.find(c => c.id === k.jdId)?.archived);
  if (!rep && !inaktivDa && Store.cfg().jdStand && d.stand <= Store.cfg().jdStand) return;
  const used = new Set();
  const r = jdApply(d, c => { const m = jdMatch(c, d); if (!m || used.has(m)) return '+'; used.add(m); return m; });
  if (r.changed || rep) toast(`MyJohnDeere übernommen: ${jdSummary(r)}${rep ? ` · ${rep} doppelte Kunden zusammengeführt` : ''}`, 6000);
}
// «Jetzt abgleichen»: Anfrage für den NAS-Dienst in den Dropbox-Ordner legen
async function jdRequest() {
  if (!Auth.configured() || !Auth.hasSession()) { toast('Zuerst mit Dropbox verbinden (Mehr › Dropbox)'); return; }
  try { await Drive.writeJson('/jd-sync-request.json', { at: new Date().toISOString() }); toast('Anfrage gesendet – der NAS-Dienst gleicht in den nächsten Minuten ab und der Planer übernimmt es danach automatisch.', 6000); }
  catch (e) { toast('Anfrage fehlgeschlagen: ' + e.message, 5000); }
  clearTimeout(jdRequest._t); let n = 0;
  const poll = async () => { const before = Store.cfg().jdStand; await jdAuto(); if (Store.cfg().jdStand !== before || ++n > 12) return; jdRequest._t = setTimeout(poll, 60000); };
  jdRequest._t = setTimeout(poll, 90000);
}
function jdSyncDialog(d, src) {
  const rep = jdRepair(d); if (rep) toast(`${rep} doppelte Kunden zusammengeführt`);
  const nF = c => (d.fields || []).filter(f => f.client === c.id && !f.archived).length;
  const ks = Store.all('kunden').sort(byName);
  const clients = d.clients.slice().sort(byName);
  const body = `<p class="nr" style="margin-top:0">Stand ${esc(d.stand ? new Date(d.stand).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '?')} · ${esc(d.org?.name || '')} · Quelle: ${esc(src)}</p>
    <p class="nr">Ordne jeden Mandanten einem Kunden zu. Kunden mit bisherigen Aufträgen (z.B. aus ErfassungPS) bitte zuordnen statt neu anlegen – die Zuordnung wird gespeichert.</p>
    <div class="rows">${clients.map(c => { const m = jdMatch(c, d); return `<div class="rowi jdrow"><div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${nF(c)} Felder</div></div>
      <select class="input" name="map_${esc(c.id)}" style="max-width:260px"><option value="+" ${m ? '' : 'selected'}>＋ neu anlegen</option><option value="-">nicht übernehmen</option>
        ${ks.map(k => `<option value="${k.id}" ${k.id === m ? 'selected' : ''}>${esc(k.name)}${k.jdId && k.jdId !== c.id ? ' (bereits verknüpft)' : ''}</option>`).join('')}</select></div>`; }).join('')}</div>`;
  Dlg.open('MyJohnDeere-Abgleich', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Übernehmen</button>`, fd => {
    const r = jdApply({ ...d, full: false }, c => fd.get('map_' + c.id));
    toast(`Abgleich: ${jdSummary(r)}`, 6000); return true;
  });
}
/* ================= JD-Arbeitsbericht: Arbeitsgänge aus MyJohnDeere auswerten =================
   Quelle: «jd-arbeiten.json» im Dropbox-Ordner (vom NAS-Dienst jd-sync). Vorerst ohne Verknüpfung zu den Planungsdaten. */
const JDB_ART = { seeding: 'Säen', application: 'Pflanzenschutz / Düngung', harvest: 'Ernte', tillage: 'Bodenbearbeitung', fertilizing: 'Düngung', mowing: 'Mähen', baling: 'Pressen' };
const JDB_MACH = { combine: 'Mähdrescher', tractor: 'Traktor', sprayer: 'Feldspritze', windrower: 'Schwader', forageHarvester: 'Feldhäcksler' };
const JDB_CROP = { CORN: 'Mais', CORN_WET: 'Mais', CORN_SILAGE: 'Silomais', SILAGE_CORN: 'Silomais', WHEAT: 'Weizen', WHEAT_WINTER: 'Winterweizen', WHEAT_SPRING: 'Sommerweizen', WINTER_WHEAT: 'Winterweizen', SPRING_WHEAT: 'Sommerweizen',
  BARLEY: 'Gerste', BARLEY_WINTER: 'Wintergerste', BARLEY_SPRING: 'Sommergerste', WINTER_BARLEY: 'Wintergerste', SPRING_BARLEY: 'Sommergerste', TRITICALE: 'Triticale', RYE: 'Roggen', OATS: 'Hafer', SPELT: 'Dinkel',
  CANOLA: 'Raps', RAPESEED: 'Raps', RAPESEED_WINTER: 'Winterraps', WINTER_RAPESEED: 'Winterraps', SOYBEANS: 'Soja', SUNFLOWERS: 'Sonnenblumen', SUGAR_BEETS: 'Zuckerrüben', SUGARBEETS: 'Zuckerrüben', SUGAR_BEET: 'Zuckerrüben', SUGARBEET: 'Zuckerrüben',
  POTATOES: 'Kartoffeln', PEAS: 'Erbsen', FIELD_BEANS: 'Ackerbohnen', GRASS: 'Gras', ALFALFA: 'Luzerne', CLOVER: 'Klee', FALLOW: 'Brache', COVER_CROP: 'Zwischenfrucht',
  WHEAT_EURO_WTR: 'Winterweizen', WHEAT_EURO_SPR: 'Sommerweizen', WHEAT_HRD_RD_SPR: 'Sommerweizen', WHEAT_HRD_RD_WTR: 'Winterweizen', BARLEY_EURO_WTR: 'Wintergerste', BARLEY_EURO_SPR: 'Sommergerste',
  GRASS_SEEDS: 'Gras', GRASS_CLOVER: 'Kleegras', RAPE_SEED: 'Raps', RAPE_SEED_E_OIL: 'Raps', PHACELIA: 'Phacelia', MUSTARD: 'Senf', TRITICALE_EURO: 'Triticale', PEAS_EURO: 'Eiweisserbsen', PEAS_FIELD: 'Erbsen',
  LUPINS: 'Lupinen', OATS_EURO: 'Hafer', RYE_EURO: 'Roggen', SPELT_EURO: 'Dinkel', CORN_EURO: 'Mais', UNSPECIFIED_CROP: '' };
const jdbCrop = c => !c ? '' : String(c).toUpperCase() in JDB_CROP ? JDB_CROP[String(c).toUpperCase()] : String(c).replace(/_/g, ' ').toLowerCase().replace(/^\w/, x => x.toUpperCase());
const jdbVal = x => x == null ? null : typeof x === 'number' ? x : x.valueAsDouble ?? x.value ?? null;
const jdbUnit = x => !x || typeof x !== 'object' ? '' : String(x.unitId || x.unit || '').replace(/1(ha|ac)-1$/, '/$1').replace(/^seeds/, 'Korn').replace(/^prcnt$/, '%').replace(/^mm$/, 'mm');
const jdbFmt = x => { const v = jdbVal(x); return v == null ? '' : `${fmtNum(Math.round(v * 100) / 100)} ${jdbUnit(x)}`.trim(); };
function jdbHa(x) { const v = jdbVal(x); if (v == null) return null; const u = String((x && (x.unitId || x.unit)) || 'ha').toLowerCase(); const ha = u === 'ac' ? v * 0.40468564 : (u === 'm2' || u === 'sqm') ? v / 10000 : v; return Math.round(ha * 100) / 100; }
const jdbNames = v => (Array.isArray(v) ? v : v ? [v] : []).map(x => typeof x === 'string' ? x : x && (x.name || x.displayName || x.vin || x.serialNumber || '')).filter(Boolean);
const JDB_KEYS = { area: 'Fläche', averageYield: 'Ø Ertrag', totalYield: 'Ertrag total', averageMaterial: 'Ø Menge', totalMaterial: 'Menge total', averageMoisture: 'Ø Feuchte', averageDepth: 'Ø Tiefe', averageSpeed: 'Ø Geschwindigkeit', wetMass: 'Nassmasse', averageWetMass: 'Ø Nassmasse', dryMass: 'Trockenmasse', averageTargetRate: 'Ø Sollmenge', productTotals: 'Produkte', varietyTotals: 'Sorten', cropName: 'Kultur' };
const JDB_MNAME = { HarvestYieldResult: 'Ertrag', HarvestMoistureResult: 'Feuchte', ApplicationRateResult: 'Ausbringung', SeedingRateResult: 'Saat', TillageDepthResult: 'Bodenbearbeitung', TillageSpeedResult: 'Geschwindigkeit' };
const JDB_SKIP = new Set(['@type', 'measurementName', 'measurementCategory', 'links', 'productTotals', 'varietyTotals', 'id']);
// Fläche wie JD_Arbeitsbericht 1.14: Ergebnis-Messungen (…Result) bevorzugt, sonst grösste Produkt-/Sortensumme
const JDB_HA = { ha: 1, ac: 0.40468564224, m2: 0.0001, 'm^2': 0.0001, sqm: 0.0001, a: 0.01, km2: 100 };
const jdbHa1 = a => { if (!a || typeof a !== 'object') return null; const v = a.valueAsDouble ?? a.value; if (v == null || isNaN(+v)) return null; const f = JDB_HA[String(a.unitId || a.unit || 'ha').trim().toLowerCase()]; return f == null ? null : +v * f; };
function jdbMeasArea(ms) {
  let best = null;
  for (const m of ms || []) {
    if (!m || typeof m !== 'object') continue;
    let a = jdbHa1(m.area);
    if (a == null) { const n = ['applicationProductTotals', 'productTotals', 'varietyTotals'].flatMap(k => (m[k] || []).map(t => t && (jdbHa1(t.area) || jdbHa1(t.appliedArea)))).filter(x => x != null); a = n.length ? Math.max(...n) : null; }
    if (a == null) continue;
    const prio = String(m.measurementName || '').endsWith('Result') ? 0 : 1;
    if (!best || prio < best[0] || (prio === best[0] && a > best[1])) best = [prio, a];
  }
  return best ? best[1] : null;
}
// Produkte inkl. Tankmischungen, Platzhalter («---», «unknown») weglassen
const JDB_PH = new Set(['', '---', '--', '-', 'unknown', 'unbekannt']);
function jdbCollect(items, out) {
  for (const p of (Array.isArray(items) ? items : items ? [items] : [])) {
    if (!p || typeof p !== 'object') { if (typeof p === 'string' && !JDB_PH.has(p.trim().toLowerCase())) out.push({ n: p }); continue; }
    const n = p.name || p.product?.name; if (n && !JDB_PH.has(String(n).trim().toLowerCase())) out.push({ n: String(n), r: p.averageMaterial ? jdbFmt(p.averageMaterial) : '' });
    for (const sub of ['components', 'tankMixComponents', 'products']) if (Array.isArray(p[sub])) jdbCollect(p[sub], out);
  }
}
function jdbCrops(raw, ms) {
  const found = [];
  const from = o => { if (!o || typeof o !== 'object') return; for (const k of ['cropName', 'treatedCropName', 'crop', 'cropType']) { const v = o[k]; if (typeof v === 'string' && v) found.push(v); else if (v && typeof v === 'object') { const n = v.name || v.displayName || v.id; if (n) found.push(String(n)); } } for (const k of ['varieties', 'varietyTotals']) (o[k] || []).forEach(from); };
  from(raw); (ms || []).forEach(from);
  return [...new Set(found.map(jdbCrop).filter(Boolean))].join(', ');
}
// Gesamtmenge je Produkt aus den Ergebnis-Messungen (…Result): Pflanzenschutz/Dünger je Produkt (bei Tankmischungen je Komponente, ohne Trägerstoff),
// Saatgut je Sorte bzw. gesamt, Ernte als Ertrag. Sollwerte (…Target) werden nicht verwendet.
function jdbGesamt(ms) {
  const res = (ms || []).filter(m => m && (m.measurementCategory === 'Result' || /Result$/.test(m.measurementName || '')));
  const out = new Map(), add = (n, x) => { const v = jdbVal(x); if (v == null || !(v > 0) || !n) return; const k = String(n).trim(); if (JDB_PH.has(k.toLowerCase())) return; if (!out.has(k)) out.set(k, jdbFmt(x)); };
  for (const m of res) {
    for (const ap of [...(m.applicationProductTotals || []), ...(m.productTotals || [])]) {
      const comps = (ap.productTotals || []).filter(p => p && !p.carrier);
      if (comps.length > 1) comps.forEach(p => add(p.name, p.totalMaterial)); else add(ap.name || comps[0]?.name, ap.totalMaterial || comps[0]?.totalMaterial);
    }
    for (const v of (m.varietyTotals || [])) add(v.name, v.totalMaterial);
  }
  if (!out.size) for (const m of res) {
    if (/^Seeding/.test(m.measurementName || '') && m.totalMaterial) add('Saatgut', m.totalMaterial);
    if (m.measurementName === 'HarvestYieldResult') add('Ertrag', m.wetMass || m.yield || m.totalYield);
  }
  return [...out].map(([n, v]) => `${n} ${v}`).join(', ');
}
// einen Arbeitsgang aus der Datei in eine Berichtszeile umwandeln (robust gegen unterschiedliche Strukturen)
function jdbRow(o) {
  const raw = o.raw || {}, ms = Array.isArray(o.measurements) ? o.measurements : [], ex = o.extra || {};
  const exOf = re => Object.entries(ex).filter(([k]) => re.test(k)).flatMap(([, v]) => jdbNames(v));
  const nas = o.flaeche != null && o.flaecheQuelle !== 'Feldgrenze'; // Feldgrenze wird nicht als Ersatz verwendet
  const mArea = jdbMeasArea(ms), haV = nas ? o.flaeche : mArea != null ? mArea : jdbHa(raw.area) ?? null;
  const quelle = nas ? (o.flaecheQuelle || '') : haV != null ? 'Maschine' : '';
  const pl = []; jdbCollect(raw.products, pl); jdbCollect(raw.product, pl); jdbCollect(raw.tillageProducts, pl);
  ms.forEach(m => { jdbCollect(m.applicationProductTotals, pl); jdbCollect(m.productTotals, pl); });
  exOf(/product|tankmix/i).forEach(n => pl.push({ n }));
  const seenP = new Map(); pl.forEach(p => { const k = p.n.toLowerCase(); if (!seenP.has(k) || (!seenP.get(k).r && p.r)) seenP.set(k, p); });
  const prodTxt = [...seenP.values()].map(p => p.r ? `${p.n} ${p.r}` : p.n).join(', ');
  const sl = []; jdbCollect(raw.varieties, sl); ms.forEach(m => jdbCollect(m.varietyTotals, sl)); exOf(/variet/i).forEach(n => sl.push({ n }));
  const sorten = [...new Set(sl.map(x => x.n))];
  const crop = jdbCrops(raw, ms);
  const mach = o.machines && o.machines.length ? o.machines : [...new Set([...exOf(/machine|equipment|implement/i), ...jdbNames(raw.machines)])];
  const fahrer = [...new Set([...exOf(/operator/i), ...jdbNames(raw.operators)])];
  const rateM = ms.find(m => m.averageYield || m.averageMaterial || m.averageDepth);
  const rate = rateM ? jdbFmt(rateM.averageYield || rateM.averageMaterial || rateM.averageDepth) : '';
  const start = o.start || raw.startDate || '', end = o.end || raw.endDate || '';
  const dauer = start && end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 36e5) : null;
  const details = ms.map(m => ({ n: JDB_MNAME[m.measurementName] || m.measurementName || m['@type'] || 'Messwerte', v: Object.entries(m).filter(([k, v]) => !JDB_SKIP.has(k) && v != null)
    .map(([k, v]) => [JDB_KEYS[k] || k, typeof v === 'object' && !Array.isArray(v) ? jdbFmt(v) || JSON.stringify(v).slice(0, 80) : Array.isArray(v) ? jdbNames(v).join(', ') || `${v.length} Einträge` : String(v)]).filter(([, v]) => v) }));
  const type = o.type || raw.fieldOperationType || '';
  return { id: o.id, d: String(start).slice(0, 10), start, end, dauer, type, arbeit: JDB_ART[type] || type || '–',
    kunde: o.clientName || '', feld: o.fieldName || '', ha: haV != null ? Math.round(haV * 100) / 100 : null, quelle, maschine: mach.join(', ') || JDB_MACH[o.machineType || raw.adaptMachineType] || o.machineType || raw.adaptMachineType || '',
    fahrer: fahrer.join(', '), kultur: crop, produkte: prodTxt, sorten: sorten.join(', '), menge: rate, gesamt: jdbGesamt(ms), saison: o.cropSeason || raw.cropSeason || '', details };
}
const JDB_KEY = 'lp_jdb';
function jdbCache(rows, meta) { try { localStorage.setItem(JDB_KEY, JSON.stringify({ meta, rows })); } catch { } }
function jdbFromCache() { try { const c = JSON.parse(localStorage.getItem(JDB_KEY) || 'null'); if (c && Array.isArray(c.rows)) { App.jdb.rows = c.rows; App.jdb.meta = c.meta; return true; } } catch { } return false; }
function jdbApply(d, src) {
  if (!d || d.format !== 'jd-arbeiten' || !Array.isArray(d.operations)) { toast('Keine gültige Datei mit Arbeitsdaten (jd-arbeiten.json)'); return false; }
  const rows = d.operations.map(jdbRow).filter(r => r.d);
  App.jdb.rows = rows; App.jdb.meta = { stand: d.stand, org: d.org?.name || '', seit: d.seit, src, n: rows.length, dienst: d.dienst || '', bedeckung: d.bedeckung || null };
  jdbCache(rows, App.jdb.meta); return true;
}
async function jdbLoad(silent) {
  const J = App.jdb;
  if (!Auth.configured() || !Auth.hasSession()) { if (!silent) toast('Zuerst mit Dropbox verbinden (Mehr › Dropbox)'); return; }
  J.loading = true; if (App.view === 'jdbericht') App.render();
  try { const d = await Drive.readJson('/jd-arbeiten.json'); if (d) { if (jdbApply(d, 'Dropbox') && !silent) toast(`${App.jdb.rows.length} Arbeitsgänge geladen`); } else if (!silent) toast('Im Dropbox-Ordner liegt noch keine «jd-arbeiten.json»'); }
  catch (e) { if (!silent) toast('Laden fehlgeschlagen: ' + e.message, 5000); }
  J.loading = false; J.tried = true; if (App.view === 'jdbericht') App.render();
}
async function jdbFile() {
  const file = await pickFile('.json,application/json'); if (!file) return;
  try { if (jdbApply(JSON.parse(await readText(file)), file.name)) { toast(`${App.jdb.rows.length} Arbeitsgänge geladen`); App.render(); } } catch { toast('Datei konnte nicht gelesen werden'); }
}
function jdbPreset(v) {
  const J = App.jdb, t = new Date(), y = t.getFullYear();
  if (v === 'jahr') { J.von = `${y}-01-01`; J.bis = todayIso(); }
  else if (v === 'vorjahr') { J.von = `${y - 1}-01-01`; J.bis = `${y - 1}-12-31`; }
  else if (v === '30') { J.von = isoDate(addDays(t, -30)); J.bis = todayIso(); }
  else if (v === 'woche') { J.von = isoDate(addDays(t, -((t.getDay() + 6) % 7))); J.bis = todayIso(); }
  else if (v === 'alle') { J.von = ''; J.bis = ''; }
  App.render();
}
/* ---------- Filter mit Mehrfachauswahl: J.k, J.a, J.f, J.m, J.c sind Listen (leer = alle) ---------- */
const JDB_MS = { k: ['kunde', 'Kunde', 'Alle Kunden'], a: ['arbeit', 'Arbeit', 'Alle Arbeiten'], f: ['feld', 'Feld', 'Alle Felder'], m: ['maschine', 'Maschine', 'Alle Maschinen'], c: ['kultur', 'Kultur', 'Alle Kulturen'] };
const jdbArr = v => Array.isArray(v) ? v : v ? [v] : [];
function jdbFilter(J, skip = '') {
  const q = norm(J.q), ok = (key, val) => skip === key || !jdbArr(J[key]).length || jdbArr(J[key]).includes(val);
  return r => (!J.von || r.d >= J.von) && (!J.bis || r.d <= J.bis)
    && ok('k', r.kunde) && ok('a', r.arbeit) && ok('f', r.feld) && ok('c', r.kultur)
    && (skip === 'm' || !jdbArr(J.m).length || r.maschine.split(', ').some(x => jdbArr(J.m).includes(x)))
    && (!+J.minHa || r.ha == null || r.ha >= +J.minHa)
    && (!J.ab || (J.ab === 'ja') === !!jdbAbr(r.id))
    && (!q || [r.kunde, r.feld, r.arbeit, r.maschine, r.kultur, r.produkte, r.sorten, r.fahrer].join(' ').toLowerCase().includes(q));
}
const JDB_GRP = [['', 'keine'], ['kunde', 'Kunde'], ['arbeit', 'Arbeit'], ['maschine', 'Maschine'], ['feld', 'Feld'], ['kultur', 'Kultur'], ['monat', 'Monat']];
const jdbGroupKey = (r, g) => g === 'monat' ? r.d.slice(0, 7) : (r[g] || '');
const jdbGroupLabel = (k, g) => g === 'monat' && k ? `${MONATE_LANG[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : (k || '–');
const jdbList = () => { const J = App.jdb; return (J.rows || []).filter(jdbFilter(J)).sort((a, b) => J.sort === 'asc' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)); };
const jdbHaSum = l => r2(l.reduce((s, r) => s + (r.ha || 0), 0));
/* ---------- Abgerechnet: Markierung je Arbeitsgang, gespeichert in den Planer-Daten (synchronisiert) ---------- */
const JDB_ABR = 'jdabr-';
const jdbAbr = id => Store.get('einstellungen', JDB_ABR + id);
function jdbMark(ids, on) {
  const now = todayIso(), ch = [];
  ids.forEach(id => { const x = jdbAbr(id); if (on && !x) ch.push({ id: JDB_ABR + id, jdabr: true, am: now }); else if (!on && x) ch.push({ id: JDB_ABR + id, del: true }); });
  if (ch.length) Store.putMany('einstellungen', ch); else App.render();
  return ch.length;
}
function jdbMarkSel(on) {
  const S = App.jdbSel || new Set(), ids = jdbList().filter(r => S.has(r.id)).map(r => r.id); if (!ids.length) return;
  const n = jdbMark(ids, on); S.clear(); App.render();
  toast(n ? `${n} ${n === 1 ? 'Arbeitsgang' : 'Arbeitsgänge'} ${on ? 'als abgerechnet markiert' : 'wieder offen'}` : `Bereits ${on ? 'abgerechnet' : 'offen'}`);
}
function jdbSelToggle(el) {
  const S = App.jdbSel || (App.jdbSel = new Set());
  if (el.dataset.in === 'jbSelAll') jdbList().slice(0, App.jdb.limit || 300).forEach(r => el.checked ? S.add(r.id) : S.delete(r.id));
  else if (el.checked) S.add(el.value); else S.delete(el.value);
  App.render();
}
function jdbSelBar(list) {
  const S = App.jdbSel || (App.jdbSel = new Set()), ids = new Set(list.map(r => r.id)); [...S].forEach(id => { if (!ids.has(id)) S.delete(id); });
  if (!S.size) return `<p class="nr" style="margin:0 0 8px">Arbeitsgänge links ankreuzen, um mehrere gleichzeitig als abgerechnet zu markieren. Spalten: Kopf ziehen = verschieben, Rand ziehen = Breite.</p>`;
  return `<div class="panel alselbar"><b>${S.size} ausgewählt</b>
    <button type="button" class="btn mini primary" data-act="jbMark" data-v="1">✓ Als abgerechnet markieren</button>
    <button type="button" class="btn mini" data-act="jbMark" data-v="0">Wieder offen</button>
    ${S.size < list.length ? `<button type="button" class="btn mini" data-act="jbSelAllList">Alle ${list.length} auswählen</button>` : ''}
    <button type="button" class="btn mini" data-act="jbSelNone">Auswahl aufheben</button></div>`;
}
/* ---------- Spalten: Reihenfolge, Breite, Sichtbarkeit (pro Gerät) ---------- */
const jdbDT = s => s ? new Date(s).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const JDB_COLS = [
  { id: 'datum', l: 'Datum', w: 80, v: r => fmtDate(r.d, { day: '2-digit', month: '2-digit', year: '2-digit' }), csv: r => r.d },
  { id: 'beginn', l: 'Beginn', w: 118, v: r => jdbDT(r.start), csv: r => jdbDT(r.start) },
  { id: 'ende', l: 'Ende', w: 118, v: r => jdbDT(r.end), csv: r => jdbDT(r.end) },
  { id: 'dauer', l: 'Dauer', w: 64, n: 1, v: r => r.dauer != null ? hrs(r.dauer) : '', csv: r => r.dauer != null ? r2(r.dauer) : '' },
  { id: 'arbeit', l: 'Arbeit', w: 130, v: r => r.arbeit },
  { id: 'kunde', l: 'Kunde', w: 150, v: r => r.kunde },
  { id: 'feld', l: 'Feld', w: 130, v: r => r.feld },
  { id: 'ha', l: 'ha', w: 60, n: 1, v: r => r.ha != null ? fmtNum(r.ha) : '', csv: r => r.ha ?? '' },
  { id: 'quelle', l: 'Flächen-Quelle', w: 118, v: r => r.quelle || '', html: r => r.quelle ? `<span class="fq fq-${r.quelle === 'Bedeckungskarte' ? 'b' : 'm'}">${esc(r.quelle)}</span>` : '<span class="nr">–</span>' },
  { id: 'maschine', l: 'Maschine', w: 140, v: r => r.maschine },
  { id: 'fahrer', l: 'Fahrer', w: 120, v: r => r.fahrer },
  { id: 'kultur', l: 'Kultur', w: 110, v: r => r.kultur },
  { id: 'produkte', l: 'Produkte / Sorte', w: 220, v: r => [r.produkte, r.sorten].filter(Boolean).join(' · ') },
  { id: 'menge', l: 'Menge/ha', w: 90, n: 1, v: r => r.menge },
  { id: 'gesamt', l: 'Gesamtmenge', w: 190, v: r => r.gesamt || '' },
  { id: 'abr', l: 'Abgerechnet', w: 104, v: r => { const x = jdbAbr(r.id); return x ? '✓ ' + fmtDate(x.am, { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''; }, html: r => { const x = jdbAbr(r.id); return x ? `<span class="badge verrechnet">✓ ${fmtDate(x.am, { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>` : '<span class="nr">offen</span>'; } }
];
const JDB_DEF = { order: ['beginn', 'ende', 'dauer', 'arbeit', 'kunde', 'feld', 'ha', 'quelle', 'maschine', 'kultur', 'produkte', 'menge', 'gesamt', 'abr'], w: {} };
function jdbColCfg() {
  let c; try { c = JSON.parse(ls('lp_jdbcols') || 'null'); } catch { c = null; }
  if (!c || !Array.isArray(c.order)) c = JSON.parse(JSON.stringify(JDB_DEF));
  c.order = c.order.filter(id => JDB_COLS.some(x => x.id === id)); c.w = c.w || {};
  if (!(c.known || []).includes('quelle') && !c.order.includes('quelle')) { const i = c.order.indexOf('ha'); c.order.splice(i < 0 ? c.order.length : i + 1, 0, 'quelle'); } // neue Spalte einmal einblenden
  if (!(c.known || []).includes('gesamt') && !c.order.includes('gesamt')) { const i = c.order.indexOf('menge'); c.order.splice(i < 0 ? c.order.length : i + 1, 0, 'gesamt'); }
  c.known = JDB_COLS.map(x => x.id);
  return c;
}
const jdbColSave = c => ls('lp_jdbcols', JSON.stringify(c));
const jdbCols = () => { const c = jdbColCfg(); return c.order.map(id => JDB_COLS.find(x => x.id === id)).map(x => ({ ...x, w: c.w[x.id] || x.w })); };
function jdbTable(list, { print, all } = {}) {
  const g = App.jdb.grp, cols = jdbCols(), S = App.jdbSel || new Set(), ck = !print;
  const allOn = ck && list.length && list.every(r => S.has(r.id));
  const colg = print ? '' : `<colgroup>${ck ? '<col style="width:36px">' : ''}${cols.map(c => `<col data-col="${c.id}" style="width:${c.w}px">`).join('')}</colgroup>`;
  const head = `<thead><tr>${ck ? `<th class="ck" data-stop><input type="checkbox" data-in="jbSelAll" ${allOn ? 'checked' : ''} title="Alle angezeigten auswählen"></th>` : ''}${cols.map(c => `<th class="${c.n ? 'n' : ''}" ${print ? '' : `draggable="true" data-col="${c.id}" title="Ziehen zum Verschieben"`}>${esc(c.l)}${print ? '' : `<span class="cres" data-col="${c.id}" title="Breite ändern"></span>`}</th>`).join('')}</tr></thead>`;
  const row = r => { const ab = jdbAbr(r.id); return `<tr class="${print ? '' : 'click'}${ab ? ' jdab' : ''}${ck && S.has(r.id) ? ' alsel' : ''}" ${print ? '' : `data-act="jbRow" data-id="${esc(r.id)}"`}>${ck ? `<td class="ck" data-stop><input type="checkbox" data-in="jbSel" value="${esc(r.id)}" ${S.has(r.id) ? 'checked' : ''}></td>` : ''}${cols.map(c => `<td class="${c.n ? 'n' : ''} c-${c.id}">${!print && c.html ? c.html(r) : esc(c.v(r))}</td>`).join('')}</tr>`; };
  const TL = all || list, dSum = TL.reduce((t, r) => t + (r.dauer || 0), 0);
  const tot = `<tfoot><tr class="tot jdbtot">${ck ? '<td></td>' : ''}${cols.map((c, i) => `<td class="${c.n ? 'n' : ''}">${c.id === 'ha' ? `<b>${fmtNum(jdbHaSum(TL))}</b>` : c.id === 'dauer' ? `<b>${hrs(r2(dSum))}</b>` : i === 0 ? `<b>Total ${TL.length}</b>` : ''}</td>`).join('')}</tr></tfoot>`;
  const tcls = `btab jdbtab${print ? '' : ' jdbfix'}`, tw = print ? '' : ` style="width:${(ck ? 36 : 0) + cols.reduce((s, c) => s + c.w, 0)}px"`;
  if (!g) return `<table class="${tcls}"${tw}>${colg}${head}<tbody>${list.map(row).join('')}</tbody>${tot}</table>`;
  const groups = groupBy(list.slice().sort((a, b) => String(jdbGroupKey(a, g)).localeCompare(String(jdbGroupKey(b, g)), 'de') * (g === 'monat' ? -1 : 1)), r => jdbGroupKey(r, g));
  return `<table class="${tcls}"${tw}>${colg}${head}${groups.map(([k, l]) => `<tbody class="pblk"><tr class="gk"><td colspan="${cols.length + (ck ? 1 : 0)}">${esc(jdbGroupLabel(k, g))} · ${l.length} ${l.length === 1 ? 'Arbeitsgang' : 'Arbeitsgänge'} · ${fmtNum(jdbHaSum(l))} ha</td></tr>${l.map(row).join('')}</tbody>`).join('')}${tot}</table>`;
}
// Spalten verschieben (Kopf ziehen) und Breite ändern (rechter Rand) – am PC mit der Maus
function jdbColsAttach() {
  const t = $('.jdbfix'); if (!t) return;
  let dragId = null;
  $$('.jdbfix th[data-col]').forEach(th => {
    th.addEventListener('dragstart', e => { if (e.target.closest('.cres')) { e.preventDefault(); return; } dragId = th.dataset.col; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); th.classList.add('cdrag'); });
    th.addEventListener('dragend', () => th.classList.remove('cdrag'));
    th.addEventListener('dragover', e => { if (!dragId) return; e.preventDefault(); const r = th.getBoundingClientRect(); th.classList.toggle('cins-l', e.clientX < r.left + r.width / 2); th.classList.toggle('cins-r', e.clientX >= r.left + r.width / 2); });
    th.addEventListener('dragleave', () => th.classList.remove('cins-l', 'cins-r'));
    th.addEventListener('drop', e => {
      e.preventDefault(); const after = th.classList.contains('cins-r'); th.classList.remove('cins-l', 'cins-r');
      if (!dragId || dragId === th.dataset.col) return;
      const c = jdbColCfg(); c.order = c.order.filter(x => x !== dragId); const i = c.order.indexOf(th.dataset.col); c.order.splice(after ? i + 1 : i, 0, dragId); dragId = null; jdbColSave(c); App.render();
    });
  });
  $$('.jdbfix .cres').forEach(h => h.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const id = h.dataset.col, col = t.querySelector(`col[data-col="${id}"]`), x0 = e.clientX, w0 = col.getBoundingClientRect().width / UIZ(), tw0 = t.getBoundingClientRect().width / UIZ();
    h.setPointerCapture(e.pointerId); document.body.classList.add('cresizing');
    const mv = ev => { const w = Math.max(40, Math.round(w0 + (ev.clientX - x0) / UIZ())); col.style.width = w + 'px'; t.style.width = (tw0 + w - w0) + 'px'; };
    const up = ev => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); document.body.classList.remove('cresizing'); const c = jdbColCfg(); c.w[id] = Math.max(40, Math.round(w0 + (ev.clientX - x0) / UIZ())); jdbColSave(c); App.noClickUntil = Date.now() + 300; };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
  }));
}
// Spalten-Dialog: ein-/ausblenden, Reihenfolge mit ▲▼ (auch für Tablet/Handy), Breite zurücksetzen
function jdbColsDialog() {
  const c = jdbColCfg(), order = [...c.order, ...JDB_COLS.map(x => x.id).filter(id => !c.order.includes(id))];
  const rowH = (id, i) => { const col = JDB_COLS.find(x => x.id === id); return `<div class="rowi jcol" data-id="${id}"><label class="tog" style="flex:1"><input type="checkbox" name="on" value="${id}" ${c.order.includes(id) ? 'checked' : ''}> ${esc(col.l)}</label>
    <span class="updown"><button type="button" class="x" data-act="jbColMv" data-id="${id}" data-d="-1" aria-label="Nach oben">▲</button><button type="button" class="x" data-act="jbColMv" data-id="${id}" data-d="1" aria-label="Nach unten">▼</button></span></div>`; };
  Dlg.open('Spalten', `<p class="nr" style="margin-top:0">Haken = Spalte anzeigen. Reihenfolge mit ▲ ▼ – am PC auch direkt in der Tabelle: Spaltenkopf ziehen = verschieben, rechten Rand ziehen = Breite.</p>
    <div class="rows" id="jcols">${order.map(rowH).join('')}</div>
    <div class="btns" style="margin-top:10px"><button type="button" class="btn" data-act="jbColReset">Standard wiederherstellen</button></div>`,
    saveFooter(''), fd => {
      const on = new Set(fd.getAll('on')), ids = $$('#jcols .jcol').map(x => x.dataset.id).filter(id => on.has(id));
      if (!ids.length) { toast('Mindestens eine Spalte anzeigen'); return false; }
      const n = jdbColCfg(); n.order = ids; jdbColSave(n); App.render(); return true;
    });
}
function jdbColMove(id, d) {
  const box = $('#jcols'), el = box && box.querySelector(`.jcol[data-id="${id}"]`); if (!el) return;
  if (d < 0 && el.previousElementSibling) box.insertBefore(el, el.previousElementSibling);
  if (d > 0 && el.nextElementSibling) box.insertBefore(el.nextElementSibling, el);
}
function jdbSummary(list) {
  return groupBy(list, r => r.arbeit).sort((a, b) => b[1].length - a[1].length).map(([a, l]) => `<span class="chip">${esc(a)}: ${l.length} · ${fmtNum(jdbHaSum(l))} ha</span>`).join('');
}
// Summen: Fläche pro Kunde und Arbeit (wie Blatt «Summen» im JD_Arbeitsbericht)
function jdbSummen(list, { print } = {}) {
  const arbeiten = [...new Set(list.map(r => r.arbeit))].sort((a, b) => a.localeCompare(b, 'de'));
  const kunden = groupBy(list.slice().sort((a, b) => (a.kunde || '').localeCompare(b.kunde || '', 'de')), r => r.kunde || '–');
  const cell = l => { const ha = jdbHaSum(l); return l.length ? `${fmtNum(ha)}<small> · ${l.length}</small>` : ''; };
  return `<table class="btab jdbsum"><thead><tr><th>Kunde</th>${arbeiten.map(a => `<th class="n">${esc(a)}</th>`).join('')}<th class="n">Total ha</th></tr></thead>
    <tbody>${kunden.map(([k, l]) => `<tr><td>${esc(k)}</td>${arbeiten.map(a => `<td class="n">${cell(l.filter(r => r.arbeit === a))}</td>`).join('')}<td class="n"><b>${fmtNum(jdbHaSum(l))}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr class="tot"><td><b>Total</b></td>${arbeiten.map(a => `<td class="n"><b>${fmtNum(jdbHaSum(list.filter(r => r.arbeit === a)))}</b></td>`).join('')}<td class="n"><b>${fmtNum(jdbHaSum(list))}</b></td></tr></tfoot></table>
    ${print ? '' : '<p class="nr" style="margin:6px 0 0">Fläche in ha · Anzahl Arbeitsgänge</p>'}`;
}
function jdbSummenPrint() {
  const J = App.jdb, list = jdbList(), d = x => fmtDate(x, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const title = `Summen pro Kunde und Arbeit${J.von || J.bis ? ` ${J.von ? d(J.von) : '…'} – ${J.bis ? d(J.bis) : '…'}` : ''}`;
  printHtml(title, `<div class="bill jdbprint">${LETTERHEAD}<div class="bill-h"><div><b>Arbeitsbericht · Summen</b><br><span class="nr">Fläche in ha · Anzahl Arbeitsgänge</span></div><div class="r">${esc(title)}<br>${list.length} Arbeitsgänge · ${fmtNum(jdbHaSum(list))} ha</div></div>${jdbSummen(list, { print: true })}</div>`, { noTitle: true });
}
function jdbCsv() {
  const rows = [['Datum', 'Beginn', 'Ende', 'Dauer h', 'Arbeit', 'Kunde', 'Feld', 'Fläche ha', 'Flächen-Quelle', 'Maschine', 'Fahrer', 'Kultur', 'Produkte', 'Sorten', 'Menge/ha', 'Gesamtmenge', 'Saison', 'Abgerechnet am', 'ID']];
  jdbList().forEach(r => rows.push([r.d, jdbDT(r.start), jdbDT(r.end), r.dauer != null ? r.dauer.toFixed(2) : '', r.arbeit, r.kunde, r.feld, r.ha ?? '', r.quelle || '', r.maschine, r.fahrer, r.kultur, r.produkte, r.sorten, r.menge, r.gesamt || '', r.saison, jdbAbr(r.id)?.am || '', r.id]));
  const J = App.jdb;
  download(`JD-Arbeitsbericht_${J.von || 'alle'}_${J.bis || ''}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
function jdbPrint() {
  const J = App.jdb, list = jdbList();
  const title = `Arbeitsbericht ${J.von || J.bis ? `${J.von ? fmtDate(J.von, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '…'} – ${J.bis ? fmtDate(J.bis, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '…'}` : ''}`;
  const filt = [J.ab && (J.ab === 'ja' ? 'nur abgerechnete' : 'nur offene'), +J.minHa && `ohne Flächen unter ${fmtNum(+J.minHa)} ha`, ...Object.entries(JDB_MS).map(([k, [, l]]) => jdbArr(J[k]).length ? `${l}: ${jdbArr(J[k]).join(', ')}` : '')].filter(Boolean).join(' · ');
  printHtml(title, `<div class="bill jdbprint">${LETTERHEAD}<div class="bill-h"><div><b>${esc(jdbArr(J.k).length === 1 ? J.k[0] : 'Arbeitsbericht')}</b>${filt ? `<br><span class="nr">${esc(filt)}</span>` : ''}</div><div class="r">${esc(title)}<br>${list.length} Arbeitsgänge · ${fmtNum(jdbHaSum(list))} ha</div></div>
    ${jdbTable(list, { print: true })}</div>`, { noTitle: true });
}
function jdbDetail(id) {
  const r = (App.jdb.rows || []).find(x => x.id === id); if (!r) return;
  const kv = (k, v) => v ? `<tr><td class="nr">${esc(k)}</td><td>${esc(v)}</td></tr>` : '';
  const dt = s => s ? new Date(s).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const body = `<table class="btab kv">${kv('Arbeit', r.arbeit)}${kv('Kunde', r.kunde)}${kv('Feld', r.feld)}${kv('Fläche', r.ha != null ? fmtNum(r.ha) + ' ha' + (r.quelle ? ` (${r.quelle})` : '') : '')}${kv('Abgerechnet', jdbAbr(r.id) ? fmtDate(jdbAbr(r.id).am, { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'offen')}${kv('Beginn', dt(r.start))}${kv('Ende', dt(r.end))}${kv('Dauer', r.dauer != null ? hrs(r.dauer) : '')}
    ${kv('Maschine', r.maschine)}${kv('Fahrer', r.fahrer)}${kv('Kultur', r.kultur)}${kv('Saison', r.saison)}${kv('Produkte', r.produkte)}${kv('Sorten', r.sorten)}${kv('Menge/ha', r.menge)}${kv('Gesamtmenge', r.gesamt)}</table>
    ${r.details.map(m => `<div class="fld" style="margin-top:12px"><span>${esc(m.n)}</span></div><table class="btab kv">${m.v.map(([k, v]) => kv(k, v)).join('')}</table>`).join('')}
    <p class="nr" style="margin-top:12px">Quelle: MyJohnDeere · ID ${esc(r.id)}</p>`;
  const ab = jdbAbr(r.id);
  Dlg.open('Arbeitsgang', body, `${ab ? `<span class="badge verrechnet">✓ abgerechnet ${fmtDate(ab.am, { day: '2-digit', month: '2-digit', year: 'numeric' })}</span><button type="button" class="btn" data-act="jbMarkOne" data-id="${esc(r.id)}" data-v="0">Wieder offen</button>` : `<button type="button" class="btn primary" data-act="jbMarkOne" data-id="${esc(r.id)}" data-v="1">✓ Als abgerechnet markieren</button>`}<span class="spacer"></span><button type="button" class="btn" data-act="close">Schliessen</button>`, () => true);
}
function jdBerichtView() {
  return {
    toolbar() {
      return `<h1>JD-Arbeitsbericht</h1>
        <button class="btn" data-act="jbReq" title="NAS-Dienst holt die neuesten Daten aus MyJohnDeere">⟳ In MyJohnDeere abholen</button>`;
    },
    content() {
      const J = App.jdb;
      if (!J.bg) { J.bg = true; if (!J.rows) jdbFromCache(); setTimeout(() => jdbLoad(true), 0); } // gespeicherten Stand zeigen, im Hintergrund aktualisieren
      if (!J.rows) return `<div class="panel"><h2>${J.loading ? 'Arbeitsdaten werden geladen…' : 'Noch keine Arbeitsdaten'}</h2>
        <p>Der NAS-Dienst <b>jd-sync</b> holt die Arbeitsgänge aus MyJohnDeere und legt sie als <b>jd-arbeiten.json</b> in den Dropbox-Ordner. Dieser Bericht liest die Datei und wertet sie aus – vorerst ohne Verknüpfung zu den Planungsdaten.</p>
        <div class="btns"><button class="btn primary" data-act="jbLoad">Aus Dropbox laden</button><button class="btn" data-act="jbFile">Datei wählen…</button></div></div>`;
      if (J.von == null) { J.von = `${new Date().getFullYear()}-01-01`; J.bis = todayIso(); }
      const all = J.rows, list = jdbList(), uniq = (k, skip) => [...new Set(all.filter(jdbFilter(J, skip)).flatMap(r => k === 'maschine' ? r.maschine.split(', ') : [r[k]]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
      const sel = k => { const [f, label, allTxt] = JDB_MS[k], cur = jdbArr(J[k]), vals = [...new Set([...cur, ...uniq(f, k)])].sort((a, b) => a.localeCompare(b, 'de'));
        const txt = !cur.length ? allTxt : cur.length === 1 ? cur[0] : `${cur.length} ausgewählt`, open = J.open === k, mq = norm(J.msq || '');
        return `<div class="fld msel ${open ? 'open' : ''}"><span>${label}</span><button type="button" class="input msel-btn ${cur.length ? 'on' : ''}" data-act="jbMs" data-k="${k}" title="${esc(cur.join(', '))}">${esc(txt)}</button>
          ${open ? `<div class="msel-pop">
            <input class="input" type="search" placeholder="Suchen…" data-in="jbMsQ" value="${esc(J.msq || '')}">
            <div class="msel-list">${vals.map(v => `<label class="msel-i" ${mq && !norm(v).includes(mq) ? 'hidden' : ''}><input type="checkbox" data-in="jbMsC" data-k="${k}" value="${esc(v)}" ${cur.includes(v) ? 'checked' : ''}> ${esc(v)}</label>`).join('') || '<span class="nr">Keine Werte</span>'}</div>
            <div class="msel-f"><button type="button" class="btn mini" data-act="jbMsAll" data-k="${k}">Alle sichtbaren</button><button type="button" class="btn mini" data-act="jbMsNone" data-k="${k}">Keine</button><button type="button" class="btn mini primary" data-act="jbMsClose">Fertig</button></div>
          </div>` : ''}</div>`; };
      const shown = list.slice(0, J.limit || 300), m = J.meta || {};
      return `<p class="nr" style="margin-top:0">${m.n || all.length} Arbeitsgänge${m.org ? ' · ' + esc(m.org) : ''}${m.stand ? ` · Stand ${esc(new Date(m.stand).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }))}` : ''}${m.seit ? ` · ab ${fmtDate(m.seit, { day: '2-digit', month: '2-digit', year: 'numeric' })}` : ''}
          ${(() => { const q = { m: 0, b: 0, o: 0 }; all.forEach(r => r.quelle === 'Bedeckungskarte' ? q.b++ : r.ha != null ? q.m++ : q.o++); return ` · Flächen: ${q.m} Maschine, ${q.b} Bedeckungskarte, ${q.o} ohne`; })()}${m.bedeckung && m.bedeckung.gestoppt ? ' · <span style="color:var(--danger)">Bedeckungskarte: Abfrage abgebrochen – siehe NAS-Dienst</span>' : ''}
          · <a href="#" data-act="jbLoad">${J.loading ? 'lädt…' : 'neu laden'}</a> · <a href="#" data-act="jbFile">Datei wählen</a></p>
        <div class="panel jfilter"><div class="jfgrid">
          <label class="fld"><span>Von</span><input class="input" type="date" data-in="jb" data-k="von" value="${esc(J.von)}"></label>
          <label class="fld"><span>Bis</span><input class="input" type="date" data-in="jb" data-k="bis" value="${esc(J.bis)}"></label>
          ${sel('k')}${sel('a')}${sel('f')}${sel('m')}${sel('c')}
          <label class="fld"><span>Kleinstflächen</span><select class="input" data-plain data-in="jbMin">${[['', 'Alle anzeigen'], ['0.05', 'unter 0.05 ha ausblenden'], ['0.1', 'unter 0.1 ha ausblenden'], ['0.2', 'unter 0.2 ha ausblenden'], ['0.5', 'unter 0.5 ha ausblenden'], ['1', 'unter 1 ha ausblenden']].map(([v, l]) => `<option value="${v}" ${String(J.minHa || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="fld"><span>Abrechnung</span><select class="input" data-plain data-in="jb" data-k="ab"><option value="">Alle</option><option value="nein" ${J.ab === 'nein' ? 'selected' : ''}>Nur offene</option><option value="ja" ${J.ab === 'ja' ? 'selected' : ''}>Nur abgerechnete</option></select></label>
          <label class="fld"><span>Gruppieren nach</span><select class="input" data-plain data-in="jb" data-k="grp">${JDB_GRP.map(([v, l]) => `<option value="${v}" ${J.grp === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="fld"><span>Sortierung</span><select class="input" data-plain data-in="jb" data-k="sort"><option value="desc">Neueste zuerst</option><option value="asc" ${J.sort === 'asc' ? 'selected' : ''}>Älteste zuerst</option></select></label>
        </div>
        <div class="btns"><span class="seg mini">${[['woche', 'Diese Woche'], ['30', '30 Tage'], ['jahr', 'Dieses Jahr'], ['vorjahr', 'Vorjahr'], ['alle', 'Alles']].map(([v, l]) => `<button type="button" data-act="jbPreset" data-v="${v}">${l}</button>`).join('')}</span>
          <input class="input search" type="search" placeholder="Suchen: Produkt, Sorte, Fahrer…" value="${esc(J.q || '')}" data-in="jbq" style="max-width:260px">
          <button class="btn" data-act="jbReset">Filter zurücksetzen</button></div></div>
        <p><b>${list.length} Arbeitsgänge · ${fmtNum(jdbHaSum(list))} ha</b>${+J.minHa ? (() => { const n = all.filter(jdbFilter({ ...J, minHa: '' })).length - list.length; return n ? ` <span class="nr">· ${n} Kleinstflächen unter ${fmtNum(+J.minHa)} ha ausgeblendet</span>` : ''; })() : ''}${list.length ? ` <span class="nr">· ${list.filter(r => jdbAbr(r.id)).length} abgerechnet, ${list.filter(r => !jdbAbr(r.id)).length} offen</span>` : ''}</p>
        <div class="chips static" style="margin-bottom:10px">${jdbSummary(list)}</div>
        ${list.length ? `<details class="panel jdbsumbox" ${J.sumOpen ? 'open' : ''}><summary data-act="jbSumToggle">Summen pro Kunde und Arbeit</summary><div class="tscroll" style="margin-top:8px">${J.sumOpen ? jdbSummen(list) : ''}</div>${J.sumOpen ? '<div class="btns" style="margin-top:8px"><button class="btn" data-act="jbSumPrint">Summen drucken / PDF</button></div>' : ''}</details>` : ''}
        ${list.length ? `<div class="btns" style="margin-bottom:10px"><button class="btn primary" data-act="jbPrint">Drucken / PDF</button><button class="btn" data-act="jbCsv">Excel (CSV)</button><button class="btn" data-act="jbCols">Spalten…</button></div>
        ${jdbSelBar(list)}
        <div class="panel tscroll">${jdbTable(shown, { all: list })}</div>
        ${list.length > shown.length ? `<div class="btns" style="margin-top:10px"><button class="btn" data-act="jbMore">Weitere ${Math.min(300, list.length - shown.length)} anzeigen</button></div>` : ''}` : '<div class="empty">Keine Arbeitsgänge für diese Auswahl.</div>'}`;
    },
    after() { jdbColsAttach(); }
  };
}

// Mehrfachauswahl-Filter: öffnen, ankreuzen, suchen
function jdbMsToggle(k) { const J = App.jdb; J.open = J.open === k ? null : k; J.msq = ''; App.render(); const i = $('.msel.open [data-in="jbMsQ"]'); if (i && matchMedia('(pointer: fine)').matches) i.focus(); }
function jdbMsSet(k, vals) { const J = App.jdb; J[k] = vals; J.limit = 300; App.render(); }
function jdbMsCheck(el) { const J = App.jdb, k = el.dataset.k, cur = new Set(jdbArr(J[k])); el.checked ? cur.add(el.value) : cur.delete(el.value); const sc = $('.msel.open .msel-list')?.scrollTop; jdbMsSet(k, [...cur]); const l = $('.msel.open .msel-list'); if (l && sc) l.scrollTop = sc; }
function jdbMsQuery(el) { App.jdb.msq = el.value; const q = norm(el.value); $$('.msel.open .msel-i').forEach(x => { x.hidden = q && !norm(x.textContent).includes(q); }); }
function jdbMsAll(k, on) { const J = App.jdb, cur = new Set(jdbArr(J[k])); if (!on) { jdbMsSet(k, []); return; } $$('.msel.open .msel-i').filter(x => !x.hidden).forEach(x => cur.add(x.querySelector('input').value)); jdbMsSet(k, [...cur]); }
document.addEventListener('click', e => { const J = App.jdb; if (J && J.open && !e.target.closest('.msel')) { J.open = null; App.render(); } }, true);
document.addEventListener('keydown', e => { const J = App.jdb; if (e.key === 'Escape' && J && J.open) { J.open = null; App.render(); } });
/* ================= Grosse Bildschirme (z.B. 27" 4K): Anzeigegrösse ================= */
const UI_SCALES = [['auto', 'Automatisch'], ['0.9', '90 %'], ['1', '100 %'], ['1.1', '110 %'], ['1.25', '125 %'], ['1.5', '150 %'], ['1.75', '175 %'], ['2', '200 %']];
// Bei 4K ohne Windows-Skalierung (3840 px Fensterbreite) wird automatisch auf 150 % vergrössert; mit 150 % Windows-Skalierung (2560 px) bleibt es bei 100 %.
const uiAutoScale = () => { const w = window.innerWidth || 0; return w < 2800 ? 1 : Math.min(2, Math.round(w / 2560 * 4) / 4); };
const uiScaleSetting = () => ls('lp_uiscale') || 'auto';
const UIZ = () => App.uiz || 1;
function applyUiScale() {
  const v = uiScaleSetting(), z = v === 'auto' ? uiAutoScale() : (+v || 1);
  if (z === App.uiz) return;
  App.uiz = z; const r = document.documentElement;
  if (z === 1) { r.style.removeProperty('zoom'); r.style.removeProperty('--uz'); } else { r.style.zoom = z; r.style.setProperty('--uz', z); }
}
function uiScaleSet(v) { ls('lp_uiscale', v); applyUiScale(); App.render(); }
App.uiz = 1; applyUiScale();
window.addEventListener('resize', () => { if (uiScaleSetting() === 'auto') { const z0 = App.uiz; applyUiScale(); if (z0 !== App.uiz && App.view === 'mehr') App.render(); } });
function uiScalePanel() {
  const v = uiScaleSetting();
  return `<div class="panel"><h2>Anzeige</h2>
    <label class="fld"><span>Anzeigegrösse auf diesem Gerät</span><select class="input" data-plain data-in="uiScale">${UI_SCALES.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}${k === 'auto' ? ` (zurzeit ${Math.round(uiAutoScale() * 100)} %)` : ''}</option>`).join('')}</select></label>
    <p class="nr">Für grosse Bildschirme (z.B. 27 Zoll mit 3840 × 2160). «Automatisch» vergrössert, wenn Windows den Bildschirm nicht selbst skaliert. Die Einstellung gilt nur für dieses Gerät und diesen Browser; Ausdrucke und PDF bleiben unverändert.</p></div>`;
}
/* ---------- Versionsanzeige ---------- */
const NAS_MIN = '45'; // mindestens nötige Version des NAS-Dienstes
function versionInfo() {
  const c = Store.cfg(), nas = c.jdDienst, ver = v => +String(v || '').replace(/[^\d.]/g, '') || 0;
  const nasTxt = nas ? `Version ${esc(nas)}${ver(nas) < ver(NAS_MIN) ? ` <span class="badge offen">zu alt – NAS-Dienst auf Version ${NAS_MIN} oder neuer aktualisieren</span>` : ' <span class="nr">(aktuell)</span>'}`
    : c.jdStand ? 'ältere Version ohne Versionsangabe – <b>NAS-Dienst aktualisieren</b>' : 'noch keine Verbindung';
  return `<table class="btab kv"><tr><td class="nr">Lohnarbeit-Planer</td><td><b>Version ${APP_VERSION}</b> · Stand ${APP_STAND}</td></tr>
    <tr><td class="nr">NAS-Dienst jd-sync</td><td>${nasTxt}${c.jdStand ? ` <span class="nr">(letzte Daten ${esc(new Date(c.jdStand).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }))})</span>` : ''}</td></tr></table>
    <p class="nr" style="margin-bottom:0">Updates lädt der Planer beim nächsten Öffnen automatisch (bei Bedarf Seite neu laden). Die Version steht auch oben neben dem Programmnamen.</p>`;
}
(() => { const el = document.getElementById('appVer'); if (el) el.textContent = 'v' + APP_VERSION; })();
function pickFile(accept) {
  return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0]); i.click(); });
}
async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
function parseCsv(txt) {
  const delim = (txt.split('\n')[0].match(/;/g) || []).length >= (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function importKunden() {
  const file = await pickFile('.csv,.xlsx,.xls,text/csv'); if (!file) return;
  let rows;
  try {
    if (/\.xlsx?$/i.test(file.name)) {
      if (!window.XLSX) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    } else rows = parseCsv(await readText(file));
  } catch (e) { toast('Datei konnte nicht gelesen werden (für Excel ist eine Internetverbindung nötig).', 5000); return; }
  rows = rows.map(r => r.map(x => String(x ?? '').trim())).filter(r => r.some(Boolean));
  if (rows.length < 2) { toast('Keine Daten gefunden.'); return; }
  const h = rows[0].map(norm);
  const col = (...names) => h.findIndex(x => names.some(n => x.includes(n)));
  const nrIdx = h.findIndex(x => /^(kunden?[-\s.]*)?(nr|nummer)\.?$|^kd/.test(x));
  const c = { nr: nrIdx >= 0 ? nrIdx : h.findIndex(x => /(^|[^a-z])nr\b/.test(x) && !/tel|natel|plz/.test(x)), name: col('name', 'kunde', 'betrieb', 'firma'), vorname: col('vorname'), adresse: col('adresse', 'strasse', 'straße'), plz: col('plz', 'postleitzahl'), ort: col('ort', 'wohnort'), tel: col('tel', 'natel', 'mobile', 'handy'), mail: col('mail') };
  if (c.vorname >= 0 && c.vorname === c.name) c.name = h.findIndex((x, i) => i !== c.vorname && /name|kunde|betrieb/.test(x));
  if (c.name < 0) { toast('Spalte «Name» nicht gefunden. Erste Zeile muss Überschriften enthalten.', 5000); return; }
  if (c.ort === c.plz && c.plz >= 0) { // "PLZ Ort" in einer Spalte
    c.ortKombi = c.plz; c.plz = -1; c.ort = -1;
  }
  let neu = 0, akt = 0;
  const existing = Store.all('kunden');
  rows.slice(1).forEach(r => {
    const g = i => (i >= 0 ? r[i] || '' : '');
    let name = g(c.name); if (c.vorname >= 0 && g(c.vorname)) name = `${name} ${g(c.vorname)}`.trim();
    if (!name) return;
    let plz = g(c.plz), ort = g(c.ort);
    if (c.ortKombi >= 0) { const mm = /^(\d{4,5})\s+(.*)$/.exec(g(c.ortKombi)); if (mm) { plz = mm[1]; ort = mm[2]; } else ort = g(c.ortKombi); }
    const nr = g(c.nr);
    const k = existing.find(x => (nr && x.nr === nr) || (!nr && norm(x.name) === norm(name)));
    const obj = Object.assign(k ? { ...k } : { id: uid() }, { nr, name, adresse: g(c.adresse) || k?.adresse || '', plz: plz || k?.plz || '', ort: ort || k?.ort || '', tel: g(c.tel) || k?.tel || '', mail: g(c.mail) || k?.mail || '' });
    obj.upd = Date.now();
    const i = Store.data.kunden.findIndex(x => x.id === obj.id);
    if (i >= 0) { Store.data.kunden[i] = obj; akt++; } else { Store.data.kunden.push(obj); neu++; }
  });
  Store.save(); Sync.schedule(); App.render();
  toast(`${neu} Kunden neu, ${akt} aktualisiert`, 4000);
}
async function restoreBackup() {
  const file = await pickFile('.json,application/json'); if (!file) return;
  try {
    const d = JSON.parse(await readText(file));
    if (!COLL.some(c => Array.isArray(d[c]))) throw 0;
    if (!confirm('Sicherung mit den aktuellen Daten zusammenführen? (Neuere Einträge bleiben erhalten)')) return;
    Store.data = mergeData(Store.data, d); Store.save(); Sync.schedule(); App.render(); toast('Sicherung eingelesen');
  } catch { toast('Ungültige Sicherungsdatei.'); }
}

/* ================= Ereignisse ================= */
document.addEventListener('click', async e => {
  if (App.noClickUntil && Date.now() < App.noClickUntil) { e.preventDefault(); e.stopPropagation(); return; } // nach dem Ziehen mit dem Finger
  const stp = e.target.closest('[data-act="spJEjStep"]'); if (stp) { journalStep(stp.parentElement.querySelector('input'), +stp.dataset.d); return; }
  if (e.target.closest('[data-stop]')) return; // Links (Telefon, Karte) nicht als Kartenklick werten
  const t = e.target.closest('[data-act],[data-view]'); if (!t) return;
  if (t.dataset.view) { App.go(t.dataset.view); return; }
  const act = t.dataset.act, id = t.dataset.id, f = Dlg.form;
  if (t.tagName === 'A') e.preventDefault();
  if ((act === 'editOrder' || act === 'planOrder') && App.view === 'plan' && !Dlg.el.open && (e.ctrlKey || e.metaKey || e.shiftKey || App.selMode)) {
    const a = Store.get('auftraege', id); if (a && isOpen(a)) toggleSel(id); else toast('Erledigte Aufträge lassen sich nicht verschieben');
    return;
  }
  switch (act) {
    case 'close': Dlg.close(); break;
    case 'sync': if (!Auth.configured()) { App.go('mehr'); toast('Dropbox ist noch nicht eingerichtet.'); } else if (!Auth.hasSession()) Auth.login(); else Sync.run(); break;
    case 'login': Auth.login(); break;
    case 'logout': if (confirm('Abmelden? Die Daten bleiben auf diesem Gerät erhalten.')) Auth.logout(); break;
    case 'newOrder': orderDialog(); break;
    case 'newOrderFor': Dlg.close(); orderDialog(null, { kunde: id }); break;
    case 'editOrder': orderDialog(id); break;
    case 'planOrder': e.stopPropagation(); orderDialog(id, { plan: true }); break;
    case 'done': e.stopPropagation(); doneDialog(id); break;
    case 'unplan': f.datum.value = ''; f.zeit.value = ''; toast('Beim Speichern wird die Einplanung entfernt'); break;
    case 'quickKunde': if (jdLock()) toast('Neue Kunden werden in MyJohnDeere erfasst.'); else quickKundeDialog(); break;
    case 'feldAssign': feldAssignDialog(id); break;
    case 'jdSync': jdSyncOpen(); break;
    case 'jdRequest': jdRequest(); break;
    case 'dayView': App.plan.mode = 'tag'; ls('lp_pmode', 'tag'); App.plan.date = parseDate(t.dataset.d); App.resetScroll = true; App.render(); break;
    case 'weekView': App.plan.mode = 'woche'; ls('lp_pmode', 'woche'); App.resetScroll = true; App.render(); break;
    case 'pickPlace': { const p = Dlg.pick; Dlg.close(); placeFromPicker(id, p.d, p.mid, p.minute); break; }
    case 'pickAll': { const p = Dlg.pick; pickerDialog(p.d, p.mid, p.minute, true); break; }
    case 'pickNew': { const p = Dlg.pick; Dlg.close(); orderDialog(null, { pre: { datum: p.d, maschine: p.mid, zeit: p.minute != null ? fromMin(Math.round(p.minute / 15) * 15) : '' } }); break; }
    case 'newSpray': orderDialog(null, { arbeit: sprayArbeit() }); break;
    case 'prodManage': productsDialog(); break;
    case 'aMore': App.alimit += 150; App.render(); break;
    case 'spTab': App.spray.tab = t.dataset.v; App.render(); window.scrollTo(0, 0); break;
    case 'spStamm': App.spray.stamm = t.dataset.v; App.render(); break;
    case 'spJfToggle': App.spray.jfOpen = !App.spray.jfOpen; App.render(); break;
    case 'spJfReset': App.spray.jf = { ...JF_DEFAULT }; App.spray.jy = ''; App.spray.jlimit = 200; App.render(); break;
    case 'prodImport': prodImportStart(); break;
    case 'invPrint': printHtml('Inventarliste', inventoryHtml(), { noTitle: true }); break;
    case 'invCsv': inventoryCsv(); break;
    case 'prodDeactOld': prodDeactOld(); break;
    case 'jbLoad': jdbLoad(); break;
    case 'jbFile': jdbFile(); break;
    case 'jbReq': jdRequest(); setTimeout(() => jdbLoad(true), 4 * 60000); setTimeout(() => jdbLoad(true), 8 * 60000); break;
    case 'jbPreset': jdbPreset(t.dataset.v); break;
    case 'jbReset': Object.assign(App.jdb, { ab: '', k: [], a: [], f: [], m: [], c: [], q: '', grp: '', von: null, bis: null, limit: 300, open: null }); App.render(); break;
    case 'jbMs': jdbMsToggle(t.dataset.k); break;
    case 'jbMsAll': jdbMsAll(t.dataset.k, true); break;
    case 'jbMsNone': jdbMsAll(t.dataset.k, false); break;
    case 'jbMsClose': App.jdb.open = null; App.render(); break;
    case 'jbCsv': jdbCsv(); break;
    case 'jbPrint': jdbPrint(); break;
    case 'jbRow': jdbDetail(id); break;
    case 'jbMark': jdbMarkSel(t.dataset.v === '1'); break;
    case 'jbMarkOne': { const on = t.dataset.v === '1'; jdbMark([id], on); toast(on ? 'Als abgerechnet markiert' : 'Wieder offen'); jdbDetail(id); break; }
    case 'jbSelAllList': { const S = App.jdbSel || (App.jdbSel = new Set()); jdbList().forEach(r => S.add(r.id)); App.render(); break; }
    case 'jbSelNone': App.jdbSel?.clear(); App.render(); break;
    case 'jbCols': jdbColsDialog(); break;
    case 'jbSumToggle': e.preventDefault(); App.jdb.sumOpen = !App.jdb.sumOpen; App.render(); break;
    case 'jbSumPrint': jdbSummenPrint(); break;
    case 'jbColMv': jdbColMove(id, +t.dataset.d); break;
    case 'jbColReset': ls('lp_jdbcols', ''); Dlg.close(); App.render(); toast('Spalten auf Standard zurückgesetzt'); break;
    case 'jbMore': App.jdb.limit = (App.jdb.limit || 300) + 300; App.render(); break;
    case 'aView': App.filter.aview = t.dataset.v; ls('lp_aview', t.dataset.v); App.render(); break;
    case 'alPreset': alPreset(t.dataset.v); break;
    case 'alReset': Object.assign(App.al, { von: '', bis: '', k: '', a: '', c: '', m: '', f: '', grp: '', limit: 300 }); App.render(); break;
    case 'alCsv': alCsv(); break;
    case 'alPrint': alPrint(); break;
    case 'alSetStatus': alSetStatus(t.dataset.v); break;
    case 'alSelAllList': alSelAllList(); break;
    case 'alSelNone': App.alSel?.clear(); App.render(); break;
    case 'alMore': App.al.limit = (App.al.limit || 300) + 300; App.render(); break;
    case 'invStockPrint': printHtml('Inventar', invStockHtml({ print: true }), { noTitle: true }); break;
    case 'invStockCsv': invStockCsv(); break;
    case 'planExport': planExportDialog(); break;
    case 'planExpPdf': planExportPdf(); break;
    case 'planExpImg': planExportImg(); break;
    case 'spMore': App.spray.jlimit += 200; App.render(); break;
    case 'spAkSel': App.spray.ak = id; App.render(); window.scrollTo(0, 0); break;
    case 'spBillCsv': billingCsv(); break;
    case 'spBillPrint': { const S = App.spray, b = billing(S.ak, S.av, S.ab, S.ag); printHtml('Abrechnung Spritzarbeiten', billingHtml(b, S.av, S.ab), { noTitle: true }); break; }
    case 'spBillPrintAll': { const S = App.spray; printHtml('Abrechnung Spritzarbeiten', kundenMitSpritz(billFilter(S)).map(k => billing(k.id, S.av, S.ab, S.ag)).filter(b => b.rows.length).map(b => billingHtml(b, S.av, S.ab)).join(''), { noTitle: true }); break; }
    case 'spBillMark': {
      const S = App.spray, b = billing(S.ak, S.av, S.ab, S.ag), ch = b.rows.filter(r => statusOf(r.a) === 'erledigt').map(r => ({ ...r.a, status: 'verrechnet' }));
      if (ch.length && confirm(`${ch.length} Spritzaufträge als verrechnet markieren?`)) { Store.putMany('auftraege', ch); toast('Als verrechnet markiert'); } break;
    }
    case 'spNwPrint': printHtml('Pflanzenschutz-Nachweis', nachweisHtml(nachweisRows()), { noTitle: true }); break;
    case 'spNwCsv': nachweisCsv(); break;
    case 'prodEdit': productDialog(id); break;
    case 'prodAddNew': productDialog(null); break;
    case 'prodDelete': {
      const n = sprayOrders().filter(a => prodList(a).some(p => p.pid === id)).length;
      if (n) { if (confirm(`Das Produkt kommt in ${n} Aufträgen vor und kann nicht gelöscht werden. Stattdessen als «nicht aktuell» ausblenden?`)) { Store.put('produkte', { ...Store.get('produkte', id), aktuell: false }); Dlg.close(); } }
      else if (confirm('Produkt löschen?')) { Store.remove('produkte', id); Dlg.close(); } break;
    }
    case 'parzNew': { const k = findKunde(f.kunde.value); if (!k) { toast('Zuerst den Kunden wählen'); break; } parzelleDialog(null, { kunde: k.id, fromOrder: true }); break; }
    case 'parzAdd': parzelleDialog(null, { kunde: App.spray.pk }); break;
    case 'parzEdit': parzelleDialog(id); break;
    case 'parzDelete': {
      const n = sprayOrders().filter(a => a.parzelle === id).length;
      if (n) { if (confirm(`Die Parzelle kommt in ${n} Aufträgen vor. Stattdessen als inaktiv ausblenden?`)) { Store.put('parzellen', { ...Store.get('parzellen', id), aktiv: false }); Dlg.close(); } }
      else if (confirm('Parzelle löschen?')) { Store.remove('parzellen', id); Dlg.close(); } break;
    }
    case 'prodAdd': $('#prodRows', f).insertAdjacentHTML('beforeend', prodRow()); break;
    case 'prodDel': { const r = t.closest('.prow'); if ($$('.prow', f).length > 1) r.remove(); else { r.querySelector('select').value = ''; r.querySelector('input').value = ''; } f._sprayUpd && f._sprayUpd(); break; }
    case 'prodNew': newProductDialog(); break;
    case 'spPreset': sprayPreset(t.dataset.v); break;
    case 'spCsv': sprayCsv(); break;
    case 'spImg': sprayImage(); break;
    case 'dauerReset': f.dauer.value = ''; f.dauer.dispatchEvent(new Event('input')); break;
    case 'dupOrder': {
      const a = structuredClone(Store.get('auftraege', id));
      Object.assign(a, { id: uid(), nr: Store.nextAuftragNr(), status: 'offen', datum: '', zeit: '', erledigtAm: '', flaecheEff: null, stundenEff: null });
      Store.put('auftraege', a); Dlg.close(); orderDialog(a.id); toast('Kopie erstellt – z.B. anderen Kunden wählen'); break;
    }
    case 'delOrder': if (confirm('Auftrag löschen?')) { Store.remove('auftraege', id); Dlg.close(); } break;
    case 'aFilter': App.filter.auftraege = t.dataset.v; App.alimit = 150; App.render(); break;
    case 'pMode': App.plan.mode = t.dataset.v; ls('lp_pmode', t.dataset.v); App.resetScroll = true; App.render(); break;
    case 'zoom': setZoom(App.zoom * (+t.dataset.d > 0 ? 1.25 : 0.8)); break;
    case 'fs': App.fs = !App.fs; App.render(); break;
    case 'pSide': App.plan.side = App.plan.side === false; ls('lp_pside', App.plan.side ? '1' : '0'); App.render(); break;
    case 'pNav': {
      const d = +t.dataset.d;
      App.plan.date = d ? addDays(App.plan.date, d * (App.plan.mode === 'tag' ? 1 : 7)) : new Date();
      App.render(); break;
    }
    case 'editKunde': kundeDialog(id); break;
    case 'delKunde': {
      const n = Store.all('auftraege').filter(a => a.kunde === id).length;
      if (confirm(n ? `Dieser Kunde hat ${n} Aufträge. Trotzdem löschen?` : 'Kunde löschen?')) { Store.remove('kunden', id); Dlg.close(); } break;
    }
    case 'importKunden': if (!jdLock()) importKunden(); break;
    case 'editMaschine': maschineDialog(id); break;
    case 'delMaschine': if (confirm('Maschine löschen? (Tipp: «Aktiv» ausschalten behält sie in alten Aufträgen sichtbar)')) { Store.remove('maschinen', id); Dlg.close(); } break;
    case 'monAll': $$('input[name="mon"]', f).forEach(i => { i.checked = true; }); break;
    case 'monNone': $$('input[name="mon"]', f).forEach(i => { i.checked = false; }); break;
    case 'selMode': App.selMode = !App.selMode; if (!App.selMode) App.sel.clear(); App.render(); break;
    case 'selClear': clearSel(); break;
    case 'bulkMove': bulkMoveDialog(); break;
    case 'bulkDay': bulkShiftDays(+t.dataset.d); break;
    case 'bulkUnplan': moveOrders([...App.sel], null, { unplan: true }); toast('Ausgeplant'); break;
    case 'mUp': case 'mDown': e.stopPropagation(); moveMachine(id, act === 'mUp' ? -1 : 1); break;
    case 'machinePlan': machinePlanDialog(id); break;
    case 'mpNav': machinePlanDialog(id, isoDate(addDays(parseDate(t.dataset.date), +t.dataset.d))); break;
    case 'mpShare': machinePlanOut('share'); break;
    case 'mpSave': machinePlanOut('save'); break;
    case 'mpCopy': machinePlanOut('copy'); break;
    case 'editList': listDialog(t.dataset.kind); break;
    case 'lrowAdd': { const w = $('#lrows', f); w.insertAdjacentHTML('beforeend', f._row('', null)); w.lastElementChild.querySelector('input').focus(); break; }
    case 'lrowDel': t.closest('.lrow').remove(); break;
    case 'lrowUp': { const r = t.closest('.lrow'); if (r.previousElementSibling) r.parentNode.insertBefore(r, r.previousElementSibling); break; }
    case 'lrowDown': { const r = t.closest('.lrow'); if (r.nextElementSibling) r.parentNode.insertBefore(r.nextElementSibling, r); break; }
    case 'lrowSort': { const w = $('#lrows', f); [...w.children].sort((x, y) => x.querySelector('input').value.localeCompare(y.querySelector('input').value, 'de')).forEach(r => w.appendChild(r)); break; }
    case 'export': exportCsv(); break;
    case 'exportAllXlsx': exportAllXlsx(); break;
    case 'backup': download(`Lohnarbeit-Sicherung_${todayIso()}.json`, JSON.stringify(Store.data, null, 1), 'application/json'); break;
    case 'restore': restoreBackup(); break;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && ['spJEj', 'spJFl', 'spInv'].includes(e.target.dataset?.in)) { e.preventDefault(); e.target.blur(); return; }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.dataset?.in === 'spJEj') { e.preventDefault(); journalStep(e.target, e.key === 'ArrowUp' ? 1 : -1); return; }
  // Tastenkürzel (PC und iPad mit Tastatur), nicht beim Schreiben in einem Feld
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (!typing && !Dlg.el.open && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); orderDialog(); return; }
    if (App.view === 'plan' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); App.plan.date = addDays(App.plan.date, (e.key === 'ArrowRight' ? 1 : -1) * (App.plan.mode === 'tag' ? 1 : 7)); App.render(); return; }
    if (App.view === 'plan' && k === 'h') { App.plan.date = new Date(); App.render(); return; }
    if (App.view === 'plan' && (k === 't' || k === 'w')) { App.plan.mode = k === 't' ? 'tag' : 'woche'; ls('lp_pmode', App.plan.mode); App.resetScroll = true; App.render(); return; }
    const nav = { 1: 'auftraege', 2: 'plan', 3: 'spritzen', 4: 'jdbericht', 5: 'kunden', 6: 'maschinen', 7: 'mehr' }[e.key];
    if (nav) { App.go(nav); return; }
  }
  if (e.key !== 'Escape' || Dlg.el.open) return;
  if (App.sel.size) clearSel(); else if (App.fs) { App.fs = false; App.render(); }
});
document.addEventListener('input', e => {
  const k = e.target.dataset.in; if (!k) return;
  if (k === 'aSearch') { App.filter.q = e.target.value; App.alimit = 150; App.render(); }
  if (k === 'kSearch') { App.filter.kq = e.target.value; App.render(); }
  if (k === 'jbMsQ') { jdbMsQuery(e.target); return; }
  if (k === 'jbq') { App.jdb.q = e.target.value; const pos = e.target.selectionStart; App.render(); const el = $('[data-in="jbq"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { } } }
  if (k === 'spJq' || k === 'spPrq') {
    App.spray[k === 'spJq' ? 'jq' : 'prq'] = e.target.value; App.spray.jlimit = 200;
    const pos = e.target.selectionStart; App.render(); const el = $(`[data-in="${k}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { } }
  }
});
document.addEventListener('change', e => {
  const k = e.target.dataset.in; if (!k) return;
  if (k === 'spJEj' || k === 'spJFl') { journalEdit(e.target); return; }
  if (k === 'spInv') { invEdit(e.target); return; }
  if (k === 'spPrAkt') { prodAktToggle(e.target); return; }
  if (k === 'spPrSeit') { if (e.target.value) { App.spray.prseit = e.target.value; App.render(); } return; }
  if (k === 'axW' || k === 'axT') { App.plan[k] = e.target.value; ls(k === 'axW' ? 'lp_axW' : 'lp_axT', e.target.value); App.tlScroll = null; toast('Anordnung der Planung geändert'); return; }
  if (k === 'uiScale') { uiScaleSet(e.target.value); return; }
  if (k === 'jbMin') { App.jdb.minHa = e.target.value; ls('lp_jdbmin', e.target.value); App.jdb.limit = 300; App.render(); return; }
  if (k === 'jbMsC') { jdbMsCheck(e.target); return; }
  if (k === 'jbSel' || k === 'jbSelAll') { jdbSelToggle(e.target); return; }
  if (k === 'alSel' || k === 'alSelAll') { alSelToggle(e.target); return; }
  if (k === 'al') { App.al[e.target.dataset.k] = e.target.value; App.al.limit = 300; App.render(); return; }
  if (k === 'jb') { App.jdb[e.target.dataset.k] = e.target.value; App.jdb.limit = 300; App.render(); return; }
  if (k === 'spJf') { const S = App.spray, fk = e.target.dataset.k; S.jf[fk] = e.target.value; if (fk === 'k') { S.jf.p = ''; S.jf.f = ''; } S.jlimit = 200; App.render(); return; }
  const SP = { spAk: 'ak', spAv: 'av', spAb: 'ab', spNy: 'ny', spNk: 'nk', spNc: 'nc', spJy: 'jy', spPk: 'pk', spJsort: 'jsort', spPrs: 'prs', spInvs: 'invs' };
  if (SP[k]) { App.spray[SP[k]] = e.target.value; if (k === 'spJy') App.spray.jlimit = 200; App.render(); return; }
  const SPB = { spAg: 'ag', spNgep: 'ngep', spPall: 'pall', spPrall: 'prall' };
  if (SPB[k]) { App.spray[SPB[k]] = e.target.checked; App.render(); return; }
  if (k === 'spVon' && e.target.value) { App.spray.von = e.target.value; if (App.spray.bis < App.spray.von) App.spray.bis = App.spray.von; App.render(); return; }
  if (k === 'spBis' && e.target.value) { App.spray.bis = e.target.value; if (App.spray.bis < App.spray.von) App.spray.von = App.spray.bis; App.render(); return; }
  if (k === 'spDay') { if (e.target.checked) App.spray.off.delete(e.target.value); else App.spray.off.add(e.target.value); App.render(); return; }
  if (k === 'mpDate' && e.target.value) { machinePlanDialog(e.target.dataset.id, e.target.value); return; }
  if (k === 'kAll') { App.filter.kall = e.target.checked; App.render(); return; }
  if (k === 'pDate' && e.target.value) { App.plan.date = parseDate(e.target.value); App.render(); }
  if (k === 'cfg') {
    const key = e.target.dataset.k, v = e.target.value.trim();
    if ((key === 'beginn' || key === 'ende') && !v) { toast('Bitte eine Uhrzeit eingeben'); return; }
    const c = Object.assign(Store.cfg(), { [key]: v });
    if (toMin(c.ende) <= toMin(c.beginn)) { toast('Arbeitsende muss nach Arbeitsbeginn liegen'); return; }
    Store.setCfg({ [key]: v }); toast('Gespeichert');
  }
});

/* ================= Start ================= */
// Ziehen mit dem Finger: Bildlauf verhindern, solange ein Auftrag gezogen wird
document.addEventListener('touchmove', e => { if (App.tdrag) e.preventDefault(); }, { passive: false });
(async function init() {
  Dlg.el = $('#dlg'); Dlg.form = $('#dlgForm');
  Dlg.el.addEventListener('submit', e => { // am Dialog, damit das Formular bei jedem Öffnen frisch ersetzt werden kann
    if (e.target !== Dlg.form) return;
    e.preventDefault();
    if (Dlg.onSubmit && Dlg.onSubmit(new FormData(Dlg.form)) !== false) Dlg.close();
  });
  Dlg.el.addEventListener('cancel', () => { Dlg.onSubmit = null; });
  Store.load();
  App.render();
  try { await Auth.handleRedirect(); } catch (e) { toast('Anmeldung fehlgeschlagen: ' + e.message, 6000); }
  App.render();
  try { prodApplyDue(); } catch { }
  Sync.run().then(() => jdAuto()).then(() => prodApplyDue()).catch(() => { });
  addEventListener('online', () => Sync.run());
  addEventListener('offline', () => Sync.setState('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.run(); });
  setInterval(() => { if (document.visibilityState === 'visible' && !Dlg.el.open) Sync.run(); }, 60000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
