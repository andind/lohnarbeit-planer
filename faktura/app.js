/* IM-Faktura – Rechnungen mit Schweizer QR-Zahlteil, Offene Posten, Zahlungen (camt.054), Mahnungen.
   Eigenständige Web-App (ohne Fremdbibliotheken) wie IM-Vermietung: Daten lokal im Browser + Abgleich mit Dropbox (/faktura.json). */
'use strict';

const APP_VERSION = '1.24', APP_STAND = '19.11.2026';
const CFG = Object.assign({ appKey: '', dataPath: '/faktura.json' }, window.APP_CONFIG || {});
const COLL = ['kunden', 'artikel', 'rechnungen', 'einstellungen'];
const EINHEITEN = ['ha', 'h', 'Stk', 'Pausch.', 'km', 'm³', 't', 'kg', 'l', 'a'];

/* ================= Hilfsfunktionen ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoDate(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + (+n || 0)); return isoDate(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const fmtDate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const fmtNum = (n, max = 2) => (n === '' || n == null || isNaN(n)) ? '' : Number(n).toLocaleString('de-CH', { maximumFractionDigits: max });
const chf = n => (n == null || isNaN(n)) ? '' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => { if (v === '' || v == null) return null; if (typeof v === 'number') return isFinite(v) ? v : null; const n = parseFloat(String(v).replace(/CHF|Fr\.?/gi, '').replace(/['’\s]/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const round5 = n => Math.round((n + Number.EPSILON) * 20) / 20;
const ls = (key, val) => { try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch { return null; } };
const lsJson = (key, val) => { if (val === undefined) { try { return JSON.parse(ls(key) || 'null'); } catch { return null; } } ls(key, val === null ? null : JSON.stringify(val)); };
const clone = o => JSON.parse(JSON.stringify(o));
/* ---------- Eigene grosse Rückfragen statt Browser-Fenster (confirm/alert) ---------- */
// frage(text, { ok, nein, gefahr }) → Promise<true|false>; meldung(text) → Promise (nur OK)
function frage(msg, o = {}) {
  if (!document.getElementById('imaskCss')) {
    const st = document.createElement('style'); st.id = 'imaskCss';
    st.textContent = `dialog.imask{border:0;border-radius:16px;padding:0;width:min(680px,94vw);max-height:90vh;background:var(--surface,var(--panel,#fff));color:var(--text,var(--fg,#1d211e));box-shadow:0 18px 60px rgba(0,0,0,.45);font-family:inherit}
dialog.imask::backdrop{background:rgba(0,0,0,.45)}
.imask-in{display:flex;gap:18px;padding:26px 28px 18px;align-items:flex-start;max-height:calc(90vh - 96px);overflow:auto}
.imask-ic{font-size:40px;line-height:1;flex:none}
.imask-msg{font-size:19px;line-height:1.5;white-space:pre-line;word-break:break-word;padding-top:4px}
.imask-msg b{font-weight:700}
.imask-btns{display:flex;justify-content:flex-end;gap:14px;padding:16px 28px 24px;flex-wrap:wrap}
.imask-btns button{font:inherit;font-size:18px;font-weight:600;padding:13px 28px;min-width:150px;border-radius:12px;cursor:pointer;border:2px solid var(--line,#c9cfc9);background:var(--surface-2,var(--bg,#f2f2ee));color:inherit}
.imask-btns .imask-ok{background:var(--accent,#2f6b3f);border-color:var(--accent,#2f6b3f);color:var(--accent-fg,#fff)}
.imask-btns .imask-ok.gefahr{background:#b3261e;border-color:#b3261e;color:#fff}
.imask-btns button:focus-visible{outline:3px solid #f2b705;outline-offset:2px}`;
    document.head.appendChild(st);
  }
  return new Promise(res => {
    const isInfo = !!o.info, txt = String(msg ?? '');
    const gefahr = !isInfo && (o.gefahr ?? /lösch|entfern|stornier|verwerf|ersetz|abmeld|zurück in die Entwürfe/i.test(txt));
    const d = document.createElement('dialog'); d.className = 'imask';
    d.innerHTML = `<div class="imask-in"><div class="imask-ic">${isInfo ? 'ℹ️' : gefahr ? '⚠️' : '❓'}</div><div class="imask-msg"></div></div><div class="imask-btns">${isInfo ? '' : '<button type="button" class="imask-no"></button>'}<button type="button" class="imask-ok"></button></div>`;
    d.querySelector('.imask-msg').textContent = txt;
    const ok = d.querySelector('.imask-ok'), no = d.querySelector('.imask-no');
    ok.textContent = o.ok || (gefahr ? (/lösch/i.test(txt) ? 'Ja, löschen' : /entfern/i.test(txt) ? 'Ja, entfernen' : /stornier/i.test(txt) ? 'Ja, stornieren' : 'Ja') : 'OK'); if (gefahr) ok.classList.add('gefahr');
    if (no) no.textContent = o.nein || 'Abbrechen';
    let fertig = false;
    const done = v => { if (fertig) return; fertig = true; try { d.close(); } catch { } d.remove(); res(v); };
    ok.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); done(true); });
    if (no) no.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); done(false); });
    d.addEventListener('cancel', e => { e.preventDefault(); done(isInfo); });
    d.addEventListener('click', e => e.stopPropagation());
    d.addEventListener('keydown', e => e.stopPropagation());
    document.body.appendChild(d); d.showModal();
    (gefahr && no ? no : ok).focus();
  });
}
function meldung(msg) { return frage(msg, { info: true }); }
function toast(msg, ms) { ms = ms || Math.max(4000, Math.min(9000, String(msg).length * 70)); const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const fold = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/é|è|ê/g, 'e').replace(/ß/g, 'ss')
  .replace(/gebrüder|gebrueder|gebr\./g, 'gebr ').replace(/[^a-z0-9]+/g, ' ').trim();
