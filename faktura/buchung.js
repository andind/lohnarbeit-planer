/* IM-Faktura – Buchhaltung: Zahlungseingänge als Buchungen für AgroOffice (Abacus «XML-Buchungen», AbaConnect)
   Verbucht wird nur bei Zahlungseingang (vereinnahmte Entgelte):
     1. Bank (1020) an Hilfskonto (9904)            Totalbetrag der Zahlung
     2. Hilfskonto (9904) an Ertragskonto (34xx …)  je Konto und MWST-Satz, inkl. MWST, mit MWST-Code
   Debitoren werden nur per Stichtag (31.12.) als Liste ausgewertet. */
'use strict';

const DEF_BUCH = { bank: '1020', hilfs: '', mwstKonto: '2200', kontoStd: '3410', kontoGeb: '3600', kontoUeber: '9910',
  codes: { '8.1': '303', '2.6': '313', '3.8': '343' }, version: '2022.00', mandant: '', belegPrefix: '2', belegStellen: '4',
  zkonten: '1020 RB Betriebskonto; 1000 Kasse; 1025 Landikonto 8141; 1028 Landi Fakturatransfer; 1031 ZAF Pflanzerkonto' };
// Konten für Zahlungseingänge (Bank, Kasse, Landi …) aus «1020 Name; 1000 Name»
const zKonten = () => String(buchCfg().zkonten || '').split(/[;\n]+/).map(s => s.trim()).filter(Boolean).map(s => { const m = /^(\d{4})\s*(.*)$/.exec(s); return m ? { nr: m[1], name: m[2].trim() } : null; }).filter(Boolean);
const zKontoName = nr => { const k = zKonten().find(x => x.nr === String(nr)); return k ? `${k.nr} ${k.name}` : String(nr || ''); };
const zKontoOf = z => String(z.konto || buchCfg().bank);
// AgroOffice nimmt beim Import nur Konten 1000–8999 sowie 9910/9911 an → Hilfskonto 9904 geht nicht (Fehlerprotokoll 19.11.2026)
const kontoOk = k => { const n = +k; return (n >= 1000 && n <= 8999) || n === 9910 || n === 9911; };
const buchCfg = () => { const c = Store.cfg().buch || {}, o = Object.assign({}, DEF_BUCH, c, { codes: Object.assign({}, DEF_BUCH.codes, c.codes || {}) }); if (o.hilfs && !kontoOk(o.hilfs)) o.hilfs = ''; return o; };
// Beleg für AgroOffice (nur Ziffern): Präfix + Rechnungs-Nr. auf Stellen aufgefüllt – Standard 2 + 0002 = 20002
const belegNr = nr => { const B = buchCfg(), n = String(nr).replace(/\D/g, ''); return (String(B.belegPrefix || '').replace(/\D/g, '') + n.padStart(+B.belegStellen || 0, '0')).slice(0, 10); };
const isAus = z => !!z.aus || z.bem === 'Rest ausgebucht';
const posKonto = p => String(p.konto || artByNr(p.art)?.konto || buchCfg().kontoStd || '').trim();

