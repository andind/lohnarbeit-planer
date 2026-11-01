/* IM-Verwalter – Kulturliste mit zwei Ebenen
   Oberbegriff (Weizen, Gerste, Mais …) für Aufträge und Auswertungen;
   genaue Kultur (Winterweizen, Sommerweizen, Silomais …) für Pflanzenschutz und Eigener Betrieb.
   Daten: «einstellungen», id «kulturen»: { list: [{ id, name, ober, zw, syn: [], aktiv }] }
   Eine Bezeichnung in Aufträgen, Parzellen und Fruchtfolge wird so aufgelöst:
   1. genaue Kultur (Name oder Synonym)  2. Oberbegriff  3. unbekannt (→ Assistent «Kulturen ordnen»). */
'use strict';

// Vorgabe: [Oberbegriff, [genaue Kulturen]] – die erste Kultur gilt als üblichste (Vorschlag)
const KU_DEF = [['Weizen', ['Winterweizen', 'Sommerweizen']], ['Gerste', ['Wintergerste', 'Sommergerste']], ['Triticale', ['Triticale']], ['Dinkel', ['Dinkel']],
  ['Roggen', ['Roggen']], ['Hafer', ['Sommerhafer', 'Winterhafer']], ['Raps', ['Winterraps']], ['Mais', ['Silomais', 'Körnermais']], ['Zuckerrüben', ['Zuckerrüben']],
  ['Kartoffeln', ['Kartoffeln']], ['Soja', ['Soja']], ['Sonnenblumen', ['Sonnenblumen']], ['Eiweisserbsen', ['Eiweisserbsen', 'Wintereiweisserbsen']],
  ['Ackerbohnen', ['Ackerbohnen']], ['Kunstwiese', ['Kunstwiese']], ['Naturwiese', ['Naturwiese']], ['Weide', ['Weide']], ['Stoppeln', ['Stoppeln']]];
