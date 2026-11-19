# IM-Faktura v1.35 – Anleitung (Stand 19.11.2026)

Eigenständige App für Rechnungen mit Schweizer **QR-Zahlteil** (QR-IBAN mit QR-Referenz), Offenen Posten,
Zahlungsabgleich (camt.054/053), Mahnungen und Buchungsexport für **AgroOffice**. Ersetzt AgroFaktura.
Eigene Daten (`faktura.json` in der Dropbox). Hier werden die **Kunden** aller IM-Programme verwaltet.

## Einrichten (einmalig)
1. Den ganzen Ordner `faktura/` ins Repository `andind/lohnarbeit-planer` hochladen (neben `vermietung/`).
   Adresse danach: **https://andind.github.io/lohnarbeit-planer/faktura/**
2. Dropbox: In der App Console (dieselbe Dropbox-App wie IM-Verwaltung/IM-Vermietung) unter *Settings › OAuth 2 › Redirect URIs*
   zusätzlich `https://andind.github.io/lohnarbeit-planer/faktura/` eintragen.
3. App öffnen › *Mehr › Mit Dropbox anmelden*. Daten: Dropbox › Apps › (Dropbox-App) › `faktura.json`.
4. *Mehr › Firma & QR-Konto*: **QR-IBAN** eintragen (Vorgabe CH95 3080 8001 4962 5309 5). Nur falls die Bank es verlangt: Referenz-Präfix (BESR-ID).
   Nächste Rechnungsnummer setzen (an AgroFaktura anschliessen).
5. Kunden: *Import › Kunden übernehmen* › zuerst «Excel (AgroOffice)…», dann «Aus IM-Vermietung», danach Stammdaten › «🔗 IM-Verwaltung verknüpfen».
   Jeder Kunde braucht Name, PLZ und Ort (Pflicht im QR-Zahlteil: strukturierte Adressen).
6. Artikel: *Import › Artikel* (Artikelliste aus AgroFaktura mit Konto) oder Stammdaten › Artikel. Nötig sind mindestens
   **Art. 30** Spritzarbeiten, **Art. 52** Pflanzenschutzmittel und **Art. 100** Maschinenmiete (der NAS-Dienst meldet, wenn einer fehlt).
7. *Mehr › Testrechnung ansehen* – Briefkopf und Zahlteil prüfen, einmal ausdrucken und mit der Bank-App scannen.

## Rechnung schreiben
- Das **Rechnungsfenster sieht aus wie die gedruckte Rechnung**. Adresse, Datum, Titel, Abrechnungsperiode oder Texte antippen → Fenster «Kopf»;
  eine Position antippen → Fenster «Position» (Artikel, Datum, Bezeichnung, Bemerkung, Menge, Einheit, Preis, Rabatt %, MWST, Steuer, Konto).
  «＋ Position / Textzeile / Zwischentitel / Zwischensumme / Rabatt» fügt Zeilen an; ▲ ▼ verschiebt (eine Position samt ihren Zusatzleistungen).
- **Entwürfe speichern sich automatisch** bei jeder Änderung. Gelöscht wird ein Entwurf nie: «🗄 Stornieren & archivieren» legt ihn ins Archiv
  (Entwürfe › Archiv, dort «↩ Zurückholen»).
- **Abschliessen & drucken** vergibt Nummer und QR-Referenz. Nur möglich, wenn jede Position ein **Konto und einen MWST-Code** hat
  (fehlt etwas, steht es rot an der Position). Fehlt beim Übernehmen eines Artikels das Konto, öffnet sich der **Kontenplan** (AgroOffice-Konten 3000–6999);
  mit «Konto auch im Artikel speichern» fragt er beim nächsten Mal nicht mehr.
- **Steuerart je Position** (Fenster Position › Steuer) wie in AgroFaktura: *Ertrag* – Satz, Ziff. 235 Entgeltsminderung, Ziff. 205 optiert,
  ohne MWST mit Ziffer (220, 221, 225, 230, 280, 900, 910); *Aufwand* (z. B. übernommenes Saatgut) – Satz inkl. «Reduzierter Satz (Urproduzent)»
  und Vorsteuer 1/2/keine. Der MWST-Code ist die Ziffer der ESTV-Abrechnung (303/313/343, 235, 205, 400, 405 …), Tabelle unter *Mehr › Buchhaltung*.