// Betrag je Konto und MWST-Satz (inkl. MWST) einer Rechnung, Summe = Rechnungstotal (+ Mahngebühren)
function fitCents(G, T) {
  const out = G.map(g => Object.assign({}, g, { b: Math.round(g.b * 100) / 100 }));
  const diff = r2(T - out.reduce((s, g) => s + g.b, 0));
  if (diff && out.length) { const i = out.reduce((bi, g, j) => Math.abs(g.b) > Math.abs(out[bi].b) ? j : bi, 0); out[i].b = r2(out[i].b + diff); }
  return out;
}
function rGroups(r) {
  const c = calc(r), m = new Map();
  c.rows.forEach(p => (p.parts || []).forEach(t => { // v1.26: Rabatte anteilig auf Konto/MWST der rabattierten Positionen
    const s = +t.satz || 0, k = posKonto(Object.assign({}, p, { konto: t.konto, art: t.art || p.art })), b = r.inkl ? t.b : t.b * (1 + s / 100), key = k + '|' + s;
    m.set(key, (m.get(key) || 0) + b);
  }));
  let G = [...m.entries()].map(([key, b]) => { const [konto, s] = key.split('|'); return { konto, satz: +s, b }; });
  const raw = G.reduce((s, g) => s + g.b, 0);
  G = raw ? fitCents(G.map(g => Object.assign(g, { b: g.b * c.total / raw })), c.total) : [];
  const geb = gebuehren(r); if (geb) G.push({ konto: buchCfg().kontoGeb, satz: 0, b: geb });
  return G.filter(g => g.b);
}
const allocTo = (G, x) => { const T = G.reduce((s, g) => s + g.b, 0); return T ? fitCents(G.map(g => Object.assign({}, g, { b: g.b * x / T })), x) : []; };
// Aufteilung einer Zahlung (Teilzahlungen anteilig, Überzahlung auf Konto «unklar»)
function zahlTeile(r, z) {
  const G = rGroups(r), TT = r2(G.reduce((s, g) => s + g.b, 0)), B = buchCfg();
  const Z = (r.zahlungen || []).filter(x => !isAus(x)).slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || '') || String(a.id).localeCompare(String(b.id)));
  let vor = 0; for (const x of Z) { if (x.id === z.id) break; vor = r2(vor + (+x.betrag || 0)); }
  const v0 = Math.min(vor, TT), v1 = Math.min(r2(vor + +z.betrag), TT);
  const A0 = allocTo(G, v0), A1 = allocTo(G, v1);
  const teile = A1.map((g, i) => ({ konto: g.konto, satz: g.satz, b: r2(g.b - (A0[i]?.b || 0)) })).filter(t => t.b);
  const ueber = r2(+z.betrag - (v1 - v0)); if (ueber) teile.push({ konto: B.kontoUeber, satz: 0, b: ueber, ueber: true });
  return teile;
}
// alle Buchungen zu einer Liste von Zahlungen [{r, z}]
function buchungen(L) {
  const B = buchCfg(), out = [];
  L.forEach(({ r, z }) => {
    // AgroOffice liest die Beleg-Nr. nur als Zahl («IM-2» wurde zu 0, 19.11.2026) → Beleg = Rechnungs-Nr., «IM-<Nr.>» am Anfang des Buchungstexts
    const kn = kName(r.kunde).slice(0, 40), beleg = belegNr(r.nr), im = 'IM-' + r.nr;
    // mit Hilfskonto: Bank an Hilfskonto (Total), dann Hilfskonto an Ertrag; ohne: direkt Bank an Ertrag je Konto/MWST-Satz
    const zk = zKontoOf(z), gegen = B.hilfs || zk;
    if (B.hilfs) out.push({ datum: z.datum, beleg, soll: zk, haben: B.hilfs, betrag: r2(+z.betrag), satz: null, text: `${im} Zahlung ${kn}`, zid: z.id });
    zahlTeile(r, z).forEach(t => {
      const neg = t.b < 0, b = Math.abs(t.b);
      out.push({ datum: z.datum, beleg, soll: neg ? t.konto : gegen, haben: neg ? gegen : t.konto, betrag: b, satz: t.satz, mwst: t.satz ? r2(b * t.satz / (100 + t.satz)) : 0,
        code: t.satz ? (B.codes[String(t.satz)] || '') : '', steuerSeite: neg ? 'soll' : 'haben', text: `${im} ${B.hilfs ? '' : 'Zahlung '}${kn}${t.ueber ? ' Überzahlung' : ''}`, zid: z.id });
    });
  });
  return out;
}
const xe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const amt = n => Number(n).toFixed(2);
function abacusXml(BU) {
  const B = buchCfg();
  const entry = b => {
    const steuer = b.satz ? `
        <TaxData mode="SAVE">
          <TaxIncluded>I</TaxIncluded>
          <TaxType>0</TaxType>
          <UseCode>1</UseCode>
          <AmountData mode="SAVE"><Currency>CHF</Currency><Amount>${amt(b.mwst)}</Amount></AmountData>
          <KeyAmount>${amt(b.mwst)}</KeyAmount>
          <TaxRate>${b.satz}</TaxRate>
          <TaxCoefficient>100</TaxCoefficient>
          <Country>CH</Country>
          <TaxCode>${xe(b.code)}</TaxCode>
          <FlatRate>0</FlatRate>
        </TaxData>` : '';
    // erstes Konto (Sammelinfo) = Gegenkonto ohne Steuer, zweites (Einzelinfo) = Konto mit Steuer
    const steuerKonto = b.steuerSeite === 'soll' ? b.soll : b.haben, anderes = b.steuerSeite === 'soll' ? b.haben : b.soll;
    const dc1 = b.steuerSeite === 'soll' ? 'C' : 'D', dc2 = dc1 === 'D' ? 'C' : 'D';
    const first = b.satz == null ? b.soll : anderes, second = b.satz == null ? b.haben : steuerKonto, d1 = b.satz == null ? 'D' : dc1, d2 = b.satz == null ? 'C' : dc2;
    return `    <Entry mode="SAVE">
      <CollectiveInformation mode="SAVE">
        <EntryLevel>A</EntryLevel>
        <EntryType>S</EntryType>
        <Type>Normal</Type>
        <DebitCredit>${d1}</DebitCredit>${B.mandant ? `\n        <Client>${xe(B.mandant)}</Client>` : ''}
        <Division>0</Division>
        <KeyCurrency>CHF</KeyCurrency>
        <EntryDate>${b.datum}</EntryDate>
        <ValueDate>${b.datum}</ValueDate>
        <AmountData mode="SAVE"><Currency>CHF</Currency><Amount>${amt(b.betrag)}</Amount></AmountData>
        <KeyAmount>${amt(b.betrag)}</KeyAmount>
        <Account>${xe(first)}</Account>
        <TaxAccount>0</TaxAccount>
        <Text1>${xe(b.text.slice(0, 80))}</Text1>
        <DocumentNumber>${xe(b.beleg)}</DocumentNumber>
        <SingleCount>0</SingleCount>
      </CollectiveInformation>
      <SingleInformation mode="SAVE">
        <Type>Normal</Type>
        <DebitCredit>${d2}</DebitCredit>
        <EntryDate>${b.datum}</EntryDate>
        <ValueDate>${b.datum}</ValueDate>
        <AmountData mode="SAVE"><Currency>CHF</Currency><Amount>${amt(b.betrag)}</Amount></AmountData>
        <KeyAmount>${amt(b.betrag)}</KeyAmount>
        <Account>${xe(second)}</Account>
        <TaxAccount>${b.satz ? xe(B.mwstKonto) : 0}</TaxAccount>
        <Text1>${xe(b.text.slice(0, 80))}</Text1>
        <DocumentNumber>${xe(b.beleg)}</DocumentNumber>${steuer}
      </SingleInformation>
    </Entry>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<AbaConnectContainer>
  <TaskCount>1</TaskCount>
  <Task>
    <Parameter>
      <Application>FIBU</Application>
      <Id>XML Buchungen</Id>
      <MapId>AbaDefault</MapId>
      <Version>${xe(B.version)}</Version>${B.mandant ? `\n      <Mandant>${xe(B.mandant)}</Mandant>` : ''}
    </Parameter>
    <Transaction>
${BU.map(entry).join('\n')}
    </Transaction>
  </Task>
</AbaConnectContainer>
`;
}

/* ---------- Speicherort (Ordner für den AgroOffice-Import, nur Chrome/Edge am PC) ---------- */
const Dir = {
  db() { return new Promise((res, rej) => { const q = indexedDB.open('im-faktura', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async get() { try { const db = await this.db(); return await new Promise(res => { const t = db.transaction('kv').objectStore('kv').get('buchDir'); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); } catch { return null; } },
  async set(h) { const db = await this.db(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(h, 'buchDir'); t.oncomplete = res; t.onerror = res; }); },
  async clear() { const db = await this.db(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete('buchDir'); t.oncomplete = res; t.onerror = res; }); },
  async pick() { if (!window.showDirectoryPicker) { toast('Ordner wählen geht nur mit Chrome oder Edge am PC'); return; } try { const h = await showDirectoryPicker({ id: 'agrooffice', mode: 'readwrite' }); await this.set(h); ls('mf_buchdir', h.name); App.render(); toast('Ordner gespeichert: ' + h.name); } catch (e) { if (e.name !== 'AbortError') toast(e.message); } },
  async write(name, text) {
    const h = await this.get(); if (!h) return false;
    try {
      if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
      const f = await h.getFileHandle(name, { create: true }), w = await f.createWritable(); await w.write(text); await w.close(); return h.name;
    } catch (e) { toast('Ordner nicht beschreibbar: ' + e.message, 5000); return false; }
  }
};

/* ---------- Dialog «Buchungen für AgroOffice» ---------- */
function offeneZahlungen(bis) {
  const L = [];
  Store.all('rechnungen').filter(r => r.nr && !r.storno).forEach(r => (r.zahlungen || []).forEach(z => { if (!isAus(z) && !z.exp && (!bis || (z.datum || '') <= bis)) L.push({ r, z }); }));
  return L.sort((a, b) => (a.z.datum || '').localeCompare(b.z.datum || '') || String(a.r.nr).localeCompare(String(b.r.nr), 'de', { numeric: true }));
}
function buchDialog() {
  const bis = App.buchBis || todayIso(), L = offeneZahlungen(bis), B = buchCfg(), dir = ls('mf_buchdir');
  const fehlt = new Set(); L.forEach(({ r }) => (r.pos || []).forEach(p => { if ((p.typ || 'pos') === 'pos' && !p.konto && !artByNr(p.art)?.konto) fehlt.add(r.nr); }));
  const BU = buchungen(L), ohneCode = BU.some(b => b.satz && !b.code);
  const exp = (Store.cfg().buchExports || []).slice(-8).reverse();
  const bad = new Set(BU.flatMap(b => [b.soll, b.haben]).filter(k => !kontoOk(k)));
  openDlg('Buchungen für AgroOffice', `<p class="muted small">Verbucht werden nur Zahlungseingänge: ${B.hilfs ? `Zahlungskonto an ${esc(B.hilfs)} (Total), danach ${esc(B.hilfs)} an die Ertragskonten` : `Zahlungskonto (Bank ${esc(B.bank)}, Kasse …) direkt an die Ertragskonten`} je MWST-Satz (inkl. MWST, vereinnahmt), alle Teile einer Zahlung mit derselben Beleg-Nr. Ausgebuchte Restbeträge werden nicht gebucht.</p>
    ${bad.size ? `<div class="box warn small">AgroOffice nimmt nur Konten 1000–8999 sowie 9910/9911 an – ungültig: ${[...bad].map(esc).join(', ')} (Artikel bzw. Mehr › Buchhaltung anpassen).</div>` : ''}
    <div class="filters"><label class="fld" style="margin:0"><span>Zahlungen bis</span><input class="input" type="date" data-in="buchBis" value="${bis}"></label><span class="lbl">${L.length} Zahlungen · CHF ${chf(L.reduce((s, x) => s + +x.z.betrag, 0))} · ${BU.length} Buchungen</span></div>
    ${fehlt.size ? `<div class="box warn small">Ohne Konto beim Artikel (Standardkonto ${esc(B.kontoStd)} wird verwendet): Rechnung ${[...fehlt].map(esc).join(', ')}</div>` : ''}
    ${ohneCode ? '<div class="box warn small">Für einen MWST-Satz fehlt der AgroOffice-MWST-Code (Mehr › Buchhaltung).</div>' : ''}
    <div class="dscroll" style="max-height:46vh"><table class="dtab"><thead><tr><th>Datum</th><th>Beleg</th><th>Soll</th><th>Haben</th><th class="n">Betrag</th><th>MWST</th><th>Text</th></tr></thead><tbody>
    ${BU.map(b => `<tr class="${b.satz == null ? 'grp' : ''}"><td class="nowrap">${fmtDate(b.datum)}</td><td>${esc(b.beleg)}</td><td>${esc(b.soll)}</td><td>${esc(b.haben)}</td><td class="n">${chf(b.betrag)}</td><td class="small nowrap">${b.satz ? `${mwstTxt(b.satz)} ${esc(b.code || '?')} · ${chf(b.mwst)}` : b.satz === 0 ? 'ohne' : ''}</td><td class="small">${esc(b.text)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Keine neuen Zahlungen</td></tr>'}</tbody></table></div>
    <p class="small" style="margin-top:10px">Speicherort: ${dir ? `Ordner <b>${esc(dir)}</b>` : 'Download-Ordner'} ${window.showDirectoryPicker ? `· <a href="#" data-act="buchDir">${dir ? 'anderen Ordner wählen' : 'Ordner für AgroOffice wählen'}</a>` : ''}</p>
    ${exp.length ? `<details class="help"><summary>Frühere Exporte (${exp.length})</summary><table class="dtab">${exp.map(e => `<tr><td>${fmtDate(e.datum.slice(0, 10))} ${e.datum.slice(11, 16)}</td><td>${e.n} Zahlungen</td><td class="n">${chf(e.betrag)}</td><td><button type="button" class="btn small" data-act="buchAgain" data-id="${e.id}">⬇ nochmals</button><button type="button" class="btn small" data-act="buchUndo" data-id="${e.id}" title="Zahlungen wieder als nicht exportiert markieren">↺</button></td></tr>`).join('')}</table></details>` : ''}`,
    `<span class="spacer"></span><button class="btn" value="close">Schliessen</button>${L.length ? `<button class="btn primary" value="ok">⬇ Datei erstellen (${L.length} Zahlungen)</button>` : ''}`,
    { wide: true, onSubmit: (fd, btn) => { if (btn === 'ok') { buchExport(L); } } });
}
async function buchExport(L, againId) {
  const BU = buchungen(L), xml = abacusXml(BU), now = new Date(), id = againId || uid();
  const name = `IM-Faktura_Buchungen_${isoDate(now).replace(/-/g, '')}_${pad(now.getHours())}${pad(now.getMinutes())}.xml`;
  if (!againId) {
    const ch = new Map(); L.forEach(({ r, z }) => { const x = ch.get(r.id) || clone(r); const zz = x.zahlungen.find(q => q.id === z.id); if (zz) zz.exp = id; ch.set(r.id, x); });
    Store.putMany('rechnungen', [...ch.values()], { silent: true });
    const ex = (Store.cfg().buchExports || []).concat([{ id, datum: now.toISOString(), n: L.length, betrag: r2(L.reduce((s, x) => s + +x.z.betrag, 0)) }]).slice(-50);
    Store.setCfg({ buchExports: ex });
  }
  const dir = await Dir.write(name, xml);
  if (dir) toast(`${name} in Ordner ${dir} gespeichert`, 5000); else { download(name, xml, 'application/xml'); toast(`${BU.length} Buchungen exportiert`); }
  App.render();
}
function buchZahlungenOf(id) { const L = []; Store.all('rechnungen').forEach(r => (r.zahlungen || []).forEach(z => { if (z.exp === id) L.push({ r, z }); })); return L; }

/* ---------- Debitoren per Stichtag (für den Jahresabschluss) ---------- */
function debitorenExcel(stichtag) {
  const B = buchCfg(), rows = [];
  const L = Store.all('rechnungen').filter(r => r.nr && !r.storno && (r.datum || '') <= stichtag).map(r => {
    const geb = r2((r.mahnungen || []).filter(m => (m.datum || '') <= stichtag).reduce((s, m) => s + +m.gebuehr, 0));
    const bez = r2((r.zahlungen || []).filter(z => (z.datum || '') <= stichtag).reduce((s, z) => s + +z.betrag, 0));
    return { r, total: calc(r).total, geb, bez, offen: r2(calc(r).total + geb - bez) };
  }).filter(x => x.offen > 0.004).sort((a, b) => +a.r.nr - +b.r.nr);
  const keys = new Map();
  const det = L.map(x => { const G = allocTo(rGroups(Object.assign({}, x.r, { mahnungen: (x.r.mahnungen || []).filter(m => (m.datum || '') <= stichtag) })), x.offen), m = {};
    G.forEach(g => { const k = `${g.konto} ${g.satz ? mwstTxt(g.satz) : 'ohne'}`; keys.set(k, (keys.get(k) || 0) + g.b); m[k] = r2((m[k] || 0) + g.b); }); return m; });
  const K = [...keys.keys()].sort();
  rows.push(['Nr.', 'Datum', 'Kd-Nr.', 'Kunde', 'Total', 'Gebühren', `Bezahlt bis ${fmtDate(stichtag)}`, 'Offen', ...K.map(k => 'Offen ' + k)]);
  L.forEach((x, i) => { const k = kunde(x.r.kunde) || {}; rows.push([+x.r.nr || x.r.nr, x.r.datum, k.nr ? +k.nr || k.nr : '', k.name || '', x.total, x.geb || '', x.bez || '', x.offen, ...K.map(kk => det[i][kk] || '')]); });
  rows.push(['Total', '', '', '', '', '', '', r2(L.reduce((s, x) => s + x.offen, 0)), ...K.map(k => r2(keys.get(k)))]);
  download(`Debitoren_per_${stichtag}.xlsx`, xlsxBlob([{ name: 'Debitoren', rows }]));
  toast(`${L.length} offene Rechnungen per ${fmtDate(stichtag)} · Konto ${B.hilfs}/Forderungen`);
}
