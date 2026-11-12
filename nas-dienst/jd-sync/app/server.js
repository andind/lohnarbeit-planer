/* jd-sync – Abgleich MyJohnDeere → IM-Verwalter
   Läuft als Container auf dem NAS. Liest Mandanten (Clients), Betriebe (Farms) und Felder mit Fläche (Kunden = Mandanten oder Betriebe, automatisch erkannt)
   aus dem John Deere Operations Center und schreibt sie als «jd-sync.json» in den Dropbox-App-Ordner des IM-Verwalters.
   Zusätzlich (unabhängig davon) die Arbeitsgänge (Field Operations) mit Messwerten als «jd-arbeiten.json» –
   für das Modul Bericht im IM-Verwalter.
   Dazu: tägliche Datensicherung der IM-Verwalter-Daten (NAS und Dropbox) und wöchentlicher Excel-Export aller Daten.
   Keine externen Abhängigkeiten (Node 18+). */
'use strict';
const VERSION = '55', STAND = '12.11.2026'; // v53: Bedeckung ohne Überlappungen, virtuelle Feldgrenzen, neue Operations-Data-Export-API · v54: WGS84-Ellipsoid statt Kugel · v55: virtuelle Feldgrenze ohne Randzuschlag // gleiche Nummer wie der IM-Verwalter (APP_VERSION)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = process.env.DATA_DIR || '/data';
const PORT = +(process.env.PORT || 8787);
const UI_PASSWORD = process.env.UI_PASSWORD || '';
// Endpunkte (für Tests überschreibbar)
const JD_WELLKNOWN = process.env.JD_WELLKNOWN || 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/.well-known/oauth-authorization-server';
const DBX_AUTH = process.env.DBX_AUTH || 'https://www.dropbox.com/oauth2/authorize';
const DBX_API = process.env.DBX_API || 'https://api.dropboxapi.com';
const DBX_CONTENT = process.env.DBX_CONTENT || 'https://content.dropboxapi.com';
const ACCEPT = 'application/vnd.deere.axiom.v3+json';
const SCOPES = 'ag1 ag2 eq1 offline_access'; // ag2 = Arbeitsdaten (Field Operations), eq1 = Maschinenliste (Namen)
const SCOPES_OLD = 'ag1 offline_access';

/* ---------- Speicher ---------- */
const file = n => path.join(DATA, n);
const load = (n, def) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return def; } };
const save = (n, v) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(file(n) + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(file(n) + '.tmp', file(n)); };
const cfgFile = load('config.json', {});
let cfg = Object.assign({ syncMode: 'zeiten', syncZeiten: '05:00', syncIntervall: 3, syncVon: '06:00', syncBis: '20:00',
  sicherungAktiv: true, sicherungZeit: '00:00', sicherungNas: true, sicherungDbx: true, sicherungDbxPfad: '/Sicherungen', datenPfad: '/planung.json', behaltTage: 30, behaltMonate: 24,
  excelAktiv: true, excelTag: 1, excelPfad: '/Sicherungen/Excel', excelBehalt: 26, apiBase: 'https://partnerapi.deere.com/platform', redirectUri: 'http://localhost:9090/callback', syncHour: 5, pollMinutes: 5, clientId: '', clientSecret: '', dbxAppKey: '', orgId: '', orgName: '', kundenEbene: 'auto', syncPath: '/jd-sync.json', requestPath: '/jd-sync-request.json', arbeitenAktiv: true, arbeitenSeit: (new Date().getFullYear() - 1) + '-01-01', arbeitenPath: '/jd-arbeiten.json' }, load('config.json', {}));
// frühere Einstellung «täglich um Stunde» übernehmen
if (cfgFile.syncZeiten === undefined && cfgFile.syncHour != null) cfg.syncZeiten = String(cfgFile.syncHour).padStart(2, '0') + ':00';
let st = Object.assign({ jd: null, dbx: null, last: null, lastOk: null, running: false, log: [], orgs: [], pending: {} }, load('state.json', {}));
st.arbProgress = null; // nach einem Neustart läuft nichts mehr
process.on('unhandledRejection', e => { try { log('Unerwarteter Fehler: ' + (e && e.message || e)); } catch { } });
st.running = false;
const saveCfg = () => save('config.json', cfg);
const saveSt = () => save('state.json', st);
function log(msg) {
  const line = `${new Date().toLocaleString('de-CH', { timeZone: process.env.TZ || 'Europe/Zurich' })}  ${msg}`;
  console.log(line); st.log.unshift(line); st.log = st.log.slice(0, 300); saveSt();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- John Deere: Anmeldung ---------- */
let wk = null;
async function wellknown() { if (!wk) { const r = await fetch(JD_WELLKNOWN); if (!r.ok) throw new Error('John Deere Anmeldedienst nicht erreichbar (' + r.status + ')'); wk = await r.json(); } return wk; }
async function jdAuthUrl() {
  const w = await wellknown(), state = crypto.randomBytes(12).toString('hex');
  st.pending.jdState = state; saveSt();
  const p = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: SCOPES, state });
  return `${w.authorization_endpoint}?${p}`;
}
async function jdToken(params) {
  const w = await wellknown();
  const r = await fetch(w.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64') },
    body: new URLSearchParams(params)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('John Deere: ' + (j.error_description || j.error || r.status));
  st.jd = { access: j.access_token, refresh: j.refresh_token || st.jd?.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000,
    scope: j.scope || (params.grant_type === 'authorization_code' ? SCOPES : (st.jd?.scope || SCOPES_OLD)) };
  saveSt();
}
async function jdCodeFromUrl(input) {
  let code = input.trim(), state = null;
  if (/^https?:/i.test(code) || code.includes('code=')) {
    const u = new URL(code.includes('://') ? code : 'http://x/?' + code.replace(/^\?/, ''));
    code = u.searchParams.get('code'); state = u.searchParams.get('state');
    if (u.searchParams.get('error')) throw new Error('John Deere: ' + (u.searchParams.get('error_description') || u.searchParams.get('error')));
  }
  if (!code) throw new Error('Kein Code gefunden – bitte die ganze Adresse aus der Browserzeile einfügen.');
  if (state && st.pending.jdState && state !== st.pending.jdState) throw new Error('Anmeldung veraltet – bitte nochmals «Bei John Deere anmelden» wählen.');
  await jdToken({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri });
  delete st.pending.jdState; saveSt();
  log('John Deere: angemeldet');
  await loadOrgs();
}
async function jdAccess() {
  if (!st.jd) throw new Error('Nicht bei John Deere angemeldet');
  if (st.jd.access && st.jd.exp - 120000 > Date.now()) return st.jd.access;
  if (!st.jd.refresh) throw new Error('John Deere: Anmeldung abgelaufen – bitte neu anmelden');
  await jdToken({ grant_type: 'refresh_token', refresh_token: st.jd.refresh, scope: st.jd.scope || SCOPES_OLD, redirect_uri: cfg.redirectUri });
  return st.jd.access;
}
/* ---------- John Deere: Abfragen ---------- */
let reqCount = 0;
async function jdGet(url, tries = 0, quiet400 = false) {
  const full = /^https?:/.test(url) ? url : cfg.apiBase.replace(/\/$/, '') + url;
  const r = await fetch(full, { headers: { Authorization: 'Bearer ' + await jdAccess(), Accept: ACCEPT } });
  reqCount++;
  if (r.status === 401 && tries < 1) { st.jd.exp = 0; return jdGet(url, tries + 1, quiet400); }
  if ((r.status === 429 || r.status >= 500) && tries < 5) { await sleep((+r.headers.get('retry-after') || 3 * (tries + 1)) * 1000); return jdGet(url, tries + 1, quiet400); }
  if (quiet400 && r.status === 400) throw Object.assign(new Error('400'), { status: 400 });
  if (r.status === 403) { const t = await r.text(); throw Object.assign(new Error('Kein Zugriff (403) auf ' + full + ' – Organisation freigegeben? ' + t.slice(0, 200)), { status: 403 }); }
  if (!r.ok) throw Object.assign(new Error(`John Deere ${r.status} bei ${full}`), { status: r.status });
  return r.json();
}
const link = (o, rel) => ((o && o.links) || []).find(l => l.rel === rel)?.uri;
async function jdAll(url, quiet400) { // alle Seiten einer Liste
  const out = []; let next = url, guard = 0;
  while (next && guard++ < 500) { const j = await jdGet(next, 0, quiet400); out.push(...(j.values || [])); next = link(j, 'nextPage'); }
  return out;
}
async function loadOrgs() {
  const orgs = await jdAll('/organizations');
  st.orgs = orgs.map(o => ({ id: String(o.id), name: o.name, connect: link(o, 'connections') || '' }));
  saveSt();
  const usable = st.orgs.filter(o => !o.connect);
  if (!cfg.orgId && usable.length === 1) { cfg.orgId = usable[0].id; cfg.orgName = usable[0].name; saveCfg(); log(`Organisation «${cfg.orgName}» gewählt`); }
  log(`John Deere: ${st.orgs.length} Organisation(en) gefunden`);
}
const idOf = v => v == null ? '' : String(typeof v === 'object' ? (v.id ?? '') : v);
const lastId = uri => (uri || '').split('?')[0].replace(/\/+$/, '').split('/').pop();
const embedded = (o, key) => { const v = o && o[key]; if (!v) return []; return Array.isArray(v) ? v : (Array.isArray(v.values) ? v.values : [v]); };
function areaHa(a) {
  if (!a) return null;
  const v = a.valueAsDouble ?? a.value; if (v == null || isNaN(+v)) return null;
  const u = String(a.unit || 'ha').toLowerCase();
  const ha = u === 'ha' ? +v : u === 'ac' ? +v * 0.40468564 : (u === 'm2' || u === 'sqm') ? +v / 10000 : +v;
  return Math.round(ha * 100) / 100;
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

// Rohdaten-Ausschnitt für die Diagnose (Links nur als rel → uri)
const sample = o => o && JSON.parse(JSON.stringify(o, (k, v) => k === 'links' && Array.isArray(v) ? v.map(l => `${l.rel} → ${l.uri}`) : v));
async function readJohnDeere() {
  const org = cfg.orgId; if (!org) throw new Error('Keine Organisation gewählt');
  reqCount = 0;
  const diag = { at: new Date().toISOString(), org };
  // 1) Mandanten
  const rawClients = await jdAll(`/organizations/${org}/clients`);
  diag.clients = { count: rawClients.length, sample: rawClients.slice(0, 3).map(sample) };
  const clientsById = new Map(rawClients.map(c => [idOf(c.id), { id: idOf(c.id), name: (c.name || '').trim(), archived: !!c.archived, raw: c }]));
  // 2) Betriebe je Mandant (Mandant › Betrieb › Feld)
  const farmsById = new Map();
  const addFarm = (fa, client) => { const id = idOf(fa.id); if (!id) return; const old = farmsById.get(id); farmsById.set(id, { id, name: (fa.name || '').trim() || old?.name || '', client: client || old?.client || '', archived: !!fa.archived, raw: fa }); };
  await pool([...clientsById.values()], 4, async c => {
    try { (await jdAll(link(c.raw, 'farms') || `/organizations/${org}/clients/${encodeURIComponent(c.id)}/farms`)).forEach(fa => addFarm(fa, c.id)); }
    catch (e) { if (e.status === 403) throw e; log(`Betriebe von «${c.name}»: ${e.message}`); }
  });
  try { // Betriebe der Organisation (erfasst auch Betriebe, die oben fehlen)
    for (const fa of await jdAll(`/organizations/${org}/farms`)) { const cl = embedded(fa, 'clients')[0] || embedded(fa, 'client')[0]; addFarm(fa, idOf(cl)); }
  } catch (e) { if (e.status === 403) throw e; log('Betriebe der Organisation: ' + e.message); }
  diag.farms = { count: farmsById.size, sample: [...farmsById.values()].slice(0, 3).map(f => sample(f.raw)) };
  // 3) Felder der Organisation (Name, Archiv, Grenzen)
  const raw = await jdAll(`/organizations/${org}/fields?embed=clients,farms`);
  diag.fields = { count: raw.length, sample: raw.slice(0, 3).map(sample) };
  const fields = raw.map(f => {
    const cl = embedded(f, 'clients')[0], fa = embedded(f, 'farms')[0];
    if (fa) addFarm(fa, idOf(cl));
    return { raw: f, id: idOf(f.id), name: (f.name || '').trim(), client: idOf(cl), farm: idOf(fa), archived: !!f.archived };
  });
  const byId = new Map(fields.map(f => [f.id, f]));
  // 4) Zuordnung Feld → Betrieb → Mandant über die Felder je Betrieb
  if (fields.some(f => !f.farm || !f.client)) {
    await pool([...farmsById.values()], 4, async fa => {
      let list; try { list = await jdAll(link(fa.raw, 'fields') || `/organizations/${org}/farms/${encodeURIComponent(fa.id)}/fields`); }
      catch (e) { if (e.status === 403) throw e; log(`Felder von Betrieb «${fa.name}»: ${e.message}`); return; }
      for (const x of list) { const f = byId.get(idOf(x.id)); if (!f) continue; f.farm = f.farm || fa.id; f.client = f.client || fa.client; }
    });
  }
  // 5) Restliche Felder über ihre eigenen Verknüpfungen
  const missing = fields.filter(f => !f.client || !f.farm);
  if (missing.length) {
    log(`Zuordnung über Verknüpfungen für ${missing.length} Felder`);
    await pool(missing, 4, async f => {
      try {
        const fu = link(f.raw, 'farms') || link(f.raw, 'farm');
        if (fu && !f.farm) { const j = await jdGet(fu); const fa = (j.values || [j])[0]; if (fa) { addFarm(fa); f.farm = idOf(fa.id); } }
        const cu = link(f.raw, 'clients') || link(f.raw, 'client');
        if (cu && !f.client) { const j = await jdGet(cu); const c = (j.values || [j])[0]; f.client = idOf(c && c.id) || lastId(cu); }
        if (!f.client && f.farm) f.client = farmsById.get(f.farm)?.client || '';
      } catch (e) { if (e.status === 403) throw e; }
    });
  }
  // Mandanten, die nur über Felder/Betriebe bekannt sind, nachladen
  const unknown = [...new Set([...fields.map(f => f.client), ...[...farmsById.values()].map(f => f.client)].filter(id => id && !clientsById.has(id)))];
  await pool(unknown, 4, async id => {
    try { const c = await jdGet(`/organizations/${org}/clients/${encodeURIComponent(id)}`); clientsById.set(id, { id, name: (c.name || '').trim(), archived: !!c.archived, raw: c }); }
    catch (e) { clientsById.set(id, { id, name: 'Mandant ' + id, archived: false }); }
  });
  // 6) Feldgrenzen (Vermessungen): alle mit Name und Fläche; Fläche des Feldes = aktive Grenze.
  //    Die Liste wird pro Feld zwischengespeichert (data/grenzen.json) und höchstens alle 3 Tage neu geholt.
  const gCache = load('grenzen.json', {}), gAlt = 3 * 864e5, now = Date.now(); let gNeu = 0;
  const gOf = b => ({ name: String(b.name || '').trim(), ha: areaHa(b.area), bha: areaHa(b.workableArea), aktiv: !!b.active, archiviert: !!b.archived,
    quelle: b.sourceType || b.source || '', signal: b.signalType || (b.signal && (b.signal.type || b.signal)) || '', erstellt: b.createdTime || b.creationTime || b.createdDate || b.dateCreated || '',
    geaendert: b.modifiedTime || b.lastModifiedTime || b.lastModified || b.createdTime || '' });
  await pool(fields, 4, async f => {
    let b = null, list = null;
    const c = gCache[f.id];
    if (c && c.v >= 4 && now - Date.parse(c.at) < gAlt) list = c.list; // v4: alle Grenzen (recordFilter=all), mit Erstellungsdatum und Signaltyp
    else {
      const bu = link(f.raw, 'boundaries') || `/organizations/${org}/fields/${encodeURIComponent(f.id)}/boundaries`;
      // recordFilter=all: auch nicht aktive / archivierte Grenzen (Standard bei John Deere wäre nur «active»)
      const buAll = bu + (bu.includes('?') ? '&' : '?') + 'recordFilter=all';
      try { let bs; try { bs = await jdAll(buAll, true); } catch (e) { if (e.status !== 400) throw e; bs = await jdAll(bu); }
        list = bs.map(gOf); gCache[f.id] = { v: 4, at: new Date().toISOString(), list }; gNeu++; diag.boundary = diag.boundary || sample(bs[0]); }
      catch (e) { if (e.status !== 403 && e.status !== 404) throw e; list = c ? c.list : null; }
    }
    const emb = f.raw.activeBoundary || embedded(f.raw, 'boundaries').find(x => x.active);
    if (emb) b = gOf(emb); else if (list) b = list.find(x => x.aktiv) || (list.length === 1 ? list[0] : null);
    f.flaeche = b ? (b.ha ?? b.bha ?? null) : null;
    f.grenzen = list || (b ? [b] : []);
  });
  save('grenzen.json', gCache);
  if (gNeu) log(`Feldgrenzen: ${gNeu} Felder neu abgefragt`);
  // 7) Welche Ebene entspricht den Kunden? Mandanten (üblich) oder Betriebe (wenn alle Kunden als Betriebe unter wenigen Mandanten liegen)
  const cAct = [...clientsById.values()].filter(c => !c.archived), fAct = [...farmsById.values()].filter(f => !f.archived);
  const cUsed = new Set(fields.map(f => f.client).filter(Boolean)).size, faUsed = new Set(fields.map(f => f.farm).filter(Boolean)).size;
  let ebene = cfg.kundenEbene === 'farms' || cfg.kundenEbene === 'clients' ? cfg.kundenEbene : (cUsed <= 3 && faUsed >= 3 * Math.max(1, cUsed) ? 'farms' : 'clients');
  const ohne = fields.filter(f => !(ebene === 'farms' ? f.farm : f.client)).length;
  st.jdStruktur = { mandanten: cAct.length, betriebe: fAct.length, felder: fields.length, mandantenMitFeldern: cUsed, betriebeMitFeldern: faUsed, ohneZuordnung: ohne, ebene };
  log(`Aufbau MyJohnDeere: ${cAct.length} Mandanten (${cUsed} mit Feldern), ${fAct.length} Betriebe (${faUsed} mit Feldern), ${fields.length} Felder, ${ohne} ohne Zuordnung → Kunden = ${ebene === 'farms' ? 'Betriebe' : 'Mandanten'}${cfg.kundenEbene === ebene ? ' (fest eingestellt)' : ''}`);
  diag.struktur = st.jdStruktur;
  diag.unassigned = fields.filter(f => !f.client && !f.farm).slice(0, 3).map(f => sample(f.raw));
  save('diagnose.json', diag);
  const outF = f => ({ id: f.id, name: f.name, client: ebene === 'farms' ? f.farm : f.client, farm: ebene === 'farms' ? '' : f.farm, flaeche: f.flaeche, archived: f.archived,
    grenzen: (f.grenzen || []).map(g => ({ name: g.name, ha: g.ha != null ? Math.round(g.ha * 100) / 100 : null, bha: g.bha != null ? Math.round(g.bha * 100) / 100 : null, aktiv: g.aktiv, archiviert: g.archiviert, quelle: g.quelle, signal: typeof g.signal === 'string' ? g.signal : '', erstellt: g.erstellt || '', geaendert: g.geaendert })) });
  const out = ebene === 'farms'
    ? { clients: fAct.map(f => ({ id: f.id, name: f.name, archived: false, mandant: clientsById.get(f.client)?.name || '' })), farms: [] }
    : { clients: cAct.map(c => ({ id: c.id, name: c.name, archived: false })), farms: [...farmsById.values()].map(f => ({ id: f.id, name: f.name, client: f.client })) };
  const known = new Set(out.clients.map(c => c.id));
  return {
    format: 'jd-sync', v: 1, dienst: VERSION, stand: new Date().toISOString(), org: { id: org, name: cfg.orgName }, kundenEbene: ebene,
    ...out,
    fields: fields.filter(f => known.has(outF(f).client)).map(outF),
    _requests: reqCount
  };
}

/* ---------- Arbeitsdaten (Field Operations) ---------- */
// Vorrat auf dem NAS: data/arbeiten.json { seit, ops: { id: {...} } } – wird bei jedem Lauf ergänzt (inkrementell).
const stripLinks = o => Array.isArray(o) ? o.map(stripLinks) : (o && typeof o === 'object')
  ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'links').map(([k, v]) => [k, stripLinks(v)])) : o;
