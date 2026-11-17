/* IM-Faktura – Druck: Rechnung und Mahnung als A4-Seiten mit QR-Zahlteil (Seitenumbruch selbst berechnet) */
'use strict';

const PAGE = { h: 297, top: 9, bottom: 12, qr: 105, qrGap: 6 };
const logoSrc = () => Store.cfg().logo || 'logo.jpg';
let LOGO = { w: 1600, h: 360 };
function loadLogo() {
  return new Promise(res => { const i = new Image(); i.onload = () => { LOGO = { w: i.naturalWidth || 1600, h: i.naturalHeight || 360 }; res(); }; i.onerror = () => res(); i.src = logoSrc(); });
}
const docK = r => r._k || kunde(r.kunde);
const mwstTxt = s => (+s).toLocaleString('de-CH', { maximumFractionDigits: 2 }) + ' %';
const qtyTxt = n => n == null || n === '' ? '' : Number(n).toLocaleString('de-CH', { maximumFractionDigits: 3 });

function adrBlock(k) {
  if (!k) return '';
  return [k.anrede, k.name, k.zusatz, [k.strasse, k.hausnr].filter(Boolean).join(' '), [k.land && k.land !== 'CH' ? k.land + '-' + (k.plz || '') : k.plz, k.ort].filter(Boolean).join(' ')]
    .filter(x => String(x || '').trim()).map(esc).join('<br>');
}
// Kopf: Briefkopf (Logo), Adressfenster, Angaben, Titel
function docHead(r, { titel, meta, text }) {
  const c = Store.cfg(), k = docK(r), links = c.adrPos === 'links';
  const info = `<table class="dmeta">${meta.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>`;
  return `<img class="dlogo" src="${esc(logoSrc())}" alt="" style="aspect-ratio:${LOGO.w}/${LOGO.h}">
    <div class="dadr ${links ? 'l' : 'r'}">${links ? `<div class="dad">${adrBlock(k)}</div><div class="dinfo">${info}</div>` : `<div class="dinfo">${info}</div><div class="dad">${adrBlock(k)}</div>`}</div>
    <div class="dtitle">${esc(titel)}</div>${text ? `<div class="dtext">${esc(text).replace(/\n/g, '<br>')}</div>` : ''}`;
}
const contHead = (r, titel) => `<div class="dcont">${esc(titel)} · ${esc(docK(r)?.name || '')} – Fortsetzung</div>`;

