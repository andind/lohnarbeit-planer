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
  App.imp = { fname, titel: /vermiet|maschin/i.test(fname) || items.some(i => /^1\d\d$/.test(i.art)) ? 'Rechnung' : 'Rechnung', betreff: /vermiet|maschin/i.test(fname) ? 'Maschinenmiete' : '',
    groups: [...G.values()].map(g => { const m = matchKunde(g.kd, g.kn); return Object.assign(g, { kId: m?.k.id || '', how: m?.how || '', sel: true }); }), artNeu: true, kNeu: true, append: false };
  App.go('import');
}
const impTotal = g => r2(g.items.reduce((s, i) => s + r2((i.menge ?? 1) * (i.preis || 0)), 0));
function impAbrCreate() {
  const I = App.imp, c = Store.cfg(); if (!I) return;
  const G = I.groups.filter(g => g.sel); if (!G.length) { toast('Keine Kunden ausgewählt'); return; }
  // fehlende Artikel anlegen
  if (I.artNeu) {
    const neu = new Map(); G.forEach(g => g.items.forEach(i => { if (i.art && !artByNr(i.art) && !neu.has(nrKey(i.art))) neu.set(nrKey(i.art), { id: uid(), artNr: i.art, bez: i.bez.replace(/^\d{2}\.\d{2}\.\d{4}\s+/, ''), einheit: i.einh, preis: i.preis, mwst: c.mwstDef, aktiv: true }); }));
    if (neu.size) Store.putMany('artikel', [...neu.values()], { silent: true });
  }
  let nNeuK = 0, nR = 0; const out = [];
  G.forEach(g => {
    let k = kunde(g.kId);
    if (!k) { if (!I.kNeu) return; k = { id: uid(), nr: g.kd || '', name: g.kn || ('Kunde ' + g.kd), aktiv: true, land: 'CH' }; Store.put('kunden', k, { silent: true }); nNeuK++; }
    const pos = g.items.map(i => newPos({ art: i.art, bez: i.bez, menge: i.menge, einh: i.einh, preis: i.preis, mwst: artByNr(i.art)?.mwst ?? i.mwst }));
    let r = I.append ? Store.all('rechnungen').find(x => x.kunde === k.id && statusOf(x) === 'entwurf') : null;
    if (r) { r = clone(r); r.pos.push(...pos); } else { r = newRechnung({ kunde: k.id, frist: k.frist ?? c.frist, betreff: I.betreff || '', quelle: I.fname }); r.pos = pos; }
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
  const det = detectCols(rows, KD_F);
  mapDialog('Kunden', rows, KD_F, det, ({ hi, map }) => {
    const L = rows.slice(hi + 1).map(r => { const g = f => String(pick(r, map, f) ?? '').trim(); let name = g('name'); if (g('vorname')) name = `${name} ${g('vorname')}`.trim(); if (!name) return null;
      let st = { strasse: g('strasse'), hausnr: g('hausnr') }; if (!st.hausnr) st = splitStreet(st.strasse); const po = splitPlzOrt(g('plz'), g('ort'));
      return { nr: nrKey(g('nr')), name, zusatz: g('zusatz'), ...st, ...po, land: g('land') || 'CH', mail: g('mail'), tel: g('tel') }; }).filter(Boolean);
    kundenMerge(L, file.name);
  }, ['name']);
}
async function impKundenDbx(src) {
  if (!Auth.hasSession()) { toast('Zuerst unter Mehr › Dropbox anmelden'); return; }
  toast('Lade Kunden aus Dropbox…');
  try {
    const path = src === 'vm' ? '/vermietung.json' : '/planung.json', d = await Drive.loadPath(path);
    if (!d) { toast(path + ' nicht gefunden'); return; }
    const L = (d.kunden || []).filter(k => !k.del && k.name).map(k => {
      const st = k.strasse != null ? splitStreet(k.strasse) : splitStreet(k.adresse), po = splitPlzOrt(k.plz, k.ort);
      return { nr: nrKey(k.nr), name: k.name, zusatz: k.zusatz || '', ...st, ...po, land: 'CH', mail: k.mail || '', tel: k.tel || k.handy || '', aliases: k.aliases || [] };
    });
    kundenMerge(L, src === 'vm' ? 'IM-Vermietung' : 'IM-Verwaltung');
  } catch (e) { toast(e.message, 6000); }
}
function kundenMerge(L, quelle) {
  const K = Store.all('kunden');
  const R = L.map(n => {
    const k = (n.nr && K.find(x => nrKey(x.nr) === n.nr)) || K.find(x => tokKey(x.name) === tokKey(n.name));
    if (!k) return { n, k: null, art: 'neu', sel: true };
    const fill = ['nr', 'zusatz', 'strasse', 'hausnr', 'plz', 'ort', 'mail', 'tel'].filter(f => n[f] && !k[f]);
    return { n, k, fill, art: fill.length ? 'ergänzen' : 'gleich', sel: fill.length > 0 };
  });
  App.kimp = { quelle, R };
  const cnt = a => R.filter(x => x.art === a).length;
  openDlg(`Kunden aus ${quelle}`, `<p class="muted small">${cnt('neu')} neu · ${cnt('ergänzen')} bestehende mit fehlenden Angaben (werden nur ergänzt, nie überschrieben) · ${cnt('gleich')} unverändert</p>
    <div class="dscroll" style="max-height:60vh"><table class="dtab"><thead><tr><th class="cb"><input type="checkbox" data-act="kimpAll" checked></th><th>Nr.</th><th>Name</th><th>Adresse</th><th>Aktion</th></tr></thead><tbody>
    ${R.map((x, i) => `<tr class="${x.art === 'gleich' ? 'off' : ''}"><td class="cb"><input type="checkbox" name="s${i}" ${x.sel ? 'checked' : ''} ${x.art === 'gleich' ? 'disabled' : ''}></td><td>${esc(x.n.nr)}</td><td>${esc(x.n.name)}</td>
      <td class="small">${esc([[x.n.strasse, x.n.hausnr].filter(Boolean).join(' '), [x.n.plz, x.n.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</td>
      <td>${x.art === 'neu' ? '<span class="chip ok">neu</span>' : x.art === 'ergänzen' ? `<span class="chip info">ergänzen: ${esc(x.fill.join(', '))}</span>` : '<span class="chip">unverändert</span>'}</td></tr>`).join('')}</tbody></table></div>`,
    `<span class="spacer"></span><button class="btn primary" value="ok">Übernehmen</button>`,
    { wide: true, onSubmit: fd => {
      const out = []; R.forEach((x, i) => { if (!fd.get('s' + i)) return;
        if (x.k) { const k = clone(x.k); x.fill.forEach(f => { k[f] = x.n[f]; }); out.push(k); }
        else out.push(Object.assign({ id: uid(), aktiv: true }, x.n)); });
      Store.putMany('kunden', out); toast(`${out.length} Kunden übernommen`);
    } });
}

/* ---------- Artikel übernehmen ---------- */
const ART_F = [['artNr', 'Art.-Nr.', /^art(ikel)?[-\s.]*(nr|nummer)\.?$|^nr\.?$|^artikel$/i], ['bez', 'Bezeichnung', /bezeichnung|maschine|name|text/i], ['einheit', 'Einheit', /^einh/i],
  ['preis', 'Preis', /^(preis|ansatz)/i], ['mwst', 'MWST-Satz', /mwst|mwst-satz|ust|steuer/i]];
async function impArtFile(file) {
  let rows; try { rows = await readTable(file); } catch (e) { toast('Datei nicht lesbar: ' + e.message, 6000); return; }
  mapDialog('Artikel', rows, ART_F, detectCols(rows, ART_F), ({ hi, map }) => {
    artMerge(rows.slice(hi + 1).map(r => { const g = f => String(pick(r, map, f) ?? '').trim(); if (!g('artNr') && !g('bez')) return null;
      const m = num(g('mwst')); return { artNr: g('artNr'), bez: g('bez'), einheit: g('einheit'), preis: num(g('preis')), mwst: m == null ? undefined : (m < 1 && m > 0 ? r2(m * 100) : m) }; }).filter(Boolean), file.name);
  }, ['bez']);
}
async function impArtVm() {
  if (!Auth.hasSession()) { toast('Zuerst unter Mehr › Dropbox anmelden'); return; }
  try { const d = await Drive.loadPath('/vermietung.json'); if (!d) { toast('vermietung.json nicht gefunden'); return; }
    artMerge((d.maschinen || []).filter(m => !m.del && m.artNr).map(m => ({ artNr: m.artNr, bez: m.name, einheit: m.einheit, preis: m.preis ?? null })), 'IM-Vermietung (Maschinen)');
  } catch (e) { toast(e.message, 6000); }
}
function artMerge(L, quelle) {
  const c = Store.cfg(); let neu = 0, upd = 0; const out = [];
  L.forEach(n => { const a = n.artNr ? artByNr(n.artNr) : Store.all('artikel').find(x => fold(x.bez) === fold(n.bez));
    if (a) { const x = clone(a); let ch = false; ['bez', 'einheit'].forEach(f => { if (n[f] && !x[f]) { x[f] = n[f]; ch = true; } }); if (n.preis != null && n.preis !== x.preis) { x.preis = n.preis; ch = true; } if (n.mwst != null && n.mwst !== x.mwst) { x.mwst = n.mwst; ch = true; } if (ch) { out.push(x); upd++; } }
    else { out.push({ id: uid(), artNr: n.artNr, bez: n.bez, einheit: n.einheit || '', preis: n.preis, mwst: n.mwst ?? c.mwstDef, aktiv: true }); neu++; } });
  if (!out.length) { toast(`${quelle}: nichts Neues`); return; }
  if (!confirm(`${quelle}: ${neu} neue Artikel, ${upd} Preise/Angaben aktualisieren?`)) return;
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
      const ch = new Map(); L.forEach((x, i) => { if (!fd.get('s' + i) || !x.r) return; const r = ch.get(x.r.id) || clone(x.r); r.zahlungen = r.zahlungen || []; r.zahlungen.push({ id: uid(), datum: x.datum, betrag: x.betrag, quelle: 'camt', key: x.key }); ch.set(r.id, r); });
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