const tokKey = s => fold(s).split(' ').filter(Boolean).sort().join(' ');
function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[b.length];
}
const simil = (a, b) => { const x = tokKey(a), y = tokKey(b); if (!x || !y) return 0; return 1 - lev(x, y) / Math.max(x.length, y.length); };
const nrKey = s => String(s ?? '').trim().replace(/^0+(?=\d)/, '');
// «Dorfstrasse 12a» → Strasse + Hausnummer
function splitStreet(s) {
  s = String(s || '').trim(); const m = /^(.*?)[,\s]+(\d+\s?[a-zA-Z]?(?:\s?[-\/]\s?\d+[a-zA-Z]?)?)$/.exec(s);
  return m && m[1] ? { strasse: m[1].trim(), hausnr: m[2].replace(/\s+/g, '') } : { strasse: s, hausnr: '' };
}
function splitPlzOrt(plz, ort) {
  plz = String(plz || '').trim(); ort = String(ort || '').trim();
  if (!ort && /^\d{4,5}\s+\S/.test(plz)) { ort = plz; plz = ''; }
  if (!plz) { const m = /^(?:(CH|LI|D|FL)[-\s])?(\d{4,5})\s+(.+)$/i.exec(ort); if (m) return { plz: m[2], ort: m[3] }; }
  return { plz, ort };
}
const excelDate = v => { const n = num(v); if (typeof v === 'number' || (/^\d{5}(\.\d+)?$/.test(String(v)) && n > 30000 && n < 80000)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); return d.toISOString().slice(0, 10); }
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(String(v || '').trim()); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : ''; };