function rechnungParts(r) {
  const c = Store.cfg(), cc = calc(r), k = docK(r), multi = cc.groups.length > 1 || cc.groups.some(g => g.satz);
  const titel = `${r.titel || 'Rechnung'} Nr. ${r.nr || '(Entwurf)'}`;
  const meta = [['Datum', `${c.ort ? c.ort + ', ' : ''}${fmtDate(r.datum)}`], ...(r.nr ? [['Rechnung Nr.', r.nr]] : []), ...(k?.nr ? [['Kunden-Nr.', k.nr]] : []),
    ['Zahlbar bis', fmtDate(r.faellig || addDays(r.datum, r.frist ?? c.frist))], ...(c.firma.uid ? [['MWST-Nr.', c.firma.uid]] : [])];
  const head = docHead(r, { titel: r.betreff ? `${titel} – ${r.betreff}` : titel, meta, text: r.textOben });
  const thead = `<thead><tr><th class="ca">Art.-Nr.</th><th>Bezeichnung</th><th class="n cm">Menge</th><th class="ce">Einh.</th><th class="n cp">Preis</th>${multi ? '<th class="n cv">MWST</th>' : ''}<th class="n cb">Betrag CHF</th></tr></thead>`;
  const rows = cc.rows.map(p => (p.typ === 'text' ? `<tr class="txt"><td></td><td colspan="${multi ? 6 : 5}">${esc(p.bez).replace(/\n/g, '<br>')}</td></tr>`
    : p.typ === 'titel' ? `<tr class="ttl"><td></td><td colspan="${multi ? 6 : 5}">${esc(p.bez)}</td></tr>`
    : `<tr><td class="ca">${esc(p.art || '')}</td><td>${esc(p.bez).replace(/\n/g, '<br>')}${p.rabatt ? `<span class="drab"> (Rabatt ${fmtNum(p.rabatt)} %)</span>` : ''}</td><td class="n">${qtyTxt(p.menge)}</td><td class="ce">${esc(p.einh || '')}</td><td class="n">${chf(p.preis)}</td>${multi ? `<td class="n">${mwstTxt(p.mwst || 0)}</td>` : ''}<td class="n">${chf(p.betrag)}</td></tr>`));
  const inkl = r.inkl;
  const sums = `<table class="dsum">
    ${cc.groups.map(g => inkl
      ? `<tr><td>Total ${g.satz ? 'inkl. ' + mwstTxt(g.satz) + ' MWST' : 'ohne MWST'}</td><td class="n">${chf(g.brutto)}</td></tr>${g.satz ? `<tr class="sm"><td>davon MWST ${mwstTxt(g.satz)} von ${chf(g.netto)}</td><td class="n">${chf(g.mwst)}</td></tr>` : ''}`
      : `<tr><td>Total ${g.satz ? 'exkl. MWST' + (cc.groups.length > 1 ? ' (' + mwstTxt(g.satz) + ')' : '') : 'ohne MWST'}</td><td class="n">${chf(g.netto)}</td></tr>${g.satz ? `<tr><td>MWST ${mwstTxt(g.satz)}</td><td class="n">${chf(g.mwst)}</td></tr>` : ''}`).join('')}
    ${cc.rund ? `<tr class="sm"><td>Rundung</td><td class="n">${chf(cc.rund)}</td></tr>` : ''}
    <tr class="tot"><td>Total CHF</td><td class="n">${chf(cc.total)}</td></tr></table>`;
  const foot = `${sums}<div class="dfoot">${r.textUnten ? esc(r.textUnten).replace(/\n/g, '<br>') + '<br>' : ''}Zahlbar bis ${fmtDate(r.faellig || addDays(r.datum, r.frist ?? c.frist))} (${r.frist ?? c.frist} Tage netto) mit dem untenstehenden QR-Zahlteil.</div>`;
  return { titel, head, thead, rows, foot, qr: r.nr ? qrData(r) : null };
}
// Mahnung: stufe = Index in r.mahnungen
function mahnungParts(r, idx) {
  const c = Store.cfg(), m = r.mahnungen[idx], st = c.mahn[Math.min(m.stufe, c.mahn.length - 1)] || {}, cc = calc(r), k = docK(r);
  const titel = m.titel || st.titel || 'Mahnung';
  const meta = [['Datum', `${c.ort ? c.ort + ', ' : ''}${fmtDate(m.datum)}`], ['Rechnung Nr.', r.nr], ...(k?.nr ? [['Kunden-Nr.', k.nr]] : []), ['Zahlbar bis', fmtDate(m.faellig)]];
  const head = docHead(r, { titel, meta, text: m.text ?? st.text });
  const thead = `<thead><tr><th>Beleg</th><th class="cd">Datum</th><th class="cd">Fällig</th><th class="n cb">Betrag CHF</th></tr></thead>`;
  const zahl = r2((r.zahlungen || []).filter(z => z.datum <= m.datum || !z.datum).reduce((s, z) => s + (+z.betrag || 0), 0));
  const geb = r.mahnungen.slice(0, idx + 1).filter(x => +x.gebuehr);
  const rows = [`<tr><td>${esc(r.titel || 'Rechnung')} Nr. ${esc(r.nr)}${r.betreff ? ' – ' + esc(r.betreff) : ''}</td><td class="cd">${fmtDate(r.datum)}</td><td class="cd">${fmtDate(r.faellig)}</td><td class="n">${chf(cc.total)}</td></tr>`,
    ...geb.map(x => `<tr><td>Mahngebühr ${esc(x.titel || '')}</td><td class="cd">${fmtDate(x.datum)}</td><td></td><td class="n">${chf(x.gebuehr)}</td></tr>`),
    ...(zahl ? [`<tr><td>Bereits bezahlt</td><td></td><td></td><td class="n">−${chf(zahl)}</td></tr>`] : [])];
  const offen = r2(cc.total + geb.reduce((s, x) => s + +x.gebuehr, 0) - zahl);
  const foot = `<table class="dsum"><tr class="tot"><td>Offener Betrag CHF</td><td class="n">${chf(offen)}</td></tr></table>
    <div class="dfoot">Zahlbar bis ${fmtDate(m.faellig)} mit dem untenstehenden QR-Zahlteil.</div>`;
  return { titel, head, thead, rows, foot, qr: Object.assign(qrData(r, offen), { mitteilung: `${titel} Rechnung ${r.nr}` }) };
}

