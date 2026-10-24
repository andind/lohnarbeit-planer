/* Lohnarbeit-Planer – App-Logik (ohne Fremdbibliotheken)
   Daten: lokal im Browser (offline) + Synchronisation mit Dropbox. */
'use strict';

const CFG = Object.assign({ appKey: '', dataPath: '/planung.json' }, window.APP_CONFIG || {});
const COLL = ['kunden', 'maschinen', 'personal', 'auftraege', 'einstellungen'];
const STATUS = { offen: 'Offen', geplant: 'Geplant', erledigt: 'Erledigt', verrechnet: 'Verrechnet' };
const EINHEITEN = ['ha', 'h', 'Stk', 'm³', 't', 'km', 'Ballen', 'pauschal'];
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const ARBEITEN = ['Mulchen', 'Wegränder mulchen', 'Grubbern', 'Flachgrubbern', 'Eggen', 'Striegeln', 'Walzen',
  'Säen', 'Dreschen', 'Pressen', 'Kompaktlader-Arbeiten', 'Transport', 'Traktorarbeit'];
const KULTUREN = ['Weizen', 'Gerste', 'Triticale', 'Dinkel', 'Roggen', 'Hafer', 'Raps', 'Silomais', 'Körnermais',
  'Zuckerrüben', 'Kartoffeln', 'Soja', 'Sonnenblumen', 'Eiweisserbsen', 'Ackerbohnen', 'Kunstwiese', 'Naturwiese',
  'Zwischenfrucht', 'Gründüngung', 'Stoppeln'];
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
  remove(c, id) {
    const o = this.data[c].find(x => x.id === id);
    if (!o) return;
    Object.keys(o).forEach(k => { if (k !== 'id') delete o[k]; });
    o.del = true; o.upd = Date.now();
    this.save(); Sync.schedule(); App.render();
  },
  cfg() { return Object.assign({ tagStunden: 10 }, this.get('einstellungen', 'cfg') || {}); },
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
const personColor = id => { const list = Store.all('personal').sort((a, b) => a.name.localeCompare(b.name)); const i = list.findIndex(p => p.id === id); return i < 0 ? 'var(--muted)' : (list[i].farbe || FARBEN[i % FARBEN.length]); };
const statusOf = a => a.status || (a.datum ? 'geplant' : 'offen');
const isOpen = a => ['offen', 'geplant'].includes(statusOf(a));
function mapsUrl(q) { return `https://maps.apple.com/?q=${encodeURIComponent(q)}`; }
function monthsLabel(arr) {
  const on = Array.from({ length: 12 }, (_, i) => !arr || !arr.length || arr.includes(i + 1));
  if (on.every(Boolean)) return 'ganzes Jahr';
  const runs = []; let start = on.findIndex((v, i) => v && !on[(i + 11) % 12]);
  for (let k = 0, i = start; k < 12; k++, i = (i + 1) % 12) {
    if (on[i] && !on[(i + 11) % 12]) { let j = i; while (on[(j + 1) % 12] && (j + 1) % 12 !== i) j = (j + 1) % 12; runs.push(i === j ? MONATE[i] : `${MONATE[i]}–${MONATE[j]}`); }
  }
  return runs.join(', ');
}
const inSeason = (m, iso) => !m.monate || !m.monate.length || m.monate.includes(parseDate(iso).getMonth() + 1);
const fits = (m, arbeit) => !arbeit || !(m.arbeitsarten || []).length || m.arbeitsarten.some(x => norm(x) === norm(arbeit));
const defaultDauer = (m, fl) => (m && m.leistung > 0 && fl > 0) ? Math.ceil(fl / m.leistung * 4) / 4 : null;
const dauerOf = a => a.dauer ?? defaultDauer(maschine(a.maschine), a.flaeche);
const allArbeiten = () => uniqSort([...ARBEITEN, ...Store.all('maschinen').flatMap(m => m.arbeitsarten || []), ...Store.all('auftraege').map(a => a.arbeit)]);
const allKulturen = () => uniqSort([...KULTUREN, ...Store.all('auftraege').map(a => a.kultur)]);
// Maschinen, die an einem Datum in Saison sind – aufgeteilt in passend / andere Arbeitsart
function machinesFor(iso, arbeit, keepId) {
  const day = iso || todayIso();
  const list = Store.all('maschinen').filter(m => (m.aktiv !== false && inSeason(m, day)) || m.id === keepId).sort(byArtNr);
  return { passend: list.filter(m => fits(m, arbeit)), andere: list.filter(m => !fits(m, arbeit)) };
}
const hrs = n => n == null ? '' : fmtNum(n) + ' h';
const wishTxt = a => a.wunsch ? `Wunsch ${fmtDate(a.wunsch)}` : 'kein Wunschdatum';
const wishLate = a => a.wunsch && a.wunsch < todayIso() && !a.datum;

