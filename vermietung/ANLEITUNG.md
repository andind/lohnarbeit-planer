# IM-Vermietung v1.10 – Anleitung

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
- **Ansicht**: Die Seite bleibt fest, nur Tabellen bzw. der Inhalt scrollen. Zoom oben rechts (− 125 % +); Standard 125 % am PC/Tablet,
  100 % am Handy; Klick auf die Prozentzahl = zurück zum Standard. Browser-Zoom dafür auf 100 % lassen (Ctrl+0).
- **Einsätze** – alle Einsätze mit Filter (Jahr/Zeitraum, Kunde, Maschine, offen/abgerechnet, Suche). Antippen = bearbeiten.
  Mehrere ankreuzen → als abgerechnet markieren, ändern, löschen. «＋ Einsatz» oder Ctrl+N für manuelle Erfassung.
- **Import**
  - *Online-Formular per Freigabelink*: einmalig in Excel (OneDrive) bei der Formular-Datei *Freigeben › Link kopieren*
    («Jeder mit dem Link», nur anzeigen) und unter Import › «Freigabelink eintragen» einfügen. Danach: «1. Formular-Excel öffnen»
    (Excel im Browser holt die neuesten Antworten in die Datei) und «2. Abrufen und importieren». Lässt Microsoft das direkte
    Abrufen nicht zu (Fehler 401), unter *Mehr › Microsoft* einmalig eine App-Registrierung anlegen und die Client-ID eintragen –
    dann ruft die App die Datei mit deiner Microsoft-Anmeldung ab (Anmeldung hält bei Browser-Apps ca. 24 h, danach kurz neu anmelden).
    Notlösung: «Datei › Speichern unter › Kopie herunterladen» und die Datei wählen.
  - *Online-Formular*: Excel-Export von Microsoft Forms («Formular zur Erfassung von Maschinenvermietungen») direkt wählen –
    die Spalten (Name Mieter, Maschine, Mietdatum, Fläche/Stunden, Bemerkung, Abgerechnet, Id) werden erkannt, die Prüfliste
    erscheint sofort («Spalten neu zuordnen…» falls nötig). Es darf immer der ganze Export eingelesen werden – schon vorhandene
    Einsätze werden erkannt und nicht angekreuzt. Ist im Formular «Abgerechnet» gesetzt, werden neue Einsätze als abgerechnet
    übernommen; optional lassen sich auch vorhandene, noch offene Einsätze so markieren.
  - *Einsatzheft scannen* (aus dem Programm ScanListe übernommen): Maschine(n) der Liste ankreuzen (mehrere = je Eintrag eine Zeile
    pro Maschine; beim Mulcher Einheit h/ha wählbar), Mengen-Einheit der Liste, Ausrichtung («90° rechts» für quer liegende Hefte),
    «Heft-Doppelseite» (jede Hälfte einzeln an Claude), Zahl ohne Einheit = Aren oder ha. Dann Scan (JPG/PNG/PDF) wählen oder
    mit dem Handy fotografieren. Claude rechnet Aren in ha um, löst Wiederholungszeichen auf und ignoriert durchscheinende Rückseiten.
    Maschinen mit anderer Einheit als die Liste erhalten keine Menge und sind als «unsicher» markiert. In der Prüfliste zeigt 📄 die Seite.
    Gescannt wird mit der HP-Software oder «Windows Scan» (300 dpi, Farbe); die App selbst steuert den Scanner nicht an.
  - Danach **Prüfliste**: Kunde und Maschine prüfen (Neukunden direkt anlegen), Menge/Datum korrigieren, «übernehmen».
    Abweichende Schreibweisen merkt sich die App als Namensvarianten und erkennt sie beim nächsten Mal selbst.
- **Auswertung** – pro Maschine, pro Kunde, pro Monat, Kunde × Maschine; Excel-Export.
- **Abrechnung** – Zeitraum und Status wählen (Standard: offen); «Stornierte anzeigen» blendet stornierte Zeilen ein.
  Anfangs ist **nichts ausgewählt**.
  - Kunde ankreuzen = alle seine Zeilen auswählen. Mit ▸ aufklappen und Zeilen einzeln an- oder abwählen.
    **Nur ausgewählte Zeilen** kommen in Rapport und Abrechnungsliste.
  - Zeile anklicken = Details: bearbeiten, «Stornieren» oder «✓ Abgerechnet» (mit Rückfrage – direkt in der Zeile geht das bewusst nicht).
  - *Ausgewählte Zeilen abgerechnet*: markiert alle ausgewählten offenen Zeilen auf einmal.
  - «▲ Leiste ausblenden» blendet Titel, Filter und die übrigen Knöpfe aus – es bleiben nur «Ausgewählte Zeilen abgerechnet»
    und die Tabelle (wird gemerkt; «▼ Leiste einblenden» holt alles zurück).
  - *Rapporte*: Titel «Rapport Maschinenmiete», eine Seite pro Kunde mit Briefkopf, Kundenname und Kunden-Nr. unter dem Titel (ohne Adressblock), ohne Seitenzahlen.
    Vor dem Druckfenster lassen sich die Artikelpreise **nur für diesen Ausdruck** ändern; dort auch «Preise und Beträge anzeigen».
    Der Knopf «Rapport» in einer Kundenzeile druckt die ausgewählten Zeilen dieses Kunden, sonst alle.
  - *Abrechnungsliste*: pro Kunde Art.-Nr., Bezeichnung, Menge, Preis, Betrag – zum Übertragen in AgroFaktura (auch als Excel).
  - **Storniert**: zählt nirgends mehr (Rapport, Abrechnungsliste, Auswertung); sichtbar mit «Stornierte anzeigen».
- **Stammdaten** – Kunden (Kd-Nr. leer = Neukunde, Adresse, Namensvarianten, Zusammenführen) und Maschinen (Art.-Nr., Einheit, Preis).
  «Kundenliste importieren» liest z. B. Kunden.xlsx und ergänzt Adressen über die Kunden-Nr.
- **Mehr** – Dropbox, Scan-Schlüssel, Excel-Export aller Daten, Datensicherung/Wiederherstellen.

## Bei Updates
`config.js` nicht überschreiben. Version in `app.js` (`APP_VERSION`, `APP_STAND`) und `CACHE` in `sw.js` gleich erhöhen.
