/* IM-Faktura – Buchhaltung: Zahlungseingänge als Buchungen für AgroOffice (Abacus «XML-Buchungen», AbaConnect)
   Verbucht wird nur bei Zahlungseingang (vereinnahmte Entgelte):
     Zahlungskonto (Bank 1020, Kasse …) an Ertragskonto je Konto und MWST-Code, inkl. MWST
   Debitoren werden nur per Stichtag (31.12.) als Liste ausgewertet. */
'use strict';

const DEF_BUCH = { bank: '1020', mwstKonto: '2200', kontoStd: '3410', kontoAufw: '4000', kontoGeb: '3600', kontoUeber: '9910', hilfs: '9906', // v1.37: Hilfskonto für Zahlungseingänge (Andreas 20.11.2026)
 
  codes: { '8.1': '303', '2.6': '313', '3.8': '343', // v1.31: Code = Ziffer der ESTV-Abrechnung (effektiv), so in AgroOffice (Andreas 19.11.2026)
    ...Object.fromEntries(['8.1', '2.6', '3.8'].flatMap(s => [[`e:${s}`, { '8.1': '303', '2.6': '313', '3.8': '343' }[s]], [`e:${s}:235`, '235'], [`e:${s}:205`, '205'], [`e:${s}:235:205`, '235']])),
    ...Object.fromEntries(['220', '221', '225', '230', '280', '900', '910', '99'].map(z => [`e:0:${z}`, z])),
    ...Object.fromEntries(['8.1', '2.6', '3.8', 'urp'].flatMap(s => [[`a:${s}:v1`, '400'], [`a:${s}:v2`, '405']])) }, version: '2022.00', mandant: '', belegPrefix: '2', belegStellen: '4',
  zkonten: '1020 RB Betriebskonto; 1000 Kasse; 1025 Landikonto 8141; 1028 Landi Fakturatransfer; 1031 ZAF Pflanzerkonto' };