- **Rabatte**: je Position «Rabatt %» (auf der Rechnung als Minusbetrag), oder Zeile *Rabatt* (Prozent oder Betrag) für den Block über der
  Zwischensumme bzw. für alle Positionen darüber. Rabatte werden anteilig auf MWST-Satz und Konto verteilt.
- **Gutschrift** (z. B. Saatgutreste): Position mit negativer Menge oder negativem Preis, Satz und Code selber wählen.
- **Zusatzleistungen** (Strohhäckseln, Saatgut …) hängen an ihrer Hauptposition (↳ eingerückt, gedruckt mit «+ »).
  «＋ Zusatzposten» erstellt sie für angekreuzte Positionen (ein Posten oder «je Position»).
- **Kultur auf der Rechnung**: die IM-Verwaltung übergibt die Kultur separat; je Artikel lässt sie sich mit «Kultur auf der Rechnung anzeigen» ein- oder ausblenden (z. B. aus bei Rübenernte/Rübensaat).
- **Abrechnungsperiode** unter dem Titel: automatisch erstes bis letztes Datum der Positionen, im Fenster Kopf überschreibbar.
- PDF: im Druckfenster «Als PDF speichern» (Dateiname wird vorgeschlagen). Mehrere Entwürfe ankreuzen → «abschliessen & drucken» (Serienrechnung).
- Rechnungspapier: **Normalpapier**, Zahlteil mit gestrichelten Schnittlinien ✂ – Rechnung und Beilagen in einem Druckauftrag.

## Entwürfe und Eingang aus den anderen Programmen
- **IM-Verwaltung**: *Spritzen › Abrechnung* «📤 An IM-Faktura» (Art. 30 Spritzarbeiten ha × Preis/ha + ein Posten Art. 52 Pflanzenschutzmittel,
  die Abrechnung Spritzarbeiten als Beilage) und *Verwaltung › Abrechnung* (Einträge ankreuzen › «📤 An IM-Faktura»; Artikel, Menge, Preis,
  Bemerkung, Strohhäckseln und Zusatzartikel im Sendefenster bzw. im Eintrag vorbereiten). Ohne Artikel wird nichts gesendet.
- **IM-Vermietung**: Abrechnung › Zeilen auswählen › «📤 An IM-Faktura» – Art. 100 «Maschinenmiete gemäss Rapport», Rapport als Beilage.
- Die Übergaben liegen in Dropbox `/faktura-eingang/`. IM-Faktura holt sie beim Start, alle paar Minuten und mit «Eingang prüfen» ab und hängt sie
  an den Entwurf des Kunden an (sonst neuer Entwurf); **pro Kunde gibt es immer nur einen offenen Entwurf**. Feldnamen werden nie gedruckt.
- Entwürfe von Hand zusammenlegen (gleicher Kunde): auswählen › «⇄ Zusammenlegen». Nur einen Teil verrechnen: Positionen ankreuzen ›
  «✓ Nur N markierte abschliessen & drucken» – der Rest bleibt Entwurf.
- Wartende Übergaben werden vom NAS-Dienst täglich mitgesichert. Wurde etwas gesendet, ist aber nie angekommen, meldet es die Prüfung der Datenbeziehungen.

## Kunden
- Die Kunden werden **in IM-Faktura verwaltet** (Stammdaten › Kunden).
- **IM-Vermietung** übernimmt Name, Kd-Nr., Adresse und Status von hier; Neukunden aus dem Import («nur hier») legt IM-Faktura beim ersten Senden an.
- **IM-Verwaltung**: Kunden bleiben aus MyJohnDeere. Stammdaten › «🔗 IM-Verwaltung verknüpfen» ordnet jedem JD-Kunden den Faktura-Kunden zu
  (ein Faktura-Kunde kann mehrere JD-Kunden haben). Übergaben werden über diese Verknüpfung zugeordnet, sonst über Kd-Nr./Namen.
