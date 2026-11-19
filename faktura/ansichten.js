/* IM-Faktura – Ansichten, Dialoge, Ereignisse, Start */
'use strict';

const App = {
  view: 'rechnungen', f: {}, sel: new Set(), sub: { stamm: 'kunden' }, imp: null, ed: null, edAfter: null,
  busy() { return $('#dlg').open; },
  init() {
    const ui = lsJson('mf_ui') || {};
    this.view = ui.view || 'rechnungen';
    this.f = Object.assign({ r: { jahr: '', status: '', kunde: '', q: '' }, op: { nurUeber: false, q: '' }, k: { q: '', alle: false }, a: { q: '' } }, ui.f || {});
    Object.assign(this.sub, ui.sub || {});
  },
  saveUi() { lsJson('mf_ui', { view: this.view, f: this.f, sub: this.sub }); },
  go(v) { this.view = v; this.sel.clear(); this.saveUi(); this.render(); },
  render() {
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === this.view));
    const V = { rechnungen: viewRechnungen, entwuerfe: viewEntwuerfe, op: viewOP, import: viewImport, stamm: viewStamm, mehr: viewMehr }[this.view] || viewRechnungen;
    const sc = $('.dscroll')?.scrollTop;
    const { tb, html } = V();
    $('#toolbar').innerHTML = tb; $('#content').innerHTML = html;
    if (sc && $('.dscroll')) $('.dscroll').scrollTop = sc;
    selBar();
  }
};
function openDlg(title, body, foot, { wide = false, onSubmit = null } = {}) {
  const d = $('#dlg'); d.classList.toggle('wide', wide);
  $('#dlgForm').innerHTML = `<div class="dh"><h2>${esc(title)}</h2><button type="button" class="x" data-act="dlgClose" aria-label="Schliessen">×</button></div><div class="db">${body}</div><div class="df">${foot}</div>`;
  $('#dlgForm').onsubmit = ev => { if (!onSubmit) return; ev.preventDefault(); if (onSubmit(new FormData($('#dlgForm')), ev.submitter?.value) !== false) closeDlg(); };
  if (!d.open) d.showModal();
  setTimeout(() => { const f = $('#dlgForm [autofocus]'); if (f && matchMedia('(min-width: 700px)').matches) f.focus(); }, 30);
}
function closeDlg() { const d = $('#dlg'); if (d.open) d.close(); App.render(); }
const optList = (items, val, empty) => (empty != null ? `<option value="">${esc(empty)}</option>` : '') + items.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
const mwstOpts = val => optList(Store.cfg().mwst.map(m => [m.satz, `${mwstTxt(m.satz)}`]).concat(Store.cfg().mwst.some(m => +m.satz === +val) || val == null ? [] : [[val, mwstTxt(val)]]), val);