/* ================= Datenhaltung ================= */
const DEF_CFG = {
  firma: { name: 'Andreas Indermühle', strasse: 'Kreuzweg', hausnr: '4', plz: '3054', ort: 'Schüpfen', land: 'CH', tel: '079 322 29 64', mail: 'indermuehle@windowslive.com', uid: 'CHE-170.163.145 MWST' },
  iban: 'CH9530808001496253095', refPrefix: '', nextNr: 1, frist: 30, titel: 'Rechnung', ort: 'Schüpfen',
  textOben: '', textUnten: 'Besten Dank für Ihren Auftrag.', adrPos: 'rechts', runden5: true, preiseInkl: false, swico: true, logo: '',
  mwst: [{ satz: 8.1, name: 'Normalsatz' }, { satz: 2.6, name: 'Reduzierter Satz' }, { satz: 3.8, name: 'Beherbergung' }, { satz: 0, name: 'Ohne MWST' }], mwstDef: 8.1,
  mahn: [
    { titel: 'Zahlungserinnerung', gebuehr: 0, frist: 10, text: 'Sicher ist es Ihrer Aufmerksamkeit entgangen, dass die folgende Rechnung noch offen ist. Wir bitten Sie, den Betrag innert 10 Tagen zu überweisen. Sollte sich Ihre Zahlung mit diesem Schreiben gekreuzt haben, betrachten Sie es bitte als gegenstandslos.' },
    { titel: '2. Mahnung', gebuehr: 10, frist: 10, text: 'Trotz unserer Zahlungserinnerung ist die folgende Rechnung noch nicht beglichen. Wir bitten Sie, den offenen Betrag inklusive Mahngebühr innert 10 Tagen zu bezahlen.' },
    { titel: '3. Mahnung', gebuehr: 20, frist: 10, text: 'Leider ist die folgende Rechnung trotz zweimaliger Mahnung noch offen. Bitte überweisen Sie den Betrag inklusive Mahngebühren innert 10 Tagen. Andernfalls sehen wir uns gezwungen, weitere Schritte einzuleiten.' }]
};
const Store = {
  data: null,
  load() {
    this.data = lsJson('mf_data');
    if (!this.data || typeof this.data !== 'object') this.data = { v: 1 };
    COLL.forEach(c => { if (!Array.isArray(this.data[c])) this.data[c] = []; });
  },
  save() { ls('mf_data', JSON.stringify(this.data)); },
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
  cfg() { const c = this.get('einstellungen', 'cfg') || {}; const o = Object.assign(clone(DEF_CFG), c); o.firma = Object.assign({}, DEF_CFG.firma, c.firma || {}); return o; },
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

/* ================= Kunden, Artikel, Rechnungsberechnung ================= */
const kunde = id => Store.get('kunden', id);
const kName = id => kunde(id)?.name || '(ohne Kunde)';
const kLabel = k => `${k.name}${k.nr ? ' (' + k.nr + ')' : ''}${k.ort ? ' – ' + k.ort : ''}`;
const byName = (a, b) => a.name.localeCompare(b.name, 'de');
const kundenSorted = () => Store.all('kunden').sort(byName);
const artSorted = () => Store.all('artikel').sort((a, b) => String(a.artNr).localeCompare(String(b.artNr), 'de', { numeric: true }));
const artByNr = nr => { const k = nrKey(nr); return k ? Store.all('artikel').find(a => nrKey(a.artNr) === k) : null; };
const kAdrOk = k => !!(k && k.name && k.plz && k.ort);
const kAdr = k => k ? { name: k.name, strasse: k.strasse, hausnr: k.hausnr, plz: k.plz, ort: k.ort, land: k.land || 'CH' } : null;

function calc(r) {
  const inkl = !!r.inkl, G = new Map();
  const rows = (r.pos || []).map(p => {
    const typ = p.typ || 'pos';
    if (typ !== 'pos') return Object.assign({}, p, { betrag: null });
    const b = r2((p.menge ?? 1) * (p.preis || 0) * (1 - (p.rabatt || 0) / 100));
    const s = +p.mwst || 0; G.set(s, r2((G.get(s) || 0) + b));
    return Object.assign({}, p, { betrag: b });
  });
  const groups = [...G.entries()].sort((a, b) => b[0] - a[0]).map(([satz, sum]) => {
    const mwst = satz ? r2(inkl ? sum * satz / (100 + satz) : sum * satz / 100) : 0;
    return { satz, netto: inkl ? r2(sum - mwst) : sum, mwst, brutto: inkl ? sum : r2(sum + mwst) };
  });
  const netto = r2(groups.reduce((s, g) => s + g.netto, 0)), mwst = r2(groups.reduce((s, g) => s + g.mwst, 0));
  const roh = r2(netto + mwst), total = r.runden5 === false ? roh : round5(roh);
  return { rows, groups, netto, mwst, roh, rund: r2(total - roh), total };
}
const bezahlt = r => r2((r.zahlungen || []).reduce((s, z) => s + (+z.betrag || 0), 0));
const gebuehren = r => r2((r.mahnungen || []).reduce((s, m) => s + (+m.gebuehr || 0), 0));
const offenBetrag = r => r2(calc(r).total + gebuehren(r) - bezahlt(r));
const faelligAkt = r => (r.mahnungen || []).length ? r.mahnungen[r.mahnungen.length - 1].faellig : r.faellig;
function statusOf(r) {
  if (r.storno) return 'storniert';
  if (!r.nr && r.archiv) return 'archiv';
  if (!r.nr) return 'entwurf';
  if (offenBetrag(r) <= 0.004) return 'bezahlt';
  return faelligAkt(r) && faelligAkt(r) < todayIso() ? 'ueberfaellig' : 'offen';
}
const ST = { entwurf: ['Entwurf', 'info'], offen: ['Offen', ''], ueberfaellig: ['Überfällig', 'warn'], bezahlt: ['Bezahlt', 'ok'], storniert: ['Storniert', 'storno'], archiv: ['Archiviert', 'storno'] };
const stChip = r => { const s = statusOf(r), [l, c] = ST[s]; const m = (r.mahnungen || []).length; return `<span class="chip ${c}">${l}</span>${m && s !== 'bezahlt' && s !== 'storniert' ? ` <span class="chip warn small">${m}. Mahnstufe</span>` : ''}`; };
const isOP = r => ['offen', 'ueberfaellig'].includes(statusOf(r));
function nextNr() {
  const max = Store.all('rechnungen').reduce((m, r) => Math.max(m, parseInt(String(r.nr || r.nrRes || '').replace(/\D/g, '')) || 0, ...(r.freieNr || []).map(x => parseInt(x) || 0)), Math.max(0, ...(Store.cfg().freieNr || []).map(x => parseInt(x) || 0))); // freigewordene (cfg.freieNr), reservierte (auch archivierte) Nummern (zurückgenommene Rechnungen) zählen mit
  return String(Math.max(+Store.cfg().nextNr || 1, max + 1));
}
// v1.21: Entwürfe werden nie gelöscht, sondern storniert und archiviert (r.archiv) – zurückholen unter Entwürfe › Archiv
async function entwurfArchivieren(R) {
  R = R.filter(r => r && !r.nr && !r.archiv);
  if (!R.length) return false;
  const res = R.filter(r => r.nrRes), ein = R.filter(r => (r.quellen || []).some(q => q.app));
  const zeilen = R.slice(0, 12).map(r => `• ${kName(r.kunde)} – ${(r.pos || []).filter(p => (p.typ || 'pos') === 'pos').length} Positionen – CHF ${chf(calc(r).total)}${r.nrRes ? ' – reservierte Nr. ' + r.nrRes : ''}`).join('\n') + (R.length > 12 ? `\n… und ${R.length - 12} weitere` : '');
  const txt = `${R.length === 1 ? 'Diesen Rechnungsentwurf' : R.length + ' Rechnungsentwürfe'} stornieren und ins Archiv legen?\n\n${zeilen}`
    + '\n\nDer Entwurf verschwindet aus der Liste, bleibt aber gespeichert und kann unter Entwürfe › Archiv jederzeit zurückgeholt werden.'
    + (res.length ? `\n\nDie reservierte Nummer ${res.map(r => r.nrRes).join(', ')} bleibt gesperrt und wird nicht neu vergeben.` : '')
    + (ein.length ? '\n\nIn der IM-Verwaltung bzw. IM-Vermietung bleiben die Einträge als «an IM-Faktura gesendet» markiert.' : '');
  if (!await frage(txt, { ok: R.length === 1 ? 'Stornieren & archivieren' : R.length + ' archivieren', gefahr: true })) return false;
  const am = new Date().toISOString();
  Store.putMany('rechnungen', R.map(r => Object.assign(clone(r), { archiv: { am } })));
  toast(R.length === 1 ? 'Entwurf storniert und archiviert – zurückholen unter Entwürfe › Archiv' : R.length + ' Entwürfe archiviert – zurückholen unter Entwürfe › Archiv');
  return true;
}
function entwurfZurueck(id) {
  const r = Store.get('rechnungen', id); if (!r || !r.archiv) return;
  const n = clone(r); n.rueckArchiv = (n.rueckArchiv || []).concat([{ archiviert: r.archiv.am, zurueck: new Date().toISOString() }]); delete n.archiv;
  Store.put('rechnungen', n); toast('Entwurf zurückgeholt – er ist wieder unter Entwürfe');
}
function newRechnung(preset = {}) {
  const c = Store.cfg();
  return Object.assign({ id: uid(), nr: '', kunde: '', datum: todayIso(), frist: c.frist, titel: c.titel, betreff: '', textOben: c.textOben, textUnten: c.textUnten,
    inkl: !!c.preiseInkl, runden5: c.runden5 !== false, pos: [], zahlungen: [], mahnungen: [] }, preset);
}
const newPos = (p = {}) => Object.assign({ id: uid(), typ: 'pos', art: '', bez: '', menge: 1, einh: '', preis: null, mwst: Store.cfg().mwstDef, konto: '' }, p);
// QR-Daten einer Rechnung (Mahnung: offener Betrag inkl. Gebühren)
function qrData(r, betrag) {
  const c = Store.cfg(), k = r._k || kunde(r.kunde), cc = calc(r);
  return { iban: c.iban, cr: { name: c.firma.name, strasse: c.firma.strasse, hausnr: c.firma.hausnr, plz: c.firma.plz, ort: c.firma.ort, land: c.firma.land },
    betrag: betrag ?? cc.total, waehrung: 'CHF', db: kAdrOk(k) ? kAdr(k) : null, ref: r.ref || '', mitteilung: `Rechnung ${r.nr}`,
    rechnungsinfo: c.swico ? SwissQR.swico({ nr: r.nr, datum: r.datum, uid: c.firma.uid, mwst: cc.groups.filter(g => g.netto).map(g => ({ satz: g.satz, netto: g.netto })) }) : '' };
}
// Prüfung vor dem Abschliessen
// Abrechnungsperiode (v1.17): von/bis von Hand, sonst aus den Positionsdaten
function periode(r) {
  // v1.24: erstes und letztes Datum aller Positionen – Datum, Zeitraum von/bis (Übergabe) und Datumsangaben in der Bemerkung (z. B. «05.02.2026 – 05.08.2026»)
  const ds = [];
  (r.pos || []).forEach(p => { [p.datum, p.von, p.bis].forEach(d => { if (/^\d{4}-\d{2}-\d{2}$/.test(d || '')) ds.push(d); });
    if (!p.von && !p.bis) String(p.bem || '').replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, (m, d, mo, y) => { ds.push(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`); return m; }); });
  ds.sort();
  const von = r.perVon || ds[0] || '', bis = r.perBis || ds[ds.length - 1] || von;
  return von ? { von, bis, auto: !r.perVon && !r.perBis } : null;
}
function rechnungFehler(r) {
  const e = [], k = kunde(r.kunde), c = Store.cfg();
  if (!k) e.push('Kein Kunde gewählt');
  else if (!kAdrOk(k)) e.push(`Adresse von ${k.name} unvollständig (PLZ/Ort fehlen)`);
  if (!(r.pos || []).some(p => (p.typ || 'pos') === 'pos')) e.push('Keine Positionen');
  if (calc(r).total <= 0) e.push('Total muss grösser als 0 sein');
  if (!SwissQR.ibanOk(c.iban)) e.push('Noch keine gültige (QR-)IBAN unter Mehr › Firma & QR-Konto');
  return e;
}
// Abgeschlossene Rechnung zurück in die Entwürfe (v1.12): Nummer bleibt reserviert (nrRes) und wird beim erneuten Abschliessen wieder verwendet.
// Nicht möglich mit erfassten Zahlungen; Mahnungen werden verworfen.
function zurueckFehler(r) {
  if (!r.nr) return 'ist schon ein Entwurf';
  if (r.storno) return 'ist storniert – zuerst «Storno aufheben»';
  if ((r.zahlungen || []).length) return 'hat schon Zahlungen – zurücknehmen nur ohne Zahlungen möglich';
  return '';
}
function zuruecknehmen(r) {
  (r.rueck = r.rueck || []).push({ am: new Date().toISOString(), nr: r.nr, mahn: (r.mahnungen || []).length });
  r.nrRes = r.nr; r.nr = ''; r.ref = ''; r.abgeschlossen = ''; r.faellig = ''; r.mahnungen = [];
  return r;
}
// Artikelbeschreibung einer Position (v1.18): im Entwurf aus dem Artikel, beim Abschliessen in die Position übernommen (bleibt dann fest)
const posBeschr = (p, r) => p.beschr != null ? p.beschr : (r && r.nr) ? '' : ((p.art && artByNr(p.art)) || {}).beschr || '';
function abschliessen(r) {
  const c = Store.cfg();
  (r.pos || []).forEach(p => { if ((p.typ || 'pos') === 'pos' && p.beschr == null) { const b = posBeschr(p, null); if (b) p.beschr = b; } });
  r.nr = r.nrRes || nextNr(); delete r.nrRes; // zurückgenommene Rechnung behält ihre Nummer (und damit die QR-Referenz)
  r.ref = SwissQR.isQrIban(c.iban) ? SwissQR.makeRef(c.refPrefix, r.nr) : '';
  r.faellig = addDays(r.datum, r.frist ?? c.frist);
  r.abgeschlossen = new Date().toISOString();
  if (+c.nextNr <= +r.nr) Store.setCfg({ nextNr: +r.nr + 1 });
  return r;
}