const isoDay = d => new Date(d).toISOString().slice(0, 10);
const EXTRA_REL = /machine|equipment|implement|operator|product|variet|tankmix|crop/i;
const hasAg2 = () => !st.jd?.scope || /\bag2\b/.test(st.jd.scope);
/* ---------- Fläche je Arbeitsgang (wie JD_Arbeitsbericht 1.14) ----------
   1. «Maschine»: Messwert von John Deere (bevorzugt Ergebnis-Messungen …Result, sonst grösste Produkt-/Sortensumme)
   2. «Bedeckungskarte»: aus dem Punkt-Shapefile der Bedeckungskarte (Arbeitsbreite × Distanz je Messpunkt, Überlappungen nur einmal)
   Ohne beides bleibt die Fläche leer (keine Feldgrenze als Ersatz). */
const AREA_HA = { ha: 1, ac: 0.40468564224, m2: 0.0001, 'm^2': 0.0001, sqm: 0.0001, a: 0.01, km2: 100 };
const haOf = a => { if (!a || typeof a !== 'object') return null; const v = a.valueAsDouble ?? a.value; if (v == null || isNaN(+v)) return null; const f = AREA_HA[String(a.unitId || a.unit || 'ha').trim().toLowerCase()]; return f == null ? null : +v * f; };
function measArea(m) {
  const a = haOf(m.area); if (a != null) return a;
  const nested = [];
  for (const k of ['applicationProductTotals', 'productTotals', 'varietyTotals']) for (const t of (m[k] || [])) { const x = t && (haOf(t.area) || haOf(t.appliedArea)); if (x != null) nested.push(x); }
  return nested.length ? Math.max(...nested) : null;
}
function areaFromMeas(meas) {
  let best = null;
  for (const m of meas || []) { if (!m || typeof m !== 'object') continue; const a = measArea(m); if (a == null) continue; const prio = String(m.measurementName || '').endsWith('Result') ? 0 : 1; if (!best || prio < best[0] || (prio === best[0] && a > best[1])) best = [prio, a]; }
  return best ? Math.round(best[1] * 10000) / 10000 : null;
}
const AREA_LINKS = ['applicationRateResult', 'seedingRateResult', 'harvestYieldResult', 'tillageDepthResult', 'applicationSpeedResult', 'seedingSpeedResult', 'harvestSpeedResult', 'tillageSpeedResult', 'harvestMoistureResult', 'seedingVarietiesResult', 'fuelRateResult', 'elevationResult'];
async function areaFallback(lk) { // measurementTypes ohne Fläche: einzelne Ergebnis-Messungen abfragen
  for (const rel of AREA_LINKS) {
    if (!lk[rel]) continue;
    let j; try { j = await jdGet(lk[rel]); } catch { continue; }
    if (!j) continue;
    const items = Array.isArray(j.values) ? j.values : [j];
    if (areaFromMeas(items)) return stripLinks(items);
  }
  return [];
}
// Maschinenliste der Organisation (Seriennummer/ID → Name im Operations Center)
let eqIndex = null;
async function loadEquipment(org) {
  eqIndex = { serial: new Map(), id: new Map(), suffix: new Map() };
  const host = cfg.apiBase.replace(/\/$/, '').replace(/\/platform$/, '');
  let items = [];
  try { items = await jdAll(`${host}/isg/equipment?organizationIds=${encodeURIComponent(org)}`); }
  catch (e) { log(`Hinweis: Maschinenliste nicht abrufbar (${e.status === 403 ? 'keine Berechtigung – für Maschinennamen in jd-sync neu bei John Deere anmelden' : e.message})`); return 0; }
  for (const e of items) {
    const name = String(e.name || e.model?.name || '').trim(); if (!name) continue;
    const sn = String(e.serialNumber || '').trim().toUpperCase();
    if (sn) { eqIndex.serial.set(sn, name); const s = sn.slice(-6); if (!eqIndex.suffix.has(s)) eqIndex.suffix.set(s, new Set()); eqIndex.suffix.get(s).add(name); }
    for (const k of ['id', 'principalId']) if (e[k]) eqIndex.id.set(String(e[k]), name);
  }
  return items.length;
}
function eqLookup(m) {
  if (!eqIndex || !m) return null;
  if (m.machineId && eqIndex.id.has(String(m.machineId))) return eqIndex.id.get(String(m.machineId));
  const vin = String(m.vin || m.serialNumber || '').trim().toUpperCase();
  if (vin) { if (eqIndex.serial.has(vin)) return eqIndex.serial.get(vin); const c = eqIndex.suffix.get(vin.slice(-6)); if (c && c.size === 1) return [...c][0]; }
  return null;
}
const eqName = m => m && typeof m === 'object' ? String(m.name || m.displayName || m.title || m.serialNumber || m.vin || '').trim() : '';
function machinesOf(op, extra) {
  const names = [];
  for (const m of op.fieldOperationMachines || []) { const n = eqLookup(m) || eqName(m); if (n) names.push(n); }
  if (!names.length) for (const [rel, list] of Object.entries(extra || {})) if (/machine|equipment/i.test(rel)) for (const m of (Array.isArray(list) ? list : [list])) { const n = eqLookup(m) || eqName(m); if (n) names.push(n); }
  return [...new Set(names)];
}
/* --- ZIP, Shapefile, dBase (ohne Zusatzpakete) --- */
// Meter pro Grad auf dem WGS84-Ellipsoid (wie GPS und Display) – die Kugel (EARTH_R) macht Ost-West-Abstände bei 47° um ~0.3 % zu kurz
function geoK(lat) { const a = 6378137, e2 = 0.00669437999014, s2 = Math.sin(lat * RAD) ** 2, w = Math.sqrt(1 - e2 * s2);
  return { kx: RAD * a / w * Math.cos(lat * RAD), ky: RAD * a * (1 - e2) / (w * w * w) }; }
function unzip(buf) {
  const zlib = require('zlib'), out = {};
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return out;
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('latin1'); p += 46 + nl + el + cl;
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), data = buf.slice(ds, ds + csize);
    try { out[name] = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null; } catch { out[name] = null; }
  }
  return out;
}
function readDbf(b) {
  const nrec = b.readUInt32LE(4), hlen = b.readUInt16LE(8), rlen = b.readUInt16LE(10), cols = [];
  for (let p = 32; p < hlen - 1 && b[p] !== 0x0d; p += 32) cols.push([b.slice(p, p + 11).toString('latin1').split('\0')[0].toUpperCase(), String.fromCharCode(b[p + 11]), b[p + 16]]);
  const rows = [];
  for (let i = 0; i < nrec; i++) {
    const s = hlen + i * rlen; if (s >= b.length || b[s] === 0x2a) { rows.push(null); continue; }
    let off = s + 1; const r = {};
    for (const [name, t, len] of cols) { const raw = b.slice(off, off + len).toString('latin1').trim(); off += len; r[name] = 'NF'.includes(t) ? (raw === '' || isNaN(+raw) ? null : +raw) : raw; }
    rows.push(r);
  }
  return rows;
}
// Vereinigungsfläche von Polygonen (lokale Meter) über ein Raster: jede Zelle wird nur einmal gezählt (Überlappungen einmal).
// Speicherbedarf fest begrenzt (höchstens ~20 Mio. Zellen = 20 MB), unabhängig von der Anzahl Messpunkte.
function unionArea(polys, step) { const G = unionGrid(polys, step); return G ? G.filled * G.cell * G.cell : 0; }
function unionGrid(polys, step) {
  if (!polys.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const pl of polys) for (const r of pl) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const W0 = x1 - x0, H0 = y1 - y0; if (!(W0 > 0 && H0 > 0)) return null;
  const cell = Math.max(step, Math.sqrt(W0 * H0 / 2e7));
  const nx = Math.ceil(W0 / cell) + 1, ny = Math.ceil(H0 / cell) + 1, grid = new Uint8Array(nx * ny);
  let filled = 0;
  for (const pl of polys) {
    let ymin = Infinity, ymax = -Infinity; const edges = [];
    for (const ring of pl) for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]); if (a[1] < ymin) ymin = a[1]; if (a[1] > ymax) ymax = a[1]; }
    if (!edges.length) continue;
    const r0 = Math.max(0, Math.floor((ymin - y0) / cell)), r1 = Math.min(ny - 1, Math.ceil((ymax - y0) / cell));
    for (let row = r0; row <= r1; row++) {
      const y = y0 + (row + 0.5) * cell, xs = [];
      for (const [xa, ya, xb, yb] of edges) if ((ya <= y && y < yb) || (yb <= y && y < ya)) xs.push(xa + (y - ya) * (xb - xa) / (yb - ya));
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), c1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
        const base = row * nx; for (let c = c0; c <= c1; c++) if (!grid[base + c]) { grid[base + c] = 1; filled++; }
      }
    }
  }
  return { grid, nx, ny, cell, x0, y0, filled };
}
const EARTH_R = 6371008.8, RAD = Math.PI / 180;
// Fläche (ha) aus einer Bedeckungskarte (ZIP mit Shapefile): Polygone direkt, Punkte über Arbeitsbreite × Distanz
function coverageCalc(zipBuf) {
  const files = unzip(zipBuf), names = Object.keys(files);
  const shpN = names.find(n => /\.shp$/i.test(n)), dbfN = names.find(n => /\.dbf$/i.test(n)), prjN = names.find(n => /\.prj$/i.test(n));
  if (!shpN || !files[shpN]) return null;
  const shp = files[shpN], geo = !(prjN && files[prjN] && /^PROJCS/i.test(files[prjN].toString('latin1').trim()));
  const recs = []; let p = 100;
  while (p + 8 <= shp.length) { const len = shp.readInt32BE(p + 4) * 2, c = shp.slice(p + 8, p + 8 + len); p += 8 + len; recs.push(c); }
  const type = c => c.length >= 4 ? c.readInt32LE(0) : 0;
  const polysGeo = [];
  for (const c of recs) {
    if (![5, 15, 25].includes(type(c)) || c.length < 44) continue;
    const np = c.readInt32LE(36), npt = c.readInt32LE(40), parts = []; for (let i = 0; i < np; i++) parts.push(c.readInt32LE(44 + 4 * i));
    const off = 44 + 4 * np, xy = []; for (let i = 0; i < npt; i++) xy.push([c.readDoubleLE(off + 16 * i), c.readDoubleLE(off + 16 * i + 8)]);
    parts.push(npt); const rings = []; for (let i = 0; i < np; i++) { const r = xy.slice(parts[i], parts[i + 1]); if (r.length >= 3) rings.push(r); }
    if (rings.length) polysGeo.push(rings);
  }
  if (polysGeo.length) {
    let polys = polysGeo, inv = null;
    if (geo) {
      const pts = polysGeo.flat(2), lat0 = pts.reduce((s, q) => s + q[1], 0) / pts.length, lon0 = pts.reduce((s, q) => s + q[0], 0) / pts.length, { kx, ky } = geoK(lat0);
      polys = polysGeo.map(pl => pl.map(r => r.map(q => [(q[0] - lon0) * kx, (q[1] - lat0) * ky]))); inv = { lon0, lat0, kx, ky };
    }
    return covResult(unionGrid(polys, 0.1), inv); // projizierte Shapefiles: Fläche ja, Grenze nur mit Längen/Breiten
  }
  if (!dbfN || !files[dbfN]) return null;
  return covResult(pointsGrid(recs, files[dbfN]));
}
function coverageHa(zipBuf) { const r = coverageCalc(zipBuf); return r ? r.ha : null; }
// Ergebnis einer Bedeckungskarte: Fläche ohne Überlappungen (jede Rasterzelle einmal) + virtuelle Feldgrenze
function covResult(G, inv) {
  if (!G || !G.filled) return null;
  const a = G.filled * G.cell * G.cell / 10000, ha = a > 0 ? Math.round(a * 10000) / 10000 : null;
  if (!ha) return null;
  let grz = null; const P = inv || (G.kx ? G : null);
  if (P) { try { grz = gridBoundary(G, P); } catch (e) { log('Virtuelle Feldgrenze: ' + e.message); } }
  return { ha, grz };
}
/* Virtuelle Feldgrenze aus dem Bedeckungsraster:
   1. auf ein Raster von ca. 1 m vergröbern (Zelle belegt, wenn darin etwas bearbeitet wurde) – schmale Lücken zwischen den Spuren verschwinden
   2. einmal schliessen (ausdehnen + schrumpfen um 1 Zelle) und Löcher unter 50 m² füllen
   3. Umriss verfolgen, vereinfachen (Toleranz 0.5 m), Teile unter 20 m² weglassen → MultiPolygon in Längen/Breitengraden (GeoJSON-Reihenfolge) */
