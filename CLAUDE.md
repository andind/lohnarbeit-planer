# IM-Verwalter – Arbeitsnotizen für die Weiterentwicklung

Programm von Andreas Indermühle, «Indermühle Lohnarbeiten · Maschinenvermietung», Schüpfen.
Früher «Lohnarbeit-Planer». Ab 01.11.2026 wird nur noch in **einem** Chat daran gearbeitet
(vorher parallel in «Modul Betrieb» und «Planungstool für Lohnarbeiten» – dabei hat v83 einmal v91 überschrieben).

## Technik
- Reine Web-App (HTML/JS/CSS, keine Fremdbibliotheken), PWA, läuft auf Windows-PC, iPhone, iPad mini, Galaxy Tab Active3.
- Hosting: GitHub Pages aus `andind/lohnarbeit-planer` (Branch `main`).
- Daten: lokal im Browser (`localStorage` `lp_data`) + Abgleich mit Dropbox (`/planung.json` im App-Ordner, OAuth PKCE ohne Server).
- `config.js` enthält den Dropbox App key – bei Updates **nicht überschreiben**.
- NAS-Dienst **jd-sync** (Synology, Docker, Node 20) liegt in `nas-dienst/jd-sync/` (seit 01.11.2026, Version 52):
  gleicht MyJohnDeere ab und schreibt `jd-sync.json` (Kunden, Felder, Vermessungen) und `jd-arbeiten.json`
  (Arbeitsgänge) in den Dropbox-Ordner; Anfrage über `jd-sync-request.json`. Mindestversion im IM-Verwalter: `NAS_MIN = '49'`.
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
- Flächen in Bericht und Abrechnung **nie aus Feldgrenzen**: JD-Fläche nur Maschine oder Bedeckungskarte (NAS `setFlaeche`, App `jdbRow`);
  Auftragsfläche gleich Feldfläche/Vermessung (`haAusGrenze`) zählt in der Abrechnung nicht (Spalte «ha Auftrag» durchgestrichen in Klammern).
  Gilt auch für Spritzen › Abrechnung (`billing`): dort Fläche aus MyJohnDeere (`spJdHa`, Zuordnung wie Verwaltung › Abrechnung), sonst 0 ha mit ⚠ (nicht im Ausdruck).
- Ausdrucke Kunden: Logo mit Adresse; Ausdrucke Eigener Betrieb: Betriebsadresse statt Logo.
