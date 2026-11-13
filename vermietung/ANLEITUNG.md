# IM-Vermietung v1.0 – Anleitung

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
  - *Papierrapport scannen*: PDF vom Scanner oder Foto. Optional die Maschine(n) des Rapports antippen. Claude liest die Zeilen aus.
  - Danach **Prüfliste**: Kunde und Maschine prüfen (Neukunden direkt anlegen), Menge/Datum korrigieren, «übernehmen».
    Abweichende Schreibweisen merkt sich die App als Namensvarianten und erkennt sie beim nächsten Mal selbst.
- **Auswertung** – pro Maschine, pro Kunde, pro Monat, Kunde × Maschine; Excel-Export.
- **Abrechnung** – Zeitraum wählen (Standard: nur offene Einsätze), Kunden ankreuzen:
  - *Rapporte*: eine Seite pro Kunde mit Briefkopf und Adresse, ohne Seitenzahlen → im Druckfenster «Als PDF speichern».
    «Preise im Rapport» blendet Preis und Betrag ein.
  - *Abrechnungsliste*: pro Kunde Art.-Nr., Bezeichnung, Menge, Preis, Betrag – zum Übertragen in AgroFaktura (auch als Excel).
  - *Als abgerechnet markieren*: setzt die Einsätze auf «abgerechnet» (Datum heute).
- **Stammdaten** – Kunden (Kd-Nr. leer = Neukunde, Adresse, Namensvarianten, Zusammenführen) und Maschinen (Art.-Nr., Einheit, Preis).
  «Kundenliste importieren» liest z. B. Kunden.xlsx und ergänzt Adressen über die Kunden-Nr.
- **Mehr** – Dropbox, Scan-Schlüssel, Excel-Export aller Daten, Datensicherung/Wiederherstellen.

## Bei Updates
`config.js` nicht überschreiben. Version in `app.js` (`APP_VERSION`, `APP_STAND`) und `CACHE` in `sw.js` gleich erhöhen.