function gridBoundary(G, P) {
  const f = Math.max(2, Math.round(1 / G.cell)), cs = G.cell * f, nx = Math.ceil(G.nx / f) + 2, ny = Math.ceil(G.ny / f) + 2;
  if (nx * ny > 4e6) return null;
  // grobe Zelle gilt als bearbeitet, wenn mindestens die Hälfte der feinen Zellen bedeckt ist (sonst wird der Rand ~½ Zelle zu weit, v55)
  const cnt = new Uint16Array(nx * ny); let b = new Uint8Array(nx * ny);
  for (let r = 0; r < G.ny; r++) { const rb = (Math.floor(r / f) + 1) * nx, base = r * G.nx; for (let c = 0; c < G.nx; c++) if (G.grid[base + c]) cnt[rb + Math.floor(c / f) + 1]++; }
  const half = f * f / 2; for (let i = 0; i < cnt.length; i++) if (cnt[i] >= half) b[i] = 1;
  const morph = (src, val) => { const o = new Uint8Array(src.length); for (let r = 1; r < ny - 1; r++) for (let c = 1; c < nx - 1; c++) { const i = r * nx + c; let v = !val; for (let dr = -1; dr <= 1 && v !== val; dr++) for (let dc = -1; dc <= 1; dc++) if (!!src[i + dr * nx + dc] === val) { v = val; break; } o[i] = v ? 1 : 0; } return o; };
  b = morph(morph(b, true), false); // schliessen
  // Löcher (leere Flächen ohne Verbindung zum Rand) unter 50 m² füllen
  const seen = new Uint8Array(nx * ny), maxHole = Math.max(1, Math.round(50 / (cs * cs))), stack = [];
  for (let s0 = 0; s0 < nx * ny; s0++) {
    if (b[s0] || seen[s0]) continue;
    const comp = []; let edge = false; stack.push(s0); seen[s0] = 1;
    while (stack.length) { const i = stack.pop(), r = (i / nx) | 0, c = i - r * nx; comp.push(i); if (r === 0 || c === 0 || r === ny - 1 || c === nx - 1) edge = true;
      for (const j of [i - 1, i + 1, i - nx, i + nx]) if (j >= 0 && j < nx * ny && !b[j] && !seen[j] && Math.abs((j % nx) - c) <= 1) { seen[j] = 1; stack.push(j); } }
    if (!edge && comp.length <= maxHole) for (const i of comp) b[i] = 1;
  }
  // Umriss: gerichtete Kanten (belegte Zelle links), zu Ringen verbinden
  const nxt = new Map(), key = (x, y) => y * (nx + 1) + x;
  const add = (x1, y1, x2, y2) => { const k = key(x1, y1); const l = nxt.get(k); if (l) l.push(key(x2, y2)); else nxt.set(k, [key(x2, y2)]); };
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    if (!b[r * nx + c]) continue;
    if (r === 0 || !b[(r - 1) * nx + c]) add(c, r, c + 1, r);           // unten: nach rechts
    if (c === nx - 1 || !b[r * nx + c + 1]) add(c + 1, r, c + 1, r + 1); // rechts: nach oben
    if (r === ny - 1 || !b[(r + 1) * nx + c]) add(c + 1, r + 1, c, r + 1); // oben: nach links
    if (c === 0 || !b[r * nx + c - 1]) add(c, r + 1, c, r);             // links: nach unten
  }
  const rings = [];
  for (const [k0, l0] of nxt) {
    while (l0.length) {
      const ring = []; let k = k0;
      do { const l = nxt.get(k); if (!l || !l.length) break; ring.push(k); k = l.pop(); } while (k !== k0 && ring.length < 1e6);
      if (ring.length >= 4) rings.push(ring.map(q => [q % (nx + 1), Math.floor(q / (nx + 1))]));
    }
  }
  // in Meter, vereinfachen, Fläche mit Vorzeichen (positiv = Aussenrand)
  const toM = ([x, y]) => [G.x0 + (x - 1) * cs, G.y0 + (y - 1) * cs];
  const simp = (pts, tol) => { if (pts.length < 4) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st2 = [[0, pts.length - 1]];
    while (st2.length) { const [i0, i1] = st2.pop(); const [ax, ay] = pts[i0], [bx, by] = pts[i1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1; let dm = 0, im = -1;
      for (let i = i0 + 1; i < i1; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > dm) { dm = d; im = i; } }
      if (dm > tol && im > 0) { keep[im] = 1; st2.push([i0, im], [im, i1]); } }
    return pts.filter((_, i) => keep[i]); };
  const sarea = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const outer = [], holes = [];
  for (const r of rings) {
    // geschlossener Ring: am weitest entfernten Punkt teilen, beide Hälften vereinfachen
    const m = r.map(toM); let im = 0, dm = -1; for (let i = 1; i < m.length; i++) { const d = Math.hypot(m[i][0] - m[0][0], m[i][1] - m[0][1]); if (d > dm) { dm = d; im = i; } }
    const s2 = simp(m.slice(0, im + 1), 0.5).concat(simp(m.slice(im).concat([m[0]]), 0.5).slice(1, -1)); if (s2.length < 3) continue;
    const a = sarea(s2); if (Math.abs(a) < 20) continue;
    (a > 0 ? outer : holes).push({ pts: s2, a });
  }
  if (!outer.length) return null;
  const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
  outer.sort((p, q) => p.a - q.a); // kleinste zuerst: Loch gehört zum kleinsten umschliessenden Aussenrand
  const polys = outer.map(o => ({ o, h: [] }));
  for (const h of holes) { const pl = polys.find(p => inside(h.pts[0], p.o.pts)); if (pl) pl.h.push(h.pts); }
  const ll = ([x, y]) => [Math.round((P.lon0 + x / P.kx) * 1e7) / 1e7, Math.round((P.lat0 + y / P.ky) * 1e7) / 1e7];
  const ring = pts => { const r = pts.map(ll); r.push(r[0]); return r; };
  return polys.sort((p, q) => q.o.a - p.o.a).map(p => [ring(p.o.pts), ...p.h.map(h => ring(h.slice().reverse()))]);
}
// nur die benötigten Zahlenspalten aus der dBase-Datei (speichersparend, auch bei Hunderttausenden Punkten)
function dbfCols(b, want) {
  const nrec = b.readUInt32LE(4), hlen = b.readUInt16LE(8), rlen = b.readUInt16LE(10), cols = {}; let off = 1;
  for (let p = 32; p < hlen - 1 && b[p] !== 0x0d; p += 32) { const name = b.slice(p, p + 11).toString('latin1').split('\0')[0].toUpperCase(), len = b[p + 16]; if (want.includes(name)) cols[name] = [off, len]; off += len; }
  const out = { n: nrec, del: new Uint8Array(nrec) }; for (const w of want) out[w] = new Float64Array(nrec).fill(NaN);
  for (let i = 0; i < nrec; i++) {
    const s0 = hlen + i * rlen; if (s0 >= b.length) { out.del[i] = 1; continue; } if (b[s0] === 0x2a) { out.del[i] = 1; continue; }
    for (const w of want) { const c = cols[w]; if (!c) continue; const v = parseFloat(b.toString('latin1', s0 + c[0], s0 + c[0] + c[1])); if (!isNaN(v)) out[w][i] = v; }
  }
  return out;
}
// Punkt-Export: je Messpunkt ein Rechteck (Länge DISTANCE in Fahrtrichtung HEADING, Breite SWATHWIDTH) → Vereinigung über ein Raster
function pointsGrid(recs, dbfBuf) {
  const A = dbfCols(dbfBuf, ['SWATHWIDTH', 'DISTANCE', 'HEADING']);
  let n = 0;
  for (let i = 0; i < recs.length; i++) { const c = recs[i], t = c.length >= 4 ? c.readInt32LE(0) : 0; if ([1, 11, 21].includes(t)) n++; else if ([8, 18, 28].includes(t) && c.length >= 40) n += c.readInt32LE(36); }
  if (!n) return null;
  const X = new Float64Array(n), Y = new Float64Array(n), R = new Int32Array(n); let k = 0;
  for (let i = 0; i < recs.length && i < A.n; i++) {
    if (A.del[i]) continue; const c = recs[i], t = c.length >= 4 ? c.readInt32LE(0) : 0;
    if ([1, 11, 21].includes(t) && c.length >= 20) { X[k] = c.readDoubleLE(4); Y[k] = c.readDoubleLE(12); R[k++] = i; }
    else if ([8, 18, 28].includes(t) && c.length >= 40) { const m = c.readInt32LE(36); for (let q = 0; q < m && 40 + 16 * q + 16 <= c.length; q++) { X[k] = c.readDoubleLE(40 + 16 * q); Y[k] = c.readDoubleLE(48 + 16 * q); R[k++] = i; } }
  }
  if (!k) return null;
  let sx = 0, sy = 0; for (let i = 0; i < k; i++) { sx += X[i]; sy += Y[i]; }
  const lon0 = sx / k, lat0 = sy / k, { kx, ky } = geoK(lat0);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, used = 0;
  const ok = new Uint8Array(k);
  for (let i = 0; i < k; i++) {
    const r = R[i], w = A.SWATHWIDTH[r], d = A.DISTANCE[r], h = A.HEADING[r];
    if (!(w > 0) || !(d > 0) || d > 50 || isNaN(h)) continue;
    ok[i] = 1; used++;
    X[i] = (X[i] - lon0) * kx; Y[i] = (Y[i] - lat0) * ky;
    const e = (Math.abs(w) + Math.abs(d)) / 2;
    if (X[i] - e < x0) x0 = X[i] - e; if (X[i] + e > x1) x1 = X[i] + e; if (Y[i] - e < y0) y0 = Y[i] - e; if (Y[i] + e > y1) y1 = Y[i] + e;
  }
  if (!used) return null;
  const cell = Math.max(0.25, Math.sqrt((x1 - x0) * (y1 - y0) / 2e7));
  const nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1, grid = new Uint8Array(nx * ny);
  let filled = 0; const cx = [0, 0, 0, 0], cy = [0, 0, 0, 0];
  for (let i = 0; i < k; i++) {
    if (!ok[i]) continue;
    const r = R[i], hw = A.SWATHWIDTH[r] / 2, hl = A.DISTANCE[r] / 2, t = A.HEADING[r] * RAD, ux = Math.sin(t), uy = Math.cos(t), vx = uy, vy = -ux, px = X[i], py = Y[i];
    cx[0] = px - ux * hl - vx * hw; cy[0] = py - uy * hl - vy * hw; cx[1] = px + ux * hl - vx * hw; cy[1] = py + uy * hl - vy * hw;
    cx[2] = px + ux * hl + vx * hw; cy[2] = py + uy * hl + vy * hw; cx[3] = px - ux * hl + vx * hw; cy[3] = py - uy * hl + vy * hw;
    const ymin = Math.min(cy[0], cy[1], cy[2], cy[3]), ymax = Math.max(cy[0], cy[1], cy[2], cy[3]);
    const r0 = Math.max(0, Math.floor((ymin - y0) / cell)), r1 = Math.min(ny - 1, Math.ceil((ymax - y0) / cell));
    for (let row = r0; row <= r1; row++) {
      const y = y0 + (row + 0.5) * cell; let lo = Infinity, hi = -Infinity;
      for (let e = 0; e < 4; e++) { const ya = cy[e], yb = cy[(e + 1) & 3]; if ((ya <= y && y < yb) || (yb <= y && y < ya)) { const x = cx[e] + (y - ya) * (cx[(e + 1) & 3] - cx[e]) / (yb - ya); if (x < lo) lo = x; if (x > hi) hi = x; } }
      if (hi <= lo) continue;
      const c0 = Math.max(0, Math.ceil((lo - x0) / cell - 0.5)), c1 = Math.min(nx - 1, Math.floor((hi - x0) / cell - 0.5)), base = row * nx;
      for (let c = c0; c <= c1; c++) if (!grid[base + c]) { grid[base + c] = 1; filled++; }
    }
  }
  return { grid, nx, ny, cell, x0, y0, filled, lon0, lat0, kx, ky };
}
// Bedeckungskarte anfordern: Buffer = fertig, 'wait' = wird erstellt, { none: Status } = für diesen Arbeitsgang keine Karte
// Ein einzelner Arbeitsgang ohne Karte (404 …) stoppt die übrigen NICHT; abgebrochen wird nur bei wiederholt fehlender Berechtigung.
let covCombo, covDead, covStat, covErr, cov403, covParamFail, covSave = null;
/* ---------- Neue «Operations Data Export»-API (ersetzt GET /fieldOps/{id}, alte API laut John Deere bis Nov. 2027) ----------
   1. POST {isg}/operations/{id}/operationsExportRequests  { exportSettings: { format: 'SHAPEFILE', shapeType: 'Point', resolution: 'EachSection', splitShapeFile: false } }
      Header Accept-UOM-System: METRIC → Request-ID
   2. GET  {isg}/operations/{id}/operationsExportRequests/{requestId} → requestStatus CREATED/PROCESSING/REPROCESS (warten), SUCCESSFUL (files[].presignedUri), FAILURE
   3. Dateien über die vorsignierten Links (ohne Anmeldung) holen.
   Klappt die neue API nicht (kein Zugriff, unbekannte ID …), wird für diesen Arbeitsgang die alte API verwendet. cfg.exportApi = 'alt' schaltet sie ganz ab. */