// Konten für Zahlungseingänge (Bank, Kasse, Landi …) aus «1020 Name; 1000 Name»
const zKonten = () => String(buchCfg().zkonten || '').split(/[;\n]+/).map(s => s.trim()).filter(Boolean).map(s => { const m = /^(\d{4})\s*(.*)$/.exec(s); return m ? { nr: m[1], name: m[2].trim() } : null; }).filter(Boolean);
const zKontoName = nr => { const k = zKonten().find(x => x.nr === String(nr)); return k ? `${k.nr} ${k.name}` : String(nr || ''); };
const zKontoOf = z => String(z.konto || buchCfg().bank);
// AgroOffice nahm 9904 nicht an (Fehlerprotokoll 19.11.2026: nur 1000–8999 sowie 9910/9911); Hilfskonto 9906 ist in AgroOffice eingerichtet (20.11.2026)
const kontoOk = k => { const n = +k; return (n >= 1000 && n <= 8999) || [9906, 9910, 9911].includes(n) || String(k) === String(buchCfg().hilfs || ''); };
const buchCfg = () => { const c = Store.cfg().buch || {}, o = Object.assign({}, DEF_BUCH, c, { codes: Object.assign({}, DEF_BUCH.codes, c.codes || {}) }); if (!/^\d{4}$/.test(String(o.hilfs || ''))) o.hilfs = DEF_BUCH.hilfs; return o; };
// Beleg für AgroOffice (nur Ziffern): Präfix + Rechnungs-Nr. auf Stellen aufgefüllt – Standard 2 + 0002 = 20002
const belegNr = nr => { const B = buchCfg(), n = String(nr).replace(/\D/g, ''); return (String(B.belegPrefix || '').replace(/\D/g, '') + n.padStart(+B.belegStellen || 0, '0')).slice(0, 10); };
const isAus = z => !!z.aus || z.bem === 'Rest ausgebucht';
const posKonto = p => String(p.konto || artByNr(p.art)?.konto || buchCfg().kontoStd || '').trim();
const KONTENPLAN = [ // v1.32: AgroOffice-Kontenplan (Ertrag 3xxx, Aufwand 4xxx–6xxx) – Auswahl für Positionen und Artikel
  ['3010', 'Weizen', 'Ertrag Pflanzenbau'],
  ['3020', 'Gerste', 'Ertrag Pflanzenbau'],
  ['3022', 'Triticale', 'Ertrag Pflanzenbau'],
  ['3024', 'Hafer', 'Ertrag Pflanzenbau'],
  ['3032', 'Zuckerrüben', 'Ertrag Pflanzenbau'],
  ['3036', 'Raps', 'Ertrag Pflanzenbau'],
  ['3038', 'Mais', 'Ertrag Pflanzenbau'],
  ['3042', 'Sojabohnen', 'Ertrag Pflanzenbau'],
  ['3046', 'Eiweisserbsen', 'Ertrag Pflanzenbau'],
  ['3060', 'Übriger Ertrag Pflanzenbau', 'Ertrag Pflanzenbau'],
  ['3062', 'Raufutter', 'Ertrag Pflanzenbau'],
  ['3064', 'Stroh', 'Ertrag Pflanzenbau'],
  ['3078', 'Holz', 'Ertrag Pflanzenbau'],
  ['3126', 'grosses Mastvieh', 'Ertrag Tierhaltung'],
  ['3170', 'Übriger Ertrag Tierhaltung', 'Ertrag Tierhaltung'],
  ['3201', 'Handelsertrag Pflanzenschutzmittel', 'Ertrag Handelsprodukte'],
  ['3202', 'Handelsertrag Saatgut', 'Ertrag Handelsprodukte'],
  ['3410', 'Arbeit für Dritte / Lohnbetrieb', 'Übriger Ertrag'],
  ['3411', 'Vermietung Maschinen', 'Übriger Ertrag'],
  ['3412', 'Mähdrescherei', 'Übriger Ertrag'],
  ['3413', 'Direktsaat', 'Übriger Ertrag'],
  ['3414', 'Rübenernte', 'Übriger Ertrag'],
  ['3415', 'Pensionspferde', 'Übriger Ertrag'],
  ['3416', 'Forstarbeiten', 'Übriger Ertrag'],
  ['3500', 'Verschiedene Direktzahlungen (ohne Details)', 'Direktzahlungen'],
  ['3600', 'Übriger Ertrag', 'Übriger Ertrag'],
  ['3710', 'Naturalbezüge', 'Lieferungen an Betrieb und privat'],
  ['3800', 'Skonti', 'Ertragsminderung'],
  ['3805', 'Verluste Forderungen, Veränderung Wertber.', 'Ertragsminderung'],
  ['3900', 'Bestandesänderungen unfertige Erzeugnisse', 'Bestandesänderung Ertrag'],
  ['3901', 'Bestandesänderungen fertige Erzeugnisse', 'Bestandesänderung Ertrag'],
  ['3910', 'Bestandesänderungen Pflanzenbau', 'Bestandesänderung Ertrag'],
  ['3914', 'Bestandesänderungen Rindvieh', 'Bestandesänderung Ertrag'],
  ['3915', 'Bestandesänderungen Masttiere', 'Bestandesänderung Ertrag'],
  ['3918', 'Bestandesänderungen Schweine', 'Bestandesänderung Ertrag'],
  ['3919', 'Bestandesänderungen übrige Tiere', 'Bestandesänderung Ertrag'],
  ['3940', 'Bestandesänd. nicht fakt. Dienstleistungen', 'Bestandesänderung Ertrag'],
  ['4010', 'Saatgut und Pflanzgut', 'Aufwand Pflanzenbau'],
  ['4020', 'Dünger', 'Aufwand Pflanzenbau'],
  ['4030', 'Pflanzenschutz', 'Aufwand Pflanzenbau'],
  ['4040', 'Verarbeitungskosten', 'Aufwand Pflanzenbau'],
  ['4050', 'Hagelversicherung', 'Aufwand Pflanzenbau'],
  ['4060', 'Arbeit durch Dritte Pflanzbau', 'Aufwand Pflanzenbau'],
  ['4070', 'Übriger Aufwand Pflanzenbau', 'Aufwand Pflanzenbau'],
  ['4117', 'Zukauf Mastremonten', 'Aufwand Tierhaltung'],
  ['4120', 'Zukauf Kraftfutter Rindvieh', 'Aufwand Tierhaltung'],
  ['4123', 'Mineralstoff, Vitamine Rindvieh', 'Aufwand Tierhaltung'],
  ['4124', 'Tierarzt, Medikamente Rindvieh', 'Aufwand Tierhaltung'],
  ['4126', 'Viehversicherung Rindvieh', 'Aufwand Tierhaltung'],
  ['4129', 'Übriger Aufwand Rindvieh', 'Aufwand Tierhaltung'],
  ['4170', 'Übriger Aufwand Tierhaltung', 'Aufwand Tierhaltung'],
  ['4175', 'Zukauf Raufutter, Stroh', 'Aufwand Tierhaltung'],
  ['4410', 'Abrechnung Maschinengeminschaften', 'Übriger Aufwand'],
  ['4600', 'Hilfs- und Verbrauchsmaterial', 'Übriger Aufwand'],
  ['4800', 'Bestandesänderungen Vorräte', 'Bestandesänderung Aufwand'],
  ['5000', 'Löhne', 'Personalkosten'],
  ['5001', 'Entschädigung Hans Indermühle', 'Personalkosten'],
  ['5005', 'Leistungen von Sozialversicherungen', 'Personalkosten'],
  ['5020', 'Kost + Logis (Angestellte)', 'Personalkosten'],
  ['5100', 'Naturallöhne Hans', 'Personalkosten'],
  ['5700', 'AHV, IV, EO, ALV Angestellte', 'Personalkosten'],
  ['5720', 'Berufliche Vorsorge Angestellte', 'Personalkosten'],
  ['5740', 'Krankentaggeldversicherung Angestellte', 'Personalkosten'],
  ['5890', 'Privatanteile Personalaufwand', 'Aufwandsminderung'],
  ['5910', 'Persönliche AHV, IV, EO, FZ', 'Personalkosten'],
  ['5920', 'Persönliche berufliche Vorsorge', 'Personalkosten'],
  ['5930', 'Persönliche Unfallversicherung', 'Personalkosten'],
  ['5940', 'Persönliche Taggeldversicherung', 'Personalkosten'],
  ['6000', 'Pachtzins Gewerbe', 'Übriger Aufwand'],
  ['6002', 'Pachtzins Grundstücke', 'Übriger Aufwand'],
  ['6100', 'Unterhalt Maschinen', 'Übriger Aufwand'],
  ['6104', 'Unterhalt Rübenernte', 'Übriger Aufwand'],
  ['6105', 'Kleingeräte, Werkzeuge', 'Übriger Aufwand'],
  ['6150', 'Unterhalt feste Einrichtungen', 'Übriger Aufwand'],
  ['6160', 'Maschinenmiete', 'Übriger Aufwand'],
  ['6161', 'Arbeiten durch Dritte Allgemein', 'Übriger Aufwand'],
  ['6200', 'Unterhalt, Rep. Fahrzeuge, Zugkräfte', 'Übriger Aufwand'],
  ['6201', 'Wartung/Reparaturen Mähdrescher', 'Übriger Aufwand'],
  ['6210', 'Betriebsstoffe Fahrzeuge, Zugkräfte', 'Übriger Aufwand'],
  ['6211', 'Betriebsstoffe Mähdrescher', 'Übriger Aufwand'],
  ['6220', 'Versicherungen Fahrzeuge, Zugkräfte', 'Übriger Aufwand'],
  ['6221', 'Versicherungen Mähdrescher', 'Übriger Aufwand'],
  ['6230', 'Verkehrsabgaben Fahrzeuge, Zugkräfte', 'Übriger Aufwand'],
  ['6231', 'Verkehrsabgaben Mähdrescher', 'Übriger Aufwand'],
  ['6240', 'Unterhalt / Rep. Auto', 'Autokosten'],
  ['6241', 'Treibstoff Auto', 'Autokosten'],
  ['6242', 'Versicherungen Auto', 'Autokosten'],
  ['6243', 'Verkehrsabgaben, Gebühren Auto', 'Autokosten'],
  ['6270', 'Privatanteil Fahrzeugaufwand', 'Aufwandsminderung'],
  ['6300', 'Sachversicherungen', 'Übriger Aufwand'],
  ['6360', 'Abgaben und Gebühren', 'Übriger Aufwand'],
  ['6400', 'Elektrizität', 'Übriger Aufwand'],
  ['6420', 'Heizung', 'Übriger Aufwand'],
  ['6430', 'Wasser', 'Übriger Aufwand'],
  ['6460', 'Entsorgung, Abfall', 'Übriger Aufwand'],
  ['6470', 'Privatanteil Strom, Tel, Heizung', 'Aufwandsminderung'],
  ['6500', 'Büromaterial, Fachliteratur', 'Übriger Aufwand'],
  ['6510', 'Telefon, Internet, Porti', 'Übriger Aufwand'],
  ['6530', 'Buchführungs- und Beratungsaufwand', 'Übriger Aufwand'],
  ['6560', 'Informatik', 'Übriger Aufwand'],
  ['6700', 'Sonstiger Betriebsaufwand', 'Übriger Aufwand'],
  ['6790', 'Privatanteile', 'Aufwandsminderung'],
  ['6800', 'Wertber. Wertschriften des Anlagevermögens', 'Übriger Aufwand'],
  ['6820', 'Abschr. u. Wertber. Maschinen/Apparate', 'Übriger Aufwand'],
  ['6823', 'Abschr. und Wertber. Fahrzeuge', 'Übriger Aufwand'],
  ['6824', 'Abschr. und Wertber. Personenwagen', 'Übriger Aufwand'],
  ['6827', 'Abschr. u. Wertber. feste Einricht./Installationen', 'Übriger Aufwand'],
  ['6830', 'Abschr. u. Wertber. Immob.Sachanl. (o.Det.)', 'Übriger Aufwand'],
  ['6832', 'Abschr. und Wertber. Ökonomiegebäude', 'Übriger Aufwand'],
  ['6833', 'Abschr. und Wertber. Leichtbauten', 'Übriger Aufwand'],
  ['6836', 'Abschr. und Wertber. Wohnhaus', 'Übriger Aufwand'],
  ['6838', 'Abschr. und Wertber. Boden', 'Übriger Aufwand'],
  ['6900', 'Bankkreditzinsaufwand', 'Übriger Aufwand'],
  ['6940', 'Bankspesen', 'Übriger Aufwand'],
  ['6943', 'Kursverlust Finanzanlagen', 'Übriger Aufwand'],
  ['6950', 'Erträge aus Bankguthaben', 'Übriger Ertrag'],
  ['6960', 'Erträge aus Wertschriften des Anlageverm.', 'Übriger Ertrag']
];
const kpName = nr => (KONTENPLAN.find(k => k[0] === String(nr)) || [])[1] || '';
const kpOk = nr => KONTENPLAN.some(k => k[0] === String(nr));
const kpTxt = nr => nr ? `${nr}${kpName(nr) ? ' ' + kpName(nr) : ''}` : '';
// Konto einer Position ohne Standard-Rückfall (Prüfung vor dem Abschliessen): eigenes Konto, sonst Konto des Artikels (Aufwand: Aufwandkonto des Artikels)
const posKontoEig = p => String(p.konto || (isAufw(p) ? artByNr(p.art)?.kontoAufw : artByNr(p.art)?.konto) || '').trim();
const aufwOhne = p => isAufw(p) && !bookSatz(p); // v1.33: Aufwand, der ohne MWST gebucht wird (Ohne MWST oder keine Vorsteuer) – braucht keinen MWST-Code
const posCode = p => aufwOhne(p) ? String(p.code || '') : String(p.code || buchCfg().codes[codeKey(p)] || (!isAufw(p) && buchCfg().codes[String(+p.mwst || 0)]) || '');
const codeNoetig = p => !aufwOhne(p); // nur Aufwand ohne MWST (Ohne MWST bzw. keine Vorsteuer) darf ohne MWST-Code abgeschlossen werden
function posBuchFehler(p) {
  if ((p.typ || 'pos') !== 'pos') return [];
  const e = [], k = posKontoEig(p);
  if (!k) e.push('AgroOffice-Konto fehlt'); else if (!kpOk(k)) e.push(`Konto ${k} nicht im Kontenplan`);
  if (codeNoetig(p) && !posCode(p)) e.push('MWST-Code fehlt');
  return e;
}
// v1.32: Auswahlfenster Kontenplan (eigenes Fenster über dem offenen Dialog) → Promise { nr, art } oder null
function kontoWahl({ cur = '', aufwand = false, info = '', artikel = null } = {}) {
  if (!document.getElementById('kwahlCss')) {
    const st = document.createElement('style'); st.id = 'kwahlCss';
    st.textContent = `dialog.kwahl{border:0;border-radius:16px;padding:0;width:min(760px,96vw);max-height:92vh;background:var(--surface,#fff);color:var(--text,#1d211e);box-shadow:0 18px 60px rgba(0,0,0,.45);font-family:inherit;display:flex;flex-direction:column}
dialog.kwahl:not([open]){display:none}dialog.kwahl::backdrop{background:rgba(0,0,0,.45)}
.kw-h{padding:20px 24px 10px}.kw-h h2{margin:0 0 6px;font-size:20px}.kw-info{font-size:15px;white-space:pre-line;color:var(--muted,#5d665f)}
.kw-h input[type=search]{width:100%;font:inherit;font-size:17px;padding:10px 12px;border-radius:10px;border:2px solid var(--line,#c9cfc9);margin-top:10px;box-sizing:border-box}
.kw-l{overflow:auto;padding:0 24px 8px;flex:1;min-height:200px}.kw-g{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#5d665f);margin:12px 0 4px}
.kw-l button{display:flex;gap:12px;width:100%;text-align:left;font:inherit;font-size:16px;padding:8px 10px;border:0;border-radius:8px;background:none;color:inherit;cursor:pointer}
.kw-l button:hover,.kw-l button:focus-visible{background:var(--surface-2,#eef2ee);outline:none}.kw-l button.on{background:var(--accent,#2f6b3f);color:#fff}.kw-l button b{min-width:46px}
.kw-f{display:flex;gap:14px;align-items:center;padding:12px 24px 20px;flex-wrap:wrap;border-top:1px solid var(--line,#ddd)}.kw-f label{font-size:15px;flex:1}
.kw-f button{font:inherit;font-size:17px;font-weight:600;padding:11px 24px;border-radius:12px;cursor:pointer;border:2px solid var(--line,#c9cfc9);background:var(--surface-2,#f2f2ee);color:inherit}`;
    document.head.appendChild(st);
  }
  return new Promise(res => {
    const d = document.createElement('dialog'); d.className = 'kwahl';
    const G = []; KONTENPLAN.forEach(([nr, name, g]) => { const t = (+nr[0] === 3 ? 'Ertrag' : 'Aufwand') + ' · ' + g; let x = G.find(y => y.t === t); if (!x) G.push(x = { t, auf: +nr[0] > 3, L: [] }); x.L.push([nr, name]); });
    G.sort((a, b) => (aufwand ? b.auf - a.auf : a.auf - b.auf) || +a.L[0][0] - +b.L[0][0]);
    d.innerHTML = `<div class="kw-h"><h2>AgroOffice-Konto wählen</h2><div class="kw-info"></div><input type="search" placeholder="Suchen: Nummer oder Name (z. B. 3410, Saatgut, Lohn) …"></div>
      <div class="kw-l">${G.map(g => `<div class="kw-gr"><div class="kw-g">${esc(g.t)}</div>${g.L.map(([nr, n]) => `<button type="button" data-nr="${nr}" data-s="${esc(fold(nr + ' ' + n + ' ' + g.t))}" class="${nr === String(cur) ? 'on' : ''}"><b>${nr}</b><span>${esc(n)}</span></button>`).join('')}</div>`).join('')}</div>
      <div class="kw-f">${artikel ? `<label><input type="checkbox" class="kw-art" checked> Konto auch im Artikel ${esc(artikel.artNr || '')} «${esc(artikel.bez || '')}» speichern</label>` : '<span style="flex:1"></span>'}<button type="button" class="kw-no">Ohne Konto weiter</button></div>`;
    d.querySelector('.kw-info').textContent = info || 'Konto für die Buchhaltung (AgroOffice) wählen.';
    document.body.appendChild(d);
    let fertig = false;
    const done = v => { if (fertig) return; fertig = true; const art = !!(artikel && d.querySelector('.kw-art')?.checked); d.close(); d.remove(); res(v ? { nr: v, art } : null); };
    const q = d.querySelector('input[type=search]'), B = [...d.querySelectorAll('.kw-l button')];
    const filt = () => { const f = fold(q.value.trim()); B.forEach(b => b.hidden = !!f && !b.dataset.s.includes(f)); d.querySelectorAll('.kw-gr').forEach(g => g.hidden = ![...g.querySelectorAll('button')].some(b => !b.hidden)); };
    q.addEventListener('input', filt);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = B.filter(b => !b.hidden); if (v.length === 1 || (v.length && /^\d{4}$/.test(q.value.trim()) && v[0].dataset.nr === q.value.trim())) done(v[0].dataset.nr); } });
    B.forEach(b => b.addEventListener('click', () => done(b.dataset.nr)));
    d.querySelector('.kw-no').addEventListener('click', () => done(null));
    d.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    d.showModal(); setTimeout(() => { q.focus(); const on = d.querySelector('.kw-l button.on'); if (on) on.scrollIntoView({ block: 'center' }); }, 30);
  });
}

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
    const s = +t.satz || 0, k = String(t.ck || '').startsWith('a:') ? String(t.konto || artByNr(t.art || p.art)?.kontoAufw || buchCfg().kontoAufw || '4000') : posKonto(Object.assign({}, p, { konto: t.konto, art: t.art || p.art })), b = r.inkl ? t.b : t.b * (1 + s / 100), key = [k, s, t.code || '', t.ck || '', t.bs ?? s, t.urp ? 1 : 0].join('|');
    m.set(key, (m.get(key) || 0) + b);
  }));
  let G = [...m.entries()].map(([key, b]) => { const [konto, s, code, ck, bs, urp] = key.split('|'); return { konto, satz: +s, code: code || '', ck: ck || '', bs: +bs, urp: urp === '1', b }; });
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
  const teile = A1.map((g, i) => ({ konto: g.konto, satz: g.satz, code: g.code || '', ck: g.ck, bs: g.bs, urp: g.urp, b: r2(g.b - (A0[i]?.b || 0)) })).filter(t => t.b);
  const ueber = r2(+z.betrag - (v1 - v0)); if (ueber) teile.push({ konto: B.kontoUeber, satz: 0, b: ueber, ueber: true });
  return teile;
}
// alle Buchungen zu einer Liste von Zahlungen [{r, z}]
function buchungen(L) {
  const B = buchCfg(), out = [];
  L.forEach(({ r, z }) => {
    // AgroOffice liest die Beleg-Nr. nur als Zahl («IM-2» wurde zu 0, 19.11.2026) → Beleg = Rechnungs-Nr., «IM-<Nr.>» am Anfang des Buchungstexts
    const kn = kName(r.kunde).slice(0, 40), beleg = belegNr(r.nr), im = 'IM-' + r.nr;
    // v1.37: über das Hilfskonto – Zahlungskonto an Hilfskonto (Gesamtbetrag, ohne MWST), dann Hilfskonto an Ertrag je Konto/MWST-Code
    const gegen = B.hilfs, T = zahlTeile(r, z), tot = r2(T.reduce((s, t) => s + t.b, 0));
    if (tot) out.push({ datum: z.datum, beleg, soll: tot < 0 ? gegen : zKontoOf(z), haben: tot < 0 ? zKontoOf(z) : gegen, betrag: Math.abs(tot), satz: null, mwst: 0, code: '', text: `${im} Zahlung ${kn}`, zid: z.id, total: true });
    T.forEach(t => {
      const neg = t.b < 0, b = Math.abs(t.b);
      const bs = t.bs ?? t.satz, code = t.code || (String(t.ck || '').startsWith('a:') && !bs ? '' : t.ck && B.codes[t.ck]) || ((!t.ck || t.ck.startsWith('e:')) && bs ? (B.codes[String(bs)] || '') : ''); // v1.30: Steuerart → Code
      out.push({ datum: z.datum, beleg, soll: neg ? t.konto : gegen, haben: neg ? gegen : t.konto, betrag: b, satz: bs, mwst: t.urp ? r2(b * 2.6 / 100) : bs ? r2(b * bs / (100 + bs)) : 0,
        code, steuerSeite: neg ? 'soll' : 'haben', text: `${im} Zahlung ${kn}${t.ueber ? ' Überzahlung' : ''}`, zid: z.id });
    });
  });
  return out;
}
const xe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const amt = n => Number(n).toFixed(2);
function abacusXml(BU) {
  const B = buchCfg();
  const entry = b => {
    const steuer = (b.satz || b.code) ? `
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
  openDlg('Buchungen für AgroOffice', `<p class="muted small">Verbucht werden nur Zahlungseingänge über das Hilfskonto ${esc(B.hilfs)}: Zahlungskonto (Bank ${esc(B.bank)}, Kasse …) an ${esc(B.hilfs)} mit dem Gesamtbetrag, danach ${esc(B.hilfs)} an die Erfolgskonten je MWST-Code (inkl. MWST, vereinnahmt), alle mit derselben Beleg-Nr. Ausgebuchte Restbeträge werden nicht gebucht.</p>
    ${bad.size ? `<div class="box warn small">AgroOffice nimmt nur Konten 1000–8999, das Hilfskonto sowie 9910/9911 an – ungültig: ${[...bad].map(esc).join(', ')} (Artikel bzw. Mehr › Buchhaltung anpassen).</div>` : ''}
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
  toast(`${L.length} offene Rechnungen per ${fmtDate(stichtag)}`);
}
