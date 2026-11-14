# IM-Verwalter – Arbeitsnotizen für die Weiterentwicklung

Programm von Andreas Indermühle, «Indermühle Lohnarbeiten · Maschinenvermietung», Schüpfen.
Früher «Lohnarbeit-Planer». Ab 01.11.2026 wird nur noch in **einem** Chat daran gearbeitet
(vorher parallel in «Modul Betrieb» und «Planungstool für Lohnarbeiten» – dabei hat v83 einmal v91 überschrieben).

## Technik
- Reine Web-App (HTML/JS/CSS, keine Fremdbibliotheken), PWA, läuft auf Windows-PC, iPhone, iPad mini, Galaxy Tab Active3.
- Hosting: GitHub Pages aus `andind/lohnarbeit-planer` (Branch `main`).
- Daten: lokal im Browser (`localStorage` `lp_data`) + Abgleich mit Dropbox (`/planung.json` im App-Ordner, OAuth PKCE ohne Server).
- `config.js` enthält den Dropbox App key – bei Updates **nicht überschreiben**.
- NAS-Dienst **jd-sync** (Synology, Docker, Node 20) liegt in `nas-dienst/jd-sync/` (seit 01.11.2026, Version 57 – v57: sichert zusätzlich die IM-Vermietung `vermietung.json` täglich + wöchentlich Excel `IM-Vermietung-Daten_…xlsx`, `runVmBackup`/`runVmExcel`/`vmSheets`, cfg `vmAktiv`/`vmDatenPfad`/`vmDbxPfad`):
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
| `applikationskarte/` | **IM-Applikationskarten** (Programmname seit v1.17, 14.11.2026; vorher «Applikationskarte»; Ordner/Adresse bewusst unverändert, damit installierte Apps weiterlaufen) – **eigenständige** Applikationskarte **v1.17** als eigene PWA (Start-Ausschnitt Gemeinde Schüpfen `START_BOUNDS`) (eigenes `manifest.webmanifest`, `sw.js` mit Scope `applikationskarte/`, Cache `appkarte-vX.Y`), ohne Anbindung an den IM-Verwalter; zusätzlich Sentinel-2 (NDVI/NDRE, Element84/AWS), Drohnen-Orthophoto (GeoTIFF, Passpunkte/Gummiband), Zonen aus Index, ein-/ausklappbare Abschnitte, Export für Operations Center oder USB-Stick (ZIP mit Ordner `Rx/` für Data Manager am Terminal). Seit v1.16 Speicherort wählbar (`saveAs` mit `showSaveFilePicker`, Chrome/Edge am PC; sonst Download-Ordner) und USB direkt ohne ZIP (`saveToFolder`, `showDirectoryPicker`, legt `Rx/` an; gewählter Ordner «Rx» wird direkt benutzt). Adresse: `andind.github.io/lohnarbeit-planer/applikationskarte/`. Unabhängig von `karte.html` versioniert; bei Updates `index.html` ersetzen und `CACHE` in `applikationskarte/sw.js` erhöhen (keine IMV-Version nötig). Teilt gespeicherte Karten (`appkarte.projekte`) mit `karte.html`, hat aber seit v1.15 einen **eigenen Entwurf** `appkarte.app.entwurf` (vorher gemeinsam `appkarte.entwurf` → `karte.html?bedeckung=1` stellte die App auf «Nur Feldgrenze», Zonen/Export schienen zu fehlen). Im Modus «Nur Feldgrenze» Hinweis mit Knopf «Zur Applikationskarte wechseln». `aside > *{flex-shrink:0}`: sonst wurde der Modus-Umschalter bei langer Spalte auf 2 px zusammengedrückt (gleiches Risiko in `karte.html`). |
| `vermietung/` | **Eigenständige** App **IM-Vermietung v1.12** (Maschinenvermietung) als eigene PWA, ohne Anbindung an den IM-Verwalter: eigene Daten `/vermietung.json` in Dropbox (gleiche Dropbox-App/`appKey`, eigene Redirect-URI `…/vermietung/`), eigene localStorage-Schlüssel `mv_*` (gleicher Origin wie der IM-Verwalter – nie `lp_*` verwenden). Reiter Einsätze, Import (Online-Formular = Microsoft-Forms-Export, Spalten werden über Überschriften erkannt → direkt Prüfliste, sonst Dialog `formMapDialog`, gemerkt in `cfg.formMap`; Spalte «Abgerechnet» → Status, optional auch vorhandene offene Dubletten (`dupId`) abrechnen; Formular-Excel per Freigabelink verknüpfbar (`cfg.formLink`, nur in vermietung.json, nie ins Repo): «Öffnen» (Excel im Browser synchronisiert die Antworten) und «Abrufen» (`formFetch`: SharePoint `?download=1`, OneDrive `api.onedrive.com/v1.0/shares/u!…/root/content`; anonym gab es beim echten Link **Fehler 401** → seit v1.6 Microsoft-Anmeldung `MS` (PKCE, Tenant `cfg.msTenant` common|consumers|organizations – Andreas' Registrierung ist «nur persönliche Konten» → `consumers`; bei Fehler «userAudience» automatisch umgestellt und neu angemeldet (v1.7), Scope `Files.Read.All`, Client-ID aus Entra-App-Registrierung Typ SPA in `cfg.msClientId`, Tokens lokal `mv_mstok`, Redirect über dieselbe Adresse, unterschieden per `state` mit Präfix `ms`): Graph `/shares/u!…/driveItem` (ohne `$select`, sonst fehlt bei persönlichem OneDrive die downloadUrl – v1.8) → sonst `/drives/{id}/items/{id}` → sonst `/content` → Download; Rückfall Hinweis «Kopie herunterladen»); Rapport-Titel «Rapport Maschinenmiete»; **Bildschirm-Aufteilung** (v1.9): Seite fest (`body` Höhe `--appH` = innerHeight/zoom, overflow hidden), nur `#content`/`.dscroll` scrollen; Zoom per `body.style.zoom` (`Zoom`, Standard 125 % ab 1000 px Breite, sonst 100 %, pro Gerät `mv_zoom`, −/%/+ in der Titelleiste; Druck mit `zoom:1`) – anders als im IM-Verwalter ausdrücklich gewünscht; Einsatzheft-Scan = Ablauf des früheren Windows-Programms ScanListe 3 im Browser (Maschinen vorwählen `mv_scanopt`, je Eintrag eine Zeile pro Maschine, Mulcher h/ha, Mengen-Einheit der Liste, Drehen/Halbieren per Canvas, Werkzeug `eintraege_erfassen` mit `tool_choice`, Aren→ha `convertMenge`, Seitenvorschau nur im Speicher `App.scanPages`); Claude-API direkt aus dem Browser, Schlüssel nur lokal `mv_apikey`), Prüfliste mit Dublettenerkennung (gleicher Kunde/Maschine/Datum/Menge bzw. `orig.sig`) und lernenden Namensvarianten (`aliases` an Kunde/Maschine), Auswertung, Abrechnung (Kundenrapporte eine Seite pro Kunde mit Briefkopf, **ohne Seitenzahlen**; einzelne Einsätze per `ohneRapport` aus Rapport **und** Abrechnungsliste ausschliessbar,  Auswahl auf **Zeilenebene** `App.abr.rows` (anfangs leer; Kunde ankreuzen = alle Zeilen ausser storniert/`ohneRapport`, Kunden-Häkchen halb = teilweise), nur ausgewählte Zeilen in Rapport/Abrechnungsliste; Haken «Stornierte anzeigen» (`f.storno`); Rapport **ohne Adressblock** (v1.4); Eintragszeile anklicken = Details (bearbeiten, Stornieren/✓ Abgerechnet mit Rückfrage) – **keine Status-Knöpfe direkt in der Zeile** (Gefahr versehentlicher Klicks, v1.3); «Ausgewählte Zeilen abgerechnet» (`abrDoneSel`, nur `R`) – «Alle Einsätze der Kunden abgerechnet» in v1.10 **endgültig entfernt**; nach dem Rapport-Druck Rückfrage `abrNachRapport` (rapportierte offene Zeilen als abgerechnet markieren; `printHtml(html, after)`, v1.11); Knopf «▲ Leiste ausblenden» (`App.sub.abrKompakt`, gemerkt) zeigt nur noch «Ausgewählte Zeilen abgerechnet» und die Tabelle; Status `offen|abgerechnet|storniert` (storniert zählt nirgends, nur in der Einsatzliste sichtbar, `applyFilter(…, mitStorno)`); vor jedem Druck/Excel Dialog `prePrint` mit Artikelpreisen nur für diesen Ausdruck (`PRICE_OV`, Stammdaten unverändert); Abrechnungsliste für AgroFaktura; Status offen/abgerechnet), Stammdaten (Kunden mit Kd-Nr., leer = Neukunde; Maschinen Art.-Nr. ab 101 mit Einheit ha/h und Preis). `startdaten.json` = bereinigte Einsätze 2025/26 (155 Einsätze, 52 Kunden, 13 Maschinen; feste IDs, einmalig per `mv_seeded`). Adresse: `andind.github.io/lohnarbeit-planer/vermietung/`. Bei Updates `APP_VERSION`/`APP_STAND` in `vermietung/app.js` und `CACHE` in `vermietung/sw.js` erhöhen, `vermietung/config.js` nicht überschreiben; keine IMV-Version nötig. |

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
  (`jdbColCfg`: haB→haM). Bericht › Arbeitsgang **und Abrechnung › Eintrag** (v125): virtuelle Feldgrenze auf Kartenhintergrund (`bedGrzMap`, ohne Bibliothek: swisstopo-WMTS-Kacheln EPSG:3857 `wmts.geo.admin.ch/1.0.0/{ch.swisstopo.swissimage|ch.swisstopo.pixelkarte-farbe}/default/current/3857/z/x/y.jpeg` + SVG; Luftbild/Landeskarte gemerkt in `lp_bedlayer`, +/− Zoom) und «⬇ Als GeoJSON speichern» (`bedGrzGeo`, für das eigenständige Programm «Applikationskarte» › Feldgrenze laden).
  **Alle Summen** (Total, Gruppen, Summen pro Kunde/Arbeit, Chips, Zwischensumme der angekreuzten Einträge in der Auswahlleiste `abSelBar` seit v126 mit Aufteilung ✓/B/E/P) nutzen «ha Auftrag» (`abHaSum`). `abColCfg` stellt alte Spalten-Einstellungen um. `haAusGrenze` entfernt.
  Spritzen › Abrechnung: Häkchen «nur Kunden mit offenen Aufträgen» (`S.ao`, gemerkt `lp_spao`, `billKunden`, v128) blendet Kunden ohne unverrechnete Aufträge aus (Übersicht, Auswahl, Alle drucken, CSV alle); Übersicht mit Spalte «offen».
  Spritzen › Abrechnung: nach «Drucken / PDF», «Alle drucken» und «CSV» fragt `spBillAsk` (v127), ob die enthaltenen **erledigten** Aufträge auf «verrechnet» gestellt werden (`printHtml(…, { after })`).
  Spritzen › Abrechnung (`billing`) dagegen: immer die Fläche aus dem Auftrag (`flOf`: effektiv, sonst geplant) – v108 (JD-Fläche/0 ha) in v112 auf Wunsch zurückgenommen.
- Fertigmeldung (`doneDialog`): Feld änderbar (nur Felder des Kunden, Kunde fix; `setKfeld` leert den Feldtext ausser bei Spritzaufträgen mit Parzelle).
  «Fläche effektiv» standardmässig **leer** (nur eintragen, wenn genau bekannt; leer = Fläche aus dem Bericht), geplante Fläche als Hinweis;
  Knopf «📐 Feldgrenzen anzeigen» klappt die Vermessungen des gewählten Feldes auf (nur Info, keine Übernahme). Häkchen «genaue Fläche» (`flaecheGenau`, auch im Auftragsfenster) **bleibt** (v116 wieder eingesetzt): nur Kennzeichnung –
  seit v123 wieder massgebend: genaue effektive Fläche hat Vorrang (✓), effektive ohne «genau» kommt erst nach der bedeckten Fläche (E).
- **Keine Applikationskarten/Feldgrenzen-Erstellung im IM-Verwalter** (v124 entfernt, Andreas nutzt das eigenständige Programm). Alte Karten `rx-…` in «einstellungen» bleiben als Daten liegen.
- Ausdrucke Kunden: Logo mit Adresse; Ausdrucke Eigener Betrieb: Betriebsadresse statt Logo.
