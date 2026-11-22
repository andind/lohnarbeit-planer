# IM-Programme – Anleitung (Stand 22.11.2026)

Alle Programme liegen in diesem Repository und laufen über GitHub Pages (`https://andind.github.io/lohnarbeit-planer/…`).
Alle nutzen **dieselbe Dropbox-App** (gleicher App key in jeder `config.js`, je Programm eine eigene Redirect-URI).

| Programm | Ordner / Adresse | Version | Daten in der Dropbox | Anleitung |
|---|---|---|---|---|
| **Startseite IM-Programme** (alle Programme mit Kennzahlen, Hinweise, Sicherungsstand) | `start/` | v1.0 | keine eigenen (liest nur) | unten |
| IM-Verwaltung (Planung, Aufträge, Spritzen, Betrieb, Bericht, Abrechnung) | `/` | v162 | `/planung.json` | `3_Dokumentation/IM-Verwaltung_Anleitung.pdf` im Gesamtpaket |
| IM-Faktura (Rechnungen, QR, Buchungen AgroOffice, **Kunden**) | `faktura/` | v1.44 | `/faktura.json` | `faktura/ANLEITUNG.md` |
| IM-Vermietung (Maschinenvermietung) | `vermietung/` | v1.25 | `/vermietung.json` | `vermietung/ANLEITUNG.md` |
| IM-Applikationskarten (Rx-Karten, Feldgrenzen) | `applikationskarte/` | v1.33 | `/applikationskarten.json` | `applikationskarte/ANLEITUNG.txt` |
| IM-Feldbereinigung (Felder/Grenzen im Operations Center aufräumen, nur PC) | `feldbereinigung/` | v1.5 | `/feldbereinigung.json` | `feldbereinigung/ANLEITUNG.txt` |
| NAS-Dienst jd-sync (MyJohnDeere, Aufträge an JD, **Datensicherung aller Programme**) | `nas-dienst/jd-sync/` (auf dem Synology-NAS) | v74 | `jd-*.json`, `Sicherungen/` | `nas-dienst/jd-sync/ANLEITUNG-NAS.md` |

**Datensicherung:** übernimmt der NAS-Dienst für alle Programme (täglich, NAS + Dropbox › Sicherungen, mit Jahressicherungen;
IM-Faktura mindestens 10 Jahre). Jedes Programm zeigt unter *Mehr* den letzten Stand. Details: `ANLEITUNG-NAS.md` › Datensicherung.

**Gemeinsamer Code:** `gemeinsam/im-basis.js` (Meldungen, Rückfragen, Excel, Sicherungsstatus) nutzen IM-Verwaltung, IM-Vermietung und IM-Faktura – bei Updates immer mit hochladen.

**Meldungen aufs Handy:** der NAS-Dienst meldet Probleme über Telegram (Einrichtung in `ANLEITUNG-NAS.md`). **Dritte Kopie:** Hyper Backup auf USB-Festplatte (ebenda).

**Startseite IM-Programme** (`https://andind.github.io/lohnarbeit-planer/start/`): Kacheln für alle Programme mit Version und
Kennzahlen (offene Aufträge, Entwürfe, offene und überfällige Rechnungen, offene Einsätze …), eine Liste offener Punkte aus allen Programmen
(wartende Abrechnungen im Eingang von IM-Faktura, Aufträge an MyJohnDeere, die hängen, alter Abgleich, Fehler der Sicherung und der Prüfung
der Verknüpfungen) und der Sicherungsstand. Sie ändert keine Daten. Jedes Programm bleibt direkt über seine Adresse und als installierte App
erreichbar; das Symbol oben links (bzw. ⌂) in jedem Programm führt zur Startseite. Als App installieren wie die anderen Programme.
Unter *Einstellungen* die Adresse der NAS-Statusseite eintragen (nur im eigenen Netz erreichbar), dann führt die Kachel «NAS-Dienst» dorthin.

**Eine Anmeldung für alle:** Ist ein IM-Programm auf einem Gerät bei Dropbox angemeldet, übernehmen die anderen diese Anmeldung beim Start.
Abmelden gilt für alle Programme auf diesem Gerät. Wer sich direkt auf der Startseite anmelden will, trägt in der Dropbox App Console
(*Settings › OAuth 2 › Redirect URIs*) zusätzlich `https://andind.github.io/lohnarbeit-planer/start/` ein.

**Updates:** Dateien ersetzen, `config.js` nie überschreiben, Version und `CACHE` in `sw.js` des Programms erhöhen.