const isgBase = () => (cfg.isgBase || cfg.apiBase.replace(/\/platform\/?$/, '/isg')).replace(/\/$/, '');
let oxDead = false, ox403 = 0, oxStat = {};
async function oxFetch(url, opt = {}) {
  let r; for (let t = 0; t < 2; t++) { r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + await jdAccess(), Accept: ACCEPT, ...(opt.headers || {}) } }); reqCount++; if (r.status === 401 && t === 0) { st.jd.exp = 0; continue; } break; }
  return r;
}
async function oxRequest(o) {
  if (oxDead || cfg.exportApi === 'alt') return 'alt';
  const u = `${isgBase()}/operations/${encodeURIComponent(o.id)}/operationsExportRequests`;
  const fail = async (r, wo) => { const tx = await r.text().catch(() => ''); oxStat[r.status] = (oxStat[r.status] || 0) + 1;
    if (!covErr['neu ' + r.status]) covErr['neu ' + r.status] = `${o.fieldName || o.id} (${wo}): ${tx.trim().slice(0, 300) || 'ohne Meldung'}`;
    if (r.status === 401 || r.status === 403) { if (++ox403 >= 3) { oxDead = true; log(`Neue Export-API: kein Zugriff (${r.status}) – Freischaltung «Operations Export» der App auf developer.deere.com prüfen. Bis dahin alte Schnittstelle.`); } }
    if (r.status === 429 || r.status >= 500) return 'wait';
    delete o.covReq; return 'alt'; };
  // laufende Anfrage weiterverfolgen (gleicher Bearbeitungsstand, höchstens 2 Tage alt), sonst neu anfordern
  if (!(o.covReq && o.covReq.mod === o.modified && Date.now() - Date.parse(o.covReq.at) < 2 * 864e5)) {
    let r = await oxFetch(u, { method: 'POST', headers: { 'Content-Type': ACCEPT, 'Accept-UOM-System': 'METRIC' }, body: JSON.stringify({ exportSettings: { format: 'SHAPEFILE', shapeType: 'Point', resolution: 'EachSection', splitShapeFile: false } }) });
    if (r.status === 415) r = await oxFetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-UOM-System': 'METRIC' }, body: JSON.stringify({ exportSettings: { format: 'SHAPEFILE', shapeType: 'Point', resolution: 'EachSection', splitShapeFile: false } }) });
    if (r.status >= 300) return fail(r, 'Anfrage');
    ox403 = 0; oxStat[r.status] = (oxStat[r.status] || 0) + 1;
    let js = null; try { js = await r.json(); } catch { }
    const loc = r.headers.get('location') || '';
    const id = (js && (js.id || js.requestId)) || (loc.match(/operationsExportRequests\/([^/?#]+)/) || [])[1];
    if (!id) { if (!covErr['neu id']) covErr['neu id'] = `${o.fieldName}: Antwort ohne Request-ID ${JSON.stringify(js || {}).slice(0, 200)}`; return 'alt'; }
    o.covReq = { id, at: new Date().toISOString(), mod: o.modified };
    return 'wait';
  }
  const r = await oxFetch(`${u}/${encodeURIComponent(o.covReq.id)}`);
  if (r.status >= 300) { if (r.status === 404) { delete o.covReq; return 'wait'; } return fail(r, 'Status'); }
  let js = null; try { js = await r.json(); } catch { }
  const stt = String(js && js.requestStatus || '').toUpperCase();
  oxStat[stt || '?'] = (oxStat[stt || '?'] || 0) + 1;
  if (stt === 'FAILURE') { delete o.covReq; return { none: 'export-fehler' }; }
  if (stt !== 'SUCCESSFUL') return 'wait';
  const bufs = [];
  for (const f of (js.files || [])) {
    if (!f || !f.presignedUri) continue;
    const d = await fetch(f.presignedUri); const b = Buffer.from(await d.arrayBuffer());
    if (d.status === 200 && b[0] === 0x50 && b[1] === 0x4b) bufs.push(b);
    else if (!covErr['neu download']) covErr['neu download'] = `${o.fieldName}: Download ${d.status}`;
  }
  delete o.covReq; st.covApiNeu = (st.covApiNeu || 0) + 1;
  if (!bufs.length) return { none: (js.files || []).length ? 'download' : 'leer' };
  return bufs.length === 1 ? bufs[0] : bufs;
}
async function coverageRequest(o) {
  if (covDead) return { none: 'gestoppt' };
  const nx = await oxRequest(o); if (nx !== 'alt') return nx;
  const base = o.lk?.shapeFileAsync || `/fieldOps/${encodeURIComponent(o.id)}`;
  const full = /^https?:/.test(base) ? base : cfg.apiBase.replace(/\/$/, '') + base;
  const combos = /shapeType/.test(full) ? [null] : covCombo !== undefined ? [covCombo] : [{ shapeType: 'Point' }, {}, { shapeType: 'Point', resolution: 'EachSection' }];
  let r, text = '', paramFail = 0;
  for (const params of combos) {
    const u = new URL(full); if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    for (let t = 0; t < 2; t++) { r = await fetch(u, { redirect: 'manual', headers: { Authorization: 'Bearer ' + await jdAccess(), Accept: ACCEPT } }); reqCount++; if (r.status === 401 && t === 0) { st.jd.exp = 0; continue; } break; }
    if (r.status === 400) { text = await r.text().catch(() => ''); if (/param/i.test(text) && combos.length > 1) { paramFail++; continue; } }
    if (r.status < 300 || (r.status >= 300 && r.status < 400)) covCombo = params; // diese Abfrage akzeptiert John Deere
    break;
  }
  covStat[r.status] = (covStat[r.status] || 0) + 1;
  if (r.status >= 400 && r.status !== 429 && r.status < 500) {
    if (!text) text = await r.text().catch(() => '');
    if (!covErr[r.status]) covErr[r.status] = `${o.fieldName || o.id} (${String(o.start || '').slice(0, 10)}): ${text.trim().slice(0, 300) || 'ohne Meldung'}`;
    if (r.status === 401 || r.status === 403) { if (++cov403 >= 5) { covDead = true; log(`Bedeckungskarte: kein Zugriff (${r.status}) – ${covErr[r.status]}`); } }
    else cov403 = 0;
    if (paramFail === combos.length && combos.length > 1 && ++covParamFail >= 3) { covDead = true; log(`Bedeckungskarte: John Deere akzeptiert keine der Abfragen – ${covErr[400] || ''}`); }
    return { none: r.status };
  }
  cov403 = 0;
  if (r.status === 202 || r.status === 429 || r.status >= 500) return 'wait';
  const getZip = async (loc, auth) => { const d = await fetch(loc, { headers: auth ? { Authorization: 'Bearer ' + await jdAccess(), Accept: 'application/zip, */*' } : {} }); const b = Buffer.from(await d.arrayBuffer()); if (!(d.status === 200 && b[0] === 0x50 && b[1] === 0x4b) && !covErr['download']) covErr['download'] = `${o.fieldName}: Download ${d.status} ${b.slice(0, 200).toString('utf8')}`; return d.status === 200 && b[0] === 0x50 && b[1] === 0x4b ? b : null; };
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get('location'); if (!loc) return { none: r.status };
    const abs = new URL(loc, full).href; const z = await getZip(abs, /deere\.com$|localhost$/.test(new URL(abs).hostname)); return z || { none: 'download' };
  }
  if (r.status === 200) {
    const b = Buffer.from(await r.arrayBuffer());
    if (b[0] === 0x50 && b[1] === 0x4b) return b;
    const tx = b.toString('utf8'); let js = null; try { js = JSON.parse(tx); } catch { }
    for (const l of (js?.links || [])) if (l.uri && /^(download|file|zip|shapefile|downloadurl|result)$/i.test(l.rel || '')) { const z = await getZip(l.uri, true); if (z) return z; }
    if (/processing|pending|inprogress|in_progress|queued|running/i.test(tx)) return 'wait';
    if (!covErr['json']) covErr['json'] = `${o.fieldName}: ${tx.slice(0, 300)}`;
    return { none: 'json' };
  }
  return { none: r.status };
}
const COV_RETRY_MS = 14 * 864e5; // Arbeitsgänge ohne Karte erst nach 14 Tagen erneut fragen
// COV_G: Stand der Berechnung – Karten aus älteren Versionen (ohne virtuelle Feldgrenze) werden einmal neu geholt
const COV_G = 4; // 3 = v54 (Ellipsoid), 4 = v55 (Grenze genauer) – Karten werden einmal neu berechnet
const covDone = o => o.cov && o.cov.mod === o.modified && (o.cov.ha ? o.cov.g === COV_G : (o.cov.at && Date.now() - Date.parse(o.cov.at) < COV_RETRY_MS));
// virtuelle Feldgrenzen (aus der Bedeckungskarte) getrennt gespeichert und als eigene Datei in die Dropbox – hält jd-arbeiten.json klein
let grenzen = load('bedeckung-grenzen.json', {});
const arbCache = () => { try { return (load('arbeiten.json', null) || {}).ops; } catch { return null; } };
async function coverageAreas(list, maxWaitMs = 20 * 60 * 1000) {
  covCombo = st.covCombo; covDead = false; covStat = {}; covErr = {}; cov403 = 0; covParamFail = 0; oxDead = false; ox403 = 0; oxStat = {};
  // zuerst Arbeitsgänge ohne Maschinenfläche, dann die neuesten
  let pending = list.slice().sort((a, b) => ((areaFromMeas(a.measurements) == null ? 0 : 1) - (areaFromMeas(b.measurements) == null ? 0 : 1)) || String(b.start || '').localeCompare(String(a.start || ''))), first = true, ok = 0, none = 0; const end = Date.now() + maxWaitMs;
  if (pending.length) log(`Bedeckungskarte: ${pending.length} Arbeitsgänge werden abgefragt (Fläche ohne Überlappungen, virtuelle Feldgrenze)`);
  while (pending.length && Date.now() < end && !covDead) {
    if (!first) await sleep(5000); first = false;
    const still = [];
    for (const o of pending) {
      if (covDead || Date.now() > end) { still.push(o); continue; }
      if (st.arbProgress) st.arbProgress.done++;
      let res = null; try { res = await coverageRequest(o); } catch (e) { covErr.netz = covErr.netz || `${o.fieldName}: ${e.message}`; res = { none: 'netz' }; }
      if (res === 'wait') { still.push(o); continue; }
      if (Array.isArray(res)) { // mehrere Dateien: die mit der grössten Fläche (Export ist ungeteilt angefordert, sollte selten vorkommen)
        let best = null; for (const b of res) { try { const c = coverageCalc(b); if (c && (!best || c.ha > best.c.ha)) best = { b, c }; } catch { } }
        res = best ? best.b : { none: 'leer' };
      }
      let ha = null, grz = null; if (Buffer.isBuffer(res)) { try { const c = coverageCalc(res); if (c) { ha = c.ha; grz = c.grz; } } catch (e) { covErr.lesen = covErr.lesen || `${o.fieldName}: ${e.message}`; } }
      if (grz) grenzen[o.id] = { mod: o.modified, grz }; else delete grenzen[o.id];
      const st0 = Buffer.isBuffer(res) ? (ha ? 'ok' : 'leer') : res && res.none;
      // gemerkt werden Karten und eindeutige «keine Karte»-Antworten; Berechtigungs- und Netzfehler werden beim nächsten Lauf neu versucht
      if (Buffer.isBuffer(res) || [404, 410, 204, 'json', 'download', 'leer', 'export-fehler'].includes(st0)) o.cov = { mod: o.modified, ha, at: new Date().toISOString(), st: st0, g: COV_G };
      if (ha) ok++; else none++;
      if ((ok + none) % 25 === 0 && covSave) covSave(ok + none);
    }
    pending = still;
  }
  if (covCombo !== undefined) st.covCombo = covCombo;
  if (list.length) st.covInfo = { at: new Date().toISOString(), gefragt: list.length, mitFlaeche: ok, ohneKarte: none, offen: pending.length, status: covStat, neueApi: { antworten: oxStat, gestoppt: oxDead, aus: cfg.exportApi === 'alt' }, meldungen: covErr, gestoppt: covDead };
  if (list.length) log(`Bedeckungskarte: ${ok} Flächen berechnet (Speicher ${Math.round(process.memoryUsage().rss / 1048576)} MB), ${none} ohne Karte, ${pending.length} noch in Arbeit · neue API ${Object.entries(oxStat).map(([k, v]) => `${k}×${v}`).join(', ') || '–'}${oxDead ? ' (kein Zugriff)' : ''} · alte API ${Object.entries(covStat).map(([k, v]) => `${k}×${v}`).join(', ') || '–'}`);
  for (const [k, v] of Object.entries(covErr)) log(`  Bedeckungskarte ${k}: ${v}`);
  return ok;
}
// Fläche und Quelle eines Arbeitsgangs festlegen
function setFlaeche(o) { // ohne Messwert und Bedeckungskarte bleibt die Fläche leer (keine Feldgrenze als Ersatz)
  const m = areaFromMeas(o.measurements);
  if (m != null) { o.flaeche = m; o.flaecheQuelle = 'Maschine'; return; }
  if (o.cov && o.cov.mod === o.modified && o.cov.ha) { o.flaeche = o.cov.ha; o.flaecheQuelle = 'Bedeckungskarte'; return; }
  o.flaeche = null; o.flaecheQuelle = '';
}
async function readArbeiten(d) {
  const org = cfg.orgId;
  let arb = load('arbeiten.json', null);
  const seit = /^\d{4}-\d{2}-\d{2}$/.test(cfg.arbeitenSeit) ? cfg.arbeitenSeit : (new Date().getFullYear() - 1) + '-01-01';
  // komplett neu, wenn noch nichts da ist oder der Startzeitpunkt nach vorne verschoben wurde
  if (!arb || !arb.ops || (arb.seit && seit < arb.seit)) arb = { seit, ops: {}, lastOk: null };
  // täglich nur die letzten 14 Tage, alle 7 Tage komplett (erfasst auch nachträglich bearbeitete Arbeitsgänge)
  const voll = !arb.lastFull || Date.now() - Date.parse(arb.lastFull) > 7 * 864e5 || Object.values(arb.ops).some(o => o.v !== 2); // neue Version: einmal alles neu holen
  const from = (!voll && arb.lastOk) ? isoDay(Math.max(Date.parse(seit), Date.parse(arb.lastOk) - 14 * 864e5)) : seit;
  const to = isoDay(Date.now() + 864e5);
  const fieldInfo = new Map(d.fields.map(f => [f.id, f]));
  const clientName = new Map(d.clients.map(c => [c.id, c.name]));
  let neu = 0, geaendert = 0, fehler = 0, first403 = null, dateParams = st.arbDateParams !== false;
  reqCount = 0;
  const nEq = await loadEquipment(org); if (nEq) log(`Maschinenliste: ${nEq} Maschinen/Geräte`);
  let fDone = 0; st.arbProgress = { phase: 'Arbeitsgänge holen', done: 0, total: d.fields.length, at: new Date().toISOString() };
  await pool(d.fields, 4, async f => {
    try {
    const base = `/organizations/${org}/fields/${encodeURIComponent(f.id)}/fieldOperations`;
    let list;
    try {
      if (dateParams) {
        try { list = await jdAll(`${base}?startDate=${from}T00:00:00.000Z&endDate=${to}T00:00:00.000Z`, true); }
        catch (e) { if (e.status !== 400) throw e; dateParams = st.arbDateParams = false; log('Arbeitsdaten: Datumsfilter nicht unterstützt – filtere selbst'); }
      }
      if (!list) list = await jdAll(base);
    } catch (e) { fehler++; if (e.status === 403) first403 = first403 || e; else log(`Arbeitsdaten Feld «${f.name}»: ${e.message}`); return; }
    for (const op of list) {
      const id = idOf(op.id); if (!id) continue;
      const start = op.startDate || op.startTime || null, end = op.endDate || op.endTime || null;
      if ((end || start || '9999').slice(0, 10) < seit) continue;
      const modified = op.modifiedTime || op.lastModifiedTime || end || '';
      const alt = arb.ops[id];
      if (alt && alt.modified === modified && alt.measurements && alt.v === 2) continue; // unverändert
      // zusätzliche Angaben über die Verknüpfungen: Maschinen, Fahrer, Produkte, Sorten
      const extra = {};
      for (const l of (op.links || [])) {
        if (!EXTRA_REL.test(l.rel || '') || /measurement|self|field|shape|boundar/i.test(l.rel)) continue;
        try { const j = await jdAll(l.uri); extra[l.rel] = stripLinks(j); } catch (e) { if (e.status !== 403 && e.status !== 404) log(`Arbeitsdaten ${l.rel} ${id}: ${e.message}`); } // 404 = für diesen Arbeitsgang nicht vorhanden
      }
      let measurements = null;
      const lk = {}; for (const l of (op.links || [])) if (l.rel === 'shapeFileAsync' || AREA_LINKS.includes(l.rel)) lk[l.rel] = l.uri;
      try {
        const mu = link(op, 'measurementTypes') || `/fieldOperations/${encodeURIComponent(id)}/measurementTypes`;
        measurements = stripLinks(await jdAll(mu));
      } catch (e) { if (e.status !== 403) log(`Arbeitsdaten Messwerte ${id}: ${e.message}`); }
      if (areaFromMeas(measurements) == null) { const fb = await areaFallback(lk); if (fb.length) measurements = [...(measurements || []), ...fb]; }
      arb.ops[id] = { v: 2, lk, machines: machinesOf(op, extra), cov: alt && alt.cov && alt.cov.mod === modified ? alt.cov : undefined,
        id, field: f.id, fieldName: f.name, client: f.client, clientName: clientName.get(f.client) || '', farm: f.farm,
        type: op.fieldOperationType || op.type || '', cropSeason: op.cropSeason ?? null, crop: op.cropName || op.crop || null,
        machineType: op.adaptMachineType || null, start, end, modified,
        measurements, extra, rels: (op.links || []).map(l => l.rel), raw: stripLinks(op)
      };
      alt ? geaendert++ : neu++;
    }
    } finally { fDone++; st.arbProgress.done = fDone; if (fDone % 50 === 0) { log(`Arbeitsdaten: ${fDone} von ${d.fields.length} Feldern · ${reqCount} Abfragen`); saveSt(); } }
  });
  if (first403 && fehler === d.fields.length) throw Object.assign(new Error('Keine Berechtigung für Arbeitsdaten (403). In der John-Deere-App die Arbeitsdaten-Schnittstelle (ag2) freischalten und in jd-sync neu bei John Deere anmelden.'), { status: 403 });
  if (first403) log(`Arbeitsdaten: bei ${fehler} Feldern kein Zugriff (403)`);
  // Felder/Mandanten-Namen nachführen (Umbenennungen in MyJohnDeere)
  for (const o of Object.values(arb.ops)) { const fi = fieldInfo.get(o.field); if (fi) { o.fieldName = fi.name; o.client = fi.client; o.clientName = clientName.get(fi.client) || o.clientName; } }
  if (voll) for (const o of Object.values(arb.ops)) o.v = 2; // nicht mehr gelieferte Arbeitsgänge lösen keinen Volllauf mehr aus
  arb.lastOk = new Date().toISOString(); arb.seit = seit; if (voll) arb.lastFull = arb.lastOk;
  const flaechen = () => { const q = { Maschine: 0, Bedeckungskarte: 0, '': 0 }; for (const o of Object.values(arb.ops)) { setFlaeche(o); q[o.flaecheQuelle || '']++; } st.flaechen = { maschine: q.Maschine, bedeckung: q.Bedeckungskarte, ohne: q[''] }; return q; };
  // 1. Zwischenstand sofort speichern und in die Dropbox legen (Maschinenflächen sind damit schon im IM-Verwalter)
  let q = flaechen(); save('arbeiten.json', arb);
  log(`Flächen aus Maschinendaten: ${q.Maschine} Arbeitsgänge, ${q['']} ohne – Zwischenstand in die Dropbox`);
  try { await writeArbeiten(arb); } catch (e) { log('Arbeitsdaten Zwischenstand: ' + e.message); }
  // 2. Bedeckungskarte für alle Arbeitsgänge: Fläche ohne Überlappungen («ha bedeckt») und virtuelle Feldgrenze; ersetzt auch fehlende Maschinenfläche
  //    (pro Lauf höchstens 20 Minuten; Rest beim nächsten Abgleich, ohne Maschinenfläche zuerst)
  const ohne = Object.values(arb.ops).filter(o => !covDone(o));
  st.arbProgress = { phase: 'Bedeckungskarten', done: 0, total: ohne.length, at: new Date().toISOString() }; saveSt();
  let lastUp = Date.now();
  covSave = async n => { flaechen(); save('arbeiten.json', arb); save('bedeckung-grenzen.json', grenzen); if (Date.now() - lastUp > 5 * 60 * 1000) { lastUp = Date.now(); log(`Bedeckungskarte: ${n} von ${ohne.length} bearbeitet · Speicher ${Math.round(process.memoryUsage().rss / 1048576)} MB – Zwischenstand in die Dropbox`); try { await writeArbeiten(arb); } catch { } } };
  const nCov = cfg.bedeckung === false ? 0 : await coverageAreas(ohne);
  covSave = null;
  q = flaechen();
  log(`Flächen: ${q.Maschine} Maschine, ${q.Bedeckungskarte} Bedeckungskarte${nCov ? ` (${nCov} neu berechnet)` : ''}, ${q['']} ohne Fläche`);
  for (const id of Object.keys(grenzen)) if (!arb.ops[id] || grenzen[id].mod !== arb.ops[id].modified) delete grenzen[id];
  save('arbeiten.json', arb); save('bedeckung-grenzen.json', grenzen); st.arbProgress = null;
  return { arb, neu, geaendert, fehler, from, voll, requests: reqCount };
}

/* ---------- Dropbox (App-Ordner des IM-Verwalters) ---------- */
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function dbxAuthUrl() {
  const verifier = b64url(crypto.randomBytes(48)), challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  st.pending.dbxVerifier = verifier; saveSt();
  const p = new URLSearchParams({ client_id: cfg.dbxAppKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline' });
  return `${DBX_AUTH}?${p}`;
}
async function dbxToken(params) {
  const r = await fetch(`${DBX_API}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.dbxAppKey, ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Dropbox: ' + (j.error_description || j.error || r.status));
  st.dbx = { access: j.access_token, refresh: j.refresh_token || st.dbx?.refresh, exp: Date.now() + (j.expires_in || 14400) * 1000 }; saveSt();
}
async function dbxCode(code) {
  if (!st.pending.dbxVerifier) throw new Error('Bitte zuerst «Bei Dropbox anmelden» wählen.');
  await dbxToken({ grant_type: 'authorization_code', code: code.trim(), code_verifier: st.pending.dbxVerifier });
  delete st.pending.dbxVerifier; saveSt(); log('Dropbox: verbunden');
}
async function dbxAccess() {
  if (!st.dbx) throw new Error('Nicht mit Dropbox verbunden');
  if (st.dbx.access && st.dbx.exp - 120000 > Date.now()) return st.dbx.access;
  await dbxToken({ grant_type: 'refresh_token', refresh_token: st.dbx.refresh }); return st.dbx.access;
}
const dbxArg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
async function dbxUpload(p, body) { // Text oder Buffer
  const r = await fetch(`${DBX_CONTENT}/2/files/upload`, { method: 'POST', headers: { Authorization: 'Bearer ' + await dbxAccess(), 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg({ path: p, mode: 'overwrite', mute: true }) }, body });
  if (!r.ok) throw new Error('Dropbox: Hochladen fehlgeschlagen (' + r.status + ') ' + (await r.text()).slice(0, 200));
}
async function dbxRequestPending() { // Anfrage «Jetzt abgleichen» aus dem IM-Verwalter?
  const r = await fetch(`${DBX_API}/2/files/get_metadata`, { method: 'POST', headers: { Authorization: 'Bearer ' + await dbxAccess(), 'Content-Type': 'application/json' }, body: JSON.stringify({ path: cfg.requestPath }) });
  if (r.status === 409) return false;
  if (!r.ok) throw new Error('Dropbox ' + r.status);
  return true;
}
async function dbxDownload(p) { // Datei als Text, null = nicht vorhanden
  const r = await fetch(`${DBX_CONTENT}/2/files/download`, { method: 'POST', headers: { Authorization: 'Bearer ' + await dbxAccess(), 'Dropbox-API-Arg': dbxArg({ path: p }) } });
  if (r.status === 409) return null;
  if (!r.ok) throw new Error('Dropbox: Herunterladen fehlgeschlagen (' + r.status + ')');
  return r.text();
}
async function dbxList(p) { // Dateinamen in einem Ordner
  const call = async (ep, body) => { const r = await fetch(`${DBX_API}/2/files/${ep}`, { method: 'POST', headers: { Authorization: 'Bearer ' + await dbxAccess(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (r.status === 409) return null; if (!r.ok) throw new Error('Dropbox: Ordner lesen fehlgeschlagen (' + r.status + ')'); return r.json(); };
  let j = await call('list_folder', { path: p === '/' ? '' : p }); const out = [];
  while (j) { (j.entries || []).forEach(e => e['.tag'] === 'file' && out.push(e.name)); j = j.has_more ? await call('list_folder/continue', { cursor: j.cursor }) : null; }
  return out;
}
async function dbxDelete(p) { await fetch(`${DBX_API}/2/files/delete_v2`, { method: 'POST', headers: { Authorization: 'Bearer ' + await dbxAccess(), 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) }); }

/* ---------- Abgleich ---------- */
// Schutz vor unvollständigen Antworten von John Deere: wechselt die Kundenebene (Betriebe ↔ Mandanten) oder fehlen plötzlich
// viele Kunden/Felder, wird die Datei NICHT geschrieben. Bleibt das Ergebnis beim nächsten Abgleich gleich, gilt es als gewollt.
function plausibel(d) {
  if (!d.clients.length || !d.fields.length) throw new Error(`Abgleich nicht übernommen: John Deere lieferte ${d.clients.length} Kunden und ${d.fields.length} Felder – der IM-Verwalter bleibt unverändert.`);
  const L = st.lastOk; if (!L || !L.clients) return;
  const grund = [];
  if (cfg.kundenEbene === 'auto' && L.ebene && d.kundenEbene !== L.ebene) grund.push(`Kundenebene würde von ${L.ebene === 'farms' ? 'Betrieben' : 'Mandanten'} zu ${d.kundenEbene === 'farms' ? 'Betrieben' : 'Mandanten'} wechseln`);
  if (L.clients >= 5 && d.clients.length < L.clients * 0.7) grund.push(`nur noch ${d.clients.length} statt ${L.clients} Kunden`);
  if (L.fields >= 20 && d.fields.length < L.fields * 0.7) grund.push(`nur noch ${d.fields.length} statt ${L.fields} Felder`);
  if (!grund.length) { delete st.verdacht; return; }
  const key = `${d.kundenEbene}:${d.clients.length}:${d.fields.length}`;
  if (st.verdacht === key) { log(`Hinweis: ${grund.join(', ')} – beim zweiten Abgleich gleich, wird übernommen.`); delete st.verdacht; return; }
  st.verdacht = key;
  throw new Error(`Abgleich nicht übernommen: ${grund.join(', ')}. Vermutlich unvollständige Antwort von John Deere – der IM-Verwalter bleibt unverändert. Ist die Änderung gewollt, wird sie beim nächsten Abgleich übernommen (oder «Kunden entsprechen …» fest einstellen).`);
}
async function runSync(reason) {
  if (st.running) return; st.running = true; saveSt();
  const t0 = Date.now(); log(`Abgleich gestartet (${reason})`);
  try {
    const d = await readJohnDeere();
    const n = d._requests; delete d._requests;
    plausibel(d);
    await dbxUpload(cfg.syncPath, JSON.stringify(d));
    st.lastOk = { at: new Date().toISOString(), ebene: d.kundenEbene, clients: d.clients.length, fields: d.fields.length, withArea: d.fields.filter(f => f.flaeche != null).length };
    log(`Abgleich fertig: ${d.clients.length} Kunden (${d.kundenEbene === 'farms' ? 'Betriebe' : 'Mandanten'}), ${d.fields.length} Felder (${st.lastOk.withArea} mit Fläche) · ${n} Abfragen · ${Math.round((Date.now() - t0) / 1000)} s`);
    st.last = { at: new Date().toISOString(), ok: true };
    // Arbeitsdaten separat – ein Fehler hier stört den Abgleich von Mandanten/Feldern nicht
    if (cfg.arbeitenAktiv) await runArbeiten(d);
  } catch (e) {
    st.last = { at: new Date().toISOString(), ok: false, error: e.message };
    log('FEHLER: ' + e.message);
  } finally { st.running = false; saveSt(); }
}
async function writeArbeiten(arb) {
  // haB = Fläche aus der Bedeckungskarte ohne Überlappungen (jede Stelle einmal), unabhängig von der Maschinenfläche
  const ops = Object.values(arb.ops).sort((a, b) => String(b.start || '').localeCompare(String(a.start || ''))).map(({ lk, cov, covReq, v, ...o }) => {
    if (cov && cov.mod === o.modified && cov.ha) o.haB = cov.ha; if (grenzen[o.id]) o.grzB = 1; return o; });
  const gz = {}; for (const o of ops) if (grenzen[o.id]) gz[o.id] = grenzen[o.id].grz;
  try { await dbxUpload(cfg.grenzenPath || '/jd-grenzen.json', JSON.stringify({ format: 'jd-grenzen', v: 1, dienst: VERSION, stand: new Date().toISOString(), info: 'Virtuelle Feldgrenzen aus den Bedeckungskarten (GeoJSON-MultiPolygon-Koordinaten je Arbeitsgang)', ops: gz })); } catch (e) { log('Virtuelle Feldgrenzen hochladen: ' + e.message); }
  await dbxUpload(cfg.arbeitenPath, JSON.stringify({ format: 'jd-arbeiten', v: 2, dienst: VERSION, flaechen: st.flaechen || null, bedeckung: st.covInfo ? { at: st.covInfo.at, gefragt: st.covInfo.gefragt, berechnet: st.covInfo.mitFlaeche, ohneKarte: st.covInfo.ohneKarte, offen: st.covInfo.offen, gestoppt: st.covInfo.gestoppt, antworten: st.covInfo.status, meldungen: st.covInfo.meldungen } : null, stand: new Date().toISOString(), org: { id: cfg.orgId, name: cfg.orgName }, seit: arb.seit, operations: ops }));
  return ops;
}
async function runArbeiten(d) {
  const t0 = Date.now();
  try {
    if (!hasAg2()) throw new Error('Anmeldung ohne Berechtigung für Arbeitsdaten – bitte in jd-sync neu bei John Deere anmelden.');
    const r = await readArbeiten(d);
    const ops = await writeArbeiten(r.arb);
    const types = {}; ops.forEach(o => { types[o.type || '?'] = (types[o.type || '?'] || 0) + 1; });
    st.arbOk = { at: new Date().toISOString(), ops: ops.length, neu: r.neu, geaendert: r.geaendert, types, seit: r.arb.seit };
    st.arbLast = { at: new Date().toISOString(), ok: true };
    log(`Arbeitsdaten fertig: ${ops.length} Arbeitsgänge (${r.neu} neu, ${r.geaendert} geändert, ${r.voll ? 'vollständig ab' : 'ab'} ${r.from}) · ${r.requests} Abfragen · ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) {
    st.arbProgress = null;
    st.arbLast = { at: new Date().toISOString(), ok: false, error: e.message };
    log('Arbeitsdaten FEHLER: ' + e.message);
  }
}
/* ---------- Datensicherung und wöchentlicher Excel-Export ---------- */
const BACKUP_DIR = (() => { const d = process.env.BACKUP_DIR || '/backup'; try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch { return path.join(DATA, 'sicherungen'); } })();
const tzNow = () => { const tz = process.env.TZ || 'Europe/Zurich', n = new Date(); const day = n.toLocaleDateString('sv-SE', { timeZone: tz }); const [h, m] = n.toLocaleTimeString('de-CH', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number); const wd = new Date(day + 'T12:00:00Z').getUTCDay(); return { day, min: h * 60 + m, wd, hm: `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}` }; };
const toMinutes = t => { const m = /^(\d{1,2}):?(\d{2})$/.exec(String(t || '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
// welche Sicherungen behalten? je Tag die neueste der letzten N Tage + je Monat die erste der letzten M Monate
function pruneList(names, re, keepDays, keepMonths) {
  const items = names.map(n => { const m = re.exec(n); return m ? { n, day: m[1] } : null; }).filter(Boolean).sort((a, b) => b.n.localeCompare(a.n));
  const { day: today } = tzNow(), cutDay = new Date(Date.parse(today) - keepDays * 864e5).toISOString().slice(0, 10);
  const cutMon = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - keepMonths); return d.toISOString().slice(0, 7); })();
  const keep = new Set(), seenDay = new Set(), firstOfMonth = new Map();
  items.forEach(it => { if (it.day >= cutDay && !seenDay.has(it.day)) { seenDay.add(it.day); keep.add(it.n); } });
  items.slice().reverse().forEach(it => { const mo = it.day.slice(0, 7); if (mo >= cutMon && !firstOfMonth.has(mo)) firstOfMonth.set(mo, it.n); });
  firstOfMonth.forEach(n => keep.add(n));
  return items.filter(it => !keep.has(it.n)).map(it => it.n);
}
const RE_JSON = /^planung_(\d{4}-\d{2}-\d{2})_\d{4}\.json$/, RE_XLSX = /^(?:Lohnarbeit|IM-Verwalter)-Daten_(\d{4}-\d{2}-\d{2})\.xlsx$/;
async function runBackup(reason, { excel } = {}) {
  if (st.backupRunning) return; st.backupRunning = true;
  const { day, hm, wd } = tzNow(), out = [];
  try {
    if (!st.dbx) throw new Error('Nicht mit Dropbox verbunden');
    const text = await dbxDownload(cfg.datenPfad);
    if (text == null) { const names = await dbxList('/').catch(() => []); throw new Error(`Datendatei ${cfg.datenPfad} nicht gefunden${names.length ? ' – im Ordner liegen: ' + names.slice(0, 8).join(', ') : ''}`); }
    let data; try { data = JSON.parse(text); } catch { throw new Error('Datendatei ist kein gültiges JSON'); }
    const name = `planung_${day}_${hm}.json`;
    if (cfg.sicherungNas) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true }); fs.writeFileSync(path.join(BACKUP_DIR, name), text); out.push('NAS');
      pruneList(fs.readdirSync(BACKUP_DIR), RE_JSON, +cfg.behaltTage, +cfg.behaltMonate).forEach(n => { try { fs.unlinkSync(path.join(BACKUP_DIR, n)); } catch { } });
    }
    if (cfg.sicherungDbx) {
      const dir = cfg.sicherungDbxPfad.replace(/\/+$/, '');
      await dbxUpload(`${dir}/${name}`, text); out.push('Dropbox');
      for (const n of pruneList(await dbxList(dir), RE_JSON, +cfg.behaltTage, +cfg.behaltMonate)) await dbxDelete(`${dir}/${n}`);
    }
    const n = k => (data[k] || []).filter(x => !x.del).length;
    st.backupLast = { at: new Date().toISOString(), ok: true, name, wo: out, kb: Math.round(text.length / 1024), counts: `${n('auftraege')} Aufträge · ${n('kunden')} Kunden · ${n('produkte')} Produkte` };
    log(`Sicherung (${reason}): ${name} · ${st.backupLast.kb} KB · ${out.join(' + ')}`);
    if (excel || (cfg.excelAktiv && wd === +cfg.excelTag && st.excelLastDay !== day)) await runExcel(data, reason);
  } catch (e) {
    st.backupLast = { at: new Date().toISOString(), ok: false, error: e.message }; log('Sicherung FEHLER: ' + e.message);
  } finally { st.backupRunning = false; saveSt(); }
}
async function runExcel(data, reason) {
  const { day } = tzNow();
  try {
    if (!data) { const t = await dbxDownload(cfg.datenPfad); if (t == null) throw new Error(`Datendatei ${cfg.datenPfad} nicht gefunden`); data = JSON.parse(t); }
    const sheets = bakErweitern(excelSheets(data), data), buf = xlsxBuffer(sheets), name = `IM-Verwalter-Daten_${day}.xlsx`, dir = cfg.excelPfad.replace(/\/+$/, '');
    await dbxUpload(`${dir}/${name}`, buf);
    for (const n of pruneList(await dbxList(dir), RE_XLSX, 7 * +cfg.excelBehalt, 0)) await dbxDelete(`${dir}/${n}`);
    if (cfg.sicherungNas) { const nd = path.join(BACKUP_DIR, 'excel'); fs.mkdirSync(nd, { recursive: true }); fs.writeFileSync(path.join(nd, name), buf); pruneList(fs.readdirSync(nd), RE_XLSX, 7 * +cfg.excelBehalt, 0).forEach(n => { try { fs.unlinkSync(path.join(nd, n)); } catch { } }); }
    st.excelLastDay = day; st.excelLast = { at: new Date().toISOString(), ok: true, name, info: sheets.map(s => `${s.name} ${s.rows.length - 1}`).join(' · ') };
    log(`Excel-Export (${reason}): ${dir}/${name} · ${st.excelLast.info}`);
  } catch (e) { st.excelLast = { at: new Date().toISOString(), ok: false, error: e.message }; log('Excel-Export FEHLER: ' + e.message); }
  saveSt();
}
// ---- Excel-Datei (ohne Zusatzpakete): ZIP ohne Kompression + Tabellenblätter
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), data = Buffer.from(f.data), crc = crc32(data), h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, name, data); central.push(c, name); off += 30 + name.length + data.length;
  }
  const cs = central.reduce((s, b) => s + b.length, 0), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cs, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, ...central, e]);
}
const xEsc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const xCol = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function xSheet(rows) {
  const w = rows[0].map((_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 400).map(r => String(r[c] ?? '').length + 2))));
  const cell = (v, r, c) => v == null || v === '' ? '' : typeof v === 'number' && isFinite(v) ? `<c r="${xCol(c)}${r + 1}"${r ? '' : ' s="1"'}><v>${v}</v></c>` : `<c r="${xCol(c)}${r + 1}" t="inlineStr"${r ? '' : ' s="1"'}><is><t xml:space="preserve">${xEsc(v)}</t></is></c>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${w.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${x}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('')}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${xCol(rows[0].length - 1)}${rows.length}"/>` : ''}</worksheet>`;
}
function xlsxBuffer(sheets) {
  const names = sheets.map(s => s.name.replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31)), x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipStore([
    { name: '[Content_Types].xml', data: `${x}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `${x}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${x}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${x}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `${x}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F6B3A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xSheet(s.rows) }))
  ]);
}
// dieselben Tabellen wie «Alles als Excel» im IM-Verwalter
/* ================= Datensicherung Excel: zusätzliche Blätter (gleicher Code im IM-Verwalter und im NAS-Dienst) ================= */
// Arbeitet nur mit den Rohdaten D (Inhalt von planung.json), damit beide Seiten dieselbe Datei erzeugen.
const BAK_VER = 2;
function bakHelpers(D) {
  const all = k => (D[k] || []).filter(x => x && !x.del), byId = k => new Map(all(k).map(x => [x.id, x]));
  const Kd = byId('kunden'), Fd = byId('felder'), Pd = byId('produkte'), Zd = byId('parzellen');
  const r2 = x => x == null || x === '' || isNaN(+x) ? '' : Math.round(+x * 100) / 100;
  const kn = id => (Kd.get(id) || {}).name || '';
  const einst = all('einstellungen'), cfg = einst.find(x => x.id === 'cfg') || {};
  const yearRecs = pre => einst.filter(x => new RegExp(`^${pre}-\\d{4}$`).test(x.id)).sort((a, b) => b.jahr - a.jahr);
  const pName = (pid, name) => (pid && Pd.get(pid) || {}).name || name || '';
  const dt = s => s ? String(s).slice(0, 10) : '';
  return { all, Kd, Fd, Pd, Zd, r2, kn, einst, cfg, yearRecs, pName, dt };
}
// Zusätzliche Spalten im Blatt «Aufträge» (vor der ID)
const BAK_AUFTRAG_KOPF = ['Mehrtägig', 'Rübensaat Sorten (geplant)', 'Rübensaat gesät pro Sorte', 'Spritzprogramm', 'Verknüpfter JD-Arbeitsgang'];
function bakAuftragCols(a) {
  const r2 = x => x == null || x === '' ? '' : Math.round(+x * 100) / 100;
  const S = a.rsSorten || [], ist = a.rsIst || {};
  const vb = a.vbInfo ? [a.vbInfo.prog, a.vbInfo.beh].filter(Boolean).join(' › ') : '';
  return [a.mehrtag === 'arbeitszeit' ? 'in der Arbeitszeit' : a.mehrtag ? 'durchgehend' : '',
    S.map(x => `${x.name} ${r2(x.ha)} ha`).join(', '),
    S.filter(x => ist[x.sid] != null).map(x => `${x.name} ${r2(ist[x.sid])} ha`).join(', '),
    vb, a.jdLink || ''];
}
function bakSheets(D) {
  const H = bakHelpers(D), { all, Fd, r2, kn, cfg, yearRecs, pName, dt } = H, out = [];
  // Vermessungen (Feldgrenzen aus MyJohnDeere)
  const ve = [['Kunde', 'Feld', 'Vermessung', 'Fläche ha', 'bearbeitbar ha', 'Aktiv', 'Archiviert', 'Quelle', 'Signal', 'Erstellt', 'Geändert', 'Feld-ID']];
  all('felder').sort((a, b) => kn(a.kunde).localeCompare(kn(b.kunde), 'de') || String(a.name).localeCompare(String(b.name), 'de'))
    .forEach(f => (f.grenzen || []).forEach(g => ve.push([kn(f.kunde), f.name, g.name || '', r2(g.ha), r2(g.bha), g.aktiv ? 'ja' : 'nein', g.archiviert ? 'ja' : '', g.quelle || '', String(g.signal || '').replace(/^dtiSignalType/i, ''), dt(g.erstellt), dt(g.geaendert), f.id])));
  out.push({ name: 'Vermessungen', rows: ve });
  // Spritzprogramme und Vorbestellung
  const VB = yearRecs('vb'), sp = [['Erntejahr', 'Programm', 'Kultur', 'Variante', 'Behandlung', 'Stadium BBCH', 'Hinweis', 'Mittel', 'Menge/ha', 'Einheit', 'Optional', 'Zusatzfläche ha']];
  VB.forEach(r => (r.progs || []).forEach(p => { const B = p.beh || [{ name: '', mittel: p.mittel || [] }];
    B.forEach(b => { const M = b.mittel && b.mittel.length ? b.mittel : [{}]; M.forEach(m => sp.push([r.jahr, p.name, p.kultur || '', p.variante || '', b.name || '', b.stadium || '', b.hinweis || '', m.name || m.pid ? pName(m.pid, m.name) : '', r2(m.menge), m.einheit || '', m.optional ? 'ja' : '', r2(p.extraHa)])); }); }));
  out.push({ name: 'Spritzprogramme', rows: sp });
  const vo = [['Erntejahr', 'Art', 'Kunde', 'Programm', 'Parzelle', 'Artikel', 'Menge', 'Einheit']];
  VB.forEach(r => { const P = new Map((r.progs || []).map(p => [p.id, p])), R = new Map((r.rows || []).map(x => [x.id, x])), rn = x => x ? (x.kunde ? kn(x.kunde) : x.name || '') : '';
    (r.rows || []).forEach(x => (r.progs || []).forEach(p => { const L = (r.parz || {})[x.id + '|' + p.id];
      if (L && L.length) L.forEach(z => vo.push([r.jahr, 'Fläche (Parzelle)', rn(x), p.name, (H.Zd.get(z.pz) || {}).name || '', '', r2(z.ha), 'ha']));
      else { const v = ((r.fl || {})[x.id] || {})[p.id]; if (v) vo.push([r.jahr, 'Fläche', rn(x), p.name, '', '', r2(v), 'ha']); } }));
    Object.entries(r.vorrat || {}).forEach(([k, v]) => { if (v) vo.push([r.jahr, 'Vorrat', '', '', '', k.startsWith('n:') ? k.slice(2) : pName(k, (r.vnames || {})[k] || k), r2(v), (r.vunits || {})[k] || '']); });
    (r.zusatz || []).forEach(z => vo.push([r.jahr, 'Zusatzprodukt', '', '', '', pName(z.pid, z.name), r2(z.menge), z.einheit || '']));
  });
  out.push({ name: 'Vorbestellung', rows: vo });
  // Rübensamen
  const RS = yearRecs('rs'), korr = (fg, p) => (((fg / 3 - 1) * 6) + (4 * p + 4)) / (fg * 2);
  const dpha = (r, x) => { const eigen = x.lege || x.fga || x.fga === 0; let d = r.dpha || 0;
    if (eigen) { const lege = x.lege || r.lege || 17, fga = x.fga === 0 ? 0 : (x.fga || r.fga || 21); d = Math.round(2e6 / lege / 1e5 * (fga ? korr(fga, r.fgp ?? 0.2) : 1) * 100) / 100; }
    return Math.round(d * (1 + (r.ueber || 0)) * 100) / 100; };
  const rf = [['Jahr', 'Kunde', 'Legeabstand cm', 'Fahrgasse m', 'Dosen/ha', 'Sorte', 'Gruppe', 'bestellt ha', 'Dosen', 'Conviso One', 'Conviso One Abrechnung', 'Abgerechnet am', 'Saattermine', 'Bemerkung']];
  const rso = [['Jahr', 'Sorte', 'Gruppe', 'Grundpreis CHF', 'Vertriebskosten CHF', 'Preis/Dose CHF', 'Restmenge', 'Zusätzlich', 'Bestellung']];
  RS.forEach(r => { const S = r.sorten || [], sn = id => (S.find(s => s.id === id) || {}).name || '';
    (r.rows || []).forEach(x => { const d = dpha(r, x), conv = S.filter(s => s.gruppe === 'conv').reduce((t, s) => t + ((x.ha || {})[s.id] || 0), 0), cone = x.cone != null ? x.cone : conv;
      const saat = (x.saat || []).map(z => [z.d, z.ha != null ? z.ha + ' ha' : '', sn(z.sid), z.txt].filter(Boolean).join(' ')).join('; ');
      const L = S.filter(s => (x.ha || {})[s.id]);
      (L.length ? L : [null]).forEach((s, i) => rf.push([r.jahr, x.kunde ? kn(x.kunde) : x.name || '', x.lege ?? '', x.fga === 0 ? '–' : (x.fga ?? ''), d, s ? s.name : '', s ? (s.gruppe === 'conv' ? 'Conviso Smart' : 'Standard') : '',
        s ? r2(x.ha[s.id]) : '', s ? r2(x.ha[s.id] * d) : '', i ? '' : r2(cone) || '', i ? '' : (x.coneAbr ?? ''), i ? '' : dt(x.abr), i ? '' : saat, i ? '' : x.notiz || ''])); });
    const vers = s => s.versand != null ? s.versand : (r.versand || 0);
    S.forEach(s => rso.push([r.jahr, s.name, s.gruppe === 'conv' ? 'Conviso Smart' : 'Standard', r2(s.preis), r2(vers(s)), s.preis != null ? r2(s.preis * (1 + (r.mwst || 0)) + vers(s)) : '', r2((r.rest || {})[s.id]),
      (r.extra || []).filter(e => (e.d || {})[s.id]).map(e => `${e.name} ${e.d[s.id]}`).join(', '), (r.best || {})[s.id] ?? 'Vorschlag']));
    const c = r.cone || {}; rso.push([r.jahr, c.name || 'Conviso One', 'Herbizid', r2(c.preis), r2(c.versand), c.preis != null ? r2(c.preis * (1 + (r.mwst || 0)) + (c.versand || 0)) : '', r2((r.rest || {}).cone), '', (r.best || {}).cone ?? 'Vorschlag']); });
  out.push({ name: 'Rübensamen', rows: rf }, { name: 'Rübensamen Sorten', rows: rso });
  // MyJohnDeere: als abgerechnet markierte Arbeitsgänge und von Hand verknüpfte Aufträge
  const jd = [['Art', 'Arbeitsgang-ID', 'Auftrag-Nr', 'Datum', 'Auftrag-ID']];
  H.einst.filter(x => /^jdabr-/.test(x.id)).forEach(x => jd.push(['abgerechnet', x.id.slice(6), '', dt(x.am), '']));
  all('auftraege').forEach(a => { if (a.jdLink) jd.push(['verknüpft', a.jdLink, a.nr || '', '', a.id]); (a.jdUnlink || []).forEach(j => jd.push(['Verknüpfung gelöst', j, a.nr || '', '', a.id])); });
  out.push({ name: 'JD-Abrechnung', rows: jd });
  // Einstellungen (alle Geräte) und Jahreswerte der Module
  const es = [['Bereich', 'Einstellung', 'Wert']], yn = b => b ? 'ja' : 'nein';
  es.push(['Planung', 'Arbeitsbeginn', cfg.beginn || ''], ['Planung', 'Arbeitsende', cfg.ende || ''],
    ['Kalenderabo', 'eingeschaltet', yn(cfg.ics && cfg.ics.on)], ['Kalenderabo', 'Freigabelink', (cfg.ics && cfg.ics.link) || ''],
    ['Kunden', 'Parzellen-Zuweisung (Spritzen)', yn(cfg.parzZuweisung !== false)], ['Module', 'Rübensamen eingeschaltet', yn(cfg.rsOn)],
    ['MyJohnDeere', 'Organisation', cfg.jdOrg || ''], ['MyJohnDeere', 'Organisations-ID', cfg.jdOrgId || ''], ['MyJohnDeere', 'letzter Abgleich', cfg.jdStand || ''], ['MyJohnDeere', 'NAS-Dienst Version', cfg.jdDienst || ''],
    ['MyJohnDeere', 'Adresse Kunden', cfg.jdOcKunde || ''], ['MyJohnDeere', 'Adresse Felder', cfg.jdOcFeld || '']);
  RS.forEach(r => es.push([`Rübensamen ${r.jahr}`, 'Dosen/ha (Standard)', r.dpha ?? ''], [`Rübensamen ${r.jahr}`, 'MwSt %', r2((r.mwst || 0) * 100)], [`Rübensamen ${r.jahr}`, 'Vertriebskosten pro Dose CHF', r.versand ?? ''],
    [`Rübensamen ${r.jahr}`, 'Zuschlag Überlappungen %', r2((r.ueber || 0) * 100)], [`Rübensamen ${r.jahr}`, 'Legeabstand cm (Standard)', r.lege ?? ''], [`Rübensamen ${r.jahr}`, 'Fahrgassenabstand m (Standard)', r.fga ?? ''],
    [`Rübensamen ${r.jahr}`, 'Zuschlag Fahrgasse %', r2((r.fgp ?? 0.2) * 100)], [`Rübensamen ${r.jahr}`, 'Conviso One Einheiten/ha', (r.cone || {}).faktor ?? 1]));
  es.push(['Modul', 'Eigener Betrieb eingeschaltet', yn(cfg.ebOn)]);
  es.push(['Sicherung', 'Format', `Excel-Sicherung Version ${BAK_VER}`]);
  out.push({ name: 'Einstellungen', rows: es });
  return [...out, ...bakBetrieb(D, H)];
}
// Modul «Eigener Betrieb»: Daten in einstellungen «eb-stamm» und «eb-<Jahr>» (Parzellen, Fruchtfolge, Düngung, Zwischenfrüchte, Bodenproben)
function bakBetrieb(D, H) {
  const { r2, yearRecs, dt } = H, st = H.einst.find(x => x.id === 'eb-stamm'), EB = yearRecs('eb');
  if (!st && !EB.length) return [];
  const S = st || {}, P = new Map((S.parz || []).map(p => [p.id, p])), pn = id => { const p = P.get(id); return p ? [p.name, p.teil].filter(Boolean).join(' ') : ''; };
  const K = new Map((S.kulturen || []).map(k => [k.id, k])), kul = v => (K.get(v) || {}).name || v || '';
  const txt = v => v == null ? '' : Array.isArray(v) ? v.map(txt).filter(Boolean).join(', ') : typeof v === 'object' ? (v.name || v.label || JSON.stringify(v)) : v;
  const out = [];
  out.push({ name: 'Betrieb Parzellen', rows: [['Parzelle', 'Teil', 'Gruppe', 'Fläche ha', 'Feld (MyJohnDeere)', 'Aktiv', 'Notiz', 'ID'],
    ...(S.parz || []).map(p => [p.name || '', p.teil || '', p.gruppe || '', r2(p.ha), (H.Fd.get(p.feld) || {}).name || p.feld || '', p.aktiv === false ? 'nein' : 'ja', p.notiz || '', p.id])] });
  out.push({ name: 'Betrieb Kulturen', rows: [['Kultur', 'N-Bedarf kg/ha', 'Anbaupause Jahre', 'Dauerkultur', 'Farbe'],
    ...(S.kulturen || []).map(k => [k.name, k.n ?? '', k.pause ?? '', k.dauer ? 'ja' : '', k.farbe || ''])] });
  const ff = [['Jahr', 'Parzelle', 'Art', 'Kultur', 'Mischung', 'Fläche ha', 'Sorte', 'Programme', 'N-Bedarf', 'Korrektur', 'Vorkultur', 'Bemerkung', 'ID']];
  const dg = [['Jahr', 'Parzelle', 'Kultur', 'Datum', 'Dünger', 'Menge', 'Einheit', 'N je Einheit']];
  const du = [['Jahr', 'Dünger', 'Einheit', 'N je Einheit', 'Zufuhr', 'Vorrat']];
  const zf = [['Jahr', 'Typ', 'Name', 'Preis CHF', 'Rein', 'Rest', 'Bestellung', 'Fläche ha', 'Zusammensetzung']];
  EB.forEach(r => {
    const Dn = new Map((r.duenger || []).map(d => [d.id, d])), Z = r.zf || {}, Ar = new Map((Z.arten || []).map(a => [a.id, a])), Mx = new Map((Z.mix || []).map(m => [m.id, m]));
    (r.schlaege || []).forEach(z => {
      const ha = z.ha != null ? z.ha : (P.get(z.parz) || {}).ha;
      ff.push([r.jahr, pn(z.parz) || z.name || '', z.art === 'zwischen' ? 'Zwischenfrucht' : 'Hauptkultur', kul(z.kultur), (Mx.get(z.mix) || {}).name || txt(z.mix), r2(ha), z.sorte || '', txt(z.prog), z.nBed ?? '', z.korr ?? '', txt(z.vk), z.bem || '', z.id]);
      (z.gaben || []).forEach(g => { const d = Dn.get(g.d) || {}; dg.push([r.jahr, pn(z.parz) || z.name || '', kul(z.kultur), dt(g.datum), d.name || txt(g.d), r2(g.menge), d.einheit || '', d.n ?? '']); });
    });
    (r.duenger || []).forEach(d => du.push([r.jahr, d.name || '', d.einheit || '', d.n ?? '', d.zufuhr ?? '', r2(d.vorrat)]));
    (Z.arten || []).forEach(a => zf.push([r.jahr, 'Art', a.name || '', r2(a.preis), r2(a.rein), r2(a.rest), r2(a.best), '', '']));
    (Z.mix || []).forEach(m => zf.push([r.jahr, 'Mischung', m.name || '', '', '', '', '', r2(m.ha), Object.entries(m.anteile || {}).map(([id, v]) => `${(Ar.get(id) || {}).name || id} ${v}`).join(', ')]));
  });
  out.push({ name: 'Betrieb Fruchtfolge', rows: ff }, { name: 'Betrieb Düngung', rows: dg }, { name: 'Betrieb Dünger', rows: du }, { name: 'Betrieb Zwischenfrüchte', rows: zf });
  const BL = { humus: 'Humus %', ph: 'pH', kak: 'KAK', ca: 'Calcium %', mg: 'Magnesium %', k: 'Kali %', na: 'Natrium %', basen: 'Andere Basen %', h: 'H+ %', n: 'Stickstoff', s: 'Schwefel ppm', p: 'Phosphor', b: 'Bor ppm', fe: 'Eisen ppm', mn: 'Mangan ppm', cu: 'Kupfer ppm', zn: 'Zink ppm', mo: 'Molybdän ppm', co: 'Kobalt ppm', eZn: 'Empf. Zinksulfat', eB: 'Empf. Borsäure', eMo: 'Empf. Molybdän', eSalz: 'Empf. Salz' };
  const B = S.boden || [], keys = [...new Set(B.flatMap(b => Object.keys(b.w || {})))];
  out.push({ name: 'Betrieb Bodenproben', rows: [['Parzelle', 'Probe', 'Jahr', 'Labor', 'ÖLN', ...keys.map(k => BL[k] || k), 'Notiz'], ...B.map(b => [pn(b.parz), b.name || '', b.jahr || '', b.labor || '', b.oeln ? 'ja' : '', ...keys.map(k => (b.w || {})[k] ?? ''), b.notiz || ''])] });
  return out;
}
// Blatt «Aufträge» um die neuen Felder ergänzen (vor der Spalte ID) und die neuen Blätter anhängen
function bakErweitern(sheets, D) {
  const A = new Map((D.auftraege || []).map(a => [a.id, a])), sh = sheets.find(x => x.name === 'Aufträge');
  if (sh && sh.rows.length) { const i = sh.rows[0].lastIndexOf('ID'); if (i >= 0) { sh.rows[0].splice(i, 0, ...BAK_AUFTRAG_KOPF); for (let k = 1; k < sh.rows.length; k++) { const a = A.get(sh.rows[k][i]); sh.rows[k].splice(i, 0, ...(a ? bakAuftragCols(a) : BAK_AUFTRAG_KOPF.map(() => ''))); } } }
  return [...sheets, ...bakSheets(D)];
}

