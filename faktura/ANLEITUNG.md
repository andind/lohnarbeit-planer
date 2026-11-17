# IM-Faktura v1.0 – Anleitung

Eigenständige App für Rechnungen mit Schweizer **QR-Zahlteil** (QR-IBAN mit QR-Referenz), Offenen Posten,
Zahlungsabgleich (camt.054) und Mahnungen. Eigene Daten (`faktura.json`), unabhängig von IM-Verwaltung und IM-Vermietung.

## Einrichten (einmalig)
1. Den ganzen Ordner `faktura/` ins Repository `andind/lohnarbeit-planer` hochladen (neben `vermietung/`).
   Adresse danach: **https://andind.github.io/lohnarbeit-planer/faktura/**
2. Dropbox: In der App Console (dieselbe Dropbox-App wie IM-Verwaltung/IM-Vermietung) unter *Settings › OAuth 2 › Redirect URIs*
   zusätzlich `https://andind.github.io/lohnarbeit-planer/faktura/` eintragen.
3. App öffnen › *Mehr › Mit Dropbox anmelden*. Daten: Dropbox › Apps › (Dropbox-App) › `faktura.json`.
4. *Mehr › Firma & QR-Konto*: **QR-IBAN** eintragen (beginnt nach CHxx mit 30… oder 31…, steht im E-Banking).
   Nur falls die Bank es verlangt: Referenz-Präfix (BESR-ID). Nächste Rechnungsnummer setzen (z. B. an AgroFaktura anschliessen).
5. *Import › Kunden übernehmen* (aus IM-Vermietung bzw. IM-Verwaltung oder Excel) und fehlende Adressen ergänzen –
   jeder Kunde braucht Name, PLZ und Ort (Pflicht im QR-Zahlteil seit Nov. 2025: strukturierte Adressen).
6. *Import › Artikel übernehmen* (Maschinen der IM-Vermietung, Art.-Nr. 101 ff.) oder unter Stammdaten › Artikel erfassen.
7. *Mehr › Testrechnung ansehen* – Briefkopf und Zahlteil prüfen. Am besten einmal ausdrucken und mit der Bank-App scannen.

## Bedienung
- **Rechnungen**: «＋ Rechnung» (Ctrl+N). Art.-Nr. eingeben → Bezeichnung, Einheit, Preis, MWST aus dem Artikel.
  Positionen, Textzeilen, Zwischentitel; MWST pro Position (8,1 / 2,6 / 3,8 / 0 %); Total auf 5 Rappen gerundet.
  «Als Entwurf speichern» oder «Abschliessen & drucken» (vergibt die Nummer und die QR-Referenz).
  PDF: im Druckfenster «Als PDF speichern» – der Dateiname wird vorgeschlagen (Rechnung Nr. Kunde).
  Mehrere Entwürfe ankreuzen → «abschliessen & drucken» (Serienrechnung). Abgeschlossene Rechnungen werden storniert, nicht gelöscht.
- **Import › Abrechnungsliste**: «Abrechnungsliste Excel» aus der IM-Vermietung (oder eine CSV/Excel aus der IM-Verwaltung) wählen →
  Kunden werden über die Kd-Nr. bzw. den Namen zugeordnet → «Entwürfe erstellen» (ein Entwurf pro Kunde).
- **Offene Posten**: offene/überfällige Rechnungen, 💰 Zahlung erfassen (auch Teilzahlungen, Rest ausbuchen), ✉ Mahnen.
  «Zahlungen einlesen»: camt.054 (oder camt.053, auch als ZIP) aus dem E-Banking – Zahlungen werden über die QR-Referenz zugeordnet.
- **Mahnungen**: 3 Stufen (Zahlungserinnerung, 2. und 3. Mahnung) mit Gebühr und Frist, einstellbar unter Mehr › Mahnwesen.
  Die Mahnung hat einen eigenen QR-Zahlteil mit dem offenen Betrag inkl. Gebühren und derselben Referenz.
- **Mehr › Daten**: Rechnungsjournal als Excel (Netto/MWST je Satz, bezahlt, offen – für die Buchhaltung), Datensicherung.

## Technik
- Dateien: `index.html`, `styles.css`, `qr.js` (eigener QR-Encoder + Zahlteil nach SIX, SPC 0200, Swico S1),
  `lib.js` (Dropbox, Excel), `app.js` (Daten, Berechnung), `druck.js` (A4-Seiten, Seitenumbruch), `import.js`, `ansichten.js`,
  `config.js` (Dropbox-App-Key – bei Updates **nicht überschreiben**), `sw.js`, Icons, `logo.jpg` (Briefkopf).
- localStorage-Schlüssel `mf_*` (nie `lp_*` oder `mv_*`). Liest `/vermietung.json` und `/planung.json` nur (Kunden/Artikel übernehmen).
- Bei Updates: `APP_VERSION`/`APP_STAND` in `app.js` und `CACHE` in `sw.js` erhöhen.
