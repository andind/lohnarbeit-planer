/* IM-Faktura – Eingang: Abrechnungen, die IM-Verwaltung und IM-Vermietung über Dropbox senden (/faktura-eingang/<id>.json),
   werden als Positionen in den Rechnungsentwurf des Kunden übernommen (Reiter «Entwürfe»).
   Übergabe-Datei: { v:1, id, app, am, kunde:{nr,name,anrede,adresse|strasse,plz,ort,mail,tel}, betreff,
                     pos:[{kind:'arbeit'|'psm'|'miete'|'text', art, bez, grp, menge, einh, preis, mwst?, konto?}],
                     beilage:{titel, cols:[[titel,'q'|'chf'|'',klasse]], rows:[[…]], total} | null, refs:[{app,id,nr}] } */
'use strict';

const EIN_PATH = '/faktura-eingang';
const DEF_EIN = { artPsm: '52', artMiete: '100', mwstArbeit: 2.6 };
const einCfg = () => Object.assign({}, DEF_EIN, Store.cfg().ein || {});

Object.assign(Drive, {
  async listFolder(path) {
    const r = await this.req('https://api.dropboxapi.com/2/files/list_folder', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    if (r.status === 409) return [];
    if (!r.ok) throw new Error('Dropbox: Ordner ' + path + ' nicht lesbar (' + r.status + ')');
    let j = await r.json(), out = j.entries || [];
    while (j.has_more) {
      const r2 = await this.req('https://api.dropboxapi.com/2/files/list_folder/continue', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor: j.cursor }) });
      if (!r2.ok) break; j = await r2.json(); out = out.concat(j.entries || []);
    }
    return out;
  },
  async deletePath(path) {
    await this.req('https://api.dropboxapi.com/2/files/delete_v2', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  }
});

/* ---------- Beilagen (mehrere pro Rechnung, gleicher Titel wird zusammengeführt) ---------- */
// Beilage als Tabelle (cols/rows) oder – seit v1.14 – als Original-Ausdruck des Absender-Programms (html + css, 1:1 wie dort gedruckt)
const beilOk = b => b && ((b.rows || []).length || b.html);
const beilagenOf = r => [...(r.beilage ? [r.beilage] : []), ...(r.beilagen || [])].filter(beilOk);
function addBeilage(r, b) {
  if (!beilOk(b)) return;
  if (r.beilage) { r.beilagen = [r.beilage, ...(r.beilagen || [])]; delete r.beilage; }
  r.beilagen = r.beilagen || [];
  if (b.html) { const x = r.beilagen.find(y => y.html && y.titel === b.titel && y.css === b.css);
    if (x) { x.html += b.html; x.total = b.total != null ? r2((x.total || 0) + b.total) : x.total; } else r.beilagen.push(clone(b)); return; }
  const x = r.beilagen.find(y => !y.html && y.titel === b.titel && JSON.stringify(y.cols) === JSON.stringify(b.cols));
  if (x) { x.rows = x.rows.concat(b.rows); x.total = r2((x.total || 0) + (b.total || 0)); }
  else r.beilagen.push(clone(b));
}