function excelSheets(D) {
  const all = k => (D[k] || []).filter(x => x && !x.del), byId = k => new Map(all(k).map(x => [x.id, x]));
  const Kd = byId('kunden'), Md = byId('maschinen'), Fd = byId('felder'), Pd = byId('produkte'), cfgDoc = all('einstellungen').find(x => x.id === 'cfg') || {};
  const STATUS = { offen: 'Offen', geplant: 'Geplant', erledigt: 'Erledigt', verrechnet: 'Verrechnet' }, statusOf = a => a.status || (a.datum ? 'geplant' : 'offen');
  const isSpray = a => /spritz|pflanzenschutz/i.test(a.arbeit || ''), prods = a => (a.produkte || []).filter(p => p && p.name);
  const ernte = a => { if (a.erntejahr) return a.erntejahr; const d = a.erledigtAm || a.datum; if (!d) return ''; const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 9 ? y + 1 : y; };
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'), K = id => Kd.get(id) || {}, yn = b => b === false ? 'nein' : 'ja', r2 = x => Math.round(x * 100) / 100;
  const prodOf = p => Pd.get(p.pid) || all('produkte').find(x => x.name === p.name);
  const prodAt = (pr, iso) => { if (!pr) return {}; const v = (pr.verlauf || []).filter(e => e.ab <= (iso || '9999')).sort((a, b) => a.ab.localeCompare(b.ab)).pop(); return v ? { ...pr, ...v } : pr; };
  const dOf = a => a.erledigtAm || a.datum || a.wunsch || '';
  const ord = all('auftraege').sort((a, b) => dOf(b).localeCompare(dOf(a)));
  const use = new Map(); all('auftraege').forEach(a => { const d = a.erledigtAm || a.datum; if (!d) return; prods(a).forEach(p => { const pr = prodOf(p); if (!pr) return; const u = use.get(pr.id) || { last: '', n: 0 }; u.n++; if (d > u.last) u.last = d; use.set(pr.id, u); }); });
  const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'], months = m => !m || !m.length || m.length === 12 ? 'ganzes Jahr' : m.map(i => MON[i - 1]).join(', ');
  const sheets = [];
  sheets.push({ name: 'Aufträge', rows: [['Auftrag-Nr', 'Status', 'Kunde', 'Kunden-Nr', 'Arbeit', 'Kultur', 'Feld / Parzelle', 'Fläche ha', 'Fläche eff. ha', 'Wunschdatum', 'Datum', 'Startzeit', 'Dauer h', 'Stunden eff.', 'Erledigt am', 'Maschine', 'Erntejahr', 'Wasser l/ha', 'Stadium', 'Düse', 'Traktor', 'Nicht ÖLN-konform', 'Produkte', 'Bemerkung', 'ID'],
    ...ord.map(a => [a.nr, STATUS[statusOf(a)], K(a.kunde).name, K(a.kunde).nr, a.arbeit, a.kultur, a.feld || (Fd.get(a.kfeld) || {}).name || '', a.flaeche, a.flaecheEff, a.wunsch, a.datum, a.zeit, a.dauer, a.stundenEff, a.erledigtAm, (Md.get(a.maschine) || {}).name,
      isSpray(a) ? ernte(a) : '', a.wasser, a.stadium, a.duese, a.traktor, a.nichtOeln ? 'ja' : '', prods(a).map(p => `${p.name} ${p.menge ?? ''} ${p.einheit || ''}/ha`.trim()).join(', '), a.notiz, a.id])] });
  const sp = [['Auftrag-Nr', 'Datum', 'Kunde', 'Parzelle', 'Kultur', 'Erntejahr', 'Fläche ha', 'Produkt', 'Zulassung', 'Menge/ha', 'Einheit', 'Menge total', 'Nicht ÖLN-konform', 'Status', 'Auftrag-ID']];
  ord.filter(isSpray).forEach(a => prods(a).forEach(p => { const fl = a.flaecheEff ?? a.flaeche; sp.push([a.nr, dOf(a), K(a.kunde).name, a.feld, a.kultur, ernte(a), fl, p.name, prodAt(prodOf(p), a.erledigtAm || a.datum).zulassung || '', p.menge, p.einheit, p.menge != null && fl != null ? r2(p.menge * fl) : '', (p.nichtOeln || a.nichtOeln) ? 'ja' : '', STATUS[statusOf(a)], a.id]); }));
  sheets.push({ name: 'Spritzprodukte', rows: sp });
  sheets.push({ name: 'Kunden', rows: [['Name', 'Kunden-Nr', 'Anrede', 'Adresse', 'PLZ', 'Ort', 'Telefon', 'Handy', 'E-Mail', 'Spritze CHF/ha', 'Fahrer CHF/ha', 'Traktor CHF/ha', 'Mittelzuschlag', 'Aktiv', 'MyJohnDeere-Name', 'MyJohnDeere-ID', 'Notiz', 'ID'], ...all('kunden').sort(byName).map(k => [k.name, k.nr, k.anrede, k.adresse, k.plz, k.ort, k.tel, k.handy, k.mail, k.preisSpritze, k.preisFahrer, k.preisTraktor, k.zuschlag, yn(k.aktiv), k.jdName, k.jdId, k.notiz, k.id])] });
  const kn = x => K(x.kunde).name || '';
  sheets.push({ name: 'Felder', rows: [['Kunde', 'Feld', 'Betrieb', 'Fläche ha', 'Aktiv', 'MyJohnDeere-ID', 'ID'], ...all('felder').sort((a, b) => kn(a).localeCompare(kn(b), 'de') || byName(a, b)).map(f => [kn(f), f.name, f.betrieb, f.flaeche, yn(f.aktiv), f.jdId, f.id])] });
  sheets.push({ name: 'Parzellen', rows: [['Kunde', 'Parzelle', 'Kultur', 'Fläche ha', 'Feld (MyJohnDeere)', 'Aktiv', 'ID'], ...all('parzellen').sort((a, b) => kn(a).localeCompare(kn(b), 'de') || byName(a, b)).map(p => [kn(p), p.name, p.kultur, p.flaeche, (Fd.get(p.feldId) || {}).name || '', yn(p.aktiv), p.id])] });
  sheets.push({ name: 'Produkte', rows: [['Produkt', 'Zulassung', 'Einheit', 'Preis CHF', 'Inventar', 'Wert CHF', 'Inventar erfasst am', 'Zuletzt verwendet', 'Einsätze', 'Aktuell', 'ID'], ...all('produkte').sort(byName).map(p => [p.name, p.zulassung, p.einheit, p.preis, p.inventar, p.inventar > 0 ? r2(p.inventar * (p.preis || 0)) : '', p.inventarAm, (use.get(p.id) || {}).last || '', (use.get(p.id) || {}).n || 0, yn(p.aktuell), p.id])] });
  const vl = [['Produkt', 'Gültig ab', 'Name', 'Zulassung', 'Preis CHF']]; all('produkte').sort(byName).forEach(p => (p.verlauf || []).forEach(e => vl.push([p.name, e.ab === '1900-01-01' ? 'bisher' : e.ab, e.name, e.zulassung, e.preis])));
  sheets.push({ name: 'Preisverlauf', rows: vl });
  sheets.push({ name: 'Maschinen', rows: [['Bezeichnung', 'Kurzname', 'Art.-Nr', 'Priorität', 'Verrechnung pro', 'Ansatz CHF', 'Flächenleistung ha/h', 'Arbeitsarten', 'Aktiv', 'ID'], ...all('maschinen').sort((a, b) => (a.prio ?? 9999) - (b.prio ?? 9999) || byName(a, b)).map(m => [m.name, m.kurz, m.artNr, m.prio, m.einheit, m.ansatz, m.leistung, (m.arbeitsarten || []).join(', '), yn(m.aktiv), m.id])] });
  const li = [['Liste', 'Eintrag']]; [['Arbeitsart', cfgDoc.arbeitsarten], ['Kultur', cfgDoc.kulturen], ['Düse', cfgDoc.duesen], ['Traktor', cfgDoc.traktoren]].forEach(([n, l]) => (Array.isArray(l) ? l : []).forEach(x => li.push([n, x])));
  li.push(['Einstellung', `Arbeitsbeginn ${cfgDoc.beginn || ''}`], ['Einstellung', `Arbeitsende ${cfgDoc.ende || ''}`], ['Export', `Stand ${new Date().toLocaleString('de-CH', { timeZone: process.env.TZ || 'Europe/Zurich' })} (automatisch, NAS)`]);
  sheets.push({ name: 'Listen', rows: li });
  return sheets;
}