// Höhen messen (mm) und auf Seiten verteilen
function measurer() {
  let m = $('#measure'); if (!m) { m = document.createElement('div'); m.id = 'measure'; m.className = 'doc'; document.documentElement.appendChild(m); }
  return html => { m.innerHTML = html; return m.getBoundingClientRect().height * 25.4 / 96; };
}
function paginate(P) {
  const h = measurer(), full = PAGE.h - PAGE.top - PAGE.bottom, withQr = PAGE.h - PAGE.qr - PAGE.top - PAGE.qrGap;
  const tab = (rows, th = true) => `<table class="itab">${th ? P.thead : ''}<tbody>${rows.join('')}</tbody></table>`;
  const headH = h(P.head), contH = h(contHead({ kunde: '' }, P.titel)), thH = h(tab([])), footH = h(P.foot) + 2;
  const rowH = P.rows.map(r => h(tab([r])) - thH);
  const pages = []; let cur = { rows: [], first: true }, y = headH + thH;
  P.rows.forEach((r, i) => {
    if (cur.rows.length && y + rowH[i] > full - 6) { pages.push(cur); cur = { rows: [] }; y = contH + thH; }
    cur.rows.push(r); y += rowH[i];
  });
  if (y + footH > full - 6) { pages.push(cur); cur = { rows: [], footOnly: true }; y = contH; }
  cur.foot = true; y += footH; pages.push(cur);
  let qrPage = pages.length - 1;
  if (P.qr && y > withQr) { pages.push({ rows: [], qrOnly: true }); qrPage = pages.length - 1; }
  return { pages, qrPage };
}
function renderDoc(P, r) {
  const { pages, qrPage } = paginate(P), n = pages.length;
  return pages.map((p, i) => `<div class="page doc">
    ${p.first ? P.head : contHead(r, P.titel)}
    ${p.rows.length ? `<table class="itab">${P.thead}<tbody>${p.rows.join('')}</tbody></table>` : ''}
    ${p.foot ? P.foot : ''}${p.qrOnly ? `<div class="dfoot">Zahlteil zu ${esc(P.titel)}</div>` : ''}
    ${n > 1 ? `<div class="dpno">Seite ${i + 1} von ${n}</div>` : ''}
    ${P.qr && i === qrPage ? qrBlock(P.qr) : ''}</div>`).join('');
}
function qrBlock(b) {
  const e = SwissQR.check(b);
  if (e.length) return `<div class="qrerr">QR-Zahlteil nicht möglich: ${esc(e.join(' · '))}</div>`;
  try { return SwissQR.html(b, { trennlinie: Store.cfg().trennlinie !== false }); } catch (x) { return `<div class="qrerr">QR-Zahlteil: ${esc(x.message)}</div>`; }
}
// docs: [{ r, mahnung: idx }]
async function docsHtml(docs) {
  await loadLogo();
  return docs.map(d => renderDoc(d.mahnung != null ? mahnungParts(d.r, d.mahnung) : rechnungParts(d.r), d.r)).join('');
}
async function printDocs(docs, { title, after } = {}) {
  if (!docs.length) return;
  const html = await docsHtml(docs);
  const pa = $('#printArea'); pa.innerHTML = html;
  document.body.classList.add('printing'); const oldT = document.title;
  if (title) document.title = title.replace(/[\\/:*?"<>|]/g, '-');
  let fertig = false;
  const done = () => { document.body.classList.remove('printing'); document.title = oldT; window.removeEventListener('afterprint', done); if (!fertig) { fertig = true; if (after) setTimeout(after, 200); } };
  window.addEventListener('afterprint', done);
  const imgs = [...pa.querySelectorAll('img')].filter(i => !i.complete);
  await Promise.race([Promise.all(imgs.map(i => new Promise(res => { i.onload = i.onerror = res; }))), new Promise(res => setTimeout(res, 3000))]);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}
const docTitle = docs => docs.length === 1 ? `${docs[0].mahnung != null ? 'Mahnung' : (docs[0].r.titel || 'Rechnung')} ${docs[0].r.nr || 'Entwurf'} ${kName(docs[0].r.kunde)}` : `${docs.length} Dokumente ${todayIso()}`;
// Vorschau im Fenster (verkleinert)
async function previewDocs(docs, { onPrint, onClose } = {}) {
  const html = await docsHtml(docs);
  openDlg('Vorschau', `<div class="pview"><div class="pscale">${html}</div></div>`,
    `<span class="small muted">PDF: im Druckfenster «Als PDF speichern» wählen.</span><span class="spacer"></span><button class="btn" value="close">Schliessen</button><button class="btn primary" value="print">🖨 Drucken / PDF</button>`,
    { wide: true, onSubmit: (fd, btn) => { if (btn === 'print') { if (onPrint) onPrint(); else printDocs(docs, { title: docTitle(docs) }); } else if (onClose) { setTimeout(onClose, 30); } } });
  const fit = () => { const v = $('.pview'), s = $('.pscale'); if (!v || !s) return; const k = Math.min(1, (v.clientWidth - 8) / (210 * 96 / 25.4)); s.style.zoom = k; };
  setTimeout(fit, 20);
}
