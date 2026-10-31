/* IM-Verwalter – Modul «Eigener Betrieb» (ein-/ausschaltbar)
   Ersetzt die Excel-Mappe «Düngungs- und Anbauplanung»: Parzellen, Fruchtfolge, Düngungsplanung,
   Zwischenfrüchte (Saatgutbestellung) und Bodenproben – alles über die Parzelle verknüpft.

   Daten in «einstellungen» (werden wie alle Daten über Dropbox abgeglichen):
   eb-stamm  { kunde, parz:[{id,name,teil,feld,ha,gruppe,aktiv,notiz}], kulturen:[{id,name,n,pause}],
               programme:[Text], richt:{key:{min,opt,max,ziel}}, boden:[{id,parz,name,jahr,labor,oeln,w:{key:Wert},notiz}] }
   eb-<jahr> { jahr, schlaege:[{id,parz,name,art:'haupt'|'zwischen',kultur,mix,ha,sorte,prog:[],bem,nBed,korr,vk,
                                gaben:[{id,d,datum,menge}]}],
               duenger:[{id,name,einheit,n,zufuhr,vorrat}], maxN, abzug,
               zf:{ arten:[{id,name,preis,rein,rest,best}], mix:[{id,name,use,ha,anteile:{artId:Anteil}}], notiz } }
   Ein «Schlag» ist eine Kultur auf einer Parzelle in einem Jahr (Haupt- oder Zwischenfrucht). Die Vorkultur ergibt sich
   aus dem Vorjahr derselben Parzelle, die Fläche einer Zwischenfrucht-Mischung aus den Schlägen, die sie verwenden. */
'use strict';

const EB_SUBS = [['fruchtfolge', 'Fruchtfolge'], ['zf', 'Zwischenfrüchte'], ['duengung', 'Düngung'], ['boden', 'Bodenproben'], ['stamm', 'Stammdaten']];
// Werte aus dem Blatt «Kulturen» der bisherigen Excel-Mappe (N-Bedarf gemäss GRUDAF)
const EB_KULTUREN = [['Zuckerrüben', 100], ['Winterweizen', 140], ['Raps', 150], ['Silomais', 110], ['Hafer', 90], ['Soja', 0], ['Eiweisserbsen', 0],
  ['Triticale', 110], ['Gerste', 110], ['Kunstwiese', 150], ['Naturwiese', 60], ['Weide', 60], ['Gründüngung', 30]];
const EB_PROG = ['IP-Suisse', 'Extenso', 'Weite Reihe', 'Intensiv', 'PS BE', 'Direktsaat', 'Mulchsaat', 'Verzicht Totalherbizid', 'REB M1'];
// Bodenanalyse (Kinsey): Schlüssel, Bezeichnung, Einheit
const EB_BODEN = [['humus', 'Humus', '%'], ['ph', 'pH', ''], ['kak', 'KAK', ''], ['ca', 'Calcium', '%'], ['mg', 'Magnesium', '%'], ['k', 'Kali', '%'], ['na', 'Natrium', '%'],
  ['basen', 'Andere Basen', '%'], ['h', 'H+', '%'], ['n', 'Stickstoff', ''], ['s', 'Schwefel', 'ppm'], ['p', 'Phosphor', ''], ['b', 'Bor', 'ppm'], ['fe', 'Eisen', 'ppm'],
  ['mn', 'Mangan', 'ppm'], ['cu', 'Kupfer', 'ppm'], ['zn', 'Zink', 'ppm'], ['mo', 'Molybdän', 'ppm'], ['co', 'Kobalt', 'ppm']];
const EB_BODEN_EMPF = [['eZn', 'Zinksulfat'], ['eB', 'Borsäure'], ['eMo', 'Molybdän'], ['eSalz', 'Salz']]; // Empfehlungen (ohne Richtwerte)
// Richtwerte aus der bisherigen Excel-Mappe (Zeilen G. min / G. opti / G. max / Zielwert)
const EB_RICHT = {
  humus: [1, 4, null, '5 %'], ph: [6, 6.8, 7.6, '6.8'], kak: [5, 14, null, '15'], ca: [56, 68, 80, '68 %'], mg: [9, 10.5, 16, '12 %'], k: [1.5, 6, 10, '5 - 6 %'], na: [0.25, 0.6, 10, '0.5 - 2 %'],
  s: [2, 40, 250, '50 ppm'], p: [30, 600, 1200, '500 - 750'], b: [0.4, 1, 3, '1.5 - 2 ppm'], fe: [50, 200, null, '200+ ppm'], mn: [25, 125, 250, '125 - 250 ppm'],
  cu: [0.4, 6, 21, '5 - 10 ppm'], zn: [2.5, 10, 100, '10 - 20 ppm'], mo: [0.2, 1.1, 4, '1 - 2 ppm'], co: [0.2, 1.1, 4, '1 - 2 ppm']
};

/* ================= Daten ================= */
const ebOn = () => !!Store.cfg().ebOn;
const ebId = y => 'eb-' + y;
const ebYears = () => Store.all('einstellungen').filter(r => /^eb-\d{4}$/.test(r.id)).map(r => r.jahr).sort((a, b) => b - a);
const ebGet = y => Store.get('einstellungen', ebId(y));
const ebBlank = y => ({ id: ebId(y), jahr: y, schlaege: [], duenger: [], maxN: null, abzug: null, zf: { arten: [], mix: [], notiz: '' } });
const ebRecY = y => { const r = ebGet(y); if (!r) return ebBlank(y); r.schlaege = r.schlaege || []; r.duenger = r.duenger || []; r.zf = Object.assign({ arten: [], mix: [], notiz: '' }, r.zf || {}); return r; };
const ebCurYear = () => new Date().getFullYear();
// Dauerkulturen (laufen jedes Jahr weiter, bis sie umgebrochen werden) – Vorgabe, in den Stammdaten änderbar
const EB_DAUER = ['Naturwiese', 'Weide'];
function ebStammBlank() {
  return { id: 'eb-stamm', kunde: '', parz: [], kulturen: EB_KULTUREN.map(([name, n]) => ({ id: 'k-' + ebSlug(name), name, n, pause: null, dauer: EB_DAUER.includes(name) })), programme: EB_PROG.slice(),
    richt: Object.fromEntries(Object.entries(EB_RICHT).map(([k, [min, opt, max, ziel]]) => [k, { min, opt, max, ziel }])), boden: [], zfListe: [] };
}
function ebStamm() {
  const s = Store.get('einstellungen', 'eb-stamm'); if (!s) return ebStammBlank();
  ['parz', 'kulturen', 'programme', 'boden', 'zfListe'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; }); if (!s.richt) s.richt = {};
  return s;
}

/* ---------- Dauerkulturen weiterführen, Zwischenfrüchte ihrer Hauptkultur zuordnen ----------
   Läuft vor dem Anzeigen. Eine Dauerkultur (Stammdaten) wird ins nächste Jahr übernommen (auto, ↻), solange dort keine
   andere Hauptkultur steht und sie nicht als «endet» markiert ist. Nicht mehr begründete, unveränderte Übernahmen
   verschwinden wieder. Zwischenfrüchte ohne Angabe (ältere Daten) werden der Hauptkultur derselben Parzelle zugeordnet. */
let _ebSyncV = -1;
function ebSync() {
  if (_ebSyncV === Store.v || !ebOn()) return; const ys = ebYears().sort((a, b) => a - b); if (!ys.length) { _ebSyncV = Store.v; return; }
  const ch = new Map(), get = y => ch.get(y) || (ebGet(y) ? structuredClone(ebRecY(y)) : null), put = r => ch.set(r.jahr, r);
  const link = r => { let mod = false; r.schlaege.forEach(z => { if (z.art !== 'zwischen' || z.nach !== undefined) return; const H = r.schlaege.filter(h => h.art !== 'zwischen' && z.parz && h.parz === z.parz);
    const h = H.find(x => z.ha != null && x.ha != null && Math.abs(x.ha - z.ha) < 0.001) || H[0]; z.nach = h ? h.id : '';
    if (h && z.ha == null && h.ha != null) z.ha = ebParzHa(ebParz(z.parz)); // bisherige Fläche (Parzelle) beibehalten
    if (h && z.ha != null && h.ha != null && Math.abs(h.ha - z.ha) < 0.001) z.ha = null; mod = true; }); return mod; };
  // einmalig: Flächen ohne Parzelle entfernen (frühere Sammelzeilen «Weitere Flächen»)
  const st0 = ebStamm();
  if (!st0.ohneFreiV1 && Store.get('einstellungen', 'eb-stamm')) {
    ys.forEach(y => { const r = get(y); if (r && r.schlaege.some(x => !x.parz)) { r.schlaege = r.schlaege.filter(x => x.parz); put(r); } });
    const s2 = structuredClone(st0); s2.ohneFreiV1 = true; Store.put('einstellungen', s2, { silent: true });
  }
  const r0 = get(ys[0]); if (r0 && link(r0)) put(r0);
  for (let y = ys[0] + 1; y <= Math.max(ys[ys.length - 1], ebCurYear() + 1); y++) {
    const prev = get(y - 1); let cur = get(y), mod = false; if (!prev && !cur) continue;
    const D = prev ? prev.schlaege.filter(x => x.parz && x.art !== 'zwischen' && !x.ende && ebIsDauer(x.kultur)) : [];
    if (cur) { const n = cur.schlaege.length;
      cur.schlaege = cur.schlaege.filter(s => !(s.auto && !(s.gaben || []).length && !D.some(x => x.parz === s.parz && ebSameKultur(x.kultur, s.kultur))));
      if (cur.schlaege.length !== n) mod = true; }
    D.forEach(x => { if (cur && cur.schlaege.some(h => h.parz === x.parz && h.art !== 'zwischen')) return; if (!cur) cur = ebBlank(y);
      cur.schlaege.push({ id: `dk-${x.parz}-${y}`, parz: x.parz, name: '', art: 'haupt', kultur: x.kultur, mix: '', ha: x.ha ?? null, sorte: x.sorte || '', prog: (x.prog || []).slice(), bem: '', nBed: x.nBed ?? null, korr: null, vk: '', gaben: [], auto: true }); mod = true; });
    if (cur && link(cur)) mod = true;
    if (mod) put(cur);
  }
  ch.forEach(r => Store.put('einstellungen', structuredClone(r), { silent: true }));
  _ebSyncV = Store.v;
}
// Hauptkultur auf einer Parzelle gelöscht: eine Dauerkultur aus dem Vorjahr gilt als umgebrochen (sonst käme sie zurück)
function ebDauerEnde(y, parz) {
  const prev = ebGet(y - 1); if (!prev || !parz) return;
  const p = structuredClone(ebRecY(y - 1)); let mod = false;
  p.schlaege.forEach(x => { if (x.parz === parz && x.art !== 'zwischen' && !x.ende && ebIsDauer(x.kultur)) { x.ende = true; mod = true; } });
  if (mod) Store.put('einstellungen', p, { silent: true });
}
function ebState() {
  if (!App.eb) App.eb = { sub: ls('lp_ebSub') || 'fruchtfolge', y: null, ffEnd: null, bAll: false, ffSum: false, showOff: ls('lp_ebShowOff') === '1', stSub: ls('lp_ebStSub') || 'parzellen', dSub: ls('lp_ebDSub') || 'plan' };
  if (App.eb.sub === 'parzellen') { App.eb.sub = 'stamm'; App.eb.stSub = 'parzellen'; } // Parzellen liegen neu unter Stammdaten
  if (!App.eb.y) App.eb.y = ebCurYear();
  if (!App.eb.ffEnd) App.eb.ffEnd = Math.max(ebCurYear() + 1, ...ebYears().filter(y => y <= ebCurYear() + 3));
  return App.eb;
}
// Speichern: Kopie in «einstellungen», danach neu zeichnen (Fokus und Bildlauf bleiben erhalten)
function ebSaveY(rec, render = true) { Store.put('einstellungen', structuredClone(rec), { silent: true }); if (render) ebRender(); }
function ebSaveS(st, render = true) { Store.put('einstellungen', structuredClone(st), { silent: true }); if (render) ebRender(); }
function ebRender() {
  setTimeout(() => {
    const a = document.activeElement, key = a && a.dataset ? a.dataset.ebk : null, sx = window.scrollX, sy = window.scrollY;
    const sc = $$('.ebscroll').map(w => [w.scrollLeft, w.scrollTop]);
    App.render();
    window.scrollTo(sx, sy);
    $$('.ebscroll').forEach((w, i) => { if (sc[i]) { w.scrollLeft = sc[i][0]; w.scrollTop = sc[i][1]; } });
    if (key) { const el = $(`[data-ebk="${key}"]`); if (el) { el.focus(); try { el.select(); } catch { } } }
  }, 0);
}

