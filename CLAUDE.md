# IM-Verwalter – Arbeitsnotizen für die Weiterentwicklung

Programm von Andreas Indermühle, «Indermühle Lohnarbeiten · Maschinenvermietung», Schüpfen.
Früher «Lohnarbeit-Planer». Ab 01.11.2026 wird nur noch in **einem** Chat daran gearbeitet
(vorher parallel in «Modul Betrieb» und «Planungstool für Lohnarbeiten» – dabei hat v83 einmal v91 überschrieben).

## Technik
- Reine Web-App (HTML/JS/CSS, keine Fremdbibliotheken), PWA, läuft auf Windows-PC, iPhone, iPad mini, Galaxy Tab Active3.
- Hosting: GitHub Pages aus `andind/lohnarbeit-planer` (Branch `main`).
- Daten: lokal im Browser (`localStorage` `lp_data`) + Abgleich mit Dropbox (`/planung.json` im App-Ordner, OAuth PKCE ohne Server).
- `config.js` enthält den Dropbox App key – bei Updates **nicht überschreiben**.
- NAS-Dienst **jd-sync** (Synology, nicht in diesem Repo): gleicht MyJohnDeere ab und schreibt `jd-sync.json`
  (Kunden, Felder, Vermessungen) und `jd-arbeiten.json` (Arbeitsgänge) in den Dropbox-Ordner;
  Anfrage über `jd-sync-request.json`. Mindestversion im Code: `NAS_MIN = '49'`.

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
- Excel-Importe entfernt (v93), ausser Import Spritzprogramme (.json). Damit ist auch der frühere Preislisten-Import der Pflanzenschutzmittel (Produkt, Zulassungsnr., Preis netto ohne LSV-Rabatt, Mass, Produkte einzeln ausschliessbar) seit v93 nicht mehr im Programm.
- Ausdrucke Kunden: Logo mit Adresse; Ausdrucke Eigener Betrieb: Betriebsadresse statt Logo.