/* ---------- Eingang verarbeiten ---------- */
const Eingang = {
  busy: false, last: 0, n: 0,
  async check({ quiet = true } = {}) {
    if (this.busy || !Auth.hasSession() || !navigator.onLine) return 0;
    this.busy = true; let n = 0;
    try {
      const files = (await Drive.listFolder(EIN_PATH)).filter(f => f['.tag'] === 'file' && /\.json$/i.test(f.name));
      const done = new Set(Store.cfg().einDone || []);
      for (const f of files) {
        let T = null;
        try { T = await Drive.loadPath(f.path_lower || f.path_display); } catch (e) { continue; }
        if (T && T.id && !done.has(T.id)) { this.apply(T); done.add(T.id); n++; }
        try { await Drive.deletePath(f.path_lower || f.path_display); } catch { }
      }
      if (n) { Store.setCfg({ einDone: [...done].slice(-500) }); App.render(); toast(`📥 ${n} ${n === 1 ? 'Abrechnung' : 'Abrechnungen'} aus IM-Verwaltung/IM-Vermietung übernommen – siehe Entwürfe`, 5000); }
      else if (!quiet) toast('Keine neuen Abrechnungen im Eingang');
    } catch (e) { if (!quiet) toast(e.message, 5000); }
    finally { this.busy = false; this.last = Date.now(); }
    return n;
  },
  // Kunde zur Übergabe: zuerst über die Verknüpfung (IM-Faktura-ID aus der IM-Vermietung, IM-Verwaltung-ID, IM-Vermietung-ID),
  // sonst über Kunden-Nr./Name. Bei eindeutigem Treffer (Nr. oder gleicher Name) wird die Verknüpfung gleich gespeichert.
  kundeFor(T) {
    const K = T.kunde || {}, all = Store.all('kunden');
    let k0 = (K.fkId && kunde(K.fkId)) || (K.imvId && all.find(x => (x.imvIds || []).includes(K.imvId))) || (K.vmId && all.find(x => x.vmId === K.vmId)) || null, how = k0 ? 'link' : '';
    if (!k0) { const m = matchKunde(nrKey(K.nr), K.name); if (m) { k0 = m.k; how = m.how; } }
    const st = K.strasse != null ? splitStreet(K.strasse) : splitStreet(K.adresse), po = splitPlzOrt(K.plz, K.ort);
    if (k0) {
      const k = clone(k0); let ch = false; // fehlende Adressangaben ergänzen, nie überschreiben
      [['strasse', st.strasse], ['hausnr', st.hausnr], ['plz', po.plz], ['ort', po.ort], ['mail', K.mail], ['tel', K.tel], ['nr', nrKey(K.nr)]].forEach(([f, v]) => { if (v && !k[f]) { k[f] = v; ch = true; } });
      if (how !== 'ähnlich') ch = kLink(k, K) || ch;
      if (ch) Store.put('kunden', k, { silent: true });
      return k;
    }
    const k = { id: uid(), nr: /^\d+$/.test(nrKey(K.nr)) ? nrKey(K.nr) : '', name: K.name || 'Unbekannt', anrede: K.anrede || '', zusatz: K.zusatz || '', ...st, ...po, land: 'CH', mail: K.mail || '', tel: K.tel || '', aktiv: true };
    kLink(k, K); Store.put('kunden', k, { silent: true });
    return k;
  },
  posFor(p) {
    const E = einCfg(), c = Store.cfg();
    if (!p.datum && p.bez) { const x = altPos(p.bez); if (x) p = Object.assign({}, p, x); }
    if (p.kind === 'text') return newPos({ typ: 'text', bez: p.bez || '' });
    const a = p.kind === 'psm' ? artByNr(p.art || E.artPsm) : p.kind === 'miete' ? artByNr(p.art || E.artMiete) : artByNr(p.art);
    return newPos({ art: p.kind === 'psm' ? (p.art || E.artPsm || '') : (p.art || (p.kind === 'miete' ? E.artMiete : '')), bez: a?.bez || p.bez || '', bem: p.bem || '', datum: p.datum || '', ...(p.von ? { von: p.von } : {}), ...(p.bis ? { bis: p.bis } : {}), menge: p.menge ?? 1, einh: p.einh || a?.einheit || '', preis: p.preis ?? a?.preis ?? null,
      mwst: p.mwst ?? a?.mwst ?? (p.kind === 'arbeit' ? +E.mwstArbeit : c.mwstDef), konto: p.konto || a?.konto || '', grp: p.grp || '', kind: p.kind || '' });
  },
  apply(T) {
    const k = this.kundeFor(T);
    let r = Store.all('rechnungen').filter(x => x.kunde === k.id && statusOf(x) === 'entwurf').sort((a, b) => (b.nrRes ? 1 : 0) - (a.nrRes ? 1 : 0) || (b.upd || 0) - (a.upd || 0))[0]; // v1.16: immer in den Entwurf des Kunden
    r = r ? clone(r) : newRechnung({ kunde: k.id, frist: k.frist ?? Store.cfg().frist, betreff: T.app || T.betreff || '', quelle: T.app || 'Eingang' });
    if (T.app && !String(r.betreff || '').includes(T.app)) r.betreff = [r.betreff, T.app].filter(Boolean).join(', '); // Betreff = Herkunft (intern, nicht gedruckt)
    r.pos = r.pos.filter(p => (p.typ || 'pos') !== 'pos' || p.art || p.bez || p.preis != null); // leere Startzeile weg
    (T.pos || []).forEach(p => r.pos.push(this.posFor(p)));
    if (T.beilage) addBeilage(r, T.beilage);
    r.quellen = (r.quellen || []).concat([{ app: T.app || '', am: T.am || new Date().toISOString(), refs: T.refs || [], text: T.text || '' }]);
    Store.put('rechnungen', r, { silent: true });
  }
};

