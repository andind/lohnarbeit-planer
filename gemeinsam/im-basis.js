/* IM-Programme – gemeinsame Bausteine (IM-Verwaltung, IM-Vermietung, IM-Faktura)
   Seit IMV v161 / IM-Vermietung v1.24 / IM-Faktura v1.36. Wird vor dem Programmcode geladen:
   <script src="gemeinsam/im-basis.js?v=1"> bzw. "../gemeinsam/im-basis.js?v=1".
   Bei jeder Änderung hier: IM_BASIS erhöhen, ?v= in den drei index.html anpassen und CACHE in allen drei sw.js erhöhen.
   Inhalt: $/$$, esc, ls (localStorage), dbxArg (Dropbox-Header), toast (grosse Meldung), frage/meldung (grosse Rückfragen),
   download, Excel-Datei ohne Bibliothek (xlsxBlob), Sicherungsstatus des NAS-Dienstes (sichLoad/sichHtml),
   gemeinsame Dropbox-Anmeldung (imTokUebernehmen/imTokUngueltig/imTokAbmelden, seit IM_BASIS 2). */
'use strict';
const IM_BASIS = '2';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ls = (key, val) => { try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch { return null; } };

const dbxArg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

function toast(msg, ms) { ms = ms || Math.max(4000, Math.min(9000, String(msg).length * 70)); const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }

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

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) { // ZIP ohne Kompression (für Excel ausreichend)
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  files.forEach(f => {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  });
  const csize = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const xCol = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function xSheet(rows) {
  const widths = rows[0].map((_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 400).map(r => String(r.at(c) ?? '').length + 2))));
  const cell = (v, r, c) => {
    const ref = xCol(c) + (r + 1);
    if (v == null || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${r === 0 ? ' s="1"' : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xEsc(v)}</t></is></c>`;
  };
  const last = xCol(rows[0].length - 1) + rows.length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('')}</sheetData>
${rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`;
}
function xlsxBlob(sheets) {
  const names = sheets.map(s => s.name.replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31));
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${names.map((n, i) => sheets[i].rows.length > 1 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xEsc(n)}'!$A$1:$${xCol(sheets[i].rows[0].length - 1)}$${sheets[i].rows.length}</definedName></definedNames>` : '').join('').replace(/<\/definedNames><definedNames>/g, '')}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F6B3A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xSheet(s.rows) }))
  ];
  return zipStore(files);
}

