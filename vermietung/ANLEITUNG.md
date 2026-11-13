# IM-Vermietung v1.2 – Anleitung

Eigenständige App für die Maschinenvermietung: Einsätze erfassen und importieren, auswerten, Kundenrapporte und Abrechnungsliste drucken.
Eigene Kunden, Maschinen und Einsätze in einer eigenen Datei (`vermietung.json`) – unabhängig vom IM-Verwalter.

## Einrichten (einmalig)
1. Den ganzen Ordner `vermietung/` ins Repository `andind/lohnarbeit-planer` hochladen (neben `applikationskarte/`).
   Adresse danach: **https://andind.github.io/lohnarbeit-planer/vermietung/**
2. Dropbox: In der App Console (dieselbe Dropbox-App wie beim IM-Verwalter) unter *Settings › OAuth 2 › Redirect URIs*
   zusätzlich `https://andind.github.io/lohnarbeit-planer/vermietung/` eintragen.
3. App öffnen › *Mehr › Mit Dropbox anmelden*. Die Daten liegen danach in Dropbox › Apps › (Dropbox-App) › `vermietung.json`.
4. Auf iPhone/iPad: in Safari *Teilen › Zum Home-Bildschirm*. Auf dem PC in Chrome/Edge: *App installieren*.
5. Für das Scannen: unter *Mehr › Scan* einen eigenen API-Schlüssel von console.anthropic.com eintragen (wird nur auf dem Gerät gespeichert).
6. Unter *Stammdaten › Maschinen* die Preise pro ha bzw. h eintragen.

Beim ersten Start übernimmt die App die bereinigten Einsätze 2025/26 (155 Einsätze, 52 Kunden, 13 Maschinen mit Art.-Nr. 101–113)
aus `startdaten.json`.

## Bedienung
- **Einsätze** – alle Einsätze mit Filter (Jahr/Zeitraum, Kunde, Maschine, offen/abgerechnet, Suche). Antippen = bearbeiten.
  Mehrere ankreuzen → als abgerechnet markieren, ändern, löschen. «＋ Einsatz» oder Ctrl+N für manuelle Erfassung.
- **Import**
  - *Online-Formular*: Excel-Export der Antworten wählen, Spalten zuordnen (wird gemerkt). Es darf immer der ganze Export eingelesen
    werden – schon vorhandene Einsätze werden erkannt und nicht angekreuzt.
  - *Einsatzheft scannen* (aus dem Programm ScanListe übernommen): Maschine(n) der Liste ankreuzen (mehrere = je Eintrag eine Zeile
    pro Maschine; beim Mulcher Einheit h/ha wählbar), Mengen-Einheit der Liste, Ausrichtung («90° rechts» für quer liegende Hefte),
    «Heft-Doppelseite» (jede Hälfte einzeln an Claude), Zahl ohne Einheit = Aren oder ha. Dann Scan (JPG/PNG/PDF) wählen oder
    mit dem Handy fotografieren. Claude rechnet Aren in ha um, löst Wiederholungszeichen auf und ignoriert durchscheinende Rückseiten.
    Maschinen mit anderer Einheit als die Liste erhalten keine Menge und sind als «unsicher» markiert. In der Prüfliste zeigt 📄 die Seite.
    Gescannt wird mit der HP-Software oder «Windows Scan» (300 dpi, Farbe); die App selbst steuert den Scanner nicht an.
  - Danach **Prüfliste**: Kunde und Maschine prüfen (Neukunden direkt anlegen), Menge/Datum korrigieren, «übernehmen».
    Abweichende Schreibweisen merkt sich die App als Namensvarianten und erkennt sie beim nächsten Mal selbst.
- **Auswertung** – pro Maschine, pro Kunde, pro Monat, Kunde × Maschine; Excel-Export.
- **Abrechnung** – Zeitraum wählen (Standard: nur offene Einsätze). Anfangs ist **kein Kunde angekreuzt** – die gewünschten Kunden ankreuzen.
  - Mit ▸ die Einträge eines Kunden aufklappen: Häkchen «im Rapport» = erscheint im Rapport und in der Abrechnungsliste,
    nicht angehakte Einträge werden nicht gedruckt. Zeile anklicken = Einsatz bearbeiten (dort auch «Stornieren» / «✓ Abgerechnet»).
    Direkt in der Zeile: ✓ = abgerechnet, Storno = storniert, ↺ = wieder offen.
  - *Rapporte*: eine Seite pro Kunde mit Briefkopf und Adresse, ohne Seitenzahlen. Vor dem Druckfenster erscheinen die Artikel
    mit ihren Preisen – diese lassen sich **nur für diesen Ausdruck** ändern (Stammdaten bleiben unverändert); dort auch
    «Preise und Beträge im Rapport anzeigen». Danach im Druckfenster «Als PDF speichern».
  - *Abrechnungsliste*: pro Kunde Art.-Nr., Bezeichnung, Menge, Preis, Betrag – zum Übertragen in AgroFaktura (auch als Excel),
    ebenfalls mit Preisanpassung für diesen Ausdruck.
  - *Als abgerechnet markieren*: setzt alle offenen Einsätze der angekreuzten Kunden auf «abgerechnet» (Datum heute) –
    auch die vom Rapport ausgeschlossenen.
  - **Storniert**: zählt nirgends mehr (Rapport, Abrechnungsliste, Auswertung), bleibt aber in der Einsatzliste sichtbar
    (durchgestrichen; Filter «Storniert»).
- **Stammdaten** – Kunden (Kd-Nr. leer = Neukunde, Adresse, Namensvarianten, Zusammenführen) und Maschinen (Art.-Nr., Einheit, Preis).
  «Kundenliste importieren» liest z. B. Kunden.xlsx und ergänzt Adressen über die Kunden-Nr.
- **Mehr** – Dropbox, Scan-Schlüssel, Excel-Export aller Daten, Datensicherung/Wiederherstellen.

## Bei Updates
`config.js` nicht überschreiben. Version in `app.js` (`APP_VERSION`, `APP_STAND`) und `CACHE` in `sw.js` gleich erhöhen.
