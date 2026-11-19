/* IM-Faktura – Import: Abrechnungslisten (IM-Vermietung, IM-Verwaltung, beliebige Excel/CSV), Kunden, Artikel, Zahlungen (camt.054) */
'use strict';

async function readTable(file) { return /\.csv$|\.txt$/i.test(file.name) ? readCsv(await file.text()) : await readXlsx(await file.arrayBuffer()); }
// Spalten über die Überschriften erkennen
function detectCols(rows, FIELDS) {
  let best = { hi: -1, map: {}, n: 0 };
  rows.slice(0, 12).forEach((r, hi) => {
    const map = {}, used = new Set();
    FIELDS.forEach(([f, , re]) => { const ci = r.findIndex((c, i) => !used.has(i) && re.test(String(c || '').trim())); if (ci >= 0) { map[f] = ci; used.add(ci); } });
    const n = Object.keys(map).length; if (n > best.n) best = { hi, map, n };
  });
  return best;
}
function mapDialog(title, rows, FIELDS, det, onOk, need) {
  const hdr = rows[det.hi] || rows[0] || [], ncol = Math.max(...rows.slice(0, 20).map(r => r.length), 0);
  const opts = sel => `<option value="">– keine –</option>` + Array.from({ length: ncol }, (_, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(xCol(i))}: ${esc(String(hdr[i] ?? '').slice(0, 30))}</option>`).join('');
  openDlg(title + ' – Spalten', `<p class="muted small">Überschriftenzeile: Zeile ${det.hi + 1}. Bitte prüfen, welche Spalte was enthält.</p>
    <label class="fld"><span>Überschrift in Zeile</span><input class="input" type="number" min="1" name="hi" value="${det.hi + 1}" style="width:100px"></label>
    <div class="two">${FIELDS.map(([f, l]) => `<label class="fld"><span>${esc(l)}${need.includes(f) ? ' *' : ''}</span><select class="input" name="c_${f}">${opts(det.map[f])}</select></label>`).join('')}</div>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Weiter</button>`,
    { wide: true, onSubmit: fd => { const map = {}; FIELDS.forEach(([f]) => { const v = fd.get('c_' + f); if (v !== '' && v != null) map[f] = +v; });
      if (!need.some(f => map[f] != null)) { toast('Bitte mindestens ' + need.map(f => FIELDS.find(x => x[0] === f)[1]).join(' oder ') + ' zuordnen'); return false; }
      setTimeout(() => onOk({ hi: Math.max(0, (+fd.get('hi') || 1) - 1), map }), 50); } });
}
const pick = (r, map, f) => map[f] != null ? r[map[f]] : '';

/* ---------- Abrechnungsliste → Rechnungsentwürfe ---------- */
const ABR_F = [['kdnr', 'Kunden-Nr.', /^(kd|kunden|kunde)[-\s.]*n(r|o|ummer)\.?$|^kdnr/i], ['kunde', 'Kunde (Name)', /^(kunde|name|mieter|kundenname|auftraggeber)$/i],
  ['art', 'Art.-Nr.', /^art(ikel)?[-\s.]*(nr|nummer)\.?$|^artikel$/i], ['bez', 'Bezeichnung', /bezeichnung|maschine|arbeit|beschreibung|leistung|text/i],
  ['menge', 'Menge', /^(menge|anzahl|fläche|flaeche|stunden|ha)\b/i], ['einh', 'Einheit', /^einh/i], ['preis', 'Preis', /^(preis|ansatz|einzelpreis)/i],
  ['betrag', 'Betrag', /^(betrag|total|summe)/i], ['datum', 'Datum', /^datum/i]];
async function impAbrFile(file) {
  let rows; try { rows = await readTable(file); } catch (e) { toast('Datei nicht lesbar: ' + e.message, 6000); return; }
  if (!rows.length) { toast('Datei ist leer'); return; }
  const det = detectCols(rows, ABR_F);
  const go = d => impAbrBuild(rows, d, file.name);
  if (det.n >= 4 && (det.map.kdnr != null || det.map.kunde != null) && (det.map.betrag != null || det.map.preis != null)) go(det);
  else mapDialog('Abrechnungsliste', rows, ABR_F, det, go, ['kunde', 'kdnr']);
}
function matchKunde(nr, name) {
  const K = Store.all('kunden'), n = nrKey(nr);
  if (n && /^\d+$/.test(n)) { const k = K.find(x => nrKey(x.nr) === n); if (k) return { k, how: 'nr' }; }
  if (name) { let best = null, bs = 0; K.forEach(x => { const s = Math.max(simil(name, x.name), ...(x.aliases || []).map(a => simil(name, a))); if (s > bs) { bs = s; best = x; } }); if (best && bs >= 0.86) return { k: best, how: bs > 0.99 ? 'name' : 'ähnlich' }; }
  return null;
}
function impAbrBuild(rows, { hi, map }, fname) {
  const items = [];
  rows.slice(hi + 1).forEach(r => {
    const kd = String(pick(r, map, 'kdnr') ?? '').trim(), kn = String(pick(r, map, 'kunde') ?? '').trim();
    if (!kd && !kn) return; if (/^(total|summe)/i.test(kn) || /^(total|summe)/i.test(kd)) return;
    let menge = num(pick(r, map, 'menge')), preis = num(pick(r, map, 'preis')), betrag = num(pick(r, map, 'betrag'));
    const art = String(pick(r, map, 'art') ?? '').trim(), a = artByNr(art);
    let bez = String(pick(r, map, 'bez') ?? '').trim() || a?.bez || '';
    const einh = String(pick(r, map, 'einh') ?? '').trim() || a?.einheit || '';
    if (preis == null && betrag != null && menge) preis = r2(betrag / menge);
    if (menge == null && betrag != null) { menge = 1; preis = preis ?? betrag; }
    if (preis == null && a && a.preis != null) preis = a.preis;
    if (!bez && !art) return;
    const dt = map.datum != null ? excelDate(pick(r, map, 'datum')) : '';
    if (dt) bez = `${fmtDate(dt)} ${bez}`;
    items.push({ kd: /^\d+$/.test(nrKey(kd)) ? nrKey(kd) : '', kn, art, bez, menge, einh, preis, mwst: a ? a.mwst ?? Store.cfg().mwstDef : Store.cfg().mwstDef, artNeu: !!art && !a });
  });
  if (!items.length) { toast('Keine Positionen gefunden – Spalten prüfen'); return; }
  const G = new Map();
  items.forEach(it => { const key = it.kd || fold(it.kn); if (!G.has(key)) G.set(key, { kd: it.kd, kn: it.kn, items: [] }); G.get(key).items.push(it); });
  const vm = (rows[hi] || []).some(c => /^eins(ä|ae)tze/i.test(String(c || '').trim())) || /abrechnungsliste|vermiet/i.test(fname);
  App.imp = { fname, vm, miete: vm, betreff: vm ? 'Maschinenmiete' : '',
    groups: [...G.values()].map(g => { const m = matchKunde(g.kd, g.kn); return Object.assign(g, { kId: m?.k.id || '', how: m?.how || '', sel: true }); }), artNeu: true, kNeu: true, append: false };
  App.go('import');
}
const MIETE_ART = '100';
const impTotal = g => r2(g.items.reduce((s, i) => s + r2((i.menge ?? 1) * (i.preis || 0)), 0));
function impAbrCreate() {
  const I = App.imp, c = Store.cfg(); if (!I) return;
  const G = I.groups.filter(g => g.sel); if (!G.length) { toast('Keine Kunden ausgewählt'); return; }
  // fehlende Artikel anlegen
  if (I.artNeu && !I.miete) {
    const neu = new Map(); G.forEach(g => g.items.forEach(i => { if (i.art && !artByNr(i.art) && !neu.has(nrKey(i.art))) neu.set(nrKey(i.art), { id: uid(), artNr: i.art, bez: i.bez.replace(/^\d{2}\.\d{2}\.\d{4}\s+/, ''), einheit: i.einh, preis: i.preis, mwst: c.mwstDef, aktiv: true }); }));
    if (neu.size) Store.putMany('artikel', [...neu.values()], { silent: true });
  }
  let nNeuK = 0, nR = 0; const out = [];
  G.forEach(g => {
    let k = kunde(g.kId);
    if (!k) { if (!I.kNeu) return; k = { id: uid(), nr: g.kd || '', name: g.kn || ('Kunde ' + g.kd), aktiv: true, land: 'CH' }; Store.put('kunden', k, { silent: true }); nNeuK++; }
    let pos, beilage = null;
    if (I.miete) { // Version A: eine Zeile «100 Maschinenmiete gemäss Rapport», Einzelheiten als Beilage
      const a = artByNr(MIETE_ART), tot = impTotal(g);
      pos = [newPos({ art: MIETE_ART, bez: a?.bez || 'Maschinenmiete gemäss Rapport', menge: 1, einh: a?.einheit || '', preis: tot, mwst: a?.mwst ?? 8.1, konto: a?.konto || '3411' })];
      beilage = { titel: 'Rapport Maschinenmiete', cols: [['Art.-Nr.', '', 'ca'], ['Maschine', ''], ['Menge', 'q', 'cm'], ['Einheit', '', 'ce'], ['Preis', 'chf', 'cp'], ['Betrag CHF', 'chf', 'cb']],
        rows: g.items.map(i => [i.art, i.bez, i.menge, i.einh, i.preis, r2((i.menge ?? 1) * (i.preis || 0))]), total: tot, quelle: I.fname };
    } else pos = g.items.map(i => { const a = artByNr(i.art); return newPos({ art: i.art, bez: i.bez, menge: i.menge, einh: i.einh, preis: i.preis, mwst: a?.mwst ?? i.mwst, konto: a?.konto || '' }); });
    let r = I.append ? Store.all('rechnungen').find(x => x.kunde === k.id && statusOf(x) === 'entwurf') : null;
    if (r) { r = clone(r); r.pos.push(...pos); } else { r = newRechnung({ kunde: k.id, frist: k.frist ?? c.frist, betreff: I.betreff || '', quelle: I.fname }); r.pos = pos; }
    if (beilage) addBeilage(r, beilage);
    out.push(r); nR++;
  });
  Store.putMany('rechnungen', out, { silent: true });
  App.imp = null; App.f.r = Object.assign(App.f.r, { status: 'entwurf' }); App.go('rechnungen');
  toast(`${nR} Rechnungsentwürfe erstellt${nNeuK ? ` · ${nNeuK} neue Kunden (Adresse ergänzen!)` : ''}`, 5000);
}

/* ---------- Kunden übernehmen ---------- */
const KD_F = [['nr', 'Kunden-Nr.', /^(kd|kunden)?[-\s.]*n(r|o|ummer)\.?$|^kdnr/i], ['name', 'Name', /^(name|nachname|kunde|firma|kundenname)$/i], ['vorname', 'Vorname', /^vorname/i],
  ['zusatz', 'Zusatz', /^(zusatz|adresszusatz|z\.?\s?hd)/i], ['strasse', 'Strasse', /^(strasse|straße|adresse)/i], ['hausnr', 'Hausnummer', /^(haus|nr\.?$|hausnr)/i],
  ['plz', 'PLZ', /^plz|postleit/i], ['ort', 'Ort', /^(ort|wohnort|plz\s*ort)/i], ['land', 'Land', /^land/i], ['mail', 'E-Mail', /mail/i], ['tel', 'Telefon', /^(tel|telefon|natel|handy|mobile)/i]];
async function impKundenFile(file) {
  let rows; try { rows = await readTable(file); } catch (e) { toast('Datei nicht lesbar: ' + e.message, 6000); return; }
  const ao = agroKunden(rows); if (ao) { kundenMerge(ao, 'AgroOffice Fakturierung (' + file.name + ')', { upd: true }); return; }
  const det = detectCols(rows, KD_F);
  mapDialog('Kunden', rows, KD_F, det, ({ hi, map }) => {
    const L = rows.slice(hi + 1).map(r => { const g = f => String(pick(r, map, f) ?? '').trim(); let name = g('name'); if (g('vorname')) name = `${name} ${g('vorname')}`.trim(); if (!name) return null;
      let st = { strasse: g('strasse'), hausnr: g('hausnr') }; if (!st.hausnr) st = splitStreet(st.strasse); const po = splitPlzOrt(g('plz'), g('ort'));
      return { nr: nrKey(g('nr')), name, zusatz: g('zusatz'), ...st, ...po, land: g('land') || 'CH', mail: g('mail'), tel: g('tel') }; }).filter(Boolean);
    kundenMerge(L, file.name);
  }, ['name']);
}
// Kundenliste aus AgroOffice Fakturierung (Export «Kunden»): Kunden-Nummer, Firma/Privat-Adresse, Firmenname, Firmenzusatz, Titel, Anrede, Name, Vorname,
// Strasse, Strassennummer, Adresszusatz, Postfach, Postfachnummer, Land, PLZ, Ort, Telefon1/2, Mobile, Fax, E-Mail, Web, Brief-Anrede, Code1–6, Bemerkungen
function agroKunden(rows) {
  const hi = rows.slice(0, 5).findIndex(r => r.some(c => /^kunden-?nummer$/i.test(String(c || '').trim())) && r.some(c => /^(firma\/privat|strassennummer|firmenname)/i.test(String(c || '').trim())));
  if (hi < 0) return null;
  const H = rows[hi].map(c => fold(String(c || '').trim())), col = n => H.indexOf(fold(n));
  const g = (r, n) => { const i = col(n); return i < 0 ? '' : String(r[i] ?? '').trim(); };
  return rows.slice(hi + 1).map(r => {
    const nr = nrKey(g(r, 'Kunden-Nummer')); if (!nr) return null;
    const firma = g(r, 'Firmenname'), istFirma = g(r, 'Firma/Privat-Adresse') === '1' || !!firma;
    const person = [g(r, 'Name'), g(r, 'Vorname')].filter(Boolean).join(' ');
    const name = (istFirma ? firma || person : person || firma) || g(r, 'Anrede'); if (!name) return null;
    const anrede = [g(r, 'Anrede'), g(r, 'Titel')].filter(Boolean).join(' ').replace(/^Herrr$/, 'Herr');
    let az = g(r, 'Adresszusatz'), st = { strasse: g(r, 'Strasse'), hausnr: g(r, 'Strassennummer') };
    if (!st.strasse && /\d/.test(az)) { st.strasse = az; az = ''; } // Strasse steht teils im Adresszusatz
    if (!st.hausnr) st = splitStreet(st.strasse);
    const zusatz = [g(r, 'Firmenzusatz'), istFirma && firma && person ? person : '', az].filter(Boolean).join(', ');
    if (!st.strasse && (g(r, 'Postfach') || g(r, 'Postfachnummer'))) st = { strasse: ('Postfach ' + g(r, 'Postfachnummer')).trim(), hausnr: '' };
    const po = splitPlzOrt(g(r, 'PLZ'), g(r, 'Ort')), land = (g(r, 'Land') || 'CH').toUpperCase().slice(0, 2);
    const o = { nr, name, anrede, zusatz, ...st, ...po, land, mail: g(r, 'E-Mail'), tel: g(r, 'Telefon1') || g(r, 'Telefon2') || g(r, 'Mobile') };
    if (g(r, 'Bemerkungen')) o.bem = g(r, 'Bemerkungen');
    return o;
  }).filter(Boolean);
}
async function impKundenDbx(src) {
  if (!Auth.hasSession()) { toast('Zuerst unter Mehr › Dropbox anmelden'); return; }
  toast('Lade Kunden aus Dropbox…');
  try {
    const path = src === 'vm' ? '/vermietung.json' : '/planung.json', d = await Drive.loadPath(path);
    if (!d) { toast(path + ' nicht gefunden'); return; }
    const L = (d.kunden || []).filter(k => !k.del && k.name).map(k => {
      const st = k.strasse != null ? splitStreet(k.strasse) : splitStreet(k.adresse), po = splitPlzOrt(k.plz, k.ort);
      return { nr: nrKey(k.nr), name: k.name, zusatz: k.zusatz || '', ...st, ...po, land: 'CH', mail: k.mail || '', tel: k.tel || k.handy || '', aliases: k.aliases || [], _link: src === 'vm' ? { vmId: k.id } : { imvId: k.id } };
    });
    kundenMerge(L, src === 'vm' ? 'IM-Vermietung' : 'IM-Verwaltung');
  } catch (e) { toast(e.message, 6000); }
}
function kundenMerge(L, quelle, { upd = false } = {}) {
  const K = Store.all('kunden');
  const R = L.map(n => {
    const lk = n._link || {};
    const k = (lk.vmId && K.find(x => x.vmId === lk.vmId)) || (lk.imvId && K.find(x => (x.imvIds || []).includes(lk.imvId))) || (n.nr && K.find(x => nrKey(x.nr) === n.nr)) || K.find(x => tokKey(x.name) === tokKey(n.name));
    if (!k) return { n, k: null, art: 'neu', sel: true };
    const F = ['nr', 'anrede', 'zusatz', 'strasse', 'hausnr', 'plz', 'ort', 'land', 'mail', 'tel', 'bem'];
    const fill = F.filter(f => n[f] && !k[f]), diff = upd ? [...F, 'name'].filter(f => n[f] && k[f] && String(n[f]) !== String(k[f])) : [];
    const link = (lk.vmId && k.vmId !== lk.vmId) || (lk.imvId && !(k.imvIds || []).includes(lk.imvId));
    return { n, k, fill, diff, link, art: diff.length ? 'abweichend' : fill.length ? 'ergänzen' : link ? 'verknüpfen' : 'gleich', sel: fill.length > 0 || diff.length > 0 || !!link };
  });
  App.kimp = { quelle, R };
  const cnt = a => R.filter(x => x.art === a).length;
  const FN = { nr: 'Nr.', name: 'Name', anrede: 'Anrede', zusatz: 'Zusatz', strasse: 'Strasse', hausnr: 'Nr.', plz: 'PLZ', ort: 'Ort', land: 'Land', mail: 'E-Mail', tel: 'Telefon', bem: 'Bemerkung' };
  openDlg(`Kunden aus ${quelle}`, `<p class="muted small">${L.length} Kunden gelesen: ${cnt('neu')} neu · ${cnt('ergänzen')} bestehende mit fehlenden Angaben (werden ergänzt)${upd ? ` · ${cnt('abweichend')} mit abweichenden Angaben` : ''} · ${cnt('verknüpfen')} nur verknüpfen · ${cnt('gleich')} unverändert</p>
    ${upd ? `<label class="tog" style="display:flex;margin:0 0 8px"><input type="checkbox" name="ueber" checked> Abweichende Angaben mit der Liste <b>&nbsp;überschreiben&nbsp;</b> (sonst nur Fehlendes ergänzen)</label>` : ''}
    <div class="dscroll" style="max-height:60vh"><table class="dtab"><thead><tr><th class="cb"><input type="checkbox" data-act="kimpAll" checked></th><th>Nr.</th><th>Name</th><th>Adresse</th><th>Aktion</th></tr></thead><tbody>
    ${R.map((x, i) => `<tr class="${x.art === 'gleich' ? 'off' : ''}"><td class="cb"><input type="checkbox" name="s${i}" ${x.sel ? 'checked' : ''} ${x.art === 'gleich' ? 'disabled' : ''}></td><td>${esc(x.n.nr)}</td><td>${esc(x.n.name)}${x.k && tokKey(x.k.name) !== tokKey(x.n.name) ? `<div class="small muted">→ ${esc(x.k.name)}</div>` : ''}</td>
      <td class="small">${esc([[x.n.strasse, x.n.hausnr].filter(Boolean).join(' '), [x.n.plz, x.n.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</td>
      <td>${x.art === 'neu' ? '<span class="chip ok">neu</span>' : x.art === 'ergänzen' ? `<span class="chip info">ergänzen: ${esc(x.fill.map(f => FN[f]).join(', '))}${x.link ? ' + verknüpfen' : ''}</span>` : x.art === 'verknüpfen' ? '<span class="chip info">verknüpfen</span>' : x.art === 'abweichend' ? `<span class="chip warn" title="${esc(x.diff.map(f => `${FN[f]}: ${x.k[f]} → ${x.n[f]}`).join('\n'))}">abweichend: ${esc(x.diff.map(f => FN[f]).join(', '))}</span>${x.fill.length ? ` <span class="chip info">+ ${esc(x.fill.map(f => FN[f]).join(', '))}</span>` : ''}` : '<span class="chip">unverändert</span>'}</td></tr>`).join('')}</tbody></table></div>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Übernehmen</button>`,
    { wide: true, onSubmit: fd => {
      const out = []; R.forEach((x, i) => { if (!fd.get('s' + i)) return;
        const n = Object.assign({}, x.n); delete n._link;
        if (x.k) { const k = clone(x.k); x.fill.forEach(f => { k[f] = n[f]; }); if (fd.get('ueber')) x.diff.forEach(f => { k[f] = n[f]; }); kLink(k, x.n._link || {}); out.push(k); }
        else { const k = Object.assign({ id: uid(), aktiv: true }, n); kLink(k, x.n._link || {}); out.push(k); } });
      Store.putMany('kunden', out); toast(`${out.length} Kunden übernommen`);
    } });
}

/* ---------- Kunden mit der IM-Verwaltung verknüpfen ----------
   Die Kunden der IM-Verwaltung kommen aus MyJohnDeere (dort gepflegt). Hier wird jedem ein Kunde von IM-Faktura zugeordnet (k.imvIds),
   damit Abrechnungen aus der IM-Verwaltung beim richtigen Kunden landen. Ein Faktura-Kunde kann mehrere JD-Kunden haben. */
const IMV_NEU = '＋ als neuen Kunden anlegen';
async function imvKunden(force) {
  if (App.imvK && !force) return App.imvK;
  if (!Auth.hasSession()) throw new Error('Zuerst unter Mehr › Dropbox anmelden');
  const d = await Drive.loadPath('/planung.json'); if (!d) throw new Error('/planung.json (IM-Verwaltung) nicht gefunden');
  App.imvK = (d.kunden || []).filter(k => !k.del && k.name).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return App.imvK;
}
async function imvLinkDialog(nurOffen = true) {
  let L; try { toast('Lade Kunden der IM-Verwaltung…'); L = await imvKunden(true); } catch (e) { toast(e.message, 5000); return; }
  const K = kundenSorted(), lab = k => `${k.name}${k.nr ? ' · Nr. ' + k.nr : ''}${k.ort ? ' · ' + k.ort : ''}`, byLab = new Map(K.map(k => [lab(k), k.id]));
  const R = L.map(v => {
    const cur = K.find(k => (k.imvIds || []).includes(v.id));
    const sug = cur ? null : matchKunde(nrKey(v.nr), v.name);
    return { v, cur, sug: sug && sug.k, how: sug && sug.how };
  });
  const nOff = R.filter(x => !x.cur).length;
  openDlg('Kunden mit IM-Verwaltung verknüpfen', `<p class="muted small">Die Kunden der IM-Verwaltung kommen aus MyJohnDeere. Ordne jedem den Kunden von IM-Faktura zu – Abrechnungen aus der IM-Verwaltung landen dann beim richtigen Kunden. Vorschläge (gelb) werden mit «Speichern» übernommen; Feld leeren = nicht verknüpfen.</p>
    <div class="filters"><input class="input search" type="search" placeholder="Suchen…" id="imvQ"><label class="tog"><input type="checkbox" id="imvOff" ${nurOffen ? 'checked' : ''}> nur ohne Verknüpfung (${nOff})</label><span class="lbl">${L.length} Kunden in der IM-Verwaltung</span></div>
    <datalist id="fkList"><option value="${esc(IMV_NEU)}">${K.map(k => `<option value="${esc(lab(k))}">`).join('')}</datalist>
    <div class="dscroll" style="max-height:58vh"><table class="dtab" id="imvTab"><thead><tr><th>IM-Verwaltung (MyJohnDeere)</th><th>Kunde in IM-Faktura</th><th></th></tr></thead><tbody>
    ${R.map((x, i) => { const val = x.cur ? lab(x.cur) : x.sug ? lab(x.sug) : '';
      return `<tr data-off="${x.cur ? 0 : 1}" data-q="${esc(fold([x.v.name, x.v.nr, x.v.ort, val].join(' ')))}"><td><b>${esc(x.v.name)}</b>${x.v.nr ? ` <span class="nr">${esc(x.v.nr)}</span>` : ''}<div class="small muted">${esc([x.v.adresse, [x.v.plz, x.v.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</div></td>
        <td><input class="input" name="v${i}" list="fkList" value="${esc(val)}" placeholder="– nicht verknüpft –" style="${!x.cur && x.sug ? 'background:#fff6d6' : ''}"></td>
        <td>${x.cur ? '<span class="chip ok">verknüpft</span>' : x.sug ? `<span class="chip warn">Vorschlag (${esc(x.how)})</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Speichern</button>`,
    { wide: true, onSubmit: async fd => {
      const map = new Map(K.map(k => [k.id, new Set((k.imvIds || []).filter(i => !L.some(v => v.id === i)))])), neu = [];
      let bad = 0;
      R.forEach((x, i) => { const t = String(fd.get('v' + i) || '').trim(); if (!t) return;
        if (t === IMV_NEU) { const st = splitStreet(x.v.adresse), po = splitPlzOrt(x.v.plz, x.v.ort);
          neu.push({ id: uid(), nr: /^\d+$/.test(nrKey(x.v.nr)) ? nrKey(x.v.nr) : '', name: x.v.name, anrede: x.v.anrede || '', ...st, ...po, land: 'CH', mail: x.v.mail || '', tel: x.v.tel || x.v.handy || '', aktiv: true, imvIds: [x.v.id] }); return; }
        const id = byLab.get(t); if (!id) { bad++; return; } map.get(id).add(x.v.id); });
      if (bad && !await frage(`${bad} Eingaben passen zu keinem Kunden und werden übergangen. Trotzdem speichern?`)) return false;
      const ch = K.filter(k => { const a = [...map.get(k.id)].sort().join(), b = [...(k.imvIds || [])].sort().join(); return a !== b; }).map(k => Object.assign(clone(k), { imvIds: [...map.get(k.id)] }));
      Store.putMany('kunden', [...ch, ...neu]); toast(`${ch.length} Kunden verknüpft${neu.length ? ` · ${neu.length} neu angelegt (Adresse prüfen)` : ''}`, 5000);
    } });
  const flt = () => { const q = fold($('#imvQ').value), off = $('#imvOff').checked; $$('#imvTab tbody tr').forEach(tr => { tr.style.display = (!q || tr.dataset.q.includes(q)) && (!off || tr.dataset.off === '1') ? '' : 'none'; }); };
  $('#imvQ').addEventListener('input', flt); $('#imvOff').addEventListener('change', flt); flt();
}

/* ---------- Artikel übernehmen ---------- */
const ART_F = [['artNr', 'Art.-Nr.', /^art(ikel)?[-\s.]*(nr|nummer)\.?$|^nr\.?$|^artikel$/i], ['bez', 'Bezeichnung', /bezeichnung|maschine|name|^text$/i], ['beschr', 'Beschreibung', /beschreib|zusatz|langtext/i], ['einheit', 'Einheit', /^einh/i],
  ['preis', 'Preis', /^(preis|ansatz)/i], ['mwst', 'MWST-Satz', /mwst|mwst-satz|ust|steuer/i], ['konto', 'Konto', /^(konto|ertragskonto|kto)/i]];
// MWST-Satz aus Text («2.6%», «8.0%») – alte Sätze werden auf die seit 2024 gültigen umgestellt
function mwstParse(v) { if (v == null || String(v).trim() === '') return 0; let m = num(String(v).replace('%', '')); if (m == null) return 0; if (m > 0 && m < 1) m = r2(m * 100); return ({ 8: 8.1, 7.7: 8.1, 7.6: 8.1, 2.5: 2.6, 2.4: 2.6, 3.7: 3.8, 3.5: 3.8 })[m] ?? m; }
async function impArtFile(file) {
  let rows; try { rows = await readTable(file); } catch (e) { toast('Datei nicht lesbar: ' + e.message, 6000); return; }
  mapDialog('Artikel', rows, ART_F, detectCols(rows, ART_F), ({ hi, map }) => {
    artMerge(rows.slice(hi + 1).map(r => { const g = f => String(pick(r, map, f) ?? '').trim(); if (!g('artNr') && !g('bez')) return null;
      return { artNr: g('artNr'), bez: g('bez'), beschr: g('beschr'), einheit: g('einheit'), preis: num(g('preis')), mwst: map.mwst != null ? mwstParse(g('mwst')) : undefined, konto: g('konto').replace(/\D/g, '') }; }).filter(Boolean), file.name);
  }, ['bez']);
}
async function impArtVm() {
  if (!Auth.hasSession()) { toast('Zuerst unter Mehr › Dropbox anmelden'); return; }
  try { const d = await Drive.loadPath('/vermietung.json'); if (!d) { toast('vermietung.json nicht gefunden'); return; }
    artMerge((d.maschinen || []).filter(m => !m.del && m.artNr).map(m => ({ artNr: m.artNr, bez: m.name, einheit: m.einheit, preis: m.preis ?? null })), 'IM-Vermietung (Maschinen)');
  } catch (e) { toast(e.message, 6000); }
}
async function artMerge(L, quelle) {
  const c = Store.cfg(); let neu = 0, upd = 0; const out = [];
  L.forEach(n => { const a = n.artNr ? artByNr(n.artNr) : Store.all('artikel').find(x => fold(x.bez) === fold(n.bez));
    if (a) { const x = clone(a); let ch = false; ['bez', 'einheit', 'beschr'].forEach(f => { if (n[f] && !x[f]) { x[f] = n[f]; ch = true; } }); if (n.preis != null && n.preis !== x.preis) { x.preis = n.preis; ch = true; } if (n.mwst != null && n.mwst !== x.mwst) { x.mwst = n.mwst; ch = true; } if (n.konto && n.konto !== x.konto) { x.konto = n.konto; ch = true; } if (ch) { out.push(x); upd++; } }
    else { out.push({ id: uid(), artNr: n.artNr, bez: n.bez, ...(n.beschr ? { beschr: n.beschr } : {}), einheit: n.einheit || '', preis: n.preis, mwst: n.mwst ?? c.mwstDef, konto: n.konto || '', aktiv: true }); neu++; } });
  if (!out.length) { toast(`${quelle}: nichts Neues`); return; }
  if (!await frage(`${quelle}: ${neu} neue Artikel, ${upd} Preise/Angaben aktualisieren?`)) return;
  Store.putMany('artikel', out); toast(`${neu + upd} Artikel übernommen`);
}

/* ---------- Zahlungen aus camt.054 / camt.053 (QR-Referenz) ---------- */
async function impCamt(files) {
  const T = [];
  for (const f of files) {
    let txt = '';
    try { txt = /\.zip$/i.test(f.name) ? await zipTexts(await f.arrayBuffer()) : await f.text(); } catch (e) { toast(f.name + ': ' + e.message, 6000); continue; }
    txt.split('\u0000').forEach(x => { if (x.trim()) T.push(...camtParse(x)); });
  }
  if (!T.length) { toast('Keine Gutschriften mit Referenz gefunden'); return; }
  const R = Store.all('rechnungen').filter(r => r.ref), byRef = new Map(R.map(r => [r.ref, r]));
  const L = T.map(t => { const r = byRef.get(t.ref) || null, dup = r && (r.zahlungen || []).some(z => z.key === t.key); return Object.assign(t, { r, dup, sel: !!r && !dup }); });
  openDlg('Zahlungen einlesen', `<p class="muted small">${L.length} Gutschriften · ${L.filter(x => x.r && !x.dup).length} passen zu einer Rechnung · ${L.filter(x => x.dup).length} schon erfasst · ${L.filter(x => !x.r).length} ohne passende Rechnung</p>
    <div class="dscroll" style="max-height:60vh"><table class="dtab"><thead><tr><th class="cb"></th><th>Datum</th><th class="n">Betrag</th><th>Referenz</th><th>Rechnung</th><th class="n">offen</th></tr></thead><tbody>
    ${L.map((x, i) => `<tr class="${x.dup || !x.r ? 'off' : ''}"><td class="cb"><input type="checkbox" name="s${i}" ${x.sel ? 'checked' : ''} ${x.r && !x.dup ? '' : 'disabled'}></td><td>${fmtDate(x.datum)}</td><td class="n">${chf(x.betrag)}</td><td class="small">${esc(SwissQR.fmtRef(x.ref))}</td>
      <td>${x.r ? `${esc(x.r.nr)} · ${esc(kName(x.r.kunde))}${x.dup ? ' <span class="chip">schon erfasst</span>' : ''}` : `<span class="chip warn">keine Rechnung</span>${x.name ? ' <span class="small">' + esc(x.name) + '</span>' : ''}`}</td><td class="n">${x.r ? chf(offenBetrag(x.r)) : ''}</td></tr>`).join('')}</tbody></table></div>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Zahlungen verbuchen</button>`,
    { wide: true, onSubmit: fd => {
      const ch = new Map(); L.forEach((x, i) => { if (!fd.get('s' + i) || !x.r) return; const r = ch.get(x.r.id) || clone(x.r); r.zahlungen = r.zahlungen || []; r.zahlungen.push({ id: uid(), datum: x.datum, betrag: x.betrag, quelle: 'camt', key: x.key, konto: buchCfg().bank }); ch.set(r.id, r); });
      Store.putMany('rechnungen', [...ch.values()]); toast(`${[...ch.values()].reduce((s, r) => s + r.zahlungen.filter(z => z.quelle === 'camt').length, 0) ? 'Zahlungen verbucht' : 'Nichts verbucht'} (${ch.size} Rechnungen)`);
    } });
}
async function zipTexts(buf) { // ZIP mit mehreren camt-Dateien
  const u8 = new Uint8Array(buf), dv = new DataView(buf); let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei');
  const n = dv.getUint16(eocd + 10, true); let off = dv.getUint32(eocd + 16, true); const names = [];
  for (let k = 0; k < n; k++) { const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true); names.push(new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen))); off += 46 + nlen + xlen + clen; }
  const get = await unzip(buf), out = [];
  for (const nm of names) if (/\.xml$/i.test(nm)) out.push(await get(nm));
  return out.join('\u0000');
}
function camtParse(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml'), out = [];
  const one = (el, path) => { let cur = el; for (const p of path.split('/')) { cur = cur && [...cur.children].find(c => c.localName === p); } return cur ? cur.textContent.trim() : ''; };
  [...doc.getElementsByTagNameNS('*', 'Ntry')].forEach(ntry => {
    if (one(ntry, 'CdtDbtInd') !== 'CRDT' || /RVSL|true/i.test(one(ntry, 'RvslInd'))) return;
    const datum = one(ntry, 'BookgDt/Dt') || one(ntry, 'ValDt/Dt') || (one(ntry, 'BookgDt/DtTm') || '').slice(0, 10);
    [...ntry.getElementsByTagNameNS('*', 'TxDtls')].forEach(tx => {
      const ref = (one(tx, 'RmtInf/Strd/CdtrRefInf/Ref') || '').replace(/\s/g, ''); if (!ref) return;
      if (one(tx, 'CdtDbtInd') === 'DBIT') return;
      const betrag = num(one(tx, 'Amt') || one(tx, 'AmtDtls/TxAmt/Amt')); if (!betrag) return;
      const asr = one(tx, 'Refs/AcctSvcrRef') || one(tx, 'Refs/EndToEndId');
      out.push({ ref, betrag, datum, name: one(tx, 'RltdPties/Dbtr/Nm') || one(tx, 'RltdPties/Dbtr/Pty/Nm'), key: asr && asr !== 'NOTPROVIDED' ? asr : `${ref}|${datum}|${betrag}` });
    });
  });
  return out;
}