/* ================= Rechnungen ================= */
function rechList() {
  const f = App.f.r, q = fold(f.q);
  return Store.all('rechnungen').filter(r => {
    if (f.jahr && !(r.datum || '').startsWith(f.jahr)) return false;
    if (f.status) { const s = statusOf(r); if (f.status === 'op' ? !isOP(r) : s !== f.status) return false; }
    if (f.kunde && r.kunde !== f.kunde) return false;
    if (q && !fold([r.nr, kName(r.kunde), kunde(r.kunde)?.nr, r.titel, r.betreff, ...(r.pos || []).map(p => p.bez)].join(' ')).includes(q)) return false;
    return true;
  }).sort((a, b) => (!b.nr) - (!a.nr) || (b.nr && a.nr ? (+b.nr - +a.nr) || String(b.nr).localeCompare(a.nr) : 0) || (b.datum || '').localeCompare(a.datum || ''));
}
function viewRechnungen() {
  const f = App.f.r, L = rechList(), years = [...new Set(Store.all('rechnungen').map(r => (r.datum || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const sum = L.filter(r => !r.storno).reduce((s, r) => s + calc(r).total, 0), off = L.filter(isOP).reduce((s, r) => s + offenBetrag(r), 0);
  const nE = Store.all('rechnungen').filter(r => statusOf(r) === 'entwurf').length;
  const tb = `<h1>Rechnungen</h1><button class="btn" data-act="journal">⬇ Excel</button>`;
  const html = `<div class="filters">
      <select class="input" data-in="fr" data-k="jahr">${optList(years.map(y => [y, y]), f.jahr, 'Alle Jahre')}</select>
      <select class="input" data-in="fr" data-k="status">${optList([['entwurf', `Entwürfe${nE ? ' (' + nE + ')' : ''}`], ['op', 'Offen + überfällig'], ['ueberfaellig', 'Überfällig'], ['bezahlt', 'Bezahlt'], ['storniert', 'Storniert']], f.status, 'Alle')}</select>
      <select class="input" data-in="fr" data-k="kunde" style="max-width:240px">${optList(kundenSorted().map(k => [k.id, kLabel(k)]), f.kunde, 'Alle Kunden')}</select>
      <input class="input search" type="search" placeholder="Suchen (Nr., Kunde, Text)…" data-in="frq" value="${esc(f.q)}">
      <span class="lbl">${L.length} Rechnungen · CHF ${chf(sum)}${off ? ' · offen ' + chf(off) : ''}</span></div>
    ${!Store.all('rechnungen').length ? `<div class="panel"><h2>Willkommen bei IM-Faktura</h2><p>So geht es los:</p><ol class="small muted">
      <li>Unter <a href="#" data-act="go" data-v="mehr">Mehr › Firma & QR-Konto</a> die <b>QR-IBAN</b> eintragen (steht im E-Banking bzw. auf dem Kontoblatt «QR-IBAN»).</li>
      <li>Unter <a href="#" data-act="go" data-v="import">Import</a> die Kunden aus der IM-Vermietung / IM-Verwaltung übernehmen und Adressen ergänzen.</li>
      <li>Artikel erfassen oder übernehmen, dann «＋ Rechnung» oder eine Abrechnungsliste importieren.</li></ol></div>` : ''}
    <div class="mlist">${L.map(r => `<div class="mcard ${App.sel.has(r.id) ? 'sel' : ''}" data-act="editR" data-id="${r.id}"><div class="cb"><input type="checkbox" data-act="selOne" data-id="${r.id}" ${App.sel.has(r.id) ? 'checked' : ''}></div>
      <div class="grow"><div class="t">${esc(kName(r.kunde))}</div><div class="s">${r.nr ? 'Nr. ' + esc(r.nr) : 'Entwurf'} · ${fmtDate(r.datum)}${r.betreff ? ' · ' + esc(r.betreff) : ''}</div><div class="s">${stChip(r)}</div></div>
      <div class="q">${chf(calc(r).total)}${isOP(r) && bezahlt(r) ? `<div class="small muted">offen ${chf(offenBetrag(r))}</div>` : ''}</div></div>`).join('') || '<div class="empty">Keine Rechnungen</div>'}</div>
    <div class="dscroll"><table class="dtab"><thead><tr><th class="cb"><input type="checkbox" data-act="selAll" ${L.length && L.every(r => App.sel.has(r.id)) ? 'checked' : ''}></th><th>Nr.</th><th>Datum</th><th>Kunde</th><th>Betreff / Positionen</th><th class="n">Total CHF</th><th class="n">Offen</th><th>Fällig</th><th>Status</th></tr></thead><tbody>
    ${L.map(r => { const c = calc(r), s = statusOf(r); return `<tr class="click ${App.sel.has(r.id) ? 'sel' : ''} ${s === 'storniert' ? 'storno' : s === 'bezahlt' ? 'done' : ''}" data-act="editR" data-id="${r.id}">
      <td class="cb"><input type="checkbox" data-act="selOne" data-id="${r.id}" ${App.sel.has(r.id) ? 'checked' : ''}></td><td class="nowrap">${r.nr ? esc(r.nr) : '<span class="muted">–</span>'}</td><td class="nowrap">${fmtDate(r.datum)}</td>
      <td>${esc(kName(r.kunde))}${kunde(r.kunde)?.nr ? ` <span class="nr">${esc(kunde(r.kunde).nr)}</span>` : ''}</td><td class="small">${esc(r.betreff || (r.pos || []).filter(p => (p.typ || 'pos') === 'pos').map(p => p.bez).slice(0, 2).join(', '))}${(r.pos || []).length > 2 && !r.betreff ? ' …' : ''}</td>
      <td class="n">${chf(c.total)}</td><td class="n">${isOP(r) ? chf(offenBetrag(r)) : ''}</td><td class="nowrap">${r.nr && s !== 'bezahlt' && s !== 'storniert' ? fmtDate(faelligAkt(r)) : ''}</td><td class="nowrap">${stChip(r)}</td></tr>`; }).join('')}
    </tbody></table>${L.length ? '' : '<div class="empty">Keine Rechnungen für diesen Filter</div>'}</div>`;
  return { tb, html };
}
function selBar() {
  const b = $('#selbar'), n = App.sel.size;
  if (!n || !['rechnungen', 'op', 'entwuerfe'].includes(App.view)) { b.hidden = true; return; }
  const R = [...App.sel].map(id => Store.get('rechnungen', id)).filter(Boolean), nE = R.filter(r => statusOf(r) === 'entwurf').length, nO = R.filter(isOP).length;
  b.hidden = false;
  b.innerHTML = `<b>${n} ausgewählt</b>${nE ? `<button class="btn primary" data-act="selFinal">✓ ${nE} abschliessen & drucken</button>` : ''}<button class="btn" data-act="selPrint">🖨 Drucken</button>
    ${nO ? `<button class="btn" data-act="selMahn">✉ Mahnen (${nO})</button>` : ''}${R.length - nE && App.view === 'rechnungen' ? `<button class="btn" data-act="selRevert" title="Abgeschlossene Rechnungen ohne Zahlungen zurück in die Entwürfe">↩ Zurück zu Entwurf</button>` : ''}${nE > 1 && App.view === 'entwuerfe' ? `<button class="btn" data-act="selMerge" title="Ausgewählte Entwürfe desselben Kunden zu einem zusammenlegen">⇄ Zusammenlegen</button>` : ''}${nE ? `<button class="btn danger" data-act="selDel">Entwürfe löschen</button>` : ''}<button class="btn" data-act="selClear">✕</button>`;
}

/* ---------- Rechnung bearbeiten ---------- */
function rechnungDialog(id, { keep = false } = {}) {
  if (!keep) { const r = id ? Store.get('rechnungen', id) : newRechnung({ kunde: App.f.r.kunde || '' }); if (!r) return; App.ed = clone(r); if (!App.ed.pos.length) App.ed.pos.push(newPos()); }
  const r = App.ed, s = statusOf(r), fix = !!r.nr, c = Store.cfg(), k = kunde(r.kunde);
  const title = r.nr ? `${r.titel || 'Rechnung'} ${r.nr}` : (Store.get('rechnungen', r.id) ? `Rechnungsentwurf${r.nrRes ? ' (Nr. ' + r.nrRes + ')' : ''}` : 'Neue Rechnung');
  const body = `${fix && s !== 'storniert' ? `<div class="box small">Abgeschlossen am ${fmtDate((r.abgeschlossen || '').slice(0, 10))} · ${stChip(r)} · Referenz ${esc(r.ref ? SwissQR.fmtRef(r.ref) : '–')}<br>Änderungen an einer verschickten Rechnung nur, wenn sie nochmals gedruckt und neu verschickt wird.</div>` : ''}
    ${s === 'storniert' ? '<div class="box warn">Diese Rechnung ist storniert.</div>' : ''}
    ${!fix && r.nrRes ? `<div class="box small">Zurückgenommene Rechnung – die Nummer <b>${esc(r.nrRes)}</b> bleibt reserviert und wird beim erneuten Abschliessen wieder verwendet (gleiche QR-Referenz). Die korrigierte Rechnung dem Kunden neu schicken.</div>` : ''}
    <div class="edgrid">
      <label class="fld"><span>Kunde</span><div class="row"><select class="input" data-in="ed" data-k="kunde" autofocus>${optList(kundenSorted().filter(x => x.aktiv !== false || x.id === r.kunde).map(x => [x.id, kLabel(x)]), r.kunde, '– Kunde wählen –')}</select><button type="button" class="btn" data-act="edNewK" title="Neuer Kunde">＋</button></div>
        ${k && !kAdrOk(k) ? `<div class="hint warn">Adresse unvollständig – <a href="#" data-act="edEditK">ergänzen</a></div>` : k ? `<div class="hint">${esc([[k.strasse, k.hausnr].filter(Boolean).join(' '), [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))} · <a href="#" data-act="edEditK">bearbeiten</a></div>` : ''}</label>
      <label class="fld"><span>Datum</span><input class="input" type="date" data-in="ed" data-k="datum" value="${esc(r.datum)}"></label>
      <label class="fld"><span>Zahlungsfrist (Tage)</span><input class="input" type="number" min="0" data-in="ed" data-k="frist" value="${esc(r.frist ?? c.frist)}"></label>
      <label class="fld"><span>Titel</span><input class="input" data-in="ed" data-k="titel" value="${esc(r.titel)}"></label>
      ${(() => { const pe = periode(r) || {}; return `<label class="fld"><span>Abrechnungsperiode von</span><input class="input" type="date" data-in="ed" data-k="perVon" value="${esc(r.perVon || '')}" title="${pe.auto ? 'leer = aus den Positionsdaten: ' + fmtDate(pe.von) : ''}"></label>
        <label class="fld"><span>bis ${pe.auto ? `<span class="muted small">(automatisch ${fmtDate(pe.von)} – ${fmtDate(pe.bis)})</span>` : ''}</span><input class="input" type="date" data-in="ed" data-k="perBis" value="${esc(r.perBis || '')}"></label>`; })()}
      <label class="fld wide2"><span>Betreff (intern – wird nicht gedruckt)</span><input class="input" data-in="ed" data-k="betreff" value="${esc(r.betreff || '')}" placeholder="z. B. IM-Verwaltung, IM-Vermietung, Maschinenmiete 2026"></label>
    </div>
    <details class="help" ${r.textOben ? 'open' : ''}><summary>Text über den Positionen</summary><textarea class="input" data-in="ed" data-k="textOben" rows="2">${esc(r.textOben || '')}</textarea></details>
    <datalist id="artList">${artSorted().filter(a => a.aktiv !== false).map(a => `<option value="${esc(a.artNr)}">${esc(a.bez)}${a.preis != null ? ' · ' + chf(a.preis) + '/' + esc(a.einheit || '') : ''}</option>`).join('')}</datalist>
    <div class="dscroll postab"><table class="dtab"><thead><tr><th class="cs" title="Positionen auswählen – z. B. für einen Zusatzposten"></th><th style="width:128px">Datum</th><th style="width:84px">Art.-Nr.</th><th>Bezeichnung / Bemerkung</th><th class="n" style="width:84px">Menge</th><th style="width:80px">Einh.</th><th class="n" style="width:96px">Preis</th><th style="width:84px">MWST</th><th class="n" style="width:96px">Betrag</th><th style="width:72px"></th></tr></thead><tbody>
    ${r.pos.map((p, i) => (p.typ || 'pos') !== 'pos'
      ? `<tr><td></td><td></td><td class="small muted">${p.typ === 'titel' ? 'Titel' : 'Text'}</td><td colspan="6"><textarea class="input" rows="1" data-in="edp" data-i="${i}" data-f="bez">${esc(p.bez)}</textarea></td><td class="nowrap">${posBtns(i)}</td></tr>`
      : `<tr class="${(App.edSel || new Set()).has(p.id) ? 'psel' : ''}"><td class="cs"><input type="checkbox" data-act="edSel" data-id="${p.id}" ${(App.edSel || new Set()).has(p.id) ? 'checked' : ''}></td>
        <td><input class="input" type="date" data-in="edp" data-i="${i}" data-f="datum" value="${esc(p.datum || '')}" title="Auftragsdatum – leer bei Zusatzpositionen"></td>
        <td><input class="input" list="artList" data-in="edp" data-i="${i}" data-f="art" value="${esc(p.art || '')}"></td>
        <td><textarea class="input" rows="1" data-in="edp" data-i="${i}" data-f="bez">${esc(p.bez)}</textarea>${posBeschr(p, r) ? `<div class="small muted pbeschr" title="Beschreibung aus dem Artikel">${esc(posBeschr(p, r)).replace(/\n/g, '<br>')}</div>` : ''}<input class="input pbem" data-in="edp" data-i="${i}" data-f="bem" value="${esc(p.bem || '')}" placeholder="Bemerkung (z. B. Kultur)"></td>
        <td><input class="input n" inputmode="decimal" data-in="edp" data-i="${i}" data-f="menge" value="${p.menge ?? ''}"></td>
        <td><input class="input" list="einhList" data-in="edp" data-i="${i}" data-f="einh" value="${esc(p.einh || '')}"></td>
        <td><input class="input n" inputmode="decimal" data-in="edp" data-i="${i}" data-f="preis" value="${p.preis ?? ''}"></td>
        <td><select class="input" data-in="edp" data-i="${i}" data-f="mwst">${mwstOpts(p.mwst)}</select></td>
        <td class="n" id="pb${i}">${chf(calc({ pos: [p] }).rows[0].betrag)}</td><td class="nowrap">${posBtns(i)}</td></tr>`).join('')}
    </tbody></table></div>
    <datalist id="einhList">${EINHEITEN.map(e => `<option value="${e}">`).join('')}</datalist>
    <div class="btns"><button type="button" class="btn small" data-act="edAdd" data-t="pos">＋ Position</button><button type="button" class="btn small" data-act="edAdd" data-t="text">＋ Textzeile</button><button type="button" class="btn small" data-act="edAdd" data-t="titel">＋ Zwischentitel</button><button type="button" class="btn small" data-act="edZus" title="Zusatzposten (z. B. Dieselzuschlag) für die angekreuzten Positionen – Menge = Summe der Positionen">＋ Zusatzposten${(App.edSel || new Set()).size ? ` (${App.edSel.size} ausgewählt)` : ''}</button><button type="button" class="btn small" data-act="edSum" title="Gleiche Positionen (gleiche Arbeit/Produkt, Preis, Einheit, MWST) zu einer Zeile zusammenfassen">Σ Zusammenfassen</button>
      <label class="tog" style="margin-left:auto"><input type="checkbox" data-in="edInkl" ${r.inkl ? 'checked' : ''}> Preise inkl. MWST</label></div>
    <div id="edTot" class="edtot">${edTotHtml(r)}</div>
    ${beilagenOf(r).map((b, i) => `<div class="box small">📎 Beilage «${esc(b.titel)}»${b.html ? ` (Ausdruck aus ${esc(b.app || 'dem Absender-Programm')})` : ` mit ${b.rows.length} Zeilen`}${b.total != null ? ` (CHF ${chf(b.total)})` : ''} wird hinter der Rechnung gedruckt. <a href="#" data-act="edBeilDel" data-i="${i}">entfernen</a></div>`).join('')}
    ${(r.quellen || []).length ? `<div class="small muted" style="margin:-6px 0 10px">Herkunft: ${(r.quellen || []).map(q => `${esc(q.app)} ${fmtDate((q.am || '').slice(0, 10))}${(q.refs || []).length ? ' (' + q.refs.map(x => x.nr ? (q.app === 'IM-Verwaltung' ? 'Auftrag ' : '') + x.nr : '').filter(Boolean).join(', ') + ')' : ''}`).join(' · ')}</div>` : ''}
    <label class="fld"><span>Text unter den Positionen</span><textarea class="input" data-in="ed" data-k="textUnten" rows="2">${esc(r.textUnten || '')}</textarea></label>
    ${fix ? zahlMahnInfo(r) : ''}`;
  const isNew = !Store.get('rechnungen', r.id);
  const foot = s === 'storniert'
    ? `<button class="btn" value="unstorno">Storno aufheben</button><span class="spacer"></span><button class="btn" value="close">Schliessen</button>`
    : `${fix ? `<button class="btn danger" value="storno">Stornieren</button><button class="btn" value="revert" title="Rechnung zurück in die Entwürfe, um sie zu korrigieren (Nummer bleibt reserviert)">↩ Zurück zu Entwurf</button><button class="btn" value="copy">Kopie als Entwurf</button>` : (isNew || r.nrRes ? '' : '<button class="btn danger" value="del">Löschen</button>')}
      <button class="btn" value="preview">👁 Vorschau</button>${fix ? '' : '<button class="btn" value="draftPrint" title="Entwurf mit Wasserzeichen und ohne QR-Zahlteil drucken – z. B. zum Kontrollieren">🖨 Entwurf drucken</button>'}<span class="spacer"></span>
      <button class="btn" value="save">${fix ? 'Speichern' : 'Als Entwurf speichern'}</button>
      ${fix ? '<button class="btn primary" value="print">🖨 Speichern & drucken</button>' : `${(App.edSel || new Set()).size && (App.edSel.size < r.pos.filter(p => (p.typ || 'pos') === 'pos').length) ? `<button class="btn" value="part" title="Nur die angekreuzten Positionen als Rechnung abschliessen – die übrigen bleiben im Entwurf">✓ Nur ${App.edSel.size} markierte abschliessen & drucken</button>` : ''}<button class="btn primary" value="final">✓ Abschliessen & drucken</button>`}`;
  openDlg(title, body, foot, { wide: true, onSubmit: (fd, btn) => edSubmit(btn) });
  autoGrow();
}
// v1.16: Nur die angekreuzten Positionen abschliessen und drucken – Rest bleibt im Entwurf. Die reservierte Nummer (zurückgenommene Rechnung) geht an den abgeschlossenen Teil.
function teilAbschluss() {
  const r = App.ed, S = App.edSel || new Set(), sel = r.pos.filter(p => S.has(p.id) && (p.typ || 'pos') === 'pos');
  if (!sel.length) return;
  const B = beilagenOf(r), kinds = new Set(sel.map(p => p.kind || '')), arts = new Set(sel.map(p => String(p.art || '')));
  const passt = b => /maschinenmiete/i.test(b.titel) ? kinds.has('miete') || arts.has(einCfg().artMiete) : /spritz|pflanzenschutz/i.test(b.titel) ? kinds.has('psm') || sel.some(p => /spritz/i.test(p.grp || p.bez)) : true;
  const tot = calc({ pos: sel, inkl: r.inkl }).total;
  openDlg('Markierte Positionen abschliessen', `<p>${sel.length} von ${r.pos.filter(p => (p.typ || 'pos') === 'pos').length} Positionen werden als <b>eigene Rechnung</b> abgeschlossen und gedruckt (CHF ${chf(tot)}). Die übrigen bleiben im Entwurf.</p>
    <div class="dscroll" style="max-height:30vh"><table class="dtab">${sel.map(p => `<tr><td>${p.datum ? fmtDate(p.datum) : ''}</td><td>${esc(p.bez)}${p.bem ? `<div class="small muted">${esc(p.bem)}</div>` : ''}</td><td class="n">${fmtNum(+p.menge || 0, 3)} ${esc(p.einh || '')}</td><td class="n">${chf(calc({ pos: [p], inkl: r.inkl }).rows[0].betrag)}</td></tr>`).join('')}</table></div>
    ${B.length ? `<p class="small"><b>Beilagen zur abgeschlossenen Rechnung:</b></p>${B.map((b, i) => `<label class="tog" style="display:flex"><input type="checkbox" name="b${i}" ${passt(b) ? 'checked' : ''}> ${esc(b.titel)}</label>`).join('')}<div class="hint">Nicht angekreuzte Beilagen bleiben beim Entwurf.</div>` : ''}
    ${r.nrRes ? `<div class="hint">Die reservierte Nummer ${esc(r.nrRes)} geht an diese Rechnung.</div>` : ''}`,
    `<button class="btn" value="back" formnovalidate>← Zurück zur Rechnung</button><span class="spacer"></span><button class="btn primary" value="ok">✓ Abschliessen & drucken</button>`, { onSubmit: (fd, btn) => {
      if (btn === 'back') { rechnungDialog(null, { keep: true }); return false; }
      const ids = new Set(sel.map(p => p.id)), mitB = B.filter((b, i) => fd.get('b' + i)), ohneB = B.filter((b, i) => !fd.get('b' + i));
      const f = Object.assign(clone(r), { id: uid(), pos: clone(r.pos.filter(p => ids.has(p.id))), beilagen: clone(mitB), quelle: (r.quelle || '') + ' (Teil)' }); delete f.beilage;
      const e = rechnungFehler(f); if (e.length) { alert('Rechnung kann noch nicht abgeschlossen werden:\n\n• ' + e.join('\n• ')); return false; }
      const rest = Object.assign(clone(r), { pos: r.pos.filter(p => !ids.has(p.id)), beilagen: clone(ohneB) }); delete rest.beilage; delete rest.nrRes;
      abschliessen(f); f.faellig = addDays(f.datum, f.frist ?? Store.cfg().frist);
      Store.put('rechnungen', f, { silent: true }); Store.put('rechnungen', rest, { silent: true }); S.clear(); App.ed = null;
      printDocs([{ r: f }], { title: docTitle([{ r: f }]) }); toast(`Rechnung ${f.nr} mit ${sel.length} Positionen abgeschlossen – ${rest.pos.filter(p => (p.typ || 'pos') === 'pos').length} Positionen bleiben im Entwurf`, 5000);
    } });
}
// v1.17: Entwürfe desselben Kunden von Hand zusammenlegen – auch mit verschiedenen reservierten Nummern (die übrigen Nummern werden frei)
function mergeDialog(L) {
  if (L.length < 2) return;
  if (new Set(L.map(r => r.kunde)).size > 1) { toast('Nur Entwürfe desselben Kunden lassen sich zusammenlegen', 4000); return; }
  const def = L.find(r => r.nrRes) || L[0];
  openDlg('Entwürfe zusammenlegen', `<p>${L.length} Entwürfe von <b>${esc(kName(L[0].kunde))}</b> werden zu einem zusammengelegt (Positionen, Beilagen, Herkunft).</p>
    <p class="small"><b>Welcher Entwurf bleibt?</b> ${L.some(r => r.nrRes) ? 'Seine reservierte Nummer wird beim Abschliessen verwendet.' : ''}</p>
    ${L.map(r => `<label class="tog" style="display:flex;gap:8px;margin:4px 0"><input type="radio" name="ziel" value="${r.id}" ${r === def ? 'checked' : ''}> ${r.nrRes ? `<b>Nr. ${esc(r.nrRes)}</b> (zurückgenommen)` : 'Entwurf ohne Nummer'} · ${(r.pos || []).filter(p => (p.typ || 'pos') === 'pos').length} Positionen · CHF ${chf(calc(r).total)}${r.betreff ? ` · <span class="muted">${esc(r.betreff)}</span>` : ''}</label>`).join('')}
    ${L.filter(r => r.nrRes).length > 1 ? '<div class="hint warn">Die reservierten Nummern der anderen Entwürfe werden frei und nicht mehr verwendet (Lücke in der Nummernfolge). Wurden diese Rechnungen schon verschickt, dem Kunden mitteilen, dass sie durch die neue ersetzt werden.</div>' : ''}`,
    `<span class="spacer"></span><button class="btn primary" value="ok">⇄ Zusammenlegen</button>`, { onSubmit: fd => {
      const t = clone(L.find(r => r.id === fd.get('ziel')) || def), rest = L.filter(r => r.id !== t.id);
      rest.forEach(r => { t.pos.push(...clone(r.pos)); beilagenOf(r).forEach(b => addBeilage(t, b)); t.quellen = (t.quellen || []).concat(r.quellen || []);
        if (r.betreff) t.betreff = [...new Set([...(t.betreff || '').split(', '), ...r.betreff.split(', ')].filter(Boolean))].join(', ');
        if (r.nrRes) (t.freieNr = t.freieNr || []).push(r.nrRes); });
      Store.put('rechnungen', t, { silent: true }); Store.remove('rechnungen', rest.map(r => r.id)); App.sel.clear();
      toast(`${L.length} Entwürfe zusammengelegt${t.nrRes ? ' – Nr. ' + t.nrRes + ' bleibt reserviert' : ''}`, 4000);
    } });
}
// Zusatzposten für mehrere Positionen (z. B. Dieselzuschlag beim Dreschen): Menge = Summe der angekreuzten Positionen (gleiche Einheit wie der Artikel), ein Posten total oder je Position
function zusatzDialog() {
  const r = App.ed, S = App.edSel || new Set(), sel = r.pos.filter(p => S.has(p.id) && (p.typ || 'pos') === 'pos');
  if (!sel.length) { toast('Zuerst die Positionen ankreuzen, für die der Zusatzposten gilt (Kästchen links)', 4000); return; }
  const sumF = einh => r2(sel.filter(p => !einh || (p.einh || '') === einh).reduce((s, p) => s + (+p.menge || 0), 0));
  const einh0 = sel[0].einh || '';
  openDlg('Zusatzposten', `<datalist id="artList">${artSorted().filter(a => a.aktiv !== false).map(a => `<option value="${esc(a.artNr)}">${esc(a.bez)}${a.preis != null ? ' · ' + chf(a.preis) + '/' + esc(a.einheit || '') : ''}</option>`).join('')}</datalist><datalist id="einhList">${EINHEITEN.map(e => `<option value="${e}">`).join('')}</datalist><p class="small muted">Für ${sel.length} ${sel.length === 1 ? 'Position' : 'Positionen'}: ${esc(sel.map(p => p.bez + (p.datum ? ' ' + fmtDate(p.datum) : '')).slice(0, 4).join(', '))}${sel.length > 4 ? ' …' : ''}</p>
    <div class="two"><label class="fld"><span>Artikel</span><input class="input" name="art" list="artList" placeholder="Art.-Nr., z. B. Dieselzuschlag" autofocus></label>
      <label class="fld"><span>Bezeichnung</span><input class="input" name="bez" placeholder="aus dem Artikel"></label>
      <label class="fld"><span>Menge</span><input class="input n" name="menge" inputmode="decimal" value="${sumF(einh0)}"></label>
      <label class="fld"><span>Einheit</span><input class="input" name="einh" list="einhList" value="${esc(einh0)}"></label>
      <label class="fld"><span>Preis</span><input class="input n" name="preis" inputmode="decimal"></label>
      <label class="fld"><span>Bemerkung</span><input class="input" name="bem" placeholder="z. B. Dieselpreis ab 1.50"></label></div>
    <label class="tog"><input type="checkbox" name="einzeln"> je Position ein eigener Zusatzposten (mit Datum und Menge der Position)</label>
    <div class="hint">Menge = Summe der angekreuzten Positionen${new Set(sel.map(p => p.einh || '')).size > 1 ? ' mit gleicher Einheit wie der Artikel' : ''}. Der Zusatzposten wird hinter der letzten angekreuzten Position eingefügt.</div>`,
    `<button class="btn" value="back" formnovalidate>← Zurück zur Rechnung</button><span class="spacer"></span><button class="btn primary" value="ok">＋ Einfügen</button>`, { onSubmit: (fd, btn) => {
      if (btn === 'back') { rechnungDialog(null, { keep: true }); return false; }
      const a = artByNr(String(fd.get('art') || '').trim()), einh = String(fd.get('einh') || '').trim(), base = { art: a ? a.artNr : String(fd.get('art') || '').trim(), bez: String(fd.get('bez') || '').trim() || (a && a.bez) || 'Zuschlag', bem: String(fd.get('bem') || '').trim(),
        einh, preis: num(fd.get('preis')), mwst: a && a.mwst != null ? a.mwst : sel[0].mwst, konto: (a && a.konto) || '', kind: 'zusatz' };
      if (base.preis == null && a && a.preis != null) base.preis = a.preis;
      if (fd.get('einzeln')) { // je Position direkt dahinter
        [...sel].reverse().forEach(p => { const i = r.pos.indexOf(p); r.pos.splice(i + 1, 0, newPos(Object.assign({}, base, { datum: p.datum || '', menge: p.menge }))); });
      } else { const i = Math.max(...sel.map(p => r.pos.indexOf(p))); r.pos.splice(i + 1, 0, newPos(Object.assign({}, base, { menge: num(fd.get('menge')) ?? sumF(einh) }))); }
      S.clear(); rechnungDialog(null, { keep: true }); toast('Zusatzposten eingefügt'); return false;
    } });
  { const F = $('#dlgForm'), art = F.querySelector('[name=art]');
      art.addEventListener('change', () => { const a = artByNr(art.value.trim()); if (!a) return; F.querySelector('[name=bez]').value = a.bez; if (a.preis != null) F.querySelector('[name=preis]').value = a.preis;
        if (a.einheit) { F.querySelector('[name=einh]').value = a.einheit; F.querySelector('[name=menge]').value = sumF(a.einheit) || sumF(''); } }); }
}
const posBtns = i => `<button type="button" class="ib" data-act="edUp" data-i="${i}" title="nach oben">▲</button><button type="button" class="ib" data-act="edDel" data-i="${i}" title="Position löschen">✕</button>`;
function edTotHtml(r) {
  const c = calc(r);
  return `<table>${c.groups.map(g => r.inkl ? `<tr><td>Total ${g.satz ? 'inkl. ' + mwstTxt(g.satz) : 'ohne'} MWST</td><td class="n">${chf(g.brutto)}</td></tr>${g.satz ? `<tr class="muted"><td>davon MWST</td><td class="n">${chf(g.mwst)}</td></tr>` : ''}`
    : `<tr><td>Netto ${g.satz ? mwstTxt(g.satz) : 'ohne MWST'}</td><td class="n">${chf(g.netto)}</td></tr>${g.satz ? `<tr class="muted"><td>MWST ${mwstTxt(g.satz)}</td><td class="n">${chf(g.mwst)}</td></tr>` : ''}`).join('')}
    ${c.rund ? `<tr class="muted"><td>Rundung</td><td class="n">${chf(c.rund)}</td></tr>` : ''}<tr class="tot"><td>Total CHF</td><td class="n">${chf(c.total)}</td></tr></table>`;
}
function zahlMahnInfo(r) {
  const Z = r.zahlungen || [], M = r.mahnungen || [];
  return `<div class="cols" style="margin-top:6px"><div class="panel"><h2>Zahlungen</h2>${Z.length ? `<table class="dtab">${Z.map(z => `<tr><td>${fmtDate(z.datum)}</td><td class="n">${chf(z.betrag)}</td><td class="small muted">${isAus(z) ? 'ausgebucht' : esc(zKontoName(zKontoOf(z)))}${z.quelle === 'camt' ? ' (camt)' : z.bem ? ' · ' + esc(z.bem) : ''}${z.exp ? ' 📒' : ''}</td></tr>`).join('')}</table>` : '<p>Noch keine Zahlung.</p>'}
      <p>Offen: <b>CHF ${chf(offenBetrag(r))}</b></p><div class="btns"><button type="button" class="btn small" data-act="edZahl">💰 Zahlung erfassen…</button></div></div>
    <div class="panel"><h2>Mahnungen</h2>${M.length ? `<table class="dtab">${M.map((m, i) => `<tr><td>${esc(m.titel)}</td><td>${fmtDate(m.datum)}</td><td class="n">${+m.gebuehr ? chf(m.gebuehr) : ''}</td><td><button type="button" class="btn small" data-act="edMahnPrint" data-i="${i}">🖨</button></td></tr>`).join('')}</table>` : '<p>Keine Mahnungen.</p>'}
      ${isOP(r) ? '<div class="btns"><button type="button" class="btn small" data-act="edMahn">✉ Mahnung erstellen…</button></div>' : ''}</div></div>`;
}
function autoGrow() { $$('#dlgForm textarea[data-in="edp"]').forEach(t => { t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight + 2) + 'px'; }); }
function edRerender() { const sc = $('#dlg .db')?.scrollTop; rechnungDialog(null, { keep: true }); const db = $('#dlg .db'); if (db && sc) db.scrollTop = sc; }
function edSave(r) { Store.put('rechnungen', r, { silent: true }); App.ed = clone(r); }
function edClean(r) { r.pos = r.pos.filter(p => (p.typ || 'pos') !== 'pos' ? String(p.bez || '').trim() : (p.art || p.bez || p.preis != null)); return r; }
function edSubmit(btn) {
  const r = edClean(clone(App.ed));
  if (btn === 'close') return;
  if (btn === 'del') { if (!confirm('Entwurf löschen?')) return false; Store.remove('rechnungen', r.id); App.ed = null; return; }
  if (btn === 'storno') { if (!confirm(`Rechnung ${r.nr} stornieren? Die Nummer bleibt belegt.`)) return false; r.storno = new Date().toISOString(); edSave(r); toast('Rechnung storniert'); return; }
  if (btn === 'unstorno') { delete r.storno; edSave(r); return; }
  if (btn === 'copy') { const n = newRechnung(Object.assign(clone(r), { id: uid(), nr: '', ref: '', faellig: '', abgeschlossen: '', storno: undefined, zahlungen: [], mahnungen: [], datum: todayIso(), quelle: 'Kopie von ' + r.nr })); n.pos.forEach(p => { p.id = uid(); }); edSave(n); setTimeout(() => rechnungDialog(n.id), 50); toast('Kopie als Entwurf erstellt'); return; }
  if (btn === 'preview') { previewDocs([{ r }], { onPrint: () => { App.ed = r; edSubmit(r.nr ? 'print' : 'final'); }, onClose: () => rechnungDialog(null, { keep: true }) }); return false; }
  if (btn === 'save') { edSave(r); toast(r.nr ? 'Gespeichert' : 'Entwurf gespeichert'); return; }
  if (btn === 'draftPrint') { edSave(r); printDocs([{ r }], { title: docTitle([{ r }]) }); return false; }
  if (btn === 'revert') {
    const e = zurueckFehler(r); if (e) { alert(`Rechnung ${r.nr} ${e}.`); return false; }
    if (!confirm(`Rechnung ${r.nr} zurück in die Entwürfe nehmen?\n\nDie Nummer ${r.nr} bleibt reserviert und wird beim erneuten Abschliessen wieder verwendet.${(r.mahnungen || []).length ? ' Die ' + r.mahnungen.length + ' Mahnung(en) werden verworfen.' : ''}\nWurde die Rechnung schon verschickt, die korrigierte dem Kunden neu schicken.`)) return false;
    zuruecknehmen(r); edSave(r); toast(`Rechnung ${r.rueck[r.rueck.length - 1].nr} ist wieder ein Entwurf`); setTimeout(() => rechnungDialog(r.id), 50); return;
  }
  if (btn === 'part') { edSave(r); teilAbschluss(); return false; }
  if (btn === 'final') {
    const e = rechnungFehler(r); if (e.length) { alert('Rechnung kann noch nicht abgeschlossen werden:\n\n• ' + e.join('\n• ')); return false; }
    abschliessen(r); r.faellig = addDays(r.datum, r.frist ?? Store.cfg().frist); edSave(r);
    printDocs([{ r }], { title: docTitle([{ r }]) }); toast(`Rechnung ${r.nr} abgeschlossen`); return;
  }
  if (btn === 'print') { r.faellig = addDays(r.datum, r.frist ?? Store.cfg().frist); edSave(r); printDocs([{ r }], { title: docTitle([{ r }]) }); return; }
}
function edInput(t, commit) {
  const r = App.ed; if (!r) return;
  if (t.dataset.in === 'ed') {
    const k = t.dataset.k; r[k] = k === 'frist' ? (t.value === '' ? null : +t.value) : t.value;
    if (k === 'kunde' && commit) { const kk = kunde(t.value); if (kk && kk.frist != null && !r.nr) r.frist = kk.frist; edRerender(); }
    return;
  }
  if (t.dataset.in === 'edInkl') { r.inkl = t.checked; $('#edTot').innerHTML = edTotHtml(r); return; }
  const i = +t.dataset.i, f = t.dataset.f, p = r.pos[i]; if (!p) return;
  if (['menge', 'preis', 'mwst'].includes(f)) p[f] = num(t.value); else p[f] = t.value;
  if (f === 'art' && commit) { const a = artByNr(t.value); if (a) { if (!p.bez || p._auto || confirm(`Bezeichnung durch den Titel des Artikels ersetzen?\n\n«${p.bez}» → «${a.bez}»`)) { p.bez = a.bez; p._auto = true; } p.einh = a.einheit || p.einh; if (a.preis != null) p.preis = a.preis; p.mwst = a.mwst ?? p.mwst; p.konto = a.konto || ''; edRerender(); return; } }
  if (f === 'bez') { delete p._auto; t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight + 2) + 'px'; }
  const pb = $('#pb' + i); if (pb) pb.textContent = chf(calc({ pos: [p] }).rows[0].betrag);
  $('#edTot').innerHTML = edTotHtml(r);
}

/* ---------- Zahlung, Mahnung ---------- */
function zahlDialog(id, back) {
  const r = Store.get('rechnungen', id); if (!r) return;
  const Z = r.zahlungen || [];
  openDlg(`Zahlung · Rechnung ${r.nr}`, `<p>${esc(kName(r.kunde))} · Total CHF ${chf(calc(r).total)}${gebuehren(r) ? ' + Gebühren ' + chf(gebuehren(r)) : ''} · offen <b>CHF ${chf(offenBetrag(r))}</b></p>
    ${Z.length ? `<table class="dtab" style="margin-bottom:12px"><thead><tr><th>Datum</th><th class="n">Betrag</th><th>Konto</th><th>Bemerkung</th><th></th></tr></thead>${Z.map(z => `<tr><td>${fmtDate(z.datum)}</td><td class="n">${chf(z.betrag)}</td><td class="small">${isAus(z) ? '–' : esc(zKontoName(zKontoOf(z)))}</td><td class="small">${esc(z.quelle === 'camt' ? 'Bank (camt)' : z.bem || '')}</td><td>${z.exp ? '<span class="small muted" title="an AgroOffice übergeben">📒 gebucht</span>' : `<label class="tog"><input type="checkbox" name="del_${z.id}"> löschen</label>`}</td></tr>`).join('')}</table>` : ''}
    <div class="three"><label class="fld"><span>Datum</span><input class="input" type="date" name="datum" value="${todayIso()}"></label>
      <label class="fld"><span>Betrag CHF</span><input class="input" name="betrag" inputmode="decimal" value="${offenBetrag(r) > 0 ? offenBetrag(r).toFixed(2) : ''}" autofocus></label>
      <label class="fld"><span>Eingang auf Konto</span><select class="input" name="konto">${optList(zKonten().map(k => [k.nr, `${k.nr} ${k.name}`]), ls('mf_zkonto') || buchCfg().bank)}</select></label></div>
    <label class="fld"><span>Bemerkung</span><input class="input" name="bem" placeholder="z. B. bar, Skonto"></label>
    <label class="tog"><input type="checkbox" name="rest"> Restbetrag ausbuchen (gilt danach als bezahlt)</label>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Speichern</button>`,
    { onSubmit: fd => {
      const x = clone(r); x.zahlungen = (x.zahlungen || []).filter(z => !fd.get('del_' + z.id));
      const b = num(fd.get('betrag')), konto = String(fd.get('konto') || buchCfg().bank); if (b) { x.zahlungen.push({ id: uid(), datum: fd.get('datum') || todayIso(), betrag: r2(b), konto, bem: (fd.get('bem') || '').trim() }); ls('mf_zkonto', konto); }
      if (fd.get('rest')) { const o = offenBetrag(x); if (o > 0) x.zahlungen.push({ id: uid(), datum: fd.get('datum') || todayIso(), betrag: o, bem: 'Rest ausgebucht', aus: true }); }
      Store.put('rechnungen', x, { silent: true }); toast(statusOf(x) === 'bezahlt' ? `Rechnung ${x.nr} bezahlt ✓` : 'Zahlung gespeichert');
      if (back) setTimeout(() => rechnungDialog(x.id), 50);
    } });
}
function mahnDialog(ids, back) {
  const c = Store.cfg(), R = ids.map(id => Store.get('rechnungen', id)).filter(r => r && isOP(r));
  if (!R.length) { toast('Keine offenen Rechnungen ausgewählt'); return; }
  const today = todayIso();
  openDlg(`Mahnungen (${R.length})`, `<p class="muted small">Jede Rechnung erhält die nächste Mahnstufe (Einstellungen unter Mehr › Mahnwesen). Noch nicht fällige Rechnungen sind nicht angekreuzt.</p>
    <div class="dscroll" style="max-height:55vh"><table class="dtab"><thead><tr><th class="cb"></th><th>Nr.</th><th>Kunde</th><th>Fällig</th><th>Stufe</th><th class="n">Gebühr</th><th class="n">neu offen</th></tr></thead><tbody>
    ${R.map((r, i) => { const n = (r.mahnungen || []).length, st = c.mahn[Math.min(n, c.mahn.length - 1)], due = faelligAkt(r) < today;
      return `<tr class="${due ? '' : 'off'}"><td class="cb"><input type="checkbox" name="s${i}" ${due ? 'checked' : ''}></td><td>${esc(r.nr)}</td><td>${esc(kName(r.kunde))}</td><td>${fmtDate(faelligAkt(r))}${due ? ` <span class="small warn">+${daysBetween(faelligAkt(r), today)} T.</span>` : ''}</td>
        <td>${esc(st.titel)}${n >= c.mahn.length ? ' (nochmals)' : ''}</td><td class="n">${chf(+st.gebuehr || 0)}</td><td class="n">${chf(offenBetrag(r) + (+st.gebuehr || 0))}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="two" style="margin-top:12px"><label class="fld"><span>Mahndatum</span><input class="input" type="date" name="datum" value="${today}"></label></div>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">✉ Mahnungen erstellen & drucken</button>`,
    { wide: true, onSubmit: fd => {
      const datum = fd.get('datum') || today, docs = [], out = [];
      R.forEach((r, i) => { if (!fd.get('s' + i)) return; const x = clone(r); x.mahnungen = x.mahnungen || []; const n = x.mahnungen.length, st = c.mahn[Math.min(n, c.mahn.length - 1)];
        x.mahnungen.push({ stufe: Math.min(n, c.mahn.length - 1), titel: st.titel, text: st.text, datum, gebuehr: +st.gebuehr || 0, faellig: addDays(datum, st.frist || 10) });
        out.push(x); docs.push({ r: x, mahnung: x.mahnungen.length - 1 }); });
      if (!out.length) { toast('Nichts ausgewählt'); return false; }
      Store.putMany('rechnungen', out, { silent: true }); App.sel.clear();
      printDocs(docs, { title: docs.length === 1 ? `Mahnung ${docs[0].r.nr} ${kName(docs[0].r.kunde)}` : `Mahnungen ${datum}` });
      if (back) setTimeout(() => rechnungDialog(out[0].id), 50);
    } });
}

/* ================= Offene Posten ================= */
function viewOP() {
  const f = App.f.op, q = fold(f.q), today = todayIso();
  const L = Store.all('rechnungen').filter(isOP).filter(r => (!f.nurUeber || statusOf(r) === 'ueberfaellig') && (!q || fold([r.nr, kName(r.kunde)].join(' ')).includes(q)))
    .sort((a, b) => (faelligAkt(a) || '').localeCompare(faelligAkt(b) || ''));
  const all = Store.all('rechnungen').filter(isOP), tot = all.reduce((s, r) => s + offenBetrag(r), 0), ue = all.filter(r => statusOf(r) === 'ueberfaellig');
  const nB = offeneZahlungen().length;
  const tb = `<h1>Offene Posten</h1><button class="btn" data-act="buchOpen">📒 Buchungen für AgroOffice${nB ? ` (${nB})` : ''}</button><label class="btn">🏦 Zahlungen einlesen (camt.054)…<input type="file" accept=".xml,.zip" multiple data-in="camtFile" hidden></label>`;
  const html = `<div class="kpis"><div class="kpi"><b>${chf(tot)}</b><span>offen total (${all.length})</span></div><div class="kpi"><b class="${ue.length ? 'warnc' : ''}">${chf(ue.reduce((s, r) => s + offenBetrag(r), 0))}</b><span>überfällig (${ue.length})</span></div>
      <div class="kpi"><b>${chf(Store.all('rechnungen').filter(r => !r.storno).flatMap(r => r.zahlungen || []).filter(z => (z.datum || '').startsWith(today.slice(0, 4))).reduce((s, z) => s + +z.betrag, 0))}</b><span>Zahlungseingang ${today.slice(0, 4)}</span></div></div>
    <div class="filters"><input class="input search" type="search" placeholder="Suchen…" data-in="opq" value="${esc(f.q)}"><label class="tog"><input type="checkbox" data-in="opUe" ${f.nurUeber ? 'checked' : ''}> nur überfällige</label></div>
    <div class="mlist">${L.map(r => `<div class="mcard ${App.sel.has(r.id) ? 'sel' : ''}" data-act="editR" data-id="${r.id}"><div class="cb"><input type="checkbox" data-act="selOne" data-id="${r.id}" ${App.sel.has(r.id) ? 'checked' : ''}></div>
      <div class="grow"><div class="t">${esc(kName(r.kunde))}</div><div class="s">Nr. ${esc(r.nr)} · fällig ${fmtDate(faelligAkt(r))}</div><div class="s">${stChip(r)}</div></div><div class="q">${chf(offenBetrag(r))}</div></div>`).join('') || '<div class="empty">Keine offenen Rechnungen 🎉</div>'}</div>
    <div class="dscroll"><table class="dtab"><thead><tr><th class="cb"><input type="checkbox" data-act="selAllOP" ${L.length && L.every(r => App.sel.has(r.id)) ? 'checked' : ''}></th><th>Nr.</th><th>Kunde</th><th>Datum</th><th>Fällig</th><th class="n">Tage</th><th>Status</th><th class="n">Total</th><th class="n">Bezahlt</th><th class="n">Offen</th><th></th></tr></thead><tbody>
    ${L.map(r => { const d = daysBetween(faelligAkt(r), today); return `<tr class="click ${App.sel.has(r.id) ? 'sel' : ''}" data-act="editR" data-id="${r.id}"><td class="cb"><input type="checkbox" data-act="selOne" data-id="${r.id}" ${App.sel.has(r.id) ? 'checked' : ''}></td>
      <td>${esc(r.nr)}</td><td>${esc(kName(r.kunde))}</td><td>${fmtDate(r.datum)}</td><td>${fmtDate(faelligAkt(r))}</td><td class="n ${d > 0 ? 'warnc' : ''}">${d > 0 ? '+' + d : ''}</td><td class="nowrap">${stChip(r)}</td>
      <td class="n">${chf(calc(r).total)}</td><td class="n">${bezahlt(r) ? chf(bezahlt(r)) : ''}</td><td class="n"><b>${chf(offenBetrag(r))}</b></td>
      <td class="nowrap"><button class="btn small" data-act="zahl" data-id="${r.id}" title="Zahlung erfassen">💰</button><button class="btn small" data-act="mahn" data-id="${r.id}" title="Mahnen">✉</button></td></tr>`; }).join('')}
    </tbody></table>${L.length ? '' : '<div class="empty">Keine offenen Rechnungen 🎉</div>'}</div>
    <details class="help" style="margin-top:8px"><summary>ℹ Zahlungen automatisch abgleichen</summary>Im E-Banking die Gutschriften als <b>camt.054</b> (Sammelbuchungen aufgelöst; bei manchen Banken «ESR/QR-Gutschriften» oder «Einzelgutschriften») oder <b>camt.053</b> herunterladen (XML oder ZIP) und hier einlesen. Die Zahlungen werden über die QR-Referenz der Rechnung zugeordnet; schon erfasste werden erkannt.</details>`;
  return { tb, html };
}

/* ================= Import ================= */
function viewImport() {
  const I = App.imp;
  if (I) {
    const K = kundenSorted();
    return { tb: `<h1>Import prüfen</h1><button class="btn" data-act="impCancel">Abbrechen</button><button class="btn primary" data-act="impCreate">✓ ${I.groups.filter(g => g.sel).length} Entwürfe erstellen</button>`,
      html: `<div class="filters"><span class="lbl">${esc(I.fname)} · ${I.groups.length} Kunden · ${I.groups.reduce((s, g) => s + g.items.length, 0)} Positionen · CHF ${chf(I.groups.reduce((s, g) => s + impTotal(g), 0))}</span></div>
      <div class="filters"><label class="fld" style="margin:0;min-width:260px"><span>Betreff der Rechnungen</span><input class="input" data-in="impBetreff" value="${esc(I.betreff)}" placeholder="z. B. Maschinenmiete 2026"></label>
        <label class="tog"><input type="checkbox" data-in="impOpt" data-k="kNeu" ${I.kNeu ? 'checked' : ''}> unbekannte Kunden neu anlegen</label>
        ${I.vm ? `<label class="tog"><input type="checkbox" data-in="impOpt" data-k="miete" ${I.miete ? 'checked' : ''}> Maschinenmiete als eine Zeile «${MIETE_ART} ${esc(artByNr(MIETE_ART)?.bez || 'Maschinenmiete gemäss Rapport')}», Einzelheiten als Beilage</label>${I.miete && !artByNr(MIETE_ART) ? `<span class="small warnc">Artikel ${MIETE_ART} fehlt noch (Stammdaten › Artikel)</span>` : ''}` : ''}
        ${I.miete ? '' : `<label class="tog"><input type="checkbox" data-in="impOpt" data-k="artNeu" ${I.artNeu ? 'checked' : ''}> fehlende Artikel anlegen</label>`}
        <label class="tog"><input type="checkbox" data-in="impOpt" data-k="append" ${I.append ? 'checked' : ''}> an bestehenden Entwurf des Kunden anhängen</label></div>
      <div class="dscroll"><table class="dtab"><thead><tr><th class="cb"></th><th>Aus der Liste</th><th>Kunde in IM-Faktura</th><th>Positionen</th><th class="n">Total CHF</th></tr></thead><tbody>
      ${I.groups.map((g, i) => `<tr class="${g.sel ? '' : 'off'}"><td class="cb"><input type="checkbox" data-in="impSel" data-i="${i}" ${g.sel ? 'checked' : ''}></td>
        <td>${g.kd ? `<span class="nr">${esc(g.kd)}</span> ` : ''}${esc(g.kn)}</td>
        <td><select class="input" data-in="impK" data-i="${i}" style="min-width:220px">${optList(K.map(k => [k.id, kLabel(k)]), g.kId, I.kNeu ? '＋ neu anlegen' : '– nicht zugeordnet –')}</select>${g.kId && !kAdrOk(kunde(g.kId)) ? '<div class="small warnc">Adresse unvollständig</div>' : ''}${g.how === 'ähnlich' ? '<div class="small warnc">ähnlicher Name – bitte prüfen</div>' : ''}</td>
        <td class="small">${g.items.map(it => `${esc(it.art ? it.art + ' ' : '')}${esc(it.bez)}: ${fmtNum(it.menge, 3)} ${esc(it.einh)} × ${it.preis != null ? chf(it.preis) : '<span class="warnc">ohne Preis</span>'}${it.artNeu && !I.miete ? ' <span class="chip small">neuer Artikel</span>' : ''}`).join('<br>')}</td>
        <td class="n">${chf(impTotal(g))}</td></tr>`).join('')}</tbody></table></div>` };
  }
  return { tb: '<h1>Import</h1>', html: `<div class="cols"><div>
    <div class="panel"><h2>Abrechnungsliste → Rechnungsentwürfe</h2>
      <p>Excel- oder CSV-Datei mit einer Zeile pro Position einlesen, z. B. <b>«Abrechnungsliste Excel»</b> aus der IM-Vermietung (Kd-Nr., Kunde, Art.-Nr., Bezeichnung, Menge, Einheit, Preis, Betrag) oder die Abrechnung aus der IM-Verwaltung (CSV). Pro Kunde entsteht ein Entwurf, den du vor dem Abschliessen prüfen kannst.</p>
      <div class="btns"><label class="btn primary">Datei wählen…<input type="file" accept=".xlsx,.csv,.txt" data-in="impAbrFile" hidden></label></div></div>
    <div class="panel"><h2>Zahlungen (camt.054)</h2><p>Gutschriften aus dem E-Banking einlesen und über die QR-Referenz den Rechnungen zuordnen.</p>
      <div class="btns"><label class="btn">Datei wählen…<input type="file" accept=".xml,.zip" multiple data-in="camtFile" hidden></label></div></div>
  </div><div>
    <div class="panel"><h2>Kunden übernehmen</h2><p>Bestehende Kunden werden über die Kunden-Nr. bzw. den Namen erkannt und nur ergänzt (nie überschrieben). Für den QR-Zahlteil braucht jeder Kunde Name, PLZ und Ort. Die Kunden werden hier verwaltet: die IM-Vermietung übernimmt sie von hier; die Kunden der IM-Verwaltung (aus MyJohnDeere) werden mit ihnen verknüpft.</p>
      <div class="btns"><button class="btn" data-act="kDbx" data-src="vm">Aus IM-Vermietung</button><button class="btn" data-act="kDbx" data-src="lp">Aus IM-Verwaltung</button><button class="btn" data-act="imvLink" title="Kunden der IM-Verwaltung den Kunden von IM-Faktura zuordnen">🔗 Mit IM-Verwaltung verknüpfen</button><label class="btn" title="Kundenliste aus AgroOffice Fakturierung (Export «Kunden») oder eigene Excel/CSV-Liste">Excel (AgroOffice)…<input type="file" accept=".xlsx,.csv,.txt" data-in="impKFile" hidden></label></div>
      <p class="small muted">Die Kundenliste aus <b>AgroOffice Fakturierung</b> wird erkannt (Kunden-Nr., Firma/Privat, Name/Vorname, Adresse, Telefon, E-Mail); dort kann man abweichende Angaben auch überschreiben.</p>
      ${Auth.hasSession() ? '' : '<p class="small warnc">Für IM-Vermietung/IM-Verwaltung zuerst unter Mehr mit Dropbox anmelden.</p>'}</div>
    <div class="panel"><h2>Artikel übernehmen</h2><p>Artikelliste aus Excel (Art.-Nr., Bezeichnung, Einheit, MWST, Preis, Konto) – z. B. die Artikelliste aus AgroFaktura. Bestehende Artikel (gleiche Art.-Nr.) erhalten Preis, MWST und Konto aus der Liste. Alte MWST-Sätze (8,0 / 7,7 / 2,5 %) werden auf 8,1 / 2,6 % umgestellt.</p>
      <div class="btns"><label class="btn">Excel/CSV…<input type="file" accept=".xlsx,.csv,.txt" data-in="impAFile" hidden></label></div></div>
  </div></div>` };
}

/* ================= Stammdaten ================= */
function viewStamm() {
  const sub = App.sub.stamm;
  const seg = `<div class="seg">${[['kunden', 'Kunden'], ['artikel', 'Artikel']].map(([v, l]) => `<button data-act="sub" data-v="${v}" class="${sub === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (sub === 'artikel') {
    const q = fold(App.f.a.q), L = artSorted().filter(a => !q || fold([a.artNr, a.bez].join(' ')).includes(q));
    return { tb: `<h1>Stammdaten</h1>${seg}<button class="btn primary" data-act="newA">＋ Artikel</button>`, html: `<div class="filters"><input class="input search" type="search" placeholder="Suchen…" data-in="aq" value="${esc(App.f.a.q)}"><span class="lbl">${L.length} Artikel</span></div>
      <div class="dscroll"><table class="dtab"><thead><tr><th>Art.-Nr.</th><th>Bezeichnung</th><th>Einheit</th><th class="n">Preis CHF</th><th class="n">MWST</th><th>Konto</th><th>Arbeiten (IM-Verwaltung)</th></tr></thead><tbody>
      ${L.map(a => `<tr class="click ${a.aktiv === false ? 'off' : ''}" data-act="editA" data-id="${a.id}"><td>${esc(a.artNr)}</td><td>${esc(a.bez)}${a.beschr ? `<div class="small muted">${esc(a.beschr)}</div>` : ''}</td><td>${esc(a.einheit || '')}</td><td class="n">${a.preis != null ? chf(a.preis) : ''}</td><td class="n">${a.mwst != null ? mwstTxt(a.mwst) : ''}</td><td>${a.konto ? esc(a.konto) : '<span class="small muted">' + esc(buchCfg().kontoStd) + ' (Std.)</span>'}</td><td class="small">${esc((a.arbeiten || []).join(', '))}</td></tr>`).join('')}</tbody></table>${L.length ? '' : '<div class="empty">Noch keine Artikel</div>'}</div>` };
  }
  const f = App.f.k, q = fold(f.q), cnt = new Map(); Store.all('rechnungen').forEach(r => cnt.set(r.kunde, (cnt.get(r.kunde) || 0) + 1));
  const L = kundenSorted().filter(k => (f.alle || k.aktiv !== false) && (!q || fold([k.nr, k.name, k.ort, k.strasse].join(' ')).includes(q)));
  const nOk = L.filter(k => !kAdrOk(k)).length;
  const lk = k => `${k.vmId ? '<span class="chip" title="mit IM-Vermietung verknüpft">Vermietung</span> ' : ''}${(k.imvIds || []).length ? `<span class="chip" title="mit ${k.imvIds.length} ${k.imvIds.length === 1 ? 'Kunde' : 'Kunden'} der IM-Verwaltung verknüpft">Verwaltung${k.imvIds.length > 1 ? ' ×' + k.imvIds.length : ''}</span>` : ''}`;
  return { tb: `<h1>Stammdaten</h1>${seg}<button class="btn" data-act="imvLink" title="Kunden der IM-Verwaltung (MyJohnDeere) den Kunden von IM-Faktura zuordnen">🔗 IM-Verwaltung verknüpfen</button><button class="btn primary" data-act="newK">＋ Kunde</button>`, html: `<div class="filters"><input class="input search" type="search" placeholder="Suchen…" data-in="kq" value="${esc(f.q)}"><label class="tog"><input type="checkbox" data-in="kAlle" ${f.alle ? 'checked' : ''}> inaktive zeigen</label><span class="lbl">${L.length} Kunden${nOk ? ` · <span class="warnc">${nOk} ohne vollständige Adresse</span>` : ''}</span></div>
    <div class="dscroll"><table class="dtab"><thead><tr><th>Nr.</th><th>Name</th><th>Strasse</th><th>PLZ Ort</th><th>E-Mail / Telefon</th><th>Verknüpft</th><th class="n">Rechnungen</th></tr></thead><tbody>
    ${L.map(k => `<tr class="click ${k.aktiv === false ? 'off' : ''}" data-act="editK" data-id="${k.id}"><td>${esc(k.nr || '')}</td><td>${esc(k.name)}${k.zusatz ? `<div class="small muted">${esc(k.zusatz)}</div>` : ''}</td><td>${esc([k.strasse, k.hausnr].filter(Boolean).join(' '))}</td>
      <td>${kAdrOk(k) ? esc([k.plz, k.ort].join(' ')) : '<span class="chip warn">Adresse fehlt</span>'}</td><td class="small">${esc([k.mail, k.tel].filter(Boolean).join(' · '))}</td><td>${lk(k)}</td><td class="n">${cnt.get(k.id) || ''}</td></tr>`).join('')}</tbody></table>${L.length ? '' : '<div class="empty">Noch keine Kunden – unter Import übernehmen oder «＋ Kunde»</div>'}</div>` };
}
function kundeDialog(id, { after } = {}) {
  const k = id ? Store.get('kunden', id) : { id: uid(), aktiv: true, land: 'CH' }; if (!k) return;
  const used = Store.all('rechnungen').some(r => r.kunde === k.id);
  openDlg(id ? 'Kunde bearbeiten' : 'Neuer Kunde', `
    <div class="two"><label class="fld"><span>Name *</span><input class="input" name="name" value="${esc(k.name || '')}" autofocus required placeholder="Nachname Vorname oder Firma"></label>
      <label class="fld"><span>Kunden-Nr.</span><input class="input" name="nr" value="${esc(k.nr || '')}"></label></div>
    <label class="fld"><span>Zusatz</span><input class="input" name="zusatz" value="${esc(k.zusatz || '')}" placeholder="z. B. Betriebsgemeinschaft, z. Hd. …"></label>
    <div class="two" style="grid-template-columns:3fr 1fr"><label class="fld"><span>Strasse</span><input class="input" name="strasse" value="${esc(k.strasse || '')}"></label><label class="fld"><span>Nr.</span><input class="input" name="hausnr" value="${esc(k.hausnr || '')}"></label></div>
    <div class="three" style="grid-template-columns:1fr 2fr 1fr"><label class="fld"><span>PLZ *</span><input class="input" name="plz" value="${esc(k.plz || '')}" inputmode="numeric"></label><label class="fld"><span>Ort *</span><input class="input" name="ort" value="${esc(k.ort || '')}"></label><label class="fld"><span>Land</span><input class="input" name="land" value="${esc(k.land || 'CH')}" maxlength="2"></label></div>
    <div class="two"><label class="fld"><span>E-Mail</span><input class="input" type="email" name="mail" value="${esc(k.mail || '')}"></label><label class="fld"><span>Telefon</span><input class="input" name="tel" value="${esc(k.tel || '')}"></label></div>
    <div class="two"><label class="fld"><span>Eigene Zahlungsfrist (Tage)</span><input class="input" type="number" min="0" name="frist" value="${esc(k.frist ?? '')}" placeholder="Standard ${Store.cfg().frist}"></label>
      <label class="fld"><span>Status</span><select class="input" name="aktiv">${optList([['1', 'aktiv'], ['0', 'inaktiv']], k.aktiv === false ? '0' : '1')}</select></label></div>
    <label class="fld"><span>Bemerkung</span><textarea class="input" name="bem" rows="2">${esc(k.bem || '')}</textarea></label>
    ${id ? `<div class="box small"><b>Verknüpfungen</b><br>IM-Vermietung: ${k.vmId ? '✓ verknüpft (Stammdaten kommen von hier)' : '– noch keine (wird beim ersten Abgleich der IM-Vermietung über Nr./Name zugeordnet)'}<br>
      IM-Verwaltung: ${(k.imvIds || []).length ? (k.imvIds.map(i => { const v = (App.imvK || []).find(x => x.id === i); return v ? esc(v.name) : ''; }).filter(Boolean).join(', ') || k.imvIds.length + ' Kunde(n)') : '–'}
      <label class="tog" style="display:flex;margin-top:4px"><input type="checkbox" name="unlink"> Verknüpfungen lösen</label>
      <div class="hint">Zuordnen unter Stammdaten › «🔗 IM-Verwaltung verknüpfen».</div></div>` : ''}`,
    `${id && !used ? '<button class="btn danger" value="del">Löschen</button>' : ''}<span class="spacer"></span><button class="btn primary" value="ok">Speichern</button>`,
    { onSubmit: (fd, btn) => {
      if (btn === 'del') { if (!confirm('Kunde löschen?')) return false; Store.remove('kunden', k.id); return; }
      const x = Object.assign({}, k); ['name', 'nr', 'zusatz', 'strasse', 'hausnr', 'plz', 'ort', 'mail', 'tel', 'bem'].forEach(f => { x[f] = String(fd.get(f) || '').trim(); });
      x.land = (String(fd.get('land') || 'CH').trim() || 'CH').toUpperCase(); if (fd.get('unlink')) { x.imvIds = []; x.vmId = ''; } x.frist = fd.get('frist') === '' ? null : +fd.get('frist'); x.aktiv = fd.get('aktiv') !== '0';
      if (!x.name) { toast('Name fehlt'); return false; }
      if (!x.hausnr && x.strasse) Object.assign(x, splitStreet(x.strasse));
      Store.put('kunden', x, { silent: !!after }); if (after) setTimeout(() => after(x), 50);
    } });
}
/* v1.11: Arbeiten der IM-Verwaltung je Artikel (a.arbeiten) – schränkt dort im Sendefenster die Artikelauswahl ein.
   Vorschläge: Arbeitsarten der Maschinen aus /planung.json (gemerkt in mf_imvarb) + Arbeiten aus MyJohnDeere + Strohhäckseln */
const IMV_ARB_FIX = ['Säen', 'Ernte', 'Pflanzenschutz / Düngung', 'Bodenbearbeitung', 'Strohhäckseln'];
const imvArbeiten = () => { let L = []; try { L = JSON.parse(ls('mf_imvarb') || '[]'); } catch { } return [...new Set([...L, ...IMV_ARB_FIX, ...Store.all('artikel').flatMap(a => a.arbeiten || [])])].sort((a, b) => a.localeCompare(b, 'de')); };
async function imvArbLoad() {
  try { const d = await Drive.loadPath('/planung.json'); const L = [...new Set(((d && d.maschinen) || []).filter(m => !m.del).flatMap(m => m.arbeitsarten || []).filter(Boolean))];
    if (L.length) ls('mf_imvarb', JSON.stringify(L)); return L.length > 0; } catch { return false; }
}
const arbChips = sel => imvArbeiten().map(x => `<label class="tog arbchip"><input type="checkbox" name="arb" value="${esc(x)}" ${sel.includes(x) ? 'checked' : ''}> ${esc(x)}</label>`).join('');
function artikelDialog(id) {
  const a = id ? Store.get('artikel', id) : { id: uid(), aktiv: true, mwst: Store.cfg().mwstDef }; if (!a) return;
  openDlg(id ? 'Artikel bearbeiten' : 'Neuer Artikel', `
    <div class="two" style="grid-template-columns:1fr 3fr"><label class="fld"><span>Art.-Nr.</span><input class="input" name="artNr" value="${esc(a.artNr || '')}" autofocus></label><label class="fld"><span>Bezeichnung *</span><input class="input" name="bez" value="${esc(a.bez || '')}"></label></div>
    <label class="fld"><span>Beschreibung <span class="muted small">(optional – wird auf der Rechnung unter der Bezeichnung gedruckt)</span></span><textarea class="input" name="beschr" rows="2" placeholder="z. B. inkl. Fahrer und Diesel, Mindestverrechnung 1 h">${esc(a.beschr || '')}</textarea></label>
    <div class="three"><label class="fld"><span>Einheit</span><input class="input" name="einheit" list="einhList2" value="${esc(a.einheit || '')}"><datalist id="einhList2">${EINHEITEN.map(e => `<option value="${e}">`).join('')}</datalist></label>
      <label class="fld"><span>Preis CHF</span><input class="input" name="preis" inputmode="decimal" value="${a.preis ?? ''}"></label>
      <label class="fld"><span>MWST</span><select class="input" name="mwst">${mwstOpts(a.mwst)}</select></label></div>
    <label class="fld"><span>Ertragskonto (AgroOffice)</span><input class="input" name="konto" inputmode="numeric" value="${esc(a.konto || '')}" placeholder="leer = Standardkonto ${esc(buchCfg().kontoStd)}" style="max-width:220px"></label>
    <div class="fld"><span>Arbeiten in der IM-Verwaltung</span><div class="arbchips" id="arbChips">${arbChips(a.arbeiten || [])}</div>
      <input class="input" name="arbNeu" placeholder="weitere Arbeit (mehrere mit Komma)" style="margin-top:6px"><div class="small muted">Beim Senden aus der IM-Verwaltung werden zu einer Arbeit nur die hier zugewiesenen Artikel angeboten (auf Wunsch alle).</div></div>
    <label class="tog"><input type="checkbox" name="aktiv" ${a.aktiv !== false ? 'checked' : ''}> aktiv (in der Auswahl)</label>`,
    `${id ? '<button class="btn danger" value="del">Löschen</button>' : ''}<span class="spacer"></span><button class="btn primary" value="ok">Speichern</button>`,
    { onSubmit: (fd, btn) => {
      if (btn === 'del') { if (!confirm('Artikel löschen?')) return false; Store.remove('artikel', a.id); return; }
      const arb = [...new Set([...fd.getAll('arb'), ...String(fd.get('arbNeu') || '').split(',').map(t => t.trim()).filter(Boolean)])];
      const x = Object.assign({}, a, { arbeiten: arb, artNr: String(fd.get('artNr') || '').trim(), bez: String(fd.get('bez') || '').trim(), beschr: String(fd.get('beschr') || '').trim(), einheit: String(fd.get('einheit') || '').trim(), preis: num(fd.get('preis')), mwst: num(fd.get('mwst')) ?? 0, konto: String(fd.get('konto') || '').replace(/\D/g, ''), aktiv: !!fd.get('aktiv') });
      if (!x.bez) { toast('Bezeichnung fehlt'); return false; }
      if (x.artNr && Store.all('artikel').some(o => o.id !== x.id && nrKey(o.artNr) === nrKey(x.artNr))) { toast('Art.-Nr. gibt es schon'); return false; }
      if (!x.arbeiten.length) delete x.arbeiten;
      Store.put('artikel', x);
    } });
  // Arbeitsarten aus der IM-Verwaltung nachladen und Auswahl ergänzen (gewählte bleiben angehakt)
  if (Auth.hasSession()) imvArbLoad().then(ok => { const box = $('#arbChips'); if (!ok || !box) return; const cur = [...box.querySelectorAll('input:checked')].map(i => i.value); box.innerHTML = arbChips(cur.length ? cur : (a.arbeiten || [])); });
}

/* ================= Mehr: Einstellungen, Dropbox, Daten ================= */
function viewMehr() {
  const c = Store.cfg(), f = c.firma, user = ls('mf_user'), ibOk = SwissQR.ibanOk(c.iban), qr = ibOk && SwissQR.isQrIban(c.iban);
  const inp = (k, l, v, x = '') => `<label class="fld"><span>${l}</span><input class="input" data-in="cfg" data-k="${k}" value="${esc(v ?? '')}" ${x}></label>`;
  const conn = Auth.configured() ? (Auth.hasSession()
    ? `<p>Verbunden${user ? ' als <b>' + esc(user) + '</b>' : ''}. Daten: Dropbox › Apps › (Dropbox-App) › <b>${esc(Drive.path().slice(1))}</b> – getrennt von IM-Verwaltung und IM-Vermietung.</p><div class="btns"><button class="btn" data-act="sync">Jetzt synchronisieren</button><button class="btn danger" data-act="logout">Abmelden</button></div>`
    : `<p>Noch nicht angemeldet. Nach der Anmeldung werden die Daten in deiner Dropbox gespeichert und zwischen PC, iPhone und Tablet abgeglichen.</p><div class="btns"><button class="btn primary" data-act="login">Mit Dropbox anmelden</button></div>`)
    : '<p>Dropbox ist noch nicht eingerichtet (App-Key in config.js fehlt) – die App speichert nur auf diesem Gerät.</p>';
  const n = x => Store.all(x).length;
  return { tb: '<h1>Mehr</h1>', html: `<div class="cols"><div>
    <div class="panel"><h2>Firma & QR-Konto</h2>
      ${inp('iban', 'QR-IBAN (Konto für die Zahlungen)', SwissQR.iban(c.iban) ? SwissQR.fmtIban(c.iban) : '', 'placeholder="CH.. 3…"')}
      <div class="hint ${ibOk ? '' : 'warn'}" style="margin:-8px 0 10px;font-size:12px">${!c.iban ? 'Noch keine IBAN – ohne sie kann keine Rechnung abgeschlossen werden.' : !ibOk ? 'IBAN ungültig (Prüfziffer)' : qr ? '✓ QR-IBAN – Rechnungen erhalten eine QR-Referenz (automatischer Abgleich)' : '⚠ Normale IBAN, keine QR-IBAN – Rechnungen ohne Referenz. Die QR-IBAN steht im E-Banking.'}</div>
      ${inp('refPrefix', 'Referenz-Präfix (nur falls die Bank eine Kunden-ID/BESR-ID verlangt)', c.refPrefix, 'inputmode="numeric" placeholder="leer lassen"')}
      ${inp('firma.name', 'Kontoinhaber / Name (Zahlungsempfänger)', f.name)}
      <div class="two" style="grid-template-columns:3fr 1fr">${inp('firma.strasse', 'Strasse', f.strasse)}${inp('firma.hausnr', 'Nr.', f.hausnr)}</div>
      <div class="three" style="grid-template-columns:1fr 2fr 1fr">${inp('firma.plz', 'PLZ', f.plz)}${inp('firma.ort', 'Ort', f.ort)}${inp('firma.land', 'Land', f.land, 'maxlength="2"')}</div>
      <div class="two">${inp('firma.uid', 'MWST-Nummer', f.uid, 'placeholder="CHE-123.456.789 MWST"')}${inp('firma.mail', 'E-Mail', f.mail)}</div></div>
    <div class="panel"><h2>Rechnung</h2>
      <div class="three">${inp('nextNr', 'Nächste Rechnungs-Nr.', nextNr(), 'inputmode="numeric"')}${inp('frist', 'Zahlungsfrist (Tage)', c.frist, 'type="number" min="0"')}${inp('ort', 'Ort im Datum', c.ort)}</div>
      ${inp('titel', 'Titel', c.titel)}
      <label class="fld"><span>Standardtext oben</span><textarea class="input" data-in="cfg" data-k="textOben" rows="2">${esc(c.textOben)}</textarea></label>
      <label class="fld"><span>Standardtext unten</span><textarea class="input" data-in="cfg" data-k="textUnten" rows="2">${esc(c.textUnten)}</textarea></label>
      <div class="two"><label class="fld"><span>Adressfeld</span><select class="input" data-in="cfg" data-k="adrPos">${optList([['rechts', 'rechts (Fenstercouvert rechts)'], ['links', 'links (Fenstercouvert links)']], c.adrPos)}</select></label>
        <label class="fld"><span>Standard-MWST-Satz</span><select class="input" data-in="cfg" data-k="mwstDef">${mwstOpts(c.mwstDef)}</select></label></div>
      <label class="tog"><input type="checkbox" data-in="cfgB" data-k="runden5" ${c.runden5 !== false ? 'checked' : ''}> Total auf 5 Rappen runden</label><br>
      <label class="tog"><input type="checkbox" data-in="cfgB" data-k="preiseInkl" ${c.preiseInkl ? 'checked' : ''}> Preise standardmässig inkl. MWST</label><br>
      <label class="tog"><input type="checkbox" data-in="cfgB" data-k="swico" ${c.swico !== false ? 'checked' : ''}> Rechnungsinformationen (Swico) im QR-Code – Buchhaltungen übernehmen Nr., Datum, MWST automatisch</label><br>
      <label class="tog"><input type="checkbox" data-in="cfgB" data-k="trennlinie" ${c.trennlinie !== false ? 'checked' : ''}> Trennlinie mit «Vor der Einzahlung abzutrennen» (für normales Papier ohne Perforation)</label>
      <h3 class="sub">Drucker mit zwei Papierfächern</h3>
      <label class="tog"><input type="checkbox" data-in="cfgB" data-k="druckGetrennt" ${c.druckGetrennt !== false ? 'checked' : ''}> Rechnung und Beilagen in zwei Druckaufträgen (Rechnung auf Rechnungspapier, Beilagen auf Normalpapier)</label>
      <div class="two">${inp('fachRe', 'Rechnungen (mit QR-Zahlteil)', c.fachRe || 'Rechnungspapier (Fach 2)')}${inp('fachNormal', 'Beilagen, Entwürfe', c.fachNormal || 'Normalpapier (Fach 1)')}</div>
      <details class="help"><summary>Papierfach einrichten</summary><p class="small">Eine Web-App kann das Papierfach nicht selbst wählen. Am einfachsten den Drucker in Windows <b>zweimal</b> einrichten (Einstellungen › Drucker › Drucker hinzufügen, gleicher Drucker): einmal mit Papierquelle <b>Fach 1</b> (Name z. B. «Drucker Normal»), einmal mit <b>Fach 2</b> («Drucker Rechnung»; in den Druckeinstellungen Papierquelle Fach 2 festlegen). Im Druckfenster dann den passenden Drucker wählen – Chrome/Edge merken sich den zuletzt gewählten. Bei perforiertem Papier die Trennlinie oben ausschalten.</p></details>
      <h3 class="sub">Briefkopf</h3><img src="${esc(logoSrc())}" alt="" style="max-width:100%;max-height:70px;display:block;margin:4px 0 8px;background:#fff">
      <div class="btns"><label class="btn small">Anderes Logo…<input type="file" accept="image/*" data-in="logoFile" hidden></label>${c.logo ? '<button class="btn small" data-act="logoReset">Standard (logo.jpg)</button>' : ''}<button class="btn small" data-act="testDoc">👁 Testrechnung ansehen</button></div></div>
  </div><div>
    <div class="panel"><h2>MWST-Sätze</h2><p class="small">Effektive Methode, MWST pro Position (Satz kommt aus dem Artikel). Landwirtschaftliche Lohnarbeiten, Erzeugnisse, Saatgut, Dünger und Pflanzenschutzmittel 2,6 %; Maschinenmiete, Forstarbeiten 8,1 %.</p>
      <table class="dtab">${c.mwst.map((m, i) => `<tr><td style="width:110px"><input class="input n" data-in="mwst" data-i="${i}" data-f="satz" value="${m.satz}" inputmode="decimal"></td><td><input class="input" data-in="mwst" data-i="${i}" data-f="name" value="${esc(m.name)}"></td><td style="width:40px"><button class="ib" data-act="mwstDel" data-i="${i}">✕</button></td></tr>`).join('')}</table>
      <div class="btns"><button class="btn small" data-act="mwstAdd">＋ Satz</button></div></div>
    ${buchPanel()}
    <div class="panel"><h2>Mahnwesen</h2>${c.mahn.map((m, i) => `<div class="mstufe"><div class="three" style="grid-template-columns:2fr 1fr 1fr">
        <label class="fld"><span>Stufe ${i + 1}</span><input class="input" data-in="mahn" data-i="${i}" data-f="titel" value="${esc(m.titel)}"></label>
        <label class="fld"><span>Gebühr CHF</span><input class="input n" data-in="mahn" data-i="${i}" data-f="gebuehr" value="${m.gebuehr}" inputmode="decimal"></label>
        <label class="fld"><span>Frist (Tage)</span><input class="input n" data-in="mahn" data-i="${i}" data-f="frist" value="${m.frist}" inputmode="numeric"></label></div>
        <textarea class="input" rows="2" data-in="mahn" data-i="${i}" data-f="text">${esc(m.text)}</textarea></div>`).join('')}</div>
    <div class="panel"><h2>Dropbox</h2>${conn}<p style="margin-top:12px">Diese Adresse muss in der Dropbox-App (App Console › Settings › Redirect URIs) eingetragen sein:</p><code class="mono">${esc(Auth.redirectUri())}</code></div>
    <div class="panel"><h2>Daten</h2><p>${n('rechnungen')} Rechnungen · ${n('kunden')} Kunden · ${n('artikel')} Artikel</p>
      <div class="btns"><button class="btn" data-act="journal">⬇ Rechnungsjournal (Excel)</button><button class="btn" data-act="exportAll">⬇ Alles als Excel</button><button class="btn" data-act="backup">⬇ Datensicherung (.json)</button><label class="btn">Wiederherstellen…<input type="file" accept=".json" data-in="restoreFile" hidden></label></div></div>
    <div class="panel"><h2>Über</h2><p>IM-Faktura v${APP_VERSION} (${APP_STAND}) – Rechnungen mit Schweizer QR-Zahlteil (SPC 0200, strukturierte Adressen) für Indermühle Lohnarbeiten · Maschinenvermietung, Schüpfen.</p>
      <div class="btns"><button class="btn" data-act="reload">App neu laden</button></div></div>
  </div></div>` };
}
function buchPanel() {
  const B = buchCfg(), dir = ls('mf_buchdir'), bi = (k, l, x = '') => `<label class="fld"><span>${l}</span><input class="input" data-in="buch" data-k="${k}" value="${esc(B[k] ?? '')}" inputmode="numeric" ${x}></label>`;
  return `<div class="panel"><h2>Buchhaltung (AgroOffice)</h2>
    <p class="small">Gebucht werden nur <b>Zahlungseingänge</b>: Bank direkt an die Ertragskonten der Artikel, je MWST-Satz inkl. MWST (vereinnahmt), mit der Rechnungs-Nr. als Beleg. AgroOffice nimmt beim Import nur Konten 1000–8999 und 9910/9911 an. Datei im Abacus-Format «XML-Buchungen» – in AgroOffice unter Grundeinstellungen › Import den Ordner eintragen.</p>
    <div class="three">${bi('bank', 'Bankkonto')}${bi('hilfs', 'Hilfskonto (leer = direkt)', 'placeholder="leer"')}${bi('kontoStd', 'Standard-Ertragskonto')}</div>
    <div class="three">${bi('kontoGeb', 'Mahngebühren')}${bi('kontoUeber', 'Überzahlungen')}${bi('mwstKonto', 'MWST-Konto')}</div>
    <div class="three">${Store.cfg().mwst.filter(m => +m.satz).map(m => `<label class="fld"><span>MWST-Code ${mwstTxt(m.satz)}</span><input class="input" data-in="buchCode" data-k="${m.satz}" value="${esc(B.codes[String(m.satz)] || '')}" maxlength="3"></label>`).join('')}</div>
    <label class="fld"><span>Konten für Zahlungseingänge (Auswahl beim Erfassen, «Nummer Name», mit ; getrennt)</span><input class="input" data-in="buch" data-k="zkonten" value="${esc(B.zkonten)}"></label>
    <div class="three" style="grid-template-columns:1fr 1fr 2fr"><label class="fld"><span>Beleg beginnt mit</span><input class="input" data-in="buch" data-k="belegPrefix" value="${esc(B.belegPrefix || '')}" inputmode="numeric"></label>
      <label class="fld"><span>Stellen Rg-Nr.</span><input class="input" data-in="buch" data-k="belegStellen" value="${esc(B.belegStellen || '')}" inputmode="numeric"></label>
      <div class="fld"><span>Beispiel (nur Ziffern, AgroOffice)</span><div class="hint" style="padding-top:10px">Rechnung 2 → Beleg <b>${esc(belegNr(2))}</b> · Rechnung 123 → <b>${esc(belegNr(123))}</b></div></div></div>
    <div class="two">${bi('version', 'Abacus-Version', 'inputmode="decimal"')}${bi('mandant', 'Mandant (meist leer)')}</div>
    <p class="small">Speicherort: ${dir ? `Ordner <b>${esc(dir)}</b> <a href="#" data-act="buchDirClear">zurücksetzen</a>` : 'Download-Ordner'}${window.showDirectoryPicker ? ` · <a href="#" data-act="buchDir">Ordner wählen…</a>` : ''}</p>
    <div class="btns"><button class="btn primary" data-act="buchOpen">📒 Buchungen erstellen (${offeneZahlungen().length})</button></div>
    <h3 class="sub">Eingang aus IM-Verwaltung / IM-Vermietung</h3>
    <div class="three"><label class="fld"><span>Artikel für Pflanzenschutzmittel</span><input class="input" data-in="ein" data-k="artPsm" value="${esc(einCfg().artPsm)}"></label>
      <label class="fld"><span>Artikel Maschinenmiete</span><input class="input" data-in="ein" data-k="artMiete" value="${esc(einCfg().artMiete)}"></label>
      <label class="fld"><span>MWST Arbeiten ohne Artikel</span><select class="input" data-in="ein" data-k="mwstArbeit">${mwstOpts(+einCfg().mwstArbeit)}</select></label></div>
    <h3 class="sub">Debitoren per Stichtag</h3><p class="small">Offene Rechnungen an einem Tag (Zahlungen und Gebühren bis zu diesem Tag), aufgeteilt nach Konto und MWST – für die Nachführung per 31.12.</p>
    <div class="btns"><input class="input" type="date" data-in="debStich" value="${new Date().getMonth() < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear()}-12-31" style="max-width:170px"><button class="btn" data-act="debExcel">⬇ Debitorenliste (Excel)</button></div></div>`;
}
function journal() {
  const L = Store.all('rechnungen').filter(r => r.nr).sort((a, b) => +a.nr - +b.nr || String(a.nr).localeCompare(b.nr)), sätze = [...new Set(L.flatMap(r => calc(r).groups.map(g => g.satz)))].sort((a, b) => b - a);
  const rows = [['Nr.', 'Datum', 'Kd-Nr.', 'Kunde', 'Betreff', ...sätze.flatMap(s => [`Netto ${s} %`, `MWST ${s} %`]), 'Rundung', 'Total CHF', 'Gebühren', 'Bezahlt', 'Offen', 'Fällig', 'Status', 'Mahnstufe', 'Referenz', 'Letzte Zahlung']];
  L.forEach(r => { const c = calc(r), k = kunde(r.kunde) || {}, gm = new Map(c.groups.map(g => [g.satz, g]));
    rows.push([+r.nr || r.nr, r.datum, k.nr ? +k.nr || k.nr : '', k.name || '', r.betreff || '', ...sätze.flatMap(s => [gm.get(s)?.netto ?? '', gm.get(s)?.mwst ?? '']), c.rund || '', c.total, gebuehren(r) || '', bezahlt(r) || '', r.storno ? '' : offenBetrag(r), r.faellig || '', ST[statusOf(r)][0], (r.mahnungen || []).length || '', r.ref || '', (r.zahlungen || []).map(z => z.datum).sort().pop() || '']); });
  download(`Rechnungsjournal_${todayIso()}.xlsx`, xlsxBlob([{ name: 'Rechnungen', rows }, { name: 'Positionen', rows: [['Nr.', 'Datum', 'Kunde', 'Art.-Nr.', 'Bezeichnung', 'Menge', 'Einheit', 'Preis', 'MWST %', 'Betrag', 'Konto'],
    ...L.filter(r => !r.storno).flatMap(r => calc(r).rows.filter(p => (p.typ || 'pos') === 'pos').map(p => [+r.nr || r.nr, r.datum, kName(r.kunde), p.art || '', p.bez, p.menge ?? '', p.einh || '', p.preis ?? '', p.mwst ?? '', p.betrag, +posKonto(p) || posKonto(p)]))] },
    { name: 'Zahlungen', rows: [['Nr.', 'Kunde', 'Datum', 'Betrag', 'Konto', 'Quelle', 'AgroOffice'], ...L.flatMap(r => (r.zahlungen || []).map(z => [+r.nr || r.nr, kName(r.kunde), z.datum, z.betrag, isAus(z) ? '' : +zKontoOf(z), z.quelle === 'camt' ? 'camt' : z.bem || '', isAus(z) ? 'nicht gebucht (ausgebucht)' : z.exp ? 'exportiert' : 'offen']))] }]));
}
function exportAll() {
  download(`IM-Faktura-Daten_${todayIso()}.xlsx`, xlsxBlob([
    { name: 'Kunden', rows: [['Kd-Nr.', 'Name', 'Zusatz', 'Strasse', 'Nr.', 'PLZ', 'Ort', 'Land', 'E-Mail', 'Telefon', 'Frist', 'Aktiv', 'Bemerkung', 'ID'], ...kundenSorted().map(k => [k.nr ? +k.nr || k.nr : '', k.name, k.zusatz || '', k.strasse || '', k.hausnr || '', k.plz || '', k.ort || '', k.land || '', k.mail || '', k.tel || '', k.frist ?? '', k.aktiv === false ? 'nein' : 'ja', k.bem || '', k.id])] },
    { name: 'Artikel', rows: [['Art.-Nr.', 'Bezeichnung', 'Einheit', 'Preis CHF', 'MWST %', 'Konto', 'Aktiv'], ...artSorted().map(a => [+a.artNr || a.artNr || '', a.bez, a.einheit || '', a.preis ?? '', a.mwst ?? '', a.konto ? +a.konto : '', a.aktiv === false ? 'nein' : 'ja'])] }]));
}
async function restore(file) {
  let d; try { d = JSON.parse(await file.text()); } catch { toast('Keine gültige Datensicherung'); return; }
  if (!d || !COLL.some(c => Array.isArray(d[c]))) { toast('Keine gültige Datensicherung'); return; }
  if (!confirm(`Datensicherung mit ${(d.rechnungen || []).filter(x => !x.del).length} Rechnungen wiederherstellen? Der aktuelle Stand wird ersetzt (auch in Dropbox).`)) return;
  const now = Date.now(), cur = Store.data;
  COLL.forEach(c => { const ids = new Set((d[c] || []).map(x => x.id)); d[c] = (d[c] || []).map(x => Object.assign({}, x, { upd: now })); (cur[c] || []).forEach(x => { if (!ids.has(x.id)) d[c].push({ id: x.id, del: true, upd: now }); }); });
  Store.data = { v: 1, ...Object.fromEntries(COLL.map(c => [c, d[c]])) }; Store.save(); Sync.schedule(100); App.render(); toast('Datensicherung wiederhergestellt');
}
function testDoc() {
  const c = Store.cfg(), k = kundenSorted().find(kAdrOk) || { id: '_t', name: 'Muster Hans', strasse: 'Dorfstrasse', hausnr: '1', plz: '3054', ort: 'Schüpfen', nr: '999' };
  const r = newRechnung({ id: '_test', kunde: k.id, nr: nextNr(), betreff: 'Testrechnung', pos: [newPos({ art: '101', bez: 'Muster: Kompaktlader', menge: 3.5, einh: 'h', preis: 85 }), newPos({ bez: 'Muster: Saatgut', menge: 2, einh: 'Stk', preis: 120, mwst: 2.6 })] });
  r.ref = SwissQR.isQrIban(c.iban) ? SwissQR.makeRef(c.refPrefix, r.nr) : ''; r.faellig = addDays(r.datum, r.frist);
  r._k = k;
  previewDocs([{ r }]);
}

/* ================= Ereignisse ================= */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, id = t.dataset.id;
  if (t.tagName === 'A') ev.preventDefault();
  switch (act) {
    case 'go': App.go(t.dataset.v); break;
    case 'sub': App.sub.stamm = t.dataset.v; App.saveUi(); App.render(); break;
    case 'dlgClose': closeDlg(); break;
    case 'sync': if (!Auth.configured()) App.go('mehr'); else if (!Auth.hasSession()) Auth.login(); else { Sync.run(); Eingang.check(); } break;
    case 'login': Auth.login(); break;
    case 'logout': if (confirm('Von Dropbox abmelden? Die Daten bleiben auf diesem Gerät.')) Auth.logout(); break;
    case 'reload': location.reload(); break;
    case 'zoomIn': Zoom.by(1.15); break;
    case 'zoomOut': Zoom.by(1 / 1.15); break;
    case 'zoomReset': Zoom.set(Zoom.def()); break;
    case 'newR': rechnungDialog(null); break;
    case 'editR': if (ev.target.closest('.cb') || ev.target.closest('button')) return; rechnungDialog(id); break;
    case 'selOne': ev.stopPropagation(); App.sel.has(id) ? App.sel.delete(id) : App.sel.add(id); App.render(); break;
    case 'selAll': case 'selAllOP': { const L = act === 'selAll' ? rechList() : Store.all('rechnungen').filter(isOP); const all = L.every(r => App.sel.has(r.id)); L.forEach(r => all ? App.sel.delete(r.id) : App.sel.add(r.id)); App.render(); break; }
    case 'selClear': App.sel.clear(); App.render(); break;
    case 'selPrint': { const R = [...App.sel].map(x => Store.get('rechnungen', x)).filter(Boolean); printDocs(R.map(r => ({ r })), { title: docTitle(R.map(r => ({ r }))) }); break; }
    case 'selFinal': {
      const R = [...App.sel].map(x => Store.get('rechnungen', x)).filter(r => r && statusOf(r) === 'entwurf');
      const bad = R.map(r => [r, rechnungFehler(r)]).filter(x => x[1].length);
      if (bad.length) { alert(`${bad.length} Entwürfe können nicht abgeschlossen werden:\n\n` + bad.slice(0, 12).map(([r, e]) => `• ${kName(r.kunde)}: ${e.join(', ')}`).join('\n')); if (bad.length === R.length) break; }
      const ok = R.filter(r => !bad.some(b => b[0] === r)); if (!confirm(`${ok.length} Rechnungen abschliessen (Nummern vergeben) und drucken?`)) break;
      const out = ok.sort((a, b) => kName(a.kunde).localeCompare(kName(b.kunde), 'de')).map(r => { const x = clone(r); abschliessen(x); Store.put('rechnungen', x, { silent: true }); return x; });
      App.sel.clear(); App.render(); printDocs(out.map(r => ({ r })), { title: `Rechnungen ${out[0].nr}-${out[out.length - 1].nr}` }); break;
    }
    case 'selRevert': {
      const R = [...App.sel].map(x => Store.get('rechnungen', x)).filter(r => r && r.nr), ok = R.filter(r => !zurueckFehler(r)), bad = R.filter(r => zurueckFehler(r));
      if (!ok.length) { alert('Keine der ausgewählten Rechnungen kann zurückgenommen werden:\n\n' + bad.map(r => `• ${r.nr}: ${zurueckFehler(r)}`).join('\n')); break; }
      if (!confirm(`${ok.length} ${ok.length === 1 ? 'Rechnung' : 'Rechnungen'} (${ok.map(r => r.nr).join(', ')}) zurück in die Entwürfe nehmen? Die Nummern bleiben reserviert.${bad.length ? `\n\nNicht möglich: ${bad.map(r => r.nr + ' (' + zurueckFehler(r) + ')').join(', ')}` : ''}`)) break;
      Store.putMany('rechnungen', ok.map(r => zuruecknehmen(clone(r))), { silent: true }); App.sel.clear(); App.render(); toast(`${ok.length} wieder in den Entwürfen`); break; }
    case 'selMerge': mergeDialog([...App.sel].map(x => Store.get('rechnungen', x)).filter(r => r && statusOf(r) === 'entwurf')); break;
    case 'selDel': { const R = [...App.sel].map(x => Store.get('rechnungen', x)).filter(r => r && statusOf(r) === 'entwurf' && !r.nrRes); if (R.length && confirm(`${R.length} Entwürfe löschen?`)) { Store.remove('rechnungen', R.map(r => r.id)); App.sel.clear(); App.render(); } break; }
    case 'selMahn': mahnDialog([...App.sel]); break;
    case 'zahl': zahlDialog(id); break;
    case 'mahn': mahnDialog([id]); break;
    case 'journal': journal(); break;
    case 'exportAll': exportAll(); break;
    case 'backup': download(`IM-Faktura-Sicherung_${todayIso()}.json`, JSON.stringify({ ...Store.data, _sicherung: { app: 'IM-Faktura', version: APP_VERSION, erstellt: new Date().toISOString() } }, null, 1), 'application/json'); break;
    case 'testDoc': testDoc(); break;
    case 'logoReset': Store.setCfg({ logo: '' }); App.render(); break;
    case 'mwstAdd': { const m = Store.cfg().mwst; m.push({ satz: 0, name: '' }); Store.setCfg({ mwst: m }); App.render(); break; }
    case 'mwstDel': { const m = Store.cfg().mwst; m.splice(+t.dataset.i, 1); Store.setCfg({ mwst: m }); App.render(); break; }
    // Import
    case 'impCancel': App.imp = null; App.render(); break;
    case 'impCreate': impAbrCreate(); break;
    case 'kDbx': impKundenDbx(t.dataset.src); break;
    case 'imvLink': imvLinkDialog(); break;
    case 'kimpAll': $$('#dlgForm input[type=checkbox][name^="s"]:not(:disabled)').forEach(x => { x.checked = t.checked; }); break;
    // Stammdaten
    case 'newK': kundeDialog(null); break;
    case 'editK': kundeDialog(id); break;
    case 'newA': artikelDialog(null); break;
    case 'editA': artikelDialog(id); break;
    // Rechnungseditor
    case 'edAdd': App.ed.pos.push(newPos(t.dataset.t === 'pos' ? {} : { typ: t.dataset.t, bez: '' })); edRerender(); setTimeout(() => { const x = $$('#dlgForm tbody tr').pop()?.querySelector('input,textarea'); if (x) x.focus(); }, 40); break;
    case 'edDel': { // Rückfrage (v1.13) – ausser bei leeren Zeilen
      const i = +t.dataset.i, p = App.ed.pos[i]; if (!p) break;
      const leer = !String(p.bez || '').trim() && !p.art && !(+p.preis) && !(+p.menge > 1);
      const was = p.typ === 'titel' ? `Zwischentitel «${p.bez || ''}»` : p.typ === 'text' ? `Textzeile «${String(p.bez || '').slice(0, 60)}»`
        : `Position${p.art ? ' ' + p.art : ''} «${String(p.bez || '').split('\n')[0].slice(0, 60)}»${p.preis != null && p.preis !== '' ? `\n${fmtNum(+p.menge || 0, 3)} ${p.einh || ''} × ${chf(+p.preis || 0)} = CHF ${chf((+p.menge || 0) * (+p.preis || 0))}` : ''}`;
      if (!leer && !confirm(`${was}\n\nwirklich aus der Rechnung löschen?`)) break;
      App.ed.pos.splice(i, 1); edRerender(); break; }
    case 'edUp': { const i = +t.dataset.i; if (i > 0) { const P = App.ed.pos; [P[i - 1], P[i]] = [P[i], P[i - 1]]; edRerender(); } break; }
    case 'edNewK': kundeDialog(null, { after: k => { App.ed.kunde = k.id; rechnungDialog(null, { keep: true }); } }); break;
    case 'edEditK': kundeDialog(App.ed.kunde, { after: () => rechnungDialog(null, { keep: true }) }); break;
    case 'edZahl': { const r = edClean(clone(App.ed)); edSave(r); zahlDialog(r.id, true); break; }
    case 'edMahn': { const r = edClean(clone(App.ed)); edSave(r); mahnDialog([r.id], true); break; }
    case 'edBeilDel': if (confirm('Beilage entfernen?')) { const B = beilagenOf(App.ed); B.splice(+t.dataset.i, 1); delete App.ed.beilage; App.ed.beilagen = B; edRerender(); } break;
    case 'edSel': { const S = App.edSel = App.edSel || new Set(); if (t.checked) S.add(t.dataset.id); else S.delete(t.dataset.id); edRerender(); break; }
    case 'edZus': zusatzDialog(); break;
    case 'edSum': { const n = zusammenfassen(App.ed); edRerender(); toast(n ? `${n} Positionen zusammengefasst` : 'Nichts zum Zusammenfassen'); break; }
    case 'printE': { const r = Store.get('rechnungen', id); if (r) printDocs([{ r }], { title: docTitle([{ r }]) }); break; }
    case 'sumR': { const r = Store.get('rechnungen', id); if (!r) break; const x = clone(r), n = zusammenfassen(x); if (n) { Store.put('rechnungen', x); toast(`${n} Positionen zusammengefasst`); } else toast('Nichts zum Zusammenfassen'); break; }
    case 'einCheck': Eingang.check({ quiet: false }); break;
    case 'selAllE': { const L = Store.all('rechnungen').filter(r => statusOf(r) === 'entwurf'); const all = L.every(r => App.sel.has(r.id)); L.forEach(r => all ? App.sel.delete(r.id) : App.sel.add(r.id)); App.render(); break; }
    case 'buchOpen': buchDialog(); break;
    case 'buchDir': Dir.pick().then(() => { if ($('#dlg').open) buchDialog(); }); break;
    case 'buchDirClear': Dir.clear().then(() => { ls('mf_buchdir', null); App.render(); }); break;
    case 'buchAgain': buchExport(buchZahlungenOf(id), id); break;
    case 'buchUndo': { const L = buchZahlungenOf(id); if (!confirm(`${L.length} Zahlungen wieder als «nicht exportiert» markieren? (Nur wenn der Import in AgroOffice nicht geklappt hat – sonst wird doppelt gebucht.)`)) break;
      const ch = new Map(); L.forEach(({ r, z }) => { const x = ch.get(r.id) || clone(r); const zz = x.zahlungen.find(q => q.id === z.id); if (zz) delete zz.exp; ch.set(r.id, x); });
      Store.putMany('rechnungen', [...ch.values()], { silent: true }); Store.setCfg({ buchExports: (Store.cfg().buchExports || []).filter(e => e.id !== id) }); buchDialog(); break; }
    case 'debExcel': debitorenExcel(($('[data-in=debStich]') || {}).value || `${new Date().getFullYear() - 1}-12-31`); break;
    case 'edMahnPrint': { const r = App.ed; printDocs([{ r, mahnung: +t.dataset.i }], { title: `Mahnung ${r.nr} ${kName(r.kunde)}` }); break; }
  }
});
function onInput(ev) {
  const t = ev.target, k = t.dataset && t.dataset.in; if (!k) return;
  if (k === 'ed' || k === 'edp' || k === 'edInkl') { edInput(t, false); return; }
  if (k === 'frq') { App.f.r.q = t.value; App.saveUi(); rerenderKeep(t); }
  if (k === 'opq') { App.f.op.q = t.value; App.saveUi(); rerenderKeep(t); }
  if (k === 'kq') { App.f.k.q = t.value; App.saveUi(); rerenderKeep(t); }
  if (k === 'aq') { App.f.a.q = t.value; App.saveUi(); rerenderKeep(t); }
  if (k === 'impBetreff' && App.imp) App.imp.betreff = t.value;
}
function rerenderKeep(t) { const key = `[data-in="${t.dataset.in}"]`, pos = t.selectionStart; App.render(); const n = $(key); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }
function setPath(o, path, v) { const p = path.split('.'); if (p.length === 1) return { [path]: v }; return { [p[0]]: Object.assign({}, o[p[0]], { [p[1]]: v }) }; }
function onChange(ev) {
  const t = ev.target, k = t.dataset && t.dataset.in; if (!k) return; const v = t.value;
  switch (k) {
    case 'ed': case 'edp': case 'edInkl': edInput(t, true); break;
    case 'fr': App.f.r[t.dataset.k] = v; App.sel.clear(); App.saveUi(); App.render(); break;
    case 'opUe': App.f.op.nurUeber = t.checked; App.saveUi(); App.render(); break;
    case 'kAlle': App.f.k.alle = t.checked; App.saveUi(); App.render(); break;
    case 'cfg': {
      const key = t.dataset.k, c = Store.cfg(); let val = v.trim();
      if (key === 'iban') val = SwissQR.iban(val);
      if (key === 'nextNr') { val = parseInt(val) || 1; const max = Store.all('rechnungen').reduce((m, r) => Math.max(m, parseInt(r.nr) || 0), 0); if (val <= max) { toast(`Muss grösser als ${max} sein (letzte vergebene Nummer)`); App.render(); return; } }
      if (key === 'frist') val = Math.max(0, parseInt(val) || 0);
      if (key === 'mwstDef') val = num(val);
      if (key === 'refPrefix') val = val.replace(/\D/g, '');
      Store.setCfg(setPath(c, key, val)); if (['iban', 'nextNr', 'refPrefix', 'mwstDef'].includes(key)) App.render(); toast('Gespeichert', 1200); break;
    }
    case 'cfgB': Store.setCfg({ [t.dataset.k]: t.checked }); break;
    case 'buch': Store.setCfg({ buch: Object.assign({}, Store.cfg().buch || {}, { [t.dataset.k]: /^beleg/.test(t.dataset.k) ? v.replace(/\D/g, '') : v.trim() }) }); toast('Gespeichert', 1200); if (/^beleg/.test(t.dataset.k)) App.render(); break;
    case 'buchCode': { const b = Object.assign({}, Store.cfg().buch || {}); b.codes = Object.assign({}, b.codes || {}, { [t.dataset.k]: v.trim() }); Store.setCfg({ buch: b }); toast('Gespeichert', 1200); break; }
    case 'buchBis': App.buchBis = v; buchDialog(); break;
    case 'ein': Store.setCfg({ ein: Object.assign({}, Store.cfg().ein || {}, { [t.dataset.k]: t.dataset.k === 'mwstArbeit' ? num(v) : v.trim() }) }); toast('Gespeichert', 1200); break;
    case 'mwst': { const m = Store.cfg().mwst, i = +t.dataset.i; m[i][t.dataset.f] = t.dataset.f === 'satz' ? (num(v) ?? 0) : v; Store.setCfg({ mwst: m }); App.render(); break; }
    case 'mahn': { const m = Store.cfg().mahn, i = +t.dataset.i, f = t.dataset.f; m[i][f] = f === 'gebuehr' || f === 'frist' ? (num(v) ?? 0) : v; Store.setCfg({ mahn: m }); break; }
    case 'logoFile': if (t.files[0]) { const fr = new FileReader(); fr.onload = () => { if (fr.result.length > 400000) { toast('Bild zu gross (max. ca. 300 KB)'); return; } Store.setCfg({ logo: fr.result }); App.render(); }; fr.readAsDataURL(t.files[0]); } t.value = ''; break;
    case 'restoreFile': if (t.files[0]) restore(t.files[0]); t.value = ''; break;
    case 'impAbrFile': if (t.files[0]) impAbrFile(t.files[0]); t.value = ''; break;
    case 'impKFile': if (t.files[0]) impKundenFile(t.files[0]); t.value = ''; break;
    case 'impAFile': if (t.files[0]) impArtFile(t.files[0]); t.value = ''; break;
    case 'camtFile': if (t.files.length) impCamt([...t.files]); t.value = ''; break;
    case 'impSel': App.imp.groups[+t.dataset.i].sel = t.checked; App.render(); break;
    case 'impK': App.imp.groups[+t.dataset.i].kId = v; App.imp.groups[+t.dataset.i].how = ''; App.render(); break;
    case 'impOpt': App.imp[t.dataset.k] = t.checked; App.render(); break;
  }
}
document.addEventListener('input', onInput);
document.addEventListener('change', onChange);
$('#tabs').addEventListener('click', ev => { const b = ev.target.closest('button[data-view]'); if (b) App.go(b.dataset.view); });
$('#dlg').addEventListener('close', () => { App.render(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches('#dlgForm input:not([type=checkbox]):not([type=file])')) { ev.preventDefault(); ev.target.dispatchEvent(new Event('change', { bubbles: true })); return; } if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'n' && !$('#dlg').open) { ev.preventDefault(); rechnungDialog(null); } });
window.addEventListener('online', () => Sync.run());
window.addEventListener('offline', () => Sync.setState('offline'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { Sync.run(); if (Date.now() - Eingang.last > 60000) Eingang.check(); } });
window.addEventListener('storage', ev => { if (ev.key === 'mf_data') { Store.load(); if (!App.busy()) App.render(); } });