/* ================= App / Ansichten ================= */
const App = {
  view: ls('lp_view') || 'auftraege',
  filter: { auftraege: 'offen', q: '', kq: '' },
  plan: { mode: ls('lp_pmode') || 'woche', date: new Date(), aa: ls('lp_paa') || '', nurBelegt: ls('lp_pbel') === '1' },
  lastView: null,
  go(v) { this.view = v; ls('lp_view', v); this.lastView = null; window.scrollTo(0, 0); this.render(); },
  render() {
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === this.view));
    const fresh = this.lastView !== this.view; this.lastView = this.view;
    const v = Views[this.view] || Views.auftraege;
    if (fresh) $('#toolbar').innerHTML = v.toolbar();
    if (v.refreshToolbar) v.refreshToolbar();
    $('#content').innerHTML = v.content();
    if (v.after) v.after();
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
        <input class="input search" type="search" placeholder="Suchen: Kunde, Arbeit, Kultur…" value="${esc(App.filter.q)}" data-in="aSearch">`;
    },
    refreshToolbar() {
      $$('#aSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === App.filter.auftraege));
      const all = Store.all('auftraege'); const c = { offen: 0, erledigt: 0, verrechnet: 0, alle: all.length };
      all.forEach(a => { const s = statusOf(a); if (isOpen(a)) c.offen++; else c[s]++; });
      $$('#aSeg .cnt').forEach(e => { e.textContent = c[e.dataset.c] ? `(${c[e.dataset.c]})` : ''; });
    },
    content() {
      const f = App.filter.auftraege, q = norm(App.filter.q);
      const list = Store.all('auftraege').filter(a => {
        const s = statusOf(a);
        if (f === 'offen' && !isOpen(a)) return false;
        if ((f === 'erledigt' || f === 'verrechnet') && s !== f) return false;
        if (!q) return true;
        return [a.nr, kundeName(a.kunde), a.arbeit, a.kultur, a.notiz, maschine(a.maschine)?.name].join(' ').toLowerCase().includes(q);
      }).sort((x, y) => f === 'offen'
        ? (!!x.datum - !!y.datum) || (x.datum || x.wunsch || '9999').localeCompare(y.datum || y.wunsch || '9999')
        : (y.erledigtAm || y.datum || '').localeCompare(x.erledigtAm || x.datum || ''));
      if (!list.length) return `<div class="empty">${q ? 'Keine Treffer.' : 'Keine Aufträge in dieser Ansicht.'}<br><br><button class="btn primary" data-act="newOrder">＋ Neuer Auftrag</button></div>`;
      if (f !== 'offen') return `<div class="list grid">${list.map(orderCard).join('')}</div>`;
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
          <select class="input" id="pAA" data-in="pAA" style="width:auto;min-height:34px;padding:4px 8px" aria-label="Arbeitsart"></select>
          <label class="tog"><input type="checkbox" id="pBel" data-in="pBel"> nur belegte Maschinen</label>
        </div>`;
    },
    refreshToolbar() {
      const P = App.plan;
      $$('#pSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === P.mode));
      const days = this.days();
      $('#pLbl').textContent = P.mode === 'tag'
        ? parseDate(days[0]).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : `KW ${kw(parseDate(days[0]))} · ${parseDate(days[0]).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })} – ${parseDate(days[6]).toLocaleDateString('de-CH', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      $('#pDate').value = isoDate(P.date);
      const aas = uniqSort(Store.all('maschinen').flatMap(m => m.arbeitsarten || []));
      $('#pAA').innerHTML = `<option value="">Alle Arbeitsarten</option>` + aas.map(x => `<option ${x === P.aa ? 'selected' : ''}>${esc(x)}</option>`).join('');
      $('#pBel').checked = P.nurBelegt;
    },
    days() {
      const P = App.plan;
      if (P.mode === 'tag') return [isoDate(P.date)];
      const mo = mondayOf(P.date); return Array.from({ length: 7 }, (_, i) => isoDate(addDays(mo, i)));
    },
    content() {
      const P = App.plan, days = this.days(), today = todayIso(), tag = Store.cfg().tagStunden || 10;
      const orders = Store.all('auftraege').filter(a => a.datum && days.includes(a.datum));
      const used = new Set(orders.map(a => a.maschine || ''));
      const ms = Store.all('maschinen').filter(m => (m.aktiv !== false && days.some(d => inSeason(m, d))) || used.has(m.id))
        .filter(m => (!P.aa || fits(m, P.aa) && (m.arbeitsarten || []).length) && (!P.nurBelegt || used.has(m.id))).sort(byArtNr);
      const cols = ms.map(m => ({ id: m.id, m }));
      if (used.has('') && !P.aa) cols.push({ id: '', m: null });
      const dayMode = P.mode === 'tag';
      let grid;
      if (!cols.length) grid = `<div class="empty">${P.nurBelegt || P.aa ? 'Keine passenden Maschinen – Filter oben anpassen.' : 'In diesem Zeitraum ist keine Maschine in Saison.<br>Saison unter <b>Maschinen</b> anpassen.'}</div>`;
      else {
        const head = `<div class="g-corner"></div>` + cols.map(c => `<div class="g-head">${c.m
          ? `<b>${esc(c.m.name)}</b><small>${esc((c.m.arbeitsarten || []).join(', ') || '—')}${c.m.leistung ? ` · ${fmtNum(c.m.leistung)} ha/h` : ''}</small>`
          : '<b>Ohne Maschine</b><small>Datum gesetzt, Maschine fehlt</small>'}</div>`).join('');
        const rows = days.map(d => `<div class="g-day ${d === today ? 'today' : ''}"><b>${fmtDate(d, { weekday: 'short' })}</b><small>${fmtDate(d, { day: '2-digit', month: '2-digit' })}</small></div>` +
          cols.map(c => {
            const off = c.m && !inSeason(c.m, d);
            const items = orders.filter(a => a.datum === d && (a.maschine || '') === c.id).sort((x, y) => (x.zeit || '99').localeCompare(y.zeit || '99'));
            const sum = items.reduce((s, a) => s + (dauerOf(a) || 0), 0);
            const pct = Math.min(100, sum / tag * 100);
            return `<div class="g-cell ${off ? 'off' : ''} ${d === today ? 'today' : ''}" ${off ? '' : `data-drop="${d}|${c.id}"`}>
              ${sum ? `<div class="load ${sum > tag ? 'over' : ''}" title="${fmtNum(sum)} von ${fmtNum(tag)} h"><i style="width:${pct}%"></i><span>${fmtNum(sum)} / ${fmtNum(tag)} h</span></div>` : ''}
              ${items.map(a => planCard(a, dayMode)).join('')}
              ${off && !items.length ? '<span class="nr">ausser Saison</span>' : ''}</div>`;
          }).join('')).join('');
        grid = `<div class="gridwrap"><div class="pgrid ${dayMode ? 'daymode' : ''}" style="grid-template-columns: 64px repeat(${cols.length}, minmax(${dayMode ? 200 : 132}px, 1fr))">${head}${rows}</div></div>`;
      }
      const unpl = Store.all('auftraege').filter(a => isOpen(a) && !a.datum)
        .sort((x, y) => (x.wunsch || '9999').localeCompare(y.wunsch || '9999'));
      return `<div class="planwrap">
        <div>${grid}<p class="nr" style="margin-top:8px">${matchMedia('(pointer:fine)').matches
          ? 'Aufträge mit der Maus auf Maschine und Tag ziehen. Die Dauer wird aus Fläche und Flächenleistung berechnet.'
          : 'Auftrag antippen, um ihn einzuplanen oder zu ändern. Waagrecht wischen für weitere Maschinen.'}</p></div>
        <aside class="unplanned" data-drop="">
          <h3>Noch nicht eingeplant (${unpl.length})</h3>
          <div class="slot">${unpl.map(unplCard).join('') || '<div class="none">Alles eingeplant 👍</div>'}</div>
        </aside></div>`;
    },
    after() {
      $$('[draggable="true"]').forEach(el => el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; }));
      $$('[data-drop]').forEach(el => {
        el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop'); });
        el.addEventListener('dragleave', () => el.classList.remove('drop'));
        el.addEventListener('drop', e => {
          e.preventDefault(); el.classList.remove('drop');
          const a0 = Store.get('auftraege', e.dataTransfer.getData('text/plain')); if (!a0) return;
          const a = { ...a0 };
          if (!el.dataset.drop) { a.datum = ''; a.zeit = ''; if (statusOf(a) === 'geplant') a.status = 'offen'; Store.put('auftraege', a); return; }
          const [d, mid] = el.dataset.drop.split('|'); const m = maschine(mid);
          if (m && a.arbeit && !fits(m, a.arbeit) && !confirm(`«${m.name}» ist nicht für «${a.arbeit}» erfasst. Trotzdem einplanen?`)) return;
          if ((a.maschine || '') !== mid || !a.dauerManuell) { a.dauer = defaultDauer(m, a.flaeche); a.dauerManuell = false; }
          a.maschine = mid; a.datum = d; if (statusOf(a) === 'offen') a.status = 'geplant';
          Store.put('auftraege', a);
        });
      });
    }
  },

  /* ---------- Kunden ---------- */
  kunden: {
    toolbar() {
      return `<h1>Kunden</h1>
        <input class="input search" type="search" placeholder="Kunde suchen…" value="${esc(App.filter.kq)}" data-in="kSearch">
        <button class="btn" data-act="importKunden">Import (Excel/CSV)</button>
        <button class="btn primary" data-act="editKunde">＋ Kunde</button>`;
    },
    content() {
      const q = norm(App.filter.kq);
      const list = Store.all('kunden').filter(k => !q || [k.nr, k.name, k.adresse, k.ort, k.tel].join(' ').toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      if (!list.length) return `<div class="empty">${q ? 'Keine Treffer.' : 'Noch keine Kunden.<br>Lege Kunden an oder importiere deine Kundenliste (Excel/CSV).'}</div>`;
      const open = {};
      Store.all('auftraege').forEach(a => { if (isOpen(a)) open[a.kunde] = (open[a.kunde] || 0) + 1; });
      return `<div class="rows">${list.map(k => `
        <div class="rowi" data-act="editKunde" data-id="${k.id}">
          <span class="num">${esc(k.nr || '')}</span>
          <div class="grow"><div class="t">${esc(k.name)}</div><div class="s">${esc([k.adresse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</div>
            <div class="links">${k.tel ? `<a href="tel:${esc(k.tel.replace(/\s/g, ''))}" data-stop>📞 ${esc(k.tel)}</a>` : ''}${(k.adresse || k.ort) ? `<a href="${mapsUrl([k.adresse, k.plz, k.ort].filter(Boolean).join(', '))}" target="_blank" rel="noopener" data-stop>📍 Karte</a>` : ''}</div></div>
          ${open[k.id] ? `<span class="chip">${open[k.id]} offen</span>` : ''}
        </div>`).join('')}</div>`;
    }
  },

  /* ---------- Maschinen ---------- */
  maschinen: {
    toolbar() { return `<h1>Maschinen</h1><button class="btn primary" data-act="editMaschine">＋ Maschine</button>`; },
    content() {
      const list = Store.all('maschinen').sort(byArtNr);
      if (!list.length) return '<div class="empty">Noch keine Maschinen erfasst.</div>';
      const month = new Date().getMonth() + 1;
      return `<div class="rows">${list.map(m => {
        const season = !m.monate?.length || m.monate.includes(month);
        return `<div class="rowi ${m.aktiv === false ? 'off' : ''}" data-act="editMaschine" data-id="${m.id}">
          <span class="num">${esc(m.artNr || '')}</span>
          <div class="grow"><div class="t">${esc(m.name)}</div>
            <div class="s">${esc((m.arbeitsarten || []).join(', ') || 'keine Arbeitsart')}${m.leistung ? ` · ${fmtNum(m.leistung)} ha/h` : ''} · pro ${esc(m.einheit || '—')}${m.ansatz ? ` CHF ${fmtNum(m.ansatz)}` : ''}</div></div>
          <span class="chip ${season ? '' : 'muted'}" title="Saison">${esc(monthsLabel(m.monate))}</span>
        </div>`; }).join('')}</div>
        <p class="nr" style="margin-top:10px">In der Planung erscheinen nur Maschinen, die in Saison und aktiv sind. Art.-Nr. und Einheit gehen in den Excel-Export.</p>`;
    }
  },

  /* ---------- Mehr ---------- */
  mehr: {
    toolbar() { return `<h1>Mehr</h1>`; },
    content() {
      const user = ls('lp_user');
      const conn = Auth.configured()
        ? (Auth.hasSession()
          ? `<p>Verbunden${user ? ' als <b>' + esc(user) + '</b>' : ''}. Die Daten liegen im App-Ordner deiner Dropbox: <b>Apps › (Name deiner Dropbox-App) › ${esc(Drive.path().slice(1))}</b>.</p>
             <div class="btns"><button class="btn primary" data-act="sync">Jetzt synchronisieren</button><button class="btn" data-act="logout">Abmelden</button></div>
             ${Sync.err ? `<p style="color:var(--danger)">Letzter Fehler: ${esc(Sync.err)}</p>` : ''}`
          : `<p>Noch nicht angemeldet. Nach der Anmeldung werden alle Daten in deiner Dropbox gespeichert und zwischen PC und iPhone abgeglichen.</p>
             <div class="btns"><button class="btn primary" data-act="login">Mit Dropbox anmelden</button></div>`)
        : `<p>Dropbox ist noch nicht eingerichtet – die App speichert vorerst nur auf diesem Gerät. Trage den App-Key in <b>config.js</b> ein (Anleitung, Schritt 2–3).</p>`;
      const ps = Store.all('personal').sort((a, b) => a.name.localeCompare(b.name));
      const y = new Date().getFullYear();
      return `<div class="cols"><div>
        <div class="panel"><h2>Dropbox</h2>${conn}
          <p style="margin-top:12px">Redirect-URI für die Dropbox-App:</p><code class="mono">${esc(Auth.redirectUri())}</code></div>
        <div class="panel"><h2>Planung</h2>
          <label class="fld"><span>Arbeitsstunden pro Tag und Maschine</span><input class="input" style="max-width:140px" inputmode="decimal" id="tagStd" value="${esc(Store.cfg().tagStunden)}" data-in="tagStd"></label>
          <p>Grundlage für die Auslastungsanzeige im Plan.</p></div>
        <div class="panel"><h2>Fahrer / Personal</h2>
          ${ps.length ? `<div class="rows">${ps.map(p => `<div class="rowi" data-act="editPerson" data-id="${p.id}"><span class="who"><i style="background:${personColor(p.id)}"></i></span><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.tel || '')}</div></div></div>`).join('')}</div>` : '<p>Noch niemand erfasst.</p>'}
          <div class="btns"><button class="btn" data-act="editPerson">＋ Person</button></div></div>
      </div><div>
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
          <div class="btns"><button class="btn" data-act="backup">Sicherung herunterladen</button><button class="btn" data-act="restore">Sicherung einlesen</button></div></div>
        <div class="panel"><h2>Als App installieren</h2>
          <p><b>iPhone:</b> In Safari öffnen › Teilen-Symbol › «Zum Home-Bildschirm».</p>
          <p><b>Windows:</b> In Edge oder Chrome öffnen › Menü › «Apps» › «Diese Seite als App installieren».</p></div>
      </div></div>`;
    }
  }
};

/* ---------- Karten ---------- */
function orderCard(a) {
  const s = statusOf(a), m = maschine(a.maschine), pers = a.fahrer && Store.get('personal', a.fahrer);
  const k = Store.get('kunden', a.kunde);
  const when = a.datum
    ? `<span class="chip">📅 ${fmtDate(a.datum)}${a.zeit ? ' ' + a.zeit : ''}</span>${m ? `<span class="chip">${esc(m.name)}</span>` : '<span class="chip warn">keine Maschine</span>'}${dauerOf(a) ? `<span class="chip">⏱ ${hrs(dauerOf(a))}</span>` : ''}`
    : `<span class="chip ${wishLate(a) ? 'warn' : ''}">${wishTxt(a)}</span>`;
  return `<article class="card" data-act="editOrder" data-id="${a.id}">
    <div class="row1"><div class="title">${esc(kundeName(a.kunde))}</div><span class="badge ${s}">${STATUS[s]}</span></div>
    <div class="sub">${esc([a.arbeit, a.kultur].filter(Boolean).join(' · ') || '—')}${a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : ''}</div>
    ${a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}
    <div class="meta">${when}
      ${pers ? `<span class="who"><i style="background:${personColor(pers.id)}"></i>${esc(pers.name)}</span>` : ''}
      <span class="nr" style="margin-left:auto">${esc(a.nr || '')}</span></div>
    ${isOpen(a) ? `<div class="actions">
      ${!a.datum ? `<button class="btn small primary" data-act="planOrder" data-id="${a.id}">Einplanen</button>` : `<button class="btn small" data-act="done" data-id="${a.id}">✓ Erledigt</button>`}
      ${k && (k.adresse || k.ort) ? `<a class="btn small" href="${mapsUrl([k.adresse, k.plz, k.ort].filter(Boolean).join(', '))}" target="_blank" rel="noopener" data-stop>📍 Karte</a>` : ''}
      ${k?.tel ? `<a class="btn small" href="tel:${esc(k.tel.replace(/\s/g, ''))}" data-stop>📞</a>` : ''}</div>` : ''}
  </article>`;
}
function planCard(a, big) {
  const s = statusOf(a), pers = a.fahrer && Store.get('personal', a.fahrer), d = dauerOf(a);
  return `<div class="pcard ${s}" data-act="editOrder" data-id="${a.id}" ${isOpen(a) ? 'draggable="true"' : ''}>
    <b>${a.zeit ? esc(a.zeit) + ' · ' : ''}${esc(kundeName(a.kunde))}</b>
    <div class="sub">${esc([a.arbeit, a.kultur].filter(Boolean).join(' · '))}</div>
    <div class="sub">${a.flaeche ? fmtNum(a.flaeche) + ' ha' : ''}${a.flaeche && d ? ' · ' : ''}${d ? '⏱ ' + hrs(d) : ''}${s === 'erledigt' || s === 'verrechnet' ? ' · ✓' : ''}</div>
    ${big && a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}
    ${pers ? `<div class="meta"><span class="who"><i style="background:${personColor(pers.id)}"></i>${esc(pers.name)}</span></div>` : ''}
  </div>`;
}
function unplCard(a) {
  return `<div class="pcard unpl" data-act="planOrder" data-id="${a.id}" draggable="true">
    <b>${esc(kundeName(a.kunde))}</b>
    <div class="sub">${esc([a.arbeit, a.kultur].filter(Boolean).join(' · '))}${a.flaeche ? ` · ${fmtNum(a.flaeche)} ha` : ''}</div>
    <div class="meta"><span class="chip ${wishLate(a) ? 'warn' : ''}">${wishTxt(a)}</span></div>
    ${a.notiz ? `<div class="note">${esc(a.notiz)}</div>` : ''}
  </div>`;
}

/* ================= Dialoge ================= */
const Dlg = {
  el: null, form: null, onSubmit: null,
  open(title, body, footer, onSubmit) {
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

function orderDialog(id, { plan, kunde: kundeId } = {}) {
  const isNew = !id;
  const a = isNew ? { id: uid(), nr: Store.nextAuftragNr(), status: 'offen', kunde: kundeId || '' } : structuredClone(Store.get('auftraege', id));
  if (!a) return;
  const k = a.kunde && Store.get('kunden', a.kunde);
  const s = statusOf(a), done = s === 'erledigt' || s === 'verrechnet';
  const planDate = a.datum || (plan ? (a.wunsch && a.wunsch >= todayIso() ? a.wunsch : (App.view === 'plan' ? isoDate(App.plan.date) : todayIso())) : '');
  const pers = Store.all('personal').sort((x, y) => x.name.localeCompare(y.name));
  const body = `
    <label class="fld"><span>Kunde</span>
      <input class="input" name="kunde" list="dlKunden" value="${esc(k ? kundeLabel(k) : '')}" placeholder="Name eingeben oder auswählen" autocomplete="off" required ${isNew && !kundeId ? 'autofocus' : ''}>
      <datalist id="dlKunden">${Store.all('kunden').sort((x, y) => x.name.localeCompare(y.name, 'de')).map(k => `<option value="${esc(kundeLabel(k))}">`).join('')}</datalist>
      <div class="hint" id="kHint"></div></label>
    <div class="two">
      <label class="fld"><span>Arbeit</span><input class="input" name="arbeit" list="dlArbeit" value="${esc(a.arbeit || '')}" placeholder="z.B. Säen" autocomplete="off">
        <datalist id="dlArbeit">${allArbeiten().map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <label class="fld"><span>Kultur</span><input class="input" name="kultur" list="dlKultur" value="${esc(a.kultur || '')}" placeholder="z.B. Weizen" autocomplete="off">
        <datalist id="dlKultur">${allKulturen().map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
    </div>
    <div class="two">
      <label class="fld"><span>Fläche (ha)</span><input class="input" name="flaeche" inputmode="decimal" value="${a.flaeche ?? ''}" placeholder="z.B. 4.5"></label>
      <label class="fld"><span>Wunschdatum</span><input class="input" type="date" name="wunsch" value="${a.wunsch || ''}"></label>
    </div>
    <label class="fld"><span>Bemerkungen</span><textarea class="input" name="notiz" placeholder="Zufahrt, Besonderheiten, Ansprechperson…">${esc(a.notiz || '')}</textarea></label>

    <details class="box" id="planBox" ${a.datum || plan ? 'open' : ''}>
      <summary><b>${a.datum ? 'Einplanung' : 'Direkt einplanen'}</b></summary>
      <div style="margin-top:10px">
        <div class="two">
          <label class="fld"><span>Datum</span><input class="input" type="date" name="datum" value="${planDate}"></label>
          <label class="fld"><span>Startzeit (optional)</span><input class="input" type="time" name="zeit" value="${a.zeit || ''}"></label>
        </div>
        <label class="fld"><span>Maschine</span><select class="input" name="maschine"></select><div class="hint" id="mHint"></div></label>
        <div class="two">
          <label class="fld"><span>Dauer (h)</span><input class="input" name="dauer" inputmode="decimal" value="${a.dauerManuell ? (a.dauer ?? '') : ''}"><div class="sub2" id="dHint"></div></label>
          <label class="fld"><span>Fahrer (optional)</span><select class="input" name="fahrer"><option value="">—</option>${pers.map(p => `<option value="${p.id}" ${a.fahrer === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        </div>
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
    let kunde = Store.all('kunden').find(k => kundeLabel(k) === kTxt) || Store.all('kunden').find(k => norm(k.name) === norm(kTxt));
    if (!kunde && kTxt) kunde = Store.put('kunden', { id: uid(), name: kTxt }, { silent: true });
    const planOpen = $('#planBox', Dlg.form).open;
    const o = Object.assign(a, {
      kunde: kunde?.id || '', arbeit: fd.get('arbeit').trim(), kultur: fd.get('kultur').trim(),
      flaeche: num(fd.get('flaeche')), wunsch: fd.get('wunsch'), notiz: fd.get('notiz').trim()
    });
    if (planOpen && fd.get('datum')) {
      const m = maschine(fd.get('maschine')); const manual = num(fd.get('dauer'));
      Object.assign(o, { datum: fd.get('datum'), zeit: fd.get('zeit'), maschine: m?.id || '', fahrer: fd.get('fahrer'),
        dauerManuell: manual != null, dauer: manual ?? defaultDauer(m, o.flaeche) });
    } else if (!o.datum || planOpen) { Object.assign(o, { datum: '', zeit: '' }); }
    if (!isNew) {
      o.status = fd.get('status');
      if (o.status === 'erledigt' || o.status === 'verrechnet') {
        o.erledigtAm = fd.get('erledigtAm') || o.datum || todayIso(); if (!o.datum) o.datum = o.erledigtAm;
        o.flaecheEff = num(fd.get('flaecheEff')); o.stundenEff = num(fd.get('stundenEff'));
      }
    }
    if (isOpen(o)) o.status = o.datum ? 'geplant' : 'offen';
    Store.put('auftraege', o);
    toast(o.datum && isOpen(o) ? `Eingeplant am ${fmtDate(o.datum)}` : 'Auftrag gespeichert');
    return true;
  });

  // ---- Live-Verhalten
  const f = Dlg.form;
  const fillMachines = () => {
    const cur = f.maschine.value || a.maschine || '';
    f.maschine.innerHTML = machineOptions(f.datum.value, f.arbeit.value.trim(), cur);
    if (!f.maschine.value && !cur && f.datum.value) {   // eine einzige passende Maschine automatisch vorschlagen
      const { passend } = machinesFor(f.datum.value, f.arbeit.value.trim());
      if (passend.length === 1 && f.arbeit.value.trim()) f.maschine.value = passend[0].id;
    }
    const { passend } = machinesFor(f.datum.value, f.arbeit.value.trim());
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
    const known = !t || Store.all('kunden').some(k => kundeLabel(k) === t || norm(k.name) === norm(t));
    $('#kHint', f).textContent = known ? '' : 'Neuer Kunde – wird beim Speichern angelegt.';
  };
  f.kunde.addEventListener('input', checkKunde);
  f.arbeit.addEventListener('change', fillMachines);
  f.datum.addEventListener('change', fillMachines);
  f.maschine.addEventListener('change', showDauer);
  f.flaeche.addEventListener('input', showDauer);
  f.dauer.addEventListener('input', showDauer);
  $('#planBox', f).addEventListener('toggle', e => { if (e.target.open && !f.datum.value) { f.datum.value = f.wunsch.value || todayIso(); fillMachines(); } });
  if (f.status) f.status.addEventListener('change', () => {
    const dn = ['erledigt', 'verrechnet'].includes(f.status.value);
    $('#doneBox', f).hidden = !dn; f.status.closest('.fld').style.marginBottom = dn ? '12px' : '0';
    if (dn) prefillDone(f, a);
  });
  fillMachines(); checkKunde();
  if (plan) setTimeout(() => $('#planBox', f)?.scrollIntoView({ block: 'nearest' }), 60);
}
function prefillDone(f, a) {
  if (!f.erledigtAm.value) f.erledigtAm.value = f.datum.value || a.datum || todayIso();
  if (!f.flaecheEff.value && num(f.flaeche.value) != null) f.flaecheEff.value = num(f.flaeche.value);
  if (!f.stundenEff.value) { const d = num(f.dauer.value) ?? defaultDauer(maschine(f.maschine.value), num(f.flaeche.value)); if (d != null) f.stundenEff.value = d; }
}

function doneDialog(id) {
  const a = structuredClone(Store.get('auftraege', id)); if (!a) return;
  const ms = Store.all('maschinen').filter(m => m.aktiv !== false || m.id === a.maschine).sort(byArtNr);
  const body = `
    <p style="margin-top:0"><b>${esc(kundeName(a.kunde))}</b> · ${esc([a.arbeit, a.kultur].filter(Boolean).join(' · '))}</p>
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

function kundeDialog(id) {
  const k = id ? { ...Store.get('kunden', id) } : { id: uid() };
  const body = `
    <div class="two"><label class="fld"><span>Kunden-Nr.</span><input class="input" name="nr" value="${esc(k.nr || '')}"></label>
      <label class="fld"><span>Telefon</span><input class="input" name="tel" type="tel" value="${esc(k.tel || '')}"></label></div>
    <label class="fld"><span>Name / Betrieb</span><input class="input" name="name" value="${esc(k.name || '')}" required autofocus></label>
    <label class="fld"><span>Adresse</span><input class="input" name="adresse" value="${esc(k.adresse || '')}"></label>
    <div class="two"><label class="fld"><span>PLZ</span><input class="input" name="plz" inputmode="numeric" value="${esc(k.plz || '')}"></label>
      <label class="fld"><span>Ort</span><input class="input" name="ort" value="${esc(k.ort || '')}"></label></div>
    <label class="fld"><span>E-Mail</span><input class="input" name="mail" type="email" value="${esc(k.mail || '')}"></label>
    <label class="fld"><span>Notizen</span><textarea class="input" name="notiz">${esc(k.notiz || '')}</textarea></label>`;
  Dlg.open(id ? 'Kunde bearbeiten' : 'Neuer Kunde', body,
    saveFooter(id ? `<button type="button" class="btn danger" data-act="delKunde" data-id="${k.id}">Löschen</button><button type="button" class="btn" data-act="newOrderFor" data-id="${k.id}">＋ Auftrag</button>` : ''), fd => {
      ['nr', 'name', 'adresse', 'plz', 'ort', 'tel', 'mail', 'notiz'].forEach(x => { k[x] = (fd.get(x) || '').trim(); });
      Store.put('kunden', k); return true;
    });
}

function maschineDialog(id) {
  const m = id ? structuredClone(Store.get('maschinen', id)) : { id: uid(), einheit: 'ha', aktiv: true, arbeitsarten: [], monate: [] };
  const mon = m.monate?.length ? m.monate : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const arbeiten = uniqSort([...allArbeiten(), ...(m.arbeitsarten || [])]);
  const body = `
    <div class="two"><label class="fld"><span>Art.-Nr.</span><input class="input" name="artNr" value="${esc(m.artNr || '')}"></label>
      <label class="fld"><span>Verrechnung pro</span><select class="input" name="einheit">${EINHEITEN.map(e => `<option ${m.einheit === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label></div>
    <label class="fld"><span>Bezeichnung</span><input class="input" name="name" value="${esc(m.name || '')}" required ${id ? '' : 'autofocus'}></label>
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
        artNr: fd.get('artNr').trim(), name: fd.get('name').trim(), einheit: fd.get('einheit'), leistung: num(fd.get('leistung')),
        ansatz: num(fd.get('ansatz')), aktiv: !!fd.get('aktiv'),
        arbeitsarten: uniqSort([...fd.getAll('aa'), ...fd.get('aaNeu').split(',')]),
        monate: monate.length === 12 || !monate.length ? [] : monate.sort((x, y) => x - y)
      });
      Store.put('maschinen', m); return true;
    });
}

function personDialog(id) {
  const p = id ? { ...Store.get('personal', id) } : { id: uid() };
  const body = `<label class="fld"><span>Name</span><input class="input" name="name" value="${esc(p.name || '')}" required autofocus></label>
    <label class="fld"><span>Telefon</span><input class="input" name="tel" type="tel" value="${esc(p.tel || '')}"></label>
    <label class="fld"><span>Farbe im Plan</span><input class="input" name="farbe" type="color" value="${esc(p.farbe || FARBEN[Store.all('personal').length % FARBEN.length])}" style="padding:4px;height:44px"></label>`;
  Dlg.open(id ? 'Person bearbeiten' : 'Neue Person', body,
    saveFooter(id ? `<button type="button" class="btn danger" data-act="delPerson" data-id="${p.id}">Löschen</button>` : ''), fd => {
      Object.assign(p, { name: fd.get('name').trim(), tel: fd.get('tel').trim(), farbe: fd.get('farbe') });
      Store.put('personal', p); return true;
    });
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
  const head = ['Auftrag-Nr', 'Datum', 'Kunden-Nr', 'Kunde', 'Ort Kunde', 'Arbeit', 'Kultur', 'Art.-Nr', 'Maschine', 'Fläche ha', 'Stunden h', 'Verrechnungsmenge', 'Einheit', 'Ansatz CHF', 'Betrag CHF', 'Fahrer', 'Status', 'Bemerkung'];
  const rows = [head];
  list.forEach(a => {
    const k = Store.get('kunden', a.kunde) || {}, p = Store.get('personal', a.fahrer), m = maschine(a.maschine) || {};
    const fl = a.flaecheEff ?? a.flaeche, st = a.stundenEff ?? dauerOf(a);
    const menge = m.einheit === 'h' ? st : m.einheit === 'ha' ? fl : '';
    const betrag = m.ansatz && menge != null && menge !== '' ? Math.round(m.ansatz * menge * 100) / 100 : '';
    rows.push([a.nr, a.erledigtAm || a.datum, k.nr, k.name, k.ort, a.arbeit, a.kultur, m.artNr, m.name, fl ?? '', st ?? '', menge ?? '', m.einheit, m.ansatz ?? '', betrag, p?.name, STATUS[statusOf(a)], a.notiz]);
  });
  const csv = '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
  download(`Lohnarbeiten_${von}_bis_${bis}.csv`, csv, 'text/csv;charset=utf-8');
  if (mark) { list.forEach(a => { if (statusOf(a) === 'erledigt') { a.status = 'verrechnet'; a.upd = Date.now(); } }); Store.save(); Sync.schedule(); App.render(); }
  toast(`${list.length} Aufträge exportiert`);
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
  if (e.target.closest('[data-stop]')) return; // Links (Telefon, Karte) nicht als Kartenklick werten
  const t = e.target.closest('[data-act],[data-view]'); if (!t) return;
  if (t.dataset.view) { App.go(t.dataset.view); return; }
  const act = t.dataset.act, id = t.dataset.id, f = Dlg.form;
  if (t.tagName === 'A') e.preventDefault();
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
    case 'dauerReset': f.dauer.value = ''; f.dauer.dispatchEvent(new Event('input')); break;
    case 'dupOrder': {
      const a = structuredClone(Store.get('auftraege', id));
      Object.assign(a, { id: uid(), nr: Store.nextAuftragNr(), status: 'offen', datum: '', zeit: '', erledigtAm: '', flaecheEff: null, stundenEff: null });
      Store.put('auftraege', a); Dlg.close(); orderDialog(a.id); toast('Kopie erstellt – z.B. anderen Kunden wählen'); break;
    }
    case 'delOrder': if (confirm('Auftrag löschen?')) { Store.remove('auftraege', id); Dlg.close(); } break;
    case 'aFilter': App.filter.auftraege = t.dataset.v; App.render(); break;
    case 'pMode': App.plan.mode = t.dataset.v; ls('lp_pmode', t.dataset.v); App.render(); break;
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
    case 'importKunden': importKunden(); break;
    case 'editMaschine': maschineDialog(id); break;
    case 'delMaschine': if (confirm('Maschine löschen? (Tipp: «Aktiv» ausschalten behält sie in alten Aufträgen sichtbar)')) { Store.remove('maschinen', id); Dlg.close(); } break;
    case 'monAll': $$('input[name="mon"]', f).forEach(i => { i.checked = true; }); break;
    case 'monNone': $$('input[name="mon"]', f).forEach(i => { i.checked = false; }); break;
    case 'editPerson': personDialog(id); break;
    case 'delPerson': if (confirm('Person löschen?')) { Store.remove('personal', id); Dlg.close(); } break;
    case 'export': exportCsv(); break;
    case 'backup': download(`Lohnarbeit-Sicherung_${todayIso()}.json`, JSON.stringify(Store.data, null, 1), 'application/json'); break;
    case 'restore': restoreBackup(); break;
  }
});
document.addEventListener('input', e => {
  const k = e.target.dataset.in; if (!k) return;
  if (k === 'aSearch') { App.filter.q = e.target.value; App.render(); }
  if (k === 'kSearch') { App.filter.kq = e.target.value; App.render(); }
});
document.addEventListener('change', e => {
  const k = e.target.dataset.in; if (!k) return;
  if (k === 'pDate' && e.target.value) { App.plan.date = parseDate(e.target.value); App.render(); }
  if (k === 'pAA') { App.plan.aa = e.target.value; ls('lp_paa', e.target.value); App.render(); }
  if (k === 'pBel') { App.plan.nurBelegt = e.target.checked; ls('lp_pbel', e.target.checked ? '1' : null); App.render(); }
  if (k === 'tagStd') {
    const v = num(e.target.value); if (!v || v <= 0 || v > 24) { toast('Bitte Stunden zwischen 1 und 24 eingeben'); return; }
    Store.put('einstellungen', Object.assign({}, Store.get('einstellungen', 'cfg') || { id: 'cfg' }, { tagStunden: v }), { silent: true });
    toast('Gespeichert');
  }
});

/* ================= Start ================= */
(async function init() {
  Dlg.el = $('#dlg'); Dlg.form = $('#dlgForm');
  Dlg.form.addEventListener('submit', e => {
    e.preventDefault();
    if (Dlg.onSubmit && Dlg.onSubmit(new FormData(Dlg.form)) !== false) Dlg.close();
  });
  Dlg.el.addEventListener('cancel', () => { Dlg.onSubmit = null; });
  Store.load();
  App.render();
  try { await Auth.handleRedirect(); } catch (e) { toast('Anmeldung fehlgeschlagen: ' + e.message, 6000); }
  App.render();
  Sync.run();
  addEventListener('online', () => Sync.run());
  addEventListener('offline', () => Sync.setState('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.run(); });
  setInterval(() => { if (document.visibilityState === 'visible' && !Dlg.el.open) Sync.run(); }, 60000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