// Gleiche Positionen zusammenfassen (gleiche Gruppe bzw. Bezeichnung, Art.-Nr., Preis, Einheit, MWST, Konto)
function zusammenfassen(r) {
  const out = [], idx = new Map(); let n = 0;
  r.pos.forEach(p => {
    if ((p.typ || 'pos') !== 'pos') { out.push(p); return; }
    const key = [p.grp || p.bez, p.art, p.preis, p.einh, p.mwst, p.konto, p.rabatt || 0].join('|');
    if (idx.has(key)) { const x = idx.get(key); x.menge = r2((+x.menge || 0) + (+p.menge || 0)); x._n++; n++; if (x.datum !== p.datum) x.datum = ''; if ((x.bem || '') !== (p.bem || '')) x.bem = ''; return; }
    const x = Object.assign({}, p, { _n: 1 }); idx.set(key, x); out.push(x);
  });
  out.forEach(p => { if (p._n > 1 && p.grp) p.bez = p.grp + (p.kind === 'arbeit' && p.einh ? ` (total)` : ''); delete p._n; });
  r.pos = out;
  return n;
}

// Verknüpfung eines Kunden mit IM-Verwaltung (imvIds, mehrere möglich – MyJohnDeere kennt Kunden teils doppelt) und IM-Vermietung (vmId)
function kLink(k, K) {
  let ch = false;
  if (K.imvId && !(k.imvIds || []).includes(K.imvId)) { Store.all('kunden').filter(x => x.id !== k.id && (x.imvIds || []).includes(K.imvId)).forEach(x => Store.put('kunden', Object.assign(clone(x), { imvIds: x.imvIds.filter(i => i !== K.imvId) }), { silent: true }));
    k.imvIds = [...(k.imvIds || []), K.imvId]; ch = true; }
  if (K.vmId && !k.vmId) { k.vmId = K.vmId; ch = true; }
  return ch;
}
/* ---------- Ansicht «Entwürfe» ---------- */
// Altes Übergabeformat (IM-Verwaltung bis v150): «13.07.26 Ernte – Gorenmatt\nWintergerste» → Datum + Bemerkung
function altPos(bez) {
  const m = String(bez).match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\s+([\s\S]*)$/); if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3], datum = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const [l1, ...rest] = m[4].split('\n'), i = l1.indexOf(' – ');
  return { datum, bez: (i > 0 ? l1.slice(0, i) : l1).trim(), bem: rest.map(s => s.trim()).filter(Boolean).join(' · ') }; // Feldname (nach « – ») wird weggelassen
}
// v1.16: Entwürfe desselben Kunden immer zu einem zusammenführen (zurückgenommene Rechnung mit reservierter Nummer bleibt das Ziel;
// zwei verschiedene reservierte Nummern werden nicht zusammengelegt). Dabei alte Positionen mit Datum im Text aufteilen.
function entwuerfeZusammen() {
  const D = Store.all('rechnungen').filter(r => statusOf(r) === 'entwurf' && r.kunde), out = [], del = [];
  const G = new Map(); D.forEach(r => { if (!G.has(r.kunde)) G.set(r.kunde, []); G.get(r.kunde).push(r); });
  [...G.values()].forEach(l => {
    const res = l.filter(r => r.nrRes), basis = res[0] || l.slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || '') || (a.upd || 0) - (b.upd || 0))[0];
    const rest = l.filter(r => r !== basis && !r.nrRes); if (!rest.length) return;
    const t = clone(basis);
    rest.forEach(r => { t.pos.push(...clone(r.pos)); beilagenOf(r).forEach(b => addBeilage(t, b)); t.quellen = (t.quellen || []).concat(r.quellen || []);
      if (r.betreff) t.betreff = [...new Set([...(t.betreff || '').split(', '), ...r.betreff.split(', ')].filter(Boolean))].join(', '); del.push(r.id); });
    out.push(t);
  });
  let fix = 0; // alte Positionen aufteilen
  Store.all('rechnungen').filter(r => statusOf(r) === 'entwurf' && !del.includes(r.id)).forEach(r0 => {
    const r = out.find(x => x.id === r0.id) || clone(r0); let ch = false;
    r.pos.forEach(p => { if ((p.typ || 'pos') === 'pos' && !p.datum && !p.bem) { const x = altPos(p.bez || ''); if (x) { Object.assign(p, x); const a = p.art && artByNr(p.art); if (a) p.bez = a.bez; ch = true; fix++; } } });
    if (ch && !out.includes(r)) out.push(r);
  });
  if (out.length) Store.putMany('rechnungen', out, { silent: true });
  if (del.length) Store.remove('rechnungen', del);
  return { n: del.length, fix };
}
function viewEntwuerfe() {
  { const z = entwuerfeZusammen(); if (z.n || z.fix) setTimeout(() => toast([z.n ? `${z.n} ${z.n === 1 ? 'Entwurf' : 'Entwürfe'} mit dem Entwurf desselben Kunden zusammengeführt` : '', z.fix ? `${z.fix} Positionen: Datum aus dem Text übernommen` : ''].filter(Boolean).join(' · '), 5000), 50); }
  const L = Store.all('rechnungen').filter(r => statusOf(r) === 'entwurf').sort((a, b) => kName(a.kunde).localeCompare(kName(b.kunde), 'de'));
  const tot = L.reduce((s, r) => s + calc(r).total, 0);
  const warn = r => { const w = [], k = kunde(r.kunde);
    if (!k) w.push('kein Kunde'); else if (!kAdrOk(k)) w.push('Adresse fehlt');
    const op = (r.pos || []).filter(p => (p.typ || 'pos') === 'pos' && (p.preis == null || p.preis === '')).length; if (op) w.push(`${op} ohne Preis`);
    return w; };
  const src = r => [...new Set((r.quellen || []).map(q => q.app).filter(Boolean))].map(a => `<span class="chip info small">${esc(a)}</span>`).join(' ') || (r.quelle ? `<span class="chip small">${esc(String(r.quelle).slice(0, 30))}</span>` : '');
  const tb = `<h1>Entwürfe</h1><button class="btn" data-act="einCheck">📥 Eingang prüfen</button><button class="btn primary" data-act="newR">＋ Rechnung</button>`;
  const html = `<div class="filters"><span class="lbl">${L.length} Entwürfe · CHF ${chf(tot)}${Eingang.last ? ` · Eingang geprüft ${new Date(Eingang.last).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}` : ''}</span></div>
    ${Auth.hasSession() ? '' : '<div class="box warn small">Für den Eingang aus IM-Verwaltung und IM-Vermietung unter Mehr mit Dropbox anmelden.</div>'}
    <div class="mlist">${L.map(r => `<div class="mcard ${App.sel.has(r.id) ? 'sel' : ''}" data-act="editR" data-id="${r.id}"><div class="cb"><input type="checkbox" data-act="selOne" data-id="${r.id}" ${App.sel.has(r.id) ? 'checked' : ''}></div>
      <div class="grow"><div class="t">${esc(kName(r.kunde))}</div><div class="s">${(r.pos || []).length} Positionen ${src(r)}</div>${warn(r).length ? `<div class="s warnc">${warn(r).join(' · ')}</div>` : ''}</div><div class="q">${chf(calc(r).total)}</div></div>`).join('') || '<div class="empty">Keine Entwürfe</div>'}</div>
    <div class="dscroll"><table class="dtab"><thead><tr><th class="cb"><input type="checkbox" data-act="selAllE" ${L.length && L.every(r => App.sel.has(r.id)) ? 'checked' : ''}></th><th>Kunde</th><th>Herkunft</th><th>Positionen</th><th>Beilagen</th><th>Hinweise</th><th class="n">Total CHF</th><th></th></tr></thead><tbody>
    ${L.map(r => { const P = (r.pos || []).filter(p => (p.typ || 'pos') === 'pos'), w = warn(r), B = beilagenOf(r);
      return `<tr class="click ${App.sel.has(r.id) ? 'sel' : ''}" data-act="editR" data-id="${r.id}"><td class="cb"><input type="checkbox" data-act="selOne" data-id="${r.id}" ${App.sel.has(r.id) ? 'checked' : ''}></td>
      <td>${esc(kName(r.kunde))}${kunde(r.kunde)?.nr ? ` <span class="nr">${esc(kunde(r.kunde).nr)}</span>` : ''}${r.betreff ? `<div class="small muted">${esc(r.betreff)}</div>` : ''}${r.nrRes ? `<div class="small"><span class="chip info">↩ Nr. ${esc(r.nrRes)} zurückgenommen</span></div>` : ''}</td><td>${src(r)}</td>
      <td class="small">${P.length} · ${esc(P.slice(0, 3).map(p => p.grp || p.bez).join(', '))}${P.length > 3 ? ' …' : ''}</td><td class="small">${B.map(b => '📎 ' + esc(b.titel)).join('<br>')}</td>
      <td>${w.map(x => `<span class="chip warn small">${esc(x)}</span>`).join(' ')}</td><td class="n">${chf(calc(r).total)}</td>
      <td class="nowrap"><button class="btn small" data-act="printE" data-id="${r.id}" title="Entwurf drucken (Wasserzeichen, ohne QR-Zahlteil)">🖨</button> <button class="btn small" data-act="sumR" data-id="${r.id}" title="gleiche Positionen zusammenfassen">Σ</button> <button class="btn small danger" data-act="delE" data-id="${r.id}" title="Stornieren und ins Archiv legen (zurückholbar)">🗄</button></td></tr>`; }).join('')}
    </tbody></table>${L.length ? '' : '<div class="empty">Keine Entwürfe – Abrechnungen aus IM-Verwaltung (Auftrag › «An IM-Faktura») und IM-Vermietung (Abrechnung › «An IM-Faktura») erscheinen hier.</div>'}</div>
    ${(() => { const A = Store.all('rechnungen').filter(r => statusOf(r) === 'archiv').sort((a, b) => String(b.archiv.am).localeCompare(String(a.archiv.am)));
      if (!A.length) return '';
      return `<div class="panel" style="margin-top:10px"><h2 style="cursor:pointer" data-act="archToggle">${App.archOpen ? '▾' : '▸'} 🗄 Archiv – stornierte Entwürfe (${A.length})</h2>${App.archOpen ? `<p class="small muted">Archivierte Entwürfe bleiben gespeichert und lassen sich jederzeit zurückholen. Reservierte Nummern bleiben gesperrt.</p>
        <table class="dtab"><thead><tr><th>Archiviert</th><th>Kunde</th><th>Positionen</th><th class="n">Total CHF</th><th></th></tr></thead><tbody>${A.map(r => { const P = (r.pos || []).filter(p => (p.typ || 'pos') === 'pos');
          return `<tr><td class="nowrap">${fmtDate(String(r.archiv.am).slice(0, 10))}</td><td>${esc(kName(r.kunde))}${r.nrRes ? ` <span class="chip info small">Nr. ${esc(r.nrRes)} reserviert</span>` : ''}</td><td class="small">${P.length} · ${esc(P.slice(0, 3).map(p => p.grp || p.bez).join(', '))}${P.length > 3 ? ' …' : ''}</td><td class="n">${chf(calc(r).total)}</td>
          <td class="nowrap"><button class="btn small" data-act="printE" data-id="${r.id}" title="Entwurf drucken">🖨</button> <button class="btn small" data-act="unarchE" data-id="${r.id}">↩ Zurückholen</button></td></tr>`; }).join('')}</tbody></table>` : ''}</div>`; })()}
    <details class="help" style="margin-top:8px"><summary>ℹ So funktioniert der Eingang</summary>In der IM-Verwaltung unter Spritzen › Abrechnung bzw. Verwaltung › Abrechnung «📤 An IM-Faktura» drücken; in der IM-Vermietung unter Abrechnung Zeilen auswählen und «📤 An IM-Faktura». Die Abrechnung landet in Dropbox und wird hier beim Start, beim Synchronisieren und mit «Eingang prüfen» übernommen – als Positionen im Entwurf des Kunden (gibt es keinen, wird einer angelegt). Der Kunde wird über die Verknüpfung erkannt (Stammdaten › «🔗 IM-Verwaltung verknüpfen»), sonst über Nr./Name; unbekannte Kunden werden mit der Adresse aus dem Absender-Programm angelegt und gleich verknüpft.
      Pflanzenschutzmittel erhalten MWST und Konto von Artikel ${esc(einCfg().artPsm)}, Arbeiten ohne passenden Artikel ${mwstTxt(einCfg().mwstArbeit)} MWST. «Σ» fasst gleiche Positionen zusammen; die Einzelheiten stehen in der Beilage.</details>`;
  return { tb, html };
}
