# IM-Verwalter – Arbeitsnotizen für die Weiterentwicklung

Programm von Andreas Indermühle, «Indermühle Lohnarbeiten · Maschinenvermietung», Schüpfen.
Früher «Lohnarbeit-Planer». Ab 01.11.2026 wird nur noch in **einem** Chat daran gearbeitet
(vorher parallel in «Modul Betrieb» und «Planungstool für Lohnarbeiten» – dabei hat v83 einmal v91 überschrieben).

## Technik
- Reine Web-App (HTML/JS/CSS, keine Fremdbibliotheken), PWA, läuft auf Windows-PC, iPhone, iPad mini, Galaxy Tab Active3.
- Hosting: GitHub Pages aus `andind/lohnarbeit-planer` (Branch `main`).
- Daten: lokal im Browser (`localStorage` `lp_data`) + Abgleich mit Dropbox (`/planung.json` im App-Ordner, OAuth PKCE ohne Server).
- `config.js` enthält den Dropbox App key – bei Updates **nicht überschreiben**.
- NAS-Dienst **jd-sync** (Synology, Docker, Node 20) liegt in `nas-dienst/jd-sync/` (seit 01.11.2026, Version 56):
  gleicht MyJohnDeere ab und schreibt `jd-sync.json` (Kunden, Felder, Vermessungen) und `jd-arbeiten.json`
  (Arbeitsgänge) in den Dropbox-Ordner; Anfrage über `jd-sync-request.json`. Seit v53 für **alle** Arbeitsgänge die Bedeckungskarte:
  Fläche ohne Überlappungen (`haB`, Raster, jede Zelle einmal; **unbearbeitete Stellen < 10 m² ganz innerhalb der virtuellen Grenze zählen als bearbeitet**, `fillSmallGaps`, v56 – «Vor Baumschule»: 1.7628 ha statt 1.7506) und **virtuelle Feldgrenze** (`gridBoundary`: ~1 m vergröbern – grobe Zelle zählt ab halb bedeckt (v55; vorher «irgendwas bedeckt» = Grenze ~1.7 % zu gross) –, schliessen, Löcher < 50 m² füllen,
  Umriss vereinfachen 0.5 m; Umrechnung Grad→Meter auf dem WGS84-Ellipsoid `geoK` seit v54, Kugel war ~0.3 % daneben; geprüft an echtem Export «Vor Baumschule» 20.10.2026: bedeckt 1.7506 ha = exakte Vereinigung, Display-Grenze 1.7636 ha (Differenz = unbesäte Stellen an Spurenden/Vorgewende), unsere Grenze 1.7651 ha, Maschine 1.85 ha mit Überlappungen; `COV_G` erhöhen = alle Karten neu rechnen) → eigene Datei `jd-grenzen.json` (Cache NAS `data/bedeckung-grenzen.json`; `data/grenzen.json` = Vermessungen!), im Arbeitsgang nur `grzB: 1`.
  Bedeckungskarte über die neue **Operations Data Export API** (`oxRequest`): POST `{isg}/operations/{id}/operationsExportRequests`
  (`exportSettings: SHAPEFILE, Point, EachSection, splitShapeFile false`, Header `Accept-UOM-System: METRIC`) → `o.covReq` (Request-ID) → GET Status
  (CREATED/PROCESSING/REPROCESS warten, SUCCESSFUL → `files[].presignedUri` ohne Anmeldung laden, FAILURE). `{isg}` = `apiBase` mit `/platform` → `/isg`
  (oder `cfg.isgBase`). Rückfall pro Arbeitsgang auf alte `/fieldOps/{id}` (bis Nov. 2027); nach 3× 401/403 neue API für den Lauf aus; `cfg.exportApi='alt'` = nur alt.
  Doku liest man im integrierten Browser (developer.deere.com/dev-docs/operations-export, Seite wird per JS aufgebaut). Mindestversion im IM-Verwalter: `NAS_MIN = '49'`.
  Version in `app/server.js` (`VERSION`, `STAND`). Zugangsdaten (Client-ID/Secret, Tokens) liegen nur auf dem NAS in `data/` –
  **nie Zugangsdaten ins Repository** (öffentlich). Andreas kopiert den Ordner `jd-sync` selbst aufs NAS.
- Wöchentliche Aufgabe «IM-Verwalter Wochenabschluss» (So 19:33): führt die Docs «Entstehungsgeschichte» und
  «Programmbeschrieb» nach und sendet das Gesamtpaket (1_IM-Verwalter, 2_NAS-Dienst, 3_Dokumentation) als ZIP.