/* ---------- Zeitplan: Abgleich mit MyJohnDeere nach eingestelltem Rhythmus, Sicherung täglich ---------- */
function syncSlots() { // geplante Zeitpunkte (Minuten ab Mitternacht) für heute
  if (cfg.syncMode === 'anfrage') return [];
  if (cfg.syncMode === 'intervall') {
    const von = toMinutes(cfg.syncVon) ?? 0, bis = toMinutes(cfg.syncBis) ?? 1439, step = Math.max(1, +cfg.syncIntervall || 3) * 60, out = [];
    for (let m = von; m <= bis; m += step) out.push(m); return out;
  }
  return [...new Set(String(cfg.syncZeiten || '').split(/[,;\s]+/).map(toMinutes).filter(m => m != null))].sort((a, b) => a - b);
}
const hmOf = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function rhythmText() {
  if (cfg.syncMode === 'anfrage') return 'nur auf Anfrage aus dem IM-Verwalter';
  if (cfg.syncMode === 'intervall') return `alle ${cfg.syncIntervall} h von ${cfg.syncVon} bis ${cfg.syncBis} Uhr`;
  const s = syncSlots(); return s.length ? `täglich um ${s.map(hmOf).join(', ')} Uhr` : 'keine Uhrzeit eingestellt';
}
function nextSync() { const { min } = tzNow(), s = syncSlots(); const n = s.find(x => x > min); return n != null ? `heute ${hmOf(n)}` : s.length ? `morgen ${hmOf(s[0])}` : '–'; }
// Übergang von der früheren Einstellung: heutigen Lauf nicht wiederholen
if (st.lastDaily && !st.lastSyncSlot) { const { day, min } = tzNow(); const s = syncSlots().filter(x => x <= min).pop(); if (st.lastDaily === day && s != null) st.lastSyncSlot = `${day}@${s}`; }
let lastPoll = 0;
setInterval(async () => {
  const { day, min } = tzNow();
  if (st.jd && st.dbx && cfg.orgId && !st.running) {
    const s = syncSlots().filter(x => x <= min).pop();
    if (s != null && st.lastSyncSlot !== `${day}@${s}`) { st.lastSyncSlot = `${day}@${s}`; saveSt(); await runSync(`geplant ${hmOf(s)}`); }
  }
  if (st.jd && st.dbx && cfg.orgId && Date.now() - lastPoll > cfg.pollMinutes * 60000) {
    lastPoll = Date.now();
    try { if (await dbxRequestPending()) { await dbxDelete(cfg.requestPath); await runSync('Anfrage aus dem IM-Verwalter'); } } catch (e) { log('Dropbox-Prüfung: ' + e.message); }
  }
  const bz = toMinutes(cfg.sicherungZeit) ?? 0;
  if (cfg.sicherungAktiv && st.dbx && min >= bz && st.lastBackupDay !== day && !st.backupRunning) { st.lastBackupDay = day; saveSt(); await runBackup('täglich'); }
}, 30000);

