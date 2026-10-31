/* IM-Verwalter (früher Lohnarbeit-Planer) – App-Logik (ohne Fremdbibliotheken)
   Daten: lokal im Browser (offline) + Synchronisation mit Dropbox. */
'use strict';

// Version (bei jedem Update erhöhen – gleich wie CACHE in sw.js und VERSION im NAS-Dienst)
const APP_VERSION = '85', APP_STAND = '31.10.2026';
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
  v: 0, // Änderungszähler (Zwischenspeicher der Tagesplanung)
  save() { this.v++; ls('lp_data', JSON.stringify(this.data)); },
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
      if (typeof icsWrite === 'function') icsWrite().catch(e => console.warn(e));
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
const inSeason = () => true; // Saison-Monate entfallen (v78): Maschinen werden in der Maschinenliste aktiv/inaktiv geschaltet
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
// Tagesplan einer Maschine. Mehrtägige Aufträge: «durchgehend» (Standard, rund um die Uhr über Mitternacht)
// oder a.mehrtag === 'arbeitszeit' (pro Tag nur von Arbeitsbeginn bis Arbeitsende, Rest am Folgetag).
// Items: { a, start, end (≤1440), rawEnd, rest (Minuten für die Folgetage), fixed, pushed, noDur, over, tag, az, cont }
const SCHED_MAXD = 31, _sched = new Map(); let _schedV = -1;
function schedule(d, mid, depth = 0) {
  if (_schedV !== Store.v) { _sched.clear(); _schedV = Store.v; }
  const key = d + '|' + mid; if (_sched.has(key)) return _sched.get(key);
  const orders = Store.all('auftraege').filter(a => a.datum === d && (a.maschine || '') === mid)
    .sort((x, y) => (toMin(x.zeit) ?? 9999) - (toMin(y.zeit) ?? 9999) || (x.nr || '').localeCompare(y.nr || ''));
  const cfg = Store.cfg(), beginn = toMin(cfg.beginn) ?? 420, ende = toMin(cfg.ende) ?? 1140, azEnd = ende > beginn ? ende : 1440;
  // Aufträge der Vortage, die noch weiterlaufen: Rest als Fortsetzung
  const carry = [];
  if (depth < SCHED_MAXD) {
    const pd = isoDate(addDays(parseDate(d), -1)), prev = schedule(pd, mid, depth + 1);
    [...prev.carry, ...prev.items].filter(it => it.rest > 0).forEach(it => {
      const az = it.a.mehrtag === 'arbeitszeit', s = az ? beginn : 0, cap = az ? azEnd - beginn : 1440;
      const seg = Math.min(it.rest, cap), rest = it.rest - seg;
      carry.push({ a: it.a, start: s, end: s + seg, rawEnd: az ? s + seg : it.rest, rest, cont: true, fixed: true, over: rest > 0, tag: (it.tag || 1) + 1, az });
    });
  }
  const carryEnd = carry.reduce((m, c) => Math.max(m, c.end), 0);
  let prevEnd = carryEnd || null;
  const items = orders.map(a => {
    const want = toMin(a.zeit), fixed = want != null, len = lenOf(a), az = a.mehrtag === 'arbeitszeit';
    let t = fixed ? want : Math.max(prevEnd ?? beginn, carryEnd ? beginn : 0);
    if (prevEnd != null && t < prevEnd) t = prevEnd;
    let end, rest;
    if (az) { const cap = t < azEnd ? azEnd - t : 1440 - t, seg = Math.min(len, Math.max(0, cap)); end = t + seg; rest = len - seg; prevEnd = end; }
    else { end = t + len; rest = Math.max(0, end - 1440); prevEnd = end; }
    return { a, start: t, end: Math.min(1440, end), rawEnd: end, rest, fixed, pushed: fixed && t !== want, noDur: !dauerOf(a), over: rest > 0, tag: 1, az };
  });
  const res = { items, carry, all: [...carry, ...items] };
  _sched.set(key, res);
  return res;
}
// Endzeit mit Tagesangabe, z. B. «03:00 (+1)» bei Aufträgen über Mitternacht
const endLbl = it => it.rawEnd > 1440 ? `${fromMin(it.rawEnd % 1440)} (+${Math.floor(it.rawEnd / 1440)})` : fromMin(it.end);
const rangeLbl = it => `${fromMin(it.start)}–${endLbl(it)}`;
const contLbl = it => `↪ Fortsetzung vom ${fmtDate(it.a.datum, { day: '2-digit', month: '2-digit' })}${it.tag > 2 || it.over ? ` (Tag ${it.tag})` : ''}`;
// Hinweis für Aufträge, die am Folgetag weiterlaufen
const weiterLbl = it => it.az ? `⏩ weiter am ${fmtDate(isoDate(addDays(parseDate(it.a.datum), (it.tag || 1))), { weekday: 'short', day: '2-digit', month: '2-digit' })}` : `🌙 läuft bis ${endLbl(it)}`;
const startOf = a => a.datum ? (schedule(a.datum, a.maschine || '').items.find(i => i.a.id === a.id)?.start ?? null) : null;
function capacity() { const c = Store.cfg(); return Math.max(0, (toMin(c.ende) ?? 1140) - (toMin(c.beginn) ?? 420)); }
// Magnet: Startzeit rastet an Arbeitsbeginn, am Ende eines Auftrags oder so ein, dass das Ende an den nächsten Auftrag stösst
function snapStart(d, mid, exclude, desired, len) {
  const SNAP = 30, b = toMin(Store.cfg().beginn) ?? 420;
  const sc = schedule(d, mid), others = sc.items.filter(it => !exclude.includes(it.a.id));
  const cands = [b, ...sc.carry.map(c => c.end), ...others.map(o => o.end), ...others.map(o => o.start - len)].filter(c => c >= 0 && c <= 1425);
  let best = null;
  cands.forEach(c => { if (Math.abs(c - desired) <= SNAP && (best == null || Math.abs(c - desired) < Math.abs(best - desired))) best = c; });
  return best ?? Math.max(0, Math.min(1425, Math.round(desired / 15) * 15));
}
// Ist für eine Arbeit genau eine (aktive) Maschine hinterlegt, wird sie neuen Aufträgen automatisch zugewiesen
function soleMachine(arbeit) {
  if (!arbeit) return null;
  const l = Store.all('maschinen').filter(m => m.aktiv !== false && (m.arbeitsarten || []).some(x => norm(x) === norm(arbeit)));
  return l.length === 1 ? l[0] : null;
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
  const sc = schedule(d, mid), items = sc.items.filter(it => !ids.includes(it.a.id));
  const cEnd = sc.carry.reduce((m, c) => Math.max(m, c.end), 0);
  let idx = items.length, t0 = items.length ? items[items.length - 1].end : Math.max(b, cEnd);
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
// Angedockte Aufträge mit fester Zeit, die nach hinten rutschen mussten, an ihrer neuen Zeit festhalten
function settleDay(d, mid) {
  const out = schedule(d, mid).items.filter(it => it.pushed).map(it => ({ ...it.a, zeit: fromMin(it.start) }));
  if (out.length) Store.putMany('auftraege', out);
}
/* ---------- Auftragslänge durch Ziehen am Ende ändern (Tagesansicht) ---------- */
function attachResize(h) {
  const blk = h.closest('.blk'), horiz = App.tlH, STEP = 15;
  h.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const a0 = Store.get('auftraege', h.dataset.rsz); if (!a0) return;
    // start = Beginn dieses Blocks, used = Minuten des Auftrags vor diesem Block (Vortage), cap = Platz an diesem Tag
    const cfg = Store.cfg(), b0 = toMin(cfg.beginn) ?? 420, e0 = toMin(cfg.ende) ?? 1140, azEnd = e0 > b0 ? e0 : 1440;
    const start = +h.dataset.s, used = +h.dataset.c || 0, az = !!h.dataset.az, cap = (az && start < azEnd ? azEnd : 1440) - start;
    const len0 = lenOf(a0), p0 = horiz ? e.clientX : e.clientY, minLen = used + STEP;
    let len = len0;
    const drg = blk.getAttribute('draggable'); blk.removeAttribute('draggable');
    blk.classList.add('resizing');
    const lbl = document.createElement('span'); lbl.className = 'rszlbl'; blk.appendChild(lbl);
    const show = () => {
      const seg = Math.min(cap, len - used), more = len - used > cap;
      blk.style[horiz ? 'width' : 'height'] = Math.max(20, seg * PX - 2) + 'px';
      const tot = Math.round(len / 60 * 100) / 100, dt = tot >= 24 ? ` (${Math.floor(tot / 24)} T ${fmtNum(r2(tot % 24))} h)` : '';
      lbl.textContent = az ? `${fromMin(start)}–${fromMin(start + seg)}${more ? ' ⏩' : ''} · total ${hrs(tot)}${dt}`
        : `${used ? 'bis' : fromMin(start) + '–'} ${endLbl({ end: Math.min(1440, start + len - used), rawEnd: start + len - used })} · total ${hrs(tot)}${dt}`;
    };
    show();
    try { h.setPointerCapture(e.pointerId); } catch { }
    const move = ev => {
      const dm = ((horiz ? ev.clientX : ev.clientY) - p0) / UIZ() / PX;
      len = Math.max(minLen, Math.round((len0 + dm) / STEP) * STEP);
      show();
    };
    const up = () => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      blk.classList.remove('resizing'); if (drg) blk.setAttribute('draggable', drg);
      // den Klick nach dem Loslassen nicht als «Auftrag öffnen» werten
      const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', stop, true); setTimeout(() => window.removeEventListener('click', stop, true), 350);
      if (len === len0) { lbl.remove(); App.render(); return; }
      const a = { ...Store.get('auftraege', a0.id), dauer: Math.round(len / 60 * 100) / 100, dauerManuell: true };
      Store.putMany('auftraege', [a]);
      const d = a.datum, mid = a.maschine || '', days = Math.min(SCHED_MAXD, Math.ceil(Math.max(len, len0) / (az ? Math.max(60, azEnd - b0) : 1440)) + 1);
      for (let n = 0; n <= days; n++) settleDay(isoDate(addDays(parseDate(d), n)), mid);
      toast(`${kundeName(a.kunde)}: Dauer ${hrs(a.dauer)}`);
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
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
  al: { von: '', bis: '', k: '', a: '', c: '', m: '', f: '', grp: '', sort: 'wunsch', limit: 300 },
  abr: { minHa: ls('lp_abrmin') || '', von: null, bis: null, k: [], a: [], f: [], m: [], c: [], q: '', src: '', ab: '', grp: '', sort: 'desc', limit: 300, open: null },
  jdb: { minHa: ls('lp_jdbmin') || '', rows: null, meta: null, von: null, bis: null, k: [], a: [], f: [], m: [], c: [], q: '', grp: '', sort: 'desc', limit: 300, open: null },
  plan: { ua: '', um: '', us: ls('lp_pus') || 'wunsch', axW: ls('lp_axW') || 'tage', axT: ls('lp_axT') || 'senkrecht', side: ls('lp_pside') !== '0', upos: ls('lp_upos') || 'neben', mode: ls('lp_pmode') || 'woche', date: new Date(), aa: '', nurBelegt: false },
  lastView: null, tlScroll: null, resetScroll: false, sel: new Set(), selMode: false, fs: false,
  spray: { von: todayIso(), bis: isoDate(addDays(new Date(), 6)), off: new Set(), tab: 'plan', stamm: 'produkte', jq: '', jy: '', jsort: 'desc', jf: null, jfOpen: false, jlimit: 200,
    ak: '', av: `${new Date().getFullYear()}-01-01`, ab: todayIso(), ag: false, ny: 0, nk: '', nc: '', ngep: false, pk: '', pall: false, prq: '', prall: false },
  alimit: 150,
  go(v) { if (v === 'verwaltung') v = VERW.includes(ls('lp_verw')) ? ls('lp_verw') : 'jdbericht'; this.view = v; ls('lp_view', v); this.lastView = null; this.tlScroll = null; window.scrollTo(0, 0); this.render(); },
  render() {
    if (this.view === 'rueben' && !rsOn()) this.view = 'auftraege';
    if (this.view === 'betrieb' && typeof ebOn === 'function' && !ebOn()) this.view = 'auftraege'; // Modul «Eigener Betrieb» (betrieb.js)
    rsNav();
    if (typeof ebNav === 'function') ebNav();
    const navV = this.view === 'maschinen' ? 'mehr' : VERW.includes(this.view) ? 'verwaltung' : this.view;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === navV));
    const fresh = this.lastView !== this.view; this.lastView = this.view;
    const v = Views[this.view] || Views.auftraege;
    const tl = $('.cal'); if (tl && !this.resetScroll) this.tlScroll = { top: tl.scrollTop, left: tl.scrollLeft };
    if (this.resetScroll) { this.tlScroll = null; this.resetScroll = false; }
    document.body.classList.toggle('fs-plan', this.fs && this.view === 'plan');
    document.body.classList.toggle('fs-plan', (this.fs && this.view === 'plan') || (this.view === 'jdbericht' && !!(this.jdb && this.jdb.fs)) || (this.view === 'abrechnung' && !!(this.abr && this.abr.fs)));
    if (fresh) $('#toolbar').innerHTML = v.toolbar();
    if (v.refreshToolbar) v.refreshToolbar();
    $('#content').innerHTML = v.content();
    if (v.after) v.after();
    renderSelbar();
    Sync.setState();
  }
};

// Unternavigation im Modul «Mehr»: Einstellungen, Kunden, Maschinen
// Modul Verwaltung = Bericht, Abrechnung und Kunden (Unterreiter); merkt sich den zuletzt benutzten Reiter
const VERW = ['jdbericht', 'abrechnung', 'kunden'];
const verwNav = cur => { ls('lp_verw', cur); return `<div class="seg mehrnav">${[['jdbericht', 'Bericht'], ['abrechnung', 'Abrechnung'], ['kunden', 'Kunden']].map(([v, l]) => `<button type="button" data-view="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`; };
const mehrNav = cur => `<div class="seg mehrnav">${[['mehr', 'Einstellungen'], ['maschinen', 'Maschinen']].map(([v, l]) => `<button type="button" data-view="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
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
      const unplAll = Store.all('auftraege').filter(a => isOpen(a) && !a.datum);
      const uArb = [...new Set(unplAll.map(a => a.arbeit).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'de'));
      if (P.ua && !uArb.includes(P.ua)) P.ua = '';
      const wun = a => a.wunsch || '', byW = (x, y) => (wun(x) || '9999').localeCompare(wun(y) || '9999') || kundeName(x.kunde).localeCompare(kundeName(y.kunde), 'de');
      const SORT = { wunsch: byW, wunschDesc: (x, y) => (wun(y) || '0000').localeCompare(wun(x) || '0000') || kundeName(x.kunde).localeCompare(kundeName(y.kunde), 'de'),
        kunde: (x, y) => kundeName(x.kunde).localeCompare(kundeName(y.kunde), 'de') || byW(x, y), neu: (x, y) => String(y.nr || '').localeCompare(String(x.nr || '')) };
      const uM = [...new Set(unplAll.map(a => a.maschine || '').filter(id => id && maschine(id)))].sort((x, y) => byPrio(maschine(x), maschine(y)));
      if (P.um && P.um !== '-' && !uM.includes(P.um)) P.um = '';
      const unpl = unplAll.filter(a => (!P.ua || a.arbeit === P.ua) && (!P.um || (P.um === '-' ? !maschine(a.maschine) : a.maschine === P.um))).sort(SORT[P.us] || byW);
      const nOhne = unplAll.filter(a => !maschine(a.maschine)).length;
      const unplCtl = `<div class="unplctl">
          <select class="input" data-plain data-in="pUa" title="Nach Arbeit filtern"><option value="">Alle Arbeiten (${unplAll.length})</option>${uArb.map(a => `<option value="${esc(a)}" ${P.ua === a ? 'selected' : ''}>${esc(a)} (${unplAll.filter(x => x.arbeit === a).length})</option>`).join('')}</select>
          <select class="input" data-plain data-in="pUm" title="Nach vorausgewählter Maschine filtern"><option value="">Alle Maschinen</option>${uM.map(id => `<option value="${id}" ${P.um === id ? 'selected' : ''}>🚜 ${esc(maschine(id).name)} (${unplAll.filter(x => x.maschine === id).length})</option>`).join('')}${nOhne ? `<option value="-" ${P.um === '-' ? 'selected' : ''}>ohne Vorauswahl (${nOhne})</option>` : ''}</select>
          <select class="input" data-plain data-in="pUs" title="Sortierung"><option value="wunsch">Sortierung: Wunschdatum ↑</option><option value="wunschDesc" ${P.us === 'wunschDesc' ? 'selected' : ''}>Sortierung: Wunschdatum ↓</option><option value="kunde" ${P.us === 'kunde' ? 'selected' : ''}>Sortierung: Kunde A–Z</option><option value="neu" ${P.us === 'neu' ? 'selected' : ''}>Sortierung: neueste Aufträge</option></select>
        </div>`;
      if (App.fs) return `<div class="fsview">
        <div class="fsbar">
          <button class="btn small" data-act="pNav" data-d="-1" aria-label="Zurück">◀</button>
          <span class="lbl">${esc(this.label(true))}</span>
          <button class="btn small" data-act="pNav" data-d="1" aria-label="Weiter">▶</button>
          <div class="seg"><button type="button" data-act="pMode" data-v="tag" class="${P.mode === 'tag' ? 'on' : ''}">Tag</button><button type="button" data-act="pMode" data-v="woche" class="${P.mode === 'woche' ? 'on' : ''}">Woche</button></div>
          <span class="zoomctl"><button class="btn small" data-act="zoom" data-d="-1" aria-label="Verkleinern">−</button><span class="zv">${Math.round(App.zoom * 100)} %</span><button class="btn small" data-act="zoom" data-d="1" aria-label="Vergrössern">＋</button></span>
          <button class="btn small fsclose" data-act="fs" aria-label="Vollbild schliessen">✕</button>
        </div>${grid}</div>`;
      const below = P.upos === 'unter';
      return `<div class="planwrap ${App.plan.side === false ? 'noside' : ''} ${below ? 'ubelow' : ''}">
        <div>${grid}</div>
        <aside class="unplanned" data-drop="">
          <h3>Noch nicht eingeplant (${unpl.length}${P.ua ? ` von ${unplAll.length}` : ''})<button type="button" class="btn mini uposbtn" data-act="uPos" title="${below ? 'Neben dem Kalender anzeigen' : 'Unter dem Kalender anzeigen'}">${below ? '⇥ daneben' : '⤓ darunter'}</button></h3>
          ${unplAll.length ? unplCtl : ''}
          <div class="slot">${unpl.map(unplCard).join('') || `<div class="none">${unplAll.length ? 'Keine Aufträge für diese Auswahl.' : 'Alles eingeplant 👍'}</div>`}</div>
        </aside></div>`;
    },
    // ---- Woche: Maschinen nebeneinander, pro Tag eine 24h-Leiste und die Aufträge
    // eine Zelle (Tag × Maschine) der Wochenansicht
    weekCell(d, col) {
      const today = todayIso(), c = Store.cfg(), b = toMin(c.beginn) ?? 420, e = toMin(c.ende) ?? 1140;
      const pct = m => (m / 1440 * 100).toFixed(2) + '%';
      const off = col.m && !inSeason(col.m, d);
      const { all: items } = schedule(d, col.id);
      const strip = items.length ? `<div class="strip" title="0–24 Uhr">
          <i class="night" style="left:0;width:${pct(b)}"></i><i class="night" style="left:${pct(e)};right:0"></i>
          ${items.map(it => `<i class="job ${it.cont ? 'cont' : ''} ${App.sel.has(it.a.id) ? 'sel' : ''}" style="left:${pct(it.start)};width:${pct(it.end - it.start)}" title="${esc(kundeName(it.a.kunde))} ${fromMin(it.start)}–${fromMin(it.end)}${it.cont ? ' (Fortsetzung)' : ''}"></i>`).join('')}
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
        const { all: items } = schedule(d, col.id);
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
      const op = isOpen(a) && !it.cont, info = it.cont ? contLbl(it) : it.pushed && op ? `⤵ angedockt (gewünscht ${esc(a.zeit)})` : it.noDur && op ? '⚠ Dauer fehlt (1 h angenommen)' : it.over && op ? weiterLbl(it) : '';
      const pos = horiz ? `left:${s * PX + 1}px;width:${len}px` : `top:${s * PX + 1}px;height:${len}px`;
      const big = w > 90;
      const tm = it.cont ? `${fromMin(s)}–${endLbl(it)}` : rangeLbl(it);
      return `<div class="blk ${st} ${it.cont ? 'cont' : ''} ${it.noDur && op ? 'warn' : ''} ${it.over && op ? 'night2' : ''} ${App.sel.has(a.id) ? 'sel' : ''}" style="${pos}" data-act="editOrder" data-id="${a.id}" ${op ? 'draggable="true"' : ''} title="${esc(kfText(a))} ${tm}${it.cont ? ' · ' + contLbl(it) : ''}${horiz ? ' · ' + esc(artKultur(a).replace(/<[^>]+>/g, '')) : ''}">
        <b>${tm}${horiz ? '</b><b>' : ' '}${kfHtml(a)}${it.fixed && !it.cont ? ' 📌' : ''}</b>
        ${it.cont && !(h > 54 && big) ? '<span class="w">↪ Fortsetzung</span>' : ''}
        ${h > 34 && big ? `<span>${artKultur(a)}${a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : ''}${dauerOf(a) ? ` · ${hrs(dauerOf(a))}` : ''}${st === 'erledigt' || st === 'verrechnet' ? ' · ✓' : ''}</span>` : ''}
        ${h > 54 && big && info ? `<span class="w">${info}</span>` : ''}
        ${h > 54 && big ? sprayShort(a, { noFeld: true }) : ''}
        ${h > 70 && big && a.notiz ? `<span class="note">${esc(a.notiz)}</span>` : ''}
        ${op ? `<button type="button" class="blkdone" data-act="done" data-id="${a.id}" title="Als erledigt melden">✓</button>` : ''}
        ${isOpen(a) ? `<i class="rsz" data-rsz="${a.id}" data-s="${s}" data-c="${Math.max(0, lenOf(a) - (q - s) - (it.rest || 0))}" data-az="${it.az ? 1 : ''}" title="Ziehen: Auftragslänge ändern"></i>` : ''}
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
        const { all: items } = schedule(d, col.id);
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
      $$('.blk .rsz').forEach(h => attachResize(h));
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
  abrechnung: abView(),
  rueben: rsView(),

  /* ---------- Kunden ---------- */
  kunden: {
    toolbar() {
      return `<h1>Kunden</h1>${verwNav('kunden')}
        <input class="input search" type="search" placeholder="Kunde suchen…" value="${esc(App.filter.kq)}" data-in="kSearch">
        <label class="tog"><input type="checkbox" data-in="kAll" ${App.filter.kall ? 'checked' : ''}> auch inaktive</label>
        <label class="tog" title="Zuweisung der Pflanzenschutz-Parzellen (Modul Spritzen) zu den Feldern in der Kundenkarte anzeigen"><input type="checkbox" data-in="parzOn" ${parzOn() ? 'checked' : ''}> Parzellen-Zuweisung (Spritzen)</label>
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
    toolbar() { return `<h1>Maschinen</h1>${mehrNav('maschinen')}<button class="btn primary" data-act="editMaschine">＋ Maschine</button>`; },
    content() {
      const list = Store.all('maschinen').sort(byPrio);
      if (!list.length) return '<div class="empty">Noch keine Maschinen erfasst.</div>';
      return `<div class="rows">${list.map(m => {
        return `<div class="rowi ${m.aktiv === false ? 'off' : ''}" data-act="editMaschine" data-id="${m.id}">
          <span class="updown"><button type="button" class="x" data-act="mUp" data-id="${m.id}" aria-label="Nach oben">▲</button><button type="button" class="x" data-act="mDown" data-id="${m.id}" aria-label="Nach unten">▼</button></span>
          <span class="num">${esc(m.artNr || '')}</span>
          <div class="grow"><div class="t">${esc(m.name)}${m.kurz ? ` <span class="chip">${esc(m.kurz)}</span>` : ''}</div>
            <div class="s">${esc((m.arbeitsarten || []).join(', ') || 'keine Arbeitsart')}${m.leistung ? ` · ${fmtNum(m.leistung)} ha/h` : ''} · pro ${esc(m.einheit || '—')}${m.ansatz ? ` CHF ${fmtNum(m.ansatz)}` : ''}</div></div>
          <label class="switch mtog" data-stop title="${m.aktiv === false ? 'Inaktiv – antippen zum Aktivieren' : 'Aktiv – antippen zum Deaktivieren'}"><input type="checkbox" data-in="mAktiv" data-id="${m.id}" ${m.aktiv !== false ? 'checked' : ''}><span class="sl"></span><span class="lbl">${m.aktiv === false ? 'inaktiv' : 'aktiv'}</span></label>
        </div>`; }).join('')}</div>
        <p class="nr" style="margin-top:10px">Mit ▲▼ legst du die Priorität fest – in dieser Reihenfolge erscheinen die Maschinen in der Planung und in der Auswahl. Mit dem Schalter rechts wird eine Maschine nach Bedarf aktiviert oder deaktiviert; in der Planung und in der Auswahl stehen nur aktive Maschinen.</p>`;
    }
  },

  /* ---------- Mehr ---------- */
  mehr: {
    toolbar() { return `<h1>Mehr</h1>${mehrNav('mehr')}`; },
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
        ${typeof icsPanel === 'function' ? icsPanel() : ''}
        ${jdOcPanel()}
        ${rsPanel()}
        ${typeof ebPanel === 'function' ? ebPanel() : ''}
        <div class="panel"><h2>Planung: Achsen</h2>
          <div class="two">
            <label class="fld"><span>Wochenansicht</span><select class="input" data-plain data-in="axW"><option value="tage">Tage untereinander, Maschinen nebeneinander</option><option value="maschinen" ${App.plan.axW === 'maschinen' ? 'selected' : ''}>Maschinen untereinander, Tage nebeneinander</option></select></label>
            <label class="fld"><span>Planung: nicht eingeplante Aufträge (Tablet quer / PC)</span><select class="input" data-plain data-in="uPos"><option value="neben">neben dem Kalender</option><option value="unter" ${App.plan.upos === 'unter' ? 'selected' : ''}>unter dem Kalender</option></select></label>
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
  return it ? rangeLbl(it) : '';
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
  if (it.cont) return `<div class="pcard cont ${s}" data-act="editOrder" data-id="${a.id}" title="Fortsetzung – Auftragsdatum ist das Startdatum ${fmtDate(a.datum)}">
    <div class="tm">${fromMin(it.start)}–${endLbl(it)}</div>
    <b>${kfHtml(a)}</b><div class="sub contlbl">${contLbl(it)}</div></div>`;
  return `<div class="pcard ${s} ${App.sel.has(a.id) ? 'sel' : ''}" data-act="editOrder" data-id="${a.id}" ${isOpen(a) ? 'draggable="true"' : ''}>
    <div class="tmrow"><div class="tm">${rangeLbl(it)}${it.fixed ? ' 📌' : ''}${it.pushed ? ' ⤵' : ''}${it.over ? `<span title="${esc(weiterLbl(it))}">${it.az ? ' ⏩' : ' 🌙'}</span>` : ''}</div>${isOpen(a) ? `<button type="button" class="btn mini donebtn donetop" data-act="done" data-id="${a.id}" title="Als erledigt melden: Datum, Fläche, Stunden, Bemerkungen">✓ Erledigt</button>` : ''}</div>
    <b>${kfHtml(a)}</b>
    <div class="sub">${artKultur(a)}</div>
    <div class="sub">${a.flaeche ? fmtNum(a.flaeche) + ' ha' : ''}${a.flaeche && (d || isOpen(a)) ? ' · ' : ''}${d ? '⏱ ' + hrs(d) : isOpen(a) ? '⏱ Dauer fehlt' : ''}${s === 'erledigt' || s === 'verrechnet' ? ' · ✓' : ''}</div>
    ${sprayShort(a, { noFeld: true })}${a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}
  </div>`;
}
const mKurz = m => m.kurz || m.name;
function unplCard(a) {
  return `<div class="pcard unpl ${App.sel.has(a.id) ? 'sel' : ''}" data-act="planOrder" data-id="${a.id}" draggable="true">
    <b>${kfHtml(a)}</b>
    <div class="sub">${artKultur(a)}${a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : ''}</div>
    <div class="meta"><span class="chip ${wishLate(a) ? 'warn' : ''}">${wishTxt(a)}</span>${maschine(a.maschine) ? `<span class="chip vmchip" title="Vorausgewählte Maschine">🚜 ${esc(mKurz(maschine(a.maschine)))}</span>` : ''}</div>
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
    this.onSubmit = onSubmit; this.afterSave = null;
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

function orderDialog(id, { plan, kunde: kundeId, pre, arbeit, vorlage } = {}) {
  const isNew = !id;
  const a = isNew ? { id: uid(), erfasst: Date.now(), nr: Store.nextAuftragNr(), status: 'offen', kunde: kundeId || '', arbeit: arbeit || '' } : structuredClone(Store.get('auftraege', id));
  if (!a) return;
  const vTitel = vorlage && vorlage.titel;
  if (isNew && vorlage) { Object.assign(a, structuredClone(vorlage)); delete a.titel; }
  if (isNew) sprayDefaults(a);
  if (isNew && pre) { a.maschine = pre.maschine || ''; a.zeit = pre.zeit || ''; plan = true; }
  const k = a.kunde && Store.get('kunden', a.kunde);
  const s = statusOf(a), done = s === 'erledigt' || s === 'verrechnet';
  const planDate = a.datum || pre?.datum || (plan ? (a.wunsch && a.wunsch >= todayIso() ? a.wunsch : (App.view === 'plan' ? isoDate(App.plan.date) : todayIso())) : '');
  const body = `
    ${isOpen(a) ? `<div class="odtop"><span class="nr">${isNew ? 'Neuer Auftrag' : `Auftrag ${esc(a.nr || '')}`}</span><button type="button" class="btn small donebtn odone" data-act="doneSave" data-id="${a.id}" title="Auftrag speichern und direkt als erledigt melden (Datum, Fläche, Stunden, Bemerkungen)">✓ Erledigt melden</button></div>` : ''}
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
    <label class="fld" id="vmBox" ${a.datum ? 'hidden' : ''}><span>Maschine (Vorauswahl)</span><select class="input" name="vmasch"></select><div class="sub2" id="vmHint">Wird beim Einplanen vorgeschlagen; in der Planung bei «Noch nicht eingeplant» angezeigt und filterbar.</div></label>
    ${typeof vbInfoHtml === 'function' && a.vbInfo ? vbInfoHtml(a.vbInfo) : ''}
    ${sprayBox(a)}
    ${rsSeedBox(a)}
    <label class="fld"><span>Bemerkungen</span><textarea class="input" name="notiz" placeholder="Zufahrt, Besonderheiten, Ansprechperson…">${esc(a.notiz || '')}</textarea></label>

    <details class="box" id="planBox" ${a.datum || plan === true ? 'open' : ''}>
      <summary><b>${a.datum ? 'Einplanung' : 'Direkt einplanen'}</b></summary>
      <div style="margin-top:10px">
        <div class="two">
          <label class="fld"><span>Datum</span><input class="input" type="date" name="datum" value="${planDate}"></label>
          <label class="fld"><span>Startzeit (leer = automatisch)</span><input class="input" type="time" name="zeit" value="${a.zeit || ''}" step="900"></label>
        </div>
        <label class="fld"><span>Maschine</span><select class="input" name="maschine"></select><div class="hint" id="mHint"></div></label>
        <label class="fld"><span>Dauer (h)</span><input class="input" name="dauer" inputmode="decimal" value="${a.dauerManuell ? (a.dauer ?? '') : ''}" style="max-width:200px"><div class="sub2" id="dHint"></div></label>
        <label class="tog" title="Für Arbeiten über mehrere Tage: pro Tag nur von Arbeitsbeginn bis Arbeitsende, der Rest folgt am nächsten Tag. Ohne Häkchen läuft der Auftrag durchgehend (auch über Nacht)."><input type="checkbox" name="mehrtag" ${a.mehrtag === 'arbeitszeit' ? 'checked' : ''}> Mehrtägig nur in der Arbeitszeit (${esc(Store.cfg().beginn || '07:00')}–${esc(Store.cfg().ende || '19:00')}, Rest am nächsten Tag)</label>
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

  Dlg.open(isNew ? (vorlage ? (vTitel || 'Spritzauftrag erfassen') : 'Neuer Auftrag') : 'Auftrag', body, footer, fd => {
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
      Object.assign(o, { datum: fd.get('datum'), zeit: fd.get('zeit'), maschine: m?.id || '', dauerManuell: manual != null, dauer: manual ?? defaultDauer(m, o.flaeche), mehrtag: fd.get('mehrtag') ? 'arbeitszeit' : '' });
    } else if (!o.datum || planOpen) {
      Object.assign(o, { datum: '', zeit: '' });
      // Vorauswahl der Maschine für nicht eingeplante Aufträge
      const vm = fd.get('vmasch') || '';
      if (vm !== (o.maschine || '')) { o.maschine = vm; if (!o.dauerManuell) o.dauer = defaultDauer(maschine(vm), o.flaeche); }
    }
    if (isNew && !o.maschine) { const sm = soleMachine(o.arbeit); if (sm) { o.maschine = sm.id; if (!o.dauerManuell) o.dauer = defaultDauer(sm, o.flaeche); } }
    if (isSpray(o)) Object.assign(o, readSpray(Dlg.form));
    else if (isNew) ['wasser', 'duese', 'traktor'].forEach(k => delete o[k]);
    { const sd = readRsSeed(Dlg.form, o); if (sd) Object.assign(o, sd); }
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
    const h = num(f.dauer.value) ?? d;
    if (h >= 24) $('#dHint', f).insertAdjacentHTML('beforeend', `<div>= ${Math.floor(h / 24)} ${Math.floor(h / 24) === 1 ? 'Tag' : 'Tage'} ${fmtNum(r2(h % 24))} h rund um die Uhr${capacity() ? ` · in der Arbeitszeit ≈ ${fmtNum(Math.ceil(h * 60 / capacity() * 10) / 10)} Arbeitstage` : ''}</div>`);
  };
  const checkKunde = () => {
    const t = f.kunde.value.trim();
    $('#kHint', f).textContent = !t || findKunde(t) || !$('#kSug', f).hidden ? '' : 'Kein ähnlicher Kunde gefunden. Neue Kunden werden in MyJohnDeere erfasst.';
  };
  wireKundeSuggest(f, checkKunde);
  const fillVm = () => { const cur = f.vmasch.value || a.maschine || ''; f.vmasch.innerHTML = machineOptions(f.wunsch.value || todayIso(), f.arbeit.value.trim(), cur); f.vmasch.value = cur; if (f.vmasch.value !== cur) f.vmasch.value = ''; };
  // neuer Auftrag: einzige für die Arbeit hinterlegte Maschine automatisch vorauswählen (solange nicht von Hand gewählt)
  let vmTouched = !isNew || !!a.maschine;
  const autoVm = () => {
    if (vmTouched) return;
    const sm = soleMachine(f.arbeit.value.trim());
    f.vmasch.value = sm ? sm.id : ''; if (sm && f.vmasch.value !== sm.id) { fillVm(); f.vmasch.value = sm.id; }
    if ($('#planBox', f).open && sm && !f.maschine.dataset.touched) { f.maschine.value = sm.id; showDauer(); }
    $('#vmHint', f).textContent = sm ? `Automatisch: einzige Maschine für «${f.arbeit.value.trim()}».` : 'Wird beim Einplanen vorgeschlagen; in der Planung bei «Noch nicht eingeplant» angezeigt und filterbar.';
  };
  f.vmasch.addEventListener('change', () => { vmTouched = true; });
  f.arbeit.addEventListener('change', () => { fillVm(); autoVm(); }); f.wunsch.addEventListener('change', fillVm);
  f.arbeit.addEventListener('change', fillMachines);
  f.datum.addEventListener('change', fillMachines);
  f.maschine.addEventListener('change', () => { f.maschine.dataset.touched = '1'; showDauer(); });
  f.flaeche.addEventListener('input', showDauer);
  f.dauer.addEventListener('input', showDauer);
  $('#planBox', f).addEventListener('toggle', e => {
    if (e.target.open && !f.datum.value) f.datum.value = f.wunsch.value || todayIso();
    if (!a.datum) {
      $('#vmBox', f).hidden = e.target.open;
      if (e.target.open) { if (f.vmasch.value) { f.maschine.innerHTML = machineOptions(f.datum.value, f.arbeit.value.trim(), f.vmasch.value); f.maschine.value = f.vmasch.value; } }
      else if (f.maschine.value) { fillVm(); f.vmasch.value = f.maschine.value; }
    }
    if (e.target.open) fillMachines();
  });
  if (f.status) f.status.addEventListener('change', () => {
    const dn = ['erledigt', 'verrechnet'].includes(f.status.value);
    $('#doneBox', f).hidden = !dn; f.status.closest('.fld').style.marginBottom = dn ? '12px' : '0';
    if (dn) {
      if (!f.erledigtAm.value) f.erledigtAm.value = f.datum.value || a.datum || todayIso();
      if (!f.flaecheEff.value && num(f.flaeche.value) != null) f.flaecheEff.value = num(f.flaeche.value);
      if (!f.stundenEff.value) { const d = num(f.dauer.value) ?? defaultDauer(maschine(f.maschine.value), num(f.flaeche.value)); if (d != null) f.stundenEff.value = d; }
    }
  });
  fillVm(); fillMachines(); autoVm(); checkKunde(); wireSpray(f); wireRsSeed(f, a); wireFeld(f, a);
  if (!a.datum && $('#planBox', f).open) $('#vmBox', f).hidden = true;
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
    ${rsDoneHtml(a)}
    <label class="fld"><span>Bemerkungen</span><textarea class="input" name="notiz">${esc(a.notiz || '')}</textarea></label>`;
  Dlg.open('Erledigt melden', body, saveFooter(), fd => {
    Object.assign(a, { status: 'erledigt', erledigtAm: fd.get('erledigtAm') || todayIso(), maschine: fd.get('maschine'),
      flaecheEff: num(fd.get('flaecheEff')), stundenEff: num(fd.get('stundenEff')), notiz: fd.get('notiz').trim() });
    rsDoneRead(fd, a);
    if (!a.datum) a.datum = a.erledigtAm;
    Store.put('auftraege', a); toast('Als erledigt gemeldet'); return true;
  });
  rsDoneWire(Dlg.form);
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
    saveFooter(id ? `${lock ? '' : `<button type="button" class="btn danger" data-act="delKunde" data-id="${k.id}">Löschen</button>`}<button type="button" class="btn" data-act="newOrderFor" data-id="${k.id}">＋ Auftrag</button>${k.jdId ? `<button type="button" class="btn" data-act="jdOc" data-k="kunde" data-id="${k.id}" title="Kunde im John Deere Operations Center öffnen (Name wird kopiert)">↗ MyJohnDeere</button>` : ''}` : ''), fd => {
      if (!lock) k.name = (fd.get('name') || '').trim();
      ['nr', 'anrede', 'adresse', 'plz', 'ort', 'tel', 'handy', 'mail', 'notiz'].forEach(x => { k[x] = (fd.get(x) || '').trim(); });
      ['preisSpritze', 'preisFahrer', 'preisTraktor'].forEach(x => { k[x] = num(fd.get(x)); });
      k.zuschlag = num(fd.get('zuschlag')) != null ? num(fd.get('zuschlag')) / 100 : null;
      const war = k.aktiv !== false; k.aktiv = !!fd.get('aktiv'); if (k.aktiv) delete k.manInaktiv; else if (war) k.manInaktiv = true; // von Hand inaktiv gesetzt: der MyJohnDeere-Abgleich aktiviert ihn nicht wieder
      Store.put('kunden', k); return true;
    });
}

function maschineDialog(id) {
  const m = id ? structuredClone(Store.get('maschinen', id)) : { id: uid(), einheit: 'ha', aktiv: true, arbeitsarten: [] };
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
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="aktiv" ${m.aktiv !== false ? 'checked' : ''}> Aktiv (in Planung und Auswahl anzeigen)</label>`;
  Dlg.open(id ? 'Maschine bearbeiten' : 'Neue Maschine', body,
    saveFooter(id ? `<button type="button" class="btn danger" data-act="delMaschine" data-id="${m.id}">Löschen</button>` : ''), fd => {
      Object.assign(m, {
        artNr: fd.get('artNr').trim(), prio: num(fd.get('prio')), name: fd.get('name').trim(), kurz: String(fd.get('kurz') || '').trim(), einheit: fd.get('einheit'), leistung: num(fd.get('leistung')),
        ansatz: num(fd.get('ansatz')), aktiv: !!fd.get('aktiv'),
        arbeitsarten: uniqSort([...fd.getAll('aa'), ...fd.get('aaNeu').split(',')])
      });
      delete m.monate;
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
    if (cal.id === 'tlwrapH') { App.zoomAnchor = c => { c.scrollLeft = Math.max(0, cx * r - c.clientWidth / 2); c.scrollTop = Math.max(0, cy - c.clientHeight / 2); }; App.zoom = z; App.render(); return; }
    App.zoomAnchor = c => {
      c.scrollTop = Math.max(0, cy * r - c.clientHeight / 2);
      c.scrollLeft = Math.max(0, (dayCols ? cx * Math.max(0.5, Math.min(1.6, z)) / Math.max(0.5, Math.min(1.6, old)) : cx * r) - c.clientWidth / 2);
    };
  }
  App.zoom = z; App.render();
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
  const m = maschine(mid), { all: items } = schedule(d, mid);
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
    text(items.length ? `${items.length} ${items.length > 1 ? 'Aufträge' : 'Auftrag'} · ${fmtNum(total / 60)} h · ${fromMin(items[0].start)} bis ${endLbl(items[items.length - 1])} Uhr` : 'Keine Aufträge eingeplant', P, F('500', 28), muted, y + 10);
    y += 44;
    items.forEach((it, idx) => {
      const a = it.a, k = Store.get('kunden', a.kunde) || {};
      const x = P + TW, w = W - x - P;
      const top = y + 24;
      let yy = top + 40;
      const lines = [];
      ctx.font = F('700', 36); lines.push([kundeName(a.kunde), F('700', 36), ink, 46]);
      if (it.cont) lines.push([contLbl(it).replace('↪', '→'), F('600', 28), muted, 38]);
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
        ctx.font = F('500', 30); ctx.fillStyle = muted; ctx.fillText('– ' + endLbl(it), P + 26, top + 80);
        lines.forEach(([t, f, c, lh], i) => { ctx.font = f; ctx.fillStyle = c; ctx.fillText(t, x, yy); yy += lh; });
        ctx.fillStyle = line; ctx.fillRect(P, y + hBlock + 23, W - 2 * P, 1);
      }
      y += hBlock + 24;
    });
    y += 30;
    text(`Erstellt ${new Date().toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })} · IM-Verwalter`, P, F('400', 22), muted, y);
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
// Auswahl für den Produktbedarf: eingeplante sind standardmässig dabei (ausschliessbar), nicht eingeplante werden von Hand eingeschlossen
const spSet = k => { try { return new Set(JSON.parse(ls(k) || '[]')); } catch { return new Set(); } };
const spSave = () => { ls('lp_spex', JSON.stringify([...App.spray.ex])); ls('lp_spinc', JSON.stringify([...App.spray.inc])); };
function spInit() { const S = App.spray; if (!S.ex) { S.ex = spSet('lp_spex'); S.inc = spSet('lp_spinc'); } return S; }
const spIn = a => { const S = spInit(); return a.datum ? !S.ex.has(a.id) : S.inc.has(a.id); };
const UNPL = 'unpl'; // Spalte «nicht eingeplant»
function spNeedOrders(days) {
  return Store.all('auftraege').filter(a => isSpray(a) && isOpen(a) && (a.datum ? days.includes(a.datum) : true) && spIn(a));
}
function sprayNeed(days) { // { prods: [{name, einheit, perDay:{d:n}, tot}], wasser:{perDay,tot}, flaeche:{perDay,tot}, missing, nUnpl, n }
  const prods = new Map(), wasser = { perDay: {}, tot: 0 }, flaeche = { perDay: {}, tot: 0 }; let missing = 0, nUnpl = 0;
  const list = spNeedOrders(days);
  list.forEach(a0 => {
    const a = a0.datum ? a0 : { ...a0, datum: UNPL }; if (!a0.datum) nUnpl++;
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
  const plist = [...prods.values()].sort((x, y) => ((order.indexOf(x.name) + 1 || 999) - (order.indexOf(y.name) + 1 || 999)) || x.name.localeCompare(y.name, 'de'));
  return { prods: plist, wasser, flaeche, missing, nUnpl, n: list.length };
}
function sprayCard(a) {
  const s = statusOf(a), m = maschine(a.maschine);
  const inc = isOpen(a) && spIn(a);
  return `<article class="card ${isOpen(a) ? (inc ? 'spon' : 'spoff') : ''}" data-act="editOrder" data-id="${a.id}">
    ${isOpen(a) ? `<label class="spinc" data-stop title="Im Produktbedarf mitrechnen"><input type="checkbox" data-in="spInc" value="${a.id}" ${inc ? 'checked' : ''}><span>${inc ? 'im Bedarf' : 'nicht im Bedarf'}</span></label>` : ''}
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
      const body = t === 'journal' ? journalContent() : t === 'abrechnung' ? abrechnungContent() : t === 'nachweis' ? nachweisContent() : t === 'stamm' ? stammContent() : t === 'vorbestellung' ? vbContent() : t === 'programme' ? vbProgContent() : this.planContent();
      return spTabs() + body;
    },
    planContent() {
      const S = App.spray, days = sprayDays(), sel = days.filter(d => !S.off.has(d));
      const need = sprayNeed(sel), cols = need.nUnpl ? [...sel, UNPL] : sel, showDays = cols.length > 1 && sel.length <= 7;
      const dayHead = d => d === UNPL ? 'nicht eingeplant' : fmtDate(d, { weekday: 'short', day: '2-digit', month: '2-digit' });
      const cell = (o, d, u) => o.perDay[d] ? `${fmtNum(r2(o.perDay[d]))}` : '';
      const table = need.prods.length || need.wasser.tot
        ? `<div class="tscroll"><table class="need"><thead><tr><th>Produkt</th>${showDays ? cols.map(d => `<th>${dayHead(d)}</th>`).join('') : ''}<th>Total</th><th></th></tr></thead><tbody>
            ${need.prods.map(p => `<tr><td>${esc(p.name)}</td>${showDays ? cols.map(d => `<td>${cell(p, d)}</td>`).join('') : ''}<td><b>${fmtNum(r2(p.tot))}</b></td><td>${esc(p.einheit)}</td></tr>`).join('')}
            ${need.wasser.tot ? `<tr class="water"><td>Wasser</td>${showDays ? cols.map(d => `<td>${cell(need.wasser, d)}</td>`).join('') : ''}<td><b>${fmtNum(r2(need.wasser.tot))}</b></td><td>l</td></tr>` : ''}
            <tr class="area"><td>Fläche</td>${showDays ? cols.map(d => `<td>${cell(need.flaeche, d)}</td>`).join('') : ''}<td><b>${fmtNum(r2(need.flaeche.tot))}</b></td><td>ha</td></tr>
          </tbody></table></div>`
        : '<p class="nr">Für die Auswahl sind keine Spritzaufträge mit Produkten vorhanden.</p>';
      const planned = Store.all('auftraege').filter(a => isSpray(a) && a.datum && sel.includes(a.datum) && statusOf(a) !== 'verrechnet')
        .sort((x, y) => x.datum.localeCompare(y.datum) || (startOf(x) ?? 0) - (startOf(y) ?? 0));
      const unpl = Store.all('auftraege').filter(a => isSpray(a) && isOpen(a) && !a.datum).sort((x, y) => (x.wunsch || '9999').localeCompare(y.wunsch || '9999'));
      const nPlOff = planned.filter(a => isOpen(a) && !spIn(a)).length, nUOn = unpl.filter(spIn).length;
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
            <p>${sel.length} ${sel.length === 1 ? 'Tag' : 'Tage'} · ${need.n} ${need.n === 1 ? 'Auftrag' : 'Aufträge'} eingeschlossen${need.nUnpl ? ` (davon ${need.nUnpl} nicht eingeplant)` : ''}${nPlOff ? ` · ${nPlOff} eingeplante ausgeschlossen` : ''}</p>
            <p class="nr" style="margin-top:-4px">Mit dem Häkchen auf jedem Auftrag bestimmst du, ob er mitgerechnet wird.</p>
            ${table}
            ${need.missing ? `<p style="color:var(--warn)">⚠ ${need.missing} ${need.missing > 1 ? 'Aufträge ohne Fläche wurden' : 'Auftrag ohne Fläche wurde'} nicht mitgerechnet.</p>` : ''}
            ${need.prods.length || need.wasser.tot ? `<div class="btns"><button class="btn" data-act="spImg">Als Bild teilen</button><button class="btn" data-act="spCsv">CSV</button></div>` : ''}
          </div>
        </div><div>
          ${groups ? `<div class="spbtns top"><button type="button" class="btn mini" data-act="spExAll" data-v="0">alle eingeplanten einschliessen</button><button type="button" class="btn mini" data-act="spExAll" data-v="1">keine eingeplanten</button></div>${groups}` : '<div class="panel"><p>Keine Spritzaufträge an den ausgewählten Tagen eingeplant.</p></div>'}
          ${unpl.length ? `<div class="section-h spsec">Noch nicht eingeplant (${unpl.length}) · ${nUOn} im Bedarf
              <span class="spbtns"><button type="button" class="btn mini" data-act="spIncAll" data-v="1">alle einschliessen</button><button type="button" class="btn mini" data-act="spIncAll" data-v="0">keine</button></span></div>
            <div class="list grid">${unpl.map(sprayCard).join('')}</div>` : ''}
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
  const range = (sel.length === 1 ? fmtDate(sel[0], { weekday: 'long', day: 'numeric', month: 'long' }) : `${fmtDate(sel[0], { day: 'numeric', month: 'short' })} – ${fmtDate(sel[sel.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })} (${sel.length} Tage)`)
  ;
  return { sel, need, rows, range };
}
function sprayCsv() {
  const { sel, need } = sprayNeedTable(), cols = need.nUnpl ? [...sel, UNPL] : sel;
  const head = ['Produkt', ...cols.map(d => d === UNPL ? 'nicht eingeplant' : d), 'Total', 'Einheit'];
  const line = (n, o, u) => [n, ...cols.map(d => o.perDay[d] ? r2(o.perDay[d]) : ''), r2(o.tot), u];
  const rows = [head, ...need.prods.map(p => line(p.name, p, p.einheit))];
  if (need.wasser.tot) rows.push(line('Wasser', need.wasser, 'l'));
  rows.push(line('Fläche', need.flaeche, 'ha'));
  download(`Produktbedarf_${sel[0]}_bis_${sel[sel.length - 1]}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
function sprayImage() {
  const { rows, range, sel, need } = sprayNeedTable();
  const W = 1080, P = 48, F = (w, s) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  cv.width = W; cv.height = 190 + 40 + rows.length * 64 + 90;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, cv.height);
  ctx.fillStyle = '#2f6b3a'; ctx.fillRect(0, 0, W, 190);
  ctx.font = F('600', 30); ctx.fillStyle = '#d9ead9'; ctx.fillText('Produktbedarf Spritzen', P, 62);
  ctx.font = F('700', 44); ctx.fillStyle = '#fff'; ctx.fillText(range, P, 128);
  ctx.font = F('500', 26); ctx.fillStyle = '#d9ead9'; ctx.fillText(`${need.n} ${need.n === 1 ? 'Auftrag' : 'Aufträge'}${need.nUnpl ? `, davon ${need.nUnpl} noch nicht eingeplant` : ''}`, P, 168);
  let y = 230;
  rows.forEach(([n, v, u], i) => {
    if (i % 2 === 0) { ctx.fillStyle = '#f6f5f1'; ctx.fillRect(0, y - 44, W, 64); }
    const total = n === 'Fläche';
    ctx.font = F(total ? '600' : '500', 34); ctx.fillStyle = total ? '#5c625d' : '#1d211e'; ctx.fillText(n, P, y);
    ctx.font = F('700', 36); ctx.textAlign = 'right'; ctx.fillStyle = '#1d211e'; ctx.fillText(v, W - P - 110, y);
    ctx.font = F('500', 32); ctx.textAlign = 'left'; ctx.fillStyle = '#5c625d'; ctx.fillText(u, W - P - 90, y);
    y += 64;
  });
  ctx.font = F('400', 22); ctx.fillStyle = '#5c625d'; ctx.fillText(`Erstellt ${new Date().toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })} · IM-Verwalter`, P, y + 30);
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
    .sort((x, y) => ((y.maschine === mid) - (x.maschine === mid)) || (x.wunsch || '9999').localeCompare(y.wunsch || '9999') || (x.nr || '').localeCompare(y.nr || ''));
  const hidden = all ? 0 : Store.all('auftraege').filter(a => isOpen(a) && !a.datum).length - list.length;
  const where = `${fmtDate(d, { weekday: 'short', day: '2-digit', month: '2-digit' })}${minute != null ? ' · ab ' + fromMin(Math.round(minute / 15) * 15) : ''} · ${esc(m ? m.name : 'ohne Maschine')}`;
  const body = `<p style="margin-top:0" class="nr">${where}${m && !all && (m.arbeitsarten || []).length ? ` · nur ${esc(m.arbeitsarten.join(', '))}` : ''}</p>
    ${list.length ? `<div class="rows">${list.map(a => `<div class="rowi" data-act="pickPlace" data-id="${a.id}">
        <div class="grow"><div class="t">${esc(kundeName(a.kunde))}</div>
          <div class="s">${artKultur(a)}${a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : ''}${(defaultDauer(m, a.flaeche) ?? a.dauer) ? ` · ${hrs(defaultDauer(m, a.flaeche) ?? a.dauer)}` : ''}</div>
          ${sprayShort(a)}${a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}</div>
        ${mid && a.maschine === mid ? '<span class="chip vmchip" title="Für diese Maschine vorausgewählt">🚜 vorausgewählt</span>' : ''}<span class="chip ${wishLate(a) ? 'warn' : ''}">${a.wunsch ? fmtDate(a.wunsch) : 'kein Wunsch'}</span></div>`).join('')}</div>`
      : `<div class="empty" style="padding:20px">Keine passenden Aufträge offen.</div>`}
    <div class="links" style="margin-top:12px">${hidden > 0 ? `<a href="#" data-act="pickAll">Alle ${hidden + list.length} offenen anzeigen</a>` : ''}<a href="#" data-act="pickNew">＋ Neuer Auftrag hier</a></div>`;
  Dlg.open('Auftrag einsetzen', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button>`, () => true);
  Dlg.pick = { d, mid, minute };
}

/* ================= Spritzen: Erfassung wie ErfassungPS, Stammdaten, Abrechnung, ÖLN-Nachweis ================= */
const round05 = x => Math.round((x || 0) / 0.05) * 0.05;
const chf = x => (Math.round((x || 0) * 100) / 100).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const prodById = id => id ? Store.get('produkte', id) : null;
const prodByName = n => (n && Store.all('produkte').find(p => p.name === n)) || null;
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
// Vorgaben für neue Spritzaufträge: Düse IDK 03, Traktor JD 5125r, Wasser 200 l/ha
const SPRAY_DEF = { duese: 'idk03', traktor: 'jd5125r', wasser: 200 };
function sprayDefaults(a) {
  const key = x => norm(x).replace(/[^a-z0-9]/g, '');
  const pick = (list, k) => list.find(x => key(x) === k) || list.find(x => key(x).startsWith(k)) || '';
  if (a.wasser == null) a.wasser = SPRAY_DEF.wasser;
  if (!a.duese) a.duese = pick(Lists.duesen(), SPRAY_DEF.duese);
  if (!a.traktor) a.traktor = pick(Lists.traktoren(), SPRAY_DEF.traktor);
  return a;
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
    ${typeof ebSprayHtml === 'function' ? ebSprayHtml(a) : ''}
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
    erntejahr: ej || ernteDefault(f.datum.value || f.wunsch.value || todayIso(), f.kultur.value), produkte,
    ...(typeof ebReadSpray === 'function' ? ebReadSpray(f) : {})
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
  if (typeof ebWireSpray === 'function') ebWireSpray(f);
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
const SP_TABS = [['plan', 'Planung'], ['programme', 'Spritzprogramme'], ['journal', 'Journal'], ['abrechnung', 'Abrechnung'], ['nachweis', 'ÖLN-Nachweis'], ['vorbestellung', 'Vorbestellung'], ['stamm', 'Stammdaten']];
function spTabs() { return `<div class="seg sptabs">${SP_TABS.map(([k, l]) => `<button type="button" data-act="spTab" data-v="${k}" class="${App.spray.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`; }
const yearsOf = () => [...new Set(sprayOrders().map(ernteOf).filter(Boolean))].sort((a, b) => b - a);

// Journal: alle Spritzaufträge durchsuchen

// Abrechnung pro Kunde und Zeitraum (Formeln wie ErfassungPS)

// ÖLN-Nachweis / Spritzprotokoll
// Briefkopf (Logo mit Adresse) oben auf der ersten Seite jedes Berichts
const LETTERHEAD = '<img class="lhead" src="logo.jpg" alt="Indermühle Lohnarbeiten · Maschinenvermietung">';
function printHtml(title, html, { noTitle } = {}) {
  let pa = $('#printArea'); if (!pa) { pa = document.createElement('div'); pa.id = 'printArea'; document.body.appendChild(pa); }
  pa.innerHTML = `${noTitle ? '' : `<h1 class="ptitle">${esc(title)}</h1>`}${html}<p class="pfoot">Erstellt ${new Date().toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })} · IM-Verwalter v${APP_VERSION}</p>`;
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
// Erfassungszeitpunkt: Feld «erfasst» (ab v52), sonst aus der Auftrags-ID (enthält die Erstellungszeit), sonst unbekannt
function erfassTs(a) {
  if (a.erfasst) return a.erfasst;
  const m = /^([0-9a-z]{8})[0-9a-z]{4,}$/.exec(a.id || '');
  if (!m) { const n = /-[a-z]*(\d+)$/.exec(a.id || ''); return n ? +n[1] : 0; } // importierte Aufträge (z. B. ps-a12): laufende Nummer
  const t = parseInt(m[1], 36); return t > 1.5e12 && t < Date.now() + 864e5 ? t : 0;
}
const AL_SORT = [['wunsch', 'Wunschdatum ↑'], ['wunschDesc', 'Wunschdatum ↓'], ['desc', 'Datum: neueste zuerst'], ['asc', 'Datum: älteste zuerst']];
function alList() {
  const L = App.al, nrC = (x, y) => (x.nr || '').localeCompare(y.nr || '');
  const byDate = (x, y) => (aDate(x) || '9999').localeCompare(aDate(y) || '9999') || (x.zeit || '').localeCompare(y.zeit || '') || nrC(x, y);
  // Wunschdatum, bei gleichem (oder fehlendem) Wunschdatum nach Erfassung; ohne Wunschdatum immer am Schluss
  const byWish = dir => (x, y) => {
    const wx = x.wunsch || '', wy = y.wunsch || '';
    if (!wx !== !wy) return wx ? -1 : 1;
    return dir * (wx.localeCompare(wy) || (erfassTs(x) - erfassTs(y)) || nrC(x, y));
  };
  const cmp = L.sort === 'asc' ? byDate : L.sort === 'desc' ? (x, y) => -byDate(x, y) : byWish(L.sort === 'wunschDesc' ? -1 : 1);
  return Store.all('auftraege').filter(alFilter(L)).sort(cmp);
}
function alTable(list, { print } = {}) {
  const g = App.al.grp;
  const ck = !print, sel = App.alSel || new Set();
  const allOn = ck && list.length && list.every(a => sel.has(a.id));
  const head = `<thead><tr>${ck ? `<th class="ck" data-stop><input type="checkbox" data-in="alSelAll" title="Alle angezeigten auswählen" ${allOn ? 'checked' : ''}></th>` : ''}<th>Datum</th><th>Wunsch</th><th>Nr.</th><th>Kunde</th><th>Feld / Parzelle</th><th>Arbeit</th><th>Kultur</th><th class="n">ha</th><th>Maschine</th><th class="n">Std.</th><th>Status</th><th>Bemerkung</th></tr></thead>`;
  const row = a => `<tr class="${print ? '' : 'click'}${ck && sel.has(a.id) ? ' alsel' : ''}" ${print ? '' : `data-act="editOrder" data-id="${a.id}"`}>${ck ? `<td class="ck" data-stop><input type="checkbox" data-in="alSel" value="${a.id}" ${sel.has(a.id) ? 'checked' : ''}></td>` : ''}<td>${aDate(a) ? fmtDate(aDate(a), { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''}${!a.datum && a.wunsch ? ' <span class="nr">W</span>' : ''}</td>
    <td>${a.wunsch ? fmtDate(a.wunsch, { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''}</td><td class="nr">${esc(a.nr || '')}</td><td>${esc(kundeName(a.kunde))}</td><td>${esc(aFeld(a))}</td><td>${esc(a.arbeit || '')}${prodList(a).length ? `<br><span class="nr">${esc(prodNames(a).join(', '))}</span>` : ''}</td><td>${esc(a.kultur || '')}</td>
    <td class="n">${alFl(a) != null ? fmtNum(alFl(a)) : ''}</td><td>${esc(maschine(a.maschine)?.name || '')}</td><td class="n">${alStd(a) != null ? fmtNum(r2(alStd(a))) : ''}</td>
    <td>${print ? STATUS[statusOf(a)] : `<span class="badge ${statusOf(a)}">${STATUS[statusOf(a)]}</span>`}</td><td>${esc(a.notiz || '')}</td></tr>`;
  if (!g) return `<table class="btab altab">${head}<tbody>${list.map(row).join('')}</tbody></table>`;
  const groups = groupBy(list.slice().sort((x, y) => String(alKey(x, g)).localeCompare(String(alKey(y, g)), 'de') * (g === 'monat' && /desc/i.test(App.al.sort) ? -1 : 1)), a => alKey(a, g));
  return `<table class="btab altab">${head}${groups.map(([k, l]) => `<tbody class="pblk"><tr class="gk"><td colspan="${ck ? 8 : 7}">${esc(alLabel(k, g))}</td><td class="n">${fmtNum(alHa(l))}</td><td colspan="4">${l.length} ${l.length === 1 ? 'Auftrag' : 'Aufträge'}</td></tr>${l.map(row).join('')}</tbody>`).join('')}</table>`;
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
      <label class="fld"><span>Sortierung</span><select class="input" data-plain data-in="al" data-k="sort" title="Wunschdatum: bei gleichem Wunschdatum nach Erfassung; ohne Wunschdatum am Schluss">${AL_SORT.map(([v, t]) => `<option value="${v}" ${L.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <div class="btns"><span class="seg mini">${[['woche', 'Diese Woche'], ['30', '30 Tage'], ['jahr', 'Dieses Jahr'], ['vorjahr', 'Vorjahr'], ['alle', 'Alles']].map(([v, l]) => `<button type="button" data-act="alPreset" data-v="${v}">${l}</button>`).join('')}</span>
      <button class="btn" data-act="alReset">Filter zurücksetzen</button></div>
    <p class="nr" style="margin:6px 0 0">Datum = erledigt am, sonst eingeplant, sonst Wunschdatum (W). Sortierung «Wunschdatum»: bei gleichem Wunschdatum nach Erfassung, ohne Wunschdatum am Schluss. Status über die Schaltflächen oben, Suche im Suchfeld oben.</p></div>
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
  const cell = (d, col) => schedule(d, col.id).all.map(it => {
    const a = it.a;
    return { zeit: it.cont ? `${fromMin(it.start)}–${endLbl(it)} ↪` : rangeLbl(it), kunde: kfText(a) + (it.cont ? ' (' + contLbl(it).replace('↪ ', '') + ')' : ''),
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
    y += 50; if (draw) { ctx.font = F('400', 18); ctx.fillStyle = muted; ctx.fillText('IM-Verwalter', P, y); }
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
  const masch = [['Bezeichnung', 'Kurzname', 'Art.-Nr', 'Priorität', 'Verrechnung pro', 'Ansatz CHF', 'Flächenleistung ha/h', 'Arbeitsarten', 'Aktiv', 'ID'], ...Store.all('maschinen').sort(byPrio).map(m => [m.name, m.kurz, m.artNr, m.prio, m.einheit, m.ansatz, m.leistung, (m.arbeitsarten || []).join(', '), yn(m.aktiv), m.id])];
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
// Parzellen-Zuweisung (Pflanzenschutz-Parzellen aus dem Modul Spritzen) in der Kundenkarte ein-/ausschalten – gilt für alle Geräte
const parzOn = () => Store.cfg().parzZuweisung !== false;

// Feld-Auswahl im Auftrag
function wireFeld(f, a) {
  const sel = f.kfeld; if (!sel) return;
  const box = sel.closest('.fld');
  // Liste der Vermessungen des gewählten Feldes: Antippen übernimmt deren Fläche als Auftragsfläche
  const gbox = document.createElement('div'); gbox.className = 'grzpick'; gbox.hidden = true; box.after(gbox);
  const setHa = v => { if (!f.flaeche || v == null) return; f.flaeche.value = v; f.flaeche.dispatchEvent(new Event('input', { bubbles: true })); f.flaeche.dispatchEvent(new Event('change', { bubbles: true })); gbox.querySelectorAll('.grzb').forEach(b => b.classList.toggle('on', +b.dataset.ha === +v)); };
  const grz = () => {
    const fd = feldById(sel.value), nArch = fd ? grzArchN(fd.grenzen) : 0, L = fd && Array.isArray(fd.grenzen) ? grzSicht(fd.grenzen, gbox.dataset.arch === '1').sort((x, y) => (y.aktiv - x.aktiv) || String(y.erstellt || y.geaendert || '').localeCompare(String(x.erstellt || x.geaendert || ''))) : [];
    gbox.hidden = box.hidden || (!L.length && !nArch); if (gbox.hidden) { gbox.innerHTML = ''; return; }
    const cur = num(f.flaeche && f.flaeche.value), dd = s => s ? fmtDate(String(s).slice(0, 10), { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
    const btn = (x, v, lbl) => `<button type="button" class="grzb${cur != null && +v === +cur ? ' on' : ''}" data-ha="${v}" title="Fläche ${fmtNum(v)} ha als Auftragsfläche übernehmen">${lbl}</button>`;
    const open = gbox.querySelector('details')?.open ?? ls('lp_grzOpen') === '1';
    gbox.innerHTML = `<details ${open ? 'open' : ''}><summary>📐 Vermessungen des Feldes (${L.length}) – antippen übernimmt die Fläche</summary><div class="grzlist">${L.map(x => {
      const v = x.ha ?? x.bha; if (v == null) return '';
      return `<div class="grzi${x.archiviert ? ' arch' : ''}">${btn(x, v, `<b>${fmtNum(v)} ha</b> <span>${esc(x.name || '(ohne Namen)')}</span>${x.aktiv ? ' <span class="badge geplant">aktiv</span>' : ''}`)}
        ${x.bha != null && x.ha != null && Math.abs(x.bha - x.ha) >= 0.005 ? btn(x, x.bha, `bearbeitbar ${fmtNum(x.bha)} ha`) : ''}
        <span class="nr">${[grzSignal(x.signal), x.erstellt ? 'erstellt ' + dd(x.erstellt) : x.geaendert ? dd(x.geaendert) : '', x.archiviert ? 'archiviert' : ''].filter(Boolean).join(' · ')}</span></div>`; }).join('')}
      ${nArch ? `<a href="#" class="grzarch nr">${gbox.dataset.arch === '1' ? 'Archivierte ausblenden' : `Auch archivierte anzeigen (${nArch})`}</a>` : ''}</div></details>`;
    gbox.querySelector('details').addEventListener('toggle', e => ls('lp_grzOpen', e.target.open ? '1' : '0'));
  };
  gbox.addEventListener('click', e => { const b = e.target.closest('.grzb'); if (b) { e.preventDefault(); setHa(+b.dataset.ha); return; }
    if (e.target.closest('.grzarch')) { e.preventDefault(); gbox.dataset.arch = gbox.dataset.arch === '1' ? '' : '1'; grz(); } });
  const refresh = () => {
    const k = findKunde(f.kunde.value), cur = sel.value || a.kfeld || '';
    sel.innerHTML = feldOptions(k ? k.id : '', cur);
    box.hidden = !(k && Store.all('felder').some(x => x.kunde === k.id && (x.aktiv !== false || x.id === cur)));
    grz();
  };
  f.kunde.addEventListener('input', refresh);
  sel.addEventListener('change', () => {
    const fd = feldById(sel.value);
    if (fd && fd.flaeche && !f.flaeche.value) { f.flaeche.value = fd.flaeche; f.flaeche.dispatchEvent(new Event('input', { bubbles: true })); }
    gbox.dataset.arch = ''; grz();
  });
  if (f.flaeche) f.flaeche.addEventListener('input', () => { const v = num(f.flaeche.value); gbox.querySelectorAll('.grzb').forEach(b => b.classList.toggle('on', v != null && +b.dataset.ha === v)); });
  if (f.parzelle) f.parzelle.addEventListener('change', () => { const p = Store.get('parzellen', f.parzelle.value); if (p && p.feldId && feldById(p.feldId)) { refresh(); sel.value = p.feldId; } });
  refresh();
}

// Kundenkarte: Felder anzeigen, Pflanzenschutz-Parzellen zuweisen
function felderSection(kid) {
  const fs = felderOf(kid, true).sort((a, b) => (a.aktiv === false) - (b.aktiv === false));
  if (!fs.length) return `<div class="box"><h4>🌾 Felder</h4><p class="nr" style="margin:0">${jdLock() ? 'Für diesen Kunden sind in MyJohnDeere keine Felder erfasst.' : 'Felder werden aus MyJohnDeere übernommen (Kunden › MyJohnDeere-Abgleich).'}</p></div>`;
  const tot = fs.filter(f => f.aktiv !== false).reduce((s, f) => s + (f.flaeche || 0), 0);
  return `<div class="box"><h4>🌾 Felder aus MyJohnDeere <small class="nr">${fs.filter(f => f.aktiv !== false).length} · ${fmtNum(r2(tot))} ha</small></h4>
    <p class="nr" style="margin:0 0 6px">Feld antippen zeigt alle Vermessungen.</p>
    <div class="feldlist">${fs.map(f => { const ps = parzOn() ? parzOfFeld(f.id) : [], ng = Array.isArray(f.grenzen) ? grzSicht(f.grenzen).length : null; return `<div class="feldrow ${f.aktiv === false ? 'off' : ''}">
      <div class="grow"><div class="feldhead" data-act="feldGrz" data-id="${f.id}" role="button" title="Vermessungen anzeigen"><b class="fldlink">${esc(f.name)}</b> <span class="nr">${f.flaeche ? fmtNum(f.flaeche) + ' ha' : ''}${f.betrieb ? ' · ' + esc(f.betrieb) : ''}${f.aktiv === false ? ' · archiviert' : ''}${ng ? ` · 📐 ${ng} Vermessung${ng > 1 ? 'en' : ''}` : ''}</span></div>
        ${parzOn() ? `<div class="s">${ps.length ? '🧪 ' + ps.map(p => esc(p.name)).join(', ') : '<span class="nr">keine Pflanzenschutz-Parzelle zugewiesen</span>'}</div>` : ''}</div>
      ${f.jdId ? `<button type="button" class="btn small" data-act="jdOc" data-k="feld" data-id="${f.id}" title="Feld im John Deere Operations Center öffnen (Name wird kopiert)">↗ JD</button>` : ''}
      ${parzOn() ? `<button type="button" class="btn small" data-act="feldAssign" data-id="${f.id}">Parzellen zuweisen</button>` : ''}
      <div class="grzbox" id="grz-${f.id}" hidden></div></div>`; }).join('')}</div></div>`;
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
      const nf = { ...(of || {}), id, kunde: k.id, jdId: f.id, jdName: f.name, name: f.name, betrieb: farms[f.farm] || '', flaeche: f.flaeche != null ? r2(+f.flaeche) : (of ? of.flaeche ?? null : null), aktiv: !f.archived,
        grenzen: Array.isArray(f.grenzen) ? f.grenzen : (of ? of.grenzen : undefined) };
      if (!nf.grenzen) delete nf.grenzen;
      if (!of) fNeu++; else if (!same(of, nf, ['kunde', 'jdId', 'name', 'betrieb', 'flaeche', 'aktiv']) || JSON.stringify(of.grenzen || null) !== JSON.stringify(nf.grenzen || null)) fUpd++; else return;
      fOut.push(nf);
    });
    Store.all('felder').filter(x => x.kunde === k.id && (x.jdId || x.jdName) && !seen.has(x.id) && x.aktiv !== false).forEach(x => { fArch++; fOut.push({ ...x, aktiv: false }); });
  });
  if (d.full !== false && d.clients.length) Store.all('kunden').filter(k => k.jdId && !ids.has(k.jdId) && k.aktiv !== false && !kOut.some(x => x.id === k.id)).forEach(k => { kInakt++; kOut.push({ ...k, aktiv: false }); });
  if (kOut.length) Store.putMany('kunden', kOut);
  if (fOut.length) Store.putMany('felder', fOut);
  Store.setCfg({ jdStand: d.stand || new Date().toISOString(), jdOrg: d.org?.name || '', jdOrgId: d.org?.id ? String(d.org.id) : (Store.cfg().jdOrgId || ''), jdDienst: d.dienst || '' }, { silent: false });
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

/* ---------- Vermessungen (Feldgrenzen) eines Feldes, vom NAS-Dienst ab Version 46 ---------- */
function feldFuer({ fid, feldId, kunde, kundeId, feld }) {
  const F = Store.all('felder');
  return (feldId && F.find(f => f.id === feldId)) || (fid && F.find(f => f.jdId === fid))
    || (feld && F.find(f => norm(f.jdName || f.name) === norm(feld) && (kundeId ? f.kunde === kundeId : norm(kundeName(f.kunde)) === norm(kunde) || norm((Store.get('kunden', f.kunde) || {}).jdName) === norm(kunde)))) || null;
}
// Quelle und Signaltyp der Feldgrenze lesbar machen (Werte von John Deere, unbekannte bleiben wie geliefert)
function grzQuelle(q) {
  const k = String(q || '').toLowerCase().replace(/[^a-z]/g, ''); if (!k) return '';
  const M = { handdrawn: 'von Hand gezeichnet', drawn: 'von Hand gezeichnet', manual: 'von Hand gezeichnet', machine: 'Maschine (abgefahren)', equipment: 'Maschine (abgefahren)', recorded: 'Maschine (abgefahren)', driven: 'Maschine (abgefahren)', logged: 'Maschine (abgefahren)',
    external: 'importiert', imported: 'importiert', import: 'importiert', shapefile: 'importiert (Shape)', file: 'importiert', partner: 'Partner', api: 'Schnittstelle (API)', generated: 'automatisch erzeugt', coverage: 'aus Bedeckung' };
  return M[k] || String(q);
}
function grzSignal(s) {
  const v = String(s || '').replace(/^dtiSignalType/i, '').trim(); if (!v) return '';
  const u = v.toUpperCase();
  if (/^RTK/.test(u)) return u === 'RTK' ? 'RTK' : v;
  if (/^SF\s?([0-9])/.test(u)) return 'SF' + u.match(/^SF\s?([0-9])/)[1];
  if (/NONE|UNKNOWN/.test(u)) return 'unbekannt';
  return v;
}
const grzRtk = s => /^RTK/i.test(grzSignal(s));
// Archivierte Vermessungen nur auf Wunsch (Link «auch archivierte anzeigen», gilt nur für die jeweilige Anzeige)
const grzSicht = (g, arch) => (g || []).filter(x => arch || !x.archiviert);
const grzArchN = g => (g || []).filter(x => x.archiviert).length;
function grenzenHtml(f, arch) {
  if (!f) return '<p class="nr">Kein passendes Feld in den Stammdaten gefunden.</p>';
  return `<div class="grzhost" data-fid="${esc(f.id)}" data-arch="${arch ? 1 : 0}">${grenzenInner(f, arch)}</div>`;
}
function grzArchLink(f, arch) {
  const n = grzArchN(f.grenzen); if (!n) return '';
  return `<p class="nr" style="margin:6px 0 0"><a href="#" data-act="grzArch" data-id="${esc(f.id)}">${arch ? 'Archivierte ausblenden' : `Auch archivierte anzeigen (${n})`}</a></p>`;
}
function grenzenInner(f, arch) {
  const g0 = f.grenzen;
  if (!g0) return `<p class="nr">Für «${esc(f.name)}» sind noch keine Vermessungen gespeichert – sie kommen mit dem NAS-Dienst ab Version 46 beim nächsten Abgleich.</p>`;
  const g = grzSicht(g0, arch);
  if (!g.length) return `<p class="nr">Für «${esc(f.name)}» ist in MyJohnDeere ${g0.length ? 'nur archivierte Vermessungen gespeichert' : 'keine Vermessung gespeichert'}.</p>${grzArchLink(f, arch)}`;
  const dd = s => s ? esc(fmtDate(String(s).slice(0, 10), { day: '2-digit', month: '2-digit', year: 'numeric' })) : '';
  const L = g.slice().sort((a, b) => (b.aktiv - a.aktiv) || String(b.erstellt || b.geaendert || '').localeCompare(String(a.erstellt || a.geaendert || '')));
  const mitE = L.some(x => x.erstellt), mitQ = L.some(x => x.quelle), mitS = L.some(x => x.signal), mitG = L.some(x => x.geaendert && String(x.geaendert) !== String(x.erstellt || ''));
  return `<div class="grzwrap"><table class="btab kv grz"><thead><tr><th>Vermessung</th><th class="n">Fläche</th><th class="n">bearbeitbar</th>${mitQ ? '<th>Quelle</th>' : ''}${mitS ? '<th>Signal</th>' : ''}${mitE ? '<th>Erstellt</th>' : ''}${mitG || !mitE ? '<th>Geändert</th>' : ''}</tr></thead><tbody>
    ${L.map(x => `<tr class="${x.aktiv ? 'grz-akt' : ''}${x.archiviert ? ' grz-arch' : ''}"><td>${esc(x.name || '(ohne Namen)')}${x.aktiv ? ' <span class="badge geplant">aktiv</span>' : ''}${x.archiviert ? ' <span class="nr">archiviert</span>' : ''}</td>
      <td class="n">${x.ha != null ? fmtNum(x.ha) + ' ha' : ''}</td><td class="n">${x.bha != null ? fmtNum(x.bha) + ' ha' : ''}</td>
      ${mitQ ? `<td title="${esc(x.quelle || '')}">${esc(grzQuelle(x.quelle))}</td>` : ''}${mitS ? `<td title="${esc(x.signal || '')}">${x.signal ? `<span class="sig ${grzRtk(x.signal) ? 'sig-rtk' : ''}">${esc(grzSignal(x.signal))}</span>` : ''}</td>` : ''}
      ${mitE ? `<td>${dd(x.erstellt)}</td>` : ''}${mitG || !mitE ? `<td>${x.geaendert && String(x.geaendert) !== String(x.erstellt || '') ? dd(x.geaendert) : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>${grzArchLink(f, arch)}
    ${!mitE || !mitS ? `<p class="nr" style="margin-top:6px">${!mitS ? 'Signaltyp' : ''}${!mitS && !mitE ? ' und ' : ''}${!mitE ? 'Erstellungsdatum' : ''}: ${L.some(x => 'signal' in x) || mitE ? 'liefert MyJohnDeere für dieses Feld nicht.' : 'kommt mit dem NAS-Dienst ab Version 48.'}</p>` : ''}`;
}
// Eigenes Fenster «Vermessungen» (Klick auf das Feld in den Listen von Bericht und Abrechnung)
function grenzenDialog(fe, lbl, kunde) {
  const n = fe && fe.grenzen ? grzSicht(fe.grenzen).length : 0, na = fe ? grzArchN(fe.grenzen) : 0;
  const kopf = `<table class="btab kv">${kunde ? `<tr><td class="nr">Kunde</td><td>${esc(kunde)}</td></tr>` : ''}<tr><td class="nr">Feld</td><td>${esc(fe ? fe.name : lbl)}</td></tr>
    ${fe && fe.flaeche != null ? `<tr><td class="nr">Fläche (Stammdaten)</td><td>${fmtNum(fe.flaeche)} ha</td></tr>` : ''}${n || na ? `<tr><td class="nr">Vermessungen</td><td>${n}${na ? ` <span class="nr">(+ ${na} archiviert)</span>` : ''}</td></tr>` : ''}</table>`;
  Dlg.open(`Vermessungen – ${fe ? fe.name : lbl || 'Feld'}`, `${kopf}<div style="margin-top:12px">${grenzenHtml(fe)}</div>`, `${fe && fe.jdId ? `<button type="button" class="btn" data-act="jdOc" data-k="feld" data-id="${fe.id}" title="Feld im John Deere Operations Center öffnen (Name wird kopiert)">↗ MyJohnDeere</button>` : ''}<span class="spacer"></span><button type="button" class="btn" data-act="close">Schliessen</button>`, () => true);
}

// Kundenkarte: Feld antippen klappt die Vermessungen auf/zu
function feldGrzToggle(fid) {
  const box = document.getElementById('grz-' + fid); if (!box) return;
  if (box.hidden) box.innerHTML = grenzenHtml(feldById(fid));
  box.hidden = !box.hidden; box.closest('.feldrow')?.classList.toggle('grzopen', !box.hidden);
}

function grzArchToggle(el) {
  const host = el.closest('.grzhost'); if (!host) return;
  const f = feldById(host.dataset.fid); if (!f) return;
  host.outerHTML = grenzenHtml(f, host.dataset.arch !== '1');
}

/* ---------- Knopf «In MyJohnDeere öffnen» (nur öffnen, im Planer wird in John Deere nichts geändert) ---------- */
// John Deere veröffentlicht keine festen Direktlinks ins Operations Center. Standard: Startseite öffnen und den Namen in die
// Zwischenablage kopieren (dort in die Suche einfügen). Unter Mehr › Einstellungen lässt sich eine eigene Adresse mit Platzhaltern hinterlegen.
const JD_OC = 'https://operationscenter.deere.com/';
function jdOcUrl(kind, id) {
  const c = Store.cfg(), e = encodeURIComponent;
  const f = kind === 'feld' ? feldById(id) : null, k = kind === 'feld' ? (f && Store.get('kunden', f.kunde)) : Store.get('kunden', id);
  const tpl = ((kind === 'feld' ? c.jdOcFeld : c.jdOcKunde) || '').trim() || JD_OC;
  return { url: tpl.replace(/\{org\}/g, e(c.jdOrgId || '')).replace(/\{kunde\}/g, e(k?.jdId || '')).replace(/\{feld\}/g, e(f?.jdId || '')).replace(/\{name\}/g, e((f || k)?.jdName || (f || k)?.name || '')),
    name: (f || k)?.jdName || (f || k)?.name || '' };
}
function jdOcOpen(kind, id) {
  const { url, name } = jdOcUrl(kind, id);
  window.open(url, '_blank', 'noopener');
  if (name) { try { navigator.clipboard.writeText(name).then(() => toast(`«${name}» kopiert – im Operations Center in die Suche einfügen`), () => {}); } catch { } }
}
function jdOcPanel() {
  const c = Store.cfg();
  return `<div class="panel"><h2>MyJohnDeere Operations Center</h2>
    <p class="nr" style="margin-top:0">Knopf «↗ MyJohnDeere» bei Kunden und Feldern: öffnet das Operations Center und kopiert den Namen in die Zwischenablage (dort in die Suche einfügen). Im Planer wird in John Deere nichts geändert.
      Wer einen Direktlink möchte: im Operations Center einen Kunden bzw. ein Feld öffnen, die Adresse kopieren und die Nummern darin durch Platzhalter ersetzen –
      <code>{org}</code> Organisation${c.jdOrgId ? ` (${esc(c.jdOrgId)})` : ''}, <code>{kunde}</code> Kunden-ID, <code>{feld}</code> Feld-ID, <code>{name}</code> Name. Leer = Startseite.</p>
    <label class="fld"><span>Adresse für Kunden</span><input class="input" data-in="jdOcKunde" value="${esc(c.jdOcKunde || '')}" placeholder="${JD_OC}"></label>
    <label class="fld"><span>Adresse für Felder</span><input class="input" data-in="jdOcFeld" value="${esc(c.jdOcFeld || '')}" placeholder="${JD_OC}"></label>
  </div>`;
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
  return { id: o.id, fid: o.field || '', d: String(start).slice(0, 10), start, end, dauer, type, arbeit: JDB_ART[type] || type || '–',
    kunde: o.clientName || '', feld: o.fieldName || '', ha: haV != null ? Math.round(haV * 100) / 100 : null, quelle, maschine: mach.join(', ') || JDB_MACH[o.machineType || raw.adaptMachineType] || o.machineType || raw.adaptMachineType || '',
    fahrer: fahrer.join(', '), kultur: crop, produkte: prodTxt, sorten: sorten.join(', '), menge: rate, gesamt: jdbGesamt(ms), saison: o.cropSeason || raw.cropSeason || '', details };
}
const JDB_KEY = 'lp_jdb';
function jdbCache(rows, meta) { try { localStorage.setItem(JDB_KEY, JSON.stringify({ meta, rows })); } catch { } }
function jdbFromCache() { try { const c = JSON.parse(localStorage.getItem(JDB_KEY) || 'null'); if (c && Array.isArray(c.rows)) { App.jdb.rows = c.rows; App.jdb.meta = c.meta; return true; } } catch { } return false; }
/* ---------- Pflanzenschutzmittel (Produkte aus den Stammdaten des Moduls Spritzen): nur Name, keine Gesamtmenge ---------- */
const jdbPk = s => norm(s).replace(/[^a-z0-9äöü]/g, '');
let _psmV = -1, _psmSet = null;
function isPsm(name) {
  if (_psmV !== Store.v || !_psmSet) { _psmSet = new Set(Store.all('produkte').filter(p => p.name).map(p => jdbPk(p.name)).filter(Boolean)); _psmV = Store.v; }
  const k = jdbPk(name); if (!k) return false; if (k === 'psm' || _psmSet.has(k)) return true;
  if (k.length < 4) return false;
  for (const x of _psmSet) if (x.length >= 4 && (k.startsWith(x) || x.startsWith(k))) return true;
  return false;
}
// «Name Menge» zerlegen; bei Produkten muss die Menge eine Einheit pro Fläche haben (z.B. l/ha)
const jdbSplit = (t, perHa) => String(t || '').split(', ').filter(Boolean).map(x => { const m = /^(.*?)\s+(-?[\d'.,]+\s*\S*)$/.exec(x); return m && (!perHa || m[2].includes('/')) ? { n: m[1], v: m[2] } : { n: x, v: '' }; });
const jdbProdTxt = r => jdbSplit(r.produkte, true).map(p => isPsm(p.n) || !p.v ? p.n : `${p.n} ${p.v}`).join(', ');
const jdbGesTxt = r => jdbSplit(r.gesamt).filter(g => !isPsm(g.n)).map(g => g.v ? `${g.n} ${g.v}` : g.n).join(', ');
function jdbApply(d, src) {
  if (!d || d.format !== 'jd-arbeiten' || !Array.isArray(d.operations)) { toast('Keine gültige Datei mit Arbeitsdaten (jd-arbeiten.json)'); return false; }
  const rows = d.operations.map(jdbRow).filter(r => r.d);
  App.jdb.rows = rows; App.jdb.meta = { stand: d.stand, org: d.org?.name || '', seit: d.seit, src, n: rows.length, dienst: d.dienst || '', bedeckung: d.bedeckung || null };
  jdbCache(rows, App.jdb.meta); return true;
}
async function jdbLoad(silent) {
  const J = App.jdb;
  if (!Auth.configured() || !Auth.hasSession()) { if (!silent) toast('Zuerst mit Dropbox verbinden (Mehr › Dropbox)'); return; }
  J.loading = true; if (App.view === 'jdbericht' || App.view === 'abrechnung') App.render();
  try { const d = await Drive.readJson('/jd-arbeiten.json'); if (d) { if (jdbApply(d, 'Dropbox') && !silent) toast(`${App.jdb.rows.length} Arbeitsgänge geladen`); } else if (!silent) toast('Im Dropbox-Ordner liegt noch keine «jd-arbeiten.json»'); }
  catch (e) { if (!silent) toast('Laden fehlgeschlagen: ' + e.message, 5000); }
  J.loading = false; J.tried = true; if (App.view === 'jdbericht' || App.view === 'abrechnung') App.render();
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
  { id: 'feld', l: 'Feld', w: 130, v: r => r.feld, html: r => r.feld ? `<span class="fldlink" data-act="jbGrz" data-id="${esc(r.id)}" title="Vermessungen anzeigen">${esc(r.feld)}</span>` : '' },
  { id: 'ha', l: 'ha', w: 60, n: 1, v: r => r.ha != null ? fmtNum(r.ha) : '', csv: r => r.ha ?? '' },
  { id: 'quelle', l: 'Flächen-Quelle', w: 118, v: r => r.quelle || '', html: r => r.quelle ? `<span class="fq fq-${r.quelle === 'Bedeckungskarte' ? 'b' : 'm'}">${esc(r.quelle)}</span>` : '<span class="nr">–</span>' },
  { id: 'maschine', l: 'Maschine', w: 140, v: r => r.maschine },
  { id: 'fahrer', l: 'Fahrer', w: 120, v: r => r.fahrer },
  { id: 'kultur', l: 'Kultur', w: 110, v: r => r.kultur },
  { id: 'produkte', l: 'Produkte / Sorte', w: 220, v: r => [jdbProdTxt(r), r.sorten].filter(Boolean).join(' · ') },
  { id: 'menge', l: 'Menge/ha', w: 90, n: 1, v: r => r.menge },
  { id: 'gesamt', l: 'Gesamtmenge', w: 190, v: r => jdbGesTxt(r) },
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
  jdbList().forEach(r => rows.push([r.d, jdbDT(r.start), jdbDT(r.end), r.dauer != null ? r.dauer.toFixed(2) : '', r.arbeit, r.kunde, r.feld, r.ha ?? '', r.quelle || '', r.maschine, r.fahrer, r.kultur, jdbProdTxt(r), r.sorten, r.menge, jdbGesTxt(r), r.saison, jdbAbr(r.id)?.am || '', r.id]));
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
    ${kv('Maschine', r.maschine)}${kv('Fahrer', r.fahrer)}${kv('Kultur', r.kultur)}${kv('Saison', r.saison)}${kv('Produkte', jdbProdTxt(r))}${kv('Sorten', r.sorten)}${kv('Menge/ha', r.menge)}${kv('Gesamtmenge', jdbGesTxt(r))}</table>
    <div class="fld" style="margin-top:12px"><span>Vermessungen des Feldes${r.feld ? ` «${esc(r.feld)}»` : ''}</span></div>${grenzenHtml(feldFuer({ fid: r.fid, kunde: r.kunde, feld: r.feld }))}
    ${r.details.map(m => `<div class="fld" style="margin-top:12px"><span>${esc(m.n)}</span></div><table class="btab kv">${m.v.map(([k, v]) => kv(k, v)).join('')}</table>`).join('')}
    <p class="nr" style="margin-top:12px">Quelle: MyJohnDeere · ID ${esc(r.id)}</p>`;
  const ab = jdbAbr(r.id);
  Dlg.open('Arbeitsgang', body, `${ab ? `<span class="badge verrechnet">✓ abgerechnet ${fmtDate(ab.am, { day: '2-digit', month: '2-digit', year: 'numeric' })}</span><button type="button" class="btn" data-act="jbMarkOne" data-id="${esc(r.id)}" data-v="0">Wieder offen</button>` : `<button type="button" class="btn primary" data-act="jbMarkOne" data-id="${esc(r.id)}" data-v="1">✓ Als abgerechnet markieren</button>`}<span class="spacer"></span><button type="button" class="btn" data-act="close">Schliessen</button>`, () => true);
}
function jdBerichtView() {
  return {
    toolbar() {
      return `<h1>Bericht</h1>${verwNav('jdbericht')}
        <button class="btn" data-act="jbFs" title="Bericht im Vollbild (Esc schliesst)">⛶ Vollbild</button>
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
      const inner = `<p class="nr" style="margin-top:0">${m.n || all.length} Arbeitsgänge${m.org ? ' · ' + esc(m.org) : ''}${m.stand ? ` · Stand ${esc(new Date(m.stand).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }))}` : ''}${m.seit ? ` · ab ${fmtDate(m.seit, { day: '2-digit', month: '2-digit', year: 'numeric' })}` : ''}
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
      if (!J.fs) return inner;
      return `<div class="fsview jdbfs"><div class="fsbar"><b class="lbl jdbfs-t">Daten Operations Center John Deere</b>
          <span class="nr">${list.length} Arbeitsgänge · ${fmtNum(jdbHaSum(list))} ha</span>
          <button class="btn small" data-act="jbFsFilter">${J.fsNoFilter ? 'Filter zeigen' : 'Filter ausblenden'}</button>
          <button class="btn small" data-act="jbPrint">Drucken / PDF</button><button class="btn small" data-act="jbCsv">Excel (CSV)</button><button class="btn small" data-act="jbCols">Spalten…</button>
          <button class="btn small fsclose" data-act="jbFs" aria-label="Vollbild schliessen" title="Vollbild schliessen (Esc)">✕</button></div>
        <div class="jdbfs-body ${J.fsNoFilter ? 'nofilter' : ''}">${inner}</div></div>`;
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
document.addEventListener('keydown', e => { const J = App.jdb; if (e.key !== 'Escape' || !J || Dlg.el.open) return; if (J.open) { J.open = null; App.render(); } else if (J.fs && App.view === 'jdbericht') { J.fs = false; App.render(); } });

function jdbGrenzen(id) {
  const r = (App.jdb.rows || []).find(x => x.id === id); if (!r) return;
  grenzenDialog(feldFuer({ fid: r.fid, kunde: r.kunde, feld: r.feld }), r.feld, r.kunde);
}
/* ================= Abrechnung: erledigte Aufträge (Planer) und Arbeitsgänge (MyJohnDeere) kombiniert =================
   Vorlage: Modul «Bericht». Ein Auftrag und ein Arbeitsgang werden zu einer Zeile verbunden, wenn Kunde, Datum (±2 Tage),
   Art der Arbeit und – falls vorhanden – Feld zusammenpassen. Manuell: verknüpfen / Verknüpfung lösen (am Auftrag gespeichert). */
const AB_CAT = a => { const t = norm(a); if (!t) return ''; if (isSprayName(a) || /spritz|pflanzensch|dünge|duenge|application/.test(t)) return 'application';
  if (/säen|saat|sä|seeding|pflanzen/.test(t)) return 'seeding'; if (/dresch|ernte|harvest|häcksel|roden/.test(t)) return 'harvest';
  if (/pflüg|pflug|grubb|egge|boden|mulch|fräs|walz|tillage|striegel|hack/.test(t)) return 'tillage'; return ''; };
const abKeyK = s => norm(s).replace(/[^a-z0-9äöü]/g, '');
const abDn = s => s ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5 : NaN;
const abDays = (a, b) => Math.abs(abDn(a) - abDn(b));
// Kunde des Planers zum Kundennamen aus MyJohnDeere
function abKundeMap() {
  const m = new Map(); Store.all('kunden').forEach(k => { [k.jdName, k.name].filter(Boolean).forEach(n => { const x = abKeyK(n); if (x && !m.has(x)) m.set(x, k); }); }); return m;
}
const abOrders = () => Store.all('auftraege').filter(a => { const s = statusOf(a); return s === 'erledigt' || s === 'verrechnet'; });
// Kombinierte Zeilen
function abRows() {
  const A = App.abr, jd = App.jdb.rows || [], orders = abOrders(), km = abKundeMap();
  const ver = Store.v + '|' + jd.length + '|' + (App.jdb.meta?.stand || '');
  if (A._ver === ver && A._rows) return A._rows;
  const jById = new Map(jd.map(r => [r.id, r])), usedJ = new Set(), pair = new Map();
  // 1) manuelle Verknüpfungen
  orders.forEach(o => { if (o.jdLink && jById.has(o.jdLink) && !usedJ.has(o.jdLink)) { pair.set(o.id, o.jdLink); usedJ.add(o.jdLink); } });
  // 2) automatisch: bestes Paar zuerst
  const cand = [];
  // Index: Kunde → Tag → Arbeitsgänge
  const jMap = new Map(); let minDn = Infinity;
  jd.forEach(r => { const k = km.get(abKeyK(r.kunde)), kk = k ? k.id : '?' + abKeyK(r.kunde), dn = abDn(r.d); if (dn < minDn) minDn = dn;
    if (!jMap.has(kk)) jMap.set(kk, new Map()); const m = jMap.get(kk); if (!m.has(dn)) m.set(dn, []); m.get(dn).push(r); r._fk = abKeyK(r.feld); });
  orders.forEach(o => {
    if (pair.has(o.id)) return;
    const d = o.erledigtAm || o.datum; if (!d) return;
    const dn = abDn(d), km2 = jMap.get(o.kunde); if (!km2 || dn < minDn - 2) return;
    const cat = AB_CAT(o.arbeit), feld = abKeyK(aFeld(o));
    [dn - 2, dn - 1, dn, dn + 1, dn + 2].flatMap(x => km2.get(x) || []).forEach(r => {
      if (usedJ.has(r.id) || (o.jdUnlink || []).includes(r.id)) return;
      const dd = Math.abs(abDn(r.d) - dn);
      const rc = r.type || ''; if (cat && rc && cat !== rc && !(cat === 'application' && rc === 'fertilizing')) return;
      let s = 3 - dd; if (cat && rc && (cat === rc || (cat === 'application' && rc === 'fertilizing'))) s += 2;
      const rf = r._fk; if (feld && rf && (feld === rf || feld.includes(rf) || rf.includes(feld))) s += 2;
      if (o.flaeche && r.ha) { const q = Math.min(o.flaeche, r.ha) / Math.max(o.flaeche, r.ha); if (q > 0.8) s += 1; }
      if (s >= 3) cand.push({ o: o.id, j: r.id, s });
    });
  });
  cand.sort((x, y) => y.s - x.s).forEach(c => { if (pair.has(c.o) || usedJ.has(c.j)) return; pair.set(c.o, c.j); usedJ.add(c.j); });
  const rows = [];
  orders.forEach(o => rows.push(abRow(o, pair.has(o.id) ? jById.get(pair.get(o.id)) : null, km)));
  jd.forEach(r => { if (!usedJ.has(r.id)) rows.push(abRow(null, r, km)); });
  A._ver = ver; A._rows = rows;
  return rows;
}
function abRow(o, j, km) {
  const k = o ? Store.get('kunden', o.kunde) : km.get(abKeyK(j.kunde)) || null;
  const m = o ? maschine(o.maschine) : null, haP = o ? (o.flaecheEff ?? o.flaeche ?? null) : null, haJ = j ? j.ha : null;
  // Pflanzenschutzmittel (Stammdaten Spritzen): nur Name, keine Gesamtmenge
  const prodP = o ? prodList(o).map(p => `${p.name}${p.menge != null && !isPsm(p.name) ? ` ${fmtNum(p.menge)} ${p.einheit || prodUnit(p.name)}/ha` : ''}`).join(', ') : '';
  const gesP = o && haP ? prodList(o).filter(p => p.menge != null && !isPsm(p.name)).map(p => `${p.name} ${fmtNum(r2(p.menge * haP))} ${p.einheit || prodUnit(p.name)}`).join(', ') : '';
  const d = o ? (o.erledigtAm || o.datum) : j.d;
  const abJ = j ? jdbAbr(j.id) : null, abO = o && statusOf(o) === 'verrechnet';
  const abr = o ? abO : !!abJ, am = o ? (o.verrechnetAm || (abJ && abJ.am) || '') : (abJ ? abJ.am : '');
  return { id: o ? 'o:' + o.id : 'j:' + j.id, oid: o ? o.id : '', jid: j ? j.id : '', src: o && j ? 'beide' : o ? 'planer' : 'jd', d, start: j ? j.start : '', end: j ? j.end : '',
    dauer: j ? j.dauer : null, std: o ? (o.stundenEff ?? dauerOf(o) ?? null) : null, nr: o ? o.nr || '' : '',
    kunde: k ? k.name : (j ? j.kunde : ''), feld: (o && aFeld(o)) || (j ? j.feld : ''), arbeit: o ? o.arbeit || '' : j.arbeit, kultur: (o && o.kultur) || (j ? j.kultur : ''),
    haP, haJ, ha: haP ?? haJ, quelle: j ? j.quelle : '', maschine: (m && m.name) || (j ? j.maschine : ''), fahrer: j ? j.fahrer : '',
    produkte: prodP || (j ? [jdbProdTxt(j), j.sorten].filter(Boolean).join(' · ') : ''), gesamt: o ? gesP : (j ? jdbGesTxt(j) : ''), notiz: o ? o.notiz || '' : '', abr, am, link: !!(o && o.jdLink) };
}
/* ---------- Filter (Mehrfachauswahl wie im Bericht) ---------- */
const AB_MS = { k: ['kunde', 'Kunde', 'Alle Kunden'], a: ['arbeit', 'Arbeit', 'Alle Arbeiten'], f: ['feld', 'Feld', 'Alle Felder'], m: ['maschine', 'Maschine', 'Alle Maschinen'], c: ['kultur', 'Kultur', 'Alle Kulturen'] };
const AB_SRC = { beide: 'Planer + JD', planer: 'nur Planer', jd: 'nur JD' };
function abFilter(A, skip = '') {
  const q = norm(A.q), ok = (key, val) => skip === key || !jdbArr(A[key]).length || jdbArr(A[key]).includes(val);
  return r => (!A.von || r.d >= A.von) && (!A.bis || r.d <= A.bis)
    && ok('k', r.kunde) && ok('a', r.arbeit) && ok('f', r.feld) && ok('c', r.kultur)
    && (skip === 'm' || !jdbArr(A.m).length || r.maschine.split(', ').some(x => jdbArr(A.m).includes(x)))
    && (!+A.minHa || r.ha == null || r.ha >= +A.minHa)
    && (!A.src || r.src === A.src)
    && (!A.ab || (A.ab === 'ja') === !!r.abr)
    && (!q || [r.nr, r.kunde, r.feld, r.arbeit, r.maschine, r.kultur, r.produkte, r.fahrer, r.notiz].join(' ').toLowerCase().includes(q));
}
const abList = () => { const A = App.abr; return abRows().filter(abFilter(A)).sort((a, b) => { const c = (a.d || '').localeCompare(b.d || '') || (a.start || '').localeCompare(b.start || ''); return A.sort === 'asc' ? c : -c; }); };
const abHaSum = l => r2(l.reduce((s, r) => s + (r.ha || 0), 0));
const AB_GRP = [['', 'keine'], ['kunde', 'Kunde'], ['arbeit', 'Arbeit'], ['maschine', 'Maschine'], ['feld', 'Feld'], ['kultur', 'Kultur'], ['src', 'Herkunft'], ['monat', 'Monat']];
const abGroupKey = (r, g) => g === 'monat' ? (r.d || '').slice(0, 7) : g === 'src' ? AB_SRC[r.src] : (r[g] || '');
/* ---------- Abgerechnet ---------- */
function abMark(rows, on) {
  const now = todayIso(), oc = [], ec = [];
  rows.forEach(r => {
    if (r.oid) { const o = Store.get('auftraege', r.oid); if (o) { const s = statusOf(o); if (on && s !== 'verrechnet') oc.push({ ...o, status: 'verrechnet', verrechnetAm: now }); if (!on && s === 'verrechnet') oc.push({ ...o, status: 'erledigt', verrechnetAm: '' }); } }
    if (r.jid) { const x = jdbAbr(r.jid); if (on && !x) ec.push({ id: JDB_ABR + r.jid, jdabr: true, am: now }); else if (!on && x) ec.push({ id: JDB_ABR + r.jid, del: true }); }
  });
  if (ec.length) Store.putMany('einstellungen', ec);
  if (oc.length) Store.putMany('auftraege', oc);
  if (!ec.length && !oc.length) App.render();
  return oc.length + ec.length;
}
function abMarkSel(on) {
  const S = App.abrSel || new Set(), rows = abList().filter(r => S.has(r.id)); if (!rows.length) return;
  const n = abMark(rows, on); S.clear(); App.render();
  toast(n ? `${rows.length} ${rows.length === 1 ? 'Eintrag' : 'Einträge'} ${on ? 'als abgerechnet markiert' : 'wieder offen'}` : `Bereits ${on ? 'abgerechnet' : 'offen'}`);
}
function abSelBar(list) {
  const S = App.abrSel || (App.abrSel = new Set()), ids = new Set(list.map(r => r.id)); [...S].forEach(id => { if (!ids.has(id)) S.delete(id); });
  if (!S.size) return `<p class="nr" style="margin:0 0 8px">Einträge links ankreuzen, um mehrere gleichzeitig als abgerechnet zu markieren (Aufträge werden «verrechnet»). Spalten: Kopf ziehen = verschieben, Rand ziehen = Breite.</p>`;
  return `<div class="panel alselbar"><b>${S.size} ausgewählt</b>
    <button type="button" class="btn mini primary" data-ab="mark" data-v="1">✓ Als abgerechnet markieren</button>
    <button type="button" class="btn mini" data-ab="mark" data-v="0">Wieder offen</button>
    ${S.size < list.length ? `<button type="button" class="btn mini" data-ab="selAllList">Alle ${list.length} auswählen</button>` : ''}
    <button type="button" class="btn mini" data-ab="selNone">Auswahl aufheben</button></div>`;
}
/* ---------- Spalten ---------- */
const abD = d => d ? fmtDate(d, { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
const AB_COLS = [
  { id: 'datum', l: 'Datum', w: 80, v: r => abD(r.d), csv: r => r.d },
  { id: 'src', l: 'Herkunft', w: 104, v: r => AB_SRC[r.src], html: r => `<span class="absrc absrc-${r.src}" title="${r.src === 'beide' ? 'Auftrag und Arbeitsgang verbunden' + (r.link ? ' (von Hand)' : ' (automatisch)') : ''}">${r.src === 'beide' ? `Planer + JD${r.link ? ' 🔗' : ''}` : r.src === 'planer' ? 'Planer' : 'JD'}</span>` },
  { id: 'nr', l: 'Nr.', w: 76, v: r => r.nr },
  { id: 'beginn', l: 'Beginn (JD)', w: 118, v: r => jdbDT(r.start) },
  { id: 'ende', l: 'Ende (JD)', w: 118, v: r => jdbDT(r.end) },
  { id: 'arbeit', l: 'Arbeit', w: 130, v: r => r.arbeit },
  { id: 'kunde', l: 'Kunde', w: 150, v: r => r.kunde },
  { id: 'feld', l: 'Feld', w: 130, v: r => r.feld, html: r => r.feld ? `<span class="fldlink" data-ab="grz" data-id="${esc(r.id)}" title="Vermessungen anzeigen">${esc(r.feld)}</span>` : '' },
  { id: 'ha', l: 'ha', w: 60, n: 1, v: r => r.ha != null ? fmtNum(r.ha) : '', csv: r => r.ha ?? '' },
  { id: 'haP', l: 'ha Auftrag', w: 76, n: 1, v: r => r.haP != null ? fmtNum(r.haP) : '', csv: r => r.haP ?? '' },
  { id: 'haJ', l: 'ha JD', w: 66, n: 1, v: r => r.haJ != null ? fmtNum(r.haJ) : '', csv: r => r.haJ ?? '',
    html: r => r.haJ == null ? '' : `<span class="${r.haP != null && Math.abs(r.haJ - r.haP) > Math.max(0.1, r.haP * 0.1) ? 'abdiff' : ''}" title="${r.haP != null ? `Abweichung zum Auftrag: ${fmtNum(r2(r.haJ - r.haP))} ha` : ''}${r.quelle ? ` · Quelle: ${r.quelle}` : ''}">${fmtNum(r.haJ)}</span>` },
  { id: 'std', l: 'Std. Auftrag', w: 82, n: 1, v: r => r.std != null ? fmtNum(r2(r.std)) : '', csv: r => r.std != null ? r2(r.std) : '' },
  { id: 'dauer', l: 'Dauer JD', w: 76, n: 1, v: r => r.dauer != null ? hrs(r2(r.dauer)) : '', csv: r => r.dauer != null ? r2(r.dauer) : '' },
  { id: 'maschine', l: 'Maschine', w: 140, v: r => r.maschine },
  { id: 'fahrer', l: 'Fahrer', w: 120, v: r => r.fahrer },
  { id: 'kultur', l: 'Kultur', w: 110, v: r => r.kultur },
  { id: 'produkte', l: 'Produkte / Sorte', w: 220, v: r => r.produkte },
  { id: 'gesamt', l: 'Gesamtmenge', w: 190, v: r => r.gesamt || '' },
  { id: 'notiz', l: 'Bemerkung', w: 160, v: r => r.notiz },
  { id: 'abr', l: 'Abgerechnet', w: 104, v: r => r.abr ? '✓ ' + (r.am ? abD(r.am) : '') : '', html: r => r.abr ? `<span class="badge verrechnet">✓ ${r.am ? abD(r.am) : 'abgerechnet'}</span>` : '<span class="nr">offen</span>' }
];
const AB_DEF = { order: ['datum', 'src', 'nr', 'arbeit', 'kunde', 'feld', 'ha', 'haP', 'haJ', 'std', 'dauer', 'maschine', 'kultur', 'produkte', 'gesamt', 'abr'], w: {} };
function abColCfg() {
  let c; try { c = JSON.parse(ls('lp_abrcols') || 'null'); } catch { c = null; }
  if (!c || !Array.isArray(c.order)) c = JSON.parse(JSON.stringify(AB_DEF));
  c.order = c.order.filter(id => AB_COLS.some(x => x.id === id)); c.w = c.w || {}; return c;
}
const abColSave = c => ls('lp_abrcols', JSON.stringify(c));
const abCols = () => { const c = abColCfg(); return c.order.map(id => AB_COLS.find(x => x.id === id)).map(x => ({ ...x, w: c.w[x.id] || x.w })); };
function abTable(list, { print, all } = {}) {
  const g = App.abr.grp, cols = abCols(), S = App.abrSel || new Set(), ck = !print;
  const allOn = ck && list.length && list.every(r => S.has(r.id));
  const colg = print ? '' : `<colgroup>${ck ? '<col style="width:36px">' : ''}${cols.map(c => `<col data-col="${c.id}" style="width:${c.w}px">`).join('')}</colgroup>`;
  const head = `<thead><tr>${ck ? `<th class="ck" data-stop><input type="checkbox" data-abin="selAll" ${allOn ? 'checked' : ''} title="Alle angezeigten auswählen"></th>` : ''}${cols.map(c => `<th class="${c.n ? 'n' : ''}" ${print ? '' : `draggable="true" data-col="${c.id}" title="Ziehen zum Verschieben"`}>${esc(c.l)}${print ? '' : `<span class="cres" data-col="${c.id}" title="Breite ändern"></span>`}</th>`).join('')}</tr></thead>`;
  const row = r => `<tr class="${print ? '' : 'click'}${r.abr ? ' jdab' : ''}${ck && S.has(r.id) ? ' alsel' : ''}" ${print ? '' : `data-ab="row" data-id="${esc(r.id)}"`}>${ck ? `<td class="ck" data-stop><input type="checkbox" data-abin="sel" value="${esc(r.id)}" ${S.has(r.id) ? 'checked' : ''}></td>` : ''}${cols.map(c => `<td class="${c.n ? 'n' : ''} c-${c.id}">${!print && c.html ? c.html(r) : esc(c.v(r))}</td>`).join('')}</tr>`;
  const TL = all || list, sum = k => r2(TL.reduce((s, r) => s + (r[k] || 0), 0));
  const tot = `<tfoot><tr class="tot jdbtot">${ck ? '<td></td>' : ''}${cols.map((c, i) => `<td class="${c.n ? 'n' : ''}">${c.id === 'ha' ? `<b>${fmtNum(abHaSum(TL))}</b>` : c.id === 'haP' ? `<b>${fmtNum(sum('haP'))}</b>` : c.id === 'haJ' ? `<b>${fmtNum(sum('haJ'))}</b>` : c.id === 'std' ? `<b>${fmtNum(sum('std'))}</b>` : c.id === 'dauer' ? `<b>${hrs(sum('dauer'))}</b>` : i === 0 ? `<b>Total ${TL.length}</b>` : ''}</td>`).join('')}</tr></tfoot>`;
  const tcls = `btab jdbtab abtab${print ? '' : ' jdbfix abfix'}`, tw = print ? '' : ` style="width:${(ck ? 36 : 0) + cols.reduce((s, c) => s + c.w, 0)}px"`;
  if (!g) return `<table class="${tcls}"${tw}>${colg}${head}<tbody>${list.map(row).join('')}</tbody>${tot}</table>`;
  const groups = groupBy(list.slice().sort((a, b) => String(abGroupKey(a, g)).localeCompare(String(abGroupKey(b, g)), 'de') * (g === 'monat' ? -1 : 1)), r => abGroupKey(r, g));
  return `<table class="${tcls}"${tw}>${colg}${head}${groups.map(([k, l]) => `<tbody class="pblk"><tr class="gk"><td colspan="${cols.length + (ck ? 1 : 0)}">${esc(jdbGroupLabel(k, g === 'monat' ? 'monat' : ''))} · ${l.length} ${l.length === 1 ? 'Eintrag' : 'Einträge'} · ${fmtNum(abHaSum(l))} ha</td></tr>${l.map(row).join('')}</tbody>`).join('')}${tot}</table>`;
}
function abColsAttach() {
  const t = $('.abfix'); if (!t) return;
  let dragId = null;
  $$('.abfix th[data-col]').forEach(th => {
    th.addEventListener('dragstart', e => { if (e.target.closest('.cres')) { e.preventDefault(); return; } dragId = th.dataset.col; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); th.classList.add('cdrag'); });
    th.addEventListener('dragend', () => th.classList.remove('cdrag'));
    th.addEventListener('dragover', e => { if (!dragId) return; e.preventDefault(); const r = th.getBoundingClientRect(); th.classList.toggle('cins-l', e.clientX < r.left + r.width / 2); th.classList.toggle('cins-r', e.clientX >= r.left + r.width / 2); });
    th.addEventListener('dragleave', () => th.classList.remove('cins-l', 'cins-r'));
    th.addEventListener('drop', e => {
      e.preventDefault(); const after = th.classList.contains('cins-r'); th.classList.remove('cins-l', 'cins-r');
      if (!dragId || dragId === th.dataset.col) return;
      const c = abColCfg(); c.order = c.order.filter(x => x !== dragId); const i = c.order.indexOf(th.dataset.col); c.order.splice(after ? i + 1 : i, 0, dragId); dragId = null; abColSave(c); App.render();
    });
  });
  $$('.abfix .cres').forEach(h => h.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const id = h.dataset.col, col = t.querySelector(`col[data-col="${id}"]`), x0 = e.clientX, w0 = col.getBoundingClientRect().width / UIZ(), tw0 = t.getBoundingClientRect().width / UIZ();
    h.setPointerCapture(e.pointerId); document.body.classList.add('cresizing');
    const mv = ev => { const w = Math.max(40, Math.round(w0 + (ev.clientX - x0) / UIZ())); col.style.width = w + 'px'; t.style.width = (tw0 + w - w0) + 'px'; };
    const up = ev => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); document.body.classList.remove('cresizing'); const c = abColCfg(); c.w[id] = Math.max(40, Math.round(w0 + (ev.clientX - x0) / UIZ())); abColSave(c); App.noClickUntil = Date.now() + 300; };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
  }));
}
function abColsDialog() {
  const c = abColCfg(), order = [...c.order, ...AB_COLS.map(x => x.id).filter(id => !c.order.includes(id))];
  const rowH = id => { const col = AB_COLS.find(x => x.id === id); return `<div class="rowi jcol" data-id="${id}"><label class="tog" style="flex:1"><input type="checkbox" name="on" value="${id}" ${c.order.includes(id) ? 'checked' : ''}> ${esc(col.l)}</label>
    <span class="updown"><button type="button" class="x" data-ab="colMv" data-id="${id}" data-d="-1" aria-label="Nach oben">▲</button><button type="button" class="x" data-ab="colMv" data-id="${id}" data-d="1" aria-label="Nach unten">▼</button></span></div>`; };
  Dlg.open('Spalten', `<p class="nr" style="margin-top:0">Haken = Spalte anzeigen. Reihenfolge mit ▲ ▼ – am PC auch direkt in der Tabelle: Spaltenkopf ziehen = verschieben, rechten Rand ziehen = Breite.</p>
    <div class="rows" id="abcols">${order.map(rowH).join('')}</div>
    <div class="btns" style="margin-top:10px"><button type="button" class="btn" data-ab="colReset">Standard wiederherstellen</button></div>`,
    saveFooter(''), fd => {
      const on = new Set(fd.getAll('on')), ids = $$('#abcols .jcol').map(x => x.dataset.id).filter(id => on.has(id));
      if (!ids.length) { toast('Mindestens eine Spalte anzeigen'); return false; }
      const n = abColCfg(); n.order = ids; abColSave(n); App.render(); return true;
    });
}
/* ---------- Summen, Druck, CSV ---------- */
const abSummary = list => groupBy(list, r => r.arbeit || '–').sort((a, b) => b[1].length - a[1].length).map(([a, l]) => `<span class="chip">${esc(a)}: ${l.length} · ${fmtNum(abHaSum(l))} ha</span>`).join('');
function abSummen(list, { print } = {}) {
  const arbeiten = [...new Set(list.map(r => r.arbeit || '–'))].sort((a, b) => a.localeCompare(b, 'de'));
  const kunden = groupBy(list.slice().sort((a, b) => (a.kunde || '').localeCompare(b.kunde || '', 'de')), r => r.kunde || '–');
  const cell = l => l.length ? `${fmtNum(abHaSum(l))}<small> · ${l.length}</small>` : '';
  return `<table class="btab jdbsum"><thead><tr><th>Kunde</th>${arbeiten.map(a => `<th class="n">${esc(a)}</th>`).join('')}<th class="n">Total ha</th></tr></thead>
    <tbody>${kunden.map(([k, l]) => `<tr><td>${esc(k)}</td>${arbeiten.map(a => `<td class="n">${cell(l.filter(r => (r.arbeit || '–') === a))}</td>`).join('')}<td class="n"><b>${fmtNum(abHaSum(l))}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr class="tot"><td><b>Total</b></td>${arbeiten.map(a => `<td class="n"><b>${fmtNum(abHaSum(list.filter(r => (r.arbeit || '–') === a)))}</b></td>`).join('')}<td class="n"><b>${fmtNum(abHaSum(list))}</b></td></tr></tfoot></table>
    ${print ? '' : '<p class="nr" style="margin:6px 0 0">Fläche in ha (Auftrag, sonst JD) · Anzahl Einträge</p>'}`;
}
const abRange = () => { const A = App.abr, d = x => fmtDate(x, { day: '2-digit', month: '2-digit', year: 'numeric' }); return A.von || A.bis ? `${A.von ? d(A.von) : '…'} – ${A.bis ? d(A.bis) : '…'}` : ''; };
function abSummenPrint() {
  const list = abList(), title = `Summen pro Kunde und Arbeit ${abRange()}`;
  printHtml(title, `<div class="bill jdbprint">${LETTERHEAD}<div class="bill-h"><div><b>Abrechnung · Summen</b><br><span class="nr">Fläche in ha · Anzahl Einträge</span></div><div class="r">${esc(title)}<br>${list.length} Einträge · ${fmtNum(abHaSum(list))} ha</div></div>${abSummen(list, { print: true })}</div>`, { noTitle: true });
}
function abPrint() {
  const A = App.abr, list = abList(), title = `Abrechnung ${abRange()}`;
  const filt = [A.ab && (A.ab === 'ja' ? 'nur abgerechnete' : 'nur offene'), A.src && AB_SRC[A.src], +A.minHa && `ohne Flächen unter ${fmtNum(+A.minHa)} ha`, ...Object.entries(AB_MS).map(([k, [, l]]) => jdbArr(A[k]).length ? `${l}: ${jdbArr(A[k]).join(', ')}` : '')].filter(Boolean).join(' · ');
  printHtml(title, `<div class="bill jdbprint">${LETTERHEAD}<div class="bill-h"><div><b>${esc(jdbArr(A.k).length === 1 ? A.k[0] : 'Abrechnung')}</b>${filt ? `<br><span class="nr">${esc(filt)}</span>` : ''}</div><div class="r">${esc(title)}<br>${list.length} Einträge · ${fmtNum(abHaSum(list))} ha</div></div>
    ${abTable(list, { print: true })}</div>`, { noTitle: true });
}
function abCsv() {
  const rows = [['Datum', 'Herkunft', 'Auftrag-Nr', 'Beginn (JD)', 'Ende (JD)', 'Arbeit', 'Kunde', 'Feld', 'Fläche ha', 'Fläche Auftrag ha', 'Fläche JD ha', 'Flächen-Quelle JD', 'Stunden Auftrag', 'Dauer JD h', 'Maschine', 'Fahrer', 'Kultur', 'Produkte', 'Gesamtmenge', 'Bemerkung', 'Abgerechnet', 'Abgerechnet am', 'Auftrag-ID', 'JD-ID']];
  abList().forEach(r => rows.push([r.d, AB_SRC[r.src], r.nr, jdbDT(r.start), jdbDT(r.end), r.arbeit, r.kunde, r.feld, r.ha ?? '', r.haP ?? '', r.haJ ?? '', r.quelle || '', r.std != null ? r2(r.std) : '', r.dauer != null ? r2(r.dauer) : '', r.maschine, r.fahrer, r.kultur, r.produkte, r.gesamt, r.notiz, r.abr ? 'ja' : 'nein', r.am || '', r.oid, r.jid]));
  const A = App.abr;
  download(`Abrechnung_${A.von || 'alle'}_${A.bis || ''}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
/* ---------- Detail: Auftrag und Arbeitsgang nebeneinander, verknüpfen / lösen ---------- */
function abDetail(id) {
  const r = abRows().find(x => x.id === id) || abRows().find(x => 'o:' + x.oid === id || 'j:' + x.jid === id); if (!r) return;
  const o = r.oid ? Store.get('auftraege', r.oid) : null, j = r.jid ? (App.jdb.rows || []).find(x => x.id === r.jid) : null;
  const kv = (k, v) => v || v === 0 ? `<tr><td class="nr">${esc(k)}</td><td>${esc(v)}</td></tr>` : '';
  const dt = s => s ? new Date(s).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const left = o ? `<table class="btab kv">${kv('Auftrag', o.nr)}${kv('Status', STATUS[statusOf(o)])}${kv('Erledigt am', o.erledigtAm ? abD(o.erledigtAm) : '')}${kv('Kunde', kundeName(o.kunde))}${kv('Feld', aFeld(o))}${kv('Arbeit', o.arbeit)}${kv('Kultur', o.kultur)}
      ${kv('Fläche', (o.flaecheEff ?? o.flaeche) != null ? fmtNum(o.flaecheEff ?? o.flaeche) + ' ha' + (o.flaecheEff != null ? ' (effektiv)' : '') : '')}${kv('Stunden', (o.stundenEff ?? dauerOf(o)) != null ? hrs(r2(o.stundenEff ?? dauerOf(o))) + (o.stundenEff != null ? ' (effektiv)' : '') : '')}${kv('Maschine', maschine(o.maschine)?.name)}
      ${kv('Mittel', r.produkte && r.src !== 'jd' && o ? prodList(o).map(p => `${p.name} ${p.menge != null ? fmtNum(p.menge) + ' ' + (p.einheit || prodUnit(p.name)) + '/ha' : ''}`).join(', ') : '')}${kv('Bemerkung', o.notiz)}</table>
      <div class="btns" style="margin-top:8px"><button type="button" class="btn small" data-ab="openOrder" data-id="${o.id}">Auftrag öffnen</button></div>`
    : `<p class="nr">Kein Auftrag im Planer verbunden.</p>${j ? `<div class="btns"><button type="button" class="btn small" data-ab="linkPick" data-id="${esc(r.id)}">Mit Auftrag verknüpfen…</button></div>` : ''}`;
  const right = j ? `<table class="btab kv">${kv('Arbeit', j.arbeit)}${kv('Kunde (JD)', j.kunde)}${kv('Feld', j.feld)}${kv('Fläche', j.ha != null ? fmtNum(j.ha) + ' ha' + (j.quelle ? ` (${j.quelle})` : '') : '')}${kv('Beginn', dt(j.start))}${kv('Ende', dt(j.end))}${kv('Dauer', j.dauer != null ? hrs(r2(j.dauer)) : '')}
      ${kv('Maschine', j.maschine)}${kv('Fahrer', j.fahrer)}${kv('Kultur', j.kultur)}${kv('Produkte', jdbProdTxt(j))}${kv('Sorten', j.sorten)}${kv('Gesamtmenge', jdbGesTxt(j))}</table>
      <div class="btns" style="margin-top:8px"><button type="button" class="btn small" data-ab="jdDetail" data-id="${esc(j.id)}">Alle Messwerte</button></div>`
    : `<p class="nr">Kein Arbeitsgang aus MyJohnDeere verbunden.</p>${o ? `<div class="btns"><button type="button" class="btn small" data-ab="linkPick" data-id="${esc(r.id)}">Mit Arbeitsgang verknüpfen…</button></div>` : ''}`;
  const fe = abFeld(o, j);
  const feLbl = fe ? fe.name : ((j && j.feld) || (o && aFeld(o)) || '');
  const body = `<div class="abdet"><div><h4>Auftrag (Planer)</h4>${left}</div><div><h4>Arbeitsgang (MyJohnDeere)</h4>${right}</div></div>
    <h4 style="margin:14px 0 6px">Vermessungen des Feldes${feLbl ? ` «${esc(feLbl)}»` : ''}</h4>${grenzenHtml(fe)}
    ${o && j ? `<p class="nr" style="margin-top:10px">${o.jdLink ? 'Von Hand verknüpft.' : 'Automatisch verbunden (Kunde, Datum, Arbeit, Feld).'} <a href="#" data-ab="unlink" data-id="${esc(r.id)}">Verknüpfung lösen</a></p>` : ''}`;
  Dlg.open('Abrechnung – Eintrag', body, `${r.abr ? `<span class="badge verrechnet">✓ abgerechnet${r.am ? ' ' + abD(r.am) : ''}</span><button type="button" class="btn" data-ab="markOne" data-id="${esc(r.id)}" data-v="0">Wieder offen</button>` : `<button type="button" class="btn primary" data-ab="markOne" data-id="${esc(r.id)}" data-v="1">✓ Als abgerechnet markieren</button>`}<span class="spacer"></span><button type="button" class="btn" data-act="close">Schliessen</button>`, () => true);
}
function abLinkPick(id) {
  const r = abRows().find(x => x.id === id); if (!r) return;
  const base = r.d || todayIso();
  let opts;
  if (r.oid) { // Arbeitsgänge ohne Auftrag in der Nähe
    const o = Store.get('auftraege', r.oid);
    opts = abRows().filter(x => x.src === 'jd' && abDays(x.d, base) <= 14).sort((a, b) => (b.kunde === r.kunde) - (a.kunde === r.kunde) || abDays(a.d, base) - abDays(b.d, base)).slice(0, 60)
      .map(x => ({ v: x.jid, t: `${abD(x.d)} · ${x.kunde} · ${x.feld || '–'} · ${x.arbeit}${x.haJ != null ? ` · ${fmtNum(x.haJ)} ha` : ''}` }));
    if (!o) return;
  } else {
    opts = abRows().filter(x => x.src === 'planer' && abDays(x.d, base) <= 14).sort((a, b) => (b.kunde === r.kunde) - (a.kunde === r.kunde) || abDays(a.d, base) - abDays(b.d, base)).slice(0, 60)
      .map(x => ({ v: x.oid, t: `${abD(x.d)} · ${x.nr} · ${x.kunde} · ${x.feld || '–'} · ${x.arbeit}${x.haP != null ? ` · ${fmtNum(x.haP)} ha` : ''}` }));
  }
  if (!opts.length) { toast('Keine passenden, noch nicht verbundenen Einträge im Umkreis von 14 Tagen.'); return; }
  Dlg.open(r.oid ? 'Mit Arbeitsgang verknüpfen' : 'Mit Auftrag verknüpfen', `<p class="nr" style="margin-top:0">${esc(abD(r.d))} · ${esc(r.kunde)} · ${esc(r.feld || '–')} · ${esc(r.arbeit)}</p>
    <div class="rows">${opts.map(x => `<label class="rowi"><input type="radio" name="x" value="${esc(x.v)}"> ${esc(x.t)}</label>`).join('')}</div>`,
    saveFooter(''), fd => {
      const x = fd.get('x'); if (!x) { toast('Eintrag wählen'); return false; }
      const oid = r.oid || x, jid = r.oid ? x : r.jid, o = Store.get('auftraege', oid); if (!o) return false;
      Store.putMany('auftraege', [{ ...o, jdLink: jid, jdUnlink: (o.jdUnlink || []).filter(y => y !== jid) }]);
      toast('Verknüpft'); setTimeout(() => abDetail('o:' + oid), 0); return true;
    });
}
function abUnlink(id) {
  const r = abRows().find(x => x.id === id); if (!r || !r.oid || !r.jid) return;
  const o = Store.get('auftraege', r.oid); if (!o) return;
  Store.putMany('auftraege', [{ ...o, jdLink: '', jdUnlink: [...new Set([...(o.jdUnlink || []), r.jid])] }]);
  Dlg.close(); toast('Verknüpfung gelöst');
}
/* ---------- Ansicht ---------- */
function abView() {
  return {
    toolbar() {
      return `<h1>Abrechnung</h1>${verwNav('abrechnung')}
        <button class="btn" data-ab="fs" title="Vollbild (Esc schliesst)">⛶ Vollbild</button>
        <button class="btn" data-ab="load" title="Arbeitsgänge aus MyJohnDeere neu laden">⟳ JD-Daten neu laden</button>`;
    },
    content() {
      const A = App.abr, J = App.jdb;
      if (!J.bg) { J.bg = true; if (!J.rows) jdbFromCache(); setTimeout(() => jdbLoad(true), 0); }
      if (A.von == null) { A.von = `${new Date().getFullYear()}-01-01`; A.bis = todayIso(); }
      const all = abRows(), list = abList(), uniq = (k, skip) => [...new Set(all.filter(abFilter(A, skip)).flatMap(r => k === 'maschine' ? r.maschine.split(', ') : [r[k]]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
      const sel = k => { const [f, label, allTxt] = AB_MS[k], cur = jdbArr(A[k]), vals = [...new Set([...cur, ...uniq(f, k)])].sort((a, b) => a.localeCompare(b, 'de'));
        const txt = !cur.length ? allTxt : cur.length === 1 ? cur[0] : `${cur.length} ausgewählt`, open = A.open === k, mq = norm(A.msq || '');
        return `<div class="fld msel ${open ? 'open' : ''}"><span>${label}</span><button type="button" class="input msel-btn ${cur.length ? 'on' : ''}" data-ab="ms" data-k="${k}" title="${esc(cur.join(', '))}">${esc(txt)}</button>
          ${open ? `<div class="msel-pop">
            <input class="input" type="search" placeholder="Suchen…" data-abin="msq" value="${esc(A.msq || '')}">
            <div class="msel-list">${vals.map(v => `<label class="msel-i" ${mq && !norm(v).includes(mq) ? 'hidden' : ''}><input type="checkbox" data-abin="msc" data-k="${k}" value="${esc(v)}" ${cur.includes(v) ? 'checked' : ''}> ${esc(v)}</label>`).join('') || '<span class="nr">Keine Werte</span>'}</div>
            <div class="msel-f"><button type="button" class="btn mini" data-ab="msAll" data-k="${k}">Alle sichtbaren</button><button type="button" class="btn mini" data-ab="msNone" data-k="${k}">Keine</button><button type="button" class="btn mini primary" data-ab="msClose">Fertig</button></div>
          </div>` : ''}</div>`; };
      const shown = list.slice(0, A.limit || 300), cnt = { beide: 0, planer: 0, jd: 0 }; all.forEach(r => cnt[r.src]++);
      const inner = `<p class="nr" style="margin-top:0">Kombiniert: erledigte und verrechnete Aufträge aus dem Planer und Arbeitsgänge aus MyJohnDeere · ${cnt.beide} verbunden, ${cnt.planer} nur Planer, ${cnt.jd} nur JD${J.rows ? '' : ' · <span style="color:var(--warn)">noch keine JD-Daten geladen</span>'}${J.meta && J.meta.stand ? ` · JD-Stand ${esc(new Date(J.meta.stand).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }))}` : ''} · <a href="#" data-ab="load">${J.loading ? 'lädt…' : 'JD neu laden'}</a></p>
        <div class="panel jfilter"><div class="jfgrid">
          <label class="fld"><span>Von</span><input class="input" type="date" data-abin="f" data-k="von" value="${esc(A.von)}"></label>
          <label class="fld"><span>Bis</span><input class="input" type="date" data-abin="f" data-k="bis" value="${esc(A.bis)}"></label>
          ${sel('k')}${sel('a')}${sel('f')}${sel('m')}${sel('c')}
          <label class="fld"><span>Herkunft</span><select class="input" data-plain data-abin="f" data-k="src"><option value="">Alle</option>${Object.entries(AB_SRC).map(([v, l]) => `<option value="${v}" ${A.src === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="fld"><span>Kleinstflächen</span><select class="input" data-plain data-abin="min">${[['', 'Alle anzeigen'], ['0.05', 'unter 0.05 ha ausblenden'], ['0.1', 'unter 0.1 ha ausblenden'], ['0.2', 'unter 0.2 ha ausblenden'], ['0.5', 'unter 0.5 ha ausblenden'], ['1', 'unter 1 ha ausblenden']].map(([v, l]) => `<option value="${v}" ${String(A.minHa || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="fld"><span>Abrechnung</span><select class="input" data-plain data-abin="f" data-k="ab"><option value="">Alle</option><option value="nein" ${A.ab === 'nein' ? 'selected' : ''}>Nur offene</option><option value="ja" ${A.ab === 'ja' ? 'selected' : ''}>Nur abgerechnete</option></select></label>
          <label class="fld"><span>Gruppieren nach</span><select class="input" data-plain data-abin="f" data-k="grp">${AB_GRP.map(([v, l]) => `<option value="${v}" ${A.grp === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="fld"><span>Sortierung</span><select class="input" data-plain data-abin="f" data-k="sort"><option value="desc">Neueste zuerst</option><option value="asc" ${A.sort === 'asc' ? 'selected' : ''}>Älteste zuerst</option></select></label>
        </div>
        <div class="btns"><span class="seg mini">${[['woche', 'Diese Woche'], ['30', '30 Tage'], ['jahr', 'Dieses Jahr'], ['vorjahr', 'Vorjahr'], ['alle', 'Alles']].map(([v, l]) => `<button type="button" data-ab="preset" data-v="${v}">${l}</button>`).join('')}</span>
          <input class="input search" type="search" placeholder="Suchen: Nr., Produkt, Fahrer, Bemerkung…" value="${esc(A.q || '')}" data-abin="q" style="max-width:260px">
          <button class="btn" data-ab="reset">Filter zurücksetzen</button></div></div>
        <p><b>${list.length} Einträge · ${fmtNum(abHaSum(list))} ha</b>${list.length ? ` <span class="nr">· ${list.filter(r => r.abr).length} abgerechnet, ${list.filter(r => !r.abr).length} offen</span>` : ''}</p>
        <div class="chips static" style="margin-bottom:10px">${abSummary(list)}</div>
        ${list.length ? `<details class="panel jdbsumbox" ${A.sumOpen ? 'open' : ''}><summary data-ab="sumToggle">Summen pro Kunde und Arbeit</summary><div class="tscroll" style="margin-top:8px">${A.sumOpen ? abSummen(list) : ''}</div>${A.sumOpen ? '<div class="btns" style="margin-top:8px"><button class="btn" data-ab="sumPrint">Summen drucken / PDF</button></div>' : ''}</details>` : ''}
        ${list.length ? `<div class="btns" style="margin-bottom:10px"><button class="btn primary" data-ab="print">Drucken / PDF</button><button class="btn" data-ab="csv">Excel (CSV)</button><button class="btn" data-ab="cols">Spalten…</button></div>
        ${abSelBar(list)}
        <div class="panel tscroll">${abTable(shown, { all: list })}</div>
        ${list.length > shown.length ? `<div class="btns" style="margin-top:10px"><button class="btn" data-ab="more">Weitere ${Math.min(300, list.length - shown.length)} anzeigen</button></div>` : ''}` : '<div class="empty">Keine Einträge für diese Auswahl.</div>'}`;
      if (!A.fs) return inner;
      return `<div class="fsview jdbfs"><div class="fsbar"><b class="lbl jdbfs-t">Abrechnung</b>
          <span class="nr">${list.length} Einträge · ${fmtNum(abHaSum(list))} ha</span>
          <button class="btn small" data-ab="fsFilter">${A.fsNoFilter ? 'Filter zeigen' : 'Filter ausblenden'}</button>
          <button class="btn small" data-ab="print">Drucken / PDF</button><button class="btn small" data-ab="csv">Excel (CSV)</button><button class="btn small" data-ab="cols">Spalten…</button>
          <button class="btn small fsclose" data-ab="fs" aria-label="Vollbild schliessen" title="Vollbild schliessen (Esc)">✕</button></div>
        <div class="jdbfs-body ${A.fsNoFilter ? 'nofilter' : ''}">${inner}</div></div>`;
    },
    after() { abColsAttach(); }
  };
}
function abPreset(v) {
  const A = App.abr, t = new Date(), y = t.getFullYear();
  if (v === 'jahr') { A.von = `${y}-01-01`; A.bis = todayIso(); }
  else if (v === 'vorjahr') { A.von = `${y - 1}-01-01`; A.bis = `${y - 1}-12-31`; }
  else if (v === '30') { A.von = isoDate(addDays(t, -30)); A.bis = todayIso(); }
  else if (v === 'woche') { A.von = isoDate(addDays(t, -((t.getDay() + 6) % 7))); A.bis = todayIso(); }
  else if (v === 'alle') { A.von = ''; A.bis = ''; }
  A.limit = 300; App.render();
}
/* ---------- Ereignisse ---------- */
document.addEventListener('click', e => {
  const A = App.abr; if (!A) return;
  if (A.open && !e.target.closest('.msel') && App.view === 'abrechnung') { A.open = null; App.render(); return; }
  const t = e.target.closest('[data-ab]'); if (!t || e.target.closest('[data-stop]')) return;
  if (App.noClickUntil && Date.now() < App.noClickUntil) return;
  const a = t.dataset.ab, id = t.dataset.id;
  if (t.tagName === 'A' || t.tagName === 'SUMMARY') e.preventDefault();
  const S = App.abrSel || (App.abrSel = new Set());
  switch (a) {
    case 'row': abDetail(id); break;
    case 'grz': { const r = abRows().find(x => x.id === id); if (!r) break; const o = r.oid ? Store.get('auftraege', r.oid) : null, j = r.jid ? (App.jdb.rows || []).find(x => x.id === r.jid) : null;
      grenzenDialog(abFeld(o, j), r.feld, r.kunde); break; }
    case 'load': jdbLoad(); break;
    case 'fs': A.fs = !A.fs; App.render(); break;
    case 'fsFilter': A.fsNoFilter = !A.fsNoFilter; App.render(); break;
    case 'preset': abPreset(t.dataset.v); break;
    case 'reset': Object.assign(A, { ab: '', src: '', k: [], a: [], f: [], m: [], c: [], q: '', grp: '', von: null, bis: null, limit: 300, open: null }); App.render(); break;
    case 'ms': A.open = A.open === t.dataset.k ? null : t.dataset.k; A.msq = ''; App.render(); { const i = $('.msel.open [data-abin="msq"]'); if (i && matchMedia('(pointer: fine)').matches) i.focus(); } break;
    case 'msAll': { const k = t.dataset.k, cur = new Set(jdbArr(A[k])); $$('.msel.open .msel-i').filter(x => !x.hidden).forEach(x => cur.add(x.querySelector('input').value)); A[k] = [...cur]; A.limit = 300; App.render(); break; }
    case 'msNone': A[t.dataset.k] = []; A.limit = 300; App.render(); break;
    case 'msClose': A.open = null; App.render(); break;
    case 'sumToggle': e.preventDefault(); A.sumOpen = !A.sumOpen; App.render(); break;
    case 'sumPrint': abSummenPrint(); break;
    case 'print': abPrint(); break;
    case 'csv': abCsv(); break;
    case 'cols': abColsDialog(); break;
    case 'colMv': { const box = $('#abcols'), el = box && box.querySelector(`.jcol[data-id="${id}"]`); if (!el) break; const d = +t.dataset.d; if (d < 0 && el.previousElementSibling) box.insertBefore(el, el.previousElementSibling); if (d > 0 && el.nextElementSibling) box.insertBefore(el.nextElementSibling, el); break; }
    case 'colReset': ls('lp_abrcols', ''); Dlg.close(); App.render(); toast('Spalten auf Standard zurückgesetzt'); break;
    case 'more': A.limit = (A.limit || 300) + 300; App.render(); break;
    case 'mark': abMarkSel(t.dataset.v === '1'); break;
    case 'markOne': { const r = abRows().find(x => x.id === id); if (!r) break; const on = t.dataset.v === '1'; abMark([r], on); toast(on ? 'Als abgerechnet markiert' : 'Wieder offen'); abDetail(id); break; }
    case 'selAllList': abList().forEach(r => S.add(r.id)); App.render(); break;
    case 'selNone': S.clear(); App.render(); break;
    case 'openOrder': Dlg.close(); orderDialog(id); break;
    case 'jdDetail': jdbDetail(id); break;
    case 'linkPick': abLinkPick(id); break;
    case 'unlink': abUnlink(id); break;
  }
});
document.addEventListener('input', e => {
  const k = e.target.dataset ? e.target.dataset.abin : null; if (!k) return; const A = App.abr;
  if (k === 'msq') { A.msq = e.target.value; const q = norm(e.target.value); $$('.msel.open .msel-i').forEach(x => { x.hidden = q && !norm(x.textContent).includes(q); }); }
  if (k === 'q') { A.q = e.target.value; A.limit = 300; const pos = e.target.selectionStart; App.render(); const el = $('[data-abin="q"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { } } }
});
document.addEventListener('change', e => {
  const k = e.target.dataset ? e.target.dataset.abin : null; if (!k) return; const A = App.abr, S = App.abrSel || (App.abrSel = new Set());
  if (k === 'f') { A[e.target.dataset.k] = e.target.value; A.limit = 300; App.render(); }
  else if (k === 'min') { A.minHa = e.target.value; ls('lp_abrmin', e.target.value); A.limit = 300; App.render(); }
  else if (k === 'msc') { const cur = new Set(jdbArr(A[e.target.dataset.k])); e.target.checked ? cur.add(e.target.value) : cur.delete(e.target.value); const sc = $('.msel.open .msel-list')?.scrollTop; A[e.target.dataset.k] = [...cur]; A.limit = 300; App.render(); const l = $('.msel.open .msel-list'); if (l && sc) l.scrollTop = sc; }
  else if (k === 'sel') { e.target.checked ? S.add(e.target.value) : S.delete(e.target.value); App.render(); }
  else if (k === 'selAll') { abList().slice(0, A.limit || 300).forEach(r => e.target.checked ? S.add(r.id) : S.delete(r.id)); App.render(); }
});
document.addEventListener('keydown', e => { const A = App.abr; if (e.key !== 'Escape' || !A || Dlg.el.open || App.view !== 'abrechnung') return; if (A.open) { A.open = null; App.render(); } else if (A.fs) { A.fs = false; App.render(); } });

// Feld zu einem Abrechnungs-Eintrag: zuerst über den JD-Arbeitsgang, sonst über das Feld des Auftrags
const abFeld = (o, j) => (j && feldFuer({ fid: j.fid, kunde: j.kunde, feld: j.feld })) || (o && feldFuer({ feldId: o.kfeld, kundeId: o.kunde, feld: aFeld(o) })) || null;
/* ---------- Zoom der Planung: Tages- und Wochenansicht unabhängig, gespeichert ---------- */
{
  const old = +(ls('lp_zoom') || 1) || 1, key = () => App.plan.mode === 'tag' ? 'tag' : 'woche';
  const Z = { tag: +(ls('lp_zoom_tag') || old) || 1, woche: +(ls('lp_zoom_woche') || old) || 1 };
  Object.defineProperty(App, 'zoom', {
    get() { return Z[key()]; },
    set(z) { const k = key(); Z[k] = z; ls('lp_zoom_' + k, String(z)); },
    configurable: true
  });
}
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
const NAS_MIN = '49'; // mindestens nötige Version des NAS-Dienstes
function versionInfo() {
  const c = Store.cfg(), nas = c.jdDienst, ver = v => +String(v || '').replace(/[^\d.]/g, '') || 0;
  const nasTxt = nas ? `Version ${esc(nas)}${ver(nas) < ver(NAS_MIN) ? ` <span class="badge offen">zu alt – NAS-Dienst auf Version ${NAS_MIN} oder neuer aktualisieren</span>` : ' <span class="nr">(aktuell)</span>'}`
    : c.jdStand ? 'ältere Version ohne Versionsangabe – <b>NAS-Dienst aktualisieren</b>' : 'noch keine Verbindung';
  return `<table class="btab kv"><tr><td class="nr">IM-Verwalter</td><td><b>Version ${APP_VERSION}</b> · Stand ${APP_STAND}</td></tr>
    <tr><td class="nr">NAS-Dienst jd-sync</td><td>${nasTxt}${c.jdStand ? ` <span class="nr">(letzte Daten ${esc(new Date(c.jdStand).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }))})</span>` : ''}</td></tr></table>
    <p class="nr" style="margin-bottom:0">Updates lädt der Planer beim nächsten Öffnen automatisch (bei Bedarf Seite neu laden). Die Version steht auch oben neben dem Programmnamen.</p>`;
}
(() => { const el = document.getElementById('appVer'); if (el) el.textContent = 'v' + APP_VERSION; })();
/* ================= Spritzen › Vorbestellung: Flächenplan × Spritzprogramme → Mittelbedarf und Bestellung ================= */
// Ein Datensatz pro Erntejahr in «einstellungen», id «vb-<jahr>»:
// { jahr, progs:[{id,name,kultur,extraHa,mittel:[{pid,name,einheit,menge}]}], rows:[{id,kunde,name}],
//   fl:{rowId:{progId:ha}}, parz:{'rowId|progId':[{pz,ha}]}, vorrat:{mkey:n}, zusatz:[{id,name,menge,einheit}] }
const vbId = y => 'vb-' + y;
const vbYears = () => Store.all('einstellungen').filter(r => /^vb-\d{4}$/.test(r.id)).map(r => r.jahr).sort((a, b) => b - a);
const vbGet = y => Store.get('einstellungen', vbId(y));
const vbBlank = y => ({ id: vbId(y), jahr: y, progs: [], rows: [], fl: {}, parz: {}, vorrat: {}, zusatz: [] });
function vbRec() { const y = vbYear(); return vbGet(y) || vbBlank(y); }
function vbYear() { const S = App.spray; if (!S.vbY) S.vbY = vbYears()[0] || ernteDefault(todayIso()); return S.vbY; }
function vbSave(rec, render = true) { Store.put('einstellungen', structuredClone(rec), { silent: true }); if (render) vbRender(); }
// Neu zeichnen und den Eingabefokus (Tab-Taste) erhalten
function vbRender() {
  setTimeout(() => {
    const a = document.activeElement, key = a && a.dataset ? a.dataset.vbk : null, sx = window.scrollX, sy = window.scrollY;
    const wrap = $('.vbmatrix'), wl = wrap ? wrap.scrollLeft : 0;
    App.render(); window.scrollTo(sx, sy);
    const w2 = $('.vbmatrix'); if (w2) w2.scrollLeft = wl;
    if (key) { const el = $(`[data-vbk="${key}"]`); if (el) { el.focus(); try { el.select(); } catch { } } }
  }, 0);
}
const vbNum = v => { const n = num(v); return n == null || !isFinite(n) ? null : n; };
// Behandlungen eines Programms (ältere Programme ohne Behandlungen: eine Behandlung mit allen Mitteln)
function vbBeh(p) { if (!p.beh) p.beh = [{ id: 'b1', name: '', hinweis: '', stadium: '', mittel: p.mittel || [] }]; delete p.mittel; return p.beh; }
const vbMittelOf = p => vbBeh(p).flatMap(b => b.mittel.filter(m => (m.name || m.pid) && (!m.optional || p.optMit)).map(m => ({ ...m, beh: b })));
const zulOf = s => ((String(s || '').toUpperCase().match(/[WDF]-\d{4}(?:-\d+)?/) || [])[0] || '');
const prodByZul = z => {
  z = zulOf(z); if (!z) return null;
  const base = x => x.replace(/^([WDF]-\d{4}).*/, '$1');
  for (const eq of [x => zulOf(x) === z, x => zulOf(x) && base(zulOf(x)) === base(z)]) { const l = Store.all('produkte').filter(p => eq(p.zulassung)); if (l.length) return l.find(p => p.aktuell !== false) || l[0]; }
  return null;
};
const mKey = m => (mProd(m) || {}).id || 'n:' + norm(m.name);
const mProd = m => (m.pid && prodById(m.pid)) || prodByZul(m.zul) || prodByName(m.name) || null;
const mName = m => (mProd(m) || {}).name || m.name || '';
const mUnit = m => m.einheit || (mProd(m) || {}).einheit || 'l';
function vbCell(rec, rid, pid) {
  const pz = rec.parz[rid + '|' + pid];
  if (pz && pz.length) return r2(pz.reduce((s, x) => s + (x.ha || 0), 0));
  return (rec.fl[rid] || {})[pid] ?? null;
}
const vbProgHa = (rec, p) => r2(rec.rows.reduce((s, r) => s + (vbCell(rec, r.id, p.id) || 0), 0) + (p.extraHa || 0));
const vbRowHa = (rec, r) => r2(rec.progs.reduce((s, p) => s + (vbCell(rec, r.id, p.id) || 0), 0));
const vbRowName = r => r.kunde ? kundeName(r.kunde) : (r.name || '–');
// Bedarf pro Mittel: Fläche × Menge/ha, abzüglich Vorrat
function vbNeed(rec) {
  const m = new Map();
  rec.progs.forEach(p => {
    const ha = vbProgHa(rec, p);
    vbMittelOf(p).forEach(x => {
      const k = mKey(x), e = m.get(k) || { key: k, pid: (mProd(x) || {}).id || '', name: mName(x), einheit: mUnit(x), bedarf: 0, teile: [] };
      const v = ha * (x.menge || 0); e.bedarf += v; e.teile.push({ prog: p.name + (x.beh.name ? ' · ' + x.beh.name : ''), ha, menge: x.menge || 0, v }); m.set(k, e);
    });
  });
  // Mittel mit Vorrat, aber ohne Bedarf ebenfalls zeigen
  Object.keys(rec.vorrat || {}).forEach(k => {
    if (m.has(k) || !(rec.vorrat[k] > 0)) return;
    const pr = k.startsWith('n:') ? null : prodById(k);
    m.set(k, { key: k, pid: pr ? pr.id : '', name: pr ? pr.name : (rec.vnames || {})[k] || k.slice(2), einheit: (rec.vunits || {})[k] || (pr ? pr.einheit || 'l' : ''), bedarf: 0, teile: [] });
  });
  return [...m.values()].map(e => {
    const pr = e.pid ? prodById(e.pid) : null;
    const vorrat = rec.vorrat[e.key] ?? (pr && pr.inventar > 0 ? pr.inventar : 0);
    const rest = r2(e.bedarf - vorrat), best = Math.max(0, rest), f = pr ? uFac(pr.einheit || 'l', e.einheit) : null, preis = pr && f ? (pr.preis || 0) / f : 0;
    return { ...e, bedarf: r2(e.bedarf), vorrat, vorratAuto: rec.vorrat[e.key] == null, rest, best, preis, betrag: best * preis };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
// Einheiten umrechnen (g↔kg, ml↔l); null = nicht umrechenbar
const uNorm = u => ({ liter: 'l', lt: 'l', l: 'l', kg: 'kg', g: 'g', gr: 'g', ml: 'ml' })[norm(u)] || norm(u);
const uFac = (from, to) => { const a = uNorm(from), b = uNorm(to); if (!a || !b || a === b) return 1; const t = { 'kg>g': 1000, 'g>kg': 0.001, 'l>ml': 1000, 'ml>l': 0.001 }; return t[a + '>' + b] ?? null; };
const zUnit = u => ({ liter: 'l', l: 'l', kg: 'kg', g: 'g' })[norm(u)] || norm(u);
function vbZusatz(rec) {
  return (rec.zusatz || []).map(z => {
    const pr = (z.pid && prodById(z.pid)) || (z.name ? prodByName(z.name) : null) || null;
    const f = pr && pr.preis ? uFac(pr.einheit || 'l', z.einheit || pr.einheit || 'l') : null;
    return { ...z, pr, preis: f ? pr.preis / f : 0, betrag: f ? (z.menge || 0) * pr.preis / f : 0 };
  });
}

/* ---------- Ansicht ---------- */
function vbContent() {
  const S = App.spray, y = vbYear(), rec = vbRec(), has = !!vbGet(y); if (S.vbSub !== 'bestellung') S.vbSub = 'flaechen'; const sub = S.vbSub;
  const years = [...new Set([...vbYears(), ernteDefault(todayIso()), y])].sort((a, b) => b - a);
  const head = `<div class="filters vbhead">
      <label class="fld" style="margin:0"><span>Erntejahr</span><select class="input" data-vbin="year" style="width:auto">${years.map(j => `<option value="${j}" ${j === y ? 'selected' : ''}>${j}${vbGet(j) ? '' : ' (neu)'}</option>`).join('')}</select></label>
      <div class="seg">${[['flaechen', 'Flächenplan'], ['bestellung', 'Bedarf & Bestellung']].map(([k, l]) => `<button type="button" data-vb="sub" data-v="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="spacer"></span>
      ${vbGet(y - 1) && !has ? `<button class="btn" data-vb="fromPrev">Aus ${y - 1} übernehmen</button>` : ''}
      <label class="btn" title="Excel-Tabelle «Flächen Bestellung» (.xlsx) oder Spritzprogramm-Datei (.json)">Importieren …<input type="file" accept=".xlsx,.json" data-vbin="import" hidden></label>
      ${has ? `<button class="btn" data-vb="print">Drucken / PDF</button><button class="btn" data-vb="xlsx">Excel</button>` : ''}
    </div>`;
  if (!has && !rec.progs.length) return head + `<div class="panel"><h2>Vorbestellung ${y}</h2>
      <p>Für das Erntejahr ${y} ist noch nichts erfasst. ${vbGet(y - 1) ? `Übernimm die Spritzprogramme (und auf Wunsch die Flächen) aus ${y - 1}, ` : ''}importiere deine bisherige Excel-Tabelle «Flächen Bestellung» bzw. eine Spritzprogramm-Datei (.json) aus dem Pflanzenschutzplan oder beginne mit einem ersten Spritzprogramm.</p>
      <div class="btns">${vbGet(y - 1) ? `<button class="btn primary" data-vb="fromPrev">Aus ${y - 1} übernehmen</button>` : ''}<button class="btn ${vbGet(y - 1) ? '' : 'primary'}" data-vb="progNew">＋ Spritzprogramm</button></div></div>`;
  return head + (sub === 'bestellung' ? vbOrderView(rec) : vbAreaView(rec));
}
// Eigener Reiter «Spritzprogramme» (pro Erntejahr)
function vbProgContent() {
  const y = vbYear(), rec = vbRec(), years = [...new Set([...vbYears(), ernteDefault(todayIso()), y])].sort((a, b) => b - a);
  return `<div class="filters vbhead">
      <label class="fld" style="margin:0"><span>Erntejahr</span><select class="input" data-vbin="year" style="width:auto">${years.map(j => `<option value="${j}" ${j === y ? 'selected' : ''}>${j}${vbGet(j) ? '' : ' (neu)'}</option>`).join('')}</select></label>
      <span class="spacer"></span>
      ${vbGet(y - 1) && !vbGet(y) ? `<button class="btn" data-vb="fromPrev">Aus ${y - 1} übernehmen</button>` : ''}
    </div>` + vbProgView(rec);
}
function vbAreaView(rec) {
  const P = rec.progs, R = rec.rows;
  const th = P.map(p => `<th class="vbph" data-vb="progEdit" data-id="${p.id}" title="Programm bearbeiten"><div>${esc(p.name)}</div>${p.kultur ? `<small>${esc(p.kultur)}</small>` : ''}</th>`).join('');
  const rows = R.map(r => {
    const tds = P.map(p => {
      const split = (rec.parz[r.id + '|' + p.id] || []).length, v = vbCell(rec, r.id, p.id);
      return split ? `<td class="n vbsplit" data-vb="rowEdit" data-id="${r.id}" title="Auf Parzellen aufgeteilt – zum Ändern antippen">${fmtNum(v)} <span class="pzm">▦</span></td>`
        : `<td class="n"><input class="vbin" inputmode="decimal" data-vbin="fl" data-r="${r.id}" data-p="${p.id}" data-vbk="f-${r.id}-${p.id}" value="${v ?? ''}"></td>`;
    }).join('');
    return `<tr><th class="vbrh" data-vb="rowEdit" data-id="${r.id}" title="Kunde bearbeiten, Parzellen aufteilen">${esc(vbRowName(r))}${r.kunde ? '' : ' <span class="warnchip" title="Keinem Kunden zugeordnet">?</span>'}</th>${tds}<td class="n tot">${fmtNum(vbRowHa(rec, r)) || ''}</td></tr>`;
  }).join('');
  const extra = P.some(p => p.extraHa) ? `<tr class="vbextra"><th title="Fläche im Programm ohne Kundenzuteilung">ohne Kunde</th>${P.map(p => `<td class="n">${p.extraHa ? fmtNum(p.extraHa) : ''}</td>`).join('')}<td class="n tot">${fmtNum(r2(P.reduce((s, p) => s + (p.extraHa || 0), 0)))}</td></tr>` : '';
  const tot = P.reduce((s, p) => s + vbProgHa(rec, p), 0);
  return `<div class="panel"><h2>Flächenplan ${rec.jahr} <small class="nr">ha pro Kunde und Spritzprogramm</small></h2>
    ${P.length ? `<div class="vbmatrix"><table class="vbtab"><thead><tr><th class="vbc">Kunde</th>${th}<th class="n">Total</th></tr></thead>
      <tbody>${rows}${extra}</tbody>
      <tfoot><tr><th>Total</th>${P.map(p => `<td class="n"><b>${fmtNum(vbProgHa(rec, p))}</b></td>`).join('')}<td class="n"><b>${fmtNum(r2(tot))}</b></td></tr></tfoot></table></div>` : '<p class="nr">Zuerst ein Spritzprogramm anlegen.</p>'}
    <div class="btns"><button class="btn" data-vb="rowNew">＋ Kunde</button><button class="btn" data-vb="progNew">＋ Spritzprogramm</button></div>
    <p class="nr">Fläche direkt in die Zelle tippen (Tab springt weiter). Kundennamen antippen, um die Fläche eines Programms auf Parzellen aufzuteilen – aufgeteilte Zellen zeigen ▦. Programmkopf antippen, um Mittel und Mengen zu bearbeiten.</p></div>`;
}
function vbProgView(rec) {
  const miss = vbMissing(rec);
  return `<div class="btns" style="margin:0 0 10px"><button class="btn primary" data-vb="progNew">＋ Spritzprogramm</button>
      <label class="btn">Spritzprogramme importieren (.json)<input type="file" accept=".json,application/json" data-vbin="importJson" hidden></label>
      ${miss.length ? `<button class="btn" data-vb="prodMissing">⚠ ${miss.length} ${miss.length === 1 ? 'Mittel' : 'Mittel'} nicht in den Stammdaten …</button>` : ''}</div>
    <div class="list grid vbprogs">${rec.progs.map((p, pi) => {
      const ha = vbProgHa(rec, p), B = vbBeh(p), hasL = vbLines(rec, p).length > 0, kd = rec.rows.filter(r => vbCell(rec, r.id, p.id)).map(r => esc(vbRowName(r).split(' ')[0])).join(', ');
      return `<article class="card vbpcard">
        <div class="row1"><div class="title">${esc(p.name)}</div><span class="chip">${fmtNum(ha)} ha</span></div>
        <div class="sub">${[p.kultur ? `<span class="kultur">${esc(p.kultur)}</span>` : '', p.variante ? esc(p.variante) : '', kd || 'noch keine Flächen'].filter(Boolean).join(' · ')}</div>
        ${B.map(b => {
          const n = vbOrdersOf(rec, p, b).length;
          return `<div class="vbbeh"><div class="vbbh"><b>${esc(b.name || 'Behandlung')}</b>${b.stadium ? `<span class="chip">BBCH ${esc(b.stadium)}</span>` : ''}
              <span class="vbmkw">${n ? `<span class="nr" title="Aus dieser Behandlung erstellte Aufträge">${n} erstellt</span>` : ''}${hasL ? `<button type="button" class="btn mini vbmk" data-vb="mkOrders" data-id="${p.id}" data-b="${b.id}" title="Für mehrere Kunden/Parzellen aus dem Flächenplan auf einmal">⇉ Flächenplan</button>` : ''}<button type="button" class="btn mini vbmk primary" data-vb="mkOrder" data-id="${p.id}" data-b="${b.id}" title="Spritzauftrag erfassen – Mittel aus dieser Behandlung vorausgefüllt">＋ Auftrag</button></span></div>
            ${b.hinweis ? `<div class="nr vbhin">${esc(b.hinweis)}</div>` : ''}
            <table class="sptab"><tbody>${b.mittel.map(m => `<tr class="${m.optional ? 'vbopt' : ''}"><td>${esc(mName(m))}${mProd(m) ? '' : ' <span class="warnchip vbmiss" data-vb="prodMissing" title="Nicht in den Produkt-Stammdaten – antippen zum Aufnehmen oder Zuordnen">?</span>'}${m.optional ? ' <span class="nr">optional</span>' : ''}</td>
              <td class="n" title="${esc(m.spanne || '')}">${fmtNum(m.menge)} ${esc(mUnit(m))}/ha</td><td class="n"><b>${ha && (!m.optional || p.optMit) ? `${fmtNum(r2(ha * (m.menge || 0)))} ${esc(mUnit(m))}` : ''}</b></td></tr>`).join('')}</tbody></table></div>`;
        }).join('')}
        ${p.quelle ? `<div class="nr vbq">${esc(p.quelle)}</div>` : ''}
        <div class="btns vbpbtns"><button class="btn small" data-vb="progEdit" data-id="${p.id}">Bearbeiten</button><button class="btn small" data-vb="progCopy" data-id="${p.id}">Kopieren</button>
          <span class="spacer"></span><button class="btn small" data-vb="progMove" data-id="${p.id}" data-d="-1" title="Nach vorne verschieben" ${pi ? '' : 'disabled'}>◀</button><button class="btn small" data-vb="progMove" data-id="${p.id}" data-d="1" title="Nach hinten verschieben" ${pi < rec.progs.length - 1 ? '' : 'disabled'}>▶</button></div>
      </article>`;
    }).join('') || '<p class="nr">Noch keine Spritzprogramme.</p>'}</div>`;
}
function vbOrderView(rec) {
  const need = vbNeed(rec), zus = vbZusatz(rec), sum = need.reduce((s, x) => s + x.betrag, 0) + zus.reduce((s, z) => s + z.betrag, 0);
  const tr = x => `<tr class="${x.rest < 0 ? 'vbover' : ''}">
      <td title="${esc(x.teile.map(t => `${t.prog}: ${fmtNum(t.ha)} ha × ${fmtNum(t.menge)} = ${fmtNum(r2(t.v))}`).join('\n'))}">${esc(x.name)}${x.pid ? '' : ' <span class="warnchip" title="Nicht in den Produkt-Stammdaten">?</span>'}${x.teile.length ? `<div class="nr vbteile">${x.teile.map(t => `${esc(t.prog)} ${fmtNum(r2(t.v))}`).join(' · ')}</div>` : ''}</td>
      <td>${esc(x.einheit)}</td><td class="n">${fmtNum(x.bedarf)}</td>
      <td class="n"><input class="vbin ${x.vorratAuto ? 'auto' : ''}" inputmode="decimal" data-vbin="vorrat" data-k="${esc(x.key)}" data-vbk="v-${esc(x.key)}" value="${x.vorrat || ''}" title="${x.vorratAuto ? 'aus dem Inventar' : 'von Hand'}" placeholder="0"></td>
      <td class="n">${fmtNum(x.rest)}</td><td class="n"><b>${x.best ? fmtNum(x.best) : '–'}</b></td>
      <td class="n">${x.preis ? chf(x.preis) : ''}</td><td class="n">${x.betrag ? chf(x.betrag) : ''}</td></tr>`;
  const zr = z => `<tr><td>${z.pr ? `<span class="vbzp" title="Produkt aus den Stammdaten">${esc(z.pr.name)} <span class="chip mini">Stammdaten</span></span>` : `<input class="vbin wide" data-vbin="zName" data-id="${z.id}" data-vbk="zn-${z.id}" value="${esc(z.name || '')}" placeholder="Artikel (freier Text)" list="vbProdList">`}</td>
      <td><input class="vbin" data-vbin="zEinh" data-id="${z.id}" data-vbk="ze-${z.id}" value="${esc(z.einheit || '')}" placeholder="Einheit"></td><td></td><td></td><td></td>
      <td class="n"><input class="vbin" inputmode="decimal" data-vbin="zMenge" data-id="${z.id}" data-vbk="zm-${z.id}" value="${z.menge ?? ''}"></td>
      <td class="n">${z.preis ? chf(z.preis) : ''}</td><td class="n">${z.betrag ? chf(z.betrag) : ''} <button type="button" class="x" data-vb="zDel" data-id="${z.id}" aria-label="Entfernen">×</button></td></tr>`;
  return `<div class="panel"><h2>Bedarf & Bestellung ${rec.jahr}</h2>
    <div class="tscroll"><table class="need vbneed"><thead><tr><th>Mittel</th><th>Einheit</th><th class="n">Bedarf</th><th class="n">Vorrat</th><th class="n">Restbedarf</th><th class="n">Bestellen</th><th class="n">Preis</th><th class="n">Betrag CHF</th></tr></thead>
      <tbody>${need.map(tr).join('') || '<tr><td colspan="8" class="nr">Noch kein Bedarf – Programme mit Mitteln und Flächen erfassen.</td></tr>'}</tbody>
      <tbody class="vbz"><tr class="gk"><td colspan="8">Zusatzprodukte (fixe Menge)</td></tr>${zus.map(zr).join('')}
        <tr><td colspan="8"><button type="button" class="btn small" data-vb="zAddProd">＋ Produkt aus den Stammdaten</button> <button type="button" class="btn small" data-vb="zAdd">＋ anderes Produkt</button></td></tr></tbody>
      <tfoot><tr><th colspan="7">Geschätzter Bestellwert (Preise aus den Stammdaten)</th><td class="n"><b>${chf(sum)}</b></td></tr></tfoot></table></div>
    <datalist id="vbProdList">${Lists.produkte().map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
    <p class="nr">Vorrat: grau = aus dem Inventar (Stammdaten › Inventar) übernommen, überschreibbar. Restbedarf = Bedarf − Vorrat; negativ (rot) = Überschuss. Bestellen = positiver Restbedarf. Zusatzprodukte: aus den Stammdaten (mit Preis) oder freier Text.</p></div>`;
}

/* ---------- Dialoge ---------- */
function vbProgDialog(id) {
  const rec = vbRec(), isNew = !id, p = isNew ? { id: uid(), name: '', kultur: '', variante: '', extraHa: null, beh: [{ id: uid(), name: '', hinweis: '', stadium: '', mittel: [] }] } : structuredClone(rec.progs.find(x => x.id === id));
  if (!p) return;
  const B = vbBeh(p);
  const mrow = (m = {}) => { const pr = m.name || m.pid ? mProd(m) : null; return `<div class="prow vbmrow"><select class="input" name="mname"><option value="">— Mittel —</option>${prodOptions(pr ? pr.id : '', pr ? '' : m.name)}</select>
    <input class="input" name="mmenge" inputmode="decimal" value="${m.menge ?? ''}" placeholder="Menge" title="${esc(m.spanne ? 'Empfehlung: ' + m.spanne : '')}"><input class="input vbu" name="meinh" value="${esc(m.name || m.pid ? mUnit(m) : '')}" placeholder="l">
    <label class="noeln" title="Optional (z.B. «evtl.»): zählt im Mittelbedarf nur, wenn oben eingeschaltet"><input type="checkbox" name="mopt" ${m.optional ? 'checked' : ''}><span>opt.</span></label>
    <button type="button" class="x" data-vb="mDel" aria-label="Entfernen">×</button>
    <input type="hidden" name="mx" value="${esc(JSON.stringify({ zul: m.zul || '', spanne: m.spanne || '', wf: m.wf || '', gs: m.gs || '', drift: m.drift || '', abschwemmung: m.abschwemmung || '', bemerkung: m.bemerkung || '', hinweisMenge: m.hinweisMenge || '', alias: m.alias || '' }))}"></div>`; };
  const brow = (b = {}) => `<div class="vbbox" data-b="${b.id || uid()}">
    <div class="vbb2"><label class="fld"><span>Behandlung</span><input class="input" name="bname" value="${esc(b.name || '')}" placeholder="z.B. 1. Fungizid"></label>
      <label class="fld"><span>Stadium (BBCH)</span><input class="input" name="bstad" value="${esc(b.stadium || '')}" placeholder="z.B. 31-32"></label></div>
    <label class="fld"><span>Hinweis</span><input class="input" name="bhin" value="${esc(b.hinweis || '')}"></label>
    <div class="vbml">${(b.mittel && b.mittel.length ? b.mittel : [{}]).map(mrow).join('')}</div>
    <div class="btns"><button type="button" class="btn small" data-vb="mAdd">＋ Mittel</button><span class="spacer"></span><button type="button" class="btn small" data-vb="bUp" title="Nach oben">↑</button><button type="button" class="btn small" data-vb="bDel">Behandlung entfernen</button></div></div>`;
  const body = `<div class="two"><label class="fld"><span>Name *</span><input class="input" name="name" value="${esc(p.name)}" required placeholder="z.B. Gerste 1x Fungi"></label>
      <label class="fld"><span>Kultur</span><select class="input" name="kultur"><option value="">—</option>${listOptions(Lists.kulturen(), p.kultur)}</select></label></div>
    <label class="fld"><span>Variante / Beschreibung</span><input class="input" name="variante" value="${esc(p.variante || '')}"></label>
    <h4 style="margin:8px 0 4px">Behandlungen (Mittel pro ha)</h4><div id="vbB">${B.map(brow).join('')}</div>
    <button type="button" class="btn small" data-vb="bAdd">＋ Behandlung</button>
    <label class="tog" style="margin-top:12px"><input type="checkbox" name="optMit" ${p.optMit ? 'checked' : ''}> Optionale Mittel im Mittelbedarf mitrechnen</label>
    <label class="fld" style="margin-top:8px"><span>Zusätzliche Fläche ohne Kundenzuteilung (ha)</span><input class="input" name="extraHa" inputmode="decimal" value="${p.extraHa ?? ''}" style="max-width:160px"><div class="sub2">Nur nötig, wenn ein Teil der Fläche keinem Kunden zugeordnet ist.</div></label>`;
  const footer = saveFooter(isNew ? '' : `<button type="button" class="btn danger" data-vb="progDel" data-id="${p.id}">Löschen</button><button type="button" class="btn" data-vb="progCopy" data-id="${p.id}">Kopieren</button>`);
  Dlg.open(isNew ? 'Neues Spritzprogramm' : 'Spritzprogramm', body, footer, fd => {
    const f = Dlg.form;
    const beh = $$('.vbbox', f).map(bx => ({
      id: bx.dataset.b, name: bx.querySelector('[name=bname]').value.trim(), stadium: bx.querySelector('[name=bstad]').value.trim(), hinweis: bx.querySelector('[name=bhin]').value.trim(),
      mittel: $$('.vbmrow', bx).map(r => {
        const v = r.querySelector('[name=mname]').value; if (!v) return null;
        const menge = vbNum(r.querySelector('[name=mmenge]').value), e = r.querySelector('[name=meinh]').value.trim(), pr = v.startsWith('n:') ? null : prodById(v);
        let x = {}; try { x = JSON.parse(r.querySelector('[name=mx]').value || '{}'); } catch { }
        return { ...x, pid: pr ? pr.id : '', name: pr ? pr.name : v.slice(2), zul: x.zul || zulOf(pr && pr.zulassung), einheit: e || (pr ? pr.einheit || 'l' : 'l'), menge, optional: r.querySelector('[name=mopt]').checked };
      }).filter(Boolean)
    })).filter(b => b.name || b.mittel.length);
    Object.assign(p, { name: fd.get('name').trim(), kultur: fd.get('kultur'), variante: (fd.get('variante') || '').trim(), optMit: !!fd.get('optMit'), extraHa: vbNum(fd.get('extraHa')), beh });
    delete p.mittel;
    const r = vbRec(), i = r.progs.findIndex(x => x.id === p.id);
    if (i >= 0) r.progs[i] = p; else r.progs.push(p);
    vbSave(r); return true;
  });
  Dlg.vbMrow = mrow; Dlg.vbBrow = brow;
  Dlg.form.addEventListener('change', e => {
    if (e.target.name !== 'mname') return;
    const v = e.target.value, pr = v && !v.startsWith('n:') ? prodById(v) : null, u = e.target.closest('.vbmrow').querySelector('[name=meinh]');
    if (pr) u.value = pr.einheit || 'l';
  });
}
function vbRowDialog(id) {
  const rec = vbRec(), isNew = !id, r = isNew ? { id: uid(), kunde: '', name: '' } : structuredClone(rec.rows.find(x => x.id === id));
  if (!r) return;
  const kOpts = Store.all('kunden').filter(k => k.aktiv !== false || k.id === r.kunde).sort(byName).map(k => `<option value="${k.id}" ${k.id === r.kunde ? 'selected' : ''}>${esc(kundeLabel(k))}</option>`).join('');
  const pzOpts = cur => parzOptions(r.kunde, cur);
  const pzLine = (x = {}) => `<div class="prow vbpz"><select class="input" name="pz">${pzOpts(x.pz)}</select><input class="input" name="pzha" inputmode="decimal" value="${x.ha ?? ''}" placeholder="ha"><span class="u">ha</span><button type="button" class="x" data-vb="pzDel" aria-label="Entfernen">×</button></div>`;
  const progBlocks = rec.progs.map(p => {
    const list = rec.parz[r.id + '|' + p.id] || [];
    return `<div class="vbpzbox" data-p="${p.id}"><div class="vbpzh"><b>${esc(p.name)}</b><span class="nr">${list.length ? `aufgeteilt: ${fmtNum(vbCell(rec, r.id, p.id))} ha` : `${fmtNum((rec.fl[r.id] || {})[p.id]) || '–'} ha`}</span>
      <button type="button" class="btn mini" data-vb="pzAdd">＋ Parzelle</button></div><div class="vbpzl">${list.map(pzLine).join('')}</div></div>`;
  }).join('');
  const body = `<label class="fld"><span>Kunde</span><select class="input" name="kunde" data-combo><option value="">— ohne Zuordnung —</option>${kOpts}</select></label>
    ${!r.kunde ? `<label class="fld"><span>Bezeichnung (ohne Kunde)</span><input class="input" name="name" value="${esc(r.name || '')}"></label>` : ''}
    ${!isNew && rec.progs.length ? `<h4 style="margin:10px 0 4px">Aufteilung auf Parzellen (optional)</h4>
      ${r.kunde ? `<p class="nr" style="margin-top:0">Ist ein Programm aufgeteilt, gilt die Summe der Parzellen als Fläche des Kunden.</p>${progBlocks}` : '<p class="nr">Zuerst einen Kunden zuordnen – dann lassen sich seine Parzellen wählen.</p>'}` : ''}`;
  const footer = saveFooter(isNew ? '' : `<button type="button" class="btn danger" data-vb="rowDel" data-id="${r.id}">Entfernen</button>`);
  Dlg.open(isNew ? 'Kunde hinzufügen' : 'Kunde im Flächenplan', body, footer, fd => {
    const rr = vbRec(), k = fd.get('kunde') || '';
    if (k && rr.rows.some(x => x.kunde === k && x.id !== r.id)) { toast('Dieser Kunde ist schon im Flächenplan.'); return false; }
    r.kunde = k; r.name = k ? '' : (fd.get('name') || r.name || '').trim();
    if (!k && !r.name) { toast('Kunde wählen oder Bezeichnung eingeben.'); return false; }
    $$('.vbpzbox', Dlg.form).forEach(b => {
      const lines = $$('.vbpz', b).map(l => ({ pz: l.querySelector('[name=pz]').value, ha: vbNum(l.querySelector('[name=pzha]').value) })).filter(x => x.ha);
      const key = r.id + '|' + b.dataset.p;
      if (lines.length) rr.parz[key] = lines; else delete rr.parz[key];
    });
    const i = rr.rows.findIndex(x => x.id === r.id);
    if (i >= 0) rr.rows[i] = r; else rr.rows.push(r);
    vbSave(rr); return true;
  });
  Dlg.vbPzLine = pzLine;
}
function vbFromPrev() {
  const y = vbYear(), prev = vbGet(y - 1); if (!prev) return;
  const body = `<p style="margin-top:0">Übernimmt die Spritzprogramme mit ihren Mitteln, die Kunden und die Zusatzartikel aus ${y - 1}.</p>
    <label class="tog"><input type="checkbox" name="fl" checked> Flächen aus ${y - 1} als Vorschlag übernehmen</label>`;
  Dlg.open(`Vorbestellung ${y} aus ${y - 1}`, body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Übernehmen</button>`, fd => {
    const r = structuredClone(prev); r.id = vbId(y); r.jahr = y; r.vorrat = {}; delete r.vnames; delete r.vunits;
    if (!fd.get('fl')) { r.fl = {}; r.parz = {}; r.progs.forEach(p => { p.extraHa = null; }); }
    vbSave(r); toast(`Vorbestellung ${y} angelegt`); return true;
  });
}

/* ---------- Druck & Excel ---------- */
function vbPrint() {
  const rec = vbRec(), need = vbNeed(rec), zus = vbZusatz(rec), P = rec.progs;
  const area = `<h2 style="break-before:page">Flächen ${rec.jahr} (ha)</h2><table class="btab vbp"><thead><tr><th>Kunde</th>${P.map(p => `<th class="n">${esc(p.name)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
    ${rec.rows.map(r => `<tr><td>${esc(vbRowName(r))}</td>${P.map(p => `<td class="n">${fmtNum(vbCell(rec, r.id, p.id)) || ''}</td>`).join('')}<td class="n">${fmtNum(vbRowHa(rec, r))}</td></tr>`).join('')}
    ${P.some(p => p.extraHa) ? `<tr><td>ohne Kunde</td>${P.map(p => `<td class="n">${fmtNum(p.extraHa) || ''}</td>`).join('')}<td></td></tr>` : ''}
    <tr class="gp"><td><b>Total</b></td>${P.map(p => `<td class="n"><b>${fmtNum(vbProgHa(rec, p))}</b></td>`).join('')}<td class="n"><b>${fmtNum(r2(P.reduce((s, p) => s + vbProgHa(rec, p), 0)))}</b></td></tr></tbody></table>`;
  const progs = `<h2>Spritzprogramme</h2><table class="btab"><thead><tr><th>Programm</th><th class="n">ha</th><th>Behandlung</th><th>Mittel</th><th class="n">Menge/ha</th><th class="n">Bedarf</th></tr></thead><tbody>
    ${P.map(p => { const ha = vbProgHa(rec, p), L = vbBeh(p).flatMap(b => b.mittel.map((m, j) => ({ b, m, j }))); return L.map((x, i) => `<tr${i ? '' : ' class="job"'}><td>${i ? '' : esc(p.name)}</td><td class="n">${i ? '' : fmtNum(ha)}</td><td>${x.j ? '' : esc(x.b.name || '')}${!x.j && x.b.stadium ? ` <span class="nr">BBCH ${esc(x.b.stadium)}</span>` : ''}</td><td>${esc(mName(x.m))}${x.m.optional ? ' (opt.)' : ''}</td><td class="n">${fmtNum(x.m.menge)} ${esc(mUnit(x.m))}</td><td class="n">${!x.m.optional || p.optMit ? `${fmtNum(r2(ha * (x.m.menge || 0)))} ${esc(mUnit(x.m))}` : ''}</td></tr>`).join('') || `<tr class="job"><td>${esc(p.name)}</td><td class="n">${fmtNum(ha)}</td><td colspan="4" class="nr">keine Mittel</td></tr>`; }).join('')}</tbody></table>`;
  const sum = need.reduce((s, x) => s + x.betrag, 0) + zus.reduce((s, z) => s + z.betrag, 0);
  const order = `<h2>Bestellung</h2><table class="btab"><thead><tr><th>Mittel</th><th>Einheit</th><th class="n">Bedarf</th><th class="n">Vorrat</th><th class="n">Bestellen</th><th class="n">Preis</th><th class="n">Betrag CHF</th></tr></thead><tbody>
    ${need.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.einheit)}</td><td class="n">${fmtNum(x.bedarf)}</td><td class="n">${fmtNum(x.vorrat)}</td><td class="n"><b>${x.best ? fmtNum(x.best) : '–'}</b></td><td class="n">${x.preis ? chf(x.preis) : ''}</td><td class="n">${x.betrag ? chf(x.betrag) : ''}</td></tr>`).join('')}
    ${zus.length ? `<tr class="gp"><td colspan="7"><b>Zusatzprodukte</b></td></tr>${zus.map(z => `<tr><td>${esc(z.pr ? z.pr.name : z.name)}</td><td>${esc(z.einheit || '')}</td><td></td><td></td><td class="n"><b>${fmtNum(z.menge)}</b></td><td class="n">${z.preis ? chf(z.preis) : ''}</td><td class="n">${z.betrag ? chf(z.betrag) : ''}</td></tr>`).join('')}` : ''}
    <tr class="gp"><td colspan="6"><b>Geschätzter Bestellwert</b></td><td class="n"><b>${chf(sum)}</b></td></tr></tbody></table>`;
  printHtml(`Mittelbestellung Pflanzenschutz ${rec.jahr}`, LETTERHEAD + `<h1 class="ptitle">Mittelbestellung Pflanzenschutz ${rec.jahr}</h1>` + order + area + progs, { noTitle: true });
}
function vbXlsx() {
  const rec = vbRec(), need = vbNeed(rec), zus = vbZusatz(rec), P = rec.progs;
  const fl = [['Kunde', ...P.map(p => p.name), 'Total'], ...rec.rows.map(r => [vbRowName(r), ...P.map(p => vbCell(rec, r.id, p.id) ?? ''), vbRowHa(rec, r)])];
  if (P.some(p => p.extraHa)) fl.push(['ohne Kunde', ...P.map(p => p.extraHa ?? ''), '']);
  fl.push(['Total', ...P.map(p => vbProgHa(rec, p)), r2(P.reduce((s, p) => s + vbProgHa(rec, p), 0))]);
  const pz = [['Kunde', 'Programm', 'Parzelle', 'ha']];
  Object.entries(rec.parz).forEach(([k, l]) => { const [rid, pid] = k.split('|'), r = rec.rows.find(x => x.id === rid), p = P.find(x => x.id === pid); if (r && p) l.forEach(x => pz.push([vbRowName(r), p.name, (Store.get('parzellen', x.pz) || {}).name || '', x.ha])); });
  const pr = [['Programm', 'Kultur', 'Fläche ha', 'Behandlung', 'Stadium (BBCH)', 'Mittel', 'Menge/ha', 'Einheit', 'Optional', 'Bedarf']];
  P.forEach(p => { const ha = vbProgHa(rec, p); vbBeh(p).forEach(b => b.mittel.forEach(m => pr.push([p.name, p.kultur || '', ha, b.name || '', b.stadium || '', mName(m), m.menge, mUnit(m), m.optional ? 'optional' : '', !m.optional || p.optMit ? r2(ha * (m.menge || 0)) : '']))); });
  const be = [['Mittel', 'Einheit', 'Bedarf', 'Vorrat', 'Restbedarf', 'Bestellen', 'Preis CHF', 'Betrag CHF'], ...need.map(x => [x.name, x.einheit, x.bedarf, x.vorrat, x.rest, x.best, x.preis || '', x.betrag ? r2(x.betrag) : ''])];
  if (zus.length) { be.push([]); be.push(['Zusatzartikel', 'Einheit', '', '', '', 'Menge', 'Preis CHF', 'Betrag CHF']); zus.forEach(z => be.push([z.pr ? z.pr.name : z.name, z.einheit || '', '', '', '', z.menge ?? '', z.preis || '', z.betrag ? r2(z.betrag) : ''])); }
  const sheets = [{ name: `Bestellung ${rec.jahr}`, rows: be }, { name: `Flächen ${rec.jahr}`, rows: fl }, { name: 'Programme', rows: pr }];
  if (pz.length > 1) sheets.push({ name: 'Parzellen', rows: pz });
  download(`Vorbestellung_PS_${rec.jahr}.xlsx`, xlsxBlob(sheets));
}

/* ---------- Excel-Tabelle «Flächen Bestellung» einlesen ---------- */
async function xlsxRead(buf) { // → { Blattname: [[Zellwerte]] }
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Keine Excel-Datei (.xlsx)');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {};
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    const meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    const ds = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    files[name] = { meth, data: u8.subarray(ds, ds + csz) };
  }
  const get = async name => {
    const f = files[name]; if (!f) return null;
    if (f.meth === 0) return dec.decode(f.data);
    const s = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(s).text();
  };
  const X = s => new DOMParser().parseFromString(s, 'application/xml'), T = (d, t) => [...d.getElementsByTagNameNS('*', t)];
  const ss = (await get('xl/sharedStrings.xml')) ? T(X(await get('xl/sharedStrings.xml')), 'si').map(si => T(si, 't').map(t => t.textContent).join('')) : [];
  const wb = X(await get('xl/workbook.xml')), rels = X(await get('xl/_rels/workbook.xml.rels'));
  const rmap = Object.fromEntries(T(rels, 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const out = {};
  for (const sh of T(wb, 'sheet')) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let tg = rmap[rid] || ''; tg = tg.startsWith('/') ? tg.slice(1) : 'xl/' + tg.replace(/^\.\//, '');
    const xml = await get(tg); if (!xml) continue;
    const rows = [];
    T(X(xml), 'c').forEach(c => {
      const ref = c.getAttribute('r'), m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) return;
      const col = [...m[1]].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1, row = +m[2] - 1;
      const t = c.getAttribute('t'), v = T(c, 'v')[0]?.textContent;
      let val = null;
      if (t === 'e') return; if (t === 's') val = ss[+v] ?? null; else if (t === 'inlineStr') val = T(c, 't').map(x => x.textContent).join(''); else if (t === 'str') val = v ?? null; else if (t === 'b') val = v === '1'; else if (v != null && v !== '') val = +v;
      if (val === '' || val == null) return;
      (rows[row] = rows[row] || [])[col] = val;
    });
    out[sh.getAttribute('name')] = rows;
  }
  return out;
}
const vbClean = s => String(s || '').replace(/\s+/g, ' ').replace(/(\w)- ?([a-zäöü])/g, '$1$2').trim();
const VB_SYN = [['weizen', 'ww'], ['triticale'], ['gerste'], ['mais'], ['rüben', 'zr'], ['hafer'], ['soja'], ['erbsen'], ['dinkel'], ['bohnen'], ['1x'], ['2x'], ['herbizid', 'hz'], ['ips', 'ip-suisse', 'ipsuisse'], ['intensiv', 'convisio', 'conviso'], ['gräser'], ['raps']];
const vbFeat = s => { const t = ' ' + norm(s).replace(/[^a-z0-9äöüx\-]+/g, ' ') + ' '; return new Set(VB_SYN.map((g, i) => g.some(w => w.length <= 3 ? new RegExp(`[ /]${w}[ /,]`).test(t) || t.includes(' ' + w + ' ') : t.includes(w)) ? i : -1).filter(i => i >= 0)); };
function vbParseYear(book, y) {
  const fs = book[String(y)], bs = book['Bestellung ' + y]; if (!fs && !bs) return null;
  // Flächenblatt: Kopfzeile mit Programmen, darunter Kunden bis «Total»
  const progs = [], rows = [];
  if (fs) {
    const hi = fs.findIndex(r => r && r.slice(1).filter(v => typeof v === 'string').length >= 3);
    const head = fs[hi] || [];
    head.forEach((v, c) => { if (c > 0 && typeof v === 'string' && v.trim()) progs.push({ col: c, name: vbClean(v) }); });
    for (let i = hi + 1; i < fs.length; i++) {
      const r = fs[i]; if (!r || typeof r[0] !== 'string') continue;
      if (/^total/i.test(r[0].trim())) break;
      rows.push({ name: r[0].trim(), ha: Object.fromEntries(progs.map(p => [p.col, typeof r[p.col] === 'number' ? r2(r[p.col]) : null])) });
    }
    progs.forEach(p => { p.total = r2(rows.reduce((s, r) => s + (r.ha[p.col] || 0), 0)); });
  }
  // Bestellblatt: links Blöcke «Titel | | Fläche», darunter «Mittel | Menge/ha | Einheit»; rechts Mittelliste mit Vorrat und Zusatzartikel
  const blocks = [], vorrat = [], zusatz = [];
  if (bs) {
    let cur = null;
    bs.forEach((r, i) => {
      if (!r || i < 3) return;
      const a = typeof r[0] === 'string' ? r[0].trim() : '', b = r[1], c = r[2];
      if (a && (b == null || b === '') && typeof c === 'number') { cur = { title: vbClean(a), ha: r2(c), mittel: [] }; blocks.push(cur); }
      else if (a && typeof b === 'number' && cur) { if (b > 0) cur.mittel.push({ name: a, menge: b, einheit: typeof c === 'string' ? c : '' }); }
      const g = typeof r[6] === 'string' ? r[6].trim() : '';
      if (g && !/^(produkt|einheit)$/i.test(g)) {
        if (typeof r[7] === 'string' && r[7].trim() && !/einheit/i.test(r[7])) { if (typeof r[9] === 'number') vorrat.push({ name: g, einheit: r[7].trim(), menge: r[9] }); }
        else if (r[7] == null && typeof r[10] === 'number') zusatz.push({ name: g, menge: r[10], einheit: typeof r[11] === 'string' ? r[11] : '' });
      }
    });
  }
  // Blöcke den Programmen (Spalten) zuordnen: Name (Kultur, 1x/2x, HZ, IPS …) und Fläche
  const score = (bl, p) => {
    const fb = vbFeat(bl.title), fp = vbFeat(p.name); let s = 0;
    fb.forEach(f => { if (fp.has(f)) s += 2; });
    const d = Math.abs(bl.ha - p.total); s += d <= 0.15 ? 4 : d <= 0.5 ? 2 : d <= 1 ? 1 : 0;
    return s;
  };
  const pairs = []; blocks.forEach((bl, bi) => progs.forEach((p, pi) => pairs.push({ bi, pi, s: score(bl, p) })));
  pairs.sort((a, b) => b.s - a.s);
  const usedB = new Set(), usedP = new Set();
  pairs.forEach(x => { if (x.s < 3 || usedB.has(x.bi) || usedP.has(x.pi)) return; blocks[x.bi].to = x.pi; usedB.add(x.bi); usedP.add(x.pi); });
  return { y, progs, rows, blocks, vorrat, zusatz };
}
// Produkt aus den Stammdaten zum Namen in der Tabelle suchen
function vbMatchProd(name) {
  const k = s => norm(s).replace(/[^a-z0-9äöü]/g, ''), n = k(name), all = Store.all('produkte').filter(p => p.name);
  const lev = (a, b) => { if (Math.abs(a.length - b.length) > 1) return 9; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const tries = [p => k(p.name) === n, p => k(p.name).startsWith(n) || n.startsWith(k(p.name)), p => k(p.name).includes(n), p => n.length > 5 && lev(k(p.name), n) <= 1];
  for (const t of tries) { const l = all.filter(t); const akt = l.filter(p => p.aktuell !== false); const c = akt.length ? akt : l; if (c.length === 1) return c[0]; if (c.length > 1) return null; }
  return null;
}
function vbMatchKunde(name) {
  const n = norm(name).split(/[\s(]/)[0]; if (!n) return null;
  const l = Store.all('kunden').filter(k => k.aktiv !== false && norm(k.name).split(/[\s-]/)[0] === n);
  return l.length === 1 ? l[0] : null;
}
async function vbImportFile(file) {
  let book; try { book = await xlsxRead(await file.arrayBuffer()); } catch (e) { toast('Datei konnte nicht gelesen werden: ' + e.message, 5000); return; }
  const years = [...new Set(Object.keys(book).map(n => (/^(?:Bestellung )?(\d{4})$/.exec(n.trim()) || [])[1]).filter(Boolean).map(Number))].sort((a, b) => b - a);
  if (!years.length) { toast('Keine Blätter «2026» / «Bestellung 2026» gefunden.', 5000); return; }
  const pick = years.filter(y => y >= Math.max(...years) - 1);
  const body = `<p style="margin-top:0">Gefundene Jahre in «${esc(file.name)}». Welche sollen übernommen werden?</p>
    <div class="chips">${years.map(y => `<label><input type="checkbox" name="y" value="${y}" ${pick.includes(y) ? 'checked' : ''}><span>${y}${vbGet(y) ? ' (ersetzt)' : ''}</span></label>`).join('')}</div>`;
  Dlg.open('Excel importieren', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Weiter</button>`, fd => {
    const ys = fd.getAll('y').map(Number); if (!ys.length) { toast('Mindestens ein Jahr wählen.'); return false; }
    setTimeout(() => vbImportReview(ys.map(y => vbParseYear(book, y)).filter(Boolean), 0), 0); return true;
  });
}
// Prüfen und anpassen: Zuordnung der Bestell-Blöcke zu Programmen und der Excel-Namen zu Kunden
function vbImportReview(list, idx) {
  const d = list[idx]; if (!d) { const y = list[0]?.y; if (y) { App.spray.vbY = y; App.spray.vbSub = 'flaechen'; } App.render(); toast(`${list.length} ${list.length === 1 ? 'Jahr' : 'Jahre'} importiert`); return; }
  const kOpts = cur => `<option value="">— nur Name, kein Kunde —</option>` + Store.all('kunden').filter(k => k.aktiv !== false).sort(byName).map(k => `<option value="${k.id}" ${k.id === cur ? 'selected' : ''}>${esc(kundeLabel(k))}</option>`).join('');
  const pOpts = cur => `<option value="-1">eigenes Programm (Fläche aus der Bestellung)</option>` + d.progs.map((p, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${esc(p.name)} · ${fmtNum(p.total)} ha</option>`).join('');
  const body = `<p style="margin-top:0" class="nr">Erntejahr <b>${d.y}</b> · ${d.progs.length} Programme · ${d.rows.length} Zeilen · ${d.blocks.length} Mittelblöcke${vbGet(d.y) ? ' · <b style="color:var(--warn)">ersetzt die bestehende Vorbestellung ' + d.y + '</b>' : ''}</p>
    <h4 style="margin:8px 0 4px">Kunden</h4>
    <div class="vbimp">${d.rows.map((r, i) => { const k = vbMatchKunde(r.name); return `<label class="fld"><span>${esc(r.name)}</span><select class="input" name="k${i}">${kOpts(k ? k.id : '')}</select></label>`; }).join('')}</div>
    <h4 style="margin:12px 0 4px">Mittelblöcke → Spritzprogramm</h4>
    <div class="vbimp wide">${d.blocks.map((b, i) => `<label class="fld"><span>${esc(b.title)} · ${fmtNum(b.ha)} ha <span class="nr">(${b.mittel.map(m => esc(m.name)).join(', ') || 'ohne Mittel'})</span></span><select class="input" name="b${i}">${pOpts(b.to ?? -1)}</select>
      ${b.to != null && Math.abs(d.progs[b.to].total - b.ha) > 0.05 ? `<div class="sub2">Fläche laut Flächenblatt ${fmtNum(d.progs[b.to].total)} ha – es gilt das Flächenblatt.</div>` : ''}</label>`).join('')}</div>`;
  Dlg.open(`Import prüfen – ${d.y}${list.length > 1 ? ` (${idx + 1}/${list.length})` : ''}`, body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">${idx + 1 < list.length ? 'Übernehmen & weiter' : 'Übernehmen'}</button>`, fd => {
    const rec = vbBlank(d.y), kul = Lists.kulturen();
    const guessKultur = name => { const f = vbFeat(name); return kul.find(k => [...vbFeat(k)].some(x => f.has(x) && x < 10)) || ''; };
    const conv = (pr, menge, u) => { if (!pr || !u || !pr.einheit) return { menge, einheit: u || (pr && pr.einheit) || 'l' }; const f = uFac(u, pr.einheit); return f ? { menge: r2(menge * f * 1000) / 1000, einheit: pr.einheit } : { menge, einheit: u }; };
    const mit = b => b.mittel.map(m => { const pr = vbMatchProd(m.name), c = conv(pr, m.menge, m.einheit); return { pid: pr ? pr.id : '', name: pr ? pr.name : m.name, einheit: c.einheit, menge: c.menge }; });
    const P = d.progs.map(p => ({ id: uid(), name: p.name, kultur: guessKultur(p.name), extraHa: null, mittel: [] }));
    d.blocks.forEach((b, i) => {
      const to = +fd.get('b' + i);
      if (to >= 0 && P[to] && !P[to].mittel.length) P[to].mittel = mit(b);
      else P.push({ id: uid(), name: b.title, kultur: guessKultur(b.title), extraHa: b.ha, mittel: mit(b) });
    });
    rec.progs = P;
    d.rows.forEach((r, i) => {
      const k = fd.get('k' + i) || '', row = { id: uid(), kunde: k, name: k ? '' : r.name };
      const ex = k && rec.rows.find(x => x.kunde === k);
      const tgt = ex || row; if (!ex) rec.rows.push(row);
      d.progs.forEach((p, pi) => { const v = r.ha[p.col]; if (v) { rec.fl[tgt.id] = rec.fl[tgt.id] || {}; rec.fl[tgt.id][P[pi].id] = r2((rec.fl[tgt.id][P[pi].id] || 0) + v); } });
    });
    rec.rows = rec.rows.filter(r => Object.values(rec.fl[r.id] || {}).some(v => v)).concat(rec.rows.filter(r => !Object.values(rec.fl[r.id] || {}).some(v => v)));
    rec.vnames = {}; rec.vunits = {};
    d.vorrat.forEach(v => { const pr = vbMatchProd(v.name), key = pr ? pr.id : 'n:' + norm(v.name), c = conv(pr, v.menge, v.einheit); rec.vorrat[key] = c.menge; rec.vunits[key] = c.einheit; if (!pr) rec.vnames[key] = v.name; });
    rec.zusatz = d.zusatz.map(z => ({ id: uid(), name: z.name, menge: z.menge, einheit: z.einheit }));
    Store.put('einstellungen', rec, { silent: true });
    setTimeout(() => vbImportReview(list, idx + 1), 0); return true;
  });
}

/* ---------- Ereignisse ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-vb]'); if (!t) return;
  const a = t.dataset.vb, id = t.dataset.id, S = App.spray;
  e.preventDefault(); e.stopPropagation();
  if (a === 'sub') { S.vbSub = t.dataset.v; App.render(); return; }
  if (a === 'progNew') return vbProgDialog(null);
  if (a === 'progEdit') return vbProgDialog(id);
  if (a === 'rowNew') return vbRowDialog(null);
  if (a === 'rowEdit') return vbRowDialog(id);
  if (a === 'fromPrev') return vbFromPrev();
  if (a === 'print') return vbPrint();
  if (a === 'xlsx') return vbXlsx();
  if (a === 'mAdd') { t.closest('.vbbox').querySelector('.vbml').insertAdjacentHTML('beforeend', Dlg.vbMrow({})); return; }
  if (a === 'bAdd') { $('#vbB', Dlg.form).insertAdjacentHTML('beforeend', Dlg.vbBrow({})); return; }
  if (a === 'bDel') { const bx = t.closest('.vbbox'); if ($$('.vbmrow select', bx).some(x => x.value) && !confirm('Behandlung mit ihren Mitteln entfernen?')) return; bx.remove(); return; }
  if (a === 'bUp') { const bx = t.closest('.vbbox'), pv = bx.previousElementSibling; if (pv) bx.parentNode.insertBefore(bx, pv); return; }
  if (a === 'progCopy') return vbCopyDialog(id);
  if (a === 'progMove') { const r = vbRec(), i = r.progs.findIndex(x => x.id === id), j = i + (+t.dataset.d); if (i < 0 || j < 0 || j >= r.progs.length) return; [r.progs[i], r.progs[j]] = [r.progs[j], r.progs[i]]; vbSave(r); return; }
  if (a === 'mkOrders') return vbOrdersDialog(id, t.dataset.b);
  if (a === 'mkOrder') return vbOrderNew(id, t.dataset.b);
  if (a === 'prodMissing') return vbProdAddDialog(vbMissing(vbRec()));
  if (a === 'zAddProd') return vbZProdDialog();
  if (a === 'mDel') { t.closest('.vbmrow').remove(); return; }
  if (a === 'pzAdd') { t.closest('.vbpzbox').querySelector('.vbpzl').insertAdjacentHTML('beforeend', Dlg.vbPzLine({})); return; }
  if (a === 'pzDel') { t.closest('.vbpz').remove(); return; }
  if (a === 'progDel') {
    const r = vbRec(), p = r.progs.find(x => x.id === id); if (!p || !confirm(`Spritzprogramm «${p.name}» mit seinen Flächen löschen?`)) return;
    r.progs = r.progs.filter(x => x.id !== id); Object.values(r.fl).forEach(o => delete o[id]); Object.keys(r.parz).forEach(k => { if (k.endsWith('|' + id)) delete r.parz[k]; });
    Dlg.close(); vbSave(r); return;
  }
  if (a === 'rowDel') {
    const r = vbRec(), row = r.rows.find(x => x.id === id); if (!row || !confirm(`«${vbRowName(row)}» mit allen Flächen aus dem Flächenplan entfernen?`)) return;
    r.rows = r.rows.filter(x => x.id !== id); delete r.fl[id]; Object.keys(r.parz).forEach(k => { if (k.startsWith(id + '|')) delete r.parz[k]; });
    Dlg.close(); vbSave(r); return;
  }
  if (a === 'zAdd') { const r = vbRec(), z = { id: uid(), name: '', menge: null, einheit: '' }; r.zusatz = [...(r.zusatz || []), z]; vbSave(r, false); App.render(); setTimeout(() => $(`[data-vbk="zn-${z.id}"]`)?.focus(), 30); return; }
  if (a === 'zDel') { const r = vbRec(); r.zusatz = (r.zusatz || []).filter(z => z.id !== id); vbSave(r); return; }
}, true);
document.addEventListener('change', e => {
  const t = e.target, k = t.dataset ? t.dataset.vbin : null; if (!k) return;
  if (k === 'year') { App.spray.vbY = +t.value; App.render(); return; }
  if (k === 'import') { const f = t.files && t.files[0]; t.value = ''; if (f) (/\.json$/i.test(f.name) ? vbImportJson(f) : vbImportFile(f)); return; }
  if (k === 'importJson') { const f = t.files && t.files[0]; t.value = ''; if (f) vbImportJson(f); return; }
  const r = vbRec();
  if (k === 'fl') { const v = vbNum(t.value); r.fl[t.dataset.r] = r.fl[t.dataset.r] || {}; if (v) r.fl[t.dataset.r][t.dataset.p] = v; else delete r.fl[t.dataset.r][t.dataset.p]; return vbSave(r); }
  if (k === 'vorrat') { const v = vbNum(t.value); if (t.value.trim() === '') delete r.vorrat[t.dataset.k]; else r.vorrat[t.dataset.k] = v ?? 0; return vbSave(r); }
  if (k === 'zName' || k === 'zMenge' || k === 'zEinh') {
    const z = (r.zusatz || []).find(x => x.id === t.dataset.id); if (!z) return;
    if (k === 'zName') { z.name = t.value.trim(); const pr = prodByName(z.name); if (pr) { z.pid = pr.id; if (!z.einheit) z.einheit = pr.einheit || 'l'; } } else if (k === 'zEinh') z.einheit = t.value.trim(); else z.menge = vbNum(t.value);
    return vbSave(r);
  }
});

/* ---------- Spritzprogramme: Kultur erraten, fehlende Produkte, Kopieren ---------- */
function vbGuessKultur(name) { const f = vbFeat(name), kul = Lists.kulturen(); return kul.find(k => [...vbFeat(k)].some(x => f.has(x) && x < 10)) || ''; }
// Mittel der Programme, die (noch) nicht in den Produkt-Stammdaten sind
function vbMissing(recs) {
  const out = new Map();
  [].concat(recs).forEach(rec => rec.progs.forEach(p => vbBeh(p).forEach(b => b.mittel.forEach(m => {
    if (!(m.name || m.pid) || mProd(m)) return;
    const k = norm(m.name); if (!out.has(k)) out.set(k, { name: m.name, zul: m.zul || '', einheit: m.einheit || 'l', progs: new Set() });
    out.get(k).progs.add(p.name);
  }))));
  return [...out.values()];
}
function vbProdAddDialog(list, after) {
  if (!list.length) { toast('Alle Mittel sind in den Stammdaten erfasst.'); return; }
  const units = ['l', 'kg', 'g', 'ml'], all = Store.all('produkte').filter(p => p.name).sort(byName);
  // naheliegendes bestehendes Produkt (gleiches erstes Wort, eindeutig) vorschlagen
  const guess = m => { const w = norm(m.name).split(/[\s(]/)[0]; if (w.length < 3) return null; const l = all.filter(p => norm(p.name).split(/[\s(-]/)[0] === w); const akt = l.filter(p => p.aktuell !== false); const c = akt.length ? akt : l; return c.length === 1 ? c[0] : null; };
  const opts = (m, g) => `<option value="neu" ${g ? '' : 'selected'}>＋ als neues Produkt aufnehmen</option><option value="">– nicht jetzt –</option>
    <optgroup label="Bestehendem Produkt zuordnen">${all.map(p => `<option value="${p.id}" ${g && g.id === p.id ? 'selected' : ''}>→ ${esc(p.name)}${p.zulassung ? ' – ' + esc(p.zulassung) : ''}${p.aktuell === false ? ' (nicht aktuell)' : ''}</option>`).join('')}</optgroup>`;
  const body = `<p style="margin-top:0">Diese Mittel aus den Spritzprogrammen fehlen in den Produkt-Stammdaten. Pro Mittel wählen: als neues Produkt aufnehmen (Preis später unter Stammdaten › Produkte ergänzen) oder einem bestehenden Produkt zuordnen.</p>
    <div class="vbpadd">${list.map((m, i) => { const g = guess(m); return `<div class="vbparow2" data-i="${i}">
      <div class="vbpah"><b>${esc(m.name)}</b>${m.zul ? ` <span class="nr">${esc(m.zul)}</span>` : ''} <span class="nr">· ${esc([...m.progs].join(', '))}</span></div>
      <select class="input" name="a${i}" data-plain>${opts(m, g)}</select>
      <div class="vbpanew" ${g ? 'hidden' : ''}><input class="input" name="n${i}" value="${esc(m.name)}" title="Name"><input class="input" name="z${i}" value="${esc(m.zul)}" placeholder="Zulassung" title="Zulassungsnummer">
        <select class="input" name="u${i}" data-plain>${units.map(u => `<option ${uNorm(m.einheit) === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
        <input class="input" name="p${i}" inputmode="decimal" placeholder="Preis" title="Preis CHF pro Einheit (optional)"></div></div>`; }).join('')}</div>`;
  Dlg.open('Fehlende Mittel aufnehmen oder zuordnen', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Nicht jetzt</button><button type="submit" class="btn primary">Übernehmen</button>`, fd => {
    const add = [], map = [];
    list.forEach((m, i) => {
      const act = fd.get('a' + i) || '';
      if (act === 'neu') {
        const name = (fd.get('n' + i) || '').trim(); if (!name) return;
        const ex = prodByName(name);
        if (ex) map.push({ alt: m.name, p: ex });
        else { const np = { id: uid(), name, zulassung: (fd.get('z' + i) || '').trim(), einheit: fd.get('u' + i) || 'l', preis: vbNum(fd.get('p' + i)) || 0, aktuell: true }; add.push(np); map.push({ alt: m.name, p: np }); }
      } else if (act) { const p = prodById(act); if (p) map.push({ alt: m.name, p }); }
    });
    if (!map.length) return true;
    if (add.length) Store.putMany('produkte', add);
    // Mittel in allen Vorbestellungen verknüpfen (Menge bei g↔kg bzw. ml↔l umrechnen)
    Store.all('einstellungen').filter(r => /^vb-\d{4}$/.test(r.id)).forEach(r0 => {
      const r = structuredClone(r0); let ch = false;
      r.progs.forEach(p => vbBeh(p).forEach(b => b.mittel.forEach(m => {
        const x = map.find(y => norm(y.alt) === norm(m.name)); if (!x || (m.pid && prodById(m.pid))) return;
        const u = x.p.einheit || 'l', f = uFac(m.einheit || u, u);
        if (f && f !== 1 && m.menge != null) { m.menge = r2(m.menge * f * 1000) / 1000; m.einheit = u; } else if (f) m.einheit = u;
        if (!m.zul && x.p.zulassung) m.zul = zulOf(x.p.zulassung);
        m.alias = m.alias || m.name; m.pid = x.p.id; m.name = x.p.name; ch = true;
      })));
      if (ch) Store.put('einstellungen', r, { silent: true });
    });
    App.render();
    const nz = map.length - add.length;
    toast([add.length ? `${add.length} neu aufgenommen` : '', nz ? `${nz} zugeordnet` : ''].filter(Boolean).join(' · '));
    if (after) setTimeout(after, 0);
    return true;
  });
  Dlg.form.addEventListener('change', e => {
    const m = /^a(\d+)$/.exec(e.target.name || ''); if (!m) return;
    e.target.closest('.vbparow2').querySelector('.vbpanew').hidden = e.target.value !== 'neu';
  });
}
function vbCopyDialog(id) {
  const rec = vbRec(), p = rec.progs.find(x => x.id === id); if (!p) return;
  const y = rec.jahr, years = [...new Set([...vbYears(), y, y + 1])].sort((a, b) => a - b);
  const body = `<label class="fld"><span>Name der Kopie</span><input class="input" name="name" value="${esc(p.name)} (Kopie)" required></label>
    <label class="fld"><span>In Erntejahr</span><select class="input" name="jahr">${years.map(j => `<option value="${j}" ${j === y ? 'selected' : ''}>${j}${vbGet(j) ? '' : ' (neu)'}</option>`).join('')}</select></label>
    <p class="nr">Kopiert werden Behandlungen und Mittel, nicht die Flächen.</p>`;
  Dlg.open(`«${esc(p.name)}» kopieren`, body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Kopieren</button>`, fd => {
    const ty = +fd.get('jahr'), t = structuredClone(vbGet(ty) || vbBlank(ty)), c = structuredClone(p);
    vbBeh(c); c.id = uid(); c.name = fd.get('name').trim() || p.name; c.extraHa = null; c.beh.forEach(b => { b.id = uid(); });
    t.progs.push(c); Store.put('einstellungen', t, { silent: true });
    App.spray.vbY = ty; App.spray.tab = 'programme'; App.render(); toast(`Kopie in ${ty} angelegt`);
    setTimeout(() => vbProgDialog(c.id), 50); return true;
  });
}

/* ---------- Spritzaufträge aus einer Behandlung ---------- */
const vbRefOf = (rec, p, b, rid, pz) => `${rec.jahr}|${p.id}|${b.id}|${rid}|${pz || ''}`;
const vbOrdersOf = (rec, p, b) => Store.all('auftraege').filter(a => a.vbRef && a.vbRef.startsWith(`${rec.jahr}|${p.id}|${b.id}|`));
function vbLines(rec, p) {
  const L = [];
  rec.rows.forEach(r => {
    const pz = rec.parz[r.id + '|' + p.id];
    if (pz && pz.length) pz.forEach(x => L.push({ r, pz: x.pz, ha: x.ha }));
    else { const v = (rec.fl[r.id] || {})[p.id]; if (v) L.push({ r, pz: '', ha: v }); }
  });
  return L;
}
// Mittel einer Behandlung → Produktzeilen eines Auftrags (in der Einheit der Stammdaten)
const vbProdsFor = ms => ms.map(m => { const pr = mProd(m), u = pr ? pr.einheit || 'l' : mUnit(m), f = pr ? uFac(mUnit(m), u) : 1;
  return { pid: pr ? pr.id : '', name: pr ? pr.name : m.name, menge: m.menge == null ? null : r2((m.menge * (f || 1)) * 1000) / 1000, einheit: f ? u : mUnit(m), nichtOeln: false }; });
// Ein Spritzauftrag aus einer Behandlung: normales Auftragsfenster mit vorausgefüllten Mitteln
// Angaben aus dem Spritzprogramm für das Infofenster im Auftrag (nicht bearbeitbar)
function vbInfoOf(rec, p, b) {
  return { prog: p.name, variante: p.variante || '', beh: b.name || '', stadium: b.stadium || '', hinweis: b.hinweis || '', quelle: p.quelle || '', jahr: rec.jahr,
    mittel: b.mittel.filter(m => m.name || m.pid).map(m => ({ name: mName(m), zul: m.zul || zulOf((mProd(m) || {}).zulassung), menge: m.menge, einheit: mUnit(m), spanne: m.spanne || '', optional: !!m.optional,
      wf: m.wf || '', gs: m.gs || '', drift: m.drift || '', abschw: m.abschwemmung || m.abschw || '', bem: [m.hinweisMenge, m.bemerkung].filter(Boolean).join(' · ') })) };
}
function vbInfoHtml(i) {
  if (!i) return '';
  const au = m => [m.wf ? `WF ${m.wf} T` : '', m.gs ? `GS ${m.gs}` : '', m.drift ? `Drift ${m.drift}` : '', m.abschw ? `Abschw. ${m.abschw}` : ''].filter(Boolean).join(' · ');
  return `<details class="box vbinfo" open><summary><b>ℹ Aus Spritzprogramm</b> <span class="nr">${esc(i.prog)}${i.beh ? ' › ' + esc(i.beh) : ''}</span></summary>
    <div class="vbinfob">
      <div><b>${esc(i.prog)}</b>${i.variante ? ` · ${esc(i.variante)}` : ''}${i.jahr ? ` · Erntejahr ${i.jahr}` : ''}</div>
      ${i.beh ? `<div>Behandlung: <b>${esc(i.beh)}</b>${i.stadium ? ` · BBCH ${esc(i.stadium)}` : ''}</div>` : ''}
      ${i.hinweis ? `<div class="vbih">${esc(i.hinweis)}</div>` : ''}
      ${i.mittel.length ? `<table class="sptab vbit"><thead><tr><th>Mittel</th><th class="n">Menge/ha</th><th>Empfehlung</th><th>Auflagen</th></tr></thead><tbody>${i.mittel.map(m => `<tr class="${m.optional ? 'vbopt' : ''}"><td>${esc(m.name)}${m.optional ? ' <span class="nr">(optional)</span>' : ''}${m.zul ? `<div class="nr">${esc(m.zul)}</div>` : ''}</td>
        <td class="n">${m.menge != null ? `${fmtNum(m.menge)} ${esc(m.einheit)}` : ''}</td><td>${esc(m.spanne)}</td><td>${esc(au(m))}${m.bem ? `<div class="nr">${esc(m.bem)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
      ${i.quelle ? `<div class="nr">${esc(i.quelle)}</div>` : ''}
    </div></details>`;
}
function vbOrderNew(pid, bid) {
  const rec = vbRec(), p = rec.progs.find(x => x.id === pid); if (!p) return;
  const b = vbBeh(p).find(x => x.id === bid); if (!b) return;
  const vorlage = { kultur: p.kultur || '', stadium: b.stadium ? 'BBCH ' + b.stadium : '', erntejahr: rec.jahr, vbRef: vbRefOf(rec, p, b, '', ''),
    vbInfo: vbInfoOf(rec, p, b), produkte: vbProdsFor(b.mittel.filter(m => (m.name || m.pid) && !m.optional)) };
  orderDialog(null, { arbeit: sprayArbeit(), vorlage });
}
function vbOrdersDialog(pid, bid) {
  const rec = vbRec(), p = rec.progs.find(x => x.id === pid); if (!p) return;
  const b = vbBeh(p).find(x => x.id === bid); if (!b) return;
  const L = vbLines(rec, p), ex = vbOrdersOf(rec, p, b), done = ref => ex.find(a => a.vbRef === ref);
  const mit = b.mittel.filter(m => m.name || m.pid);
  const body = `<p style="margin-top:0"><b>${esc(p.name)}</b> › ${esc(b.name || 'Behandlung')}${b.stadium ? ` · BBCH ${esc(b.stadium)}` : ''}${b.hinweis ? `<br><span class="nr">${esc(b.hinweis)}</span>` : ''}</p>
    <h4 style="margin:6px 0 4px">Mittel</h4>
    <div class="vbochk">${mit.map((m, i) => `<label class="tog"><input type="checkbox" name="m${i}" ${m.optional ? '' : 'checked'}> ${esc(mName(m))} · ${fmtNum(m.menge)} ${esc(mUnit(m))}/ha${m.optional ? ' <span class="nr">(optional)</span>' : ''}${mProd(m) ? '' : ' <span class="warnchip" title="Nicht in den Stammdaten">?</span>'}</label>`).join('') || '<p class="nr">Keine Mittel.</p>'}</div>
    <h4 style="margin:10px 0 4px">Kunden / Parzellen</h4>
    ${L.length ? `<div class="vbochk">${L.map((l, i) => { const ref = vbRefOf(rec, p, b, l.r.id, l.pz), d = done(ref), pzn = l.pz ? (Store.get('parzellen', l.pz) || {}).name : '';
      return `<label class="tog ${l.r.kunde ? '' : 'off'}"><input type="checkbox" name="l${i}" ${l.r.kunde && !d ? 'checked' : ''} ${l.r.kunde ? '' : 'disabled'}> ${esc(vbRowName(l.r))}${pzn ? ` · ${esc(pzn)}` : ''} · ${fmtNum(l.ha)} ha${d ? ` <span class="chip mini">bereits Auftrag ${esc(d.nr || '')}</span>` : ''}${l.r.kunde ? '' : ' <span class="nr">(keinem Kunden zugeordnet)</span>'}</label>`; }).join('')}</div>`
      : '<p class="nr">Im Flächenplan sind für dieses Programm noch keine Flächen eingetragen.</p>'}
    <div class="two" style="margin-top:10px"><label class="fld"><span>Wunschdatum</span><input class="input" type="date" name="wunsch"></label>
      <label class="fld"><span>Stadium</span><input class="input" name="stadium" value="${esc(b.stadium ? 'BBCH ' + b.stadium : '')}"></label></div>
    <label class="fld"><span>Bemerkung im Auftrag (optional)</span><input class="input" name="notiz" value=""></label>
    <p class="nr">Programm, Behandlung, Hinweise und Auflagen der Mittel werden im Auftrag als Info angezeigt.</p>`;
  Dlg.open('Spritzaufträge erstellen', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Aufträge erstellen</button>`, fd => {
    const sel = L.filter((l, i) => fd.get('l' + i) && l.r.kunde), ms = mit.filter((m, i) => fd.get('m' + i));
    if (!sel.length) { toast('Mindestens einen Kunden wählen.'); return false; }
    const arbeit = sprayArbeit(), sm = soleMachine(arbeit);
    let nr = +(Store.nextAuftragNr().split('-')[1]); const yy = new Date().getFullYear();
    const produkte = vbProdsFor(ms);
    const list = sel.map(l => {
      const pz = l.pz ? Store.get('parzellen', l.pz) : null;
      const a = sprayDefaults({ id: uid(), erfasst: Date.now(), nr: `${yy}-${String(nr++).padStart(3, '0')}`, status: 'offen', kunde: l.r.kunde, arbeit, kultur: p.kultur || (pz && pz.kultur) || '',
        flaeche: l.ha, wunsch: fd.get('wunsch') || '', datum: '', zeit: '', produkte: structuredClone(produkte), stadium: (fd.get('stadium') || '').trim(), notiz: (fd.get('notiz') || '').trim(), vbInfo: vbInfoOf(rec, p, b),
        parzelle: l.pz || '', feld: pz ? pz.name : '', erntejahr: rec.jahr, vbRef: vbRefOf(rec, p, b, l.r.id, l.pz), maschine: sm ? sm.id : '' });
      a.dauer = defaultDauer(sm, a.flaeche); a.dauerManuell = false;
      return a;
    });
    Store.putMany('auftraege', list);
    toast(`${list.length} ${list.length === 1 ? 'Spritzauftrag' : 'Spritzaufträge'} erstellt – in der Planung unter «Noch nicht eingeplant»`, 4500);
    return true;
  });
}

/* ---------- Zusatzprodukt aus den Stammdaten ---------- */
function vbZProdDialog() {
  const body = `<label class="fld"><span>Produkt</span><select class="input" name="pid" data-combo required><option value="">— Produkt wählen —</option>${prodOptions('', '')}</select></label>
    <div class="two"><label class="fld"><span>Menge</span><input class="input" name="menge" inputmode="decimal"></label><label class="fld"><span>Einheit</span><input class="input" name="einheit" placeholder="wie Produkt"></label></div>`;
  Dlg.open('Zusatzprodukt aus den Stammdaten', body, saveFooter(), fd => {
    const pr = prodById(fd.get('pid')); if (!pr) { toast('Produkt wählen.'); return false; }
    const r = vbRec(); r.zusatz = [...(r.zusatz || []), { id: uid(), pid: pr.id, name: pr.name, menge: vbNum(fd.get('menge')), einheit: (fd.get('einheit') || '').trim() || pr.einheit || 'l' }];
    vbSave(r); return true;
  });
}

/* ---------- Spritzprogramme aus einer Datei (.json, aus dem Pflanzenschutzplan erzeugt) ---------- */
async function vbImportJson(file) {
  let doc; try { doc = JSON.parse(await file.text()); } catch { toast('Datei ist kein gültiges JSON.', 4000); return; }
  if (!doc || doc.format !== 'lohnarbeit-planer/spritzprogramme' || !Array.isArray(doc.programme)) { toast('Unbekanntes Format – erwartet wird eine Spritzprogramm-Datei für den IM-Verwalter.', 5000); return; }
  const y = vbYear(), cur = vbRec(), years = [...new Set([...vbYears(), y, y + 1, doc.jahr].filter(Boolean))].sort((a, b) => a - b);
  const body = `<p style="margin-top:0">${esc(doc.quelle || file.name)}${doc.jahr ? ` · Plan ${doc.jahr}` : ''} · Mengen pro ${esc(doc.proFlaeche || '1 ha')}</p>
    <label class="fld"><span>In Erntejahr</span><select class="input" name="jahr">${years.map(j => `<option value="${j}" ${j === y ? 'selected' : ''}>${j}${vbGet(j) ? '' : ' (neu)'}</option>`).join('')}</select></label>
    <div class="vbochk">${doc.programme.map((p, i) => { const n = (p.behandlungen || []).length, ex = cur.progs.some(x => norm(x.name) === norm(p.name));
      return `<label class="tog"><input type="checkbox" name="p${i}" checked> <b>${esc(p.name)}</b>${p.variante ? ` · ${esc(p.variante)}` : ''} <span class="nr">${n} ${n === 1 ? 'Behandlung' : 'Behandlungen'}${ex ? ' · gleichnamiges Programm vorhanden' : ''}</span></label>`; }).join('')}</div>
    <label class="fld" style="margin-top:8px"><span>Gleichnamige Programme</span><select class="input" name="mode"><option value="ersetzen">Behandlungen ersetzen (Flächen bleiben)</option><option value="neu">zusätzlich anlegen</option></select></label>`;
  Dlg.open('Spritzprogramme importieren', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Importieren</button>`, fd => {
    const ty = +fd.get('jahr'), r = structuredClone(vbGet(ty) || vbBlank(ty)), mode = fd.get('mode');
    let n = 0;
    doc.programme.forEach((src, i) => {
      if (!fd.get('p' + i)) return;
      const beh = (src.behandlungen || []).map(b => ({ id: uid(), name: b.name || '', hinweis: b.hinweis || '', stadium: b.stadium || '',
        mittel: (b.mittel || []).map(m => {
          const pr = prodByZul(m.zulassung) || vbMatchProd(m.name);
          const u = m.einheit || 'l', f = pr ? uFac(u, pr.einheit || 'l') : null;
          return { pid: pr ? pr.id : '', name: pr ? pr.name : m.name, zul: m.zulassung || '', einheit: pr && f ? pr.einheit || 'l' : u, menge: m.menge == null ? null : (pr && f ? r2(m.menge * f * 1000) / 1000 : m.menge),
            optional: !!m.optional, spanne: m.spanne || '', wf: m.wf || '', gs: m.gs || '', drift: m.drift || '', abschwemmung: m.abschwemmung || '', bemerkung: m.bemerkung || '', hinweisMenge: m.hinweisMenge || '' };
        }) }));
      const ex = mode === 'ersetzen' && r.progs.find(x => norm(x.name) === norm(src.name));
      if (ex) { vbBeh(ex); Object.assign(ex, { beh, variante: src.variante || ex.variante || '', quelle: doc.quelle || '' }); }
      else r.progs.push({ id: uid(), name: src.name, kultur: vbGuessKultur(src.name), variante: src.variante || '', quelle: doc.quelle || '', extraHa: null, beh });
      n++;
    });
    Store.put('einstellungen', r, { silent: true });
    App.spray.vbY = ty; App.spray.tab = 'programme'; App.render();
    toast(`${n} Spritzprogramme importiert`);
    const miss = vbMissing(r);
    if (miss.length) setTimeout(() => vbProdAddDialog(miss), 50);
    return true;
  });
}
/* ================= Kalenderabo: Planung als .ics in Dropbox (für Outlook, iPhone, Google) ================= */
// Einstellung (in cfg, gilt für alle Geräte): ics = { on, link } ; jedes Gerät schreibt nach dem Abgleich planung.ics, wenn sich etwas geändert hat
const ICS_PATH = () => (CFG.dataPath || '/planung.json').replace(/[^/]*$/, '') + 'planung.ics';
const icsCfg = () => Store.cfg().ics || {};
const icsEsc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Zeilen nach RFC 5545 auf 75 Bytes falten (UTF-8-sicher)
function icsFold(line) {
  const enc = new TextEncoder(); if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', n = 0, lim = 75;
  for (const ch of line) { const b = enc.encode(ch).length; if (n + b > lim) { out.push(cur); cur = ' '; n = 1; lim = 75; } cur += ch; n += b; }
  out.push(cur); return out.join('\r\n');
}
const icsUtc = (iso, min) => { const d = parseDate(iso); d.setMinutes(min); return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
function icsBuild() {
  const von = isoDate(addDays(new Date(), -60));
  const list = Store.all('auftraege').filter(a => a.datum && a.datum >= von);
  const groups = new Map(); list.forEach(a => { const k = a.datum + '|' + (a.maschine || ''); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a.id); });
  const ev = [];
  groups.forEach((ids, k) => {
    const [d, mid] = k.split('|'), items = schedule(d, mid).items, m = maschine(mid);
    items.filter(it => ids.includes(it.a.id)).forEach(it => {
      const a = it.a, st = statusOf(a), done = st === 'erledigt' || st === 'verrechnet';
      const prods = prodList(a).map(p => `• ${p.name}${p.menge != null ? ` ${fmtNum(p.menge)} ${p.einheit || prodUnit(p.name)}/ha` : ''}${p.menge != null && a.flaeche ? ` (total ${fmtNum(r2(p.menge * a.flaeche))} ${p.einheit || prodUnit(p.name)})` : ''}`);
      const desc = [`Auftrag ${a.nr || ''} · ${STATUS[st]}`, m ? `Maschine: ${m.name}` : 'Maschine: –', [a.arbeit, a.kultur].filter(Boolean).join(' · '),
        a.flaeche ? `Fläche: ${fmtNum(a.flaeche)} ha` : '', dauerOf(a) ? `Dauer: ${hrs(dauerOf(a))}` : '', a.stadium ? `Stadium: ${a.stadium}` : '',
        prods.length ? 'Mittel:\n' + prods.join('\n') : '', a.wasser && isSpray(a) ? `Wasser: ${fmtNum(a.wasser)} l/ha` : '', a.notiz ? `Bemerkung: ${a.notiz}` : ''].filter(Boolean).join('\n');
      const upd = new Date(a.upd || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      // Mehrtägig in der Arbeitszeit: ein Termin pro Tag; durchgehend: ein Termin über alle Tage
      const segs = [{ iso: a.datum, s: it.start, e: Math.max(it.start + 15, it.az ? it.end : (it.rawEnd ?? it.end)) }];
      if (it.az && it.rest > 0) for (let n = 1; n <= SCHED_MAXD; n++) {
        const iso = isoDate(addDays(parseDate(a.datum), n)), c = schedule(iso, mid).carry.find(x => x.a.id === a.id); if (!c) break;
        segs.push({ iso, s: c.start, e: c.end }); if (!(c.rest > 0)) break;
      }
      segs.forEach((g, i) => ev.push(['BEGIN:VEVENT', `UID:${a.id}${i ? '-' + (i + 1) : ''}@lohnarbeit-planer`, `DTSTAMP:${upd}`, `LAST-MODIFIED:${upd}`,
        `DTSTART:${icsUtc(g.iso, g.s)}`, `DTEND:${icsUtc(g.iso, g.e)}`,
        `SUMMARY:${icsEsc(`${done ? '✓ ' : ''}${kfText(a)} – ${a.arbeit || 'Auftrag'}${m ? ' (' + (m.kurz || m.name) + ')' : ''}${segs.length > 1 ? ` · Tag ${i + 1}/${segs.length}` : ''}`)}`,
        m ? `LOCATION:${icsEsc(m.name)}` : '', `DESCRIPTION:${icsEsc(desc)}`, `CATEGORIES:${icsEsc(a.arbeit || 'Auftrag')}`,
        `STATUS:${done ? 'CONFIRMED' : 'TENTATIVE'}`, 'TRANSP:OPAQUE', 'END:VEVENT'].filter(Boolean)));
    });
  });
  ev.sort((x, y) => x[4].localeCompare(y[4]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Indermuehle Lohnarbeiten//IM-Verwalter//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:IM-Verwalter Planung', 'X-WR-TIMEZONE:Europe/Zurich', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...ev.flat(), 'END:VCALENDAR'];
  return { text: lines.map(icsFold).join('\r\n') + '\r\n', n: ev.length };
}
const icsHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
// nach jedem erfolgreichen Abgleich: Kalender schreiben, wenn eingeschaltet und geändert
async function icsWrite(force) {
  if (!icsCfg().on || !Auth.hasSession()) return;
  const { text, n } = icsBuild(), h = icsHash(text);
  if (!force && ls('lp_icsHash') === h) return;
  const r = await Drive.req('https://content.dropboxapi.com/2/files/upload', { headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg({ path: ICS_PATH(), mode: 'overwrite', mute: true }) }, body: new TextEncoder().encode(text) });
  if (!r.ok) throw new Error('Kalender: ' + (await Drive.errSummary(r) || r.status));
  ls('lp_icsHash', h); ls('lp_icsAt', new Date().toISOString()); ls('lp_icsN', String(n));
}
// Freigabe-Link über die Dropbox-API (klappt nur, wenn die Dropbox-App die Berechtigung «sharing.write» hat)
async function icsShareLink() {
  const api = (u, body) => Drive.req(u, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r = await api('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', { path: ICS_PATH(), settings: { requested_visibility: 'public', audience: 'public', access: 'viewer' } });
  let j = await r.json().catch(() => ({}));
  if (!r.ok && /shared_link_already_exists/.test(j.error_summary || '')) {
    r = await api('https://api.dropboxapi.com/2/sharing/list_shared_links', { path: ICS_PATH(), direct_only: true }); j = await r.json().catch(() => ({}));
    if (r.ok && j.links && j.links[0]) return j.links[0].url;
  }
  if (r.ok && j.url) return j.url;
  const e = new Error(j.error_summary || ('HTTP ' + r.status)); e.scope = /missing_scope|not_permitted|insufficient/.test(j.error_summary || ''); throw e;
}
// Dropbox-Freigabelink → direkte Adresse für das Kalenderabo
function icsSubUrl(link) {
  if (!link) return '';
  try { const u = new URL(link.trim()); u.searchParams.delete('dl'); u.searchParams.delete('raw'); u.searchParams.set('dl', '1'); return u.toString(); } catch { return ''; }
}
function icsPanel() {
  const c = icsCfg(), at = ls('lp_icsAt'), n = ls('lp_icsN'), sub = icsSubUrl(c.link);
  return `<div class="panel" id="icsPanel"><h2>Kalenderabo (Outlook)</h2>
    <label class="tog"><input type="checkbox" data-in="icsOn" ${c.on ? 'checked' : ''}> Planung als Kalender «planung.ics» in Dropbox bereitstellen</label>
    ${c.on ? `<p class="nr" style="margin:6px 0 10px">Wird nach jedem Abgleich aktualisiert (eingeplante Aufträge ab 60 Tagen zurück).${at ? ` Zuletzt geschrieben: ${new Date(at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}${n ? ` · ${n} Termine` : ''}.` : ''} <a href="#" data-act="icsNow">Jetzt schreiben</a></p>
      <div class="btns" style="margin-bottom:8px"><button type="button" class="btn" data-act="icsLink">Freigabe-Link erstellen</button></div>
      <label class="fld"><span>Dropbox-Freigabelink der Datei planung.ics</span><input class="input" data-in="icsLink" value="${esc(c.link || '')}" placeholder="https://www.dropbox.com/scl/fi/…/planung.ics?…"></label>
      ${sub ? `<label class="fld"><span>Adresse für das Kalenderabo</span><div class="withbtn"><input class="input" readonly value="${esc(sub)}" id="icsSub"><button type="button" class="btn" data-act="icsCopy">Kopieren</button></div></label>
      <div class="nr icshow"><b>Outlook (Windows, neues Outlook / Outlook im Web):</b> Kalender › Kalender hinzufügen › <i>Aus dem Internet abonnieren</i> › Adresse einfügen › Name «IM-Verwalter Planung» › Importieren.<br>
        <b>Klassisches Outlook:</b> Kalender › Kalender hinzufügen › <i>Aus dem Internet…</i> › Adresse einfügen › OK › Ja.<br>
        Outlook holt Änderungen selbst ab, je nach Version alle paar Stunden. Der Kalender ist nur zum Lesen.</div>` : '<p class="nr">Freigabe-Link erstellen (oder in Dropbox bei der Datei «planung.ics» › Teilen › Link kopieren) und hier einfügen.</p>'}` : ''}
  </div>`;
}
/* ================= Rübensamen: Saatgutbestellung Zuckerrüben (Saisonmodul, ein-/ausschaltbar) ================= */
// Ein Datensatz pro Jahr in «einstellungen», id «rs-<jahr>»:
// { jahr, dpha (Dosen/ha), mwst, versand (pro Dose), lege, fga, fgp,
//   sorten:[{id,name,gruppe:'std'|'conv',preis,versand}], cone:{name,preis,versand,faktor},
//   rows:[{id,kunde,name,ha:{sid:ha},cone,saat:[{d,ha,txt}],notiz}],
//   rest:{sid|'cone':Dosen}, extra:[{id,name,d:{sid:Dosen}}], best:{sid|'cone':Anzahl} }
const rsOn = () => !!Store.cfg().rsOn;
const rsId = y => 'rs-' + y;
const rsYears = () => Store.all('einstellungen').filter(r => /^rs-\d{4}$/.test(r.id)).map(r => r.jahr).sort((a, b) => b - a);
const rsGet = y => Store.get('einstellungen', rsId(y));
const rsBlank = y => ({ id: rsId(y), jahr: y, dpha: 1.2, mwst: 0.026, versand: 10, lege: 17, fga: 21, fgp: 0.2, sorten: [], cone: { name: 'Conviso One', preis: null, versand: 5, faktor: 1 }, rows: [], rest: {}, extra: [], best: {} });
const rsDefYear = () => { const d = new Date(); return d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear(); };
function rsState() { if (!App.rs) App.rs = { y: null, sub: ls('lp_rsSub') || 'flaechen' }; if (!App.rs.y) App.rs.y = rsYears()[0] || rsDefYear(); return App.rs; }
const rsYear = () => rsState().y;
function rsRec() { const y = rsYear(); return rsGet(y) || rsBlank(y); }
function rsSave(rec, render = true) { Store.put('einstellungen', structuredClone(rec), { silent: true }); if (render) rsRender(); }
function rsRender() {
  setTimeout(() => {
    const a = document.activeElement, key = a && a.dataset ? a.dataset.rsk : null, sx = window.scrollX, sy = window.scrollY;
    const wrap = $('.rsmatrix'), wl = wrap ? wrap.scrollLeft : 0;
    App.render(); window.scrollTo(sx, sy);
    const w2 = $('.rsmatrix'); if (w2) w2.scrollLeft = wl;
    if (key) { const el = $(`[data-rsk="${key}"]`); if (el) { el.focus(); try { el.select(); } catch { } } }
  }, 0);
}
const rsNum = v => { const n = num(v); return n == null || !isFinite(n) ? null : n; };
const rsRowName = r => r.kunde ? kundeName(r.kunde) : (r.name || '–');
const rsConv = rec => rec.sorten.filter(s => s.gruppe === 'conv');
const rsStd = rec => rec.sorten.filter(s => s.gruppe !== 'conv');
const rsSorted = rec => [...rsStd(rec), ...rsConv(rec)];
const rsRowHa = (rec, r) => r2(rec.sorten.reduce((s, x) => s + ((r.ha || {})[x.id] || 0), 0));
const rsRowConvHa = (rec, r) => r2(rsConv(rec).reduce((s, x) => s + ((r.ha || {})[x.id] || 0), 0));
const rsRowCone = (rec, r) => r.cone != null ? r.cone : rsRowConvHa(rec, r); // Conviso One: ohne Eingabe = Fläche der Conviso-Sorten
const rsVersand = (rec, s) => s.versand != null ? s.versand : (rec.versand || 0);
const rsPreisDose = (rec, s) => s && s.preis != null ? r2(s.preis * (1 + (rec.mwst || 0)) + rsVersand(rec, s)) : null;
const rsConePreis = rec => rec.cone && rec.cone.preis != null ? r2(rec.cone.preis * (1 + (rec.mwst || 0)) + (rec.cone.versand ?? 0)) : null;
const rsCeil = x => x > 0 ? Math.ceil(x - 1e-9) : 0;
// Bedarf und Bestellung pro Sorte (wie in der Excel-Tabelle: Fläche × Dosen/ha − Restmenge + zusätzliche Abnehmer)
function rsNeed(rec) {
  const L = rsSorted(rec).map(s => {
    const ha = r2(rec.rows.reduce((t, r) => t + ((r.ha || {})[s.id] || 0), 0)), bedarf = r2(rec.rows.reduce((t, r) => t + ((r.ha || {})[s.id] || 0) * rsRowDpha(rec, r), 0)), rest = rec.rest[s.id] || 0;
    const extra = r2(rec.extra.reduce((t, x) => t + ((x.d || {})[s.id] || 0), 0)), total = r2(bedarf - rest + extra), vorschlag = rsCeil(total);
    const best = rec.best[s.id] != null ? rec.best[s.id] : vorschlag, pd = rsPreisDose(rec, s);
    return { key: s.id, s, name: s.name, gruppe: s.gruppe, ha, bedarf, rest, extra, total, vorschlag, best, manuell: rec.best[s.id] != null, pd, betrag: pd != null ? r2(best * pd) : 0 };
  });
  const c = rec.cone || {}, cha = r2(rec.rows.reduce((t, r) => t + (rsRowCone(rec, r) || 0), 0));
  if (cha || rec.best.cone != null || rsConv(rec).length) {
    const bedarf = r2(cha * (c.faktor ?? 1)), rest = rec.rest.cone || 0, total = r2(bedarf - rest), vorschlag = rsCeil(total), best = rec.best.cone != null ? rec.best.cone : vorschlag, pd = rsConePreis(rec);
    L.push({ key: 'cone', s: null, name: c.name || 'Conviso One', gruppe: 'cone', ha: cha, bedarf, rest, extra: 0, total, vorschlag, best, manuell: rec.best.cone != null, pd, betrag: pd != null ? r2(best * pd) : 0 });
  }
  return L;
}
// Gesäte Fläche pro Sorte: erledigte Saataufträge (gesät pro Sorte) + von Hand erfasste Saattermine mit Sorte
function rsGesaet(rec, r) {
  const g = {}; let ohne = 0;
  rsOrders(rec, r).filter(a => ['erledigt', 'verrechnet'].includes(statusOf(a))).forEach(a => {
    if (a.rsIst && Object.keys(a.rsIst).length) Object.entries(a.rsIst).forEach(([sid, ha]) => { g[sid] = r2((g[sid] || 0) + (ha || 0)); });
    else if ((a.rsSorten || []).length === 1) { const sid = a.rsSorten[0].sid; g[sid] = r2((g[sid] || 0) + (a.flaecheEff ?? a.flaeche ?? 0)); }
    else ohne = r2(ohne + (a.flaecheEff ?? a.flaeche ?? 0));
  });
  (r.saat || []).forEach(x => { if (!x.ha) return; if (x.sid) g[x.sid] = r2((g[x.sid] || 0) + x.ha); else ohne = r2(ohne + x.ha); });
  // nur eine Sorte bestellt: Saat ohne Sortenangabe (z.B. aus der Excel-Tabelle) gehört zu dieser Sorte
  const bestellt = Object.keys(r.ha || {}).filter(sid => r.ha[sid]);
  if (ohne && bestellt.length === 1) { g[bestellt[0]] = r2((g[bestellt[0]] || 0) + ohne); ohne = 0; }
  return { g, ohne, any: Object.keys(g).length > 0 || ohne > 0 };
}
// Conviso One in der Abrechnung: aus der Bestellung, von Hand überschreibbar
const rsConeAbr = (rec, r) => r.coneAbr != null ? r.coneAbr : r2((rsRowCone(rec, r) || 0) * (rec.cone.faktor ?? 1));
// Abrechnung pro Kunde: gesäte Fläche × Saatgutverbrauch des Kunden × Preis pro Dose (inkl. MwSt und Vertriebskosten)
function rsAbr(rec) {
  return rec.rows.map(r => {
    const G = rsGesaet(rec, r), dp = rsRowDpha(rec, r);
    const pos = rsSorted(rec).filter(s => (r.ha || {})[s.id] || G.g[s.id]).map(s => { const geplant = (r.ha || {})[s.id] || 0, ha = G.g[s.id] || 0, d = r2(ha * dp), pd = rsPreisDose(rec, s); return { sid: s.id, name: s.name, geplant, ha, d, pd, betrag: pd != null ? r2(d * pd) : null }; });
    const cq = rsConeAbr(rec, r); if (cq || rsRowCone(rec, r)) { const pd = rsConePreis(rec); pos.push({ name: rec.cone.name || 'Conviso One', geplant: rsRowCone(rec, r) || 0, ha: null, d: cq, pd, betrag: pd != null ? r2(cq * pd) : null, cone: true, manuell: r.coneAbr != null }); }
    return { r, G, dp, pos, total: r2(pos.reduce((t, p) => t + (p.betrag || 0), 0)) };
  }).filter(x => x.pos.length);
}
// Saat: verknüpfte Aufträge (aus dem Modul erstellt) und von Hand erfasste Termine
const rsRef = (rec, r) => `${rec.jahr}|${r.id}`;
const rsOrders = (rec, r) => Store.all('auftraege').filter(a => a.rsRef === rsRef(rec, r));
function rsSaatHtml(rec, r) {
  const d = s => s ? fmtDate(s, { day: '2-digit', month: '2-digit' }) : '';
  const O = rsOrders(rec, r).map(a => { const st = statusOf(a), done = st === 'erledigt' || st === 'verrechnet', ha = done ? (a.flaecheEff ?? a.flaeche) : a.flaeche;
    return `<span class="rssaat ${done ? 'ok' : ''}" data-act="editOrder" data-id="${a.id}" title="Auftrag ${esc(a.nr || '')} · ${esc(STATUS[st])}">${done ? '✓ ' : ''}${a.datum || a.erledigtAm ? d(done && a.erledigtAm ? a.erledigtAm : a.datum) : 'offen'}${ha ? ' · ' + fmtNum(ha) + ' ha' : ''}</span>`; });
  const sn = id => (rec.sorten.find(s => s.id === id) || {}).name || '';
  const M = (r.saat || []).map(x => `<span class="rssaat man" title="von Hand erfasst">${x.d ? d(x.d) : esc(x.txt || '')}${x.d && x.txt ? ' ' + esc(x.txt) : ''}${x.ha ? ' · ' + fmtNum(x.ha) + ' ha' : ''}${x.sid ? ' ' + esc(sn(x.sid)) : ''}</span>`);
  return [...O, ...M].join(' ');
}

/* ---------- Ansicht ---------- */
function rsView() {
  return {
    toolbar() {
      return `<h1>Rübensamen</h1><span class="spacer"></span>
        <label class="btn" title="Excel-Tabelle «Bestellung Rübensamen» (.xlsx)">Excel importieren …<input type="file" accept=".xlsx" data-rsin="import" hidden></label>
        <button class="btn" data-rs="off" title="Modul aus der Navigation entfernen (Daten bleiben gespeichert; einschalten unter Mehr › Einstellungen)">Modul ausblenden</button>`;
    },
    content: rsContent
  };
}
function rsContent() {
  const S = rsState(), y = S.y, rec = rsRec(), has = !!rsGet(y), sub = ['flaechen', 'bestellung', 'abrechnung', 'sorten'].includes(S.sub) ? S.sub : S.sub === 'kosten' ? 'abrechnung' : 'flaechen';
  const years = [...new Set([...rsYears(), rsDefYear(), y])].sort((a, b) => b - a);
  const head = `<div class="filters vbhead">
      <label class="fld" style="margin:0"><span>Jahr</span><select class="input" data-rsin="year" style="width:auto">${years.map(j => `<option value="${j}" ${j === y ? 'selected' : ''}>${j}${rsGet(j) ? '' : ' (neu)'}</option>`).join('')}</select></label>
      <div class="seg">${[['flaechen', 'Flächen & Saat'], ['bestellung', 'Bestellung'], ['abrechnung', 'Abrechnung'], ['sorten', 'Sorten & Preise']].map(([k, l]) => `<button type="button" data-rs="sub" data-v="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="spacer"></span>
      ${rsGet(y - 1) && !has ? `<button class="btn" data-rs="fromPrev">Aus ${y - 1} übernehmen</button>` : ''}
      ${has ? `<button class="btn" data-rs="print">Drucken / PDF</button><button class="btn" data-rs="xlsx">Excel</button>` : ''}
    </div>`;
  if (!has) return head + `<div class="panel"><h2>Rübensamen ${y}</h2>
      <p>Für ${y} ist noch nichts erfasst. ${rsGet(y - 1) ? `Übernimm Sorten, Preise und Kunden aus ${y - 1}, ` : ''}importiere die bisherige Excel-Tabelle «Bestellung Rübensamen» (oben rechts) oder beginne mit den Sorten.</p>
      <div class="btns">${rsGet(y - 1) ? `<button class="btn primary" data-rs="fromPrev">Aus ${y - 1} übernehmen</button>` : ''}<button class="btn ${rsGet(y - 1) ? '' : 'primary'}" data-rs="start">${y} neu beginnen</button></div></div>`;
  return head + (sub === 'bestellung' ? rsOrderView(rec) : sub === 'abrechnung' ? rsAbrView(rec) : sub === 'sorten' ? rsSortenView(rec) : rsAreaView(rec));
}
function rsAreaView(rec) {
  const St = rsStd(rec), Cv = rsConv(rec), All = [...St, ...Cv];
  if (!All.length) return `<div class="panel"><h2>Flächen ${rec.jahr}</h2><p class="nr">Zuerst unter «Sorten & Preise» die Sorten erfassen.</p><div class="btns"><button class="btn primary" data-rs="sub" data-v="sorten">Sorten & Preise</button></div></div>`;
  const grp = `<tr class="rsgrp"><th></th><th colspan="3">Saatgutverbrauch</th>${St.length ? `<th colspan="${St.length}">Standard</th>` : ''}${Cv.length ? `<th colspan="${Cv.length}" class="conv">Conviso Smart</th>` : ''}<th></th><th class="conv">${esc(rec.cone.name || 'Conviso One')}</th><th></th><th></th></tr>`;
  const th = All.map(s => `<th class="n srt ${s.gruppe === 'conv' ? 'conv' : ''}" title="${s.preis != null ? 'Grundpreis ' + chf(s.preis) : 'ohne Preis'}">${esc(s.name)}</th>`).join('');
  const rows = rec.rows.map(r => `<tr><th class="vbrh" data-rs="rowEdit" data-id="${r.id}" title="Kunde, Bemerkung und Saattermine bearbeiten">${esc(rsRowName(r))}${r.kunde ? '' : ' <span class="warnchip" title="Keinem Kunden zugeordnet">?</span>'}${r.notiz ? `<div class="nr rsnotiz">${esc(r.notiz)}</div>` : ''}</th>
      <td class="n"><input class="vbin sm" inputmode="decimal" data-rsin="lege" data-r="${r.id}" data-rsk="l-${r.id}" value="${r.lege ?? ''}" placeholder="${fmtNum(rec.lege)}" title="Legeabstand cm (leer = Standard)"></td>
      <td class="n"><input class="vbin sm" data-rsin="fga" data-r="${r.id}" data-rsk="g-${r.id}" value="${rsFgTxt(r.fga)}" placeholder="${fmtNum(rec.fga)}" title="Fahrgassenabstand m (leer = Standard, – = keine Fahrgassen)"></td>
      <td class="n rsdp ${rsRowEigen(r) ? '' : 'nr'}" title="${rsRowEigen(r) ? 'aus Legeabstand und Fahrgasse des Kunden' : 'Standard (Sorten & Preise)'}">${fmtNum(rsRowDpha(rec, r))}</td>
      ${All.map(s => `<td class="n srt ${s.gruppe === 'conv' ? 'conv' : ''}"><input class="vbin" inputmode="decimal" data-rsin="ha" data-r="${r.id}" data-s="${s.id}" data-rsk="h-${r.id}-${s.id}" value="${(r.ha || {})[s.id] ?? ''}"></td>`).join('')}
      <td class="n tot">${fmtNum(rsRowHa(rec, r)) || ''}</td>
      <td class="n conv"><input class="vbin ${r.cone == null ? 'auto' : ''}" inputmode="decimal" data-rsin="cone" data-r="${r.id}" data-rsk="c-${r.id}" value="${r.cone ?? (rsRowConvHa(rec, r) || '')}" title="${r.cone == null ? 'automatisch = Fläche der Conviso-Sorten; überschreibbar' : 'von Hand (leeren = automatisch)'}"></td>
      <td class="rssaatc">${rsSaatHtml(rec, r)}</td>
      <td><button type="button" class="btn mini" data-rs="mkOrder" data-id="${r.id}" title="Auftrag «Rüben säen» mit Fläche und Sorten erfassen">＋ Saat</button></td></tr>`).join('');
  const need = rsNeed(rec), nb = Object.fromEntries(need.map(x => [x.key, x]));
  const tot = r2(rec.rows.reduce((t, r) => t + rsRowHa(rec, r), 0));
  return `<div class="panel"><h2>Flächen ${rec.jahr} <small class="nr">ha pro Kunde und Sorte · ohne eigene Werte ${fmtNum(rec.dpha)} Dosen/ha${rec.ueber ? ` · Dosen/ha inkl. ${fmtNum(r2(rec.ueber * 100))} % Zuschlag für Überlappungen` : ''}</small></h2>
    <div class="vbmatrix rsmatrix"><table class="vbtab rstab"><thead>${grp}<tr><th class="vbc">Kunde</th><th class="n" title="Legeabstand in cm">Lege cm</th><th class="n" title="Fahrgassenabstand in m">FG m</th><th class="n" title="Saatgutverbrauch Dosen pro ha">Dosen/ha</th>${th}<th class="n">Total ha</th><th class="n conv">ha</th><th>Saat</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>Total ha</th><td></td><td></td><td></td>${All.map(s => `<td class="n srt ${s.gruppe === 'conv' ? 'conv' : ''}"><b>${fmtNum(nb[s.id]?.ha) || ''}</b></td>`).join('')}<td class="n"><b>${fmtNum(tot)}</b></td><td class="n"><b>${fmtNum(nb.cone?.ha) || ''}</b></td><td></td><td></td></tr>
        <tr class="rsdosen"><th>Bedarf Dosen</th><td></td><td></td><td></td>${All.map(s => `<td class="n srt ${s.gruppe === 'conv' ? 'conv' : ''}">${fmtNum(nb[s.id]?.bedarf) || ''}</td>`).join('')}<td class="n">${fmtNum(r2(All.reduce((t, s) => t + (nb[s.id]?.bedarf || 0), 0)))}</td><td class="n">${fmtNum(nb.cone?.bedarf) || ''}</td><td></td><td></td></tr></tfoot></table></div>
    <div class="btns"><button class="btn" data-rs="rowNew">＋ Kunde</button><button class="btn" data-rs="sortNew">＋ Sorte</button><span class="spacer"></span><button class="btn" data-rs="fahrer" title="Eine Seite (A4 quer) für den Schlepperfahrer: pro Kunde Sorten, Fläche, Dosen, Legeabstand und Fahrgassen">🖨 Übersicht Fahrer (PDF)</button></div>
    <p class="nr">Fläche direkt in die Zelle tippen (Tab springt weiter). Saatgutverbrauch: Legeabstand (cm) und Fahrgassenabstand (m) pro Kunde ergeben die Dosen/ha (leer = Standard aus «Sorten & Preise»); sie gelten für Bedarf und Abrechnung. Conviso One grau = automatisch (Fläche der Conviso-Sorten), überschreibbar. Kundennamen antippen für Zuordnung, Bemerkung und Saattermine. «＋ Saatauftrag» erfasst einen Auftrag «Rüben säen»; er erscheint danach in der Spalte Saat (✓ = erledigt).</p></div>`;
}
function rsOrderView(rec) {
  const need = rsNeed(rec), All = rsSorted(rec), sum = need.reduce((t, x) => t + x.betrag, 0);
  const gl = { std: 'Standard', conv: 'Conviso Smart', cone: 'Herbizid' };
  let lastG = '';
  const tr = x => { const g = x.gruppe === 'conv' ? 'conv' : x.gruppe === 'cone' ? 'cone' : 'std', gh = g !== lastG ? `<tr class="gk"><td colspan="10">${gl[g]}</td></tr>` : ''; lastG = g;
    return gh + `<tr class="${x.total < 0 ? 'vbover' : ''}${x.gruppe === 'conv' ? ' rsconv' : ''}"><td>${esc(x.name)}</td><td class="n">${fmtNum(x.ha)}</td><td class="n">${fmtNum(x.bedarf)}</td>
      <td class="n"><input class="vbin" inputmode="decimal" data-rsin="rest" data-k="${x.key}" data-rsk="r-${x.key}" value="${x.rest || ''}" placeholder="0" title="Restmenge an Lager (Dosen)"></td>
      <td class="n">${x.extra ? fmtNum(x.extra) : ''}</td><td class="n">${fmtNum(x.total)}</td>
      <td class="n"><input class="vbin ${x.manuell ? '' : 'auto'}" inputmode="decimal" data-rsin="best" data-k="${x.key}" data-rsk="b-${x.key}" value="${x.manuell ? x.best : ''}" placeholder="${x.vorschlag}" title="${x.manuell ? 'von Hand (leeren = Vorschlag)' : 'Vorschlag = Total aufgerundet'}"></td>
      <td class="n">${x.pd != null ? chf(x.pd) : '<span class="nr">–</span>'}</td><td class="n"><b>${x.betrag ? chf(x.betrag) : ''}</b></td></tr>`; };
  const ex = rec.extra.map(e => `<tr><th class="vbrh"><input class="vbin wide" data-rsin="exName" data-id="${e.id}" data-rsk="en-${e.id}" value="${esc(e.name || '')}" placeholder="Abnehmer"></th>
      ${All.map(s => `<td class="n"><input class="vbin" inputmode="decimal" data-rsin="exD" data-id="${e.id}" data-s="${s.id}" data-rsk="ed-${e.id}-${s.id}" value="${(e.d || {})[s.id] ?? ''}"></td>`).join('')}
      <td><button type="button" class="x" data-rs="exDel" data-id="${e.id}" aria-label="Entfernen">×</button></td></tr>`).join('');
  return `<div class="panel"><h2>Bestellung ${rec.jahr}</h2>
    <div class="tscroll"><table class="need vbneed rsneed"><thead><tr><th>Sorte</th><th class="n">ha</th><th class="n">Bedarf Dosen</th><th class="n">Restmenge</th><th class="n">Zusätzlich</th><th class="n">Total Bedarf</th><th class="n">Bestellung</th><th class="n">Preis/Dose</th><th class="n">Betrag CHF</th></tr></thead>
      <tbody>${need.map(tr).join('') || '<tr><td colspan="9" class="nr">Noch keine Sorten.</td></tr>'}</tbody>
      <tfoot><tr><th colspan="6">Total Bestellung</th><td class="n"><b>${fmtNum(need.reduce((t, x) => t + (x.key === 'cone' ? 0 : x.best), 0))} Dosen</b></td><td></td><td class="n"><b>${chf(sum)}</b></td></tr></tfoot></table></div>
    <p class="nr">Bedarf = ha × Saatgutverbrauch des Kunden (ohne eigene Werte ${fmtNum(rec.dpha)} Dosen/ha${rec.ueber ? `, inkl. ${fmtNum(r2(rec.ueber * 100))} % Zuschlag für Überlappungen` : ''}; Conviso One: ha × ${fmtNum(rec.cone.faktor ?? 1)}). Total Bedarf = Bedarf − Restmenge + Zusätzlich. Bestellung grau = Vorschlag (aufgerundet), überschreibbar. Preis/Dose = Grundpreis + ${fmtNum(r2((rec.mwst || 0) * 100))} % MwSt + Vertriebskosten.</p></div>
    <div class="panel"><h2>Zusätzliche Abnehmer <small class="nr">Dosen, z.B. Dardel</small></h2>
      ${rec.extra.length ? `<div class="vbmatrix"><table class="vbtab"><thead><tr><th class="vbc">Abnehmer</th>${All.map(s => `<th class="n">${esc(s.name)}</th>`).join('')}<th></th></tr></thead><tbody>${ex}</tbody></table></div>` : '<p class="nr">Keine.</p>'}
      <div class="btns"><button class="btn" data-rs="exAdd">＋ Abnehmer</button></div></div>`;
}
function rsAbrView(rec) {
  const S = rsState(), fk = S.ak || '', fs = S.as || 'alle';
  const all = rsAbr(rec), K = all.filter(k => (!fk || k.r.id === fk) && (fs === 'alle' || (fs === 'offen' ? !k.r.abr : !!k.r.abr)));
  const sum = r2(K.reduce((t, k) => t + k.total, 0)), miss = rec.sorten.filter(s => s.preis == null && rec.rows.some(r => (r.ha || {})[s.id])).map(s => s.name);
  const nOff = all.filter(k => !k.r.abr).length;
  const filt = `<div class="filters" style="margin-bottom:10px">
      <label class="fld" style="margin:0"><span>Kunde</span><select class="input" data-rsin="ak"><option value="">Alle Kunden</option>${rec.rows.slice().sort((a, b) => rsRowName(a).localeCompare(rsRowName(b), 'de')).map(r => `<option value="${r.id}" ${r.id === fk ? 'selected' : ''}>${esc(rsRowName(r))}</option>`).join('')}</select></label>
      <label class="fld" style="margin:0"><span>Abrechnung</span><select class="input" data-rsin="as">${[['alle', 'Alle'], ['offen', 'Nur offene'], ['abgerechnet', 'Nur abgerechnete']].map(([v, l]) => `<option value="${v}" ${v === fs ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="spacer"></span><span class="nr">${all.length - nOff} von ${all.length} abgerechnet</span>
      ${K.length ? `<button class="btn" data-rs="abrPrint">Drucken / PDF</button>` : ''}</div>`;
  const blk = k => { const r = k.r;
    return `<tbody class="${r.abr ? 'rsabr' : ''}"><tr class="gk"><td colspan="5"><b>${esc(rsRowName(r))}</b> <span class="nr">${fmtNum(k.dp)} Dosen/ha${rsRowEigen(r) ? ` (Legeabstand ${fmtNum(r.lege || rec.lege)} cm, ${rsFgLbl(rec, r)})` : ''}</span>
        ${r.abr ? ` <span class="badge verrechnet">✓ abgerechnet ${esc(fmtDate(r.abr, { day: '2-digit', month: '2-digit', year: 'numeric' }))}</span>` : ''}
        ${!k.G.any ? ' <span class="badge offen">noch keine Saat gemeldet</span>' : ''}</td>
        <td class="n"><b>${chf(k.total)}</b></td>
        <td class="n">${r.abr ? `<button type="button" class="btn mini" data-rs="abrMark" data-id="${r.id}" data-v="0">Wieder offen</button>` : `<button type="button" class="btn mini primary" data-rs="abrMark" data-id="${r.id}" data-v="1">✓ Abgerechnet</button>`}</td></tr>
      ${k.pos.map(p => `<tr class="${p.sid && (rec.sorten.find(x => x.id === p.sid) || {}).gruppe === 'conv' ? 'rsconv' : ''}"><td>${esc(p.name)}</td><td class="n nr">${p.cone ? fmtNum(p.geplant) + ' ha' : fmtNum(p.geplant)}</td><td class="n">${p.cone ? '' : (p.ha ? fmtNum(p.ha) : '<span class="nr">–</span>')}</td>
        <td class="n">${p.cone ? `<input class="vbin ${p.manuell ? '' : 'auto'}" inputmode="decimal" data-rsin="coneAbr" data-r="${r.id}" data-rsk="ca-${r.id}" value="${p.manuell ? p.d : ''}" placeholder="${fmtNum(p.d)}" title="${p.manuell ? 'von Hand (leeren = aus der Bestellung)' : 'aus der Bestellung, überschreibbar'}"> <span class="nr">Einh.</span>` : fmtNum(p.d)}</td>
        <td class="n">${p.pd != null ? chf(p.pd) : '–'}</td><td class="n">${p.betrag != null ? chf(p.betrag) : ''}</td><td></td></tr>`).join('')}
      ${k.G.ohne ? `<tr><td colspan="7" class="nr">Zusätzlich ${fmtNum(k.G.ohne)} ha gesät ohne Sorte – Saattermin (Kundennamen unter «Flächen & Saat» antippen) oder Auftrag einer Sorte zuordnen.</td></tr>` : ''}</tbody>`; };
  return `<div class="panel"><h2>Abrechnung ${rec.jahr} <small class="nr">gesäte Fläche × Saatgutverbrauch × Preis pro Dose</small></h2>
    ${filt}
    ${miss.length ? `<p class="warnline">Ohne Preis: ${esc(miss.join(', '))} – unter «Sorten & Preise» erfassen.</p>` : ''}
    <div class="tscroll"><table class="need rskost"><thead><tr><th>Kunde / Sorte</th><th class="n">bestellt ha</th><th class="n">gesät ha</th><th class="n">Dosen</th><th class="n">Preis/Dose</th><th class="n">Betrag CHF</th><th></th></tr></thead>
      ${K.map(blk).join('') || '<tbody><tr><td colspan="7" class="nr">Keine Einträge für diese Auswahl.</td></tr></tbody>'}
      <tfoot><tr><th colspan="5">Total${fk || fs !== 'alle' ? ' (Auswahl)' : ''}</th><td class="n"><b>${chf(sum)}</b></td><td></td></tr></tfoot></table></div>
    <p class="nr">Gesät = Fläche aus «Erledigt melden» der Saataufträge (pro Sorte) und von Hand erfasste Saattermine mit Sorte. Dosen = gesät ha × Saatgutverbrauch des Kunden. Conviso One aus der Bestellung, überschreibbar.</p></div>`;
}
function rsSortenView(rec) {
  const S = rec.sorten, c = rec.cone;
  const korr = rsKorr(rec), dCalc = r2(2e6 / (rec.lege || 17) / 1e5 * korr);
  return `<div class="panel"><h2>Sorten & Preise ${rec.jahr}</h2>
    <div class="tscroll"><table class="need rssort"><thead><tr><th>Sorte</th><th>Gruppe</th><th class="n">Grundpreis CHF</th><th class="n">Vertriebskosten</th><th class="n">Preis/Dose</th><th></th></tr></thead><tbody>
      ${S.map((s, i) => `<tr><td><input class="vbin wide" data-rsin="sName" data-id="${s.id}" data-rsk="sn-${s.id}" value="${esc(s.name)}"></td>
        <td><select class="input small" data-rsin="sGruppe" data-id="${s.id}"><option value="std" ${s.gruppe !== 'conv' ? 'selected' : ''}>Standard</option><option value="conv" ${s.gruppe === 'conv' ? 'selected' : ''}>Conviso Smart</option></select></td>
        <td class="n"><input class="vbin" inputmode="decimal" data-rsin="sPreis" data-id="${s.id}" data-rsk="sp-${s.id}" value="${s.preis ?? ''}"></td>
        <td class="n"><input class="vbin ${s.versand == null ? 'auto' : ''}" inputmode="decimal" data-rsin="sVersand" data-id="${s.id}" data-rsk="sv-${s.id}" value="${s.versand ?? ''}" placeholder="${fmtNum(rec.versand)}"></td>
        <td class="n">${rsPreisDose(rec, s) != null ? chf(rsPreisDose(rec, s)) : '–'}</td>
        <td class="nowrap"><button type="button" class="btn mini" data-rs="sMove" data-id="${s.id}" data-d="-1" ${i ? '' : 'disabled'} title="nach oben">▲</button><button type="button" class="btn mini" data-rs="sMove" data-id="${s.id}" data-d="1" ${i < S.length - 1 ? '' : 'disabled'} title="nach unten">▼</button><button type="button" class="x" data-rs="sDel" data-id="${s.id}" aria-label="Entfernen">×</button></td></tr>`).join('')}
      <tr class="gk"><td colspan="6">Herbizid</td></tr>
      <tr><td><input class="vbin wide" data-rsin="cName" data-rsk="cn" value="${esc(c.name || '')}"></td><td><span class="nr">Einheiten/ha</span> <input class="vbin" inputmode="decimal" data-rsin="cFaktor" data-rsk="cf" value="${c.faktor ?? 1}" style="width:4em"></td>
        <td class="n"><input class="vbin" inputmode="decimal" data-rsin="cPreis" data-rsk="cp" value="${c.preis ?? ''}"></td><td class="n"><input class="vbin" inputmode="decimal" data-rsin="cVersand" data-rsk="cv" value="${c.versand ?? ''}"></td>
        <td class="n">${rsConePreis(rec) != null ? chf(rsConePreis(rec)) : '–'}</td><td></td></tr></tbody></table></div>
    <div class="btns"><button class="btn" data-rs="sortNew">＋ Sorte</button></div></div>
    <div class="panel"><h2>Berechnung</h2>
      <div class="three"><label class="fld"><span>Dosen pro ha (Kunden ohne eigene Werte)</span><input class="input" inputmode="decimal" data-rsin="dpha" data-rsk="dpha" value="${rec.dpha ?? ''}"></label>
        <label class="fld"><span>MwSt %</span><input class="input" inputmode="decimal" data-rsin="mwst" data-rsk="mwst" value="${rec.mwst != null ? r2(rec.mwst * 1000) / 10 : ''}"></label>
        <label class="fld"><span>Vertriebs- und Verwaltungskosten pro Dose CHF</span><input class="input" inputmode="decimal" data-rsin="versand" data-rsk="vers" value="${rec.versand ?? ''}"></label></div>
      <div class="three"><label class="fld"><span>Zuschlag Überlappungen % (alle Kunden ${rec.jahr})</span><input class="input" inputmode="decimal" data-rsin="ueber" data-rsk="ueber" value="${rec.ueber ? r2(rec.ueber * 100) : ''}" placeholder="0"></label></div>
      <p class="nr" style="margin-top:-6px">Wird beim Saatgutverbrauch jedes Kunden dazugerechnet (Dosen/ha × (1 + Zuschlag)) und gilt für Bestellung und Abrechnung.</p>
      <h4 style="margin:12px 0 6px">Dosen pro ha aus Legeabstand und Fahrgassen <small class="nr">Standardwerte; pro Kunde unter «Flächen & Saat»</small></h4>
      <div class="three"><label class="fld"><span>Legeabstand cm (50 cm Reihen)</span><input class="input" inputmode="decimal" data-rsin="lege" data-rsk="lege" value="${rec.lege ?? ''}"></label>
        <label class="fld"><span>Fahrgassenabstand m</span><input class="input" inputmode="decimal" data-rsin="fga" data-rsk="fga" value="${rec.fga ?? ''}"></label>
        <label class="fld"><span>Zuschlag Fahrgasse %</span><input class="input" inputmode="decimal" data-rsin="fgp" data-rsk="fgp" value="${rec.fgp != null ? r2(rec.fgp * 100) : ''}"></label></div>
      <p>${fmtNum(Math.round(2e6 / (rec.lege || 17)))} Körner/ha · Korrekturfaktor Fahrgassen ${fmtNum(r2(korr * 1000) / 1000)} → <b>${fmtNum(dCalc)} Dosen/ha</b> (1 Dose = 100 000 Körner)
        <button type="button" class="btn small" data-rs="dphaCalc" data-v="${dCalc}">Übernehmen</button></p>
      <p class="nr">Formel wie im Blatt «Preisberechnung»: Körner/ha = 2 000 000 / Legeabstand; Faktor = ((FG/3 − 1) × 6 + 4 × Zuschlag + 4) / (FG × 2).</p></div>`;
}
const rsKorrFg = (fg, p) => (((fg / 3 - 1) * 6) + (4 * p + 4)) / (fg * 2);
const rsKorr = rec => rsKorrFg(rec.fga || 21, rec.fgp ?? 0.2);
// Dosen/ha aus Legeabstand (cm, 50-cm-Reihen) und Fahrgassenabstand (m): 2 000 000 / Legeabstand Körner/ha, 1 Dose = 100 000 Körner
const rsCalcDpha = (lege, fga, fgp) => lege ? r2(2e6 / lege / 1e5 * (fga ? rsKorrFg(fga, fgp ?? 0.2) : 1)) : null;
// Saatgutverbrauch pro Kunde: eigene Werte (Legeabstand / Fahrgassenabstand) oder Standard Dosen/ha
const rsRowEigen = r => !!(r && (r.lege || r.fga || r.fga === 0));
// Fahrgassen: Zahl = Abstand in m, 0 (Eingabe «–») = keine Fahrgassen, leer = Standard
const rsFgIn = v => { const t = String(v ?? '').trim(); return /^[-–—]$/.test(t) ? 0 : (rsNum(t) || null); };
const rsFgTxt = v => v === 0 ? '–' : (v ?? '');
const rsFgLbl = (rec, r) => r.fga === 0 ? 'ohne Fahrgassen' : `Fahrgasse ${fmtNum(r.fga || rec.fga)} m`;
const rsRowDphaBasis = (rec, r) => rsRowEigen(r) ? rsCalcDpha(r.lege || rec.lege || 17, r.fga === 0 ? 0 : (r.fga || rec.fga || 21), rec.fgp) : (rec.dpha || 0);
// Saatgutverbrauch inkl. Zuschlag für Überlappungen (gilt im Jahr für alle Kunden; in Bestellung und Abrechnung)
const rsRowDpha = (rec, r) => r2(rsRowDphaBasis(rec, r) * (1 + (rec.ueber || 0)));

/* ---------- Dialoge ---------- */
function rsRowDialog(id) {
  const rec = rsRec(), isNew = !id, r = isNew ? { id: uid(), kunde: '', name: '', ha: {}, cone: null, saat: [], notiz: '' } : structuredClone(rec.rows.find(x => x.id === id));
  if (!r) return;
  const kOpts = Store.all('kunden').filter(k => k.aktiv !== false || k.id === r.kunde).sort(byName).map(k => `<option value="${k.id}" ${k.id === r.kunde ? 'selected' : ''}>${esc(kundeLabel(k))}</option>`).join('');
  const sOpts = cur => `<option value="">— Sorte —</option>` + rsSorted(rec).map(s => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const sl = (x = {}) => `<div class="prow rssl"><input class="input" type="date" name="sd" value="${esc(x.d || '')}"><select class="input" name="ssid">${sOpts(x.sid)}</select><input class="input" name="sha" inputmode="decimal" value="${x.ha ?? ''}" placeholder="ha"><input class="input" name="stxt" value="${esc(x.txt || '')}" placeholder="Bemerkung"><button type="button" class="x" data-rs="slDel" aria-label="Entfernen">×</button></div>`;
  if (isNew) { const pv = rsGet(rec.jahr - 1); r._pv = pv; }
  const O = isNew ? [] : rsOrders(rec, r);
  const body = `<label class="fld"><span>Kunde</span><select class="input" name="kunde" data-combo><option value="">— ohne Zuordnung —</option>${kOpts}</select></label>
    ${!r.kunde ? `<label class="fld"><span>Bezeichnung (ohne Kunde)${r.name ? ' – aus der Excel-Tabelle' : ''}</span><input class="input" name="name" value="${esc(r.name || '')}"></label>` : ''}
    <div class="three"><label class="fld"><span>Legeabstand cm</span><input class="input" name="lege" inputmode="decimal" value="${r.lege ?? ''}" placeholder="${fmtNum(rec.lege)} (Standard)"></label>
      <label class="fld"><span>Fahrgassenabstand m</span><input class="input" name="fga" value="${rsFgTxt(r.fga)}" placeholder="${fmtNum(rec.fga)} (Standard) · – = keine"></label>
      <label class="fld"><span>Saatgutverbrauch${rec.ueber ? ` <small class="nr">inkl. ${fmtNum(r2(rec.ueber * 100))} % Überlappung</small>` : ''}</span><input class="input" readonly value="${fmtNum(rsRowDpha(rec, r))} Dosen/ha" tabindex="-1"></label></div>
    <label class="fld"><span>Bemerkung</span><input class="input" name="notiz" value="${esc(r.notiz || '')}"></label>
    ${O.length ? `<h4 style="margin:10px 0 4px">Saataufträge</h4><div class="rssaatc">${rsSaatHtml(rec, { ...r, saat: [] })}</div>` : ''}
    <h4 style="margin:10px 0 4px">Saattermine von Hand</h4><div class="rssll">${(r.saat || []).map(sl).join('')}</div>
    <button type="button" class="btn small" data-rs="slAdd">＋ Termin</button>`;
  Dlg.open(isNew ? 'Kunde hinzufügen' : 'Rübensamen – Kunde', body, saveFooter(isNew ? '' : `<button type="button" class="btn danger" data-rs="rowDel" data-id="${r.id}">Entfernen</button>`), fd => {
    const rr = rsRec(), k = fd.get('kunde') || '';
    if (k && rr.rows.some(x => x.kunde === k && x.id !== r.id)) { toast('Dieser Kunde ist schon in der Liste.'); return false; }
    r.kunde = k; r.name = k ? (r.name || '') : (fd.get('name') || r.name || '').trim(); r.notiz = (fd.get('notiz') || '').trim();
    if (!k && !r.name) { toast('Kunde wählen oder Bezeichnung eingeben.'); return false; }
    r.saat = $$('.rssl', Dlg.form).map(l => ({ d: l.querySelector('[name=sd]').value || '', sid: l.querySelector('[name=ssid]').value || '', ha: rsNum(l.querySelector('[name=sha]').value), txt: l.querySelector('[name=stxt]').value.trim() })).filter(x => x.d || x.ha || x.txt);
    r.lege = rsNum(fd.get('lege')); r.fga = rsFgIn(fd.get('fga'));
    // neuer Kunde: Lege- und Fahrgassenabstand aus dem Vorjahr übernehmen
    if (isNew && k && r.lege == null && r.fga == null) { const pr = (rsGet(rr.jahr - 1)?.rows || []).find(x => x.kunde === k); if (pr) { r.lege = pr.lege ?? null; r.fga = pr.fga ?? null; } }
    delete r._pv;
    const i = rr.rows.findIndex(x => x.id === r.id); if (i >= 0) rr.rows[i] = r; else rr.rows.push(r);
    rr.rows.sort((a, b) => rsRowName(a).localeCompare(rsRowName(b), 'de'));
    rsSave(rr); return true;
  });
  Dlg.rsSl = sl;
}
function rsSortDialog() {
  const body = `<label class="fld"><span>Sorte</span><input class="input" name="name" required autofocus placeholder="z.B. Beppina"></label>
    <div class="two"><label class="fld"><span>Gruppe</span><select class="input" name="gruppe"><option value="std">Standard</option><option value="conv">Conviso Smart</option></select></label>
      <label class="fld"><span>Grundpreis CHF pro Dose</span><input class="input" name="preis" inputmode="decimal"></label></div>`;
  Dlg.open('Sorte hinzufügen', body, saveFooter(''), fd => {
    const rr = rsRec(), name = (fd.get('name') || '').trim(); if (!name) return false;
    if (rr.sorten.some(s => norm(s.name) === norm(name))) { toast('Diese Sorte gibt es schon.'); return false; }
    rr.sorten.push({ id: uid(), name, gruppe: fd.get('gruppe') === 'conv' ? 'conv' : 'std', preis: rsNum(fd.get('preis')), versand: null });
    rsSave(rr); return true;
  });
}
function rsFromPrev() {
  const y = rsYear(), prev = rsGet(y - 1); if (!prev) return;
  const body = `<p style="margin-top:0">Übernimmt Sorten, Preise, Einstellungen und die Kunden aus ${y - 1}.</p>
    <label class="tog"><input type="checkbox" name="fl"> Flächen aus ${y - 1} als Vorschlag übernehmen</label>`;
  Dlg.open(`Rübensamen ${y} aus ${y - 1}`, body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Übernehmen</button>`, fd => {
    const r = structuredClone(prev); r.id = rsId(y); r.jahr = y; r.rest = {}; r.best = {}; r.extra = r.extra.map(e => ({ ...e, d: {} }));
    r.rows = r.rows.map(x => ({ ...x, id: uid(), saat: [], notiz: '', cone: fd.get('fl') ? x.cone : null, ha: fd.get('fl') ? { ...x.ha } : {} }));
    rsSave(r); toast(`Rübensamen ${y} angelegt`); return true;
  });
}
function rsOrderNew(rid) {
  const rec = rsRec(), r = rec.rows.find(x => x.id === rid); if (!r) return;
  if (!r.kunde) { toast('Zuerst einen Kunden zuordnen (Kundennamen antippen).'); return; }
  const arbeit = Lists.arbeitsarten().find(a => /rüben\s*s[äa]/i.test(a)) || Lists.arbeitsarten().find(a => /s[äa]en|saat/i.test(a)) || 'Säen';
  const kultur = Lists.kulturen().find(k => /zuckerr/i.test(k)) || Lists.kulturen().find(k => /rübe/i.test(k)) || 'Zuckerrüben';
  const rsSorten = rsVorschlag(rec, r), ha = r2(rsSorten.reduce((t, x) => t + (x.ha || 0), 0)) || null;
  orderDialog(null, { kunde: r.kunde, arbeit, vorlage: { kultur, flaeche: ha, erntejahr: rec.jahr, rsRef: rsRef(rec, r), rsSorten, titel: 'Saatauftrag Rüben' } });
}

/* ---------- Druck & Excel ---------- */
function rsPrint() {
  const rec = rsRec(), need = rsNeed(rec), All = rsSorted(rec), sum = need.reduce((t, x) => t + x.betrag, 0);
  const order = `<h2>Bestellung</h2><table class="btab"><thead><tr><th>Sorte</th><th class="n">ha</th><th class="n">Bedarf</th><th class="n">Restmenge</th><th class="n">Zusätzlich</th><th class="n">Total</th><th class="n">Bestellung</th><th class="n">Preis/Dose</th><th class="n">Betrag CHF</th></tr></thead><tbody>
    ${need.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${fmtNum(x.ha)}</td><td class="n">${fmtNum(x.bedarf)}</td><td class="n">${x.rest ? fmtNum(x.rest) : ''}</td><td class="n">${x.extra ? fmtNum(x.extra) : ''}</td><td class="n">${fmtNum(x.total)}</td><td class="n"><b>${fmtNum(x.best)}</b></td><td class="n">${x.pd != null ? chf(x.pd) : ''}</td><td class="n">${x.betrag ? chf(x.betrag) : ''}</td></tr>`).join('')}
    <tr class="gp"><td colspan="8"><b>Total</b></td><td class="n"><b>${chf(sum)}</b></td></tr></tbody></table>
    ${rec.extra.length ? `<p>Zusätzlich: ${rec.extra.map(e => `${esc(e.name)} (${All.filter(s => (e.d || {})[s.id]).map(s => `${esc(s.name)} ${fmtNum(e.d[s.id])}`).join(', ')})`).join('; ')}</p>` : ''}`;
  const area = `<h2 style="break-before:page">Flächen ${rec.jahr} (ha) · ${fmtNum(rec.dpha)} Dosen/ha</h2><table class="btab"><thead><tr><th>Kunde</th><th class="n">Dosen/ha</th>${All.map(s => `<th class="n">${esc(s.name)}</th>`).join('')}<th class="n">Total</th><th class="n">${esc(rec.cone.name || 'Conviso One')}</th><th>Saat</th></tr></thead><tbody>
    ${rec.rows.map(r => `<tr><td>${esc(rsRowName(r))}</td><td class="n">${fmtNum(rsRowDpha(rec, r))}</td>${All.map(s => `<td class="n">${fmtNum((r.ha || {})[s.id]) || ''}</td>`).join('')}<td class="n">${fmtNum(rsRowHa(rec, r))}</td><td class="n">${fmtNum(rsRowCone(rec, r)) || ''}</td><td>${rsSaatHtml(rec, r).replace(/<[^>]+>/g, ' ')}</td></tr>`).join('')}
    <tr class="gp"><td><b>Total</b></td><td></td>${All.map(s => `<td class="n"><b>${fmtNum(need.find(x => x.key === s.id)?.ha)}</b></td>`).join('')}<td class="n"><b>${fmtNum(r2(rec.rows.reduce((t, r) => t + rsRowHa(rec, r), 0)))}</b></td><td class="n"><b>${fmtNum(need.find(x => x.key === 'cone')?.ha) || ''}</b></td><td></td></tr></tbody></table>`;
  printHtml(`Rübensamen ${rec.jahr}`, LETTERHEAD + `<h1 class="ptitle">Saatgutbestellung Zuckerrüben ${rec.jahr}</h1>` + order + area, { noTitle: true });
}
function rsXlsx() {
  const rec = rsRec(), need = rsNeed(rec), All = rsSorted(rec);
  const fl = [['Kunde', 'Legeabstand cm', 'Fahrgasse m', 'Dosen/ha', ...All.map(s => s.name), 'Total ha', rec.cone.name || 'Conviso One', 'Saat', 'Bemerkung'], ...rec.rows.map(r => [rsRowName(r), r.lege ?? '', rsFgTxt(r.fga), rsRowDpha(rec, r), ...All.map(s => (r.ha || {})[s.id] ?? ''), rsRowHa(rec, r), rsRowCone(rec, r) || '', rsSaatHtml(rec, r).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), r.notiz || ''])];
  fl.push(['Total', '', '', '', ...All.map(s => need.find(x => x.key === s.id)?.ha ?? ''), r2(rec.rows.reduce((t, r) => t + rsRowHa(rec, r), 0)), need.find(x => x.key === 'cone')?.ha ?? '']);
  const be = [['Sorte', 'Gruppe', 'ha', 'Bedarf Dosen', 'Restmenge', 'Zusätzlich', 'Total Bedarf', 'Bestellung', 'Preis/Dose CHF', 'Betrag CHF'], ...need.map(x => [x.name, x.gruppe === 'conv' ? 'Conviso Smart' : x.gruppe === 'cone' ? 'Herbizid' : 'Standard', x.ha, x.bedarf, x.rest || '', x.extra || '', x.total, x.best, x.pd ?? '', x.betrag || ''])];
  const ko = [['Kunde', 'Dosen/ha', 'Sorte', 'bestellt ha', 'gesät ha', 'Dosen', 'Preis/Dose CHF', 'Betrag CHF', 'Abgerechnet']]; rsAbr(rec).forEach(k => k.pos.forEach(p => ko.push([rsRowName(k.r), k.dp, p.name, p.geplant, p.ha ?? '', p.d, p.pd ?? '', p.betrag ?? '', k.r.abr || ''])));
  download(`Ruebensamen_${rec.jahr}.xlsx`, xlsxBlob([{ name: `Bestellung ${rec.jahr}`, rows: be }, { name: `Flächen ${rec.jahr}`, rows: fl }, { name: 'Abrechnung', rows: ko }]));
}

/* ---------- Excel «Bestellung Rübensamen» einlesen (Blätter «2026», «2025», … und «Preisberechnung Rübensamen 2026») ---------- */
const rsSortKey = s => norm(s).replace(/\b(smart|kws|bts)\b/g, ' ').replace(/[^a-z0-9äöü]/g, '');
function rsLev(a, b) { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
const rsSameSort = (a, b) => { const x = rsSortKey(a), y = rsSortKey(b); return !!x && !!y && (x === y || (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x))) || (x.length > 5 && rsLev(x, y) <= 2)); };
function rsXlDate(v, y) {
  if (typeof v === 'number' && v > 30000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return { d: d.toISOString().slice(0, 10), txt: '' }; }
  const s = String(v ?? '').trim(), m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s*(.*)$/.exec(s);
  if (m) { const yy = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : y; return { d: `${yy}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`, txt: m[4].trim() }; }
  return s ? { d: '', txt: s } : null;
}
function rsMatchKunde(name) {
  const parts = norm(name).split(/[\s/(,]+/).filter(Boolean); if (!parts.length) return null;
  const K = Store.all('kunden').filter(k => k.aktiv !== false);
  const full = K.filter(k => parts.every(p => norm(k.name).includes(p))); if (full.length === 1) return full[0];
  const sur = K.filter(k => norm(k.name).split(/[\s-]/)[0] === parts[0]); if (sur.length === 1) return sur[0];
  const two = sur.filter(k => parts[1] && norm(k.name).includes(parts[1].slice(0, 3))); return two.length === 1 ? two[0] : null;
}
function rsParseYear(book, y) {
  const R = book[String(y)]; if (!R) return null;
  const cell = (r, c) => (R[r] || [])[c];
  const rows = R.length, findRow = re => { for (let i = 0; i < rows; i++) if (R[i] && typeof R[i][0] === 'string' && re.test(R[i][0].trim())) return i; return -1; };
  const rec = rsBlank(y); rec.sorten = []; rec.cone = { name: 'Conviso One', preis: null, versand: 5, faktor: 1 };
  const dr = findRow(/^Dosen\/ha/i); if (dr >= 0) { const v = (R[dr] || []).find((x, i) => i > 0 && typeof x === 'number'); if (v) rec.dpha = v; }
  const tr = findRow(/^Total$/i); if (tr < 0) return null;
  // erste Kundenzeile: nach der letzten Kopfzeile oberhalb von «Total», die Text in den Spalten rechts der Namen enthält
  let h = -1; for (let i = (dr >= 0 ? dr + 1 : 0); i < tr; i++) { const r = R[i] || []; const txt = r.slice(1).filter(x => typeof x === 'string' && x.trim() && !/^=/.test(x)).length; if (txt >= 1 && !(typeof r[0] === 'string' && r[0].trim() && r.slice(1).some(x => typeof x === 'number'))) h = i; else if (h >= 0) break; }
  if (h < 0) return null;
  const hdr = R[h] || [], grp = h > 0 ? (R[h - 1] || []) : [];
  const grpAt = c => { for (let i = c; i >= 0; i--) if (typeof grp[i] === 'string' && grp[i].trim()) return grp[i]; return ''; };
  const sCols = [], dCols = []; let coneCol = -1;
  const maxC = Math.max(hdr.length, grp.length);
  let nachSorten = false; // Sorten stehen links; ab Conviso One / Datum folgen nur noch Saat- und Nebenspalten
  for (let c = 1; c < maxC; c++) {
    const a = typeof hdr[c] === 'string' ? hdr[c].trim() : '', g = typeof grp[c] === 'string' ? grp[c].trim() : '';
    if (/datum/i.test(a) || /datum/i.test(g)) { dCols.push(c); nachSorten = true; continue; }
    if (/^fläche|^flächen$|^dosen$/i.test(a) || /^fläche|^dosen$/i.test(g)) { if (c > 1) nachSorten = true; continue; }
    if (/one/i.test(g) && !a) { coneCol = c; nachSorten = true; continue; }
    if (a && !nachSorten && !/^flächen$/i.test(a)) { const name = a.replace(/-\s+/g, '').replace(/\s+/g, ' '); sCols.push({ c, s: { id: uid(), name, gruppe: /conv/i.test(grpAt(c)) ? 'conv' : 'std', preis: null, versand: null } }); }
  }
  if (!sCols.length) return null;
  rec.sorten = sCols.map(x => x.s);
  const val = (r, c) => { const v = cell(r, c); return typeof v === 'number' ? v : null; };
  for (let i = h + 1; i < tr; i++) {
    const nm = cell(i, 0); if (typeof nm !== 'string' || !nm.trim()) continue;
    const ha = {}, notes = []; sCols.forEach(({ c, s }) => { const v = cell(i, c); if (typeof v === 'number' && v) ha[s.id] = r2(v); else if (typeof v === 'string' && v.trim() && !/^\s*$/.test(v)) notes.push(`${s.name}: ${v.trim()}`); });
    const cone = coneCol >= 0 ? val(i, coneCol) : null;
    const saat = []; dCols.forEach(c => { const dv = cell(i, c); if (dv == null || dv === '') return; const x = rsXlDate(dv, y); if (!x) return; const f = val(i, c + 1); saat.push({ d: x.d, ha: f, txt: x.txt }); });
    if (!Object.keys(ha).length && cone == null && !saat.length && !notes.length) continue;
    const k = rsMatchKunde(nm);
    const ks = Object.keys(ha); if (ks.length === 1) saat.forEach(x => { x.sid = ks[0]; });
    rec.rows.push({ id: uid(), kunde: k ? k.id : '', name: nm.trim(), ha, cone: cone != null ? r2(cone) : null, saat, notiz: notes.join(' · ') });
  }
  // Conviso One wie in der Tabelle: gleich der Conviso-Fläche → automatisch, sonst fester Wert (leer = 0)
  if (coneCol >= 0) rec.rows.forEach(r => { const cv = rsRowConvHa(rec, r), v = r.cone ?? 0; r.cone = Math.abs(v - cv) < 0.005 ? null : v; });
  const rowVals = (re, into, key) => { const i = findRow(re); if (i < 0) return; sCols.forEach(({ c, s }) => { const v = val(i, c); if (v != null && v !== 0) into[s.id] = r2(v); }); if (key && coneCol >= 0) { const v = val(i, coneCol); if (v != null && v !== 0) into.cone = r2(v); } };
  rowVals(/^Restmenge/i, rec.rest, true);
  const di = findRow(/^Dardel/i); if (di >= 0) { const d = {}; sCols.forEach(({ c, s }) => { const v = val(di, c); if (v) d[s.id] = v; }); if (Object.keys(d).length) rec.extra.push({ id: uid(), name: 'Dardel', d }); }
  const bi = findRow(/^Bestellung/i); if (bi >= 0) { sCols.forEach(({ c, s }) => { const v = val(bi, c); if (v != null && Math.abs(v - Math.round(v)) < 1e-6) rec.best[s.id] = Math.round(v); }); if (coneCol >= 0) { const v = val(bi, coneCol); if (v != null && Math.abs(v - Math.round(v)) < 1e-6) rec.best.cone = Math.round(v); } }
  rec.rows.sort((a, b) => rsRowName(a).localeCompare(rsRowName(b), 'de'));
  return rec;
}
function rsParsePrices(R) { // Preisberechnung: MwSt, Vertriebskosten, Zeilen Sorte | Anzahl | Grundpreis | … | Versand
  const out = { mwst: null, versand: null, L: [] }; let hr = -1;
  R.forEach((r, i) => { if (!r) return; if (typeof r[0] === 'string' && /mwst/i.test(r[0]) && typeof r[1] === 'number') out.mwst = r[1]; const vi = r.findIndex(x => typeof x === 'string' && /vertrieb/i.test(x)); if (vi >= 0) { const v = r.slice(vi + 1).find(x => typeof x === 'number'); if (v != null) out.versand = v; } if (r.some(x => typeof x === 'string' && /grundpreis/i.test(x))) hr = i; });
  if (hr < 0) return out;
  const H = R[hr], ci = re => H.findIndex(x => typeof x === 'string' && re.test(x)), cA = ci(/anzahl/i), cP = ci(/grundpreis/i), cV = ci(/versand/i);
  for (let i = hr + 1; i < R.length; i++) { const r = R[i]; if (!r || typeof r[0] !== 'string' || !r[0].trim()) continue; const p = typeof r[cP] === 'number' ? r[cP] : null; if (p == null) continue; out.L.push({ name: r[0].trim(), anzahl: typeof r[cA] === 'number' ? r[cA] : null, preis: p, versand: cV >= 0 && typeof r[cV] === 'number' ? r[cV] : null }); }
  return out;
}
function rsApplyPrices(rec, P) {
  if (P.mwst != null) rec.mwst = P.mwst; if (P.versand != null) rec.versand = P.versand;
  P.L.forEach(x => {
    if (/convis/i.test(x.name) && !rec.sorten.some(s => rsSameSort(s.name, x.name))) { rec.cone.preis = x.preis; rec.cone.versand = x.versand ?? rec.cone.versand; if (x.anzahl != null && rec.best.cone == null) rec.best.cone = x.anzahl; return; }
    const s = rec.sorten.find(s => rsSameSort(s.name, x.name)); if (!s) return;
    s.preis = x.preis; if (x.versand != null && x.versand !== rec.versand) s.versand = x.versand;
    if (x.anzahl != null && rec.best[s.id] == null) rec.best[s.id] = x.anzahl;
  });
}
async function rsImportFile(file) {
  let book; try { book = await xlsxRead(await file.arrayBuffer()); } catch (e) { toast('Datei konnte nicht gelesen werden: ' + e.message, 5000); return; }
  const years = Object.keys(book).map(n => (/^(\d{4})$/.exec(n.trim()) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a);
  if (!years.length) { toast('Keine Jahresblätter («2026», «2025», …) gefunden.', 5000); return; }
  const body = `<p style="margin-top:0">Gefundene Jahre in «${esc(file.name)}». Welche sollen übernommen werden?</p>
    <div class="chips">${years.map(y => `<label><input type="checkbox" name="y" value="${y}" ${y >= years[0] - 1 ? 'checked' : ''}><span>${y}${rsGet(y) ? ' (ersetzt)' : ''}</span></label>`).join('')}</div>
    <p class="nr">Übernommen werden Sorten, Flächen pro Kunde, Conviso One, Saattermine, Dosen/ha, Restmenge, Dardel, Bestellung und – aus «Preisberechnung Rübensamen &lt;Jahr&gt;» – die Preise. Excel-Namen werden den Kunden zugeordnet (Nachname); nicht zugeordnete sind mit ? markiert und lassen sich durch Antippen zuordnen.</p>`;
  Dlg.open('Rübensamen – Excel importieren', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Importieren</button>`, fd => {
    const ys = fd.getAll('y').map(Number); if (!ys.length) { toast('Mindestens ein Jahr wählen.'); return false; }
    // Preisblätter: «Preisberechnung Rübensamen 2026»; eines ohne Jahr wird dem Jahr mit den meisten gleichen Sorten zugeordnet
    const recs = ys.map(y => rsParseYear(book, y)).filter(Boolean), priced = new Set();
    recs.forEach(rec => { const n = Object.keys(book).find(k => new RegExp(`preis.*${rec.jahr}`, 'i').test(k)); if (n) { rsApplyPrices(rec, rsParsePrices(book[n])); priced.add(rec.jahr); } });
    Object.keys(book).filter(k => /^preis/i.test(k) && !/\d{4}/.test(k)).forEach(k => {
      const P = rsParsePrices(book[k]); let best = null, bs = 0;
      recs.filter(r => !priced.has(r.jahr)).forEach(r => { const sc = P.L.filter(x => r.sorten.some(s => rsSameSort(s.name, x.name))).length; if (sc > bs) { bs = sc; best = r; } });
      if (best && bs >= 2) { rsApplyPrices(best, P); priced.add(best.jahr); }
    });
    if (!recs.length) { toast('In den gewählten Blättern wurde nichts erkannt.', 5000); return false; }
    Store.putMany('einstellungen', recs.map(r => structuredClone(r)));
    const S = rsState(); S.y = Math.max(...recs.map(r => r.jahr)); S.sub = 'flaechen';
    const offen = recs.reduce((t, r) => t + r.rows.filter(x => !x.kunde).length, 0);
    setTimeout(() => { App.render(); toast(`${recs.length} ${recs.length === 1 ? 'Jahr' : 'Jahre'} importiert${offen ? ` · ${offen} Namen ohne Kundenzuordnung (?)` : ''}`, 5000); }, 0);
    return true;
  });
}

/* ---------- Saisonmodul ein-/ausschalten (Mehr › Einstellungen) ---------- */
function rsPanel() {
  return `<div class="panel"><h2>Saisonmodule</h2>
    <label class="tog"><input type="checkbox" data-rsin="on" ${rsOn() ? 'checked' : ''}> Rübensamen (Saatgutbestellung Zuckerrüben) in der Navigation anzeigen</label>
    <p class="nr" style="margin:6px 0 0">Nur während der Bestell- und Saatzeit einschalten. Ausgeschaltet bleiben alle Daten gespeichert. Gilt für alle Geräte.</p></div>`;
}
function rsNav() {
  const b = $('#tabs [data-view="rueben"]'); if (b) b.hidden = !rsOn();
  const t = $('#tabs'); if (t) t.style.setProperty('--n', $$('#tabs button:not([hidden])').length);
}

/* ---------- Ereignisse ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-rs]'); if (!t) return;
  const a = t.dataset.rs, id = t.dataset.id; e.preventDefault();
  const rec = () => rsRec();
  switch (a) {
    case 'sub': { const S = rsState(); S.sub = t.dataset.v; ls('lp_rsSub', S.sub); App.render(); break; }
    case 'start': { const r = rsBlank(rsYear()); rsSave(r); rsState().sub = 'sorten'; break; }
    case 'fromPrev': rsFromPrev(); break;
    case 'off': if (confirm('Modul «Rübensamen» ausblenden? Die Daten bleiben gespeichert; einschalten unter Mehr › Einstellungen › Saisonmodule.')) { Store.setCfg({ rsOn: false }); App.go('auftraege'); } break;
    case 'rowNew': rsRowDialog(null); break;
    case 'rowEdit': rsRowDialog(id); break;
    case 'rowDel': { const r = rec(); const row = r.rows.find(x => x.id === id); if (row && confirm(`«${rsRowName(row)}» aus der Liste entfernen?`)) { r.rows = r.rows.filter(x => x.id !== id); rsSave(r); Dlg.close(); } break; }
    case 'slAdd': { const box = $('.rssll', Dlg.form); if (box && Dlg.rsSl) box.insertAdjacentHTML('beforeend', Dlg.rsSl({})); break; }
    case 'slDel': t.closest('.rssl')?.remove(); break;
    case 'mkOrder': rsOrderNew(id); break;
    case 'sortNew': rsSortDialog(); break;
    case 'sDel': { const r = rec(), s = r.sorten.find(x => x.id === id); if (!s) break; const used = r.rows.some(x => (x.ha || {})[id]); if (!confirm(`Sorte «${s.name}» entfernen?${used ? ' Die erfassten Flächen dieser Sorte gehen verloren.' : ''}`)) break; r.sorten = r.sorten.filter(x => x.id !== id); r.rows.forEach(x => { if (x.ha) delete x.ha[id]; }); delete r.rest[id]; delete r.best[id]; rsSave(r); break; }
    case 'sMove': { const r = rec(), i = r.sorten.findIndex(x => x.id === id), j = i + +t.dataset.d; if (i < 0 || j < 0 || j >= r.sorten.length) break; [r.sorten[i], r.sorten[j]] = [r.sorten[j], r.sorten[i]]; rsSave(r); break; }
    case 'exAdd': { const r = rec(); r.extra.push({ id: uid(), name: r.extra.length ? '' : 'Dardel', d: {} }); rsSave(r); break; }
    case 'exDel': { const r = rec(); r.extra = r.extra.filter(x => x.id !== id); rsSave(r); break; }
    case 'dphaCalc': { const r = rec(); r.dpha = +t.dataset.v; rsSave(r); toast(`Dosen/ha = ${fmtNum(r.dpha)}`); break; }
    case 'print': rsPrint(); break;
    case 'fahrer': rsFahrerPrint(); break;
    case 'abrPrint': rsAbrPrint(); break;
    case 'abrMark': { const r = rec(), row = r.rows.find(x => x.id === id); if (!row) break; if (t.dataset.v === '1') row.abr = todayIso(); else delete row.abr; rsSave(r); toast(t.dataset.v === '1' ? 'Als abgerechnet markiert' : 'Wieder offen'); break; }
    case 'xlsx': rsXlsx(); break;
  }
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-rsin]'); if (!t) return;
  const k = t.dataset.rsin, v = t.value;
  if (k === 'on') { Store.setCfg({ rsOn: t.checked }); rsNav(); toast(t.checked ? 'Modul «Rübensamen» eingeschaltet' : 'Modul «Rübensamen» ausgeblendet'); return; }
  if (k === 'import') { const f = t.files && t.files[0]; t.value = ''; if (f) rsImportFile(f); return; }
  if (k === 'year') { rsState().y = +v; App.render(); return; }
  if (k === 'ak' || k === 'as') { rsState()[k] = v; App.render(); return; }
  const r = rsRec(), n = rsNum(v);
  switch (k) {
    case 'ha': { const row = r.rows.find(x => x.id === t.dataset.r); if (!row) return; row.ha = row.ha || {}; if (n) row.ha[t.dataset.s] = n; else delete row.ha[t.dataset.s]; break; }
    case 'cone': { const row = r.rows.find(x => x.id === t.dataset.r); if (!row) return; row.cone = v.trim() === '' ? null : n; break; }
    case 'coneAbr': { const row = r.rows.find(x => x.id === t.dataset.r); if (!row) return; row.coneAbr = v.trim() === '' ? null : n; break; }
    case 'rest': if (n) r.rest[t.dataset.k] = n; else delete r.rest[t.dataset.k]; break;
    case 'best': if (v.trim() === '') delete r.best[t.dataset.k]; else if (n != null) r.best[t.dataset.k] = n; break;
    case 'exName': { const x = r.extra.find(x => x.id === t.dataset.id); if (x) x.name = v.trim(); break; }
    case 'exD': { const x = r.extra.find(x => x.id === t.dataset.id); if (!x) return; x.d = x.d || {}; if (n) x.d[t.dataset.s] = n; else delete x.d[t.dataset.s]; break; }
    case 'sName': { const s = r.sorten.find(x => x.id === t.dataset.id); if (s && v.trim()) s.name = v.trim(); break; }
    case 'sGruppe': { const s = r.sorten.find(x => x.id === t.dataset.id); if (s) s.gruppe = v === 'conv' ? 'conv' : 'std'; break; }
    case 'sPreis': { const s = r.sorten.find(x => x.id === t.dataset.id); if (s) s.preis = n; break; }
    case 'sVersand': { const s = r.sorten.find(x => x.id === t.dataset.id); if (s) s.versand = v.trim() === '' ? null : n; break; }
    case 'cName': r.cone.name = v.trim() || 'Conviso One'; break;
    case 'cFaktor': r.cone.faktor = n ?? 1; break;
    case 'cPreis': r.cone.preis = n; break;
    case 'cVersand': r.cone.versand = n ?? 0; break;
    case 'dpha': if (n) r.dpha = n; break;
    case 'mwst': r.mwst = n != null ? n / 100 : 0; break;
    case 'versand': r.versand = n ?? 0; break;
    case 'lege': case 'fga': { if (t.dataset.r) { const row = r.rows.find(x => x.id === t.dataset.r); if (!row) return; row[k] = k === 'fga' ? rsFgIn(v) : (n || null); } else if (n) r[k] = n; break; }
    case 'fgp': r.fgp = n != null ? n / 100 : 0; break;
    case 'ueber': r.ueber = n != null ? n / 100 : 0; break;
    default: return;
  }
  rsSave(r);
});

/* ---------- Saatauftrag: Sorten aus der Bestellung vorschlagen, gesäte Fläche pro Sorte melden ---------- */
const isRsSaatName = (arbeit, kultur) => /rüben\s*s[äa]|rübensaat/i.test(arbeit || '') || (/s[äa]en|saat/i.test(arbeit || '') && /rübe/i.test(kultur || ''));
const isRsSaat = a => !!a && ((a.rsSorten || []).length > 0 || isRsSaatName(a.arbeit, a.kultur));
const rsJahrOf = a => a.rsRef ? +a.rsRef.split('|')[0] : (rsGet(rsDefYear()) ? rsDefYear() : (rsYears()[0] || rsDefYear()));
const rsRowOfKunde = (rec, kid) => rec && kid ? rec.rows.find(r => r.kunde === kid) : null;
// Vorschlag: bestellte Fläche pro Sorte abzüglich der in anderen Saataufträgen schon eingeplanten
function rsVorschlag(rec, r, ohne) {
  const used = {}; rsOrders(rec, r).filter(a => a.id !== ohne).forEach(a => (a.rsSorten || []).forEach(x => { used[x.sid] = (used[x.sid] || 0) + (x.ha || 0); }));
  return rsSorted(rec).filter(s => (r.ha || {})[s.id]).map(s => ({ sid: s.id, name: s.name, ha: r2(Math.max(0, r.ha[s.id] - (used[s.id] || 0))) })).filter(x => x.ha > 0);
}
function rsSeedBox(a) {
  const show = rsOn() && isRsSaat(a), y = rsJahrOf(a), rec = rsGet(y);
  const L = (a.rsSorten || []).length ? a.rsSorten : [];
  return `<div class="box spraybox rsseed" id="rsSeedBox" ${show ? '' : 'hidden'} data-y="${y}">
    <h4>🌱 Rübensaat <small class="nr">Sorten aus Rübensamen ${y}</small></h4>
    <div id="rsSeedRows">${(L.length ? L : []).map(x => rsSeedRow(rec, x)).join('')}</div>
    <div class="links" style="margin-top:4px"><a href="#" data-rs="seedAdd">＋ Sorte</a><a href="#" data-rs="seedSuggest">Vorschlag aus der Bestellung</a></div>
    <div class="nr" id="rsSeedHint"></div></div>`;
}
function rsSeedRow(rec, x = {}) {
  const S = rec ? rsSorted(rec) : [];
  return `<div class="rsseedrow"><select class="input" name="rsSid"><option value="">— Sorte —</option>${S.map(s => `<option value="${s.id}" ${s.id === x.sid ? 'selected' : ''}>${esc(s.name)}${s.gruppe === 'conv' ? ' (Conviso)' : ''}</option>`).join('')}${x.sid && !S.some(s => s.id === x.sid) ? `<option value="${esc(x.sid)}" selected>${esc(x.name || '?')}</option>` : ''}</select>
    <input class="input" name="rsHa" inputmode="decimal" value="${x.ha ?? ''}" placeholder="ha"><span class="u">ha</span><button type="button" class="x" data-rs="seedDel" aria-label="Entfernen">×</button></div>`;
}
function readRsSeed(f, a) {
  const box = $('#rsSeedBox', f); if (!box || box.hidden) return null;
  const y = +box.dataset.y, rec = rsGet(y);
  const L = $$('.rsseedrow', box).map(r => { const sid = r.querySelector('[name=rsSid]').value, ha = rsNum(r.querySelector('[name=rsHa]').value); if (!sid) return null; const s = rec && rec.sorten.find(x => x.id === sid); return { sid, name: s ? s.name : sid, ha }; }).filter(Boolean);
  const k = findKunde(f.kunde.value), row = rsRowOfKunde(rec, k && k.id);
  return { rsSorten: L, rsRef: row ? rsRef(rec, row) : (a.rsRef || '') };
}
function wireRsSeed(f, a) {
  const box = $('#rsSeedBox', f); if (!box) return;
  const rows = $('#rsSeedRows', box), hint = $('#rsSeedHint', box);
  const rec = () => rsGet(+box.dataset.y);
  const sum = () => r2($$('.rsseedrow', box).reduce((t, r) => t + (rsNum(r.querySelector('[name=rsHa]').value) || 0), 0));
  let touched = (a.rsSorten || []).length > 0, flAuto = !f.flaeche.value || (a.rsSorten || []).length > 0;
  const suggest = force => {
    const R = rec(), k = findKunde(f.kunde.value), row = rsRowOfKunde(R, k && k.id);
    if (!R) { hint.textContent = `Für ${box.dataset.y} ist im Modul Rübensamen noch nichts erfasst.`; return; }
    if (!row) { hint.textContent = k ? `${k.name} ist in der Rübensamen-Bestellung ${R.jahr} nicht aufgeführt.` : ''; if (force) rows.innerHTML = ''; return; }
    const L = rsVorschlag(R, row, a.id);
    hint.innerHTML = L.length ? '' : `Für ${esc(rsRowName(row))} ist in ${R.jahr} keine (offene) Fläche bestellt.`;
    if (force || !touched) { rows.innerHTML = L.map(x => rsSeedRow(R, x)).join(''); setFl(); }
  };
  const setFl = () => { const t = sum(); if (t && flAuto) { f.flaeche.value = t; f.flaeche.dispatchEvent(new Event('input', { bubbles: true })); } };
  const upd = () => { const on = rsOn() && (isRsSaatName(f.arbeit.value, f.kultur.value) || $$('.rsseedrow', box).length > 0 && !box.hidden); const was = box.hidden; box.hidden = !on; if (on && !f.kultur.value) { const ku = [...f.kultur.options].find(o => /zuckerr/i.test(o.value)); if (ku) f.kultur.value = ku.value; } if (on && was && !touched) suggest(false); };
  f.arbeit.addEventListener('change', upd); f.kultur.addEventListener('change', upd);
  f.kunde.addEventListener('input', () => { if (!box.hidden) suggest(false); });
  f.flaeche.addEventListener('input', e => { if (e.isTrusted) flAuto = false; });
  box.addEventListener('input', () => { touched = true; setFl(); });
  box.addEventListener('click', e => {
    const t = e.target.closest('[data-rs]'); if (!t) return; e.preventDefault(); e.stopPropagation();
    if (t.dataset.rs === 'seedAdd') { rows.insertAdjacentHTML('beforeend', rsSeedRow(rec(), {})); touched = true; }
    if (t.dataset.rs === 'seedDel') { t.closest('.rsseedrow').remove(); touched = true; setFl(); }
    if (t.dataset.rs === 'seedSuggest') { flAuto = true; suggest(true); touched = true; }
  });
  if (!box.hidden && !touched) suggest(false);
}
// Erledigt melden: gesäte Fläche pro Sorte
function rsDoneHtml(a) {
  if (!isRsSaat(a) || !(a.rsSorten || []).length) return '';
  const ist = a.rsIst || {};
  return `<div class="box rsseed"><h4>🌱 Gesäte Fläche pro Sorte</h4>${a.rsSorten.map(x => `<label class="fld rsdone"><span>${esc(x.name)} <small class="nr">geplant ${fmtNum(x.ha)} ha</small></span><input class="input" name="rsIst_${esc(x.sid)}" inputmode="decimal" value="${ist[x.sid] ?? x.ha ?? ''}"></label>`).join('')}
    <p class="nr" style="margin:4px 0 0">Die Summe wird als effektive Fläche übernommen und in Rübensamen › Abrechnung verrechnet.</p></div>`;
}
function rsDoneWire(f) { const ins = $$('input[name^="rsIst_"]', f); if (!ins.length) return; const up = () => { f.flaecheEff.value = r2(ins.reduce((t, i) => t + (rsNum(i.value) || 0), 0)); }; ins.forEach(i => i.addEventListener('input', up)); up(); }
function rsDoneRead(fd, a) {
  if (!(a.rsSorten || []).length) return;
  const ist = {}; a.rsSorten.forEach(x => { const v = rsNum(fd.get('rsIst_' + x.sid)); if (v != null) ist[x.sid] = v; });
  a.rsIst = ist; const t = r2(Object.values(ist).reduce((s, v) => s + v, 0)); if (t) a.flaecheEff = t;
}
function rsAbrPrint() {
  const rec = rsRec(), S = rsState(), K = rsAbr(rec).filter(k => (!S.ak || k.r.id === S.ak) && (!S.as || S.as === 'alle' || (S.as === 'offen' ? !k.r.abr : !!k.r.abr)));
  const html = K.map((k, i) => `<div style="${i ? 'break-before:page' : ''}">${LETTERHEAD}<h1 class="ptitle">Rübensamen ${rec.jahr} – ${esc(rsRowName(k.r))}</h1>
    <p>Saatgutverbrauch ${fmtNum(k.dp)} Dosen/ha${rsRowEigen(k.r) ? ` (Legeabstand ${fmtNum(k.r.lege || rec.lege)} cm, ${rsFgLbl(rec, k.r)})` : ''}</p>
    <table class="btab"><thead><tr><th>Sorte</th><th class="n">gesät ha</th><th class="n">Dosen</th><th class="n">Preis/Dose CHF</th><th class="n">Betrag CHF</th></tr></thead><tbody>
    ${k.pos.map(p => `<tr><td>${esc(p.name)}</td><td class="n">${p.cone ? '' : fmtNum(p.ha)}</td><td class="n">${fmtNum(p.d)}${p.cone ? ' Einh.' : ''}</td><td class="n">${p.pd != null ? chf(p.pd) : ''}</td><td class="n">${p.betrag != null ? chf(p.betrag) : ''}</td></tr>`).join('')}
    <tr class="gp"><td colspan="4"><b>Total inkl. ${fmtNum(r2((rec.mwst || 0) * 100))} % MwSt</b></td><td class="n"><b>${chf(k.total)}</b></td></tr></tbody></table></div>`).join('');
  printHtml(`Rübensamen ${rec.jahr} Abrechnung`, html || '<p>Keine Einträge.</p>', { noTitle: true });
}

/* ---------- Übersicht für den Schlepperfahrer: eine Seite A4 quer, ohne Logo und ohne Conviso One ---------- */
function rsFahrerPrint() {
  const rec = rsRec(), R = rec.rows.filter(r => rsRowHa(rec, r) > 0);
  if (!R.length) { toast('Noch keine Flächen erfasst.'); return; }
  const S = rsSorted(rec).filter(s => R.some(r => (r.ha || {})[s.id]));
  const n = R.length, fs = n > 34 ? 7 : n > 26 ? 8 : n > 18 ? 9 : n > 12 ? 10 : 11;
  const k = r => r.kunde ? Store.get('kunden', r.kunde) : null;
  const kontakt = r => { const x = k(r); if (!x) return ''; return [x.ort || '', x.handy || x.tel || ''].filter(Boolean).join(' · '); };
  const fg = r => r.fga === 0 ? '–' : fmtNum(r.fga || rec.fga);
  const lege = r => fmtNum(r.lege || rec.lege);
  const tot = s => r2(R.reduce((t, r) => t + ((r.ha || {})[s.id] || 0), 0)), totD = s => r2(R.reduce((t, r) => t + ((r.ha || {})[s.id] || 0) * rsRowDpha(rec, r), 0));
  const rows = R.map(r => { const dp = rsRowDpha(rec, r);
    return `<tr><td class="rfk"><b>${esc(rsRowName(r))}</b>${kontakt(r) ? `<div class="rfs">${esc(kontakt(r))}</div>` : ''}</td>
      <td class="n">${rsRowEigen(r) ? lege(r) : `<span class="rfs">${lege(r)}</span>`}</td><td class="n">${rsRowEigen(r) ? fg(r) : `<span class="rfs">${fg(r)}</span>`}</td><td class="n"><b>${fmtNum(dp)}</b></td>
      ${S.map(s => { const v = (r.ha || {})[s.id]; return `<td class="n srt ${s.gruppe === 'conv' ? 'conv' : ''}">${v ? `<b>${fmtNum(v)}</b><div class="rfs">${fmtNum(r2(v * dp))} D</div>` : ''}</td>`; }).join('')}
      <td class="rfb srt">${esc(r.notiz || '')}</td><td class="rfc">☐</td></tr>`; }).join('');
  const html = `<div class="rsfahrer" style="font-size:${fs}pt">
    <div class="rfh"><h1>Rübensaat ${rec.jahr} – Übersicht Fahrer</h1><span>${R.length} Kunden · ${fmtNum(r2(R.reduce((t, r) => t + rsRowHa(rec, r), 0)))} ha · Stand ${new Date().toLocaleDateString('de-CH')}</span></div>
    <table class="btab rft"><thead><tr><th>Kunde</th><th class="n">Lege&shy;abstand cm</th><th class="n">Fahr&shy;gasse m</th><th class="n">Dosen/ha</th>${S.map(s => `<th class="n srt ${s.gruppe === 'conv' ? 'conv' : ''}">${esc(s.name)}</th>`).join('')}<th class="srt">Bemerkung</th><th class="rfc">✓</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td><b>Total</b></td><td></td><td></td><td></td>${S.map(s => `<td class="n srt ${s.gruppe === 'conv' ? 'conv' : ''}"><b>${fmtNum(tot(s))}</b><div class="rfs">${fmtNum(totD(s))} D</div></td>`).join('')}<td class="srt"></td><td></td></tr></tfoot></table>
    <p class="rfs" style="margin-top:2mm">Fläche in ha, darunter Dosen (D) = ha × Dosen/ha des Kunden${rec.ueber ? ` (inkl. ${fmtNum(r2(rec.ueber * 100))} % Zuschlag für Überlappungen)` : ''}. Gelb = Conviso-Sorten. Grau = Standardwert. Fahrgasse «–» = keine Fahrgassen.</p></div>`;
  printHtml(`Rübensaat ${rec.jahr} – Übersicht Fahrer`, html, { noTitle: true });
}
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
    case 'planOrder': e.stopPropagation(); orderDialog(id, { plan: 'vorschlag' }); break;
    case 'done': e.stopPropagation(); doneDialog(id); break;
    case 'doneSave': Dlg.afterSave = () => doneDialog(id); if (!Dlg.form.reportValidity()) { Dlg.afterSave = null; break; } Dlg.form.requestSubmit(); break;
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
    case 'jbGrz': jdbGrenzen(id); break;
    case 'jbMark': jdbMarkSel(t.dataset.v === '1'); break;
    case 'jbMarkOne': { const on = t.dataset.v === '1'; jdbMark([id], on); toast(on ? 'Als abgerechnet markiert' : 'Wieder offen'); jdbDetail(id); break; }
    case 'jbSelAllList': { const S = App.jdbSel || (App.jdbSel = new Set()); jdbList().forEach(r => S.add(r.id)); App.render(); break; }
    case 'jbSelNone': App.jdbSel?.clear(); App.render(); break;
    case 'jbCols': jdbColsDialog(); break;
    case 'jbFs': App.jdb.fs = !App.jdb.fs; App.render(); break;
    case 'jbFsFilter': App.jdb.fsNoFilter = !App.jdb.fsNoFilter; App.render(); break;
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
    case 'icsNow': e.preventDefault(); icsWrite(true).then(() => { toast('Kalender geschrieben'); App.render(); }).catch(err => toast(err.message, 5000)); break;
    case 'icsLink': icsWrite(true).then(icsShareLink).then(url => { Store.setCfg({ ics: { ...icsCfg(), link: url } }, { silent: false }); toast('Freigabe-Link erstellt'); })
      .catch(err => toast(err.scope ? 'Die Dropbox-App darf keine Links erstellen. Bitte in Dropbox bei «planung.ics» › Teilen › Link kopieren und hier einfügen.' : 'Link konnte nicht erstellt werden: ' + err.message, 7000)); break;
    case 'icsCopy': { const el = $('#icsSub'); try { navigator.clipboard.writeText(el.value); toast('Adresse kopiert'); } catch { el.select(); document.execCommand('copy'); toast('Adresse kopiert'); } break; }
    case 'uPos': App.plan.upos = App.plan.upos === 'unter' ? 'neben' : 'unter'; ls('lp_upos', App.plan.upos); App.render(); break;
    case 'spIncAll': { const S = spInit(); Store.all('auftraege').filter(a => isSpray(a) && isOpen(a) && !a.datum).forEach(a => t.dataset.v === '1' ? S.inc.add(a.id) : S.inc.delete(a.id)); spSave(); App.render(); break; }
    case 'spExAll': { const S = spInit(), sel = sprayDays().filter(d => !S.off.has(d)); Store.all('auftraege').filter(a => isSpray(a) && isOpen(a) && a.datum && sel.includes(a.datum)).forEach(a => t.dataset.v === '1' ? S.ex.add(a.id) : S.ex.delete(a.id)); spSave(); App.render(); break; }
    case 'dauerReset': f.dauer.value = ''; f.dauer.dispatchEvent(new Event('input')); break;
    case 'dupOrder': {
      const a = structuredClone(Store.get('auftraege', id));
      Object.assign(a, { id: uid(), erfasst: Date.now(), nr: Store.nextAuftragNr(), status: 'offen', datum: '', zeit: '', erledigtAm: '', flaecheEff: null, stundenEff: null });
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
    case 'feldGrz': feldGrzToggle(id); break;
    case 'jdOc': jdOcOpen(t.dataset.k, id); break;
    case 'grzArch': grzArchToggle(t); break;
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
  if (k === 'mAktiv') { const m = Store.get('maschinen', e.target.dataset.id); if (m) { Store.put('maschinen', { ...m, aktiv: e.target.checked }); toast(`${m.name}: ${e.target.checked ? 'aktiviert' : 'deaktiviert'}`); } return; }
  if (k === 'spPrSeit') { if (e.target.value) { App.spray.prseit = e.target.value; App.render(); } return; }
  if (k === 'pUa') { App.plan.ua = e.target.value; App.render(); return; }
  if (k === 'pUm') { App.plan.um = e.target.value; App.render(); return; }
  if (k === 'pUs') { App.plan.us = e.target.value; ls('lp_pus', e.target.value); App.render(); return; }
  if (k === 'uPos') { App.plan.upos = e.target.value; ls('lp_upos', e.target.value); toast('Anordnung geändert'); return; }
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
  if (k === 'icsOn') { Store.setCfg({ ics: { ...icsCfg(), on: e.target.checked } }, { silent: false }); if (e.target.checked) { ls('lp_icsHash', null); Sync.run(); } return; }
  if (k === 'jdOcKunde' || k === 'jdOcFeld') { Store.setCfg({ [k]: e.target.value.trim() }); return; }
  if (k === 'icsLink') { Store.setCfg({ ics: { ...icsCfg(), link: e.target.value.trim() } }, { silent: false }); return; }
  if (k === 'spInc') { const S = spInit(), a = Store.get('auftraege', e.target.value); if (a) { const set = a.datum ? S.ex : S.inc; if (e.target.checked === !!a.datum) set.delete(a.id); else set.add(a.id); spSave(); } App.render(); return; }
  if (k === 'spDay') { if (e.target.checked) App.spray.off.delete(e.target.value); else App.spray.off.add(e.target.value); App.render(); return; }
  if (k === 'mpDate' && e.target.value) { machinePlanDialog(e.target.dataset.id, e.target.value); return; }
  if (k === 'kAll') { App.filter.kall = e.target.checked; App.render(); return; }
  if (k === 'parzOn') { Store.setCfg({ parzZuweisung: e.target.checked }, { silent: false }); App.render(); return; }
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
    const after = Dlg.afterSave; Dlg.afterSave = null;
    if (Dlg.onSubmit && Dlg.onSubmit(new FormData(Dlg.form)) !== false) { Dlg.close(); if (after) setTimeout(after, 0); }
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
