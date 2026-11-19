/* IM-Faktura – Grundfunktionen: Dropbox-Anmeldung und -Abgleich, Excel lesen/schreiben (übernommen aus IM-Vermietung, Schlüssel mf_*) */
'use strict';
/* ================= Dropbox-Anmeldung (OAuth 2.0 + PKCE, ohne Server) ================= */
const Auth = {
  configured() { return /^[a-z0-9]{8,30}$/i.test(CFG.appKey || ''); },
  redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ''); },
  tokens() { return lsJson('mf_tok'); },
  hasSession() { const t = this.tokens(); return !!(t && (t.refresh || t.access)); },
  b64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  async login() {
    if (!this.configured()) { toast('Zuerst den App-Key in config.js eintragen.'); return; }
    if (!window.crypto?.subtle) { toast('Anmeldung nur über https möglich.'); return; }
    const verifier = this.b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = this.b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = this.b64url(crypto.getRandomValues(new Uint8Array(16)));
    lsJson('mf_pkce', { verifier, state });
    const p = new URLSearchParams({ client_id: CFG.appKey, response_type: 'code', redirect_uri: this.redirectUri(), state, code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline' });
    location.assign(`https://www.dropbox.com/oauth2/authorize?${p}`);
  },
  async handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    history.replaceState(null, '', this.redirectUri());
    if (q.has('error')) { toast('Anmeldung abgebrochen: ' + (q.get('error_description') || q.get('error')), 6000); return; }
    const pk = lsJson('mf_pkce'); ls('mf_pkce', null);
    if (!pk || pk.state !== q.get('state')) { toast('Anmeldung ungültig – bitte nochmals versuchen.'); return; }
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CFG.appKey, grant_type: 'authorization_code', code: q.get('code'), redirect_uri: this.redirectUri(), code_verifier: pk.verifier }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast('Anmeldung fehlgeschlagen: ' + (j.error_description || j.error || r.status), 8000); return; }
    this.store(j);
    try { const me = await (await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { Authorization: 'Bearer ' + j.access_token } })).json(); ls('mf_user', me.name?.display_name || me.email || ''); } catch {}
    toast('Mit Dropbox verbunden');
  },
  store(j) { lsJson('mf_tok', { access: j.access_token, refresh: j.refresh_token || this.tokens()?.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 }); },
  async token() {
    const t = this.tokens(); if (!t) return null;
    if (t.access && t.exp - 120000 > Date.now()) return t.access;
    if (!t.refresh) return null;
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CFG.appKey, grant_type: 'refresh_token', refresh_token: t.refresh }) });
    if (r.status === 400 || r.status === 401) { ls('mf_tok', null); return null; }
    if (!r.ok) throw new Error('Dropbox nicht erreichbar (' + r.status + ')');
    const j = await r.json(); this.store(j); return j.access_token;
  },
  async logout() {
    const t = this.tokens();
    if (t?.access && navigator.onLine) { try { await fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t.access } }); } catch {} }
    ls('mf_tok', null); ls('mf_user', null); Sync.setState('login'); App.render();
  }
};
const Drive = {
  path() { const p = (CFG.dataPath || '/faktura.json').trim(); return p.startsWith('/') ? p : '/' + p; },
  async req(url, opt = {}) {
    const t = await Auth.token(); if (!t) { const e = new Error('Bitte bei Dropbox anmelden'); e.auth = true; throw e; }
    opt.headers = Object.assign({}, opt.headers, { Authorization: 'Bearer ' + t });
    const r = await fetch(url, Object.assign({ method: 'POST', cache: 'no-store' }, opt));
    if (r.status === 401) { ls('mf_tok', null); const e = new Error('Bitte bei Dropbox anmelden'); e.auth = true; throw e; }
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
  async loadPath(path) { // fremde Datei im selben App-Ordner nur lesen (z. B. /vermietung.json, /planung.json)
    const r = await this.req('https://content.dropboxapi.com/2/files/download', { headers: { 'Dropbox-API-Arg': dbxArg({ path }) } });
    if (r.status === 409) return null;
    if (!r.ok) throw new Error('Dropbox: ' + path + ' nicht lesbar (' + r.status + ')');
    return JSON.parse((await r.text()) || '{}');
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
  schedule(ms = 1500) { ls('mf_dirty', '1'); this.setState(); clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); },
  setState(s) {
    if (s) this.state = s;
    const dirty = !!ls('mf_dirty'); let cls = '', txt = '';
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
      ls('mf_dirty', null); this.last = new Date(); this.setState('ok');
    } catch (e) {
      this.err = e.message || String(e); this.setState(e.auth ? 'login' : (navigator.onLine ? 'error' : 'offline'));
    } finally { this.running = false; if (this.again) { this.again = false; this.run(); } }
  }
};

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