- Kundenliste aus **AgroOffice Fakturierung** (Export «Kunden» als Excel): Import › Kunden übernehmen › «Excel (AgroOffice)…»; abweichende Angaben
  mit dem Häkchen «überschreiben» übernehmen.

## Rechnung zurücknehmen, Entwurf drucken
- Abgeschlossene Rechnung › «↩ Zurück zu Entwurf» – die Nummer bleibt reserviert, beim erneuten Abschliessen gleiche Nummer und QR-Referenz.
  Nur ohne erfasste Zahlung; Mahnungen werden verworfen.
- Entwurf drucken: «🖨 Entwurf drucken» – Wasserzeichen ENTWURF, ohne QR-Zahlteil.

## Offene Posten, Zahlungen, Mahnungen
- **Offene Posten**: 💰 Zahlung erfassen (auch Teilzahlungen, Rest ausbuchen; Eingangskonto wählen: Bank, Kasse …), ✉ Mahnen.
  «Zahlungen einlesen»: camt.054 (oder camt.053, auch als ZIP) aus dem E-Banking – Zuordnung über die QR-Referenz.
- **Mahnungen**: 3 Stufen mit Gebühr und Frist (*Mehr › Mahnwesen*), eigener QR-Zahlteil mit dem offenen Betrag inkl. Gebühren.

## Buchhaltung AgroOffice
- Gebucht werden nur **Zahlungseingänge** (vereinnahmt): Eingangskonto an Ertragskonto je Konto und MWST-Code, inkl. MWST; Teilzahlungen anteilig,
  ausgebuchte Reste nicht, Überzahlungen auf 9910, Mahngebühren auf 3600. Beleg = 2 + Rechnungs-Nr. vierstellig (Rechnung 2 = Beleg 20002),
  Buchungstext beginnt mit «IM-<Rechnungs-Nr.>». AgroOffice nimmt nur Konten 1000–8999 und 9910/9911 an.
- *Offene Posten › 📒 Buchungen für AgroOffice* erstellt die Datei im Abacus-Format «XML-Buchungen». In AgroOffice *Grundeinstellungen › Import*
  den Haken «BETA: Import von Buchungen im Abacus-Format» setzen und den Ordner eintragen (Chrome/Edge am PC schreibt direkt in den Ordner).
- Exportierte Zahlungen sind markiert (📒 gebucht). *Debitoren per Stichtag*: Excel der am Stichtag offenen Rechnungen nach Konto und MWST (31.12.).

## Datensicherung
- **Automatisch** durch den NAS-Dienst jd-sync (ab Version 69): täglich `faktura.json` (Dropbox › Sicherungen/Faktura und NAS) –
  30 Tage, je Monat 24 Monate, **je Jahr mindestens 10 Jahre** (Aufbewahrungspflicht) –, dazu wartende Übergaben im Eingang und wöchentlich
  `IM-Faktura-Daten_<Datum>.xlsx` (Rechnungen, Positionen, Zahlungen, Kunden, Artikel; Dropbox › Sicherungen/Excel).
  *Mehr › Daten* zeigt, wann jede Datei zuletzt gesichert wurde, und Auffälligkeiten bei den Verknüpfungen.
- Von Hand: *Mehr › Daten* › Rechnungsjournal (Excel), Alles als Excel, Datensicherung (.json), **Wiederherstellen…** (ersetzt den aktuellen Stand, auch in der Dropbox).

## Technik
- Dateien: `index.html`, `styles.css`, `qr.js` (eigener QR-Encoder + Zahlteil nach SIX, SPC 0200, Swico S1), `lib.js` (Dropbox, Excel),
  `app.js` (Daten, Berechnung), `druck.js` (A4-Seiten), `eingang.js` (Übergaben), `buchung.js` (AgroOffice, Kontenplan), `import.js`, `ansichten.js`,
  `config.js` (Dropbox-App-Key – bei Updates **nicht überschreiben**), `sw.js`, Icons, `logo.jpg` (Briefkopf).
- localStorage-Schlüssel `mf_*` (nie `lp_*` oder `mv_*`). Liest `/vermietung.json` und `/planung.json` nur.
- Bei Updates: `APP_VERSION`/`APP_STAND` in `app.js` und `CACHE` in `sw.js` erhöhen.
