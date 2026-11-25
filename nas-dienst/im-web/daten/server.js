'use strict';
/* im-daten v1.1 – Datenquelle NAS für den Notbetrieb der IM-Programme (Teil von im-web).
   Bildet die wenigen Dropbox-Befehle nach, die IM-Verwaltung, IM-Vermietung, IM-Faktura und die Startseite brauchen,
   und arbeitet direkt im Cloud-Sync-Ordner des Dropbox-App-Ordners auf dem NAS (/daten im Container).
   Cloud Sync (bidirektional) bringt Änderungen später wieder in die Dropbox.
   Erreichbar nur über nginx unter /im-daten/ (gleiche Adresse wie die Programme), geschützt mit Schlüssel (Header X-IM-Schluessel).
   Keine Fremdbibliotheken. */
const http = require('http'), fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto');

const VERSION = '1.1', STAND = '25.11.2026';
const ROOT = path.resolve(process.env.DATEN || '/daten');
const KEY = (process.env.NAS_SCHLUESSEL || '').trim();
const PORT = +(process.env.PORT || 8790);
const MAX_BODY = 300 * 1024 * 1024;
const KENNDATEIEN = ['planung.json', 'vermietung.json', 'faktura.json']; // mindestens eine muss im Ordner liegen

const keyOk = () => KEY.length >= 6 && !/HIER/i.test(KEY);
const log = (...a) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a);

/* ---------- Hilfen ---------- */
const send = (res, code, obj, hdr = {}) => {
  const body = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, hdr));
  res.end(body);
};
const fehler = (res, summary, code = 409) => send(res, code, { error_summary: summary, error: { '.tag': summary.split('/')[0] } });
const hdrJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const isoZ = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
const revOf = buf => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
const REVS = new Map(); // rev → Dropbox-Pfad (für download mit «rev:…»)

function body(req) {
  return new Promise((ok, nok) => {
    const parts = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { nok(new Error('zu gross')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts))); req.on('error', nok);
  });
}
function argOf(req, buf) {
  const h = req.headers['dropbox-api-arg'];
  if (h) return JSON.parse(h);
  if (buf && buf.length) return JSON.parse(buf.toString('utf8'));
  return {};
}

/* Dropbox-Pfad → Datei auf dem NAS. Dropbox unterscheidet Gross/Klein nicht, das NAS schon:
   jedes Stück wird zuerst genau, sonst ohne Rücksicht auf Gross/Klein gesucht. */
function teile(p) {
  const s = String(p || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (s.some(x => x === '..' || x === '.')) throw new Error('ungültiger Pfad');
  return s;
}
async function finde(p) {
  let cur = ROOT;
  for (const t of teile(p)) {
    const exakt = path.join(cur, t);
    try { await fsp.lstat(exakt); cur = exakt; continue; } catch { }
    let liste; try { liste = await fsp.readdir(cur); } catch { return null; }
    const m = liste.find(x => x.toLowerCase() === t.toLowerCase());
    if (!m) return null;
    cur = path.join(cur, m);
  }
  return cur;
}
async function zielPfad(p) { // für neue Dateien: vorhandene Ordner mit ihrer Schreibweise übernehmen
  const s = teile(p); if (!s.length) throw new Error('ungültiger Pfad');
  let cur = ROOT;
  for (let i = 0; i < s.length; i++) {
    const t = s[i], exakt = path.join(cur, t);
    let gefunden = null;
    try { await fsp.lstat(exakt); gefunden = exakt; } catch {
      try { const m = (await fsp.readdir(cur)).find(x => x.toLowerCase() === t.toLowerCase()); if (m) gefunden = path.join(cur, m); } catch { }
    }
    cur = gefunden || exakt;
  }
  if (!cur.startsWith(ROOT + path.sep)) throw new Error('ungültiger Pfad');
  return cur;
}
const dbxPfad = abs => '/' + path.relative(ROOT, abs).split(path.sep).join('/');

async function meta(abs, mitRev = true) {
  const st = await fsp.stat(abs), p = dbxPfad(abs);
  const m = { name: path.basename(abs), path_lower: p.toLowerCase(), path_display: p, id: 'id:' + crypto.createHash('sha1').update(p.toLowerCase()).digest('hex').slice(0, 22) };
  if (st.isDirectory()) return Object.assign({ '.tag': 'folder' }, m);
  const f = Object.assign({ '.tag': 'file' }, m, { client_modified: isoZ(st.mtime), server_modified: isoZ(st.mtime), size: st.size, is_downloadable: true });
  if (mitRev) { f.rev = revOf(await fsp.readFile(abs)); REVS.set(f.rev, p); }
  return f;
}
const versteckt = n => n.startsWith('.') || n === '@eaDir' || n === '#recycle' || n.endsWith('.im-tmp');

async function schreibe(abs, buf) {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), '.' + path.basename(abs) + '.' + process.pid + '.im-tmp');
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, abs);
}

async function ordnerOk() {
  try { const l = (await fsp.readdir(ROOT)).map(x => x.toLowerCase()); return KENNDATEIEN.some(k => l.includes(k)); } catch { return false; }
}

