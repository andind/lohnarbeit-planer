/* IM-Faktura – QR-Code (eigener Encoder, ohne Bibliothek) und Schweizer QR-Rechnung (Implementation Guidelines SIX v2.3, SPC 0200).
   QR-Encoder nach dem bekannten Verfahren von Project Nayuki (Byte-Modus, Fehlerkorrektur M, beste Maske). */
'use strict';

const QRCode = (() => {
  // Fehlerkorrektur-Stufe M (verlangt für die QR-Rechnung)
  const ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLK = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const FORMAT_ECL = 0; // M
  function rawMods(v) { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; }
  const dataCw = v => Math.floor(rawMods(v) / 8) - ECC[v] * BLK[v];
  function gmul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
  function rsDivisor(deg) { const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1; for (let i = 0; i < deg; i++) { for (let j = 0; j < r.length; j++) { r[j] = gmul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gmul(root, 0x02); } return r; }
  function rsRemainder(data, div) { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); } return r; }

  function encode(text, maxVer = 40) {
    const bytes = [...new TextEncoder().encode(text)];
    let ver = 1;
    for (; ver <= maxVer; ver++) if (4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 <= dataCw(ver) * 8) break;
    if (ver > maxVer) throw new Error('Text zu lang für den QR-Code');
    const bits = []; const ap = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    ap(4, 4); ap(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach(b => ap(b, 8));
    const cap = dataCw(ver) * 8;
    ap(0, Math.min(4, cap - bits.length)); ap(0, (8 - bits.length % 8) % 8);
    for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) ap(p, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    // Blöcke mit Fehlerkorrektur, verschränkt
    const nb = BLK[ver], ecl = ECC[ver], raw = Math.floor(rawMods(ver) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const div = rsDivisor(ecl), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - ecl + (i < nShort ? 0 : 1)); k += dat.length;
      const e = rsRemainder(dat, div); if (i < nShort) dat.push(0); blocks.push(dat.concat(e));
    }
    const cw = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecl || j >= nShort) cw.push(b[i]); });

    const size = ver * 4 + 17;
    const M = Array.from({ length: size }, () => new Array(size).fill(false));
    const F = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    // Funktionsmuster
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (x, y) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy; if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const align = []; if (ver > 1) { const n = Math.floor(ver / 7) + 2, step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2; for (let i = 0, p = size - 7; i < n - 1; i++, p -= step) align.unshift(p); align.unshift(6); }
    align.forEach((a, i) => align.forEach((b, j) => { if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
    const drawFormat = mask => {
      const data = FORMAT_ECL << 3 | mask; let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = (data << 10 | rem) ^ 0x5412, bit = i => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const b = ver << 12 | rem;
      for (let i = 0; i < 18; i++) { const bt = ((b >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bt); set(c, a, bt); }
    }
    // Daten im Zickzack
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!F[y][x] && i < cw.length * 8) { M[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
    const maskFn = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && maskFn[m](x, y)) M[y][x] = !M[y][x]; };
    const penalty = () => {
      let p = 0;
      const runs = line => { let s = 0, run = 1; for (let k = 1; k <= line.length; k++) { if (k < line.length && line[k] === line[k - 1]) run++; else { if (run >= 5) s += 3 + run - 5; run = 1; } } return s; };
      const finderLike = line => { let s = 0; const str = line.map(b => b ? 1 : 0).join(''); const pats = ['10111010000', '00001011101']; pats.forEach(pt => { let idx = str.indexOf(pt); while (idx >= 0) { s += 40; idx = str.indexOf(pt, idx + 1); } }); return s; };
      for (let y = 0; y < size; y++) { p += runs(M[y]); p += finderLike([false, false, false, false, ...M[y], false, false, false, false]); }
      for (let x = 0; x < size; x++) { const col = M.map(r => r[x]); p += runs(col); p += finderLike([false, false, false, false, ...col, false, false, false, false]); }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
      let dark = 0; M.forEach(r => r.forEach(b => { if (b) dark++; }));
      const total = size * size, k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1; p += k * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } applyMask(m); }
    applyMask(best); drawFormat(best);
    return { size, version: ver, modules: M };
  }

  // SVG; mit cross=true das Schweizerkreuz (7 × 7 mm bei 46 mm) in der Mitte
  function svg(text, { mm = 46, cross = false, maxVer = 40 } = {}) {
    const q = encode(text, maxVer), n = q.size; let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules[y][x]) d += `M${x} ${y}h1v1h-1z`;
    let c = '';
    if (cross) {
      const s = n * 7 / 46, o = (n - s) / 2, k = s / 7; // 7 mm-Einheit = k
      // weisser Rand 0.5 mm, schwarzes Quadrat 6 mm, weisses Kreuz (Balken 1.17 × 3.89 mm)
      const bw = 1.17 * k, bl = 3.89 * k, cx = n / 2;
      c = `<rect x="${o}" y="${o}" width="${s}" height="${s}" fill="#fff"/><rect x="${o + 0.5 * k}" y="${o + 0.5 * k}" width="${6 * k}" height="${6 * k}" fill="#000"/>` +
        `<rect x="${cx - bw / 2}" y="${cx - bl / 2}" width="${bw}" height="${bl}" fill="#fff"/><rect x="${cx - bl / 2}" y="${cx - bw / 2}" width="${bl}" height="${bw}" fill="#fff"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${mm}mm" height="${mm}mm" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/>${c}</svg>`;
  }
  return { encode, svg };
})();