/* ---------- Hilfen ---------- */
const ebNum = v => { const n = num(v); return n == null || !isFinite(n) ? null : n; };
const ebSlug = s => norm(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid();
const ebKey = s => norm(s).replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/[^a-z0-9]/g, '');
const ebLev = (a, b) => { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };
// Ähnlichkeit zweier Parzellennamen: 0 = gleich, kleiner = ähnlicher, null = verschieden
function ebNameDist(a, b) {
  const x = ebKey(a), y = ebKey(b); if (!x || !y) return null; if (x === y) return 0;
  const xl = x.replace(/\d+$/, ''), yl = y.replace(/\d+$/, '');
  if (x.startsWith(y) || y.startsWith(x)) return 1 + Math.abs(x.length - y.length) / 10;
  const d = ebLev(x, y); if (d <= Math.max(1, Math.floor(Math.min(x.length, y.length) * 0.25))) return d + 0.5;
  if (xl && xl === yl) return 1.5;
  return null;
}
const ebFmt = v => v == null || v === '' ? '' : fmtNum(r2(v));
const ebDash = v => v == null || v === '' ? '<span class="nr">–</span>' : fmtNum(r2(v));
const ebDatum = s => !s ? '' : /^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtDate(s, { day: '2-digit', month: '2-digit', year: '2-digit' }) : String(s);
// Farbe pro Kultur: in den Stammdaten gewählt, sonst aus dem Namen abgeleitet (gleich auf allen Geräten)
function ebAutoColor(k) {
  const key = ebKultKey(k); if (!key) return '#646a65';
  let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360;
  // HSL(h, 55 %, 42 %) → #rrggbb (für das Farbfeld)
  const s = 0.55, l = 0.42, a = s * Math.min(l, 1 - l), f = n => { const kk = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function ebColor(k) {
  const ku = k ? ebKultur(k) : null;
  return ku && ku.farbe ? ku.farbe : ebAutoColor(ku ? ku.name : k);
}

/* ---------- Kulturen ---------- */
// «Winterweizen» und «Weizen» gelten als gleiche Kultur; «Sommerhafer» gehört zu «Hafer»
const ebKultKey = k => ebKey(k).replace(/^(winter|sommer|fruh|spat)/, '');
function ebKultur(name) {
  const K = ebStamm().kulturen, k = ebKey(name); if (!k) return null;
  return K.find(x => ebKey(x.name) === k) || K.find(x => ebKultKey(x.name) === ebKultKey(name)) ||
    K.filter(x => ebKey(x.name).length > 3 && (k.includes(ebKey(x.name)) || ebKey(x.name).includes(k))).sort((a, b) => b.name.length - a.name.length)[0] || null;
}
const ebSameKultur = (a, b) => !!a && !!b && (ebKultKey(a) === ebKultKey(b) || (ebKultur(a) && ebKultur(a) === ebKultur(b)));
// N-Bedarf eines Schlags: eigener Wert, sonst Kultur, Zwischenfrüchte ohne passende Kultur wie «Gründüngung»
function ebNBedarf(s) {
  if (s.nBed != null) return s.nBed;
  if (s.art === 'zwischen' && !(s.gaben || []).length) return null; // ungedüngte Zwischenfrucht: kein offener Bedarf
  const k = ebKultur(s.kultur) || (s.art === 'zwischen' ? ebKultur('Gründüngung') : null);
  return k && k.n != null ? k.n : null;
}

/* ---------- Parzellen ---------- */
const ebParz = id => id ? ebStamm().parz.find(p => p.id === id) : null;
const ebParzLabel = p => p ? `${p.name}${p.teil ? ' ' + p.teil : ''}` : '';
const ebParzHa = p => p ? (p.ha != null ? p.ha : (feldById(p.feld) || {}).flaeche ?? null) : null;
// Reihenfolge: von Hand festgelegt (pos, Parzellen ▲▼), sonst Gruppe und Name
const ebParzSorted = (alle) => ebStamm().parz.filter(p => alle || p.aktiv !== false).slice().sort((a, b) => ((a.pos ?? 1e6) - (b.pos ?? 1e6)) || ((a.gruppe ?? 999) - (b.gruppe ?? 999)) || a.name.localeCompare(b.name, 'de') || String(a.teil || '').localeCompare(String(b.teil || ''), 'de'));
// Parzelle in der (sichtbaren) Liste um eine Stelle verschieben
function ebParzMove(id, d) {
  const st = ebStamm(), S = ebState(), L = ebParzSorted(true);
  L.forEach((p, i) => { st.parz.find(x => x.id === p.id).pos = i; });
  const V = L.filter(p => S.showOff || p.aktiv !== false), i = V.findIndex(p => p.id === id), j = i + d; if (i < 0 || j < 0 || j >= V.length) return;
  const a = st.parz.find(x => x.id === V[i].id), b = st.parz.find(x => x.id === V[j].id); [a.pos, b.pos] = [b.pos, a.pos];
  ebSaveS(st);
}
const ebSchlagName = s => s.parz ? ebParzLabel(ebParz(s.parz)) || s.name || '?' : (s.name || '–');
// alle Schläge aller Jahre nach id (für die Verknüpfung Zwischenfrucht → Hauptkultur)
let _ebIdxV = -1, _ebIdx = new Map();
function ebIdx() {
  if (_ebIdxV !== Store.v) { _ebIdx = new Map(); Store.all('einstellungen').forEach(r => { if (/^eb-\d{4}$/.test(r.id)) (r.schlaege || []).forEach(s => _ebIdx.set(s.id, s)); }); _ebIdxV = Store.v; }
  return _ebIdx;
}
// Fläche: eigene Angabe, sonst die der Hauptkultur (bei Zwischenfrüchten), sonst die der Parzelle
const ebSchlagHa = (s, d = 0) => { if (s.ha != null) return s.ha; const h = s.nach && d < 3 ? ebIdx().get(s.nach) : null; return h && h.id !== s.id ? ebSchlagHa(h, d + 1) : ebParzHa(ebParz(s.parz)); };
const ebIsDauer = name => { const k = ebKultur(name); return !!(k && k.dauer); };
// Eigener Betrieb in den Kunden (Felder aus MyJohnDeere)
function ebKunde() {
  const st = ebStamm(); if (st.kunde && Store.get('kunden', st.kunde)) return Store.get('kunden', st.kunde);
  const K = Store.all('kunden'); return K.find(k => /indermühle|indermuehle/i.test(k.name) && /andreas/i.test(k.name)) || null;
}
const ebFelder = () => { const k = ebKunde(); return k ? felderOf(k.id, true) : []; };
// Vorschläge Parzelle → Feld: zuerst gleiche Namen, dann die ähnlichsten (nur aktive Parzellen, jedes Feld höchstens einmal)
function ebFeldGuessAll(st = ebStamm()) {
  const used = new Set(st.parz.map(p => p.feld).filter(Boolean)), F = ebFelder().filter(f => f.aktiv !== false), out = {};
  const P = st.parz.filter(p => !p.feld && p.aktiv !== false);
  P.forEach(p => { const f = F.find(x => !used.has(x.id) && (ebKey(x.name) === ebKey(ebParzLabel(p)) || ebKey(x.name) === ebKey(p.name))); if (f) { out[p.id] = f; used.add(f.id); } });
  const C = [];
  P.filter(p => !out[p.id]).forEach(p => F.forEach(f => { if (used.has(f.id)) return; const d = Math.min(ebNameDist(f.name, ebParzLabel(p)) ?? 99, ebNameDist(f.name, p.name) ?? 99); if (d < 99) C.push([d, p, f]); }));
  C.sort((a, b) => a[0] - b[0]).forEach(([, p, f]) => { if (out[p.id] || used.has(f.id)) return; out[p.id] = f; used.add(f.id); });
  return out;
}
function ebFindParz(name, st = ebStamm()) {
  let best = null, bd = 99;
  st.parz.forEach(p => { const d = Math.min(ebNameDist(ebParzLabel(p), name) ?? 99, ebNameDist(p.name, name) ?? 99); if (d < bd) { bd = d; best = p; } });
  return best;
}

/* ---------- Jahr: Schläge, Vorkultur, Düngung ---------- */
const ebSchlaege = (y, parzId) => ebRecY(y).schlaege.filter(s => s.parz === parzId);
// Vorkultur: Hauptkultur(en) des Vorjahres auf derselben Parzelle; ohne Eintrag im Vorjahr die importierte Angabe
function ebVorkultur(rec, s) {
  if (s.parz) { const prev = ebGet(rec.jahr - 1); const L = prev ? prev.schlaege.filter(x => x.parz === s.parz && x.art !== 'zwischen' && x.kultur) : [];
    if (L.length) return [...new Set(L.map(x => x.kultur))].join(' / '); }
  return s.vk || '';
}
const ebDuenger = (rec, id) => rec.duenger.find(d => d.id === id);
const ebGabeN = (rec, g) => { const d = ebDuenger(rec, g.d); return d && g.menge != null && d.n != null ? r2(g.menge * d.n) : 0; };
function ebSchlagCalc(rec, s) {
  const bed = ebNBedarf(s), korr = s.korr || 0, geplant = r2((s.gaben || []).reduce((t, g) => t + ebGabeN(rec, g), 0));
  return { bed, korr, geplant, rest: bed != null ? r2(bed + korr - geplant) : null, ha: ebSchlagHa(s) };
}
// Lager pro Dünger: Bedarf = Σ Menge/ha × Fläche
function ebLager(rec) {
  return rec.duenger.map(d => {
    const bedarf = r2(rec.schlaege.reduce((t, s) => t + (s.gaben || []).filter(g => g.d === d.id).reduce((u, g) => u + (g.menge || 0) * (ebSchlagHa(s) || 0), 0), 0));
    const saldo = d.vorrat != null ? r2(d.vorrat - bedarf) : null;
    const zufuhr = d.zufuhr ? r2((d.vorrat != null ? d.vorrat : bedarf) * (d.n || 0)) : null;
    return { d, bedarf, saldo, zufuhr, used: bedarf > 0 || rec.schlaege.some(s => (s.gaben || []).some(g => g.d === d.id)) };
  });
}
// Planbilanz wie in der Excel-Mappe: maximale Zufuhr − Abzug Schleppschlauch − geplante Zufuhr (zugeführte Dünger)
function ebBilanz(rec) {
  const L = ebLager(rec), total = r2(L.reduce((t, x) => t + (x.zufuhr || 0), 0));
  const nFeld = r2(rec.schlaege.reduce((t, s) => t + ebSchlagCalc(rec, s).geplant * (ebSchlagHa(s) || 0), 0));
  return { total, abzug: rec.abzug, max: rec.maxN, reserve: rec.maxN != null ? r2(rec.maxN - (rec.abzug || 0) - total) : null, nFeld };
}

/* ---------- Zwischenfrüchte ---------- */
const ebMixSchlaege = (rec, m) => rec.schlaege.filter(s => s.mix === m.id);
const ebMixHaAuto = (rec, m) => r2(ebMixSchlaege(rec, m).reduce((t, s) => t + (ebSchlagHa(s) || 0), 0));
const ebMixHa = (rec, m) => m.ha != null ? m.ha : ebMixHaAuto(rec, m);
const ebMixLabel = m => `${m.name || 'Mischung'}${m.use ? ` (${m.use})` : ''}`;
// kg/ha einer Art in der Mischung = Saatmenge rein × Anteil / Summe der Anteile (Formel der Excel-Mappe)
function ebMixKg(rec, m) {
  const sum = rec.zf.arten.reduce((t, a) => t + ((m.anteile || {})[a.id] || 0), 0), out = {};
  rec.zf.arten.forEach(a => { const an = (m.anteile || {})[a.id]; if (an && sum) out[a.id] = r2((a.rein || 0) * an / sum); });
  return out;
}
function ebZfNeed(rec) {
  const kg = Object.fromEntries(rec.zf.mix.map(m => [m.id, ebMixKg(rec, m)]));
  return rec.zf.arten.map(a => {
    const bedarf = r2(rec.zf.mix.reduce((t, m) => t + (kg[m.id][a.id] || 0) * (ebMixHa(rec, m) || 0), 0));
    const rest = r2(bedarf - (a.rest || 0)), vorschlag = rest > 0 ? Math.ceil(rest - 1e-9) : 0, best = a.best != null ? a.best : vorschlag;
    return { a, bedarf, rest, vorschlag, best, manuell: a.best != null, betrag: a.preis != null ? r2(best * a.preis) : null };
  });
}

/* ================= Ansicht ================= */
function ebView() {
  return {
    toolbar() {
      return `<h1>Eigener Betrieb</h1><span class="spacer ebsp"></span>
        <label class="btn" title="Bisherige Excel-Mappe «Düngungs- und Anbauplanung» (.xlsx)">Excel importieren …<input type="file" accept=".xlsx" data-ebin="import" hidden></label>
        ${winBtn('betrieb')}
        <button class="btn" data-eb="off" title="Modul aus der Navigation entfernen (Daten bleiben gespeichert; einschalten unter Mehr › Einstellungen)">Modul ausblenden</button>`;
    },
    content: ebContent
  };
}
function ebYearSel(y, key = 'year') {
  const ys = [...new Set([...ebYears(), ebCurYear() - 1, ebCurYear(), ebCurYear() + 1, y])].sort((a, b) => b - a);
  return `<label class="fld" style="margin:0"><span>Jahr</span><select class="input" data-ebin="${key}" style="width:auto">${ys.map(j => `<option value="${j}" ${j === y ? 'selected' : ''}>${j}${ebGet(j) ? '' : ' (leer)'}</option>`).join('')}</select></label>`;
}
function ebContent() {
  try { ebSync(); } catch (e) { console.error(e); }
  const S = ebState(), sub = EB_SUBS.some(([k]) => k === S.sub) ? S.sub : 'fruchtfolge';
  const nav = `<div class="seg ebnav">${EB_SUBS.map(([k, l]) => `<button type="button" data-eb="sub" data-v="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const st = ebStamm();
  if (!Store.get('einstellungen', 'eb-stamm') && !ebYears().length) return nav + `<div class="panel" style="margin-top:12px"><h2>Eigener Betrieb</h2>
      <p>Hier planst du deine eigenen Flächen: Parzellen, Fruchtfolge, Düngung, Zwischenfrüchte und Bodenproben – alles über die Parzelle verknüpft.</p>
      <p>Am schnellsten geht der Start mit der bisherigen Excel-Mappe «Düngungs- und Anbauplanung»: Fruchtfolge ab 2016, Düngungspläne, Zwischenfruchtbestellungen, Bodenproben und Kulturen werden übernommen.</p>
      <div class="btns"><label class="btn primary">Excel-Mappe importieren …<input type="file" accept=".xlsx" data-ebin="import" hidden></label>
        <button class="btn" data-eb="start">Ohne Excel beginnen</button></div>
      <p class="nr">Die Parzellen lassen sich danach mit den Feldern von ${esc(ebKunde() ? ebKunde().name : 'deinem Betrieb')} aus MyJohnDeere verknüpfen.</p></div>`;
  const body = sub === 'duengung' ? ebDuengView() : sub === 'zf' ? ebZfView() : sub === 'boden' ? ebBodenView(st) : sub === 'stamm' ? ebStammView(st) : ebFfView(st);
  return nav + body;
}

/* ---------- Parzellen ---------- */
function ebParzView(st) {
  const S = ebState(), K = ebKunde(), F = ebFelder(), Pall = ebParzSorted(true), P = Pall.filter(p => S.showOff || p.aktiv !== false), y = ebCurYear();
  const nOff = Pall.length - Pall.filter(p => p.aktiv !== false).length;
  const linked = new Set(st.parz.map(p => p.feld).filter(Boolean)), freeF = F.filter(f => f.aktiv !== false && !linked.has(f.id));
  const guess = ebFeldGuessAll(st);
  const yrs = [y - 2, y - 1, y, y + 1];
  const kul = (yy, p) => { const L = ebGet(yy) ? ebGet(yy).schlaege.filter(s => s.parz === p.id && s.art !== 'zwischen') : []; return L.map(s => `<span class="ebk sm" style="--kc:${ebColor(s.kultur)}">${esc(s.kultur || '?')}</span>`).join(' '); };
  const boden = p => { const b = st.boden.filter(x => x.parz === p.id).sort((a, b) => (b.jahr || 0) - (a.jahr || 0))[0]; return b ? `<a href="#" data-eb="bEdit" data-id="${b.id}">${b.jahr || '?'}${b.w && b.w.ph != null ? ' · pH ' + fmtNum(b.w.ph) : ''}</a>` : ''; };
  const tot = r2(P.filter(p => p.aktiv !== false).reduce((t, p) => t + (ebParzHa(p) || 0), 0));
  const rows = P.map((p, i) => { const f = feldById(p.feld), g = guess[p.id];
    return `<tr class="click ${p.aktiv === false ? 'ebOff' : ''}" data-eb="parzEdit" data-id="${p.id}"><td class="nowrap"><button type="button" class="x ebmv" data-eb="parzMove" data-id="${p.id}" data-d="-1" ${i ? '' : 'disabled'} aria-label="nach oben" title="nach oben">▲</button><button type="button" class="x ebmv" data-eb="parzMove" data-id="${p.id}" data-d="1" ${i < P.length - 1 ? '' : 'disabled'} aria-label="nach unten" title="nach unten">▼</button></td><td class="n nr">${p.gruppe ?? ''}</td><td><b>${esc(p.name)}</b>${p.teil ? ` <span class="nr">${esc(p.teil)}</span>` : ''}${p.aktiv === false ? ' <span class="nr">(inaktiv)</span>' : ''}</td>
      <td class="n">${ebFmt(ebParzHa(p))}</td>
      <td>${f ? `🌾 ${esc(f.name)} <span class="nr">${f.flaeche ? fmtNum(f.flaeche) + ' ha' : ''}</span>` : g ? `<button type="button" class="btn mini" data-eb="parzLink" data-id="${p.id}" data-f="${g.id}" title="Mit diesem Feld aus MyJohnDeere verknüpfen">↦ ${esc(g.name)}?</button>` : '<span class="nr">–</span>'}</td>
      ${yrs.map(yy => `<td>${kul(yy, p)}</td>`).join('')}<td>${boden(p)}</td></tr>`; }).join('');
  const kOpts = Store.all('kunden').filter(k => k.aktiv !== false || (K && k.id === K.id)).sort(byName).map(k => `<option value="${k.id}" ${K && k.id === K.id ? 'selected' : ''}>${esc(kundeLabel(k))}</option>`).join('');
  return `<div class="panel" style="margin-top:12px"><h2>Parzellen <small class="nr">${P.filter(p => p.aktiv !== false).length} aktiv · ${fmtNum(tot)} ha</small></h2>
    <div class="filters"><label class="fld" style="margin:0;min-width:260px"><span>Eigener Betrieb (Kunde mit den Feldern aus MyJohnDeere)</span><select class="input" data-combo data-ebin="kunde"><option value="">— wählen —</option>${kOpts}</select></label>
      ${nOff ? `<label class="tog"><input type="checkbox" data-ebin="showOff" ${S.showOff ? 'checked' : ''}> inaktive Parzellen anzeigen (${nOff})</label>` : ''}
      <span class="spacer ebsp"></span><button class="btn" data-eb="parzNew">＋ Parzelle</button></div>
    ${P.length ? `<div class="tscroll ebscroll"><table class="btab ebtab"><thead><tr><th title="Reihenfolge in Fruchtfolge, Düngung und Ausdrucken">Reihenfolge</th><th class="n" title="Fruchtfolge-Gruppe">Gr.</th><th>Parzelle</th><th class="n">ha</th><th>Feld MyJohnDeere</th>${yrs.map(yy => `<th>${yy}</th>`).join('')}<th>Bodenprobe</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="nr">Noch keine Parzellen.</p>'}
    ${Object.keys(guess).length ? `<div class="btns"><button class="btn" data-eb="parzLinkAll">Alle Vorschläge (↦ …?) übernehmen</button></div>` : ''}
    <p class="nr">Mit ▲▼ legst du die Reihenfolge fest – so erscheinen die Parzellen in Fruchtfolge und Ausdrucken. Eine Parzelle ist die Einheit für Fruchtfolge, Düngung und Bodenproben. Wird ein Feld in Teilen bewirtschaftet (z.B. Lysshübeli West/Ost), erfasse pro Teil eine Parzelle und verknüpfe beide mit demselben Feld. Ohne eigene Fläche gilt die Fläche des Feldes aus MyJohnDeere.</p></div>
    ${K ? `<div class="panel"><h2>Felder von ${esc(K.name)} ohne Parzelle <small class="nr">${freeF.length}</small></h2>
      ${freeF.length ? `<div class="chips static">${freeF.map(f => `<span class="chip">${esc(f.name)}${f.flaeche ? ' · ' + fmtNum(f.flaeche) + ' ha' : ''}</span>`).join('')}</div>
      <div class="btns"><button class="btn" data-eb="feldImport">Als Parzellen übernehmen …</button></div>` : '<p class="nr">Alle Felder sind einer Parzelle zugeordnet.</p>'}</div>`
    : `<div class="panel"><h2>Felder aus MyJohnDeere</h2><p class="nr">Wähle oben den Kunden deines eigenen Betriebs, damit die Parzellen mit seinen Feldern verknüpft werden können.</p></div>`}`;
}
function ebParzDialog(id) {
  const st = ebStamm(), isNew = !id, p = isNew ? { id: uid(), name: '', teil: '', feld: '', ha: null, gruppe: null, aktiv: true, notiz: '' } : structuredClone(st.parz.find(x => x.id === id));
  if (!p) return;
  const F = ebFelder(), others = ebParzSorted(true).filter(x => x.id !== p.id);
  const nS = ebYears().reduce((t, y) => t + ebGet(y).schlaege.filter(s => s.parz === p.id).length, 0), nB = st.boden.filter(b => b.parz === p.id).length;
  const body = `<div class="two"><label class="fld"><span>Name</span><input class="input" name="name" value="${esc(p.name)}" required autofocus></label>
      <label class="fld"><span>Teil <small class="nr">z.B. West, Nord (leer = ganze Parzelle)</small></span><input class="input" name="teil" value="${esc(p.teil || '')}"></label></div>
    <label class="fld"><span>Feld aus MyJohnDeere${ebKunde() ? ` (${esc(ebKunde().name)})` : ''}</span><select class="input" name="feld"><option value="">— kein Feld —</option>${F.map(f => `<option value="${f.id}" ${f.id === p.feld ? 'selected' : ''}>${esc(feldLabel(f))}${f.aktiv === false ? ' (archiviert)' : ''}</option>`).join('')}</select></label>
    <div class="three"><label class="fld"><span>Fläche ha <small class="nr">leer = Feld</small></span><input class="input" name="ha" inputmode="decimal" value="${p.ha ?? ''}" placeholder="${ebFmt((feldById(p.feld) || {}).flaeche)}"></label>
      <label class="fld"><span>Fruchtfolge-Gruppe</span><input class="input" name="gruppe" inputmode="numeric" value="${p.gruppe ?? ''}" placeholder="z.B. 1"></label>
      <label class="fld"><span>Status</span><select class="input" name="aktiv" data-plain><option value="1">aktiv</option><option value="0" ${p.aktiv === false ? 'selected' : ''}>inaktiv (nicht mehr bewirtschaftet)</option></select></label></div>
    <label class="fld"><span>Bemerkung</span><input class="input" name="notiz" value="${esc(p.notiz || '')}"></label>
    ${!isNew ? `<p class="nr">${nS} Einträge in der Fruchtfolge · ${nB} Bodenproben</p>
    <details class="ebmerge"><summary>Mit einer anderen Parzelle zusammenführen …</summary>
      <p class="nr">Alle Fruchtfolge-, Düngungs- und Bodenproben-Einträge dieser Parzelle gehen an die gewählte Parzelle; diese hier wird danach gelöscht. Nützlich, wenn der gleiche Acker unter zwei Namen erfasst wurde (z.B. «Gorematt» und «Goorenmatt»).</p>
      <div class="filters"><select class="input" name="merge" data-plain style="width:auto"><option value="">— Parzelle wählen —</option>${others.map(o => `<option value="${o.id}">${esc(ebParzLabel(o))}</option>`).join('')}</select>
        <button type="button" class="btn" data-eb="parzMerge" data-id="${p.id}">Zusammenführen</button></div></details>` : ''}`;
  Dlg.open(isNew ? 'Neue Parzelle' : `Parzelle ${esc(ebParzLabel(p))}`, body, saveFooter(isNew ? '' : `<button type="button" class="btn danger" data-eb="parzDel" data-id="${p.id}">Löschen</button>`), fd => {
    const s2 = ebStamm(); p.name = (fd.get('name') || '').trim(); if (!p.name) return false;
    p.teil = (fd.get('teil') || '').trim(); p.feld = fd.get('feld') || ''; p.ha = ebNum(fd.get('ha')); p.gruppe = ebNum(fd.get('gruppe')); p.aktiv = fd.get('aktiv') !== '0'; p.notiz = (fd.get('notiz') || '').trim();
    if (s2.parz.some(x => x.id !== p.id && ebKey(x.name) === ebKey(p.name) && ebKey(x.teil) === ebKey(p.teil))) { toast('Diese Parzelle gibt es schon.'); return false; }
    const i = s2.parz.findIndex(x => x.id === p.id); if (i >= 0) s2.parz[i] = p; else s2.parz.push(p);
    ebSaveS(s2); return true;
  });
}
function ebParzMerge(fromId, toId) {
  const st = ebStamm(), from = st.parz.find(p => p.id === fromId), to = st.parz.find(p => p.id === toId); if (!from || !to) return;
  if (!confirm(`«${ebParzLabel(from)}» mit «${ebParzLabel(to)}» zusammenführen? «${ebParzLabel(from)}» wird danach gelöscht.`)) return;
  const recs = ebYears().map(y => ebRecY(y)).filter(r => r.schlaege.some(s => s.parz === fromId));
  recs.forEach(r => r.schlaege.forEach(s => { if (s.parz === fromId) s.parz = toId; }));
  st.boden.forEach(b => { if (b.parz === fromId) b.parz = toId; });
  if (!to.feld && from.feld) to.feld = from.feld;
  st.parz = st.parz.filter(p => p.id !== fromId);
  if (recs.length) Store.putMany('einstellungen', recs.map(r => structuredClone(r)));
  ebSaveS(st); Dlg.close(); toast(`Zusammengeführt (${recs.length} Jahre)`);
}
function ebFeldImportDialog() {
  const st = ebStamm(), linked = new Set(st.parz.map(p => p.feld).filter(Boolean)), F = ebFelder().filter(f => f.aktiv !== false && !linked.has(f.id));
  if (!F.length) { toast('Alle Felder sind schon zugeordnet.'); return; }
  const body = `<p class="nr" style="margin-top:0">Für jedes angekreuzte Feld wird eine Parzelle mit gleichem Namen angelegt und verknüpft.</p>
    <div class="checklist">${F.map(f => `<label><input type="checkbox" name="f" value="${f.id}" checked><span><b>${esc(f.name)}</b> <span class="nr">${f.flaeche ? fmtNum(f.flaeche) + ' ha' : ''}</span></span></label>`).join('')}</div>`;
  smallDialog('Felder als Parzellen übernehmen', body, 'Übernehmen', fd => {
    const s2 = ebStamm(), on = new Set(fd.getAll('f'));
    F.filter(f => on.has(f.id)).forEach(f => s2.parz.push({ id: uid(), name: f.name, teil: '', feld: f.id, ha: null, gruppe: null, aktiv: true, notiz: '' }));
    ebSaveS(s2); toast(`${on.size} Parzellen angelegt`);
  });
}

/* ---------- Fruchtfolge ---------- */
const EB_FF_N = 9; // angezeigte Jahre
function ebFfCell(y, L, p, SP) {
  const H = L.filter(s => s.art !== 'zwischen'), Z = L.filter(s => s.art === 'zwischen');
  const pause = s => { const k = ebKultur(s.kultur), n = k && k.pause; if (!p || !n) return '';
    for (let i = 1; i <= n; i++) { const r = ebGet(y - i); if (r && r.schlaege.some(x => x.parz === p.id && x.art !== 'zwischen' && ebSameKultur(x.kultur, s.kultur))) return ` <span class="warnchip" title="Anbaupause ${n} Jahre: ${esc(s.kultur)} stand schon ${y - i} hier">⚠ Pause</span>`; }
    return ''; };
  const ha = s => { const v = ebSchlagHa(s); return v != null ? ` <small>${fmtNum(v)} ha</small>` : ''; };
  const sp = s => SP && SP.get(s.id) ? ` <span class="ebsp1" title="${SP.get(s.id)} Spritzaufträge">🧪${SP.get(s.id) > 1 ? SP.get(s.id) : ''}</span>` : '';
  const dk = s => s.auto ? ' <span class="ebdk" title="Dauerkultur – aus dem Vorjahr weitergeführt">↻</span>' : ebIsDauer(s.kultur) && s.ende ? ' <span class="ebdk" title="Dauerkultur endet nach diesem Jahr">⏹</span>' : '';
  const zl = s => `<div class="ebz" title="${s.indiv ? 'individuelle Zwischenfrucht · ' : ''}Zwischenfrucht nach ${esc((H.find(h => h.id === s.nach) || {}).kultur || 'der Hauptkultur')} ${y}">↳ ${esc(s.kultur || '?')}${s.indiv ? ' ✎' : ''}${ha(s)}${sp(s)}</div>`;
  return H.map(s => `<div class="ebk" style="--kc:${ebColor(s.kultur)}">${esc(s.kultur || '?')}${ha(s)}${dk(s)}${sp(s)}${pause(s)}</div>` + Z.filter(z => z.nach === s.id).map(zl).join('')).join('') +
    Z.filter(z => !H.some(h => h.id === z.nach)).map(zl).join('');
}
function ebFfView(st) {
  const S = ebState(), end = S.ffEnd, years = Array.from({ length: EB_FF_N }, (_, i) => end - EB_FF_N + 1 + i), cy = ebCurYear();
  const recs = Object.fromEntries(years.map(y => [y, ebGet(y) || null])), SP = ebSprayIndex(years);
  const L = (y, f) => recs[y] ? recs[y].schlaege.filter(f) : [];
  const Pin = ebParzSorted(true).filter(p => p.aktiv !== false || years.some(y => L(y, s => s.parz === p.id).length));
  const P = Pin.filter(p => S.showOff || p.aktiv !== false), nOff = Pin.length - P.length;
  // Parzellen mit Fruchtfolge-Gruppe zuerst (Reihenfolge wie unter Stammdaten), Parzellen ohne Gruppe unter «Weitere Flächen»
  const Pg = P.filter(p => p.gruppe != null), Pn = P.filter(p => p.gruppe == null);
  let lastG = Symbol();
  const rowP = p => { const g = p.gruppe ?? null, gh = g !== lastG && g != null ? `<tr class="ebgrp"><th class="ebrh">Gruppe ${g} <span class="nr">${fmtNum(r2(P.filter(x => x.gruppe === g && x.aktiv !== false).reduce((t, x) => t + (ebParzHa(x) || 0), 0)))} ha</span></th>${years.map(() => '<td></td>').join('')}</tr>` : ''; lastG = g;
    return gh + `<tr><th class="ebrh" data-eb="parzEdit" data-id="${p.id}" title="Parzelle bearbeiten">${esc(p.name)}${p.teil ? ` <span class="nr">${esc(p.teil)}</span>` : ''}<div class="nr">${ebParzHa(p) != null ? ebFmt(ebParzHa(p)) + ' ha' : ''}${p.feld ? ' · 🌾' : ''}</div></th>
      ${years.map(y => `<td class="ebc ${y === cy ? 'cur' : ''}" data-eb="ffCell" data-y="${y}" data-p="${p.id}">${ebFfCell(y, L(y, s => s.parz === p.id), p, SP)}</td>`).join('')}</tr>`; };
  const totY = y => r2(L(y, s => s.art !== 'zwischen' && s.parz).reduce((t, s) => t + (ebSchlagHa(s) || 0), 0));
  const head = `<div class="filters vbhead" style="margin-top:12px">
      <button class="btn small" data-eb="ffShift" data-d="-1" title="ein Jahr zurück">◀</button><b>${years[0]} – ${end}</b><button class="btn small" data-eb="ffShift" data-d="1" title="ein Jahr vor">▶</button>
      <label class="tog"><input type="checkbox" data-ebin="ffSum" ${S.ffSum ? 'checked' : ''}> Flächen pro Kultur</label>
      ${nOff || S.showOff ? `<label class="tog"><input type="checkbox" data-ebin="showOff" ${S.showOff ? 'checked' : ''}> inaktive Parzellen anzeigen${nOff ? ` (${nOff})` : ''}</label>` : ''}
      <span class="spacer ebsp"></span><button class="btn" data-eb="ffPrint">Drucken / PDF</button><button class="btn" data-eb="xlsx">Excel</button></div>`;
  if (!P.length) return head + `<div class="panel"><p>Noch keine Parzellen. Lege sie unter «Stammdaten › Parzellen» an oder importiere die Excel-Mappe.</p></div>`;
  const tab = `<div class="vbmatrix ebscroll ebff"><table class="vbtab ebfft"><thead><tr><th class="vbc">Parzelle</th>${years.map(y => `<th class="${y === cy ? 'cur' : ''}">${y}</th>`).join('')}</tr></thead>
    <tbody>${Pg.map(rowP).join('')}${Pn.length ? `<tr class="ebgrp"><th class="ebrh">${Pg.length ? 'Weitere Flächen' : 'Parzellen'} <span class="nr">${fmtNum(r2(Pn.filter(x => x.aktiv !== false).reduce((t, x) => t + (ebParzHa(x) || 0), 0)))} ha · ohne Gruppe</span></th>${years.map(() => '<td></td>').join('')}</tr>` + Pn.map(rowP).join('') : ''}</tbody>
    <tfoot><tr><th>Total Hauptkulturen</th>${years.map(y => `<td class="n"><b>${ebFmt(totY(y)) || ''}</b></td>`).join('')}</tr></tfoot></table></div>`;
  return head + `<div class="panel">${tab}<p class="nr">Feld antippen: Haupt- und Zwischenfrucht eines Jahres erfassen. ↳ = Zwischenfrucht nach der Hauptkultur. Reihenfolge der Parzellen unter «Stammdaten › Parzellen» (▲▼). ⚠ Pause = Anbaupause der Kultur (Stammdaten) nicht eingehalten. 🧪 = Spritzaufträge zu dieser Kultur (Modul Spritzen).</p></div>` + (S.ffSum ? ebFfSummary(years, recs) : '');
}
function ebFfSummary(years, recs) {
  const sum = (art) => { const m = new Map(); years.forEach(y => (recs[y] ? recs[y].schlaege : []).filter(s => (s.art === 'zwischen') === (art === 'zwischen') && s.kultur).forEach(s => { const k = ebKultur(s.kultur) && art !== 'zwischen' && ebKultKey(ebKultur(s.kultur).name) === ebKultKey(s.kultur) ? ebKultur(s.kultur).name : s.kultur; const o = m.get(k) || {}; o[y] = r2((o[y] || 0) + (ebSchlagHa(s) || 0)); m.set(k, o); })); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de')); };
  const tb = (L) => L.map(([k, o]) => `<tr><td><span class="ebk sm" style="--kc:${ebColor(k)}">${esc(k)}</span></td>${years.map(y => `<td class="n">${ebFmt(o[y])}</td>`).join('')}</tr>`).join('');
  return `<div class="panel"><h2>Flächen pro Kultur (ha)</h2><div class="tscroll ebscroll"><table class="btab"><thead><tr><th>Hauptkultur</th>${years.map(y => `<th class="n">${y}</th>`).join('')}</tr></thead><tbody>${tb(sum('haupt'))}</tbody>
    <thead><tr><th>Zwischenfrucht</th>${years.map(y => `<th class="n">${y}</th>`).join('')}</tr></thead><tbody>${tb(sum('zwischen'))}</tbody></table></div></div>`;
}
// Feld der Fruchtfolge: alle Schläge einer Parzelle (oder freien Fläche) in einem Jahr
function ebCellDialog(y, parzId, freeName) {
  const rec = ebRecY(y), p = ebParz(parzId), L = rec.schlaege.filter(s => parzId ? s.parz === parzId : !s.parz && (s.name || '–') === freeName);
  if (!L.length) { ebSchlagDialog(y, null, { parz: parzId || '', name: freeName || '', art: 'haupt' }); return; }
  const prev = ebGet(y - 1), vk = parzId && prev ? prev.schlaege.filter(s => s.parz === parzId && s.art !== 'zwischen').map(s => s.kultur).join(' / ') : '';
  const nb = `data-y="${y}" data-p="${parzId || ''}" data-n="${esc(freeName || '')}"`;
  const line = s => { const c = ebSchlagCalc(rec, s), z = s.art === 'zwischen';
    return `<div class="rowi ${z ? 'ebzrow' : ''}" data-eb="sEdit" data-y="${y}" data-id="${s.id}"><span class="ebk" style="--kc:${ebColor(s.kultur)}">${z ? '↳ ' : ''}${esc(s.kultur || '?')}${s.indiv ? ' ✎' : ''}${s.auto ? ' ↻' : ''}</span>
      <div class="grow"><div class="s">${[ebFmt(c.ha) && ebFmt(c.ha) + ' ha', s.sorte, (s.prog || []).join(', '), (s.gaben || []).length ? `${s.gaben.length} Gaben · ${fmtNum(c.geplant)} kg N/ha` : '', s.auto ? 'Dauerkultur aus dem Vorjahr' : ''].filter(Boolean).map(esc).join(' · ')}</div></div><span class="nr">${z ? 'Zwischenfrucht' : ebIsDauer(s.kultur) ? 'Dauerkultur' : 'Hauptkultur'}</span></div>`; };
  const H = L.filter(s => s.art !== 'zwischen'), Z = L.filter(s => s.art === 'zwischen');
  const blk = h => `<div class="ebcblk"><div class="rows">${line(h)}${Z.filter(z => z.nach === h.id).map(line).join('')}</div>
    <button type="button" class="btn small" data-eb="sNew" ${nb} data-art="zwischen" data-nach="${h.id}">＋ Zwischenfrucht nach ${esc(h.kultur || 'Hauptkultur')}</button></div>`;
  const lose = Z.filter(z => !H.some(h => h.id === z.nach));
  const body = `${vk ? `<p class="nr" style="margin-top:0">Vorkultur ${y - 1}: ${esc(vk)}</p>` : ''}${H.map(blk).join('')}
    ${lose.length ? `<div class="ebcblk"><div class="nr">Zwischenfrüchte ohne Hauptkultur</div><div class="rows">${lose.map(line).join('')}</div></div>` : ''}
    <div class="btns"><button type="button" class="btn" data-eb="sNew" ${nb} data-art="haupt">＋ Hauptkultur</button>${H.length ? '' : `<button type="button" class="btn" data-eb="sNew" ${nb} data-art="zwischen">＋ Zwischenfrucht</button>`}</div>`;
  Dlg.open(`${esc(p ? ebParzLabel(p) : freeName)} · ${y}`, body, `<span class="spacer ebsp"></span><button type="button" class="btn" data-act="close">Schliessen</button>`, () => true);
}

/* ---------- Schlag bearbeiten: Kultur, Fläche, Programme und Düngung ---------- */
// Auswahl Hauptkultur: Kulturen der Stammdaten und zuletzt verwendete Hauptkulturen
function ebKulturNames() {
  const set = new Set(ebStamm().kulturen.map(k => k.name));
  ebYears().slice(0, 4).forEach(y => ebGet(y).schlaege.forEach(s => s.kultur && s.art !== 'zwischen' && set.add(s.kultur)));
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}
// Auswahl Zwischenfrucht: Mischungen des Jahres (Bestellung), Liste aus den Stammdaten, oder individuell
function ebZfSelOpts(rec, s) {
  const L = ebStamm().zfListe || [], cur = ebZfSelOf(rec, s);
  const o = (v, l) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  return `<option value="">— wählen —</option>${rec.zf.mix.length ? `<optgroup label="Mischungen ${rec.jahr} (Bestellung)">${rec.zf.mix.map(m => o('mix:' + m.id, ebMixLabel(m))).join('')}</optgroup>` : ''}
    ${L.length ? `<optgroup label="Zwischenfrüchte (Stammdaten)">${L.map(n => o('k:' + n, n)).join('')}</optgroup>` : ''}<option value="indiv" ${cur === 'indiv' ? 'selected' : ''}>✎ Individuelle Zwischenfrucht …</option>`;
}
function ebZfSelOf(rec, s) {
  if (!s.kultur) return '';
  const m = s.mix && rec.zf.mix.find(x => x.id === s.mix && ebKey(x.name) === ebKey(s.kultur)); if (m) return 'mix:' + m.id;
  const k = !s.indiv && (ebStamm().zfListe || []).find(n => ebKey(n) === ebKey(s.kultur)); if (k) return 'k:' + k;
  return 'indiv';
}
const ebHauptOpts = (rec, parz, cur, self) => rec.schlaege.filter(h => h.art !== 'zwischen' && h.parz === parz && parz && h.id !== self)
  .map(h => `<option value="${h.id}" ${h.id === cur ? 'selected' : ''}>${esc(h.kultur || '?')}${ebSchlagHa(h) != null ? ' · ' + fmtNum(ebSchlagHa(h)) + ' ha' : ''}</option>`).join('');
function ebGabeRow(rec, g = {}) {
  const d = ebDuenger(rec, g.d);
  return `<div class="ebgabe"><select class="input" data-plain name="gd"><option value="">— Dünger —</option>${rec.duenger.map(x => `<option value="${x.id}" ${x.id === g.d ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <input class="input" type="date" name="gdat" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(g.datum || '') ? g.datum : '')}" title="Datum (geplant oder ausgeführt)">
    <input class="input" name="gm" inputmode="decimal" value="${g.menge ?? ''}" placeholder="Menge/ha"><span class="u gu">${esc(d ? d.einheit || '' : '')}/ha</span><span class="nr gn"></span>
    <button type="button" class="x" data-ebg="del" aria-label="Entfernen">×</button></div>`;
}
// Auswahl «Planung übernehmen von»: andere Schläge desselben Jahres mit Gaben, gleiche Kultur zuerst
function ebCopyOpts(rec, s) {
  const L = rec.schlaege.filter(x => x.id !== s.id && (x.gaben || []).length);
  if (!L.length || !rec.duenger.length) return '';
  const o = x => { const c = ebSchlagCalc(rec, x); return `<option value="${x.id}">${esc(ebSchlagName(x))} · ${esc(x.kultur || '?')} · ${x.gaben.length} ${x.gaben.length === 1 ? 'Gabe' : 'Gaben'}, ${fmtNum(c.geplant)} kg N/ha</option>`; };
  const same = L.filter(x => s.kultur && ebSameKultur(x.kultur, s.kultur)), other = L.filter(x => !same.includes(x));
  const srt = A => A.sort((a, b) => ebSchlagName(a).localeCompare(ebSchlagName(b), 'de'));
  return `<option value="">— Parzelle wählen —</option>${same.length ? `<optgroup label="Gleiche Kultur">${srt(same).map(o).join('')}</optgroup>` : ''}${other.length ? `<optgroup label="Andere Kulturen">${srt(other).map(o).join('')}</optgroup>` : ''}`;
}
function ebSchlagDialog(y, id, pre = {}) {
  const rec = ebRecY(y), st = ebStamm(), isNew = !id;
  const s = isNew ? Object.assign({ id: uid(), parz: '', name: '', art: 'haupt', kultur: '', mix: '', ha: null, sorte: '', prog: [], bem: '', nBed: null, korr: null, gaben: [] }, pre) : structuredClone(rec.schlaege.find(x => x.id === id));
  if (!s) return;
  const P = ebParzSorted(true).filter(p => p.aktiv !== false || p.id === s.parz);
  const progs = [...new Set([...st.programme, ...(s.prog || [])])];
  const vk = ebVorkultur(rec, s);
  if (isNew && s.art === 'zwischen' && s.parz && s.nach === undefined) { const H = rec.schlaege.filter(h => h.art !== 'zwischen' && h.parz === s.parz); if (H.length === 1) s.nach = H[0].id; }
  const body = `<datalist id="ebKulList">${ebKulturNames().map(k => `<option value="${esc(k)}">`).join('')}</datalist>
    <div class="seg" style="margin-bottom:10px"><label class="ebseg"><input type="radio" name="art" value="haupt" ${s.art !== 'zwischen' ? 'checked' : ''}><span>Hauptkultur</span></label><label class="ebseg"><input type="radio" name="art" value="zwischen" ${s.art === 'zwischen' ? 'checked' : ''}><span>Zwischenfrucht / Gründüngung</span></label></div>
    <div class="two"><label class="fld"><span>Parzelle</span><select class="input" name="parz" data-plain><option value="">— Parzelle wählen —</option>${P.map(p => `<option value="${p.id}" ${p.id === s.parz ? 'selected' : ''}>${esc(ebParzLabel(p))}${ebParzHa(p) != null ? ' · ' + fmtNum(ebParzHa(p)) + ' ha' : ''}</option>`).join('')}</select></label>
      <label class="fld" id="ebNameF" hidden><span>Bezeichnung (ohne Parzelle)</span><input class="input" name="name" value="${esc(s.name || '')}" placeholder="z.B. Weide, Gründüngung ZR"></label></div>
    <div id="ebHauptF" ${s.art === 'zwischen' ? 'hidden' : ''}><label class="fld"><span>Kultur</span><input class="input" name="kultur" list="ebKulList" value="${esc(s.art === 'zwischen' ? '' : s.kultur || '')}" autocomplete="off"></label>
      <label class="tog" id="ebDauerF" hidden><input type="checkbox" name="weiter" ${s.ende ? '' : 'checked'}> Dauerkultur – ${y + 1} automatisch weiterführen <span class="nr">(ausschalten bei Umbruch)</span></label></div>
    <div id="ebZwF" ${s.art === 'zwischen' ? '' : 'hidden'}>
      <div class="two"><label class="fld"><span>Nach Hauptkultur ${y}</span><select class="input" name="nach" data-plain><option value="">— keine —</option>${ebHauptOpts(rec, s.parz, s.nach, s.id)}</select></label>
        <label class="fld"><span>Zwischenfrucht</span><select class="input" name="zfsel" data-plain>${ebZfSelOpts(rec, s)}</select></label></div>
      <div class="two"><label class="fld" id="ebIndF" ${ebZfSelOf(rec, s) === 'indiv' ? '' : 'hidden'}><span>Individuelle Zwischenfrucht <small class="nr">wird nicht in die Stammdaten übernommen</small></span><input class="input" name="zfind" value="${esc(s.art === 'zwischen' && ebZfSelOf(rec, s) === 'indiv' ? s.kultur || '' : '')}" placeholder="z.B. Phacelia + Alexandrinerklee"></label>
        <label class="fld" id="ebMixF"><span>Saatgut aus Mischung (Bestellung ${y})</span><select class="input" name="mix" data-plain><option value="">— keine —</option>${rec.zf.mix.map(m => `<option value="${m.id}" ${m.id === s.mix ? 'selected' : ''}>${esc(ebMixLabel(m))}</option>`).join('')}</select></label></div></div>
    <div class="three"><label class="fld"><span>Fläche ha</span><input class="input" name="ha" inputmode="decimal" value="${s.ha ?? ''}" placeholder=""></label>
      <label class="fld"><span>Sorte</span><input class="input" name="sorte" value="${esc(s.sorte || '')}"></label>
      <label class="fld"><span>Vorkultur ${y - 1}</span><input class="input" name="vk" value="${esc(vk)}" ${s.parz && vk && !s.vk ? 'readonly tabindex="-1" title="aus der Fruchtfolge"' : ''} placeholder="—"></label></div>
    <div class="fld"><span>Programme</span><div class="chips">${progs.map(x => `<label><input type="checkbox" name="prog" value="${esc(x)}" ${(s.prog || []).includes(x) ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}</div></div>
    <label class="fld"><span>Bemerkung</span><input class="input" name="bem" value="${esc(s.bem || '')}"></label>
    ${isNew ? '' : ebSprayList(y, s)}
    <div class="box"><h4>🌱 Düngung ${y} <small class="nr" id="ebNInfo"></small></h4>
      <div class="three"><label class="fld"><span>N-Bedarf kg/ha <small class="nr">GRUDAF</small></span><input class="input" name="nBed" inputmode="decimal" value="${s.nBed ?? ''}"></label>
        <label class="fld"><span>Korrektur ± kg N/ha</span><input class="input" name="korr" inputmode="decimal" value="${s.korr ?? ''}" placeholder="0"></label>
        <label class="fld"><span>Restbedarf kg N/ha</span><input class="input" name="rest" readonly tabindex="-1"></label></div>
      ${ebCopyOpts(rec, s) ? `<label class="fld ebcopy"><span>Planung übernehmen von</span><select class="input" name="gcopy" data-plain>${ebCopyOpts(rec, s)}</select></label>` : ''}
      ${rec.duenger.length ? `<div id="ebGaben">${(s.gaben || []).map(g => ebGabeRow(rec, g)).join('')}</div><button type="button" class="btn small" data-ebg="add">＋ Gabe</button>`
        : `<p class="nr">Für ${y} sind noch keine Dünger erfasst (Düngung › Dünger & Lager${ebGet(y - 1) && ebGet(y - 1).duenger.length ? ` – oder «Aus ${y - 1} übernehmen»` : ''}).</p>`}</div>`;
  Dlg.open(`${isNew ? 'Neu' : esc(ebSchlagName(s))} · ${y}`, body, saveFooter(isNew ? '' : `<button type="button" class="btn danger" data-eb="sDel" data-y="${y}" data-id="${s.id}">Löschen</button>`), fd => {
    const r = ebRecY(y); const o = r.schlaege.find(x => x.id === s.id) || s;
    o.art = fd.get('art') === 'zwischen' ? 'zwischen' : 'haupt'; o.parz = fd.get('parz') || ''; o.name = o.parz ? '' : (fd.get('name') || '').trim();
    o.ha = ebNum(fd.get('ha')); o.auto = false; delete o.indiv;
    if (o.art === 'haupt') {
      o.kultur = (fd.get('kultur') || '').trim(); o.mix = ''; delete o.nach;
      o.ende = ebIsDauer(o.kultur) && !fd.get('weiter') ? true : undefined; if (o.ende === undefined) delete o.ende;
      r.schlaege.filter(z => z.nach === o.id).forEach(z => { z.parz = o.parz; z.name = o.name; }); // Zwischenfrüchte folgen ihrer Hauptkultur
    } else {
      const sel = fd.get('zfsel') || ''; o.mix = fd.get('mix') || ''; o.nach = o.parz ? fd.get('nach') || '' : ''; delete o.ende;
      if (sel.startsWith('mix:')) { const m = r.zf.mix.find(x => x.id === sel.slice(4)); o.mix = m ? m.id : o.mix; o.kultur = m ? m.name : ''; }
      else if (sel.startsWith('k:')) o.kultur = sel.slice(2);
      else if (sel === 'indiv') { o.kultur = (fd.get('zfind') || '').trim(); o.indiv = true; }
      else o.kultur = '';
      const h = o.nach && r.schlaege.find(x => x.id === o.nach); if (h && o.ha != null && Math.abs(o.ha - (ebSchlagHa(h) ?? -1)) < 0.001) o.ha = null;
    }
    o.sorte = (fd.get('sorte') || '').trim(); o.prog = fd.getAll('prog'); o.bem = (fd.get('bem') || '').trim();
    const vkIn = (fd.get('vk') || '').trim(), vkAuto = o.parz && ebGet(y - 1) ? ebGet(y - 1).schlaege.filter(x => x.parz === o.parz && x.art !== 'zwischen').map(x => x.kultur).join(' / ') : '';
    o.vk = vkIn && vkIn !== vkAuto ? vkIn : '';
    const nb = ebNum(fd.get('nBed')), kb = (ebKultur(o.kultur) || (o.art === 'zwischen' ? ebKultur('Gründüngung') : null) || {}).n;
    o.nBed = nb != null && nb !== kb ? nb : null; o.korr = ebNum(fd.get('korr'));
    if (rec.duenger.length) o.gaben = $$('.ebgabe', Dlg.form).map((row, i) => ({ id: ((s.gaben || [])[i] || {}).id || uid(), d: row.querySelector('[name=gd]').value, datum: row.querySelector('[name=gdat]').value || '', menge: ebNum(row.querySelector('[name=gm]').value) })).filter(g => g.d && g.menge != null);
    if (!o.kultur) { toast(o.art === 'zwischen' ? 'Zwischenfrucht wählen oder eingeben.' : 'Kultur eingeben.'); return false; }
    if (!o.parz) { toast('Parzelle wählen.'); return false; }
    if (!r.schlaege.includes(o)) r.schlaege.push(o);
    ebSaveY(r); return true;
  });
  ebWireSchlag(Dlg.form, rec, s);
}
function ebWireSchlag(f, rec, s) {
  let lastParz = f.parz.value;
  const zfName = () => { const v = f.zfsel.value; if (v.startsWith('mix:')) return (rec.zf.mix.find(m => m.id === v.slice(4)) || {}).name || ''; if (v.startsWith('k:')) return v.slice(2); return v === 'indiv' ? f.zfind.value : ''; };
  const upd = () => {
    const art = (f.querySelector('[name=art]:checked') || {}).value, zw = art === 'zwischen', parz = f.parz.value, p = ebParz(parz);
    $('#ebHauptF', f).hidden = zw; $('#ebZwF', f).hidden = !zw; $('#ebNameF', f).hidden = true;
    if (parz !== lastParz) { lastParz = parz; const cur = f.nach.value; f.nach.innerHTML = `<option value="">— keine —</option>${ebHauptOpts(rec, parz, cur, s.id)}`; if (f.nach.options.length === 2 && !cur) f.nach.selectedIndex = 1; }
    $('#ebIndF', f).hidden = f.zfsel.value !== 'indiv';
    $('#ebDauerF', f).hidden = zw || !ebIsDauer(f.kultur.value);
    const h = zw && f.nach.value ? rec.schlaege.find(x => x.id === f.nach.value) : null;
    f.ha.placeholder = h && ebSchlagHa(h) != null ? `${fmtNum(ebSchlagHa(h))} (wie ${h.kultur})` : p && ebParzHa(p) != null ? `${fmtNum(ebParzHa(p))} (Parzelle)` : '';
    const k = ebKultur(zw ? zfName() : f.kultur.value) || (zw ? ebKultur('Gründüngung') : null), kb = k ? k.n : null;
    f.nBed.placeholder = kb != null ? `${fmtNum(kb)} (${k.name})` : '–';
    const bed = ebNum(f.nBed.value) ?? kb, korr = ebNum(f.korr.value) || 0;
    let sum = 0;
    $$('.ebgabe', f).forEach(row => { const d = ebDuenger(rec, row.querySelector('[name=gd]').value), m = ebNum(row.querySelector('[name=gm]').value), n = d && m != null && d.n != null ? r2(m * d.n) : null;
      row.querySelector('.gu').textContent = d ? `${d.einheit || ''}/ha` : ''; row.querySelector('.gn').textContent = n != null ? `= ${fmtNum(n)} kg N` : ''; sum += n || 0; });
    sum = r2(sum); f.rest.value = bed != null ? fmtNum(r2(bed + korr - sum)) : '';
    $('#ebNInfo', f).textContent = sum ? `geplant ${fmtNum(sum)} kg N/ha` : '';
  };
  f.addEventListener('input', upd); f.addEventListener('change', e => {
    if (e.target.name === 'gcopy' && e.target.value) {
      const src = rec.schlaege.find(x => x.id === e.target.value), box = $('#ebGaben', f);
      if (src && box) {
        if (!$$('.ebgabe', f).length || confirm(`Die bisherigen Gaben durch die Planung von ${ebSchlagName(src)} (${src.kultur}) ersetzen?`)) {
          box.innerHTML = src.gaben.map(g => ebGabeRow(rec, { d: g.d, datum: g.datum, menge: g.menge })).join('');
          f.korr.value = src.korr ?? ''; toast(`Planung von ${ebSchlagName(src)} übernommen – mit Speichern bestätigen`);
        }
      }
      e.target.value = '';
    }
    if (e.target.name === 'zfsel' && e.target.value.startsWith('mix:')) f.mix.value = e.target.value.slice(4);
    if (e.target.name === 'zfsel' && e.target.value === 'indiv') setTimeout(() => f.zfind.focus(), 0);
    upd();
  });
  f.addEventListener('click', e => {
    const t = e.target.closest('[data-ebg]'); if (!t) return; e.preventDefault(); e.stopPropagation();
    if (t.dataset.ebg === 'add') { $('#ebGaben', f).insertAdjacentHTML('beforeend', ebGabeRow(rec, {})); const sl = $$('.ebgabe', f).pop(); sl.querySelector('select').focus(); }
    if (t.dataset.ebg === 'del') t.closest('.ebgabe').remove();
    upd();
  });
  upd();
}

/* ---------- Düngungsplanung ---------- */
function ebGabenChips(rec, s) {
  return (s.gaben || []).map(g => { const d = ebDuenger(rec, g.d); return `<span class="ebg" title="${esc(d ? d.name : '?')}${g.datum ? ' · ' + esc(ebDatum(g.datum)) : ''}">${esc(d ? d.name : '?')} <b>${fmtNum(g.menge)}</b> ${esc(d ? d.einheit || '' : '')}<small> · ${fmtNum(ebGabeN(rec, g))} N</small></span>`; }).join('');
}
function ebDuengView() {
  const S = ebState(), y = S.y, rec = ebRecY(y), prev = ebGet(y - 1);
  const dSub = ['plan', 'lager', 'bilanz'].includes(S.dSub) ? S.dSub : 'plan';
  const neg = ebLager(rec).filter(x => x.saldo != null && x.saldo < 0).length, B = ebBilanz(rec);
  const tabs = [['plan', 'Düngungsplanung'], ['lager', `Dünger & Lager${neg ? ' <span class="ebwarnb" title="zu wenig an Lager">⚠</span>' : ''}`], ['bilanz', `Planbilanz${B.reserve != null && B.reserve < 0 ? ' <span class="ebwarnb" title="Reserve negativ">⚠</span>' : ''}`]];
  const head = `<div class="filters vbhead" style="margin-top:12px">${ebYearSel(y)}<div class="seg mini">${tabs.map(([k, l]) => `<button type="button" data-eb="dSub" data-v="${k}" class="${dSub === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="spacer ebsp"></span>
      ${prev && !rec.duenger.length && dSub !== 'plan' ? `<button class="btn" data-eb="dFromPrev">Dünger & Bilanz aus ${y - 1} übernehmen</button>` : ''}
      ${dSub === 'plan' && rec.schlaege.length && prev ? `<button class="btn" data-eb="gFromPrev" title="Für Schläge ohne Gaben die Gaben derselben Kultur aus ${y - 1} vorschlagen">Gaben aus ${y - 1} vorschlagen</button>` : ''}
      ${rec.schlaege.length ? `<button class="btn" data-eb="dPrint">Drucken / PDF</button><button class="btn" data-eb="xlsx">Excel</button>` : ''}</div>`;
  if (dSub === 'lager') return head + ebLagerPanel(rec);
  if (dSub === 'bilanz') return head + ebBilanzPanel(rec);
  if (!rec.schlaege.length) return head + `<div class="panel"><h2>Düngungsplanung ${y}</h2><p>Für ${y} sind noch keine Kulturen erfasst. Trage sie zuerst in der Fruchtfolge ein (Feld antippen) – sie erscheinen dann hier mit dem N-Bedarf.</p>
      <div class="btns"><button class="btn primary" data-eb="sub" data-v="fruchtfolge">Zur Fruchtfolge</button></div></div>`;
  const zHide = rec.schlaege.filter(s => s.art === 'zwischen' && !(s.gaben || []).length && s.nBed == null).length;
  const L = rec.schlaege.filter(s => !(s.art === 'zwischen' && !(s.gaben || []).length && s.nBed == null)).sort((a, b) => ((a.art === 'zwischen') - (b.art === 'zwischen')) || String(a.kultur).localeCompare(String(b.kultur), 'de') || ebSchlagName(a).localeCompare(ebSchlagName(b), 'de'));
  let lastK = null;
  const rows = L.map(s => {
    const c = ebSchlagCalc(rec, s), grp = s.art === 'zwischen' ? 'Zwischenfrüchte / Gründüngung' : (ebKultur(s.kultur) ? ebKultur(s.kultur).name : s.kultur);
    const gh = grp !== lastK ? `<tr class="gk"><td colspan="10">${esc(grp)}</td></tr>` : ''; lastK = grp;
    const rc = c.rest == null ? '' : c.rest < -5 ? 'ebover' : c.rest > 5 ? 'ebunder' : 'ebok';
    return gh + `<tr class="click" data-eb="sEdit" data-y="${y}" data-id="${s.id}"><td><b>${esc(ebSchlagName(s))}</b>${s.art === 'zwischen' ? ` <span class="nr">${esc(s.kultur)}</span>` : s.kultur !== grp ? ` <span class="nr">${esc(s.kultur)}</span>` : ''}</td>
      <td class="n">${ebFmt(c.ha)}</td><td class="nr">${esc(ebVorkultur(rec, s))}</td>
      <td class="n">${ebDash(c.bed)}${s.nBed != null ? '<sup title="eigener Wert">*</sup>' : ''}</td><td class="n">${s.korr ? (s.korr > 0 ? '+' : '') + fmtNum(s.korr) : ''}</td>
      <td class="n">${c.geplant ? fmtNum(c.geplant) : ''}</td><td class="n ${rc}"><b>${c.rest == null ? '' : fmtNum(c.rest)}</b></td>
      <td class="ebgc">${ebGabenChips(rec, s)}</td><td>${esc(s.sorte || '')}</td><td class="nr">${esc((s.prog || []).join(', '))}</td></tr>`;
  }).join('');
  const nOver = L.filter(s => (ebSchlagCalc(rec, s).rest ?? 0) < -5).length;
  return head + `<div class="panel"><h2>Düngungsplanung ${y} <small class="nr">kg N/ha · Zeile antippen zum Bearbeiten</small></h2>
    ${nOver ? `<p class="warnline">${nOver} ${nOver === 1 ? 'Schlag ist' : 'Schläge sind'} mehr als 5 kg N/ha über dem Bedarf geplant (rot).</p>` : ''}
    <div class="tscroll ebscroll"><table class="btab ebdt"><thead><tr><th>Parzelle</th><th class="n">ha</th><th>Vorkultur</th><th class="n">Bedarf N</th><th class="n">±</th><th class="n">geplant</th><th class="n">Rest</th><th>Gaben (Menge/ha · kg N/ha)</th><th>Sorte</th><th>Programme</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="nr">Rest = Bedarf + Korrektur − geplante Düngung. <span class="ebover">Rot</span> = mehr als 5 kg N/ha über dem Bedarf, <span class="ebunder">orange</span> = noch mehr als 5 kg N/ha offen. Bedarf aus Stammdaten › Kulturen (GRUDAF), * = eigener Wert. Zwischenfrüchte ohne eigene Kultur rechnen mit «Gründüngung».${zHide ? ` ${zHide} Zwischenfrüchte ohne Düngung sind ausgeblendet (in der Fruchtfolge antippen, um eine Gabe zu planen).` : ''}</p></div>`;
}
function ebLagerPanel(rec) {
  const L = ebLager(rec), B = ebBilanz(rec), y = rec.jahr;
  const rows = L.map(({ d, bedarf, saldo, zufuhr, used }) => `<tr><td><input class="vbin wide" data-ebin="dName" data-id="${d.id}" data-ebk="dn-${d.id}" value="${esc(d.name)}"></td>
      <td><input class="vbin sm" data-ebin="dEinh" data-id="${d.id}" data-ebk="de-${d.id}" value="${esc(d.einheit || '')}" placeholder="dt"></td>
      <td class="n"><input class="vbin" inputmode="decimal" data-ebin="dN" data-id="${d.id}" data-ebk="dg-${d.id}" value="${d.n ?? ''}"></td>
      <td class="n"><input class="vbin" inputmode="decimal" data-ebin="dVorrat" data-id="${d.id}" data-ebk="dv-${d.id}" value="${d.vorrat ?? ''}"></td>
      <td class="n">${ebFmt(bedarf)}</td><td class="n ${saldo != null && saldo < 0 ? 'ebover' : ''}"><b>${saldo == null ? '' : fmtNum(saldo)}</b></td>
      <td class="c"><input type="checkbox" data-ebin="dZuf" data-id="${d.id}" ${d.zufuhr ? 'checked' : ''} title="Zugekaufter bzw. zugeführter Dünger – zählt in der Planbilanz"></td><td class="n">${zufuhr != null ? fmtNum(zufuhr) : ''}</td>
      <td>${used ? '' : `<button type="button" class="x" data-eb="dDel" data-id="${d.id}" aria-label="Entfernen">×</button>`}</td></tr>`).join('');
  const neg = L.filter(x => x.saldo != null && x.saldo < 0);
  return `<div class="panel"><h2>Dünger & Lager ${y}</h2>
      ${neg.length ? `<p class="warnline">Zu wenig an Lager: ${neg.map(x => `${esc(x.d.name)} ${fmtNum(-x.saldo)} ${esc(x.d.einheit || '')}`).join(', ')}</p>` : ''}
      <div class="tscroll"><table class="need vbneed ebld"><thead><tr><th>Dünger</th><th>Einheit</th><th class="n">kg N / Einheit</th><th class="n">Vorrat</th><th class="n">Bedarf</th><th class="n">Saldo</th><th title="zugeführt (zählt in der Planbilanz)">Zufuhr</th><th class="n">kg N</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="nr">Noch keine Dünger.</td></tr>'}</tbody></table></div>
      <div class="btns"><button class="btn" data-eb="dNew">＋ Dünger</button></div>
      <p class="nr">Bedarf = Σ Menge/ha × Fläche aller Gaben. Saldo = Vorrat − Bedarf. «Zufuhr» ankreuzen für zugeführte Dünger (Mineraldünger, fremde Gülle); deren N zählt in der Planbilanz (Vorrat × Gehalt, ohne Vorrat Bedarf × Gehalt).</p></div>`;
}
function ebBilanzPanel(rec) {
  const L = ebLager(rec), B = ebBilanz(rec), y = rec.jahr, Z = L.filter(x => x.d.zufuhr);
  return `<div class="cols"><div class="panel"><h2>Planbilanz N ${y}</h2>
      <table class="btab kv ebbil"><tr><td>Geplante Zufuhr</td><td class="n"><b>${fmtNum(B.total)} kg N</b></td></tr>
        <tr><td>Abzug für Schleppschlauch</td><td class="n"><input class="vbin" inputmode="decimal" data-ebin="abzug" data-ebk="abzug" value="${rec.abzug ?? ''}" placeholder="0"> kg N</td></tr>
        <tr><td>Maximale Zufuhr gemäss Planbilanz</td><td class="n"><input class="vbin" inputmode="decimal" data-ebin="maxN" data-ebk="maxN" value="${rec.maxN ?? ''}"> kg N</td></tr>
        <tr class="ebres"><td><b>Reserve</b></td><td class="n ${B.reserve != null && B.reserve < 0 ? 'ebover' : 'ebok'}"><b>${B.reserve == null ? '–' : fmtNum(B.reserve) + ' kg N'}</b></td></tr></table>
      <p class="nr">Reserve = maximale Zufuhr − Abzug Schleppschlauch − geplante Zufuhr (wie in der Excel-Mappe). Auf den Flächen geplant: ${fmtNum(B.nFeld)} kg N. Die verbindliche Bilanz bleibt die Suisse-Bilanz.</p></div>
    <div class="panel"><h2>Zugeführte Dünger ${y}</h2>
      ${Z.length ? `<div class="tscroll"><table class="btab"><thead><tr><th>Dünger</th><th class="n">Vorrat</th><th class="n">geplant</th><th class="n">kg N / Einheit</th><th class="n">kg N</th></tr></thead><tbody>
        ${Z.map(x => `<tr><td>${esc(x.d.name)}</td><td class="n">${x.d.vorrat != null ? fmtNum(x.d.vorrat) + ' ' + esc(x.d.einheit || '') : '–'}</td><td class="n">${ebFmt(x.bedarf)} ${esc(x.d.einheit || '')}</td><td class="n">${ebFmt(x.d.n)}</td><td class="n"><b>${fmtNum(x.zufuhr || 0)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4"><b>Total geplante Zufuhr</b></td><td class="n"><b>${fmtNum(B.total)}</b></td></tr></tfoot></table></div>` : '<p class="nr">Kein Dünger als «Zufuhr» markiert (unter Dünger & Lager ankreuzen).</p>'}
      <p class="nr">Zählt mit dem Vorrat; ohne Vorrat mit der geplanten Menge.</p></div></div>`;
}
function ebDuengerDialog() {
  const body = `<label class="fld"><span>Dünger</span><input class="input" name="name" required placeholder="z.B. Harnstoff"></label>
    <div class="three"><label class="fld"><span>Einheit</span><input class="input" name="einheit" value="dt" placeholder="dt, m3, t"></label>
      <label class="fld"><span>kg N pro Einheit</span><input class="input" name="n" inputmode="decimal"></label>
      <label class="fld"><span>Vorrat</span><input class="input" name="vorrat" inputmode="decimal"></label></div>
    <label class="tog"><input type="checkbox" name="zufuhr"> zugeführt (zählt in der Planbilanz)</label>`;
  smallDialog('Dünger hinzufügen', body, 'Hinzufügen', fd => {
    const rec = ebRecY(ebState().y), name = (fd.get('name') || '').trim(); if (!name) return false;
    if (rec.duenger.some(d => ebKey(d.name) === ebKey(name))) { toast('Diesen Dünger gibt es schon.'); return false; }
    rec.duenger.push({ id: 'd-' + ebSlug(name), name, einheit: (fd.get('einheit') || '').trim(), n: ebNum(fd.get('n')), vorrat: ebNum(fd.get('vorrat')), zufuhr: !!fd.get('zufuhr') });
    ebSaveY(rec);
  });
}
function ebDFromPrev() {
  const y = ebState().y, prev = ebGet(y - 1); if (!prev) return;
  const rec = ebRecY(y); rec.duenger = prev.duenger.map(d => ({ ...d, vorrat: null })); if (rec.maxN == null) rec.maxN = prev.maxN; if (rec.abzug == null) rec.abzug = prev.abzug;
  ebSaveY(rec); toast(`Dünger aus ${y - 1} übernommen – Vorräte neu eintragen`);
}
// Gaben derselben Kultur aus dem Vorjahr als Vorschlag (nur Schläge ohne Gaben)
function ebGFromPrev() {
  const y = ebState().y, prev = ebGet(y - 1), rec = ebRecY(y); if (!prev) return;
  const ids = new Set(rec.duenger.map(d => d.id)); let n = 0, fehlt = new Set();
  rec.schlaege.filter(s => !(s.gaben || []).length).forEach(s => {
    const v = prev.schlaege.find(x => x.art === s.art && ebSameKultur(x.kultur, s.kultur) && (x.gaben || []).length); if (!v) return;
    v.gaben.forEach(g => { if (!ids.has(g.d)) { const d = prev.duenger.find(x => x.id === g.d); if (d) { rec.duenger.push({ ...d, vorrat: null }); ids.add(d.id); fehlt.add(d.name); } } });
    s.gaben = v.gaben.map(g => ({ id: uid(), d: g.d, datum: '', menge: g.menge })); if (s.korr == null) s.korr = v.korr ?? null; n++;
  });
  if (!n) { toast('Keine passenden Gaben im Vorjahr gefunden.'); return; }
  ebSaveY(rec); toast(`Für ${n} Schläge Gaben vorgeschlagen${fehlt.size ? ` · Dünger ergänzt: ${[...fehlt].join(', ')}` : ''}`, 4500);
}

/* ---------- Zwischenfrüchte: Mischungen und Saatgutbestellung ---------- */
function ebZfView() {
  const S = ebState(), y = S.y, rec = ebRecY(y), Z = rec.zf, prev = ebGet(y - 1), pz = prev && prev.zf && (prev.zf.arten || []).length;
  const head = `<div class="filters vbhead" style="margin-top:12px">${ebYearSel(y)}<span class="spacer ebsp"></span>
      ${pz && !Z.arten.length ? `<button class="btn" data-eb="zfFromPrev">Arten & Mischungen aus ${y - 1} übernehmen</button>` : ''}
      ${Z.arten.length ? `<button class="btn" data-eb="zfPrint">Drucken / PDF</button><button class="btn" data-eb="xlsx">Excel</button>` : ''}</div>`;
  if (!Z.arten.length && !Z.mix.length) return head + `<div class="panel"><h2>Zwischenfrüchte ${y}</h2><p>Noch keine Arten und Mischungen für ${y}. ${pz ? `Übernimm sie aus ${y - 1} (Preise und Lager danach anpassen) oder beginne neu.` : 'Erfasse zuerst die Arten (Preis, Saatmenge rein) und dann die Mischungen mit ihren Anteilen.'}</p>
      <div class="btns">${pz ? `<button class="btn primary" data-eb="zfFromPrev">Aus ${y - 1} übernehmen</button>` : ''}<button class="btn" data-eb="artNew">＋ Art</button><button class="btn" data-eb="mixNew">＋ Mischung</button></div></div>`;
  const M = Z.mix, kg = Object.fromEntries(M.map(m => [m.id, ebMixKg(rec, m)])), need = Object.fromEntries(ebZfNeed(rec).map(x => [x.a.id, x]));
  const mh = m => { const auto = ebMixHaAuto(rec, m), n = ebMixSchlaege(rec, m).length; return `<th colspan="2" class="vbph ebmix" data-eb="mixEdit" data-id="${m.id}" title="Mischung bearbeiten">${esc(m.name || 'Mischung')}<small>${esc(m.use || '')}</small><small><b>${ebFmt(ebMixHa(rec, m)) || 0} ha</b>${m.ha != null ? ' (von Hand)' : n ? ` (${n} ${n === 1 ? 'Schlag' : 'Schläge'})` : ''}${m.ha != null && n && Math.abs(auto - m.ha) > 0.04 ? ` · Fruchtfolge ${fmtNum(auto)}` : ''}</small></th>`; };
  const rows = Z.arten.map(a => { const x = need[a.id];
    return `<tr><th class="vbrh" data-eb="artEdit" data-id="${a.id}" title="Art bearbeiten">${esc(a.name)}</th>
      <td class="n"><input class="vbin" inputmode="decimal" data-ebin="aPreis" data-id="${a.id}" data-ebk="ap-${a.id}" value="${a.preis ?? ''}"></td>
      <td class="n"><input class="vbin" inputmode="decimal" data-ebin="aRein" data-id="${a.id}" data-ebk="ar-${a.id}" value="${a.rein ?? ''}"></td>
      ${M.map(m => `<td class="n ebmixc"><input class="vbin sm" inputmode="decimal" data-ebin="anteil" data-m="${m.id}" data-id="${a.id}" data-ebk="an-${m.id}-${a.id}" value="${(m.anteile || {})[a.id] ?? ''}"></td><td class="n nr">${ebFmt(kg[m.id][a.id])}</td>`).join('')}
      <td class="n tot">${ebFmt(x.bedarf)}</td>
      <td class="n"><input class="vbin" inputmode="decimal" data-ebin="aRest" data-id="${a.id}" data-ebk="aL-${a.id}" value="${a.rest ?? ''}" placeholder="0"></td>
      <td class="n ${x.rest < 0 ? 'nr' : ''}">${ebFmt(x.rest)}</td>
      <td class="n"><input class="vbin ${x.manuell ? '' : 'auto'}" inputmode="decimal" data-ebin="aBest" data-id="${a.id}" data-ebk="ab-${a.id}" value="${x.manuell ? a.best : ''}" placeholder="${x.vorschlag || ''}" title="${x.manuell ? 'von Hand (leeren = Vorschlag)' : 'Vorschlag = Restbedarf aufgerundet'}"></td>
      <td class="n">${x.betrag ? chf(x.betrag) : ''}</td></tr>`; }).join('');
  const sumKg = m => r2(Object.values(kg[m.id]).reduce((t, v) => t + v, 0)), chfHa = m => r2(Z.arten.reduce((t, a) => t + (kg[m.id][a.id] || 0) * (a.preis || 0), 0));
  const tot = r2(ebZfNeed(rec).reduce((t, x) => t + (x.betrag || 0), 0));
  const tab = `<div class="vbmatrix ebscroll"><table class="vbtab ebzft"><thead><tr><th class="vbc">Art / Sorte</th><th class="n">Preis CHF/kg</th><th class="n">Saatmenge rein kg/ha</th>${M.map(mh).join('')}<th class="n">Bedarf kg</th><th class="n">Lager kg</th><th class="n">Restbedarf</th><th class="n">Bestellung kg</th><th class="n">Betrag CHF</th></tr>
      <tr><th class="vbc"></th><th></th><th></th>${M.map(() => '<th class="n nr">Anteil</th><th class="n nr">kg/ha</th>').join('')}<th></th><th></th><th></th><th></th><th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>Mischung kg/ha</th><td></td><td></td>${M.map(m => `<td></td><td class="n"><b>${ebFmt(sumKg(m))}</b></td>`).join('')}<td colspan="4"></td><td class="n"><b>${chf(tot)}</b></td></tr>
      <tr><th>Saatgut CHF/ha</th><td></td><td></td>${M.map(m => `<td></td><td class="n">${chf(chfHa(m))}</td>`).join('')}<td colspan="5"></td></tr></tfoot></table></div>`;
  // Zwischenfrucht-Schläge des Jahres und ihre Mischung
  const ZS = rec.schlaege.filter(s => s.art === 'zwischen').sort((a, b) => ebSchlagName(a).localeCompare(ebSchlagName(b), 'de'));
  const zrows = ZS.map(s => `<tr><td>${esc(ebSchlagName(s))}</td><td class="nr">${esc(s.kultur || '')}</td><td class="n">${ebFmt(ebSchlagHa(s))}</td>
      <td><select class="input small" data-ebin="sMix" data-id="${s.id}" data-plain style="width:auto"><option value="">— keine Mischung —</option>${M.map(m => `<option value="${m.id}" ${m.id === s.mix ? 'selected' : ''}>${esc(ebMixLabel(m))}</option>`).join('')}</select></td></tr>`).join('');
  return head + `<div class="panel"><h2>Bestellung Zwischenfrüchte ${y} <small class="nr">gesät nach der Ernte ${y}</small></h2>${tab}
      <div class="btns"><button class="btn" data-eb="artNew">＋ Art</button><button class="btn" data-eb="mixNew">＋ Mischung</button></div>
      <p class="nr">kg/ha einer Art = Saatmenge rein × Anteil ÷ Summe der Anteile der Mischung. Bedarf = Σ kg/ha × Fläche der Mischung. Fläche der Mischung = Zwischenfrüchte ${y} aus der Fruchtfolge, denen sie zugeordnet ist (Mischungsname antippen für eine Fläche von Hand). Bestellung grau = Vorschlag (Restbedarf aufgerundet).</p>
      ${Z.notiz ? `<p class="nr"><b>Notiz:</b> ${esc(Z.notiz)}</p>` : ''}</div>
    <div class="panel"><h2>Zwischenfrüchte ${y} in der Fruchtfolge <small class="nr">${ZS.length} · ${fmtNum(r2(ZS.reduce((t, s) => t + (ebSchlagHa(s) || 0), 0)))} ha</small></h2>
      ${ZS.length ? `<div class="tscroll"><table class="btab"><thead><tr><th>Parzelle</th><th>Kultur</th><th class="n">ha</th><th>Mischung</th></tr></thead><tbody>${zrows}</tbody></table></div>` : `<p class="nr">In der Fruchtfolge ${y} sind noch keine Zwischenfrüchte erfasst (Feld antippen › ＋ Zwischenfrucht).</p>`}</div>`;
}
function ebArtDialog(id) {
  const rec = ebRecY(ebState().y), a = id ? rec.zf.arten.find(x => x.id === id) : null;
  const body = `<label class="fld"><span>Art / Sorte</span><input class="input" name="name" value="${esc(a ? a.name : '')}" required></label>
    <div class="two"><label class="fld"><span>Preis CHF/kg</span><input class="input" name="preis" inputmode="decimal" value="${a && a.preis != null ? a.preis : ''}"></label>
      <label class="fld"><span>Saatmenge rein kg/ha</span><input class="input" name="rein" inputmode="decimal" value="${a && a.rein != null ? a.rein : ''}"></label></div>`;
  Dlg.open(a ? esc(a.name) : 'Art hinzufügen', body, saveFooter(a ? `<button type="button" class="btn danger" data-eb="artDel" data-id="${a.id}">Entfernen</button>` : ''), fd => {
    const r = ebRecY(ebState().y), name = (fd.get('name') || '').trim(); if (!name) return false;
    if (r.zf.arten.some(x => x.id !== id && ebKey(x.name) === ebKey(name))) { toast('Diese Art gibt es schon.'); return false; }
    const o = id ? r.zf.arten.find(x => x.id === id) : { id: 'a-' + ebSlug(name), rest: null, best: null };
    Object.assign(o, { name, preis: ebNum(fd.get('preis')), rein: ebNum(fd.get('rein')) }); if (!id) r.zf.arten.push(o);
    ebSaveY(r); return true;
  });
}
function ebMixDialog(id) {
  const rec = ebRecY(ebState().y), m = id ? rec.zf.mix.find(x => x.id === id) : null, L = m ? ebMixSchlaege(rec, m) : [];
  const body = `<div class="two"><label class="fld"><span>Mischung</span><input class="input" name="name" value="${esc(m ? m.name : '')}" required placeholder="z.B. Spezial ZR"></label>
      <label class="fld"><span>Verwendung <small class="nr">frei, z.B. vor Zuckerrüben</small></span><input class="input" name="use" value="${esc(m ? m.use || '' : '')}"></label></div>
    <label class="fld"><span>Fläche ha von Hand <small class="nr">leer = aus der Fruchtfolge</small></span><input class="input" name="ha" inputmode="decimal" value="${m && m.ha != null ? m.ha : ''}" placeholder="${m ? ebFmt(ebMixHaAuto(rec, m)) : ''}"></label>
    ${m ? `<p class="nr">${L.length ? `Aus der Fruchtfolge: ${L.map(s => `${esc(ebSchlagName(s))} ${ebFmt(ebSchlagHa(s))} ha`).join(', ')}` : `Noch keinem Schlag zugeordnet – unter «Zwischenfrüchte ${rec.jahr} in der Fruchtfolge» zuordnen.`}</p>` : ''}`;
  Dlg.open(m ? `Mischung ${esc(m.name)}` : 'Mischung hinzufügen', body, saveFooter(m ? `<button type="button" class="btn danger" data-eb="mixDel" data-id="${m.id}">Entfernen</button>` : ''), fd => {
    const r = ebRecY(ebState().y), name = (fd.get('name') || '').trim(); if (!name) return false;
    const o = id ? r.zf.mix.find(x => x.id === id) : { id: uid(), anteile: {} };
    Object.assign(o, { name, use: (fd.get('use') || '').trim(), ha: ebNum(fd.get('ha')) }); if (!id) r.zf.mix.push(o);
    ebSaveY(r); return true;
  });
}
function ebZfFromPrev() {
  const y = ebState().y, prev = ebGet(y - 1); if (!prev) return;
  const rec = ebRecY(y); rec.zf = { arten: prev.zf.arten.map(a => ({ ...a, rest: null, best: null })), mix: prev.zf.mix.map(m => ({ ...m, id: uid(), ha: null, anteile: { ...m.anteile } })), notiz: '' };
  ebSaveY(rec); toast(`Arten und Mischungen aus ${y - 1} übernommen – Lager und Preise prüfen`, 4000);
}

/* ---------- Bodenproben ---------- */
function ebBodenClass(st, key, v) {
  const r = st.richt[key]; if (v == null || !r) return '';
  if (r.min != null && v < r.min) return 'bm'; if (r.max != null && v > r.max) return 'bu'; if (r.opt != null && v < r.opt) return 'bl'; return 'bo';
}
const ebBodenName = b => b.parz ? ebParzLabel(ebParz(b.parz)) || b.name || '?' : (b.name || '?');
function ebBodenView(st) {
  const S = ebState(), keys = EB_BODEN.filter(([k]) => st.boden.some(b => b.w && b.w[k] != null) || st.richt[k]), emp = EB_BODEN_EMPF.filter(([k]) => st.boden.some(b => b.w && b.w[k] != null));
  let L = st.boden.slice().sort((a, b) => ebBodenName(a).localeCompare(ebBodenName(b), 'de') || (b.jahr || 0) - (a.jahr || 0));
  if (!S.bAll) { const seen = new Set(); L = L.filter(b => { const k = b.parz || 'n:' + ebKey(b.name); if (seen.has(k)) return false; seen.add(k); return true; }); }
  const ri = k => st.richt[k] || {};
  const rows = L.map(b => `<tr class="click" data-eb="bEdit" data-id="${b.id}"><td><b>${esc(ebBodenName(b))}</b>${!b.parz ? ' <span class="warnchip" title="Keiner Parzelle zugeordnet">?</span>' : ''}</td><td class="n">${b.jahr || ''}</td><td class="c">${b.oeln ? '✓' : ''}</td>
      ${keys.map(([k]) => { const v = b.w ? b.w[k] : null; return `<td class="n eb${ebBodenClass(st, k, v)}">${v == null ? '' : fmtNum(v)}</td>`; }).join('')}${emp.map(([k]) => `<td class="n nr">${b.w && b.w[k] != null ? fmtNum(b.w[k]) : ''}</td>`).join('')}</tr>`).join('');
  return `<div class="filters vbhead" style="margin-top:12px"><label class="tog"><input type="checkbox" data-ebin="bAll" ${S.bAll ? 'checked' : ''}> alle Jahre (sonst nur die neueste Probe pro Parzelle)</label>
      <span class="spacer ebsp"></span><button class="btn" data-eb="bNew">＋ Bodenprobe</button>${st.boden.length ? '<button class="btn" data-eb="bPrint">Drucken / PDF</button>' : ''}</div>
    <div class="panel"><h2>Bodenproben <small class="nr">${st.boden.length} Proben</small></h2>
    ${st.boden.length ? `<div class="vbmatrix ebscroll"><table class="vbtab ebbt"><thead><tr><th class="vbc">Parzelle</th><th class="n">Jahr</th><th>ÖLN</th>${keys.map(([k, l, u]) => `<th class="n">${esc(l)}${u ? ` <small class="nr">${esc(u)}</small>` : ''}</th>`).join('')}${emp.map(([, l]) => `<th class="n nr" title="Empfehlung">${esc(l)}</th>`).join('')}</tr>
      <tr class="ebri"><th class="vbc nr">Richtwert min · opt · max</th><th></th><th></th>${keys.map(([k]) => `<th class="n nr">${[ri(k).min, ri(k).opt, ri(k).max].map(v => v == null ? '–' : fmtNum(v)).join(' · ')}</th>`).join('')}${emp.map(() => '<th></th>').join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="nr">Noch keine Bodenproben.</p>'}
    <p class="nr"><span class="ebleg ebbm">Mangel</span> unter min · <span class="ebleg ebbl">unter Optimum</span> · <span class="ebleg ebbo">optimal</span> · <span class="ebleg ebbu">Überschuss</span> über max. Richtwerte unter Stammdaten anpassbar. Zeile antippen zum Bearbeiten.</p></div>`;
}
function ebBodenDialog(id) {
  const st = ebStamm(), b = id ? structuredClone(st.boden.find(x => x.id === id)) : { id: uid(), parz: '', name: '', jahr: ebCurYear(), labor: 'Kinsey', oeln: false, w: {}, notiz: '' };
  if (!b) return; b.w = b.w || {};
  const P = ebParzSorted(true);
  const inp = ([k, l, u]) => `<label class="fld"><span>${esc(l)}${u ? ` <small class="nr">${esc(u)}</small>` : ''}</span><input class="input" name="w_${k}" inputmode="decimal" value="${b.w[k] ?? ''}"></label>`;
  const body = `<div class="three"><label class="fld"><span>Parzelle</span><select class="input" name="parz" data-plain><option value="">— ohne Zuordnung —</option>${P.map(p => `<option value="${p.id}" ${p.id === b.parz ? 'selected' : ''}>${esc(ebParzLabel(p))}</option>`).join('')}</select></label>
      <label class="fld"><span>Probejahr</span><input class="input" name="jahr" inputmode="numeric" value="${b.jahr ?? ''}"></label>
      <label class="fld"><span>Labor</span><input class="input" name="labor" value="${esc(b.labor || '')}"></label></div>
    ${!b.parz && b.name ? `<label class="fld"><span>Bezeichnung (aus dem Import)</span><input class="input" name="name" value="${esc(b.name)}"></label>` : ''}
    <label class="tog"><input type="checkbox" name="oeln" ${b.oeln ? 'checked' : ''}> ÖLN-Probe</label>
    <div class="ebbgrid">${EB_BODEN.map(inp).join('')}</div>
    <h4 style="margin:10px 0 4px">Empfehlungen</h4><div class="ebbgrid">${EB_BODEN_EMPF.map(([k, l]) => inp([k, l, ''])).join('')}</div>
    <label class="fld"><span>Bemerkung</span><input class="input" name="notiz" value="${esc(b.notiz || '')}"></label>`;
  Dlg.open(id ? `Bodenprobe ${esc(ebBodenName(b))} ${b.jahr || ''}` : 'Bodenprobe erfassen', body, saveFooter(id ? `<button type="button" class="btn danger" data-eb="bDel" data-id="${b.id}">Löschen</button>` : ''), fd => {
    const s2 = ebStamm(); b.parz = fd.get('parz') || ''; b.name = b.parz ? (b.name || '') : ((fd.get('name') ?? b.name) || '').trim(); b.jahr = ebNum(fd.get('jahr'));
    b.labor = (fd.get('labor') || '').trim(); b.oeln = !!fd.get('oeln'); b.notiz = (fd.get('notiz') || '').trim();
    b.w = {}; [...EB_BODEN, ...EB_BODEN_EMPF].forEach(([k]) => { const v = ebNum(fd.get('w_' + k)); if (v != null) b.w[k] = v; });
    if (!b.parz && !b.name) { toast('Parzelle wählen.'); return false; }
    const i = s2.boden.findIndex(x => x.id === b.id); if (i >= 0) s2.boden[i] = b; else s2.boden.push(b);
    ebSaveS(s2); return true;
  });
}

/* ---------- Stammdaten ---------- */
const EB_STSUBS = [['parzellen', 'Parzellen'], ['kulturen', 'Kulturen'], ['listen', 'Adresse & Listen'], ['richt', 'Richtwerte Bodenproben']];
function ebStammView(st) {
  const S = ebState(), sub = EB_STSUBS.some(([k]) => k === S.stSub) ? S.stSub : 'parzellen';
  const nav = `<div class="seg mini ebstnav">${EB_STSUBS.map(([k, l]) => `<button type="button" data-eb="stSub" data-v="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (sub === 'parzellen') return nav + ebParzView(st);
  const K = st.kulturen.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const used = new Set(ebYears().flatMap(y => ebGet(y).schlaege.map(s => s.kultur)));
  const nUse = k => [...used].filter(x => ebKultur(x) === k).length;
  const kult = `<div class="panel" style="margin-top:12px"><h2>Kulturen <small class="nr">Farbe, N-Bedarf, Anbaupause, Dauerkultur</small></h2>
      <div class="tscroll"><table class="need vbneed"><thead><tr><th>Kultur</th><th title="Farbe in Fruchtfolge und Auswertungen">Farbe</th><th class="n">N-Bedarf kg/ha (GRUDAF)</th><th class="n">Anbaupause Jahre</th><th title="Dauerkultur: wird jedes Jahr automatisch weitergeführt">Dauerkultur</th><th></th></tr></thead><tbody>
      ${K.map(k => `<tr><td><input class="vbin wide" data-ebin="kName" data-id="${k.id}" data-ebk="kn-${k.id}" value="${esc(k.name)}"></td>
        <td class="nowrap"><input type="color" class="ebcol" data-ebin="kFarbe" data-id="${k.id}" value="${esc(k.farbe || ebAutoColor(k.name))}" title="Farbe wählen">${k.farbe ? ` <button type="button" class="x ebcolx" data-eb="kFarbeReset" data-id="${k.id}" title="Standardfarbe" aria-label="Standardfarbe">↺</button>` : ''}</td>
        <td class="n"><input class="vbin" inputmode="decimal" data-ebin="kN" data-id="${k.id}" data-ebk="kv-${k.id}" value="${k.n ?? ''}"></td>
        <td class="n"><input class="vbin" inputmode="numeric" data-ebin="kPause" data-id="${k.id}" data-ebk="kp-${k.id}" value="${k.pause ?? ''}" placeholder="–"></td>
        <td class="c"><input type="checkbox" data-ebin="kDauer" data-id="${k.id}" ${k.dauer ? 'checked' : ''} title="Dauerkultur (z.B. Naturwiese, Weide)"></td>
        <td>${nUse(k) ? '' : `<button type="button" class="x" data-eb="kDel" data-id="${k.id}" aria-label="Entfernen">×</button>`}</td></tr>`).join('')}</tbody></table></div>
      <div class="btns"><button class="btn" data-eb="kNew">＋ Kultur</button></div>
      <p class="nr">«Weizen» und «Winterweizen» gelten als gleiche Kultur, «Sommerhafer» rechnet mit «Hafer». Anbaupause: Die Fruchtfolge warnt (⚠), wenn die Kultur innerhalb dieser Anzahl Jahre schon auf derselben Parzelle stand. Dauerkultur: wird in der Fruchtfolge jedes Jahr automatisch weitergeführt (↻), bis du beim Eintrag «weiterführen» ausschaltest oder eine andere Kultur erfasst. Farbe: antippen zum Ändern, ↺ = Standardfarbe.</p></div>`;
  if (sub === 'kulturen') return nav + kult;
  if (sub === 'richt') return nav + `<div class="panel" style="margin-top:12px"><h2>Richtwerte Bodenproben</h2>
      <div class="tscroll"><table class="need vbneed"><thead><tr><th>Wert</th><th class="n">min</th><th class="n">optimal</th><th class="n">max</th><th>Zielwert</th></tr></thead><tbody>
      ${EB_BODEN.map(([k, l, u]) => { const r = st.richt[k] || {}; return `<tr><td>${esc(l)} <span class="nr">${esc(u)}</span></td>${['min', 'opt', 'max'].map(f => `<td class="n"><input class="vbin" inputmode="decimal" data-ebin="ri" data-k="${k}" data-f="${f}" data-ebk="ri-${k}-${f}" value="${r[f] ?? ''}"></td>`).join('')}
        <td><input class="vbin wide" data-ebin="ri" data-k="${k}" data-f="ziel" data-ebk="ri-${k}-z" value="${esc(r.ziel || '')}"></td></tr>`; }).join('')}</tbody></table></div></div>`;
  return nav + `<div class="cols" style="margin-top:12px"><div>
    <div class="panel"><h2>Betriebsadresse</h2><p>Erscheint oben rechts auf allen Ausdrucken und PDF im Bereich Betrieb (ohne Logo). Leer = Adresse des Kunden ${esc(ebKunde() ? ebKunde().name : 'des eigenen Betriebs')}.</p>
      <textarea class="input" rows="4" data-ebin="adresse" placeholder="${esc(ebAdresse())}">${esc(st.adresse || '')}</textarea></div>
    <div class="panel"><h2>Zwischenfrüchte</h2><p>Auswahl für Zwischenfrüchte in der Fruchtfolge, zusätzlich zu den Mischungen der Bestellung. Eine pro Zeile. Individuelle Zwischenfrüchte, die du direkt in der Fruchtfolge eingibst, kommen nicht in diese Liste.</p>
      <textarea class="input" rows="10" data-ebin="zfListe">${esc((st.zfListe || []).join('\n'))}</textarea></div></div>
    <div><div class="panel"><h2>Programme</h2><p>Auswahl in der Düngungsplanung (Extenso, IP-Suisse, Ressourcenprogramme …). Ein Programm pro Zeile.</p>
      <textarea class="input" rows="10" data-ebin="prog">${esc(st.programme.join('\n'))}</textarea></div></div></div>`;
}
function ebKulturDialog() {
  const body = `<label class="fld"><span>Kultur</span><input class="input" name="name" required></label>
    <div class="two"><label class="fld"><span>N-Bedarf kg/ha (GRUDAF)</span><input class="input" name="n" inputmode="decimal"></label><label class="fld"><span>Anbaupause Jahre</span><input class="input" name="pause" inputmode="numeric"></label></div>`;
  smallDialog('Kultur hinzufügen', body, 'Hinzufügen', fd => {
    const st = ebStamm(), name = (fd.get('name') || '').trim(); if (!name) return false;
    if (st.kulturen.some(k => ebKey(k.name) === ebKey(name))) { toast('Diese Kultur gibt es schon.'); return false; }
    st.kulturen.push({ id: 'k-' + ebSlug(name), name, n: ebNum(fd.get('n')), pause: ebNum(fd.get('pause')) }); ebSaveS(st);
  });
}

/* ================= Modul ein-/ausschalten (Mehr › Einstellungen) ================= */
function ebPanel() {
  return `<div class="panel"><h2>Eigener Betrieb</h2>
    <label class="tog"><input type="checkbox" data-ebin="on" ${ebOn() ? 'checked' : ''}> Modul «Eigener Betrieb» (Fruchtfolge, Düngung, Zwischenfrüchte, Bodenproben) in der Navigation anzeigen</label>
    <p class="nr" style="margin:6px 0 0">Planung der eigenen Flächen – ersetzt die Excel-Mappe «Düngungs- und Anbauplanung». Ausgeschaltet bleiben alle Daten gespeichert. Gilt für alle Geräte.</p></div>`;
}
function ebNav() {
  const b = $('#tabs [data-view="betrieb"]'); if (b) b.hidden = !ebOn();
  const t = $('#tabs'); if (t) t.style.setProperty('--n', $$('#tabs button:not([hidden])').length);
}

/* ================= Verknüpfung mit dem Modul Spritzen ================= */
// Spritzauftrag für den eigenen Betrieb: Fläche aus der Fruchtfolge des Erntejahres wählen → Kultur, Fläche, Feld.
// Der Auftrag merkt sich den Schlag (ebSchlag, ebJahr); in der Fruchtfolge erscheint er beim Schlag (🧪).
const ebIsOwn = kid => ebOn() && !!kid && !!ebKunde() && ebKunde().id === kid;
const ebSchlagById = (y, id) => id && ebGet(y) ? ebGet(y).schlaege.find(s => s.id === id) : null;
function ebSprayHtml(a) {
  return `<div class="ebspray" id="ebSprayF" hidden><label class="fld"><span>🌾 Fläche aus der Fruchtfolge <span class="nr" id="ebSprayY"></span></span>
    <select class="input" name="ebSchlag" data-plain data-cur="${esc(a.ebSchlag || '')}"><option value="">— keine —</option></select></label>
    <div class="nr" id="ebSprayHint"></div></div>`;
}
function ebSprayOpts(y, cur) {
  const rec = ebGet(y), pos = new Map(ebParzSorted(true).map((p, i) => [p.id, i]));
  const L = rec ? rec.schlaege.filter(s => s.parz && s.art !== 'zwischen').sort((a, b) => (pos.get(a.parz) ?? 999) - (pos.get(b.parz) ?? 999)) : [];
  const Z = rec ? rec.schlaege.filter(s => s.parz && s.art === 'zwischen') : [];
  const o = s => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(ebSchlagName(s))} · ${esc(s.kultur || '?')}${ebSchlagHa(s) != null ? ' · ' + fmtNum(ebSchlagHa(s)) + ' ha' : ''}</option>`;
  return `<option value="">— keine —</option>${L.map(o).join('')}${Z.length ? `<optgroup label="Zwischenfrüchte">${Z.map(o).join('')}</optgroup>` : ''}`;
}
function ebWireSpray(f) {
  const box = $('#ebSprayF', f); if (!box || !f.ebSchlag) return;
  const sel = f.ebSchlag, hint = $('#ebSprayHint', box);
  const year = () => num(f.erntejahr.value) || num(f.erntejahr.placeholder) || ebCurYear();
  const refresh = () => {
    const k = findKunde(f.kunde.value);
    box.hidden = !(k && ebIsOwn(k.id)); if (box.hidden) return;
    const y = year(), cur = sel.value || sel.dataset.cur || ''; sel.innerHTML = ebSprayOpts(y, cur);
    $('#ebSprayY', box).textContent = `(Erntejahr ${y})`;
    hint.textContent = ebGet(y) ? '' : `In der Fruchtfolge ${y} ist noch nichts erfasst.`;
  };
  const setKultur = k => { if (!k || !f.kultur) return; if (![...f.kultur.options].some(o => o.value === k)) f.kultur.insertAdjacentHTML('beforeend', `<option>${esc(k)}</option>`); f.kultur.value = k; f.kultur.dispatchEvent(new Event('change', { bubbles: true })); };
  const apply = () => {
    const s = ebSchlagById(year(), sel.value); sel.dataset.cur = sel.value; if (!s) return;
    const p = ebParz(s.parz);
    setKultur(s.kultur);
    if (ebSchlagHa(s) != null) { f.flaeche.value = ebSchlagHa(s); f.flaeche.dispatchEvent(new Event('input', { bubbles: true })); }
    if (p) { f.feld.value = ebParzLabel(p); if (p.feld && f.kfeld && [...f.kfeld.options].some(o => o.value === p.feld)) { f.kfeld.value = p.feld; } }
    hint.textContent = `Kultur, Fläche und Feld aus der Fruchtfolge übernommen${s.sorte ? ` · Sorte ${s.sorte}` : ''}.`;
  };
  sel.addEventListener('change', apply);
  // Feld (MyJohnDeere) gewählt: passenden Schlag vorschlagen, wenn eindeutig
  if (f.kfeld) f.kfeld.addEventListener('change', () => {
    if (box.hidden || sel.value) return; const rec = ebGet(year()); if (!rec) return;
    const L = rec.schlaege.filter(s => s.art !== 'zwischen' && (ebParz(s.parz) || {}).feld === f.kfeld.value);
    if (L.length === 1) { sel.value = L[0].id; apply(); }
  });
  f.kunde.addEventListener('input', refresh); f.erntejahr.addEventListener('input', refresh);
  f.addEventListener('change', e => { if (['datum', 'wunsch'].includes(e.target.name)) setTimeout(refresh, 0); });
  refresh();
}
function ebReadSpray(f) {
  const box = f && $('#ebSprayF', f); if (!box || box.hidden || !f.ebSchlag || !f.ebSchlag.value) return { ebSchlag: '', ebJahr: null };
  return { ebSchlag: f.ebSchlag.value, ebJahr: num(f.erntejahr.value) || num(f.erntejahr.placeholder) || ebCurYear() };
}
// Spritzaufträge eines Schlags: verknüpft, sonst eigener Betrieb + gleiches Feld + gleiches Erntejahr
function ebSprayOrders(y, s) {
  const k = ebKunde(); if (!k || typeof isSpray !== 'function') return [];
  const p = ebParz(s.parz);
  return Store.all('auftraege').filter(a => isSpray(a) && (a.ebSchlag ? a.ebSchlag === s.id :
    (s.art !== 'zwischen' && a.kunde === k.id && p && p.feld && a.kfeld === p.feld && ernteOf(a) === y && (!a.kultur || ebSameKultur(a.kultur, s.kultur)))))
    .sort((a, b) => String(a.erledigtAm || a.datum || a.wunsch || '').localeCompare(String(b.erledigtAm || b.datum || b.wunsch || '')));
}
// Anzahl Spritzaufträge pro Schlag (für die Fruchtfolge-Übersicht)
function ebSprayIndex(years) {
  const k = ebKunde(), out = new Map(); if (!k || typeof isSpray !== 'function') return out;
  const recs = Object.fromEntries(years.map(y => [y, ebGet(y)]));
  Store.all('auftraege').forEach(a => {
    if (!isSpray(a)) return; let s = null;
    if (a.ebSchlag) { const r = recs[a.ebJahr] || null; s = r ? r.schlaege.find(x => x.id === a.ebSchlag) : null; if (!s) years.some(y => recs[y] && (s = recs[y].schlaege.find(x => x.id === a.ebSchlag))); }
    else if (a.kunde === k.id && a.kfeld) { const r = recs[ernteOf(a)]; if (r) s = r.schlaege.find(x => x.art !== 'zwischen' && (ebParz(x.parz) || {}).feld === a.kfeld && (!a.kultur || ebSameKultur(a.kultur, x.kultur))); }
    if (s) out.set(s.id, (out.get(s.id) || 0) + 1);
  });
  return out;
}
function ebSprayList(y, s) {
  const L = ebSprayOrders(y, s); if (!L.length) return '';
  return `<div class="box"><h4>🧪 Pflanzenschutz ${y} <small class="nr">${L.length} ${L.length === 1 ? 'Auftrag' : 'Aufträge'}</small></h4><div class="rows">${L.map(a => { const st = statusOf(a), d = a.erledigtAm || a.datum || a.wunsch;
    return `<div class="rowi" data-act="editOrder" data-id="${a.id}"><span class="badge ${st}">${esc(STATUS[st])}</span><div class="grow"><div class="t">${d ? esc(fmtDate(d, { day: '2-digit', month: '2-digit', year: '2-digit' })) : 'ohne Datum'}${a.stadium ? ' · ' + esc(a.stadium) : ''}</div><div class="s">${esc(prodList(a).map(x => `${x.name}${x.menge != null ? ' ' + fmtNum(x.menge) + ' ' + (x.einheit || '') + '/ha' : ''}`).join(', ') || '—')}</div></div></div>`; }).join('')}</div></div>`;
}

/* ================= Ereignisse ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-eb]'); if (!t) return;
  const a = t.dataset.eb, id = t.dataset.id, S = ebState(); e.preventDefault(); e.stopPropagation();
  switch (a) {
    case 'sub': S.sub = t.dataset.v; ls('lp_ebSub', S.sub); App.render(); break;
    case 'stSub': S.stSub = t.dataset.v; ls('lp_ebStSub', S.stSub); App.render(); break;
    case 'dSub': S.dSub = t.dataset.v; ls('lp_ebDSub', S.dSub); App.render(); break;
    case 'kFarbeReset': { const st = ebStamm(), ku = st.kulturen.find(x => x.id === id); if (ku) { delete ku.farbe; ebSaveS(st); } break; }
    case 'off': if (confirm('Modul «Eigener Betrieb» ausblenden? Die Daten bleiben gespeichert; einschalten unter Mehr › Einstellungen.')) { Store.setCfg({ ebOn: false }); App.go('auftraege'); } break;
    case 'start': { const st = ebStammBlank(); const k = ebKunde(); if (k) st.kunde = k.id; ebSaveS(st); S.sub = 'stamm'; S.stSub = 'parzellen'; break; }
    // Parzellen
    case 'parzNew': ebParzDialog(null); break;
    case 'parzEdit': ebParzDialog(id); break;
    case 'parzDel': { const st = ebStamm(), p = st.parz.find(x => x.id === id); if (!p) break;
      const n = ebYears().reduce((t2, y) => t2 + ebGet(y).schlaege.filter(s => s.parz === id).length, 0) + st.boden.filter(b => b.parz === id).length;
      if (n) { toast(`«${ebParzLabel(p)}» wird in ${n} Einträgen verwendet – stattdessen inaktiv setzen oder zusammenführen.`, 5000); break; }
      if (confirm(`Parzelle «${ebParzLabel(p)}» löschen?`)) { st.parz = st.parz.filter(x => x.id !== id); ebSaveS(st); Dlg.close(); } break; }
    case 'parzMerge': { const to = Dlg.form.merge && Dlg.form.merge.value; if (!to) { toast('Zuerst die Ziel-Parzelle wählen.'); break; } ebParzMerge(id, to); break; }
    case 'parzLink': { const st = ebStamm(), p = st.parz.find(x => x.id === id); if (!p) break; p.feld = t.dataset.f; ebSaveS(st); toast(`${ebParzLabel(p)} ↦ ${(feldById(p.feld) || {}).name || ''}`); break; }
    case 'parzLinkAll': { const st = ebStamm(), G = ebFeldGuessAll(st); let n = 0;
      Object.entries(G).forEach(([pid, f]) => { st.parz.find(x => x.id === pid).feld = f.id; n++; });
      ebSaveS(st); toast(`${n} Parzellen mit Feldern verknüpft`); break; }
    case 'feldImport': ebFeldImportDialog(); break;
    // Fruchtfolge
    case 'ffShift': S.ffEnd += +t.dataset.d; App.render(); break;
    case 'ffCell': ebCellDialog(+t.dataset.y, t.dataset.p || '', t.dataset.n || ''); break;
    case 'sNew': ebSchlagDialog(+t.dataset.y, null, Object.assign({ parz: t.dataset.p || '', name: t.dataset.p ? '' : t.dataset.n || '', art: t.dataset.art || 'haupt' }, t.dataset.nach ? { nach: t.dataset.nach } : {})); break;
    case 'sEdit': ebSchlagDialog(+t.dataset.y, id); break;
    case 'sDel': { const y = +t.dataset.y, rec = ebRecY(y), s = rec.schlaege.find(x => x.id === id); if (!s) break;
      const Z = s.art !== 'zwischen' ? rec.schlaege.filter(z => z.nach === s.id) : [], prevD = s.art !== 'zwischen' && ebGet(y - 1) && ebGet(y - 1).schlaege.some(x => x.parz === s.parz && s.parz && x.art !== 'zwischen' && !x.ende && ebIsDauer(x.kultur));
      if (!confirm(`${s.kultur || 'Eintrag'} auf ${ebSchlagName(s)} (${y}) löschen?${Z.length ? ` Die Zwischenfrucht ${Z.map(z => z.kultur).join(', ')} wird mitgelöscht.` : ''}${(s.gaben || []).length || Z.some(z => (z.gaben || []).length) ? ' Die geplanten Gaben gehen verloren.' : ''}${prevD ? ` Die Dauerkultur aus ${y - 1} gilt damit als umgebrochen und wird nicht mehr weitergeführt.` : ''}`)) break;
      rec.schlaege = rec.schlaege.filter(x => x.id !== id && !Z.includes(x)); if (prevD) ebDauerEnde(y, s.parz); ebSaveY(rec); Dlg.close(); break; }
    case 'ffPrint': ebFfPrintDialog(); break;
    case 'parzMove': ebParzMove(id, +t.dataset.d); break;
    // Düngung
    case 'dNew': ebDuengerDialog(); break;
    case 'dDel': { const rec = ebRecY(S.y); rec.duenger = rec.duenger.filter(d => d.id !== id); ebSaveY(rec); break; }
    case 'dFromPrev': ebDFromPrev(); break;
    case 'gFromPrev': ebGFromPrev(); break;
    case 'dPrint': ebDPrint(); break;
    case 'xlsx': ebXlsx(); break;
    // Zwischenfrüchte
    case 'zfFromPrev': ebZfFromPrev(); break;
    case 'artNew': ebArtDialog(null); break;
    case 'artEdit': ebArtDialog(id); break;
    case 'artDel': { const rec = ebRecY(S.y), x = rec.zf.arten.find(z => z.id === id); if (!x || !confirm(`«${x.name}» entfernen? Die Anteile in den Mischungen gehen verloren.`)) break;
      rec.zf.arten = rec.zf.arten.filter(z => z.id !== id); rec.zf.mix.forEach(m => { if (m.anteile) delete m.anteile[id]; }); ebSaveY(rec); Dlg.close(); break; }
    case 'mixNew': ebMixDialog(null); break;
    case 'mixEdit': ebMixDialog(id); break;
    case 'mixDel': { const rec = ebRecY(S.y), m = rec.zf.mix.find(z => z.id === id); if (!m || !confirm(`Mischung «${m.name}» entfernen?`)) break;
      rec.zf.mix = rec.zf.mix.filter(z => z.id !== id); rec.schlaege.forEach(s => { if (s.mix === id) s.mix = ''; }); ebSaveY(rec); Dlg.close(); break; }
    case 'zfPrint': ebZfPrint(); break;
    // Bodenproben
    case 'bNew': ebBodenDialog(null); break;
    case 'bEdit': ebBodenDialog(id); break;
    case 'bDel': { const st = ebStamm(); if (!confirm('Bodenprobe löschen?')) break; st.boden = st.boden.filter(b => b.id !== id); ebSaveS(st); Dlg.close(); break; }
    case 'bPrint': ebBPrint(); break;
    // Stammdaten
    case 'kNew': ebKulturDialog(); break;
    case 'kDel': { const st = ebStamm(); st.kulturen = st.kulturen.filter(k => k.id !== id); ebSaveS(st); break; }
  }
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-ebin]'); if (!t) return;
  const k = t.dataset.ebin, v = t.value, n = ebNum(v), S = ebState(), id = t.dataset.id;
  if (k === 'on') { Store.setCfg({ ebOn: t.checked }); ebNav(); toast(t.checked ? 'Modul «Eigener Betrieb» eingeschaltet' : 'Modul «Eigener Betrieb» ausgeblendet'); return; }
  if (k === 'import') { const f = t.files && t.files[0]; t.value = ''; if (f) ebImportFile(f); return; }
  if (k === 'year') { S.y = +v; App.render(); return; }
  if (k === 'ffSum') { S.ffSum = t.checked; App.render(); return; }
  if (k === 'bAll') { S.bAll = t.checked; App.render(); return; }
  if (k === 'showOff') { S.showOff = t.checked; ls('lp_ebShowOff', t.checked ? '1' : '0'); App.render(); return; }
  // Stammdaten
  if (['kunde', 'kName', 'kN', 'kPause', 'kDauer', 'kFarbe', 'prog', 'ri', 'adresse', 'zfListe'].includes(k)) {
    const st = ebStamm(), ku = st.kulturen.find(x => x.id === id);
    if (k === 'kunde') st.kunde = v;
    else if (k === 'kName') { if (ku && v.trim()) ku.name = v.trim(); }
    else if (k === 'kN') { if (ku) ku.n = n; }
    else if (k === 'kPause') { if (ku) ku.pause = n ? Math.round(n) : null; }
    else if (k === 'kDauer') { if (ku) ku.dauer = t.checked; }
    else if (k === 'kFarbe') { if (ku) ku.farbe = v; }
    else if (k === 'zfListe') st.zfListe = [...new Set(v.split(/\n|;/).map(x => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    else if (k === 'adresse') st.adresse = v.trim();
    else if (k === 'prog') st.programme = [...new Set(v.split(/\n|;/).map(x => x.trim()).filter(Boolean))];
    else if (k === 'ri') { const r = st.richt[t.dataset.k] || (st.richt[t.dataset.k] = {}); r[t.dataset.f] = t.dataset.f === 'ziel' ? v.trim() : n; }
    ebSaveS(st); return;
  }
  // Jahr
  const rec = ebRecY(S.y), d = rec.duenger.find(x => x.id === id), a = rec.zf.arten.find(x => x.id === id);
  switch (k) {
    case 'dName': if (d && v.trim()) d.name = v.trim(); break;
    case 'dEinh': if (d) d.einheit = v.trim(); break;
    case 'dN': if (d) d.n = n; break;
    case 'dVorrat': if (d) d.vorrat = n; break;
    case 'dZuf': if (d) d.zufuhr = t.checked; break;
    case 'abzug': rec.abzug = n; break;
    case 'maxN': rec.maxN = n; break;
    case 'aPreis': if (a) a.preis = n; break;
    case 'aRein': if (a) a.rein = n; break;
    case 'aRest': if (a) a.rest = n; break;
    case 'aBest': if (a) a.best = v.trim() === '' ? null : n; break;
    case 'anteil': { const m = rec.zf.mix.find(x => x.id === t.dataset.m); if (!m) return; m.anteile = m.anteile || {}; if (n) m.anteile[id] = n; else delete m.anteile[id]; break; }
    case 'sMix': { const s = rec.schlaege.find(x => x.id === id); if (s) s.mix = v; break; }
    default: return;
  }
  ebSaveY(rec);
});

/* ================= Drucken & Excel ================= */
// Kopf der Ausdrucke im Bereich Betrieb: Betriebsadresse aus den Stammdaten (kein Logo)
function ebAdresse() {
  const st = ebStamm(); if ((st.adresse || '').trim()) return st.adresse.trim();
  const k = ebKunde(); return k ? [k.name, k.adresse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join('\n') : '';
}
const ebPrintHead = title => `<div class="ebphead"><h1 class="ptitle">${esc(title)}</h1>${ebAdresse() ? `<div class="ebaddr">${ebAdresse().split('\n').map(esc).join('<br>')}</div>` : ''}</div>`;
// Fruchtfolgerapport: Jahre und Umfang vor dem Drucken wählen (bleibt auf dem Gerät gespeichert)
function ebFfPrintDialog() {
  const S = ebState(), n = +(ls('lp_ebPrN') || EB_FF_N), end = S.ffEnd, ys = ebYears();
  const body = `<div class="two"><label class="fld"><span>Anzahl Jahre</span><input class="input" name="n" inputmode="numeric" value="${n}"></label>
      <label class="fld"><span>bis und mit Jahr</span><input class="input" name="bis" inputmode="numeric" value="${end}"></label></div>
    <p class="nr" style="margin-top:0">Erfasst sind ${ys.length ? `${Math.min(...ys)}–${Math.max(...ys)}` : 'noch keine Jahre'}. Ab 8 Jahren wird quer gedruckt.</p>
    <label class="tog"><input type="checkbox" name="zw" ${ls('lp_ebPrZw') !== '0' ? 'checked' : ''}> Zwischenfrüchte mitdrucken</label><br>
    <label class="tog"><input type="checkbox" name="off" ${S.showOff ? 'checked' : ''}> inaktive Parzellen mitdrucken</label>`;
  smallDialog('Fruchtfolgerapport drucken', body, 'Drucken / PDF', fd => {
    const nn = Math.max(1, Math.min(30, Math.round(ebNum(fd.get('n')) || EB_FF_N))), bis = Math.round(ebNum(fd.get('bis')) || end);
    ls('lp_ebPrN', String(nn)); ls('lp_ebPrZw', fd.get('zw') ? '1' : '0');
    setTimeout(() => ebFfPrint(bis - nn + 1, bis, !!fd.get('zw'), !!fd.get('off')), 50);
  });
}
function ebFfPrint(von, bis, mitZw = true, mitOff = false) {
  const years = Array.from({ length: bis - von + 1 }, (_, i) => von + i);
  const L = (y, f) => ebGet(y) ? ebGet(y).schlaege.filter(f) : [];
  const P = ebParzSorted(true).filter(p => p.aktiv !== false ? true : mitOff && years.some(y => L(y, s => s.parz === p.id).length));
  const ha = s => { const v = ebSchlagHa(s); return v != null ? ` <span class="ebpha">${fmtNum(v)}</span>` : ''; };
  const cell = (y, A) => A.filter(s => mitZw || s.art !== 'zwischen').map(s => s.art === 'zwischen' ? `<i>↳ ${esc(s.kultur || '?')}${ha(s)}</i>` : `<b>${esc(s.kultur || '?')}</b>${ha(s)}`).join('<br>');
  const fs = years.length > 12 ? 6.5 : years.length > 9 ? 7 : 8;
  const html = `<table class="btab ebpt" style="font-size:${fs}pt"><thead><tr><th>Parzelle</th><th class="n">ha</th>${years.map(y => `<th>${y}</th>`).join('')}</tr></thead><tbody>
    ${P.map(p => `<tr><td>${esc(ebParzLabel(p))}</td><td class="n">${ebFmt(ebParzHa(p))}</td>${years.map(y => `<td>${cell(y, L(y, s => s.parz === p.id))}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="nr">Kultur mit Fläche in ha${mitZw ? ' · ↳ = Zwischenfrucht nach der Hauptkultur' : ''}</p>`;
  printHtml(`Fruchtfolge ${von}–${bis}`, `<div class="${years.length >= 8 ? 'ebland' : ''}">${ebPrintHead(`Fruchtfolgerapport ${von}–${bis}`)}${html}</div>`, { noTitle: true });
}
function ebDPrint() {
  const y = ebState().y, rec = ebRecY(y), B = ebBilanz(rec);
  const L = rec.schlaege.slice().sort((a, b) => ((a.art === 'zwischen') - (b.art === 'zwischen')) || String(a.kultur).localeCompare(String(b.kultur), 'de') || ebSchlagName(a).localeCompare(ebSchlagName(b), 'de'));
  const rows = L.map(s => { const c = ebSchlagCalc(rec, s);
    return `<tr><td>${esc(s.kultur)}</td><td>${esc(ebSchlagName(s))}</td><td class="n">${ebFmt(c.ha)}</td><td>${esc(ebVorkultur(rec, s))}</td><td class="n">${ebFmt(c.bed)}</td><td class="n">${s.korr ? fmtNum(s.korr) : ''}</td><td class="n">${ebFmt(c.geplant)}</td><td class="n"><b>${ebFmt(c.rest)}</b></td>
      <td>${(s.gaben || []).map(g => { const d = ebDuenger(rec, g.d); return `${esc(d ? d.name : '?')} ${fmtNum(g.menge)} ${esc(d ? d.einheit || '' : '')}${g.datum ? ' (' + esc(ebDatum(g.datum)) + ')' : ''}`; }).join('<br>')}</td><td>${esc(s.sorte || '')}</td><td>${esc((s.prog || []).join(', '))}</td></tr>`; }).join('');
  const lag = ebLager(rec).map(({ d, bedarf, saldo, zufuhr }) => `<tr><td>${esc(d.name)}</td><td class="n">${ebFmt(d.n)}</td><td>${esc(d.einheit || '')}</td><td class="n">${ebFmt(d.vorrat)}</td><td class="n">${ebFmt(bedarf)}</td><td class="n">${ebFmt(saldo)}</td><td class="n">${zufuhr != null ? fmtNum(zufuhr) : ''}</td></tr>`).join('');
  printHtml(`Düngungsplanung ${y}`, '<div class="ebland">' + ebPrintHead(`Düngungsplanung ${y}`) + `
    <table class="btab ebpt"><thead><tr><th>Kultur</th><th>Parzelle</th><th class="n">ha</th><th>Vorkultur</th><th class="n">Bedarf N</th><th class="n">±</th><th class="n">geplant</th><th class="n">Rest</th><th>Gaben pro ha</th><th>Sorte</th><th>Programme</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>Dünger & Lager</h2><table class="btab"><thead><tr><th>Dünger</th><th class="n">kg N/Einh.</th><th>Einheit</th><th class="n">Vorrat</th><th class="n">Bedarf</th><th class="n">Saldo</th><th class="n">N-Zufuhr</th></tr></thead><tbody>${lag}</tbody></table>
    <p>Geplante Zufuhr ${fmtNum(B.total)} kg N · Abzug Schleppschlauch ${fmtNum(B.abzug || 0)} kg N · Maximale Zufuhr ${B.max != null ? fmtNum(B.max) + ' kg N' : '–'} · <b>Reserve ${B.reserve != null ? fmtNum(B.reserve) + ' kg N' : '–'}</b></p></div>`, { noTitle: true });
}
function ebZfPrint() {
  const y = ebState().y, rec = ebRecY(y), N = ebZfNeed(rec), M = rec.zf.mix, kg = Object.fromEntries(M.map(m => [m.id, ebMixKg(rec, m)]));
  const mixT = `<table class="btab"><thead><tr><th>Art</th>${M.map(m => `<th class="n">${esc(ebMixLabel(m))}<br>${ebFmt(ebMixHa(rec, m))} ha · kg/ha</th>`).join('')}</tr></thead><tbody>
    ${rec.zf.arten.filter(a => M.some(m => kg[m.id][a.id])).map(a => `<tr><td>${esc(a.name)}</td>${M.map(m => `<td class="n">${ebFmt(kg[m.id][a.id])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const best = `<table class="btab"><thead><tr><th>Art</th><th class="n">Preis CHF/kg</th><th class="n">Bedarf kg</th><th class="n">Lager kg</th><th class="n">Restbedarf</th><th class="n">Bestellung kg</th><th class="n">Betrag CHF</th></tr></thead><tbody>
    ${N.filter(x => x.bedarf || x.best).map(x => `<tr><td>${esc(x.a.name)}</td><td class="n">${x.a.preis != null ? chf(x.a.preis) : ''}</td><td class="n">${ebFmt(x.bedarf)}</td><td class="n">${ebFmt(x.a.rest)}</td><td class="n">${ebFmt(x.rest)}</td><td class="n"><b>${fmtNum(x.best)}</b></td><td class="n">${x.betrag ? chf(x.betrag) : ''}</td></tr>`).join('')}
    <tr class="gp"><td colspan="6"><b>Total</b></td><td class="n"><b>${chf(r2(N.reduce((t, x) => t + (x.betrag || 0), 0)))}</b></td></tr></tbody></table>`;
  printHtml(`Zwischenfrüchte ${y}`, '<div class="ebhoch">' + ebPrintHead(`Bestellung Zwischenfrüchte ${y}`) + best + '<h2>Mischungen</h2>' + mixT + '</div>', { noTitle: true });
}
function ebBPrint() {
  const st = ebStamm(), keys = EB_BODEN.filter(([k]) => st.boden.some(b => b.w && b.w[k] != null));
  const L = st.boden.slice().sort((a, b) => ebBodenName(a).localeCompare(ebBodenName(b), 'de') || (b.jahr || 0) - (a.jahr || 0));
  printHtml('Bodenproben', '<div class="ebland">' + ebPrintHead('Bodenproben') + `<table class="btab ebpt"><thead><tr><th>Parzelle</th><th>Jahr</th>${keys.map(([, l]) => `<th class="n">${esc(l)}</th>`).join('')}</tr></thead><tbody>
    ${L.map(b => `<tr><td>${esc(ebBodenName(b))}</td><td>${b.jahr || ''}</td>${keys.map(([k]) => `<td class="n eb${ebBodenClass(st, k, b.w ? b.w[k] : null)}">${b.w && b.w[k] != null ? fmtNum(b.w[k]) : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`, { noTitle: true });
}
function ebXlsx() {
  const S = ebState(), y = S.y, rec = ebRecY(y), st = ebStamm(), years = [...new Set([...ebYears()])].sort((a, b) => a - b);
  const P = ebParzSorted(true);
  const ff = [['Gruppe', 'Parzelle', 'Teil', 'ha', ...years.flatMap(j => [`${j} Hauptkultur`, `${j} ha`, `${j} Zwischenfrucht`])]];
  const fl = (j, f) => ebGet(j) ? ebGet(j).schlaege.filter(f) : [];
  P.forEach(p => ff.push([p.gruppe ?? '', p.name, p.teil || '', ebParzHa(p) ?? '', ...years.flatMap(j => { const H = fl(j, s => s.parz === p.id && s.art !== 'zwischen'), Z = fl(j, s => s.parz === p.id && s.art === 'zwischen');
    return [H.map(s => s.kultur).join(' / '), H.length ? r2(H.reduce((t, s) => t + (ebSchlagHa(s) || 0), 0)) : '', Z.map(s => s.kultur).join(' / ')]; })]));
  const maxG = Math.max(1, ...rec.schlaege.map(s => (s.gaben || []).length));
  const du = [['Kultur', 'Art', 'Parzelle', 'ha', 'Vorkultur', 'Bedarf N', '+/-', 'geplant N', 'Restbedarf', ...Array.from({ length: maxG }, (_, i) => [`${i + 1}. Gabe Dünger`, 'Datum', 'Menge/ha', 'kg N/ha']).flat(), 'Sorte', 'Programme', 'Bemerkung']];
  rec.schlaege.forEach(s => { const c = ebSchlagCalc(rec, s); du.push([s.kultur, s.art === 'zwischen' ? 'Zwischenfrucht' : 'Hauptkultur', ebSchlagName(s), c.ha ?? '', ebVorkultur(rec, s), c.bed ?? '', s.korr ?? '', c.geplant, c.rest ?? '',
    ...Array.from({ length: maxG }, (_, i) => { const g = (s.gaben || [])[i]; if (!g) return ['', '', '', '']; const d = ebDuenger(rec, g.d); return [d ? d.name : '', ebDatum(g.datum), g.menge, ebGabeN(rec, g)]; }).flat(), s.sorte || '', (s.prog || []).join(', '), s.bem || '']); });
  const B = ebBilanz(rec), la = [['Dünger', 'Einheit', 'kg N/Einheit', 'Vorrat', 'Bedarf', 'Saldo', 'Zufuhr', 'kg N Zufuhr'], ...ebLager(rec).map(({ d, bedarf, saldo, zufuhr }) => [d.name, d.einheit || '', d.n ?? '', d.vorrat ?? '', bedarf, saldo ?? '', d.zufuhr ? 'ja' : '', zufuhr ?? ''])];
  la.push([], ['Geplante Zufuhr', '', '', '', '', '', '', B.total], ['Abzug Schleppschlauch', '', '', '', '', '', '', B.abzug ?? ''], ['Maximale Zufuhr Planbilanz', '', '', '', '', '', '', B.max ?? ''], ['Reserve', '', '', '', '', '', '', B.reserve ?? '']);
  const M = rec.zf.mix, kg = Object.fromEntries(M.map(m => [m.id, ebMixKg(rec, m)]));
  const zf = [['Art', 'Preis CHF/kg', 'Saatmenge rein', ...M.flatMap(m => [`${ebMixLabel(m)} Anteil`, `kg/ha (${ebFmt(ebMixHa(rec, m))} ha)`]), 'Bedarf kg', 'Lager kg', 'Restbedarf', 'Bestellung kg', 'Betrag CHF'],
    ...ebZfNeed(rec).map(x => [x.a.name, x.a.preis ?? '', x.a.rein ?? '', ...M.flatMap(m => [(m.anteile || {})[x.a.id] ?? '', kg[m.id][x.a.id] ?? '']), x.bedarf, x.a.rest ?? '', x.rest, x.best, x.betrag ?? ''])];
  const bo = [['Parzelle', 'Jahr', 'Labor', 'ÖLN', ...EB_BODEN.map(([, l]) => l), ...EB_BODEN_EMPF.map(([, l]) => 'Empf. ' + l)], ...st.boden.map(b => [ebBodenName(b), b.jahr ?? '', b.labor || '', b.oeln ? 'ja' : '', ...[...EB_BODEN, ...EB_BODEN_EMPF].map(([k]) => b.w && b.w[k] != null ? b.w[k] : '')])];
  const pa = [['Gruppe', 'Parzelle', 'Teil', 'ha', 'Feld MyJohnDeere', 'aktiv', 'Bemerkung'], ...P.map(p => [p.gruppe ?? '', p.name, p.teil || '', ebParzHa(p) ?? '', (feldById(p.feld) || {}).name || '', p.aktiv === false ? 'nein' : 'ja', p.notiz || ''])];
  download(`Eigener_Betrieb_${y}.xlsx`, xlsxBlob([{ name: 'Fruchtfolge', rows: ff }, { name: `Düngung ${y}`, rows: du }, { name: `Lager ${y}`, rows: la }, { name: `Zwischenfrüchte ${y}`, rows: zf }, { name: 'Bodenproben', rows: bo }, { name: 'Parzellen', rows: pa }]));
}

/* ================= Import der Excel-Mappe «Düngungs- und Anbauplanung» ================= */
const ebStr = v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : (v == null ? '' : String(v).trim());
const ebNv = v => typeof v === 'number' && isFinite(v) ? v : null;
// «Weizen» → «Winterweizen» (Name aus den Kulturen, wenn eindeutig); «Sommerhafer» bleibt
function ebCanonKultur(name, K) {
  const n = ebStr(name); if (!n) return ''; const k = ebKey(n);
  const ex = K.find(x => ebKey(x.name) === k); if (ex) return ex.name;
  const sup = K.filter(x => ebKey(x.name).length > k.length && ebKey(x.name).endsWith(k));
  return sup.length === 1 ? sup[0].name : n;
}
// Datum einer Gabe: Excel-Datum, «15.12», «25.03.» oder 14.02 (Zahl). Herbstgaben gehören zum Vorjahr.
function ebImpDate(v, y, zw) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && v > 30000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const s = typeof v === 'number' ? v.toFixed(2) : String(v).trim(), m = /^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/.exec(s); if (!m) return '';
  const d = +m[1], mo = +m[2]; if (d < 1 || d > 31 || mo < 1 || mo > 12) return '';
  const yy = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : (mo >= 8 && !zw ? y - 1 : y);
  return `${yy}-${pad(mo)}-${pad(d)}`;
}
function ebParseKulturen(R) {
  const L = []; (R || []).forEach(r => { if (!r) return; const n = ebStr(r[0]), v = ebNv(r[1]); if (n && v != null && !/bedarf/i.test(n)) L.push({ id: 'k-' + ebSlug(n), name: n, n: v, pause: null }); });
  return L;
}
// Fruchtfolgerapport: Jahre im Abstand von 4 Spalten (Hauptkultur, ha, Vor-/Zwischenkultur, ha)
function ebParseFF(R, K) {
  let hr = -1, yc = [];
  for (let i = 0; i < Math.min(R.length, 10); i++) {
    const r = R[i] || [], ys = []; r.forEach((v, c) => { if (c >= 3 && typeof v === 'number' && v >= 2000 && v <= 2100) ys.push([c, v]); });
    if (ys.length >= 3 && ys.every((x, j) => !j || x[0] - ys[j - 1][0] === 4)) { hr = i; yc = ys; break; }
  }
  if (hr < 0) return null;
  const H = R[hr] || [], cName = Math.max(0, H.findIndex(x => /^parzelle/i.test(ebStr(x)))), cHa = H.findIndex(x => /^fläche/i.test(ebStr(x)));
  const cTeil = cHa > cName + 1 ? cName + 1 : -1;
  const E = new Map(); let cur = null, grp = null;
  for (let i = hr + 2; i < R.length; i++) {
    const r = R[i] || [], nm = ebStr(r[cName]), te = cTeil >= 0 ? ebStr(r[cTeil]) : '', ha = cHa >= 0 ? ebNv(r[cHa]) : null;
    const hasTxt = yc.some(([c]) => typeof r[c] === 'string' || typeof r[c + 2] === 'string');
    if (!nm && !te && !hasTxt) { if (ha != null || yc.some(([c]) => ebNv(r[c + 1]) != null)) break; continue; }
    if (typeof r[0] === 'number') grp = r[0]; else if (nm && cName > 1 && typeof r[1] === 'number') grp = null;
    if (nm) cur = { name: nm, teil: te, gruppe: grp }; else if (te && cur) cur = { name: cur.name, teil: te, gruppe: cur.gruppe };
    if (!cur) continue;
    const key = ebKey(cur.name) + '|' + ebKey(cur.teil), e = E.get(key) || { name: cur.name, teil: cur.teil, gruppe: cur.gruppe, ha: null, years: {} };
    if (ha != null && (nm || te)) e.ha = ha;
    yc.forEach(([c, y], j) => {
      const Y = e.years[y] || (e.years[y] = { haupt: [], zw: [] }), hk = ebStr(r[c]), zk = j < yc.length - 1 || c + 2 < (R[hr + 1] || []).length ? ebStr(r[c + 2]) : '';
      if (hk && !/^\d/.test(hk)) Y.haupt.push({ k: ebCanonKultur(hk, K), ha: ebNv(r[c + 1]), row: i });
      if (zk && !/^\d/.test(zk)) Y.zw.push({ k: zk, ha: ebNv(r[c + 3]), row: i });
    });
    E.set(key, e);
  }
  const list = [...E.values()].filter(e => Object.values(e.years).some(Y => Y.haupt.length || Y.zw.length));
  return { years: yc.map(x => x[1]), list };
}
function ebParseDueng(R, K) {
  const hi = R.findIndex(r => r && ebStr(r[0]) === 'Kultur'); if (hi < 0) return null;
  const H = R[hi], H2 = R[hi + 1] || [], col = re => H.findIndex(x => re.test(ebStr(x)));
  const c = { p: col(/^parzelle/i), f: col(/^fläche/i), b: col(/^bedarf/i), k: col(/^\+\/-$/), s: col(/^sorte/i), v: col(/^vorkultur/i), a: col(/^anbauprog/i), r: col(/^ressourcen/i), w: col(/^weitere prog/i), bem: col(/^bemerkung/i) };
  const gc = []; H2.forEach((x, i) => { if (ebStr(x) === 'Dünger') gc.push(i); });
  const rows = [];
  for (let i = hi + 2; i < R.length; i++) {
    const r = R[i]; if (!r || !ebStr(r[0])) break;
    const prog = [c.a, c.r, c.w].map(x => x >= 0 ? ebStr(r[x]) : '').filter(x => x && !/^keine/i.test(x));
    rows.push({ kultur: ebCanonKultur(r[0], K), parz: c.p >= 0 ? ebStr(r[c.p]) : '', ha: c.f >= 0 ? ebNv(r[c.f]) : null, bed: c.b >= 0 ? ebNv(r[c.b]) : null, korr: c.k >= 0 ? ebNv(r[c.k]) : null,
      sorte: c.s >= 0 ? ebStr(r[c.s]) : '', vk: c.v >= 0 ? ebStr(r[c.v]) : '', prog, bem: c.bem >= 0 ? ebStr(r[c.bem]) : '',
      gaben: gc.map(g => ({ name: ebStr(r[g]), datum: r[g + 1], menge: ebNv(r[g + 2]), einheit: ebStr(r[g + 3]), nha: ebNv(r[g + 4]) })).filter(g => g.name && g.menge) });
  }
  const di = R.findIndex((r, i) => i > hi && r && r.some(x => ebStr(x) === 'Gehalt N')), duenger = [];
  let abzug = null, maxN = null;
  if (di >= 0) {
    const D = R[di], ci = re => D.findIndex(x => re.test(ebStr(x))), cG = ci(/^gehalt n/i), cE = ci(/^einheit/i), cV = ci(/^vorrat/i), cZ = ci(/^n zufuhr/i);
    for (let i = di + 1; i < R.length; i++) { const r = R[i]; if (!r || !ebStr(r[0])) break; const name = ebStr(r[0]);
      duenger.push({ id: 'd-' + ebSlug(name), name, einheit: cE >= 0 ? ebStr(r[cE]) : '', n: cG >= 0 ? ebNv(r[cG]) : null, vorrat: cV >= 0 ? ebNv(r[cV]) : null, zufuhr: cZ >= 0 && ebNv(r[cZ]) != null }); }
    R.forEach((r, i) => { if (i <= di || !r) return; const t = ebStr(r[0]), v = r.slice(1).find(x => typeof x === 'number');
      if (/^abzug/i.test(t)) abzug = v ?? null; if (/^maximale zufuhr/i.test(t)) maxN = v ?? null; });
  }
  return { rows, duenger, abzug, maxN };
}
function ebParseZf(R) {
  const hi = R.findIndex(r => r && /^art/i.test(ebStr(r[0]))); if (hi < 0) return null;
  const H = R[hi], ci = re => H.findIndex(x => re.test(ebStr(x))), cP = ci(/^preis/i), cR = ci(/^saatmenge/i), cB = ci(/^bestell/i), cL = ci(/^rest$/i);
  const U = R[hi - 2] || [], N = R[hi - 1] || [], mix = [];
  U.forEach((x, c) => { if (typeof x === 'string' && x.trim() && ebNv(U[c + 2]) != null) mix.push({ c, use: ebStr(x), ha: U[c + 2], name: ebStr(N[c]) || ebStr(x) }); });
  const arten = [], notes = [];
  for (let i = hi + 1; i < R.length; i++) {
    const r = R[i]; if (!r) continue; const name = ebStr(r[0]); if (!name) continue;
    const preis = cP >= 0 ? ebNv(r[cP]) : null, rein = cR >= 0 ? ebNv(r[cR]) : null, an = mix.map(m => ebNv(r[m.c]));
    if (preis == null && rein == null && an.every(v => v == null)) { const rest = r.slice(1).map(ebStr).filter(x => x && x !== '0'); if (rest.length) notes.push(`${name}: ${rest.join(', ')}`); continue; }
    arten.push({ id: 'a-' + ebSlug(name), name, preis, rein, rest: cL >= 0 ? ebNv(r[cL]) : null, best: cB >= 0 ? ebNv(r[cB]) : null, an });
  }
  return { arten, mix, notiz: notes.join(' · ') };
}
const EB_BODEN_LBL = { humus: /^humus/, ph: /^ph$/, kak: /^kak/, ca: /^cal[cz]ium/, mg: /^magnesium/, k: /^kali/, na: /^natrium/, basen: /^andere basen/, h: /^h\+/, n: /^stickstoff/, s: /^schwefel/,
  p: /^pho?sphor|^posphor/, b: /^bor$/, fe: /^eisen/, mn: /^mangan/, cu: /^kupfer/, zn: /^zink$/, mo: /^molybdän/, co: /^kobalt/, eZn: /^zinksulfat/, eB: /^borsäure/, eMo: /^molibtän|^molybdän.*dünger/, eSalz: /^salz/ };
function ebParseBoden(R) {
  const hi = R.findIndex(r => r && /^feld$/i.test(ebStr(r[0]))); if (hi < 0) return null;
  const H = R[hi], cols = {}, used = new Set();
  Object.entries(EB_BODEN_LBL).forEach(([k, re]) => { const c = H.findIndex((x, i) => !used.has(i) && re.test(ebStr(x).toLowerCase())); if (c >= 0) { cols[k] = c; used.add(c); } });
  const cJ = H.findIndex(x => /probejahr|^jahr/i.test(ebStr(x))), cO = H.findIndex(x => /^öln/i.test(ebStr(x)));
  const richt = {}, samples = [];
  R.forEach((r, i) => {
    if (!r || i === hi) return; const t = ebStr(r[0]); if (!t) return;
    const f = /^g\.?\s*min/i.test(t) ? 'min' : /^g\.?\s*opt/i.test(t) ? 'opt' : /^g\.?\s*max/i.test(t) ? 'max' : /^zielwert/i.test(t) ? 'ziel' : null;
    if (f) { Object.entries(cols).forEach(([k, c]) => { if (k[0] === 'e' && k !== k.toLowerCase()) return; const v = f === 'ziel' ? ebStr(r[c]) : ebNv(r[c]); if (v != null && v !== '') (richt[k] = richt[k] || {})[f] = v; }); return; }
    if (i < hi) return;
    const w = {}; Object.entries(cols).forEach(([k, c]) => { const v = ebNv(r[c]); if (v != null) w[k] = v; });
    if (!Object.keys(w).length) return;
    samples.push({ name: t, jahr: cJ >= 0 ? ebNv(r[cJ]) : null, oeln: cO >= 0 ? r[cO] === true : false, w });
  });
  return { richt, samples };
}
// strenge Zuordnung (Bodenproben): gleicher Name oder höchstens 2 Tippfehler
function ebFindParzStrict(name, st) {
  const k = ebKey(name), ex = st.parz.find(p => ebKey(ebParzLabel(p)) === k); if (ex) return ex;
  const lim = k.length > 6 ? 2 : 1, t1 = p => { const n = ebKey(p.name), l = ebKey(ebParzLabel(p)); return n === k || ebLev(l, k) <= lim || ebLev(n, k) <= lim; };
  const t2 = p => { const n = ebKey(p.name), l = ebKey(ebParzLabel(p)); return k.length >= 5 && (n.startsWith(k) || k.startsWith(l)); };
  let C = st.parz.filter(t1); if (!C.length) C = st.parz.filter(t2); if (C.length > 1) C = C.filter(p => p.aktiv !== false);
  return C.length === 1 ? C[0] : null;
}
const ebTokens = s => norm(s).split(/[^a-z0-9äöü]+/).filter(x => x.length >= 2 || /^\d$/.test(x));

async function ebImportFile(file) {
  let book; try { book = await xlsxRead(await file.arrayBuffer()); } catch (e) { toast('Datei konnte nicht gelesen werden: ' + e.message, 5000); return; }
  const names = Object.keys(book);
  const K = ebParseKulturen(book[names.find(n => /^kulturen$/i.test(n.trim()))]);
  const Kx = K.length ? K : ebStammBlank().kulturen;
  const ff = names.filter(n => /^frucht/i.test(n)).map(n => ({ n, r: ebParseFF(book[n], Kx) })).filter(x => x.r).sort((a, b) => b.r.years.length - a.r.years.length)[0] || null;
  const dSheets = {}; names.forEach(n => { const m = /^düngungsplanung\s+(\d{4})\s*(.*)$/i.exec(n.trim()); if (!m) return; const y = +m[1], pr = /effektiv/i.test(m[2]) ? 3 : /geplant/i.test(m[2]) ? 1 : 2; if (!dSheets[y] || dSheets[y].pr < pr) dSheets[y] = { n, pr }; });
  const zSheets = {}; names.forEach(n => { const m = /^zwischenfrucht\S*\s+(\d{4})/i.exec(n.trim()); if (m) zSheets[+m[1]] = n; });
  const bName = names.find(n => /bodenprob/i.test(n));
  const bo = bName ? ebParseBoden(book[bName]) : null;
  const dy = Object.keys(dSheets).map(Number).sort(), zy = Object.keys(zSheets).map(Number).sort();
  if (!ff && !dy.length && !zy.length && !bo) { toast('In dieser Datei wurde nichts Passendes gefunden (Fruchtfolgerapport, Düngungsplanung …).', 5000); return; }
  const has = Store.get('einstellungen', 'eb-stamm') || ebYears().length;
  const body = `<p style="margin-top:0">Gefunden in «${esc(file.name)}»:</p><ul class="ebimpl">
      ${ff ? `<li><b>Fruchtfolge</b> ${ff.r.years[0]}–${ff.r.years[ff.r.years.length - 1]} mit ${ff.r.list.length} Parzellen <span class="nr">(Blatt «${esc(ff.n)}»)</span></li>` : ''}
      ${dy.length ? `<li><b>Düngungsplanung</b> ${dy.join(', ')}${dSheets[2021] && /effektiv/i.test(dSheets[2021].n) ? ' <span class="nr">(2021: effektiv)</span>' : ''}</li>` : ''}
      ${zy.length ? `<li><b>Zwischenfrüchte</b> ${zy.join(', ')}</li>` : ''}
      ${bo ? `<li><b>Bodenproben</b> ${bo.samples.length} Proben mit Richtwerten</li>` : ''}
      ${K.length ? `<li><b>Kulturen</b> ${K.length} mit N-Bedarf</li>` : ''}</ul>
    ${has ? `<p class="warnline">Die bisherigen Daten des Moduls werden ersetzt. Verknüpfungen von Parzellen mit Feldern bleiben bei gleichem Parzellennamen erhalten.</p>` : ''}
    <p class="nr">Parzellen werden aus dem Fruchtfolgerapport angelegt; die Zeilen der Düngungspläne werden dort über Parzelle und Kultur zugeordnet. Was nicht eindeutig war, steht danach im Import-Bericht.</p>`;
  Dlg.open('Excel-Mappe importieren', body, `<span class="spacer ebsp"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Importieren</button>`, () => {
    const res = ebImportBuild({ book, K, ff, dSheets, zSheets, bo });
    const old = ebYears().filter(y => !res.recs.some(r => r.jahr === y));
    Store.putMany('einstellungen', [res.st, ...res.recs].map(x => structuredClone(x)));
    old.forEach(y => Store.remove('einstellungen', ebId(y)));
    const S = ebState(); S.sub = 'fruchtfolge'; S.ffEnd = Math.max(ebCurYear() + 1, ...res.recs.map(r => r.jahr).filter(y => y <= ebCurYear() + 2)); S.y = ebCurYear();
    setTimeout(() => ebReportDialog(res.rep), 50);
    return true;
  });
}
function ebImportBuild({ book, K, ff, dSheets, zSheets, bo }) {
  const old = ebStamm(), st = ebStammBlank(), rep = { info: [], zu: [], neu: [], frei: [], boden: [], mix: [] };
  st.kunde = old.kunde || (ebKunde() || {}).id || '';
  if (K.length) st.kulturen = K.map(k => { const o = old.kulturen.find(x => ebKey(x.name) === ebKey(k.name)); return { ...k, pause: o ? o.pause ?? null : null, dauer: o && o.dauer != null ? !!o.dauer : EB_DAUER.includes(k.name) }; });
  const zfSet = new Set(old.zfListe || []);
  st.programme = [...new Set([...old.programme, ...EB_PROG])];
  const oldBy = new Map(old.parz.map(p => [ebKey(p.name) + '|' + ebKey(p.teil), p]));
  const mkParz = (name, teil, ha, gruppe) => {
    const key = ebKey(name) + '|' + ebKey(teil), ex = st.parz.find(p => ebKey(p.name) + '|' + ebKey(p.teil) === key); if (ex) return ex;
    const o = oldBy.get(key), p = { id: o ? o.id : uid(), name, teil: teil || '', feld: o ? o.feld || '' : '', ha: ha ?? null, gruppe: gruppe ?? (o ? o.gruppe ?? null : null), aktiv: true, notiz: o ? o.notiz || '' : '', pos: o && o.pos != null ? o.pos : st.parz.length };
    st.parz.push(p); return p;
  };
  const recs = {}, R = y => recs[y] || (recs[y] = ebBlank(y));
  const sNew = o => Object.assign({ id: uid(), parz: '', name: '', art: 'haupt', kultur: '', mix: '', ha: null, sorte: '', prog: [], bem: '', nBed: null, korr: null, vk: '', gaben: [] }, o);
  // 1. Fruchtfolge → Parzellen und Schläge
  if (ff) {
    ff.r.list.forEach(e => {
      const p = mkParz(e.name, e.teil, e.ha, e.gruppe);
      Object.entries(e.years).forEach(([y, Y]) => {
        // Zwischenfrucht gehört zur Hauptkultur derselben Excel-Zeile (sonst zur letzten darüber)
        const HS = Y.haupt.map(h => { const x = sNew({ parz: p.id, art: 'haupt', kultur: h.k, ha: h.ha != null && (p.ha == null || Math.abs(h.ha - p.ha) > 0.001) ? h.ha : null }); R(+y).schlaege.push(x); return { h, x }; });
        Y.zw.forEach(z => { const m = HS.find(o => o.h.row === z.row) || HS.filter(o => o.h.row < z.row).pop() || HS[0], hh = m ? (m.x.ha ?? p.ha) : p.ha;
          zfSet.add(z.k); R(+y).schlaege.push(sNew({ parz: p.id, art: 'zwischen', kultur: z.k, nach: m ? m.x.id : '', ha: z.ha != null && (hh == null || Math.abs(z.ha - hh) > 0.001) ? z.ha : null, _fh: z.ha ?? hh })); });
      });
    });
    rep.info.push(`Fruchtfolge ${ff.r.years[0]}–${ff.r.years[ff.r.years.length - 1]}: ${st.parz.length} Parzellen, ${Object.values(recs).reduce((t, r) => t + r.schlaege.length, 0)} Einträge`);
  }
  // 2. Düngungspläne: Zeile → Schlag gleicher Kultur auf ähnlich benannter Parzelle
  Object.entries(dSheets).sort((a, b) => a[0] - b[0]).forEach(([ys, { n }]) => {
    const y = +ys, D = ebParseDueng(book[n], st.kulturen); if (!D) return;
    const rec = R(y); rec.duenger = D.duenger; rec.abzug = D.abzug; rec.maxN = D.maxN;
    const used = new Set(); let nz = 0;
    D.rows.forEach(row => {
      const zw = /gründüngung|zwischenfrucht/i.test(row.kultur);
      let s = null, best = 99;
      if (row.parz) rec.schlaege.forEach(x => { if (used.has(x.id) || !x.parz || (x.art === 'zwischen') !== zw || !ebSameKultur(x.kultur, row.kultur)) return;
        const p = st.parz.find(q => q.id === x.parz), d = Math.min(ebNameDist(ebParzLabel(p), row.parz) ?? 99, ebNameDist(p.name, row.parz) ?? 99); if (d === 99) return;
        const sc = d * 10 + Math.abs((x.ha ?? p.ha ?? 0) - (row.ha ?? 0)); if (sc < best) { best = sc; s = x; } });
      if (s) { const p = st.parz.find(q => q.id === s.parz); nz++;
        if (ebKey(p.name) !== ebKey(row.parz) && ebKey(ebParzLabel(p)) !== ebKey(row.parz)) rep.zu.push(`${y}: «${row.parz}» ${row.kultur} ${fmtNum(row.ha)} ha ↦ ${ebParzLabel(p)}${ebSchlagHaRaw(s, p) != null ? ` (Fruchtfolge ${fmtNum(ebSchlagHaRaw(s, p))} ha)` : ''}`);
      } else if (zw || !row.parz) {
        rep.frei.push(`${y}: ${row.kultur}${row.parz ? ' «' + row.parz + '»' : ''} ${fmtNum(row.ha)} ha`); return; // Flächen ohne Parzelle werden nicht übernommen
      } else {
        let p = st.parz.find(q => ebKey(q.name) === ebKey(row.parz) && !q.teil) || null;
        if (!p) { const g = ebFindParz(row.parz, st); if (g && (ebNameDist(g.name, row.parz) ?? 99) <= 1) p = g; }
        if (!p) { p = mkParz(row.parz, '', row.ha, null); rep.neu.push(`${y}: «${row.parz}» (${row.kultur} ${fmtNum(row.ha)} ha) – neue Parzelle`); }
        s = sNew({ parz: p.id, art: 'haupt', kultur: row.kultur }); rec.schlaege.push(s);
      }
      used.add(s.id);
      const p = st.parz.find(q => q.id === s.parz);
      s.ha = row.ha != null && !(p && p.ha != null && Math.abs(p.ha - row.ha) < 0.001) ? row.ha : (p ? null : row.ha);
      if (row.korr != null) s.korr = row.korr;
      const kb = (ebKulturIn(st, s.kultur) || (zw ? ebKulturIn(st, 'Gründüngung') : null) || {}).n;
      if (row.bed != null && row.bed !== kb) s.nBed = row.bed;
      if (row.sorte) s.sorte = row.sorte; if (row.prog.length) { s.prog = row.prog; row.prog.forEach(x => { if (!st.programme.includes(x)) st.programme.push(x); }); }
      if (row.bem) s.bem = row.bem; if (row.vk) s.vk = row.vk;
      s.gaben = row.gaben.map(g => {
        const id = 'd-' + ebSlug(g.name);
        if (!rec.duenger.some(d => d.id === id)) rec.duenger.push({ id, name: g.name, einheit: g.einheit, n: g.nha != null && g.menge ? r2(g.nha / g.menge) : null, vorrat: null, zufuhr: false });
        return { id: uid(), d: id, datum: ebImpDate(g.datum, y, zw), menge: g.menge };
      });
    });
    rep.info.push(`Düngungsplanung ${y}: ${D.rows.length} Zeilen (${nz} der Fruchtfolge zugeordnet), ${rec.duenger.length} Dünger`);
  });
  // Fläche der Zwischenfrucht aus dem Fruchtfolgerapport behalten, wenn der Düngungsplan die Fläche der Hauptkultur geändert hat
  Object.values(recs).forEach(rec => rec.schlaege.forEach(z => { if (z._fh === undefined) return; const fh = z._fh; delete z._fh; if (z.ha != null || fh == null) return;
    const h = rec.schlaege.find(x => x.id === z.nach), hh = h ? h.ha ?? (st.parz.find(q => q.id === h.parz) || {}).ha : null; if (hh == null || Math.abs(hh - fh) > 0.001) z.ha = fh; }));
  // Vorkultur nur behalten, wo sie nicht aus der Fruchtfolge folgt
  Object.values(recs).forEach(rec => rec.schlaege.forEach(s => { if (s.vk && s.parz && recs[rec.jahr - 1] && recs[rec.jahr - 1].schlaege.some(x => x.parz === s.parz && x.art !== 'zwischen')) s.vk = ''; }));
  // 3. Zwischenfrüchte: Arten, Mischungen, Zuordnung der Zwischenfrüchte aus der Fruchtfolge
  Object.entries(zSheets).forEach(([ys, n]) => {
    const y = +ys, Z = ebParseZf(book[n]); if (!Z) return;
    const rec = R(y); const mix = Z.mix.map(m => ({ id: uid(), name: m.name, use: m.use, ha: m.ha, anteile: {} }));
    rec.zf = { arten: Z.arten.map(a => { a.an.forEach((v, i) => { if (v) mix[i].anteile[a.id] = v; }); return { id: a.id, name: a.name, preis: a.preis, rein: a.rein, rest: a.rest, best: a.best }; }), mix, notiz: Z.notiz };
    rec.schlaege.filter(s => s.art === 'zwischen' && s.parz && !s.mix).forEach(s => {
      const kt = ebTokens(s.kultur), M = mix.filter(m => { const mt = ebTokens(m.name); return mt.length && mt.every(t => kt.some(u => u.startsWith(t) || t.startsWith(u))); });
      if (!M.length) return; const p = st.parz.find(q => q.id === s.parz);
      const pick = M.find(m => m.use.split(/[+,/&]| und /).some(u => (ebNameDist(u, p.name) ?? 99) <= 2)) || M.find(m => !M.some(o => o !== m && o.name === m.name) || !/[+]/.test(m.use)) || M[0];
      s.mix = pick.id;
    });
    mix.forEach(m => { const haOf = s => { const h = s.nach && rec.schlaege.find(x => x.id === s.nach); return s.ha ?? (h ? h.ha : null) ?? (st.parz.find(q => q.id === s.parz) || {}).ha ?? 0; };
      const auto = r2(rec.schlaege.filter(s => s.mix === m.id).reduce((t, s) => t + haOf(s), 0));
      if (Math.abs(auto - m.ha) <= 0.05) m.ha = null; else rep.mix.push(`${y}: ${m.name} (${m.use}) ${fmtNum(m.ha)} ha aus der Excel-Tabelle${auto ? ` – Fruchtfolge ergibt ${fmtNum(auto)} ha` : ' – keine Zwischenfrucht in der Fruchtfolge zugeordnet'}`); });
    rep.info.push(`Zwischenfrüchte ${y}: ${rec.zf.arten.length} Arten, ${mix.length} Mischungen`);
  });
  // Parzellen ohne Hauptkultur in den letzten zwei Jahren: inaktiv
  const cy = ebCurYear(); st.parz.forEach(p => { p.aktiv = [cy - 1, cy, cy + 1].some(y => recs[y] && recs[y].schlaege.some(s => s.parz === p.id)); });
  st.zfListe = [...zfSet].sort((a, b) => a.localeCompare(b, 'de'));
  // 4. Bodenproben
  if (bo) {
    Object.entries(bo.richt).forEach(([k, r]) => { st.richt[k] = Object.assign({}, st.richt[k] || {}, r); });
    bo.samples.forEach(b => { const p = ebFindParzStrict(b.name, st); st.boden.push({ id: uid(), parz: p ? p.id : '', name: b.name, jahr: b.jahr, labor: 'Kinsey', oeln: b.oeln, w: b.w, notiz: '' }); if (!p) rep.boden.push(`«${b.name}» ${b.jahr || ''}`); });
    rep.info.push(`Bodenproben: ${bo.samples.length} (${bo.samples.length - rep.boden.length} einer Parzelle zugeordnet)`);
  }
  // Teil-Bezeichnung (Nord, West …) nur behalten, wenn es mehrere Teile gibt
  st.parz.forEach(p => { if (p.teil && !st.parz.some(o => o !== p && ebKey(o.name) === ebKey(p.name)) && !st.parz.some(o => o !== p && ebKey(ebParzLabel(o)) === ebKey(p.name))) { const o = oldBy.get(ebKey(p.name) + '|'); if (!o || o.id === p.id) p.teil = ''; } });
  return { st, recs: Object.values(recs).sort((a, b) => a.jahr - b.jahr), rep };
}
const ebKulturIn = (st, name) => { const k = ebKey(name); return st.kulturen.find(x => ebKey(x.name) === k) || st.kulturen.find(x => ebKultKey(x.name) === ebKultKey(name)) || st.kulturen.filter(x => ebKey(x.name).length > 3 && k.includes(ebKey(x.name))).sort((a, b) => b.name.length - a.name.length)[0] || null; };
const ebSchlagHaRaw = (s, p) => s.ha != null ? s.ha : p ? p.ha : null;
function ebReportDialog(rep) {
  const sec = (t, L, hint) => L.length ? `<h4 style="margin:12px 0 4px">${t} <small class="nr">${L.length}</small></h4>${hint ? `<p class="nr" style="margin:0 0 4px">${hint}</p>` : ''}<ul class="ebimpl">${L.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const body = `<ul class="ebimpl">${rep.info.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${sec('Ähnliche Namen zugeordnet', rep.zu, 'Bitte kurz prüfen. Falsch zugeordnet? Den Eintrag in der Fruchtfolge öffnen und die Parzelle ändern.')}
    ${sec('Neue Parzellen aus den Düngungsplänen', rep.neu, 'Diese Namen kamen in der Fruchtfolge nicht vor. Ist es der gleiche Acker wie eine bestehende Parzelle (z.B. «Ried» = «Richtersmatt»?), unter Stammdaten › Parzellen › Parzelle öffnen › «Zusammenführen».')}
    ${sec('Nicht übernommen: Zeilen ohne Parzelle', rep.frei, 'Sammelzeilen wie «Gründüngung Zuckerrüben» oder «Weide» ohne Parzellenname. Plane solche Gaben bei der Zwischenfrucht bzw. Kultur der jeweiligen Parzelle. Der Lagerbedarf der betroffenen Dünger ist darum kleiner als in der Excel-Mappe.')}
    ${sec('Mischungen mit Fläche von Hand', rep.mix, 'Die Fläche aus der Excel-Tabelle wurde übernommen, weil die Zwischenfrüchte in der Fruchtfolge eine andere Fläche ergeben.')}
    ${sec('Bodenproben ohne Parzelle', rep.boden, 'Unter Bodenproben antippen und die Parzelle wählen.')}
    <p class="nr" style="margin-top:12px">Nächster Schritt: unter «Stammdaten › Parzellen» die Vorschläge zur Verknüpfung mit den Feldern aus MyJohnDeere übernehmen.</p>`;
  Dlg.open('Import abgeschlossen', body, `<span class="spacer ebsp"></span><button type="button" class="btn primary" data-act="close">OK</button>`, () => true);
  App.render();
}

/* ---------- Anbindung an die App ---------- */
Views.betrieb = ebView();
if (App.view === 'betrieb' && App.winSub) { ebState().sub = App.winSub; } // zweites Fenster: gleicher Unterreiter
App.lastView = null; // Werkzeugleiste neu aufbauen (beim ersten Zeichnen war das Modul noch nicht geladen)
App.render();