/* ---------- Web-Oberfläche (nur im Heimnetz) ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(msg = '', err = false) {
  const ok = (b, t) => `<span class="${b ? 'ok' : 'no'}">${b ? '✓' : '○'} ${t}</span>`;
  const orgs = st.orgs || [];
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>jd-sync ${VERSION}</title>
<style>body{font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f3f2ee;color:#1d211e}main{max-width:820px;margin:0 auto;padding:16px}
h1{font-size:22px}section{background:#fff;border:1px solid #dedbd3;border-radius:12px;padding:14px 16px;margin:12px 0}h2{font-size:16px;margin:0 0 8px}
label{display:block;font-size:13px;color:#555;margin:8px 0 3px}input,select{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #ccc;border-radius:8px;font:inherit}
button,.btn{display:inline-block;margin-top:10px;padding:9px 14px;border-radius:8px;border:1px solid #2f6b3a;background:#2f6b3a;color:#fff;font:inherit;text-decoration:none;cursor:pointer}
.btn.sec,button.sec{background:#fff;color:#2f6b3a}.ok{color:#2f7d3b;font-weight:600}.no{color:#b5580b;font-weight:600}.msg{padding:10px 12px;border-radius:8px;background:${err ? '#fde7e5' : '#e3efe4'}}
pre{background:#f6f5f1;border-radius:8px;padding:10px;font-size:12px;max-height:340px;overflow:auto;white-space:pre-wrap}.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1;min-width:200px}small{color:#666}</style></head><body><main>
<h1>jd-sync · MyJohnDeere → IM-Verwalter <small style="font-size:.5em;font-weight:500;color:#6b7280;white-space:nowrap">Version ${VERSION} · ${STAND}</small></h1>
${msg ? `<p class="msg">${esc(msg)}</p>` : ''}
<section><h2>Status</h2><div class="row"><div>${ok(cfg.clientId && cfg.clientSecret, 'John-Deere-App eingetragen')}<br>${ok(!!st.jd, 'Bei John Deere angemeldet')}<br>${ok(!!cfg.orgId, 'Organisation: ' + esc(cfg.orgName || '–'))}<br>${ok(!!st.dbx, 'Mit Dropbox verbunden')}</div>
<div>Letzter Abgleich: ${st.last ? `${esc(new Date(st.last.at).toLocaleString('de-CH'))} ${st.last.ok ? '<span class="ok">ok</span>' : `<span class="no">Fehler</span><br><small>${esc(st.last.error)}</small>`}` : '–'}<br>
${st.lastOk ? `${st.lastOk.clients} Kunden (${st.lastOk.ebene === 'farms' ? 'aus Betrieben' : 'aus Mandanten'}) · ${st.lastOk.fields} Felder (${st.lastOk.withArea} mit Fläche)` : ''}<br>Abgleich ${esc(rhythmText())} · nächster: ${esc(nextSync())}<br>Sicherung: ${cfg.sicherungAktiv ? `täglich ${esc(cfg.sicherungZeit)} Uhr` : 'aus'}${st.backupLast ? ` · zuletzt ${esc(new Date(st.backupLast.at).toLocaleString('de-CH'))} ${st.backupLast.ok ? '<span class="ok">ok</span>' : '<span class="no">Fehler</span>'}` : ''}</div></div>
${st.jdStruktur ? `<p><small>MyJohnDeere: ${st.jdStruktur.mandanten} Mandanten (${st.jdStruktur.mandantenMitFeldern} mit Feldern) · ${st.jdStruktur.betriebe} Betriebe (${st.jdStruktur.betriebeMitFeldern} mit Feldern) · ${st.jdStruktur.felder} Felder${st.jdStruktur.ohneZuordnung ? ` · <span class="no">${st.jdStruktur.ohneZuordnung} ohne Zuordnung</span>` : ''} · <a href="/diagnose.json">Diagnose herunterladen</a></small></p>` : ''}
<form method="post" action="/run"><button ${st.running ? 'disabled' : ''}>${st.running ? 'Abgleich läuft…' : 'Jetzt abgleichen'}</button></form></section>
<section><h2>Rhythmus Abgleich mit MyJohnDeere</h2><p><small>Wie oft Kunden, Felder und Arbeitsdaten aus MyJohnDeere geholt werden. «Jetzt abgleichen» im IM-Verwalter funktioniert immer zusätzlich.</small></p>
<form method="post" action="/rhythmus"><div class="row"><div><label>Abgleich</label><select name="syncMode">${[['zeiten', 'zu festen Uhrzeiten'], ['intervall', 'regelmässig alle … Stunden'], ['anfrage', 'nur auf Anfrage aus dem IM-Verwalter']].map(([v, t]) => `<option value="${v}" ${cfg.syncMode === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
<div><label>Uhrzeiten (bei «feste Uhrzeiten», mehrere mit Komma)</label><input name="syncZeiten" value="${esc(cfg.syncZeiten)}" placeholder="z.B. 05:00, 12:00, 18:00"></div></div>
<div class="row"><div><label>Alle … Stunden (bei «regelmässig»)</label><select name="syncIntervall">${[1, 2, 3, 4, 6, 8, 12].map(h => `<option ${+cfg.syncIntervall === h ? 'selected' : ''}>${h}</option>`).join('')}</select></div>
<div><label>Von – bis (bei «regelmässig»)</label><div class="row" style="gap:6px"><input name="syncVon" type="time" value="${esc(cfg.syncVon)}" style="min-width:0"><input name="syncBis" type="time" value="${esc(cfg.syncBis)}" style="min-width:0"></div></div></div>
<div class="row"><div><label>Anfragen aus dem IM-Verwalter prüfen alle … Minuten</label><select name="pollMinutes">${[1, 2, 5, 10, 15, 30].map(m => `<option ${+cfg.pollMinutes === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div><div><label>Aktuell</label><p style="margin:6px 0 0">${esc(rhythmText())} · nächster Abgleich ${esc(nextSync())}</p></div></div>
<button>Speichern</button></form></section>
<section><h2>Datensicherung</h2><p><small>Sichert die IM-Verwalter-Daten (<b>${esc(cfg.datenPfad)}</b>) täglich mit Datum. Behalten werden die letzten ${esc(cfg.behaltTage)} Tage und je eine pro Monat für ${esc(cfg.behaltMonate)} Monate. Zusätzlich einmal pro Woche eine Excel-Datei mit allen Daten. Zurückspielen im IM-Verwalter unter <i>Mehr › Sicherung einlesen</i>.</small></p>
${st.backupLast ? `<p>Letzte Sicherung: ${esc(new Date(st.backupLast.at).toLocaleString('de-CH'))} ${st.backupLast.ok ? `<span class="ok">ok</span> · ${esc(st.backupLast.name)} · ${esc(st.backupLast.kb)} KB · ${esc((st.backupLast.wo || []).join(' + '))} · ${esc(st.backupLast.counts || '')}` : `<span class="no">Fehler</span><br><small>${esc(st.backupLast.error)}</small>`}</p>` : '<p>Noch keine Sicherung.</p>'}
${st.excelLast ? `<p>Letzter Excel-Export: ${esc(new Date(st.excelLast.at).toLocaleString('de-CH'))} ${st.excelLast.ok ? `<span class="ok">ok</span> · ${esc(cfg.excelPfad)}/${esc(st.excelLast.name)}<br><small>${esc(st.excelLast.info)}</small>` : `<span class="no">Fehler</span><br><small>${esc(st.excelLast.error)}</small>`}</p>` : ''}
<form method="post" action="/sicherung"><div class="row"><div><label>Tägliche Sicherung</label><select name="sicherungAktiv"><option value="1" ${cfg.sicherungAktiv ? 'selected' : ''}>Ein</option><option value="0" ${cfg.sicherungAktiv ? '' : 'selected'}>Aus</option></select></div>
<div><label>Uhrzeit (00:00 = um Mitternacht)</label><input name="sicherungZeit" type="time" value="${esc(cfg.sicherungZeit)}"></div></div>
<div class="row"><div><label>Ablage auf dem NAS</label><select name="sicherungNas"><option value="1" ${cfg.sicherungNas ? 'selected' : ''}>Ja – ${esc(BACKUP_DIR === '/backup' ? 'Ordner docker/jd-sync/sicherungen' : BACKUP_DIR.startsWith(DATA) ? 'Ordner data/sicherungen' : BACKUP_DIR)}</option><option value="0" ${cfg.sicherungNas ? '' : 'selected'}>Nein</option></select></div>
<div><label>Ablage in der Dropbox</label><select name="sicherungDbx"><option value="1" ${cfg.sicherungDbx ? 'selected' : ''}>Ja</option><option value="0" ${cfg.sicherungDbx ? '' : 'selected'}>Nein</option></select></div></div>
<div class="row"><div><label>Dropbox-Ordner der Sicherungen (im App-Ordner)</label><input name="sicherungDbxPfad" value="${esc(cfg.sicherungDbxPfad)}"></div><div><label>Datendatei des IM-Verwalters (wie dataPath in config.js)</label><input name="datenPfad" value="${esc(cfg.datenPfad)}"></div></div>
<div class="row"><div><label>Tägliche Sicherungen behalten (Tage)</label><input name="behaltTage" type="number" min="1" max="365" value="${esc(cfg.behaltTage)}"></div><div><label>Monatliche Sicherungen behalten (Monate)</label><input name="behaltMonate" type="number" min="0" max="120" value="${esc(cfg.behaltMonate)}"></div></div>
<div class="row"><div><label>Wöchentlicher Excel-Export</label><select name="excelAktiv"><option value="1" ${cfg.excelAktiv ? 'selected' : ''}>Ein</option><option value="0" ${cfg.excelAktiv ? '' : 'selected'}>Aus</option></select></div>
<div><label>Excel bei der Sicherung am (Montag 00:00 = Ende der Woche)</label><select name="excelTag">${WOCHENTAGE.map((t, i) => `<option value="${i}" ${+cfg.excelTag === i ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
<div class="row"><div><label>Dropbox-Ordner für Excel</label><input name="excelPfad" value="${esc(cfg.excelPfad)}"></div><div><label>Excel-Dateien behalten (Wochen)</label><input name="excelBehalt" type="number" min="1" max="520" value="${esc(cfg.excelBehalt)}"></div></div>
<button>Speichern</button></form>
<div class="row" style="flex:0"><form method="post" action="/sicherung/jetzt"><button class="sec" ${st.dbx ? '' : 'disabled'}>Jetzt sichern</button></form><form method="post" action="/excel/jetzt"><button class="sec" ${st.dbx ? '' : 'disabled'}>Excel jetzt erstellen</button></form></div></section>
<section><h2>Arbeitsdaten (Vorrat)</h2><p><small>Arbeitsgänge aus MyJohnDeere (Säen, Spritzen, Ernten, Bodenbearbeitung …) mit Messwerten werden als <b>${esc(cfg.arbeitenPath)}</b> abgelegt (IM-Verwalter › Verwaltung › Bericht und Abrechnung). Aus jeder Bedeckungskarte wird die Fläche <b>ohne Überlappungen</b> («ha bedeckt») berechnet und eine <b>virtuelle Feldgrenze</b> erstellt (<b>${esc(cfg.grenzenPath || '/jd-grenzen.json')}</b>). Bedeckungskarten kommen über die neue <b>Operations Data Export</b>-Schnittstelle von John Deere (<code>/isg/operations/…/operationsExportRequests</code>); wo sie nicht klappt, über die alte (<code>/fieldOps</code>, läuft laut John Deere bis November 2027)${st.covInfo && st.covInfo.neueApi ? ` · letzter Lauf neue API: ${esc(Object.entries(st.covInfo.neueApi.antworten || {}).map(([k, v]) => k + '×' + v).join(', ') || '–')}${st.covInfo.neueApi.gestoppt ? ' <span class="no">kein Zugriff – Freischaltung prüfen</span>' : ''}` : ''}.</small></p>
${!cfg.arbeitenAktiv ? '<p class="no">Ausgeschaltet</p>' : st.arbLast ? `Letzter Lauf: ${esc(new Date(st.arbLast.at).toLocaleString('de-CH'))} ${st.arbLast.ok ? '<span class="ok">ok</span>' : `<span class="no">Fehler</span><br><small>${esc(st.arbLast.error)}</small>`}<br>` : 'Noch nicht gelaufen – startet mit dem nächsten Abgleich.<br>'}
${st.arbOk ? `${st.arbOk.ops} Arbeitsgänge seit ${esc(st.arbOk.seit)} · ${Object.entries(st.arbOk.types || {}).map(([k, v]) => esc(k) + ' ' + v).join(' · ')}<br>` : ''}${st.arbProgress ? `<b>Läuft gerade: ${esc(st.arbProgress.phase)} – ${st.arbProgress.done} von ${st.arbProgress.total} (seit ${esc(new Date(st.arbProgress.at).toLocaleTimeString('de-CH'))})</b><br>` : ''}${st.flaechen ? `Flächen: ${st.flaechen.maschine} aus Maschine, ${st.flaechen.bedeckung} aus Bedeckungskarte (Ersatz), ${Object.values(arbCache() || {}).filter(o => o.cov && o.cov.ha && o.cov.mod === o.modified).length} mit «ha bedeckt», ${Object.keys(grenzen).length} virtuelle Feldgrenzen, ${st.flaechen.ohne} ohne Fläche<br>` : ''}${st.covInfo && st.covInfo.gefragt ? `<small>Bedeckungskarte zuletzt ${esc(new Date(st.covInfo.at).toLocaleString('de-CH'))}: ${st.covInfo.gefragt} abgefragt, ${st.covInfo.mitFlaeche} berechnet, ${st.covInfo.ohneKarte} ohne Karte, ${st.covInfo.offen} noch in Arbeit${st.covInfo.gestoppt ? ' · <span class="no">abgebrochen</span>' : ''} · Antworten ${esc(Object.entries(st.covInfo.status || {}).map(([k, v]) => k + '×' + v).join(', '))}${Object.entries(st.covInfo.meldungen || {}).map(([k, v]) => `<br>${esc(k)}: ${esc(v)}`).join('')}</small><br>` : ''}
${st.jd && !hasAg2() ? '<p class="no">Die bestehende John-Deere-Anmeldung enthält die Berechtigung für Arbeitsdaten noch nicht – bitte unten in Schritt 2 neu anmelden. Mandanten und Felder laufen bis dahin normal weiter.</p>' : ''}
<form method="post" action="/arbeiten"><div class="row"><div><label>Arbeitsdaten abholen</label><select name="arbeitenAktiv"><option value="1" ${cfg.arbeitenAktiv ? 'selected' : ''}>Ja</option><option value="0" ${cfg.arbeitenAktiv ? '' : 'selected'}>Nein</option></select></div>
<div><label>Ab Datum (früher = längere Historie, erster Lauf dauert länger)</label><input name="arbeitenSeit" type="date" value="${esc(cfg.arbeitenSeit)}"></div></div>
<button>Speichern</button> <button class="sec" name="neu" value="1">Speichern und komplett neu laden</button></form></section>
<section><h2>1 · John-Deere-App (developer.deere.com)</h2><form method="post" action="/config">
<div class="row"><div><label>Application ID (Client-ID)</label><input name="clientId" value="${esc(cfg.clientId)}"></div><div><label>Secret ${cfg.clientSecret ? '<small>(gespeichert – leer lassen = unverändert)</small>' : ''}</label><input name="clientSecret" type="password" autocomplete="off"></div></div>
<div class="row"><div><label>Redirect URI (genau so in der John-Deere-App eintragen)</label><input name="redirectUri" value="${esc(cfg.redirectUri)}"></div><div><label>Schnittstelle</label><select name="apiBase">${['https://partnerapi.deere.com/platform', 'https://sandboxapi.deere.com/platform'].map(u => `<option ${u === cfg.apiBase ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
<div class="row"><div><label>Dropbox App key (derselbe wie im IM-Verwalter, config.js)</label><input name="dbxAppKey" value="${esc(cfg.dbxAppKey)}"></div><div></div></div>
<div class="row"><div><label>Kunden im IM-Verwalter entsprechen in MyJohnDeere den …</label><select name="kundenEbene">${[['auto', 'automatisch erkennen'], ['clients', 'Mandanten (Clients)'], ['farms', 'Betrieben (Farms)']].map(([v, t]) => `<option value="${v}" ${cfg.kundenEbene === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div></div></div>
<button>Speichern</button></form></section>
<section><h2>2 · Bei John Deere anmelden</h2><p>Öffnet die Anmeldung von John Deere. Danach landet der Browser auf <b>${esc(cfg.redirectUri)}</b> – die Seite lädt evtl. nicht, das ist in Ordnung. <b>Kopiere die ganze Adresse aus der Browserzeile</b> und füge sie hier ein.</p>
<a class="btn sec" href="/jd/login" target="_blank" rel="noopener">Bei John Deere anmelden ↗</a>
<form method="post" action="/jd/code"><label>Adresse aus der Browserzeile (enthält «code=»)</label><input name="url" placeholder="http://localhost:9090/callback?code=…&state=…"><button>Übernehmen</button></form></section>
<section><h2>3 · Organisation</h2>${orgs.length ? `<form method="post" action="/org"><select name="orgId">${orgs.map(o => `<option value="${esc(o.id)}" ${o.id === cfg.orgId ? 'selected' : ''}>${esc(o.name)}${o.connect ? ' – Zugriff noch nicht freigegeben' : ''}</option>`).join('')}</select><button>Wählen</button></form>
${orgs.filter(o => o.connect).map(o => `<p class="no">«${esc(o.name)}» ist noch nicht freigegeben: <a href="${esc(o.connect)}" target="_blank" rel="noopener">Zugriff freigeben ↗</a>, danach <a href="/orgs">neu laden</a>.</p>`).join('')}` : '<p>Nach der Anmeldung erscheinen hier deine Organisationen. <a href="/orgs">Neu laden</a></p>'}</section>
<section><h2>4 · Mit Dropbox verbinden</h2><p>Öffnet Dropbox. Nach «Zulassen» zeigt Dropbox einen Code – diesen hier einfügen.</p>
<a class="btn sec" href="/dbx/login" target="_blank" rel="noopener">Bei Dropbox anmelden ↗</a>
<form method="post" action="/dbx/code"><label>Code von Dropbox</label><input name="code"><button>Übernehmen</button></form></section>
<section><h2>Protokoll</h2><pre>${esc((st.log || []).slice(0, 80).join('\n'))}</pre></section>
</main></body></html>`;
}
function authOk(req) {
  if (!UI_PASSWORD) return true;
  const h = req.headers.authorization || ''; if (!h.startsWith('Basic ')) return false;
  const [, pw] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  const a = Buffer.from(pw || ''), b = Buffer.from(UI_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const body = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); }); req.on('end', () => r(new URLSearchParams(s))); });
const send = (res, code, html, headers = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(html); };
http.createServer(async (req, res) => {
  if (!authOk(req)) return send(res, 401, 'Anmeldung erforderlich', { 'WWW-Authenticate': 'Basic realm="jd-sync"' });
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && u.pathname === '/') return send(res, 200, page());
    if (req.method === 'GET' && u.pathname === '/diagnose.json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="jd-sync-diagnose.json"' }); const arb = load('arbeiten.json', { ops: {} }), ohne = Object.values(arb.ops || {}).filter(o => o.flaeche == null).sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')));
      const bsp = ohne.slice(0, 15).map(o => ({ id: o.id, feld: o.fieldName, art: o.type, start: o.start, maschinenTyp: o.machineType, links: o.rels, bedeckungLink: o.lk?.shapeFileAsync || null, bedeckung: o.cov || null, messungen: (o.measurements || []).map(m => ({ name: m.measurementName, felder: Object.keys(m).filter(k => k !== 'measurementName').slice(0, 20) })) }));
      return res.end(JSON.stringify({ version: VERSION, ...load('diagnose.json', { hinweis: 'Noch kein Abgleich gelaufen' }), arbeitsdaten: { letzter: st.arbLast || null, ok: st.arbOk || null, laeuft: st.arbProgress || null }, flaechen: st.flaechen || null, bedeckungskarte: st.covInfo || null, ohneFlaeche: { anzahl: ohne.length, beispiele: bsp } }, null, 1)); }
    if (req.method === 'GET' && u.pathname === '/status.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ version: VERSION, last: st.last, lastOk: st.lastOk, arbLast: st.arbLast, arbOk: st.arbOk, arbProgress: st.arbProgress || null, flaechen: st.flaechen, covInfo: st.covInfo, backupLast: st.backupLast, excelLast: st.excelLast, rhythmus: rhythmText(), running: st.running })); }
    if (req.method === 'POST' && u.pathname === '/config') {
      const f = await body(req);
      ['clientId', 'redirectUri', 'apiBase', 'dbxAppKey', 'kundenEbene'].forEach(k => { if (f.has(k)) cfg[k] = f.get(k).trim(); });
      if (f.get('clientSecret')) cfg.clientSecret = f.get('clientSecret').trim();
      saveCfg(); return send(res, 200, page('Gespeichert.'));
    }
    if (u.pathname === '/jd/login') { if (!cfg.clientId || !cfg.clientSecret) return send(res, 200, page('Zuerst Client-ID und Secret eintragen.', true)); res.writeHead(302, { Location: await jdAuthUrl() }); return res.end(); }
    if (req.method === 'POST' && u.pathname === '/jd/code') { const f = await body(req); await jdCodeFromUrl(f.get('url') || ''); return send(res, 200, page('Bei John Deere angemeldet.')); }
    let cbPath = ''; try { cbPath = new URL(cfg.redirectUri).pathname; } catch { }
    if (req.method === 'GET' && cbPath && u.pathname === cbPath && u.searchParams.get('code')) { await jdCodeFromUrl(u.href); return send(res, 200, page('Bei John Deere angemeldet.')); }
    if (u.pathname === '/orgs') { await loadOrgs(); return send(res, 200, page('Organisationen neu geladen.')); }
    if (req.method === 'POST' && u.pathname === '/org') { const f = await body(req); const o = (st.orgs || []).find(x => x.id === f.get('orgId')); if (o) { cfg.orgId = o.id; cfg.orgName = o.name; saveCfg(); } return send(res, 200, page(o ? `Organisation «${o.name}» gewählt.` : 'Unbekannte Organisation', !o)); }
    if (u.pathname === '/dbx/login') { if (!cfg.dbxAppKey) return send(res, 200, page('Zuerst den Dropbox App key eintragen.', true)); res.writeHead(302, { Location: dbxAuthUrl() }); return res.end(); }
    if (req.method === 'POST' && u.pathname === '/dbx/code') { const f = await body(req); await dbxCode(f.get('code') || ''); return send(res, 200, page('Mit Dropbox verbunden.')); }
    if (req.method === 'POST' && u.pathname === '/arbeiten') {
      const f = await body(req);
      cfg.arbeitenAktiv = f.get('arbeitenAktiv') !== '0';
      if (/^\d{4}-\d{2}-\d{2}$/.test(f.get('arbeitenSeit') || '')) cfg.arbeitenSeit = f.get('arbeitenSeit');
      saveCfg();
      if (f.get('neu')) { try { fs.unlinkSync(file('arbeiten.json')); } catch { } delete st.arbDateParams; saveSt(); log('Arbeitsdaten: Vorrat gelöscht, wird beim nächsten Abgleich neu geladen'); }
      return send(res, 200, page(f.get('neu') ? 'Gespeichert – Arbeitsdaten werden beim nächsten Abgleich komplett neu geladen («Jetzt abgleichen»).' : 'Gespeichert.'));
    }
    if (req.method === 'POST' && u.pathname === '/rhythmus') {
      const f = await body(req);
      if (['zeiten', 'intervall', 'anfrage'].includes(f.get('syncMode'))) cfg.syncMode = f.get('syncMode');
      const zeiten = String(f.get('syncZeiten') || '').split(/[,;\s]+/).map(toMinutes).filter(m => m != null);
      if (cfg.syncMode === 'zeiten' && !zeiten.length) return send(res, 200, page('Bitte mindestens eine Uhrzeit eintragen, z.B. 05:00', true));
      if (zeiten.length) cfg.syncZeiten = [...new Set(zeiten)].sort((a, b) => a - b).map(hmOf).join(', ');
      cfg.syncIntervall = Math.max(1, Math.min(24, +f.get('syncIntervall') || 3));
      if (toMinutes(f.get('syncVon')) != null) cfg.syncVon = hmOf(toMinutes(f.get('syncVon')));
      if (toMinutes(f.get('syncBis')) != null) cfg.syncBis = hmOf(toMinutes(f.get('syncBis')));
      cfg.pollMinutes = Math.max(1, Math.min(60, +f.get('pollMinutes') || 5));
      // bereits verstrichene Zeitpunkte von heute nicht nachholen
      { const { day, min } = tzNow(); const s = syncSlots().filter(x => x <= min).pop(); st.lastSyncSlot = s != null ? `${day}@${s}` : st.lastSyncSlot; saveSt(); }
      saveCfg(); log(`Rhythmus: ${rhythmText()}`); return send(res, 200, page(`Gespeichert – Abgleich ${rhythmText()}.`));
    }
    if (req.method === 'POST' && u.pathname === '/sicherung') {
      const f = await body(req), yes = k => f.get(k) === '1', clamp = (v, a, b, d) => Math.max(a, Math.min(b, Number.isFinite(+v) && v !== '' ? +v : d));
      Object.assign(cfg, { sicherungAktiv: yes('sicherungAktiv'), sicherungNas: yes('sicherungNas'), sicherungDbx: yes('sicherungDbx'), excelAktiv: yes('excelAktiv'),
        excelTag: clamp(f.get('excelTag'), 0, 6, 1), behaltTage: clamp(f.get('behaltTage'), 1, 365, 30), behaltMonate: clamp(f.get('behaltMonate'), 0, 120, 24), excelBehalt: clamp(f.get('excelBehalt'), 1, 520, 26) });
      if (toMinutes(f.get('sicherungZeit')) != null) { const nz = hmOf(toMinutes(f.get('sicherungZeit'))); if (nz !== cfg.sicherungZeit) { cfg.sicherungZeit = nz; const { day, min } = tzNow(); if (min >= toMinutes(nz) && st.lastBackupDay !== day) { st.lastBackupDay = day; saveSt(); } } }
      const pth = k => { const v = String(f.get(k) || '').trim(); return v ? '/' + v.replace(/^\/+/, '').replace(/\/+$/, '') : null; };
      cfg.sicherungDbxPfad = pth('sicherungDbxPfad') || cfg.sicherungDbxPfad; cfg.excelPfad = pth('excelPfad') || cfg.excelPfad; cfg.datenPfad = pth('datenPfad') || cfg.datenPfad;
      if (!cfg.sicherungNas && !cfg.sicherungDbx) return send(res, 200, page('Bitte mindestens eine Ablage (NAS oder Dropbox) wählen.', true));
      saveCfg(); return send(res, 200, page('Datensicherung gespeichert.'));
    }
    if (req.method === 'POST' && u.pathname === '/sicherung/jetzt') { runBackup('manuell'); await sleep(1500); return send(res, 200, page('Sicherung gestartet – Ergebnis siehe Datensicherung bzw. Protokoll.')); }
    if (req.method === 'POST' && u.pathname === '/excel/jetzt') { runExcel(null, 'manuell'); await sleep(2000); return send(res, 200, page('Excel-Export gestartet – Ergebnis siehe Datensicherung bzw. Protokoll.')); }
    if (req.method === 'POST' && u.pathname === '/run') { runSync('manuell'); await sleep(300); return send(res, 200, page('Abgleich gestartet – Seite in ein paar Sekunden neu laden.')); }
    return send(res, 404, 'Nicht gefunden');
  } catch (e) { log('Fehler: ' + e.message); return send(res, 200, page(e.message, true)); }
}).listen(PORT, () => log(`jd-sync Version ${VERSION} (${STAND}) läuft auf Port ${PORT}`));