/* ================= Schweizer QR-Rechnung ================= */
const SwissQR = (() => {
  const clean = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => clean(s).slice(0, n);
  const iban = s => String(s || '').replace(/\s+/g, '').toUpperCase();
  function ibanOk(s) {
    const v = iban(s); if (!/^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(v)) return false;
    const r = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, c => c.charCodeAt(0) - 55);
    let m = 0; for (const ch of r) m = (m * 10 + +ch) % 97; return m === 1;
  }
  const isQrIban = s => { const v = iban(s), iid = +v.slice(4, 9); return iid >= 30000 && iid <= 31999; };
  const fmtIban = s => iban(s).replace(/(.{4})/g, '$1 ').trim();
  // Modulo 10 rekursiv (Prüfziffer der QR-Referenz)
  function mod10(digits) { const T = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5]; let c = 0; for (const d of String(digits)) c = T[(c + +d) % 10]; return (10 - c) % 10; }
  function makeRef(prefix, nr) {
    const p = String(prefix || '').replace(/\D/g, ''), n = String(nr || '').replace(/\D/g, '');
    if (!n) return '';
    const body = p + n.padStart(26 - p.length, '0');
    if (body.length !== 26) throw new Error('QR-Referenz zu lang (Präfix + Rechnungsnummer max. 26 Ziffern)');
    return body + mod10(body);
  }
  const refOk = r => { const v = String(r || '').replace(/\s/g, ''); return /^\d{27}$/.test(v) && mod10(v.slice(0, 26)) === +v[26]; };
  const fmtRef = r => { const v = String(r || '').replace(/\s/g, ''); return v.slice(0, 2) + ' ' + v.slice(2).replace(/(.{5})/g, '$1 ').trim(); };
  const fmtAmt = n => { const [a, b] = Number(n).toFixed(2).split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + b; };

  // Adresse als Typ S (strukturiert) – seit Nov. 2025 die einzige zulässige Form
  const addr = a => a ? ['S', cut(a.name, 70), cut(a.strasse, 70), cut(a.hausnr, 16), cut(a.plz, 16), cut(a.ort, 35), (clean(a.land) || 'CH').toUpperCase().slice(0, 2)] : ['', '', '', '', '', '', ''];

  /* b = { iban, cr:{name,strasse,hausnr,plz,ort,land}, betrag, waehrung, db:{…}|null, ref, mitteilung, rechnungsinfo } */
  function payload(b) {
    const v = iban(b.iban), qr = isQrIban(v), ref = String(b.ref || '').replace(/\s/g, '');
    let tp = 'NON'; if (ref) tp = qr ? 'QRR' : 'SCOR';
    const L = ['SPC', '0200', '1', v, ...addr(b.cr), '', '', '', '', '', '', '', b.betrag != null && b.betrag > 0 ? Number(b.betrag).toFixed(2) : '', b.waehrung || 'CHF',
      ...(b.db && clean(b.db.name) ? addr(b.db) : addr(null)), tp, ref, cut(b.mitteilung, 140), 'EPD'];
    if (b.rechnungsinfo) L.push(cut(b.rechnungsinfo, 140));
    return L.join('\r\n');
  }
  function check(b) {
    const e = [];
    if (!ibanOk(b.iban)) e.push('IBAN ungültig (Einstellungen › Firma)');
    else if (isQrIban(b.iban) && !refOk(b.ref)) e.push('QR-IBAN verlangt eine gültige QR-Referenz');
    else if (!isQrIban(b.iban) && /^\d+$/.test(String(b.ref || '').replace(/\s/g, ''))) e.push('Normale IBAN: QR-Referenz nicht zulässig – in den Einstellungen eine QR-IBAN eintragen');
    ['name', 'plz', 'ort'].forEach(k => { if (!clean(b.cr?.[k])) e.push('Firmenadresse unvollständig (' + k + ')'); });
    if (b.betrag != null && (b.betrag < 0.01 || b.betrag > 999999999.99)) e.push('Betrag ausserhalb 0.01–999 999 999.99');
    if (cut(b.mitteilung, 140).length + cut(b.rechnungsinfo, 140).length > 140) e.push('Mitteilung + Rechnungsinformationen zusammen über 140 Zeichen');
    return e;
  }
  // Swico S1 (Rechnungsinformationen): Rechnungsnr., Datum, UID, MWST
  function swico({ nr, datum, uid, mwst }) {
    const e = s => String(s).replace(/\\/g, '\\\\').replace(/\//g, '\\/');
    let s = '//S1';
    if (nr) s += '/10/' + e(nr);
    if (datum) s += '/11/' + datum.slice(2, 4) + datum.slice(5, 7) + datum.slice(8, 10);
    const u = String(uid || '').replace(/\D/g, ''); if (u.length === 9) s += '/30/' + u;
    if (mwst && mwst.length) s += '/32/' + (mwst.length === 1 ? String(mwst[0].satz) : mwst.map(m => `${m.satz}:${Number(m.netto).toFixed(2)}`).join(';'));
    return s === '//S1' ? '' : s;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = a => a ? [a.name, [a.strasse, a.hausnr].filter(Boolean).join(' '), [a.plz, a.ort].filter(Boolean).join(' ')].map(clean).filter(Boolean) : [];
  // Ecken für leere Felder (Betrag / Zahlbar durch)
  const corners = (w, h) => `<svg class="qcorn" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><path d="M0 2V0h3M${w - 3} 0h3v2M${w} ${h - 2}v2h-3M3 ${h}H0v-2" fill="none" stroke="#000" stroke-width="0.25"/></svg>`;

  // Zahlteil mit Empfangsschein (210 × 105 mm)
  function html(b, { trennlinie = true } = {}) {
    const ref = String(b.ref || '').replace(/\s/g, ''), betrag = b.betrag != null && b.betrag > 0 ? fmtAmt(b.betrag) : '';
    const cr = [fmtIban(b.iban), ...lines(b.cr)].map(esc).join('<br>');
    const db = b.db && clean(b.db.name) ? lines(b.db).map(esc).join('<br>') : '';
    const refTxt = ref ? (isQrIban(b.iban) ? fmtRef(ref) : ref.replace(/(.{4})/g, '$1 ').trim()) : '';
    const qr = QRCode.svg(payload(b), { mm: 46, cross: true, maxVer: 25 });
    return `<div class="qrbill${trennlinie ? ' cut' : ''}">${trennlinie ? '<div class="qcuttxt">Vor der Einzahlung abzutrennen</div>' : ''}
      <div class="qrec">
        <div class="qt">Empfangsschein</div>
        <div class="qinfo">
          <div class="qh">Konto / Zahlbar an</div><div class="qv">${cr}</div>
          ${refTxt ? `<div class="qh">Referenz</div><div class="qv">${refTxt}</div>` : ''}
          <div class="qh">Zahlbar durch${db ? '' : ' (Name/Adresse)'}</div><div class="qv">${db || corners(52, 20)}</div>
        </div>
        <div class="qamt"><div><div class="qh">Währung</div><div class="qv">${esc(b.waehrung || 'CHF')}</div></div><div><div class="qh">Betrag</div><div class="qv">${betrag || corners(30, 10)}</div></div></div>
        <div class="qacc">Annahmestelle</div>
      </div>
      <div class="qpay">
        <div class="qleft">
          <div class="qt">Zahlteil</div>
          <div class="qcode">${qr}</div>
          <div class="qamt"><div><div class="qh">Währung</div><div class="qv">${esc(b.waehrung || 'CHF')}</div></div><div><div class="qh">Betrag</div><div class="qv">${betrag || corners(40, 15)}</div></div></div>
        </div>
        <div class="qright">
          <div class="qh">Konto / Zahlbar an</div><div class="qv">${cr}</div>
          ${refTxt ? `<div class="qh">Referenz</div><div class="qv">${refTxt}</div>` : ''}
          ${clean(b.mitteilung) || b.rechnungsinfo ? `<div class="qh">Zusätzliche Informationen</div><div class="qv">${esc(clean(b.mitteilung))}${b.rechnungsinfo ? (clean(b.mitteilung) ? '<br>' : '') + `<span class="qsmall">${esc(b.rechnungsinfo)}</span>` : ''}</div>` : ''}
          <div class="qh">Zahlbar durch${db ? '' : ' (Name/Adresse)'}</div><div class="qv">${db || corners(65, 25)}</div>
        </div>
      </div></div>`;
  }
  return { payload, check, html, makeRef, refOk, fmtRef, mod10, ibanOk, isQrIban, fmtIban, fmtAmt, swico, iban };
})();
if (typeof module !== 'undefined') module.exports = { QRCode, SwissQR };