const KU_ZF = 'Zwischenfrucht';
const KU_ZF_RE = /zwischenfrucht|gründüngung|ufa |ufa$|mischung|spezial|senf|phacelia|ölrettich|buchweizen|alexandriner|klee|wicke|lepha|alpha|express|wintergrün|guizotia|sorghum|moha|grünschnitt|sommerwicke|rapivert|structurator/i;
// übliche Abkürzungen (Vorschlag im Assistenten)
const KU_ABK = { ww: 'Winterweizen', sw: 'Sommerweizen', wg: 'Wintergerste', sg: 'Sommergerste', wr: 'Winterraps', zr: 'Zuckerrüben', sm: 'Silomais', km: 'Körnermais', kw: 'Kunstwiese', tr: 'Triticale' };
const kuNorm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const kuSlug = s => 'ku-' + kuNorm(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------- Liste ---------- */
const kuDoc = () => Store.get('einstellungen', 'kulturen');
// Oberbegriff erraten: «Winterdinkel» → Dinkel, «Silomais» → Mais, Zwischenfrüchte → Zwischenfrucht
function kuGuessOber(name, obers) {
  const n = kuNorm(name), base = n.replace(/^(winter|sommer|früh|spät)[\s-]?/, '');
  const hit = obers.find(o => kuNorm(o) === base) || obers.filter(o => kuNorm(o).length >= 4 && n.endsWith(kuNorm(o))).sort((a, b) => b.length - a.length)[0];
  if (hit) return hit;
  return KU_ZF_RE.test(name) ? KU_ZF : String(name).trim();
}
// Startliste: Vorgabe + bisherige Kulturliste (Mehr) + Kulturen und Zwischenfrüchte aus «Eigener Betrieb» – auf allen Geräten gleich (feste IDs)
function kuSeed() {
  const L = [], add = (name, ober, zw = false, aktiv = true) => { if (!name || L.some(x => kuNorm(x.name) === kuNorm(name))) return; L.push({ id: kuSlug(name), name: String(name).trim(), ober, zw, syn: [], aktiv }); };
  KU_DEF.forEach(([o, ks]) => ks.forEach(k => add(k, o)));
  add('Gründüngung', KU_ZF, true);
  const obers = () => [...new Set(L.map(x => x.ober))];
  const c = Store.cfg(), st = Store.get('einstellungen', 'eb-stamm') || {};
  (Array.isArray(c.kulturen) ? c.kulturen : []).forEach(n => { const o = kuGuessOber(n, obers()); if (!obers().some(x => kuNorm(x) === kuNorm(n))) add(n, o, o === KU_ZF); });
  (st.kulturen || []).forEach(k => { const o = kuGuessOber(k.name, obers()); if (!obers().some(x => kuNorm(x) === kuNorm(k.name))) add(k.name, o, o === KU_ZF); });
  // Zwischenfrüchte: seit über zwei Jahren nicht mehr in der Fruchtfolge → nicht aktiv
  const last = {}; Store.all('einstellungen').forEach(r => { if (/^eb-\d{4}$/.test(r.id)) (r.schlaege || []).forEach(x => { if (x.art === 'zwischen' && x.kultur) last[kuNorm(x.kultur)] = Math.max(last[kuNorm(x.kultur)] || 0, r.jahr); }); });
  const cy = new Date().getFullYear();
  (st.zfListe || []).forEach(n => add(n, KU_ZF, true, (last[kuNorm(n)] || 0) >= cy - 2));
  return L;
}
const kuList = () => { const d = kuDoc(); return d && Array.isArray(d.list) ? d.list : kuSeed(); };
function kuSave(list, opt) { Store.put('einstellungen', { id: 'kulturen', list: structuredClone(list) }, opt || { silent: true }); }

/* ---------- Auflösen ---------- */
let _kuV = -1, _kuI = null;
function kuIdx() {
  if (_kuV === Store.v && _kuI) return _kuI;
  const L = kuList(), by = new Map(), forms = new Map(), obers = [];
  L.forEach(k => { by.set(kuNorm(k.name), k); });
  L.forEach(k => (k.syn || []).forEach(s => { if (!by.has(kuNorm(s))) by.set(kuNorm(s), k); }));
  L.forEach(k => { const o = kuNorm(k.ober); if (!forms.has(o)) { forms.set(o, []); obers.push(k.ober); } forms.get(o).push(k); });
  _kuI = { L, by, forms, obers }; _kuV = Store.v; return _kuI;
}
// → { k: genaue Kultur | null, ober, exact } oder null (unbekannt)
function kuInfo(name) {
  const n = kuNorm(name); if (!n) return null; const I = kuIdx();
  const k = I.by.get(n); if (k) return { k, ober: k.ober, exact: true };
  if (I.forms.has(n)) return { k: null, ober: I.forms.get(n)[0].ober, exact: false };
  return null;
}
const kuOber = name => { const i = kuInfo(name); return i ? i.ober : String(name || '').trim(); };
const kuForms = (ober, alle) => (kuIdx().forms.get(kuNorm(ober)) || []).filter(k => alle || k.aktiv !== false);
// Oberbegriff mit mehreren genauen Kulturen (z.B. «Weizen») – für Pflanzenschutz und Betrieb zu ungenau
function kuNeedsExact(name) { const i = kuInfo(name); return !!i && !i.exact && kuForms(i.ober).length > 1; }
const kuIsZw = name => { const i = kuInfo(name); return !!(i && (i.exact ? i.k.zw : kuNorm(i.ober) === kuNorm(KU_ZF))); };
// alle wählbaren Namen (Oberbegriffe und genaue Kulturen) – ersetzt die frühere Liste unter Mehr
function kuNames() {
  const I = kuIdx(), out = [];
  I.obers.forEach(o => { const F = kuForms(o); if (!F.length) return; if (!F.some(k => kuNorm(k.name) === kuNorm(o))) out.push(o); F.forEach(k => out.push(k.name)); });
  return out;
}
const kuExactNames = ({ zw } = {}) => kuIdx().L.filter(k => k.aktiv !== false && (zw == null || !!k.zw === zw)).map(k => k.name);

/* ---------- Auswahllisten ---------- */
// Aufträge: Oberbegriff oder (wahlweise) genaue Kultur; Pflanzenschutz (exact): nur genaue Kulturen
function kuOptions(cur, { exact = false, zw = true } = {}) {
  const I = kuIdx(), c = kuNorm(cur); let found = !c;
  const opt = (v, l = v) => { const s = kuNorm(v) === c; if (s) found = true; return `<option value="${esc(v)}" ${s ? 'selected' : ''}>${esc(l)}</option>`; };
  const grp = I.obers.filter(o => zw || kuNorm(o) !== kuNorm(KU_ZF)).map(o => {
    const F = kuForms(o).concat(kuForms(o, true).filter(k => k.aktiv === false && kuNorm(k.name) === c)); if (!F.length) return '';
    const single = F.length === 1 && kuNorm(F[0].name) === kuNorm(o);
    if (single) return opt(F[0].name);
    return `<optgroup label="${esc(o)}">${exact ? '' : opt(o, `${o} (allgemein)`)}${F.map(k => opt(k.name)).join('')}</optgroup>`;
  }).join('');
  const extra = !found ? (kuNeedsExact(cur) && exact ? `<option value="${esc(cur)}" selected>${esc(cur)} – genaue Kultur wählen</option>` : `<option value="${esc(cur)}" selected>${esc(cur)}</option>`) : '';
  return extra + grp;
}
// Aufträge: zuerst der Oberbegriff (Weizen, Gerste …); die genaue Kultur folgt in einem zweiten Feld (kuWireOrder)
function kuOberOptions(cur) {
  const I = kuIdx(), o = kuNorm(kuOber(cur)); let found = !o;
  const h = I.obers.filter(x => kuForms(x).length || kuNorm(x) === o).map(x => { const F = kuForms(x), single = F.length === 1 && kuNorm(F[0].name) === kuNorm(x), v = single ? F[0].name : x, sel = kuNorm(x) === o; if (sel) found = true;
    return `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(x)}</option>`; }).join('');
  return (found ? '' : `<option value="${esc(cur)}" selected>${esc(cur)}</option>`) + h;
}
const kuOrderOptions = cur => kuOberOptions(cur);
// zweites Feld «Genaue Kultur»: nur bei Oberbegriffen mit mehreren Kulturen; bei «Spritzen» nötig
function kuWireOrder(f) {
  if (!f.kultur || !f.arbeit) return;
  const cell = f.kultur.closest('.fld'), cur = (f.kultur.dataset.cur || f.kultur.value || '');
  const box = document.createElement('label'); box.className = 'fld kuform'; box.hidden = true;
  box.innerHTML = `<span>Genaue Kultur <small class="nr" id="kuFormReq"></small></span><select class="input" name="kform" data-plain></select><div class="hint" id="kuFormHint"></div>`;
  cell.after(box);
  const sel = box.querySelector('select'), req = box.querySelector('#kuFormReq'), hint = box.querySelector('#kuFormHint');
  const fill = keep => {
    const ob = kuOber(f.kultur.value), F = kuForms(ob), sp = isSprayName(f.arbeit.value), multi = F.length > 1 || (F.length === 1 && kuNorm(F[0].name) !== kuNorm(ob));
    box.hidden = !f.kultur.value || !multi;
    const v = keep != null ? keep : sel.value, inF = F.some(k => kuNorm(k.name) === kuNorm(v));
    sel.innerHTML = `<option value="">${sp ? '— bitte wählen —' : '— nicht nötig (nur ' + esc(ob) + ') —'}</option>${F.map(k => `<option ${inF && kuNorm(k.name) === kuNorm(v) ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}`;
    req.textContent = sp ? 'für Pflanzenschutz nötig' : 'bei Bedarf';
    hint.textContent = sp && !box.hidden && !sel.value ? `Für Pflanzenschutz die genaue Kultur wählen (${F.map(k => k.name).join(' oder ')}).` : '';
  };
  f.kultur.addEventListener('change', () => fill(''));
  f.arbeit.addEventListener('change', () => fill());
  sel.addEventListener('change', () => fill());
  // bestehender Auftrag mit genauer Kultur (z.B. Winterweizen): Oberbegriff oben, Kultur im zweiten Feld
  const i = kuInfo(cur); fill(i && i.exact ? i.k.name : '');
}
// Kultur im Auftragsfenster setzen (z.B. aus Parzelle oder Fruchtfolge): Oberbegriff oben, genaue Kultur im zweiten Feld
function kuSetOrderKultur(f, name) {
  if (!f || !f.kultur || !name) return; const i = kuInfo(name), ob = i ? i.ober : name, F = kuForms(ob), v = F.length === 1 && kuNorm(F[0].name) === kuNorm(ob) ? F[0].name : ob;
  if (![...f.kultur.options].some(o => o.value === v)) f.kultur.insertAdjacentHTML('beforeend', `<option>${esc(v)}</option>`);
  f.kultur.value = v; f.kultur.dispatchEvent(new Event('change', { bubbles: true }));
  if (f.kform && i && i.exact) { f.kform.value = i.k.name; f.kform.dispatchEvent(new Event('change', { bubbles: true })); }
}
// gespeicherte Kultur eines Auftrags: genaue Kultur, sonst der Oberbegriff
const kuOrderValue = fd => (fd.get('kform') || '').trim() || fd.get('kultur') || '';

/* ---------- Verwendung und Umbenennen in allen Modulen ---------- */
// Jede Stelle mit einer Kulturbezeichnung: [Bezeichnung, Bereich, Jahr, Objekt-Info]
function kuUses() {
  const U = [];
  Store.all('auftraege').forEach(a => { if (a.kultur) U.push({ n: a.kultur, w: isSpray(a) ? 'spray' : 'auftrag', y: +(String(a.erledigtAm || a.datum || a.wunsch || '').slice(0, 4)) || null, a }); });
  Store.all('parzellen').forEach(p => { if (p.kultur) U.push({ n: p.kultur, w: 'parzelle', y: null, p }); });
  Store.all('einstellungen').forEach(r => {
    if (/^eb-\d{4}$/.test(r.id)) { const sl = s => { if (s.kultur && !s.indiv && !s.txt) U.push({ n: s.kultur, w: s.art === 'zwischen' ? 'ebz' : 'eb', y: r.jahr, s }); };
      (r.schlaege || []).forEach(sl); Object.values(r.varianten || {}).forEach(v => v.forEach(sl)); }
    if (/^vb-\d{4}$/.test(r.id)) (r.progs || []).forEach(p => { if (p.kultur) U.push({ n: p.kultur, w: 'vb', y: r.jahr, prog: p }); });
  });
  return U;
}
// Bezeichnungen in allen Modulen ersetzen: map = Map(kuNorm(alt) → neu). Gibt die Anzahl geänderter Stellen zurück.
function kuRenameAll(map) {
  if (!map.size) return 0; const now = Date.now(); let n = 0; const sw = v => { const t = map.get(kuNorm(v)); return t && t !== v ? t : null; };
  Store.data.auftraege.forEach(a => { if (a.del) return; const t = sw(a.kultur); if (t) { a.kultur = t; a.upd = now; n++; } });
  Store.data.parzellen.forEach(p => { if (p.del) return; const t = sw(p.kultur); if (t) { p.kultur = t; p.upd = now; n++; } });
  Store.data.einstellungen.forEach(r => {
    if (r.del) return; let mod = false;
    if (/^eb-\d{4}$/.test(r.id)) { const sl = s => { if (s.indiv) return; const t = sw(s.kultur); if (t) { s.kultur = t; mod = true; n++; } };
      (r.schlaege || []).forEach(sl); Object.values(r.varianten || {}).forEach(v => v.forEach(sl)); }
    if (/^vb-\d{4}$/.test(r.id)) (r.progs || []).forEach(p => { const t = sw(p.kultur); if (t) { p.kultur = t; mod = true; n++; } });
    if (r.id === 'eb-stamm') (r.kulturen || []).forEach(k => { const t = sw(k.name); if (t) { k.name = t; mod = true; } });
    if (mod) r.upd = now;
  });
  Store.save(); Sync.schedule();
  return n;
}
// neue Bezeichnungen aufnehmen (z.B. aus der Datenprüfung)
function kuEnsure(names) {
  const L = structuredClone(kuList()); let mod = false;
  names.forEach(n => { n = String(n || '').trim(); if (!n || kuInfo(n)) return; const o = kuGuessOber(n, [...new Set(L.map(x => x.ober))]); L.push({ id: kuSlug(n) + '-' + uid().slice(-4), name: n, ober: o, zw: o === KU_ZF, syn: [], aktiv: true }); mod = true; });
  if (mod || !kuDoc()) kuSave(L, { silent: false });
}
// frühere Liste unter Mehr ersetzen
Lists.kulturen = () => kuNames();
const _kuEnsure0 = Lists.ensure.bind(Lists);
Lists.ensure = (kind, values) => kind === 'kulturen' ? kuEnsure(values) : _kuEnsure0(kind, values);

/* ---------- Mehr › Einstellungen: Kulturen ---------- */
function kuPanel() {
  const I = kuIdx(), n = kuOpenCount();
  return `<div class="panel"><h2>Kulturen</h2><p>Oberbegriff für Aufträge (z.B. Weizen), genaue Kultur für Pflanzenschutz und Eigener Betrieb (z.B. Winterweizen). In Aufträgen ist beides wählbar.</p>
    <div class="kuov">${I.obers.map(o => { const F = kuForms(o); if (!F.length) return ''; const single = F.length === 1 && kuNorm(F[0].name) === kuNorm(o);
      return `<div class="kuo"><b>${esc(o)}</b>${single ? '' : `<span>${F.map(k => esc(k.name)).join(' · ')}</span>`}</div>`; }).join('')}</div>
    ${n ? `<p class="warnline">${n} offene ${n === 1 ? 'Punkt' : 'Punkte'}: Bezeichnungen ohne Zuordnung oder Spritzaufträge bzw. Fruchtfolge ohne genaue Kultur – «Kulturen ordnen» hilft beim Bereinigen.</p>` : ''}
    <div class="btns"><button class="btn" data-ku="edit">Bearbeiten</button><button class="btn ${n ? 'primary' : ''}" data-ku="assist">Kulturen ordnen …</button></div></div>`;
}
function kuEditDialog() {
  const L = structuredClone(kuList()), U = kuUses(), cnt = new Map(); U.forEach(u => { const i = kuInfo(u.n); const k = i && i.exact ? i.k.id : null; if (k) cnt.set(k, (cnt.get(k) || 0) + 1); });
  const obers = [...new Set(L.map(k => k.ober))];
  const row = k => `<tr data-id="${esc(k.id)}"><td><input class="vbin wide" name="name" value="${esc(k.name)}"></td><td><input class="vbin wide" name="ober" value="${esc(k.ober)}" list="kuOberList"></td>
    <td><input class="vbin wide" name="syn" value="${esc((k.syn || []).join(', '))}" placeholder="z.B. WW, Weizen IP"></td>
    <td class="c"><input type="checkbox" name="zw" ${k.zw ? 'checked' : ''}></td><td class="c"><input type="checkbox" name="aktiv" ${k.aktiv !== false ? 'checked' : ''}></td>
    <td class="n nr">${cnt.get(k.id) || ''}</td><td>${cnt.get(k.id) ? '' : '<button type="button" class="x" data-ku="rowDel" aria-label="Entfernen">×</button>'}</td></tr>`;
  const byO = obers.map(o => `<tbody><tr class="gk"><td colspan="7">${esc(o)}</td></tr>${L.filter(k => k.ober === o).map(row).join('')}</tbody>`).join('');
  const body = `<datalist id="kuOberList">${obers.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
    <p class="nr" style="margin-top:0">Oberbegriff: Auswahl und Auswertung bei Aufträgen. Genaue Kultur: Pflanzenschutz und Eigener Betrieb. Synonyme werden automatisch der Kultur zugeordnet (z.B. aus MyJohnDeere). Umbenennen ändert alle Aufträge, Parzellen, Spritzprogramme und die Fruchtfolge. Nicht aktive Kulturen erscheinen nicht mehr in der Auswahl, bleiben aber gültig.</p>
    <div class="tscroll"><table class="btab kued"><thead><tr><th>Genaue Kultur</th><th>Oberbegriff</th><th>Synonyme</th><th title="Zwischenfrucht / Gründüngung">ZF</th><th>aktiv</th><th class="n" title="Verwendungen">×</th><th></th></tr></thead>${byO}<tbody id="kuNew"></tbody></table></div>
    <button type="button" class="btn small" data-ku="rowAdd">＋ Kultur</button>`;
  Dlg.open('Kulturen bearbeiten', body, saveFooter(), () => {
    const rows = $$('.kued tr[data-id]', Dlg.form), out = [], ren = new Map(), oldOber = new Map();
    for (const tr of rows) {
      const g = n => tr.querySelector(`[name=${n}]`), name = g('name').value.trim(), ober = g('ober').value.trim() || name; if (!name) continue;
      const id = tr.dataset.id, old = L.find(k => k.id === id);
      if (out.some(k => kuNorm(k.name) === kuNorm(name))) { toast(`«${name}» ist doppelt.`); return false; }
      out.push({ id: old ? id : kuSlug(name) + '-' + uid().slice(-4), name, ober, zw: g('zw').checked, aktiv: g('aktiv').checked, syn: [...new Set(g('syn').value.split(/[,;]/).map(s => s.trim()).filter(Boolean))] });
      if (old && old.name !== name) ren.set(kuNorm(old.name), name);
      if (old) { const s = oldOber.get(old.ober) || new Set(); s.add(ober); oldOber.set(old.ober, s); }
    }
    // Oberbegriff umbenannt (alle Kulturen dieses Oberbegriffs zeigen auf denselben neuen): auch Aufträge mit dem Oberbegriff anpassen
    oldOber.forEach((s, o) => { const t = [...s][0]; if (s.size === 1 && t !== o && !out.some(k => k.ober === o)) ren.set(kuNorm(o), t); });
    kuSave(out, { silent: true }); const n = kuRenameAll(ren); App.render();
    toast(n ? `Gespeichert, ${n} Stellen umbenannt` : 'Gespeichert'); return true;
  });
  Dlg.form._kuRow = row;
}

/* ---------- Assistent «Kulturen ordnen» ---------- */
// offene Punkte: unbekannte Bezeichnungen + Spritzaufträge und Fruchtfolge mit zu ungenauer Kultur
function kuOpen() {
  const U = kuUses(), unk = new Map(), spray = [], eb = new Map();
  U.forEach(u => {
    if (u.a && typeof psAlt === 'function' && psAlt(u.a)) return; // Pflanzenschutz älter als 3 Jahre: nicht mehr prüfen
    const i = kuInfo(u.n);
    if (!i) { const k = kuNorm(u.n), e = unk.get(k) || { n: u.n.trim(), c: {}, last: 0, zw: 0 }; e.c[u.w] = (e.c[u.w] || 0) + 1; e.last = Math.max(e.last, u.y || 0); if (u.w === 'ebz') e.zw++; unk.set(k, e); return; }
    if (!i.exact && kuForms(i.ober).length > 1) {
      if (u.w === 'spray') spray.push(u.a);
      if (u.w === 'eb') { const k = kuNorm(u.n), e = eb.get(k) || { n: u.n.trim(), ober: i.ober, c: 0 }; e.c++; eb.set(k, e); }
    }
  });
  return { unk: [...unk.values()].sort((a, b) => Object.values(b.c).reduce((x, y) => x + y, 0) - Object.values(a.c).reduce((x, y) => x + y, 0)), spray, eb: [...eb.values()] };
}
let _kuOcV = -1, _kuOc = 0;
const kuOpenCount = () => { if (_kuOcV !== Store.v) { const o = kuOpen(); _kuOc = o.unk.length + o.spray.length + o.eb.length; _kuOcV = Store.v; } return _kuOc; };
// Vorschlag für einen Spritzauftrag mit Oberbegriff: Fruchtfolge (eigener Betrieb) › Parzelle › Herbst = Winterkultur › üblichste
function kuSuggest(a) {
  const ober = kuOber(a.kultur), F = kuForms(ober), inF = n => { const i = kuInfo(n); return i && i.exact && F.includes(i.k) ? i.k.name : null; };
  if (typeof ebSchlagById === 'function') {
    if (a.ebSchlag) { const s = ebSchlagById(a.ebJahr, a.ebSchlag); const v = s && inF(s.kultur); if (v) return [v, 'Fruchtfolge']; }
    if (typeof ebKunde === 'function' && ebKunde() && a.kunde === ebKunde().id && a.kfeld) {
      const r = ebGet(ernteOf(a)); const s = r && r.schlaege.find(x => x.art !== 'zwischen' && (ebParz(x.parz) || {}).feld === a.kfeld && inF(x.kultur)); if (s) return [inF(s.kultur), 'Fruchtfolge'];
    }
  }
  const p = a.parzelle && Store.get('parzellen', a.parzelle), pv = p && inF(p.kultur); if (pv) return [pv, 'Parzelle'];
  const m = +(String(a.erledigtAm || a.datum || a.wunsch || '').slice(5, 7)), w = F.find(k => /^winter/i.test(k.name));
  if (w && m >= 8 && m <= 12) return [w.name, 'Herbst → Winterkultur'];
  return [F[0] ? F[0].name : '', 'üblich'];
}
function kuAssistant() {
  const O = kuOpen(), I = kuIdx(), obers = I.obers, cy = new Date().getFullYear();
  if (!O.unk.length && !O.spray.length && !O.eb.length) { toast('Alle Kulturen sind zugeordnet.'); return; }
  const W = { auftrag: 'Aufträge', spray: 'Spritzaufträge', parzelle: 'Spritz-Parzellen', eb: 'Fruchtfolge', ebz: 'Zwischenfrüchte', vb: 'Spritzprogramme' };
  const tgt = (sel = '') => `<option value="new" ${sel ? '' : 'selected'}>➕ Als neue Kultur aufnehmen</option>${obers.map(o => { const F = kuForms(o, true);
    return `<optgroup label="${esc(o)}"><option value="o:${esc(o)}" ${sel === 'o:' + o ? 'selected' : ''}>→ ${esc(o)} (Oberbegriff)</option>${F.filter(k => !(F.length === 1 && kuNorm(k.name) === kuNorm(o))).map(k => `<option value="k:${esc(k.id)}" ${sel === 'k:' + k.id ? 'selected' : ''}>→ ${esc(k.name)}</option>`).join('')}${F.length === 1 && kuNorm(F[0].name) === kuNorm(o) && sel === 'k:' + F[0].id ? `<option value="k:${esc(F[0].id)}" selected>→ ${esc(F[0].name)}</option>` : ''}</optgroup>`; }).join('')}`;
  // Vorschlag: Abkürzung (WW → Winterweizen) oder nur Gross-/Kleinschreibung bzw. Leerzeichen verschieden
  const pre = e => { const a = KU_ABK[kuNorm(e.n).replace(/[^a-z]/g, '')], i = a && kuInfo(a); if (i && i.exact) return 'k:' + i.k.id;
    const k = I.L.find(x => kuNorm(x.name).replace(/[^a-z0-9äöü]/g, '') === kuNorm(e.n).replace(/[^a-z0-9äöü]/g, '')); return k ? 'k:' + k.id : ''; };
  const uRow = (e, i) => { const zw = e.zw > 0 || KU_ZF_RE.test(e.n), g = zw ? KU_ZF : kuGuessOber(e.n, obers), alt = e.last && e.last < cy - 2;
    return `<tr data-i="${i}"><td><b>${esc(e.n)}</b><div class="nr">${Object.entries(e.c).map(([w, n]) => `${n}× ${W[w]}`).join(' · ')}${e.last ? ` · zuletzt ${e.last}` : ''}</div></td>
      <td><select class="input small" name="t" data-plain>${tgt(pre(e))}</select></td>
      <td><input class="input small" name="o" value="${esc(g)}" list="kuOberList2" placeholder="Oberbegriff" ${pre(e) ? 'disabled' : ''}></td>
      <td class="c"><input type="checkbox" name="a" ${alt ? '' : 'checked'} title="aktiv (in der Auswahl)" ${pre(e) ? 'disabled' : ''}></td></tr>`; };
  const sGrp = {}; O.spray.forEach(a => { const o = kuOber(a.kultur); (sGrp[o] = sGrp[o] || []).push(a); });
  const sRow = a => { const [v, why] = kuSuggest(a), F = kuForms(kuOber(a.kultur));
    return `<tr data-id="${esc(a.id)}"><td>${esc(a.nr || '')}</td><td>${esc(kundeName(a.kunde))}</td><td>${esc(a.feld || '')}</td><td>${esc(fmtDate(a.erledigtAm || a.datum || a.wunsch || '', { day: '2-digit', month: '2-digit', year: '2-digit' }))}</td><td class="nr">${esc(prodNames(a).slice(0, 2).join(', '))}</td>
      <td><select class="input small" name="s" data-plain>${F.map(k => `<option ${k.name === v ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}<option value="">– offen lassen –</option></select> <span class="nr">${esc(why)}</span></td></tr>`; };
  const body = `<datalist id="kuOberList2">${obers.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
    ${O.unk.length ? `<h4 class="kuh">1. Bezeichnungen ohne Zuordnung <small class="nr">${O.unk.length}</small></h4>
      <p class="nr">Neue Kultur aufnehmen (mit Oberbegriff) oder einer bestehenden zuordnen – dann wird die Bezeichnung überall ersetzt und als Synonym gemerkt. Seit über zwei Jahren nicht mehr verwendete Bezeichnungen kommen als «nicht aktiv» in die Liste.</p>
      <div class="tscroll"><table class="btab kuat" id="kuU"><thead><tr><th>Bezeichnung</th><th>Zuordnung</th><th>Oberbegriff (neu)</th><th>aktiv</th></tr></thead><tbody>${O.unk.map(uRow).join('')}</tbody></table></div>` : ''}
    ${O.eb.length ? `<h4 class="kuh">${O.unk.length ? 2 : 1}. Fruchtfolge: genaue Kultur fehlt <small class="nr">${O.eb.length}</small></h4>
      <div class="tscroll"><table class="btab kuat" id="kuE"><thead><tr><th>Bezeichnung</th><th>ersetzen durch</th></tr></thead><tbody>${O.eb.map((e, i) => `<tr data-i="${i}"><td><b>${esc(e.n)}</b> <span class="nr">${e.c}× in der Fruchtfolge</span></td>
        <td><select class="input small" name="e" data-plain>${kuForms(e.ober).map(k => `<option>${esc(k.name)}</option>`).join('')}<option value="">– offen lassen –</option></select></td></tr>`).join('')}</tbody></table></div>` : ''}
    ${O.spray.length ? `<h4 class="kuh">${1 + !!O.unk.length + !!O.eb.length}. Spritzaufträge: genaue Kultur fehlt <small class="nr">${O.spray.length}</small></h4>
      <p class="nr">Vorschlag aus Fruchtfolge (eigener Betrieb), Spritz-Parzelle oder Datum (August–Dezember = Winterkultur), sonst die übliche Kultur. Pro Oberbegriff lassen sich alle auf einmal setzen.</p>
      ${Object.entries(sGrp).map(([o, L]) => `<div class="kusg"><div class="kusgh"><b>${esc(o)}</b> <span class="nr">${L.length} Aufträge</span> · alle auf <select class="input small" data-kuall data-plain><option value="">– Vorschlag –</option>${kuForms(o).map(k => `<option>${esc(k.name)}</option>`).join('')}</select></div>
        <div class="tscroll"><table class="btab kuat kuS"><thead><tr><th>Nr.</th><th>Kunde</th><th>Feld</th><th>Datum</th><th>Produkte</th><th>Kultur</th></tr></thead><tbody>${L.map(sRow).join('')}</tbody></table></div></div>`).join('')}` : ''}`;
  Dlg.open('Kulturen ordnen', body, `<span class="spacer"></span><button type="button" class="btn" data-act="close">Abbrechen</button><button type="submit" class="btn primary">Übernehmen</button>`, () => {
    const L = structuredClone(kuList()), ren = new Map(); let nNeu = 0, nZu = 0, nS = 0;
    $$('#kuU tr[data-i]', Dlg.form).forEach(tr => {
      const e = O.unk[+tr.dataset.i], t = tr.querySelector('[name=t]').value;
      if (t === 'new') { const o = tr.querySelector('[name=o]').value.trim() || e.n; L.push({ id: kuSlug(e.n) + '-' + uid().slice(-4), name: e.n, ober: o, zw: kuNorm(o) === kuNorm(KU_ZF) || e.zw > 0, syn: [], aktiv: tr.querySelector('[name=a]').checked }); nNeu++; }
      else if (t.startsWith('o:')) { ren.set(kuNorm(e.n), t.slice(2)); nZu++; }
      else if (t.startsWith('k:')) { const k = L.find(x => x.id === t.slice(2)); if (k) { ren.set(kuNorm(e.n), k.name); k.syn = [...new Set([...(k.syn || []), e.n])]; nZu++; } }
    });
    $$('#kuE tr[data-i]', Dlg.form).forEach(tr => { const e = O.eb[+tr.dataset.i], v = tr.querySelector('[name=e]').value; if (v) ren.set(kuNorm(e.n), v); });
    kuSave(L, { silent: true });
    // Fruchtfolge: nur Hauptkulturen ersetzen (Aufträge mit Oberbegriff bleiben gültig)
    const ebRen = new Map([...ren].filter(([k]) => O.eb.some(e => kuNorm(e.n) === k))), allRen = new Map([...ren].filter(([k]) => !ebRen.has(k)));
    let n = kuRenameAll(allRen);
    if (ebRen.size) { const now = Date.now(); Store.data.einstellungen.forEach(r => { if (r.del || !/^eb-\d{4}$/.test(r.id)) return; let mod = false; const sl = s => { if (s.art === 'zwischen' || s.indiv) return; const t = ebRen.get(kuNorm(s.kultur)); if (t) { s.kultur = t; mod = true; n++; } };
      (r.schlaege || []).forEach(sl); Object.values(r.varianten || {}).forEach(v => v.forEach(sl)); if (mod) r.upd = now; }); Store.save(); Sync.schedule(); }
    const ch = []; $$('.kuS tr[data-id]', Dlg.form).forEach(tr => { const v = tr.querySelector('[name=s]').value; if (!v) return; const a = Store.get('auftraege', tr.dataset.id); if (a && a.kultur !== v) { ch.push({ ...a, kultur: v }); } });
    if (ch.length) { Store.putMany('auftraege', ch); nS = ch.length; }
    App.render(); toast(`Kulturen geordnet: ${nNeu} neu, ${nZu} zugeordnet, ${n} Stellen ersetzt${nS ? `, ${nS} Spritzaufträge präzisiert` : ''}`, 6000);
    return true;
  });
  Dlg.form.addEventListener('change', e => {
    const s = e.target.closest('[data-kuall]'); if (s) { const box = s.closest('.kusg'); $$('select[name=s]', box).forEach(x => { if (s.value) x.value = s.value; }); }
    const t = e.target.closest('select[name=t]'); if (t) { const tr = t.closest('tr'); tr.querySelector('[name=o]').disabled = t.value !== 'new'; tr.querySelector('[name=a]').disabled = t.value !== 'new'; }
  });
}

/* ---------- Ereignisse ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-ku]'); if (!t) return; e.preventDefault();
  const a = t.dataset.ku;
  if (a === 'edit') kuEditDialog();
  if (a === 'assist') kuAssistant();
  if (a === 'rowDel') t.closest('tr').remove();
  if (a === 'rowAdd') { const tb = $('#kuNew', Dlg.form); if (tb && Dlg.form._kuRow) { tb.insertAdjacentHTML('beforeend', Dlg.form._kuRow({ id: 'neu-' + uid(), name: '', ober: '', zw: false, aktiv: true, syn: [] })); tb.lastElementChild.querySelector('input').focus(); } }
});

// erstes Zeichnen geschah vor dem Laden dieser Datei
App.lastView = null; App.render();
