# IM-Faktura v1.7 – Anleitung

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

## Entwürfe und Eingang (ab v1.8)
- **IM-Verwaltung** (ab v140):
  - *Spritzen › Abrechnung*: Kunde wählen › «📤 An IM-Faktura» (oder in der Übersicht «📤 Alle offenen an IM-Faktura»). Arbeit und Mittel kommen zusammengefasst, die Detailabrechnung als Beilage. Die Aufträge werden «verrechnet».
  - *Verwaltung › Abrechnung*: Einträge ankreuzen (vorher bei Bedarf korrigieren) › «📤 An IM-Faktura». Je Eintrag eine Position, danach «abgerechnet».
- **IM-Vermietung** (ab v1.14): Abrechnung › Zeilen auswählen › «📤 An IM-Faktura» – je Kunde eine Zeile Art. 100 «Maschinenmiete gemäss Rapport», der Rapport als Beilage.
- Die Übergaben liegen in Dropbox `/faktura-eingang/`. IM-Faktura holt sie beim Start, alle paar Minuten und mit «Eingang prüfen» ab (Dropbox-Anmeldung nötig) und hängt sie an den offenen Entwurf des Kunden an (sonst neuer Entwurf). Fehlende Kunden werden angelegt.
- Reiter **Entwürfe**: Hinweise (ohne Preis, ohne Kunde …), Σ fasst gleiche Positionen zusammen. Beilagen werden hinter der Rechnung gedruckt und lassen sich im Editor entfernen.
- Mehr › Buchhaltung › Eingang: Artikel für Pflanzenschutzmittel (Standard 52), Maschinenmiete (100), MWST für Arbeiten (2,6 %).

## Kunden (ab v1.9)
- Die Kunden werden **in IM-Faktura verwaltet** (Stammdaten › Kunden).
- **IM-Vermietung** übernimmt sie von hier (bei jedem Synchronisieren bzw. «⟳ Kunden aus IM-Faktura»). Name, Kd-Nr. und Adresse sind dort gesperrt; nur Namensvarianten bleiben dort. Neukunden aus dem Import gibt es dort weiter («nur hier») – IM-Faktura legt sie beim ersten Senden an.
- **IM-Verwaltung**: Kunden bleiben aus MyJohnDeere. Unter Stammdaten › «🔗 IM-Verwaltung verknüpfen» jedem JD-Kunden den Kunden von IM-Faktura zuordnen (Vorschläge gelb; ein Faktura-Kunde kann mehrere JD-Kunden haben).
- Kundenliste aus **AgroOffice Fakturierung** (Export «Kunden» als Excel): Import › Kunden übernehmen › «Excel (AgroOffice)…». Neue Kunden werden angelegt, fehlende Angaben ergänzt; abweichende Angaben (z. B. neue Adresse) werden mit dem Häkchen «überschreiben» aus der Liste übernommen.
- Einmalig zu Beginn: Import › Kunden übernehmen › zuerst «Excel (AgroOffice)…», dann «Aus IM-Vermietung» (verknüpft die Vermietungskunden), danach «🔗 Mit IM-Verwaltung verknüpfen».

## Rechnung zurücknehmen, Entwurf drucken (ab v1.12)
- Abgeschlossene Rechnung öffnen › «↩ Zurück zu Entwurf» (oder in der Liste auswählen › «↩ Zurück zu Entwurf»). Sie steht dann wieder unter Entwürfe und lässt sich bearbeiten. Die Nummer bleibt reserviert; beim erneuten «Abschliessen & drucken» erhält sie dieselbe Nummer und QR-Referenz. Nur möglich, solange keine Zahlung erfasst ist; Mahnungen werden verworfen.
- Entwürfe drucken: im Editor «🖨 Entwurf drucken», in den Entwürfen 🖨 je Zeile oder mehrere auswählen › «Drucken». Der Ausdruck trägt das Wasserzeichen ENTWURF und hat keinen QR-Zahlteil.

## Technik
- Dateien: `index.html`, `styles.css`, `qr.js` (eigener QR-Encoder + Zahlteil nach SIX, SPC 0200, Swico S1),
  `lib.js` (Dropbox, Excel), `app.js` (Daten, Berechnung), `druck.js` (A4-Seiten, Seitenumbruch), `import.js`, `ansichten.js`,
  `config.js` (Dropbox-App-Key – bei Updates **nicht überschreiben**), `sw.js`, Icons, `logo.jpg` (Briefkopf).
- localStorage-Schlüssel `mf_*` (nie `lp_*` oder `mv_*`). Liest `/vermietung.json` und `/planung.json` nur (Kunden/Artikel übernehmen).
- Bei Updates: `APP_VERSION`/`APP_STAND` in `app.js` und `CACHE` in `sw.js` erhöhen.

## Buchhaltung AgroOffice (ab v1.1)
- Gebucht werden nur **Zahlungseingänge** (vereinnahmte Entgelte): `1020 an Ertragskonto` je Konto und MWST-Satz, inkl. MWST,
  mit MWST-Code; alle Teile einer Zahlung haben die Rechnungs-Nr. als Beleg (AgroOffice nimmt nur Zahlen an – getestet: «IM-2», «1-2», «IM 2» werden zu 0). Belege aus IM-Faktura: 2 + Rechnungs-Nr. vierstellig, Rechnung 2 = Beleg 20002 (Mehr › Buchhaltung) und beginnen im Buchungstext mit «IM-<Rechnungs-Nr.>» (z. B. «IM-2 Zahlung Muster Hans»). (Ein Hilfskonto wie 9904 geht nicht: der AgroOffice-Import
  nimmt nur Konten 1000–8999 und 9910/9911 an.) Teilzahlungen werden anteilig aufgeteilt, ausgebuchte Restbeträge nicht gebucht,
  Überzahlungen auf 9910. Konten und MWST-Codes unter *Mehr › Buchhaltung (AgroOffice)*.
- Beim Erfassen einer Zahlung von Hand wählst du das Konto, auf dem das Geld eingegangen ist (Bank, Kasse, Landikonto …);
  die Auswahl stellst du unter *Mehr › Buchhaltung* zusammen. Zahlungen aus camt-Dateien gehen aufs Bankkonto.
- *Offene Posten › 📒 Buchungen für AgroOffice* erstellt die Datei im Abacus-Format «XML-Buchungen». In AgroOffice unter
  *Grundeinstellungen › Import* den Haken «BETA: Import von Buchungen im Abacus-Format» setzen und den Ordner eintragen.
  Mit Chrome/Edge am PC kann IM-Faktura direkt in diesen Ordner schreiben («Ordner wählen»), sonst landet die Datei im Download-Ordner.
- Exportierte Zahlungen sind markiert (📒 gebucht) und kommen nicht nochmals. Frühere Exporte lassen sich nochmals herunterladen
  oder zurücknehmen (nur wenn der Import in AgroOffice nicht geklappt hat).
- *Debitoren per Stichtag*: Excel mit allen am Stichtag offenen Rechnungen, aufgeteilt nach Konto und MWST – für die Nachführung per 31.12.
- Jeder Artikel hat ein **Ertragskonto** (Artikelliste aus AgroFaktura per *Import › Artikel* einlesen, Spalte «Konto»).
- **Maschinenmiete** aus der Abrechnungsliste der IM-Vermietung: eine Zeile «100 Maschinenmiete gemäss Rapport», die Maschinen
  stehen als Beilage «Rapport Maschinenmiete» hinter der Rechnung (abschaltbar beim Import).