/* ---------- Befehle ---------- */
const R = {
  async 'oauth2/token'(req, res) { send(res, 200, { access_token: 'nas', token_type: 'bearer', expires_in: 300 }); },
  async '2/users/get_current_account'(req, res) { send(res, 200, { account_id: 'nas', name: { display_name: 'NAS (Notbetrieb)', given_name: 'NAS', surname: '' }, email: '' }); },
  async '2/auth/token/revoke'(req, res) { send(res, 200, null); },

  async '2/files/get_metadata'(req, res, buf) {
    const a = argOf(req, buf); const abs = await finde(a.path);
    if (!abs) return fehler(res, 'path/not_found/');
    send(res, 200, await meta(abs));
  },

  async '2/files/download'(req, res, buf) {
    const a = argOf(req, buf); let p = a.path || '';
    if (/^rev:/.test(p)) { const r = p.slice(4); p = REVS.get(r); if (!p) return fehler(res, 'path/not_found/'); }
    const abs = await finde(p);
    if (!abs) return fehler(res, 'path/not_found/');
    const st = await fsp.stat(abs); if (st.isDirectory()) return fehler(res, 'path/not_file/');
    const data = await fsp.readFile(abs), m = await meta(abs, false); m.rev = revOf(data); REVS.set(m.rev, m.path_display);
    if (/^rev:/.test(a.path || '') && a.path.slice(4) !== m.rev) return fehler(res, 'path/not_found/'); // ältere Fassung gibt es auf dem NAS nicht
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Dropbox-API-Result': hdrJson(m), 'Content-Length': data.length });
    res.end(data);
  },

  async '2/files/upload'(req, res, buf) {
    const a = JSON.parse(req.headers['dropbox-api-arg'] || '{}');
    const mode = typeof a.mode === 'string' ? { '.tag': a.mode } : (a.mode || { '.tag': 'add' });
    const vorhanden = await finde(a.path);
    if (vorhanden) {
      const alt = await fsp.readFile(vorhanden);
      if (mode['.tag'] === 'add' && !a.autorename) return fehler(res, 'path/conflict/file/');
      if (mode['.tag'] === 'update' && revOf(alt) !== mode.update) return fehler(res, 'path/conflict/file/');
    }
    const abs = vorhanden || await zielPfad(a.path);
    await schreibe(abs, buf);
    const m = await meta(abs);
    log('gespeichert', m.path_display, buf.length + ' Bytes');
    send(res, 200, m);
  },

  async '2/files/list_folder'(req, res, buf) {
    const a = argOf(req, buf); const abs = a.path ? await finde(a.path) : ROOT;
    if (!abs) return fehler(res, 'path/not_found/');
    const out = [];
    const walk = async (d, tief) => {
      for (const n of (await fsp.readdir(d)).sort()) {
        if (versteckt(n)) continue;
        const x = path.join(d, n), m = await meta(x, false);
        if (m['.tag'] === 'file') { m.rev = revOf(await fsp.readFile(x)); REVS.set(m.rev, m.path_display); }
        out.push(m);
        if (tief && m['.tag'] === 'folder') await walk(x, true);
      }
    };
    await walk(abs, !!a.recursive);
    send(res, 200, { entries: out, cursor: 'nas', has_more: false });
  },
  async '2/files/list_folder/continue'(req, res) { send(res, 200, { entries: [], cursor: 'nas', has_more: false }); },

  async '2/files/delete_v2'(req, res, buf) {
    const a = argOf(req, buf); const abs = await finde(a.path);
    if (!abs || abs === ROOT) return fehler(res, 'path_lookup/not_found/');
    const m = await meta(abs, false);
    await fsp.rm(abs, { recursive: true, force: true });
    log('gelöscht', m.path_display);
    send(res, 200, { metadata: m });
  }
};

/* ---------- Server ---------- */
http.createServer(async (req, res) => {
  const route = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+|\/+$/g, '');
  try {
    if (route === 'status') {
      return send(res, 200, { imDaten: true, version: VERSION, stand: STAND, ordnerOk: await ordnerOk(), schluesselGesetzt: keyOk(), zeit: new Date().toISOString() });
    }
    if (req.method !== 'POST') return send(res, 405, { error_summary: 'nur POST' });
    if (!keyOk()) return send(res, 503, { error_summary: 'nas/schluessel_fehlt/', hinweis: 'NAS_SCHLUESSEL in docker-compose.yml setzen' });
    if ((req.headers['x-im-schluessel'] || '') !== KEY) return send(res, 403, { error_summary: 'nas/schluessel_falsch/' });
    if (!await ordnerOk()) return send(res, 503, { error_summary: 'nas/datenordner_fehlt/', hinweis: 'Datenordner in docker-compose.yml prüfen' });
    const f = R[route];
    if (!f) return fehler(res, 'nas/nicht_unterstuetzt/' + route);
    const buf = await body(req);
    await f(req, res, buf);
  } catch (e) {
    log('Fehler', route, e.message);
    if (!res.headersSent) send(res, 500, { error_summary: 'nas/fehler/' + e.message });
  }
}).listen(PORT, async () => {
  log(`im-daten v${VERSION} läuft auf Port ${PORT}, Datenordner ${ROOT}`);
  if (!keyOk()) log('WARNUNG: NAS_SCHLUESSEL fehlt – Zugriff gesperrt');
  if (!await ordnerOk()) log('WARNUNG: im Datenordner liegt keine ' + KENNDATEIEN.join('/') + ' – Pfad in docker-compose.yml prüfen');
});
