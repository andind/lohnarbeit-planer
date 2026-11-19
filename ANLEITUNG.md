# IM-Programme – Anleitung (Stand 19.11.2026)

Alle Programme liegen in diesem Repository und laufen über GitHub Pages (`https://andind.github.io/lohnarbeit-planer/…`).
Alle nutzen **dieselbe Dropbox-App** (gleicher App key in jeder `config.js`, je Programm eine eigene Redirect-URI).

| Programm | Ordner / Adresse | Version | Daten in der Dropbox | Anleitung |
|---|---|---|---|---|
| IM-Verwaltung (Planung, Aufträge, Spritzen, Betrieb, Bericht, Abrechnung) | `/` | v160 | `/planung.json` | `3_Dokumentation/IM-Verwaltung_Anleitung.pdf` im Gesamtpaket |
| IM-Faktura (Rechnungen, QR, Buchungen AgroOffice, **Kunden**) | `faktura/` | v1.35 | `/faktura.json` | `faktura/ANLEITUNG.md` |
| IM-Vermietung (Maschinenvermietung) | `vermietung/` | v1.23 | `/vermietung.json` | `vermietung/ANLEITUNG.md` |
| IM-Applikationskarten (Rx-Karten, Feldgrenzen) | `applikationskarte/` | v1.32 | `/applikationskarten.json` | `applikationskarte/ANLEITUNG.txt` |
| IM-Feldbereinigung (Felder/Grenzen im Operations Center aufräumen, nur PC) | `feldbereinigung/` | v1.4 | `/feldbereinigung.json` | `feldbereinigung/ANLEITUNG.txt` |
| NAS-Dienst jd-sync (MyJohnDeere, Aufträge an JD, **Datensicherung aller Programme**) | `nas-dienst/jd-sync/` (auf dem Synology-NAS) | v69 | `jd-*.json`, `Sicherungen/` | `nas-dienst/jd-sync/ANLEITUNG-NAS.md` |

**Datensicherung:** übernimmt der NAS-Dienst für alle Programme (täglich, NAS + Dropbox › Sicherungen, mit Jahressicherungen;
IM-Faktura mindestens 10 Jahre). Jedes Programm zeigt unter *Mehr* den letzten Stand. Details: `ANLEITUNG-NAS.md` › Datensicherung.

**Updates:** Dateien ersetzen, `config.js` nie überschreiben, Version und `CACHE` in `sw.js` des Programms erhöhen.
