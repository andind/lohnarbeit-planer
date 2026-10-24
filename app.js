/* Lohnarbeit-Planer – App-Logik (ohne Fremdbibliotheken)
   Daten: lokal im Browser (offline) + Synchronisation mit Dropbox. */
'use strict';

const CFG = Object.assign({ appKey: '', dataPath: '/planung.json' }, window.APP_CONFIG || {});
const COLL = ['kunden', 'maschinen', 'personal', 'auftraege'];
const STATUS = { offen: 'Offen', geplant: 'Geplant', erledigt: 'Erledigt', verrechnet: 'Verrechnet' };
const EINHEITEN = ['ha', 'h', 'Stk', 'm³', 't', 'km', 'Ballen', 'pauschal'];
const ARBEITEN = ['Mulchen', 'Wegränder mulchen', 'Grubbern', 'Flachgrubbern', 'Eggen', 'Striegeln', 'Walzen',
  'Walzen mit Säen', 'Säen', 'Kompaktlader-Arbeiten', 'Transport', 'Traktorarbeit mit Bedienung'];
const FARBEN = ['#1f77b4', '#d9480f', '#2b8a3e', '#9c36b5', '#c2255c', '#0b7285', '#e67700', '#5f3dc4'];
const SEED_MASCHINEN = [
  ['Kompaktlader Gehl', 'h'], ['Kurzscheibenegge Amazone', 'ha'], ['Grubber Ott 7 Zinken', 'ha'],
  ['Grubber Lemken mit Stabkrümler', 'ha'], ['Strohstriegel 6m', 'ha'], ['Cambridge Walze 6.3m/5m', 'ha'],
  ['Cambridge Walze 5m mit Sägerät', 'ha'], ['Prismenwalze 6m', 'ha'], ['Mulcher', 'ha'],
  ['Mulcher für Wegränder', 'h'], ['Flachgrubber AgriFarm 4.5m', 'ha'], ['Traktor mit Bedienung', 'h']
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
    if (!this.data || typeof this.data !== 'object') this.data = { v: 1 };
    COLL.forEach(c => { if (!Array.isArray(this.data[c])) this.data[c] = []; });
    if (!ls('lp_seeded')) {
      SEED_MASCHINEN.forEach(([name, einheit], i) => {
        const id = 'm' + (101 + i);
        if (!this.data.maschinen.some(m => m.id === id)) this.data.maschinen.push({ id, upd: 1, artNr: String(101 + i), name, einheit, aktiv: true });
      });
      ls('lp_seeded', '1'); this.save();
    }
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
    Object.keys(o).forEach(k => { if (!['id'].includes(k)) delete o[k]; });
    o.del = true; o.upd = Date.now();
    this.save(); Sync.schedule(); App.render();
  },
  nextAuftragNr() {
    const y = new Date().getFullYear();
    const max = this.data.auftraege.reduce((m, a) => {
      const r = /^(\d{4})-(\d+)$/.exec(a.nr || ''); return r && +r[1] === y ? Math.max(m, +r[2]) : m;
    }, 0);
    return `${y}-${String(max + 1).padStart(3, '0')}`;
  }
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
          Store.data = merged; Store.save();
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
const maschine = id => Store.get('maschinen', id);
const personColor = id => { const list = Store.all('personal').sort((a, b) => a.name.localeCompare(b.name)); const i = list.findIndex(p => p.id === id); return i < 0 ? 'var(--muted)' : (list[i].farbe || FARBEN[i % FARBEN.length]); };
function statusOf(a) { return a.status || (a.datum ? 'geplant' : 'offen'); }
function mapsUrl(q, lat, lon) {
  if (lat && lon) return `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(q || 'Feld')}`;
  return `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
}
function machineConflicts(datum, excludeId) {
  const used = {};
  Store.all('auftraege').filter(a => a.datum === datum && a.id !== excludeId && statusOf(a) === 'geplant')
    .forEach(a => (a.maschinen || []).forEach(m => { used[m] = (used[m] || 0) + 1; }));
  return used;
}

/* ================= App / Ansichten ================= */
const App = {
  view: ls('lp_view') || 'auftraege',
  filter: { auftraege: 'offen', q: '', kq: '' },
  weekStart: mondayOf(new Date()),
  planFilter: '',
  lastView: null,

  go(v) { this.view = v; ls('lp_view', v); this.lastView = null; window.scrollTo(0, 0); this.render(); },

  render() {
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === this.view));
    const fresh = this.lastView !== this.view; this.lastView = this.view;
    const v = Views[this.view] || Views.auftraege;
    if (fresh) $('#toolbar').innerHTML = v.toolbar();
    else if (v.refreshToolbar) v.refreshToolbar();
    $('#content').innerHTML = v.content();
    if (v.after) v.after();
    Sync.setState();
  }
};

const Views = {
  /* ---------- Aufträge ---------- */
  auftraege: {
    toolbar() {
      const f = App.filter.auftraege;
      const segs = [['offen', 'Offen'], ['erledigt', 'Erledigt'], ['verrechnet', 'Verrechnet'], ['alle', 'Alle']];
      return `<h1>Aufträge</h1>
        <div class="seg" id="aSeg">${segs.map(([k, l]) => `<button type="button" data-act="aFilter" data-v="${k}" class="${f === k ? 'on' : ''}">${l} <span class="cnt" data-c="${k}"></span></button>`).join('')}</div>
        <input class="input search" type="search" placeholder="Suchen: Kunde, Arbeit, Ort…" value="${esc(App.filter.q)}" data-in="aSearch">`;
    },
    refreshToolbar() { $$('#aSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === App.filter.auftraege)); },
    list() {
      const f = App.filter.auftraege, q = norm(App.filter.q);
      return Store.all('auftraege').filter(a => {
        const s = statusOf(a);
        if (f === 'offen' && !(s === 'offen' || s === 'geplant')) return false;
        if (f === 'erledigt' && s !== 'erledigt') return false;
        if (f === 'verrechnet' && s !== 'verrechnet') return false;
        if (!q) return true;
        const hay = [a.nr, kundeName(a.kunde), a.arbeit, a.ort, a.notiz, ...(a.maschinen || []).map(m => maschine(m)?.name)].join(' ').toLowerCase();
        return hay.includes(q);
      }).sort((x, y) => {
        const sx = statusOf(x), sy = statusOf(y);
        if (f === 'offen') {
          if (!!y.prio - !!x.prio) return !!y.prio - !!x.prio;
          const dx = x.datum || x.wunschBis || x.wunschVon || '9999', dy = y.datum || y.wunschBis || y.wunschVon || '9999';
          return dx.localeCompare(dy);
        }
        return (y.erledigtAm || y.datum || '').localeCompare(x.erledigtAm || x.datum || '') || sx.localeCompare(sy);
      });
    },
    content() {
      const list = this.list();
      if (!list.length) return `<div class="empty">${App.filter.q ? 'Keine Treffer.' : 'Keine Aufträge in dieser Ansicht.'}<br><br><button class="btn primary" data-act="newOrder">＋ Neuer Auftrag</button></div>`;
      return `<div class="list grid">${list.map(orderCard).join('')}</div>`;
    },
    after() {
      const all = Store.all('auftraege');
      const c = { offen: 0, erledigt: 0, verrechnet: 0, alle: all.length };
      all.forEach(a => { const s = statusOf(a); if (s === 'offen' || s === 'geplant') c.offen++; else c[s]++; });
      $$('#aSeg .cnt').forEach(e => { e.textContent = c[e.dataset.c] ? `(${c[e.dataset.c]})` : ''; });
    }
  },

  /* ---------- Wochenplan ---------- */
  plan: {
    toolbar() {
      return `<h1>Wochenplan</h1>
        <div class="weekhead">
          <button class="btn small" data-act="week" data-d="-7" aria-label="Vorherige Woche">◀</button>
          <span class="lbl" id="wLbl"></span>
          <button class="btn small" data-act="week" data-d="7" aria-label="Nächste Woche">▶</button>
          <button class="btn small" data-act="week" data-d="0">Heute</button>
        </div>
        <select class="input" style="width:auto;min-width:160px" data-in="planFilter" id="pFilter"></select>`;
    },
    refreshToolbar() {},
    content() {
      const ws = App.weekStart, we = addDays(ws, 6);
      const lbl = `KW ${kw(ws)} · ${ws.toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })} – ${we.toLocaleDateString('de-CH', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      setTimeout(() => { const l = $('#wLbl'); if (l) l.textContent = lbl; }, 0);
      const pf = App.planFilter;
      const match = a => !pf || (pf.startsWith('p:') ? a.fahrer === pf.slice(2) : (a.maschinen || []).includes(pf.slice(2)));
      const all = Store.all('auftraege').filter(match);
      const today = todayIso();
      let days = '';
      for (let i = 0; i < 7; i++) {
        const d = isoDate(addDays(ws, i));
        const items = all.filter(a => a.datum === d).sort((x, y) => (x.zeit || '99').localeCompare(y.zeit || '99'));
        const conf = {};
        items.filter(a => statusOf(a) === 'geplant').forEach(a => (a.maschinen || []).forEach(m => { conf[m] = (conf[m] || 0) + 1; }));
        days += `<section class="day ${d === today ? 'today' : ''}" data-drop="${d}" id="d-${d}">
          <h3>${fmtDate(d, { weekday: 'long' })} <small>${fmtDate(d, { day: '2-digit', month: '2-digit' })}</small></h3>
          <div class="slot">${items.length ? items.map(a => planCard(a, conf)).join('') : '<div class="none">—</div>'}</div></section>`;
      }
      const unpl = all.filter(a => !a.datum && statusOf(a) !== 'erledigt' && statusOf(a) !== 'verrechnet')
        .sort((x, y) => (!!y.prio - !!x.prio) || (x.wunschBis || x.wunschVon || '9999').localeCompare(y.wunschBis || y.wunschVon || '9999'));
      return `<div class="planwrap">
        <div class="week">${days}</div>
        <details class="unplanned" data-drop="" ${unpl.length && unpl.length < 6 ? 'open' : ''} ${window.innerWidth >= 1100 ? 'open' : ''}>
          <summary>Noch nicht eingeplant (${unpl.length})</summary>
          <div class="slot">${unpl.map(a => planCard(a, {})).join('') || '<div class="none">Alles eingeplant 👍</div>'}</div>
        </details></div>
        <p class="nr" style="margin-top:12px">${matchMedia('(pointer:fine)').matches ? 'Tipp: Aufträge mit der Maus auf einen Tag ziehen, um sie einzuplanen.' : 'Tipp: Auftrag antippen und unter «Geplant am» ein Datum setzen.'}</p>`;
    },
    after() {
      const sel = $('#pFilter');
      if (sel) {
        const ps = Store.all('personal').sort((a, b) => a.name.localeCompare(b.name));
        const ms = Store.all('maschinen').filter(m => m.aktiv !== false).sort((a, b) => (a.artNr || '').localeCompare(b.artNr || '', 'de', { numeric: true }));
        sel.innerHTML = `<option value="">Alle Fahrer & Maschinen</option>` +
          (ps.length ? `<optgroup label="Fahrer">${ps.map(p => `<option value="p:${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>` : '') +
          `<optgroup label="Maschinen">${ms.map(m => `<option value="m:${m.id}">${esc(m.name)}</option>`).join('')}</optgroup>`;
        sel.value = App.planFilter;
      }
      // Ziehen & Ablegen (Maus)
      $$('[draggable="true"]').forEach(el => el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; }));
      $$('[data-drop]').forEach(el => {
        el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop'); });
        el.addEventListener('dragleave', () => el.classList.remove('drop'));
        el.addEventListener('drop', e => {
          e.preventDefault(); el.classList.remove('drop');
          const a = Store.get('auftraege', e.dataTransfer.getData('text/plain')); if (!a) return;
          a.datum = el.dataset.drop || '';
          if (a.datum && statusOf(a) === 'offen') a.status = 'geplant';
          if (!a.datum && statusOf(a) === 'geplant') a.status = 'offen';
          Store.put('auftraege', { ...a });
        });
      });
      const t = document.getElementById('d-' + todayIso());
      if (t && window.innerWidth < 1100 && !App._scrolled) { App._scrolled = true; t.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }
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
      Store.all('auftraege').forEach(a => { const s = statusOf(a); if (s === 'offen' || s === 'geplant') open[a.kunde] = (open[a.kunde] || 0) + 1; });
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
      const list = Store.all('maschinen').sort((a, b) => (a.artNr || '').localeCompare(b.artNr || '', 'de', { numeric: true }) || a.name.localeCompare(b.name));
      if (!list.length) return '<div class="empty">Noch keine Maschinen erfasst.</div>';
      return `<div class="rows">${list.map(m => `
        <div class="rowi ${m.aktiv === false ? 'off' : ''}" data-act="editMaschine" data-id="${m.id}">
          <span class="num">${esc(m.artNr || '')}</span>
          <div class="grow"><div class="t">${esc(m.name)}</div><div class="s">Verrechnung pro ${esc(m.einheit || '—')}${m.ansatz ? ` · CHF ${fmtNum(m.ansatz)}` : ''}${m.aktiv === false ? ' · inaktiv' : ''}</div></div>
        </div>`).join('')}</div>
        <p class="nr" style="margin-top:10px">Art.-Nr. und Einheit erscheinen im Excel-Export – passend für die Rechnungsstellung.</p>`;
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
        <div class="panel"><h2>Fahrer / Personal</h2>
          ${ps.length ? `<div class="rows">${ps.map(p => `<div class="rowi" data-act="editPerson" data-id="${p.id}"><span class="who"><i style="background:${personColor(p.id)}"></i></span><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.tel || '')}</div></div></div>`).join('')}</div>` : '<p>Noch niemand erfasst.</p>'}
          <div class="btns"><button class="btn" data-act="editPerson">＋ Person</button></div></div>
      </div><div>
        <div class="panel"><h2>Export für Excel / Rechnung</h2>
          <p>Erledigte Aufträge als CSV – eine Zeile pro Maschine mit Art.-Nr., Menge und Einheit.</p>
          <div class="two" style="margin-top:10px">
            <label class="fld"><span>Von</span><input class="input" type="date" id="exVon" value="${y}-01-01"></label>
            <label class="fld"><span>Bis</span><input class="input" type="date" id="exBis" value="${todayIso()}"></label></div>
          <label class="fld"><span>Umfang</span><select class="input" id="exArt"><option value="offen">Nur noch nicht verrechnete</option><option value="alle">Alle erledigten und verrechneten</option></select></label>
          <label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="exMark"> Exportierte danach als «verrechnet» markieren</label>
          <div class="btns"><button class="btn primary" data-act="export">CSV herunterladen</button></div></div>
        <div class="panel"><h2>Datensicherung</h2>
          <p>Zusätzliche Sicherung aller Daten als Datei. Dropbox führt zudem selbst einen Versionsverlauf der Datendatei (30 Tage).</p>
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
  const s = statusOf(a);
  const ms = (a.maschinen || []).map(maschine).filter(Boolean);
  const conf = a.datum && s === 'geplant' ? machineConflicts(a.datum, a.id) : {};
  const hasConf = (a.maschinen || []).some(m => conf[m]);
  const date = a.datum ? `📅 ${fmtDate(a.datum)}${a.zeit ? ' ' + a.zeit : ''}` : (a.wunschVon || a.wunschBis ? `Wunsch ${[fmtDate(a.wunschVon, { day: '2-digit', month: '2-digit' }), fmtDate(a.wunschBis, { day: '2-digit', month: '2-digit' })].filter(Boolean).join('–')}` : 'nicht eingeplant');
  const pers = a.fahrer && Store.get('personal', a.fahrer);
  return `<article class="card ${a.prio ? 'prio' : ''}" data-act="editOrder" data-id="${a.id}">
    <div class="row1"><div class="title">${esc(kundeName(a.kunde))}</div><span class="badge ${s}">${STATUS[s]}</span></div>
    <div class="sub">${esc(a.arbeit || '—')}${a.menge ? ` · ${fmtNum(a.menge)} ${esc(a.einheit || '')}` : ''}${a.ort ? ` · ${esc(a.ort)}` : ''}</div>
    <div class="meta">
      <span class="chip">${date}</span>
      ${a.prio ? '<span class="chip warn">Dringend</span>' : ''}
      ${hasConf ? '<span class="chip warn">⚠ Maschine doppelt belegt</span>' : ''}
      ${ms.map(m => `<span class="chip">${esc(m.name)}</span>`).join('')}
      ${pers ? `<span class="who"><i style="background:${personColor(pers.id)}"></i>${esc(pers.name)}</span>` : ''}
      <span class="nr" style="margin-left:auto">${esc(a.nr || '')}</span>
    </div>
    ${s === 'geplant' || s === 'offen' ? `<div class="actions">
      ${(a.lat && a.lon) || a.ort ? `<a class="btn small" href="${mapsUrl(a.ort || kundeName(a.kunde), a.lat, a.lon)}" target="_blank" rel="noopener" data-stop>📍 Navigation</a>` : ''}
      <button class="btn small" data-act="done" data-id="${a.id}">✓ Erledigt</button></div>` : ''}
  </article>`;
}
function planCard(a, conf) {
  const s = statusOf(a);
  const pers = a.fahrer && Store.get('personal', a.fahrer);
  const ms = (a.maschinen || []).map(maschine).filter(Boolean);
  const dbl = (a.maschinen || []).some(m => conf[m] > 1) && s === 'geplant';
  return `<div class="pcard ${s} ${a.prio ? 'prio' : ''}" data-act="editOrder" data-id="${a.id}" ${s === 'erledigt' || s === 'verrechnet' ? '' : 'draggable="true"'}>
    <b>${a.zeit ? esc(a.zeit) + ' · ' : ''}${esc(kundeName(a.kunde))}</b>
    <div class="sub">${esc(a.arbeit || '')}${a.menge ? ` · ${fmtNum(a.menge)} ${esc(a.einheit || '')}` : ''}${a.ort ? ` · ${esc(a.ort)}` : ''}</div>
    <div class="meta">${ms.map(m => `<span class="chip">${esc(m.name)}</span>`).join('')}
      ${pers ? `<span class="who"><i style="background:${personColor(pers.id)}"></i>${esc(pers.name)}</span>` : ''}
      ${dbl ? '<span class="chip warn">⚠ doppelt</span>' : ''}${s === 'erledigt' ? '<span class="chip">✓</span>' : ''}</div>
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
    const first = this.form.querySelector('[autofocus]'); if (first && matchMedia('(pointer:fine)').matches) first.focus();
  },
  close() { this.el.close(); this.onSubmit = null; }
};

function orderDialog(id, { markDone } = {}) {
  const a = id ? structuredClone(Store.get('auftraege', id)) : { id: uid(), nr: Store.nextAuftragNr(), status: 'offen', maschinen: [], positionen: [] };
  if (!a) return;
  if (markDone) { a.status = 'erledigt'; a.erledigtAm = a.erledigtAm || todayIso(); }
  const kunden = Store.all('kunden').sort((x, y) => x.name.localeCompare(y.name, 'de'));
  const k = a.kunde && Store.get('kunden', a.kunde);
  const machines = Store.all('maschinen').filter(m => m.aktiv !== false || (a.maschinen || []).includes(m.id))
    .sort((x, y) => (x.artNr || '').localeCompare(y.artNr || '', 'de', { numeric: true }));
  const pers = Store.all('personal').sort((x, y) => x.name.localeCompare(y.name));
  const arbeiten = [...new Set([...ARBEITEN, ...Store.all('auftraege').map(x => x.arbeit).filter(Boolean)])];
  const s = statusOf(a);
  const body = `
    <label class="fld"><span>Kunde</span>
      <input class="input" name="kunde" list="dlKunden" value="${esc(k ? kundeLabel(k) : '')}" placeholder="Name eingeben oder auswählen" autocomplete="off" required ${id ? '' : 'autofocus'}>
      <datalist id="dlKunden">${kunden.map(k => `<option value="${esc(kundeLabel(k))}">`).join('')}</datalist>
      <div class="hint" id="kHint"></div></label>
    <label class="fld"><span>Arbeit</span>
      <input class="input" name="arbeit" list="dlArbeit" value="${esc(a.arbeit || '')}" placeholder="z.B. Mulchen" autocomplete="off">
      <datalist id="dlArbeit">${arbeiten.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
    <div class="fld"><span>Maschinen</span><div class="chips" id="mChips">${machines.map(m => `<label><input type="checkbox" name="m" value="${m.id}" ${(a.maschinen || []).includes(m.id) ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('') || '<span class="nr">Zuerst Maschinen erfassen.</span>'}</div>
      <div class="hint" id="mHint"></div></div>
    <div class="two">
      <label class="fld"><span>Ort / Parzelle</span><input class="input" name="ort" value="${esc(a.ort || '')}" placeholder="z.B. Feld Grossacker"></label>
      <label class="fld"><span>Fahrer</span><select class="input" name="fahrer"><option value="">—</option>${pers.map(p => `<option value="${p.id}" ${a.fahrer === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    </div>
    <div class="links" style="margin:-4px 0 12px"><a href="#" data-act="geo">📍 Aktuellen Standort übernehmen</a> <span class="nr" id="geoTxt">${a.lat ? `Standort gespeichert (${(+a.lat).toFixed(5)}, ${(+a.lon).toFixed(5)})` : ''}</span>
      <input type="hidden" name="lat" value="${esc(a.lat || '')}"><input type="hidden" name="lon" value="${esc(a.lon || '')}"></div>
    <div class="two">
      <label class="fld"><span>Menge (geplant)</span><input class="input" name="menge" inputmode="decimal" value="${a.menge ?? ''}" placeholder="z.B. 4.5"></label>
      <label class="fld"><span>Einheit</span><select class="input" name="einheit">${EINHEITEN.map(e => `<option ${(a.einheit || 'ha') === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
    </div>
    <div class="two">
      <label class="fld"><span>Wunschtermin ab</span><input class="input" type="date" name="wunschVon" value="${a.wunschVon || ''}"></label>
      <label class="fld"><span>Wunschtermin bis</span><input class="input" type="date" name="wunschBis" value="${a.wunschBis || ''}"></label>
    </div>
    <div class="three">
      <label class="fld"><span>Geplant am</span><input class="input" type="date" name="datum" value="${a.datum || ''}"></label>
      <label class="fld"><span>Zeit</span><input class="input" type="time" name="zeit" value="${a.zeit || ''}"></label>
      <label class="fld"><span>Dauer (h)</span><input class="input" name="dauer" inputmode="decimal" value="${a.dauer ?? ''}"></label>
    </div>
    <div class="two">
      <label class="fld"><span>Status</span><select class="input" name="status">${Object.entries(STATUS).map(([v, l]) => `<option value="${v}" ${s === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="fld"><span>Priorität</span><select class="input" name="prio"><option value="">Normal</option><option value="1" ${a.prio ? 'selected' : ''}>Dringend</option></select></label>
    </div>
    <div class="box" id="doneBox" ${s === 'erledigt' || s === 'verrechnet' ? '' : 'hidden'}>
      <h4>Ausführung</h4>
      <label class="fld"><span>Erledigt am</span><input class="input" type="date" name="erledigtAm" value="${a.erledigtAm || ''}"></label>
      <div id="posRows"></div>
    </div>
    <label class="fld"><span>Notizen</span><textarea class="input" name="notiz" placeholder="Zufahrt, Besonderheiten, Ansprechperson…">${esc(a.notiz || '')}</textarea></label>
    <p class="nr">Auftrag ${esc(a.nr || '')}</p>`;
  const footer = `${id ? `<button type="button" class="btn danger" data-act="delOrder" data-id="${a.id}">Löschen</button><button type="button" class="btn" data-act="dupOrder" data-id="${a.id}">Duplizieren</button>` : ''}
    <span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Speichern</button>`;

  Dlg.open(id ? 'Auftrag bearbeiten' : 'Neuer Auftrag', body, footer, fd => {
    const kTxt = (fd.get('kunde') || '').trim();
    let kunde = Store.all('kunden').find(k => kundeLabel(k) === kTxt) || Store.all('kunden').find(k => norm(k.name) === norm(kTxt));
    if (!kunde && kTxt) kunde = Store.put('kunden', { id: uid(), name: kTxt }, { silent: true });
    const o = Object.assign(a, {
      kunde: kunde?.id || '', arbeit: fd.get('arbeit').trim(), maschinen: fd.getAll('m'), ort: fd.get('ort').trim(),
      fahrer: fd.get('fahrer'), lat: fd.get('lat'), lon: fd.get('lon'), menge: num(fd.get('menge')), einheit: fd.get('einheit'),
      wunschVon: fd.get('wunschVon'), wunschBis: fd.get('wunschBis'), datum: fd.get('datum'), zeit: fd.get('zeit'), dauer: num(fd.get('dauer')),
      status: fd.get('status'), prio: !!fd.get('prio'), notiz: fd.get('notiz').trim(), erledigtAm: fd.get('erledigtAm') || ''
    });
    if (o.status === 'offen' && o.datum) o.status = 'geplant';
    if (o.status === 'geplant' && !o.datum) o.status = 'offen';
    if ((o.status === 'erledigt' || o.status === 'verrechnet')) {
      if (!o.erledigtAm) o.erledigtAm = o.datum || todayIso();
      if (!o.datum) o.datum = o.erledigtAm;
      o.positionen = o.maschinen.map(mid => ({ maschine: mid, menge: num(fd.get('pos_' + mid)) }));
    }
    Store.put('auftraege', o);
    toast('Auftrag gespeichert');
    return true;
  });

  // Live-Verhalten im Dialog
  const f = Dlg.form;
  const renderPos = () => {
    const sel = $$('input[name="m"]:checked', f).map(i => i.value);
    const old = Object.fromEntries((a.positionen || []).map(p => [p.maschine, p.menge]));
    $$('#posRows input', f).forEach(i => { old[i.name.slice(4)] = num(i.value); });
    const menge = num(f.menge.value), einheit = f.einheit.value, dauer = num(f.dauer.value);
    $('#posRows', f).innerHTML = sel.length ? sel.map(mid => {
      const m = maschine(mid); const u = m?.einheit || einheit;
      let v = old[mid]; if (v == null) v = u === einheit ? menge : (u === 'h' ? dauer : null);
      return `<div class="posrow"><span>${esc(m?.name || '?')}</span><input class="input" name="pos_${mid}" inputmode="decimal" value="${v ?? ''}"><span class="u">${esc(u)}</span></div>`;
    }).join('') : '<p class="nr">Keine Maschine gewählt – Menge oben unter «Menge» erfassen.</p>';
  };
  const checkKunde = () => {
    const t = f.kunde.value.trim();
    const known = !t || Store.all('kunden').some(k => kundeLabel(k) === t || norm(k.name) === norm(t));
    $('#kHint', f).textContent = known ? '' : 'Neuer Kunde – wird beim Speichern angelegt.';
  };
  const checkConf = () => {
    const d = f.datum.value; const sel = $$('input[name="m"]:checked', f).map(i => i.value);
    const used = d ? machineConflicts(d, a.id) : {};
    const c = sel.filter(m => used[m]).map(m => maschine(m)?.name);
    $('#mHint', f).textContent = c.length ? `⚠ Am ${fmtDate(d)} bereits eingeplant: ${c.join(', ')}` : '';
  };
  f.kunde.addEventListener('input', checkKunde);
  f.status.addEventListener('change', () => {
    const done = ['erledigt', 'verrechnet'].includes(f.status.value);
    $('#doneBox', f).hidden = !done;
    if (done && !f.erledigtAm.value) f.erledigtAm.value = f.datum.value || todayIso();
    renderPos();
  });
  $('#mChips', f).addEventListener('change', () => {
    const first = maschine($$('input[name="m"]:checked', f)[0]?.value);
    if (first && !f.menge.value) f.einheit.value = first.einheit || f.einheit.value;
    renderPos(); checkConf();
  });
  f.datum.addEventListener('change', checkConf);
  renderPos(); checkConf(); checkKunde();
  if (markDone) setTimeout(() => $('#doneBox', f)?.scrollIntoView({ block: 'center' }), 50);
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
  const footer = `${id ? `<button type="button" class="btn danger" data-act="delKunde" data-id="${k.id}">Löschen</button><button type="button" class="btn" data-act="newOrderFor" data-id="${k.id}">＋ Auftrag</button>` : ''}
    <span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Speichern</button>`;
  Dlg.open(id ? 'Kunde bearbeiten' : 'Neuer Kunde', body, footer, fd => {
    ['nr', 'name', 'adresse', 'plz', 'ort', 'tel', 'mail', 'notiz'].forEach(x => { k[x] = (fd.get(x) || '').trim(); });
    Store.put('kunden', k); return true;
  });
}

function maschineDialog(id) {
  const m = id ? { ...Store.get('maschinen', id) } : { id: uid(), einheit: 'ha', aktiv: true };
  const body = `
    <div class="two"><label class="fld"><span>Art.-Nr.</span><input class="input" name="artNr" value="${esc(m.artNr || '')}"></label>
      <label class="fld"><span>Einheit</span><select class="input" name="einheit">${EINHEITEN.map(e => `<option ${m.einheit === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label></div>
    <label class="fld"><span>Bezeichnung</span><input class="input" name="name" value="${esc(m.name || '')}" required autofocus></label>
    <label class="fld"><span>Ansatz CHF pro Einheit (optional)</span><input class="input" name="ansatz" inputmode="decimal" value="${m.ansatz ?? ''}"></label>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="aktiv" ${m.aktiv !== false ? 'checked' : ''}> Aktiv (in der Auswahl anzeigen)</label>`;
  const footer = `${id ? `<button type="button" class="btn danger" data-act="delMaschine" data-id="${m.id}">Löschen</button>` : ''}
    <span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Speichern</button>`;
  Dlg.open(id ? 'Maschine bearbeiten' : 'Neue Maschine', body, footer, fd => {
    Object.assign(m, { artNr: fd.get('artNr').trim(), name: fd.get('name').trim(), einheit: fd.get('einheit'), ansatz: num(fd.get('ansatz')), aktiv: !!fd.get('aktiv') });
    Store.put('maschinen', m); return true;
  });
}

function personDialog(id) {
  const p = id ? { ...Store.get('personal', id) } : { id: uid() };
  const body = `<label class="fld"><span>Name</span><input class="input" name="name" value="${esc(p.name || '')}" required autofocus></label>
    <label class="fld"><span>Telefon</span><input class="input" name="tel" type="tel" value="${esc(p.tel || '')}"></label>
    <label class="fld"><span>Farbe im Plan</span><input class="input" name="farbe" type="color" value="${esc(p.farbe || FARBEN[Store.all('personal').length % FARBEN.length])}" style="padding:4px;height:44px"></label>`;
  const footer = `${id ? `<button type="button" class="btn danger" data-act="delPerson" data-id="${p.id}">Löschen</button>` : ''}
    <span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Speichern</button>`;
  Dlg.open(id ? 'Person bearbeiten' : 'Neue Person', body, footer, fd => {
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
  const head = ['Auftrag-Nr', 'Datum', 'Kunden-Nr', 'Kunde', 'Ort Kunde', 'Arbeit', 'Parzelle', 'Art.-Nr', 'Maschine', 'Menge', 'Einheit', 'Ansatz CHF', 'Betrag CHF', 'Fahrer', 'Status', 'Notiz'];
  const rows = [head];
  list.forEach(a => {
    const k = Store.get('kunden', a.kunde) || {}; const p = Store.get('personal', a.fahrer);
    const pos = (a.positionen && a.positionen.length) ? a.positionen : (a.maschinen?.length ? a.maschinen.map(m => ({ maschine: m, menge: a.menge })) : [{ maschine: '', menge: a.menge }]);
    pos.forEach(ps => {
      const m = maschine(ps.maschine) || {};
      const betrag = m.ansatz && ps.menge != null ? Math.round(m.ansatz * ps.menge * 100) / 100 : '';
      rows.push([a.nr, a.erledigtAm || a.datum, k.nr, k.name, k.ort, a.arbeit, a.ort, m.artNr, m.name, ps.menge ?? '', m.einheit || a.einheit, m.ansatz ?? '', betrag, p?.name, STATUS[statusOf(a)], a.notiz]);
    });
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
  const act = t.dataset.act, id = t.dataset.id;
  if (t.tagName === 'A') e.preventDefault();
  switch (act) {
    case 'close': Dlg.close(); break;
    case 'sync': if (!Auth.configured()) { App.go('mehr'); toast('Dropbox ist noch nicht eingerichtet.'); } else if (!Auth.hasSession()) Auth.login(); else Sync.run(); break;
    case 'login': Auth.login(); break;
    case 'logout': if (confirm('Abmelden? Die Daten bleiben auf diesem Gerät erhalten.')) Auth.logout(); break;
    case 'newOrder': orderDialog(); break;
    case 'newOrderFor': { const kid = id; Dlg.close(); orderDialog(); const k = Store.get('kunden', kid); if (k) { Dlg.form.kunde.value = kundeLabel(k); } break; }
    case 'editOrder': orderDialog(id); break;
    case 'done': e.stopPropagation(); orderDialog(id, { markDone: true }); break;
    case 'dupOrder': { const a = structuredClone(Store.get('auftraege', id)); Object.assign(a, { id: uid(), nr: Store.nextAuftragNr(), status: 'offen', datum: '', zeit: '', erledigtAm: '', positionen: [] }); Store.put('auftraege', a); Dlg.close(); orderDialog(a.id); toast('Kopie erstellt'); break; }
    case 'delOrder': if (confirm('Auftrag löschen?')) { Store.remove('auftraege', id); Dlg.close(); } break;
    case 'aFilter': App.filter.auftraege = t.dataset.v; App.render(); break;
    case 'week': { const d = +t.dataset.d; App.weekStart = d ? addDays(App.weekStart, d) : mondayOf(new Date()); App._scrolled = !!d; App.render(); break; }
    case 'editKunde': kundeDialog(id); break;
    case 'delKunde': {
      const n = Store.all('auftraege').filter(a => a.kunde === id).length;
      if (confirm(n ? `Dieser Kunde hat ${n} Aufträge. Trotzdem löschen?` : 'Kunde löschen?')) { Store.remove('kunden', id); Dlg.close(); } break;
    }
    case 'importKunden': importKunden(); break;
    case 'editMaschine': maschineDialog(id); break;
    case 'delMaschine': if (confirm('Maschine löschen? (Tipp: «inaktiv» setzen behält sie in alten Aufträgen sichtbar)')) { Store.remove('maschinen', id); Dlg.close(); } break;
    case 'editPerson': personDialog(id); break;
    case 'delPerson': if (confirm('Person löschen?')) { Store.remove('personal', id); Dlg.close(); } break;
    case 'export': exportCsv(); break;
    case 'backup': download(`Lohnarbeit-Sicherung_${todayIso()}.json`, JSON.stringify(Store.data, null, 1), 'application/json'); break;
    case 'restore': restoreBackup(); break;
    case 'geo': {
      if (!navigator.geolocation) { toast('Standort nicht verfügbar'); break; }
      $('#geoTxt').textContent = 'Standort wird ermittelt…';
      navigator.geolocation.getCurrentPosition(p => {
        const f = Dlg.form; f.lat.value = p.coords.latitude.toFixed(6); f.lon.value = p.coords.longitude.toFixed(6);
        $('#geoTxt').textContent = `Standort gespeichert (±${Math.round(p.coords.accuracy)} m)`;
      }, err => { $('#geoTxt').textContent = 'Standort nicht erlaubt/verfügbar'; }, { enableHighAccuracy: true, timeout: 15000 });
      break;
    }
  }
});
document.addEventListener('input', e => {
  const k = e.target.dataset.in; if (!k) return;
  if (k === 'aSearch') { App.filter.q = e.target.value; App.render(); }
  if (k === 'kSearch') { App.filter.kq = e.target.value; App.render(); }
});
document.addEventListener('change', e => { if (e.target.dataset.in === 'planFilter') { App.planFilter = e.target.value; App.render(); } });

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
  setInterval(() => { if (document.visibilityState === 'visible') Sync.run(); }, 60000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