/* ================= Ansichtszoom wie IM-Verwaltung (Vermietung v1.19 / Faktura v1.20) =================
   Titelleiste, Seitenleiste, Filter, Knöpfe und Fenster bleiben in Normalgrösse (wie IM-Verwaltung);
   gezoomt werden nur die Daten (Tabellen .dtab und Listen .mlist im Inhalt, --vz in styles.css).
   Standard 115 % ab 700 px Breite, Handy 100 %; pro Gerät gemerkt (mf_vz). Früher ganzes Fenster per body.style.zoom (mf_zoom). */
const Zoom = {
  def() { return innerWidth >= 700 ? 1.15 : 1; },
  get() { const z = parseFloat(ls('mf_vz')); return z >= 0.5 && z <= 2.5 ? z : this.def(); },
  set(z) { z = Math.round(Math.min(2.5, Math.max(0.5, z)) * 100) / 100; if (Math.abs(z - this.def()) < 0.001) ls('mf_vz', null); else ls('mf_vz', String(z)); this.apply(); },
  by(f) { this.set(this.get() * f); },
  apply() {
    document.body.style.removeProperty('zoom');
    const r = document.documentElement, z = this.get();
    if (z === 1) r.style.removeProperty('--vz'); else r.style.setProperty('--vz', z);
    r.style.setProperty('--appH', innerHeight + 'px');
    const t = $('.top'); if (t) r.style.setProperty('--toph', t.offsetHeight + 'px');
    const zt = $('#zoomTxt'); if (zt) zt.textContent = Math.round(z * 100) + ' %';
  }
};
try { if (ls('mf_zoom') != null) ls('mf_zoom', null); } catch {}
window.addEventListener('resize', () => Zoom.apply());
// Ctrl+Mausrad / Ctrl +/−/0: nie das ganze Fenster, nur die Daten (wie IM-Verwaltung)
document.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); if (e.target.closest && e.target.closest('dialog')) return; Zoom.by(Math.exp(-e.deltaY / 500)); }, { passive: false });
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); Zoom.by(1.15); }
  else if (e.key === '-') { e.preventDefault(); Zoom.by(1 / 1.15); }
  else if (e.key === '0') { e.preventDefault(); Zoom.set(Zoom.def()); }
});

/* ================= Start ================= */
(async function boot() {
  $('#appVer').textContent = 'v' + APP_VERSION; Zoom.apply();
  Store.load(); App.init();
  try { await Auth.handleRedirect(); } catch (e) { toast('Anmeldung fehlgeschlagen: ' + e.message, 6000); }
  App.render(); Sync.setState(); Sync.run(); setTimeout(() => Eingang.check(), 1500);
  setInterval(() => { if (document.visibilityState === 'visible') { Sync.run(); Eingang.check(); } }, 5 * 60 * 1000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