## Dateien
| Datei | Inhalt |
|---|---|
| `app.js` (~5900 Zeilen) | Kern: Datenhaltung, Sync, Undo, Planung, Aufträge, Spritzen, MyJohnDeere, Bericht/Abrechnung, Vorbestellung, Kalenderabo, Rübensamen, Datensicherung, Datenprüfung |
| `betrieb.js` | Modul «Eigener Betrieb» (Fruchtfolge, Zwischenfrüchte, Düngung, Bodenproben, Stammdaten) |
| `kulturen.js` | zentrale Kulturliste mit zwei Ebenen (Oberbegriff / genaue Kultur), Assistent «Kulturen ordnen» |
| `index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, Icons, `logo.jpg` (Briefkopf) | |
| `karte.html` | Applikationskarte = Andreas' Tool «Applikationskarte» **v1.4** (seit IM-Verwalter v119; v1.4.1: Start-Ausschnitt Gemeinde Schüpfen `START_BOUNDS`; v1.4.2: `?bedeckung=1` übernimmt virtuelle Feldgrenze) mit Anbindung an den IM-Verwalter: Zonen zeichnen, Shapefile-Export für JD; Modus «Nur Feldgrenze» (Export CLIENT/FARM/FIELD), Parzellen anklicken (api3.geo.admin.ch), Bodenbedeckung AV (wfs.geodienste.ch), Teilfläche/Aussparung, Vorgewende nur Anzeige (Arbeitsbreite × Runden, `vgShow/vgBreite/vgRunden`; Karten aus v1.2 mit `vg {on, breite}` werden beim Öffnen umgestellt, eigene Vorgewende-Rate entfällt). Neue Versionen von Andreas: seine Datei als Grundlage nehmen und die Anbindung (IMV, Datalists, Start mit `?auftrag`/`?karte`/`?neu`, Zurück-Link, `[hidden]`-Regel) wieder einbauen. **Ausnahme**: nutzt Leaflet, Geoman, Turf, shpjs, JSZip von unpkg. Liest/schreibt `lp_data` (gleiche Adresse), Karten in «einstellungen» `rx-…` (`auftrag`, `state`), setzt `lp_dirty`; App gleicht über Dropbox ab. Aufruf: `karte.html?auftrag=ID`, `?karte=rx-…`, `?neu=1`. |
| `applikationskarte/` | **Eigenständige** Applikationskarte **v1.13** als eigene PWA (Start-Ausschnitt Gemeinde Schüpfen `START_BOUNDS`) (eigenes `manifest.webmanifest`, `sw.js` mit Scope `applikationskarte/`, Cache `appkarte-vX.Y`), ohne Anbindung an den IM-Verwalter; zusätzlich Sentinel-2 (NDVI/NDRE, Element84/AWS), Drohnen-Orthophoto (GeoTIFF, Passpunkte/Gummiband), Zonen aus Index, ein-/ausklappbare Abschnitte. Adresse: `andind.github.io/lohnarbeit-planer/applikationskarte/`. Unabhängig von `karte.html` versioniert; bei Updates `index.html` ersetzen und `CACHE` in `applikationskarte/sw.js` erhöhen (keine IMV-Version nötig). Teilt localStorage-Schlüssel `appkarte.*` (Entwurf, gespeicherte Karten) mit `karte.html`. |

## Bei jedem Update
1. Version erhöhen: `APP_VERSION` + `APP_STAND` in `app.js` **und** `CACHE = 'lohnarbeit-vNN'` in `sw.js`.
2. Commit-Nachricht: `vNN: <Modul> – <Änderung>`.
3. Vor dem Ändern immer `git pull` / neuesten Stand holen (Andreas lädt teils selbst hoch).
4. Im Chat bei jeder Datei die Version dazuschreiben.

## Module (Reiter)
- **Planung** – Maschinen nebeneinander, 24h-Zeitachse, Andocken ohne Überlappung, Mehrfachauswahl, Tagesplan pro Maschine als Bild, mehrtägige Aufträge, Kalenderabo `planung.ics`.
- **Aufträge** – Kunde, Arbeit, Kultur (Oberbegriff, genaue Kultur optional als zweiter Schritt), Feld, Wunschdatum, Fläche, Bemerkungen; Liste mit Filter/Export.
- **Spritzen** – Planung, Spritzprogramme, Journal, Abrechnung, ÖLN-Nachweis, Vorbestellung, Stammdaten (Nachfolger von Access «ErfassungPS»). Genaue Kultur (Winter-/Sommer…) nötig.
- **Rübensamen** – Saisonmodul, ein-/ausschaltbar (`rsOn`).
- **Betrieb** – Eigener Betrieb, ein-/ausschaltbar (`ebOn`); ersetzt Excel «Düngungs- und Anbauplanung»; mit Spritzen über die Fruchtfolge verknüpft.
- **Verwaltung** – Bericht (JD-Arbeitsgänge), Abrechnung (Aufträge + MyJohnDeere), Kunden.
- **Mehr** – Maschinen, Einstellungen, Dropbox, Datensicherung (JSON + Excel), Datenprüfung, Version.

## Festgelegte Entscheidungen
- Kunden und Felder werden in MyJohnDeere gepflegt, im Programm nicht bearbeitbar. Nur Kunden und Felder werden synchronisiert.
- Pflanzenschutz-Parzellen sind separat, mehrere pro Kundenfeld zuweisbar; Parzellen von Spritzen und Eigenem Betrieb sind **eine gemeinsame Liste**.
- Eigene Parzellen = Felder des Kunden «Andreas Indermühle» in MyJohnDeere.
- Kulturen: Aufträge Oberbegriff (Silomais/Körnermais → Mais); Pflanzenschutz und Betrieb genaue Kultur. Fruchtfolge: nur Kulturen aus Betrieb › Stammdaten › Kulturen.
- Kein Modul Fahrer/Personal, keine Pausen-Funktion, keine Spracherfassung.
- Excel-Importe entfernt (v93), ausser Import Spritzprogramme (.json) und – seit v97 wieder – **Preisliste Pflanzenschutzmittel**
  (Spritzen › Stammdaten › Produkte; Produkt, Zulassungsnr., Preis netto ohne LSV-Rabatt, Einheit; gültig ab Datum; einzelne Produkte abwählbar, Abwahl wird gemerkt). Wird jährlich gebraucht – nicht wieder entfernen.
- Pflanzenschutz älter als 3 Jahre (`psAlt`, `PS_ALT_JAHRE`): Datenprüfung übergeht diese Aufträge; Bereinigung «Als Text speichern» löst Verknüpfungen (Parzelle → Feldtext, Produkte nur noch mit Namen).
- Arbeiten Rüben roden / Rüben säen (`RUEBEN_ARBEIT`): Kultur im Auftrag automatisch Zuckerrüben.
- Eigener Betrieb: **keine** Zuordnung von Teilflächen (v97 versucht, in v98 wieder entfernt – zu komplex). Pro Parzelle nur
  Richtung oben/unten (`ro`, `ru` in «parzellen»), angezeigt hinter dem Parzellennamen; Zuordnung rein visuell über die
  Reihenfolge der Hauptkulturen (`pos` am Schlag, ▲▼ im Feld der Fruchtfolge). Feld `teil` = Namenszusatz einer eigenen Parzelle.
- Überschneidungen (`ebOverlaps`): nur mehrjährige Kulturen/Dauerkulturen laufen über mehrere Jahre weiter; einjährige gleiche Kultur
  im Folgejahr = neuer Anbau. Eine laufende mehrjährige Kultur auf einem Teil der Parzelle ist keine Überschneidung, wenn beide Flächen zusammen Platz haben.
- Fruchtfolge: Reihenfolge der Parzellen innerhalb der Gruppe mit ▲▼ direkt in der Fruchtfolge (`ebParzMoveGrp`).
- Fruchtfolge: vergangene Jahre standardmässig gesperrt (`ebLocked`), Freigabe per Knopf gilt bis zum Neustart.
- Auftragserfassung: Auswahl «Arbeit» nur mit Arbeitsarten aktiver Maschinen (`Lists.aktiveArbeiten`).
- Fruchtfolge 2005–2015 als Archiv aus Excel «Fruchtefolgerapport 2005-2018» (Monats-Zeitachse; Herbstsaat → nächstes Erntejahr):
  Jahres-Datensätze `archiv: true`, Schläge `txt: true` = Kultur nur als Text, ohne Verknüpfung zur Kulturliste
  (nicht in Kulturliste übernehmen, keine Überschneidungs-/Dauerkultur-Logik, Datenprüfung übergeht sie). Eingelesen per Mehr › Datensicherung › Wiederherstellen.
- Keine Stecknadeln (📌/📍), Karten-Links, Adressen oder Telefonnummern in Planung, Auftragskarten und Kundenliste (v101).
- Zoom: nie das ganze Fenster. Planung zoomt den Kalender (`App.zoom`), alle anderen Ansichten nur die Daten (oberste Tabellen,
  `.rows`, `.list` über `--vz` in styles.css – keine Filterleisten/Knöpfe; `vzSet`, pro Ansicht/Unterreiter in `lp_vz` gemerkt); Titelleiste −/%/+, Ctrl+Mausrad, Ctrl +/−/0, zwei Finger. Viewport `maximum-scale=1`.
- Vollbild (alle Ansichten): Modulleiste ausgeblendet (`body.fsmode`, gesetzt in `hdrUpdate`).
- Fixierte Spaltenüberschriften: Tabellen in Aufträge (Liste), Verwaltung (Bericht, Abrechnung, Summen) im Rahmen `.dscroll` (Bildschirmhöhe,
  `thead th` sticky); Planung-Kalender/Zeitachsen hatten das schon (`.cal`). Neue grosse Datentabellen ebenfalls in `.dscroll` legen.
  Scrollt die Seite statt des Rahmens, hält `stickyUpd` (setzt `--sty`) die Kopfzeilen direkt unter der Titelleiste (v106, v.a. Wochenansicht).
- Flächen in Bericht und Abrechnung **nie aus Feldgrenzen**. Seit v122 ist die **bedeckte Fläche** (Bedeckungskarte, NAS `haB`) die Standardfläche:
  **Bericht** (`jdbRow`): `ha` = bedeckt (Spalte «ha bedeckt», Summen), `haM` = Maschinenfläche nur zur Information (Spalte «ha Maschine», grau;
  leer, wenn der NAS nur den Ersatzwert aus der Bedeckungskarte hatte). Arbeitsgänge ohne Bedeckung standardmässig ausgeblendet (Filter «Ohne Bedeckung», `J.bed`, `lp_jdbbed`).
  **Abrechnung** (`abRow`): Spalten «ha Planung» (`haG`), «ha effektiv» (`haE`), «ha Bericht» (`haB` = bedeckt), «ha Maschine» (`haJ`, nur Info), «ha Auftrag» (`ha`) =
  **1. effektiv genau (✓), 2. Bericht bedeckt (B), 3. effektiv ohne «genau» (E), 4. Planung (P)** (v123); Markierung **nur** in «ha Auftrag» (`haQ` genau/bed/eff/geplant).
  Einträge «nur JD» ohne Bedeckung standardmässig ausgeblendet (Filter «Bericht ohne Bedeckung», `A.bed`, `lp_abrbed`). Spalten-Einstellungen werden umgestellt
  (`jdbColCfg`: haB→haM). Bericht › Arbeitsgang: Vorschau der virtuellen Feldgrenze (`bedGrz*`) und «In Applikationskarte öffnen» (`karte.html?bedeckung=1`, Übergabe über localStorage `imv.bedeckungGrenze`, Modus «Nur Feldgrenze»).
  **Alle Summen** (Total, Gruppen, Summen pro Kunde/Arbeit, Chips) nutzen «ha Auftrag» (`abHaSum`). `abColCfg` stellt alte Spalten-Einstellungen um. `haAusGrenze` entfernt.
  Spritzen › Abrechnung (`billing`) dagegen: immer die Fläche aus dem Auftrag (`flOf`: effektiv, sonst geplant) – v108 (JD-Fläche/0 ha) in v112 auf Wunsch zurückgenommen.
- Fertigmeldung (`doneDialog`): Feld änderbar (nur Felder des Kunden, Kunde fix; `setKfeld` leert den Feldtext ausser bei Spritzaufträgen mit Parzelle).
  «Fläche effektiv» standardmässig **leer** (nur eintragen, wenn genau bekannt; leer = Fläche aus dem Bericht), geplante Fläche als Hinweis;
  Knopf «📐 Feldgrenzen anzeigen» klappt die Vermessungen des gewählten Feldes auf (nur Info, keine Übernahme). Häkchen «genaue Fläche» (`flaecheGenau`, auch im Auftragsfenster) **bleibt** (v116 wieder eingesetzt): nur Kennzeichnung –
  seit v123 wieder massgebend: genaue effektive Fläche hat Vorrang (✓), effektive ohne «genau» kommt erst nach der bedeckten Fläche (E).
- Applikationskarten: Knopf «🗺 Applikationskarte» im Auftrag (Spritzen/Säen/Düngen oder vorhandene Karte; speichert den Auftrag und wechselt im selben Fenster – wegen iPhone-App-Speicher), Liste unter Mehr › Einstellungen.
- Ausdrucke Kunden: Logo mit Adresse; Ausdrucke Eigener Betrieb: Betriebsadresse statt Logo.