const SICH = { d: null, at: 0, busy: false, err: '' };
async function sichLoad(read, rerender, force) {
  if (SICH.busy || (!force && Date.now() - SICH.at < 300000)) return;
  SICH.busy = true; SICH.at = Date.now();
  try { SICH.d = await read('/Sicherungen/status.json'); SICH.err = SICH.d ? '' : 'noch keine Statusdatei'; } catch (e) { SICH.d = null; SICH.err = 'noch keine Statusdatei (NAS-Dienst ab Version 69 nötig)'; }
  SICH.busy = false; rerender();
}
function sichHtml(own, { pruefung = 'eigene' } = {}) {
  const D = SICH.d, e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (!D) return `<p class="small" style="color:var(--muted)">Automatische Sicherung: ${SICH.busy ? 'Status wird geladen …' : e(SICH.err || 'Status wird geladen …')}</p>`;
  const dt = x => x ? new Date(x).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '–', alt = Date.now() - Date.parse(D.stand) > 2 * 864e5;
  const fehler = (D.quellen || []).filter(q => q.aktiv && q.ok === false);
  const rows = (D.quellen || []).filter(q => q.aktiv).map(q => `<tr${q.name === own ? ' style="font-weight:600"' : ''}><td>${e(q.name)}</td><td>${q.ok === false ? `<span style="color:#b5580b">⚠ Fehler</span> <span class="small">${e(q.error)}</span>` : q.fehlt ? '<span class="small">keine Daten</span>' : `✓ ${e(dt(q.at))}${q.unv ? ' <span class="small">(unverändert)</span>' : ''}`}${q.warn ? ` <span style="color:#b5580b" class="small">weniger Einträge: ${e(q.warn.join(', '))}</span>` : ''}</td><td class="small">${e(q.counts || '')}</td></tr>`).join('');
  const P = D.pruefung, pts = P ? (P.punkte || []).filter(x => pruefung === 'alle' || x.prog === own) : [];
  return `<div class="sichbox" style="border:1px solid var(--line,#ddd);border-radius:10px;padding:10px 12px;margin:8px 0;${alt || fehler.length ? 'background:#fff4e5' : ''}">
    <p style="margin:0 0 6px"><b>Automatische Sicherung (NAS-Dienst)</b> – zuletzt ${e(dt(D.stand))}${alt ? ' <b style="color:#b5580b">· seit über 2 Tagen keine Sicherung – NAS-Dienst prüfen!</b>' : ''}<br><span class="small">${e(D.plan || '')} · Ablage ${e((D.ablage || []).join(' + '))} · Dropbox › Sicherungen</span></p>
    <table class="small" style="width:100%;border-collapse:collapse">${rows}</table>
    ${P && pruefung !== 'keine' ? `<p class="small" style="margin:8px 0 0"><b>Prüfung der Verknüpfungen zwischen den Programmen</b> (${e(dt(P.at))}): ${pts.length ? pts.map(x => `<br>${x.sev === 'fehler' ? '⚠' : 'ℹ'} ${pruefung === 'alle' ? e(x.prog) + ': ' : ''}${e(x.titel)} (${x.n}) – <span style="color:var(--muted)">${e(x.items.slice(0, 6).join(' · '))}${x.n > 6 ? ' …' : ''}</span>`).join('') : '✓ keine Auffälligkeiten'}</p>` : ''}
  </div>`;
}

/* ---------- Gemeinsame Dropbox-Anmeldung (IM_BASIS 2) ----------
   Alle IM-Programme laufen unter derselben Adresse mit derselben Dropbox-App. Hat ein Programm noch keine eigene Anmeldung,
   übernimmt es die eines anderen Programms auf diesem Gerät (der Refresh-Token gilt für die ganze Dropbox-App).
   Ein vom Server abgelehnter Refresh-Token wird gemerkt (im_tok_bad) und nicht mehr übernommen.
   Abmelden gilt für alle Programme auf dem Gerät – sonst würde die Anmeldung beim nächsten Start wieder übernommen.
   Die gleichen Schlüssel kennen auch IM-Applikationskarten und IM-Feldbereinigung (eigener Code, gleiche Regeln). */
const IM_TOK_KEYS = ['lp_tok', 'mf_tok', 'mv_tok', 'imstart_tok', 'appkarte.dbx.tok', 'feldber.dbx.tok'];
function imTokLese(k) { try { const t = JSON.parse(localStorage.getItem(k) || 'null'); return t && (t.refresh || t.access) ? t : null; } catch { return null; } }
function imTokBad() { try { return JSON.parse(localStorage.getItem('im_tok_bad') || '[]'); } catch { return []; } }
function imTokUebernehmen(own) {
  const eigen = imTokLese(own); if (eigen) return eigen;
  const bad = imTokBad();
  for (const k of IM_TOK_KEYS) {
    if (k === own) continue;
    const t = imTokLese(k);
    if (t && t.refresh && !bad.includes(t.refresh)) { const c = { access: t.access, refresh: t.refresh, exp: t.exp || 0 }; try { localStorage.setItem(own, JSON.stringify(c)); } catch { } return c; }
  }
  return null;
}
function imTokUngueltig(t) { if (!t || !t.refresh) return; const b = imTokBad(); if (!b.includes(t.refresh)) { b.push(t.refresh); try { localStorage.setItem('im_tok_bad', JSON.stringify(b.slice(-10))); } catch { } } }
function imTokAbmelden() { IM_TOK_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch { } }); }
