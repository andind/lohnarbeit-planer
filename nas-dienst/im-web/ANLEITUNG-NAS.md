# im-web v1.1 – IM-Programme und Daten vom NAS (Plan B ohne GitHub und ohne Dropbox)

Stand 25.11.2026 · v1.1: Datenquelle NAS (Container `im-daten`)

**im-web** legt eine Kopie aller IM-Programme auf dem NAS ab und liefert sie dort aus: IM-Verwaltung, IM-Vermietung,
IM-Faktura, IM-Applikationskarten, IM-Feldbereinigung und die Startseite.

- Alle 15 Minuten wird der neueste Stand von GitHub geholt (`andind/lohnarbeit-planer`).
- Ist GitHub nicht erreichbar, bleibt der letzte Stand auf dem NAS und läuft weiter.
- **Datenquelle NAS (seit v1.1):** Ist die Dropbox nicht erreichbar, können IM-Verwaltung, IM-Vermietung, IM-Faktura und die Startseite
  direkt mit der Cloud-Sync-Kopie auf dem NAS arbeiten (Abschnitt 6). Cloud Sync (bidirektional) bringt die Änderungen danach in die Dropbox.

**Notbetrieb am Arbeits-PC im Heimnetz.** Der PC öffnet die Programme über `http://localhost:8788/…`.
Eine kleine Weiterleitung in Windows schickt diese Adresse ans NAS. Damit braucht es weder Zertifikat noch Reverse Proxy.

| Programm | GitHub (normal) | NAS-Notbetrieb am PC |
|---|---|---|
| Startseite | `https://andind.github.io/lohnarbeit-planer/start/` | `http://localhost:8788/lohnarbeit-planer/start/` |
| IM-Verwaltung | `…/lohnarbeit-planer/` | `…/lohnarbeit-planer/` |
| IM-Vermietung | `…/lohnarbeit-planer/vermietung/` | `…/lohnarbeit-planer/vermietung/` |
| IM-Faktura | `…/lohnarbeit-planer/faktura/` | `…/lohnarbeit-planer/faktura/` |
| IM-Applikationskarten | `…/lohnarbeit-planer/applikationskarte/` | `…/lohnarbeit-planer/applikationskarte/` |
| IM-Feldbereinigung | `…/lohnarbeit-planer/feldbereinigung/` | `…/lohnarbeit-planer/feldbereinigung/` |

**Warum `localhost` und nicht einfach die NAS-IP?** Browser erlauben die Dropbox-Anmeldung (PKCE-Verschlüsselung `crypto.subtle`),
die Offline-Speicherung (Service Worker) und das Installieren als App nur auf «sicheren» Adressen.
Sicher sind `https://…` und `http://localhost`. Über `http://<NAS-IP>:8788` würden die Programme zwar laden, aber die Anmeldung schlägt fehl.
Auch Dropbox nimmt `http://` nur für `localhost` an.

## Inhalt des Ordners

```
docker-compose.yml          drei Container: im-web (Webserver), im-web-update (holt den Stand von GitHub),
                            im-daten (Datenquelle NAS für den Notbetrieb)
nginx.conf                  Einstellungen Webserver
update.sh                   Update-Skript
daten/server.js             Datenquelle NAS (im-daten)
programme/                  (leer – hier legt im-web die Kopie der Programme ab)
im-web-pc-einrichten.cmd    für den Arbeits-PC (nicht aufs NAS kopieren)
```

## 1 · Auf dem NAS einrichten

1. In der **File Station** den Ordner `docker/im-web` anlegen. `docker-compose.yml`, `nginx.conf`, `update.sh`, den Ordner
   `daten` (mit `server.js`) und den leeren Ordner `programme` hineinkopieren.
2. `docker-compose.yml` öffnen (Rechtsklick › Öffnen mit Texteditor) und beim Container `im-daten` zwei Stellen anpassen:
   - `NAS_SCHLUESSEL=` ein eigenes Passwort (mind. 6 Zeichen). Es wird einmal auf der Startseite eingegeben.
   - `/volume1/HIER-PFAD-ZUM-APP-ORDNER` durch den Ordner ersetzen, in dem `planung.json`, `vermietung.json` und `faktura.json` liegen.
     Das ist die Cloud-Sync-Kopie des Dropbox-App-Ordners, meist `<Cloud-Sync-Ordner>/Apps/<Name der Dropbox-App>`.
     So findest du den Pfad: in der File Station zum Ordner mit `planung.json` gehen › Rechtsklick › Eigenschaften › «Speicherort».
     Davor gehört `/volume1` (bzw. das Volume, auf dem der Ordner liegt).
3. **Container Manager › Projekt › Erstellen**
   - Projektname: `im-web`
   - Pfad: `/docker/im-web`
   - Quelle: *vorhandene docker-compose.yml verwenden*
   - *Weiter* › *Fertig*.
   Die Frage nach «Webportal via Web Station» leer lassen.
4. Nach etwa einer Minute im Browser prüfen: `http://<NAS-IP>:8788/nas-stand.json` zeigt den geholten Stand
   (Commit, Datum, `"github":"ok"`), `http://<NAS-IP>:8788/im-daten/status` zeigt `"ordnerOk":true` und `"schluesselGesetzt":true`.

## 2 · Arbeits-PC einrichten (einmalig)

1. `im-web-pc-einrichten.cmd` auf den PC kopieren, Rechtsklick › **Als Administrator ausführen**, NAS-IP eingeben.
   Das Skript richtet die Windows-Weiterleitung `localhost:8788 → NAS:8788` ein (`netsh interface portproxy`).
   Die Weiterleitung bleibt auch nach einem Neustart bestehen.
2. Der Browser öffnet `http://localhost:8788/nas-stand.json`. Erscheint der Stand, funktioniert die Weiterleitung.

Ändert sich die IP des NAS, das Skript nochmals ausführen. Am besten gibst du dem NAS im Router eine feste IP.
Entfernen: `netsh interface portproxy delete v4tov4 listenport=8788 listenaddress=127.0.0.1` (als Administrator).

## 3 · Dropbox: Adressen freigeben (einmalig)

<https://www.dropbox.com/developers/apps> › deine App › **Settings › Redirect URIs**. Diese Adressen hinzufügen
(die GitHub-Adressen bleiben stehen):

```
http://localhost:8788/lohnarbeit-planer/
http://localhost:8788/lohnarbeit-planer/start/
http://localhost:8788/lohnarbeit-planer/vermietung/
http://localhost:8788/lohnarbeit-planer/faktura/
http://localhost:8788/lohnarbeit-planer/applikationskarte/
http://localhost:8788/lohnarbeit-planer/feldbereinigung/
```

## 4 · Einmal testen, solange alles läuft

1. `http://localhost:8788/lohnarbeit-planer/start/` öffnen und bei Dropbox anmelden.
   Die Anmeldung gilt danach für alle IM-Programme unter dieser Adresse.
2. Jedes Programm einmal öffnen.
3. Optional den Notbetrieb kurz ausprobieren (Abschnitt 6): einschalten, ein Programm öffnen, nichts ändern, wieder «Zurück zu Dropbox».

Gut zu wissen:
- **Die localhost-Adresse ist für den Browser ein neues Gerät.** Beim ersten Öffnen holt jedes Programm die Daten aus der Dropbox.
  Anmeldung, Zoom und Filter sind dort getrennt von der GitHub-Adresse gespeichert.
- Im normalen Betrieb weiter die GitHub-Adressen bzw. installierten Apps verwenden. Die localhost-Adresse ist nur für den Notfall.

## 5 · Kontrolle und Wartung

- **Stand der Kopie:** `…/nas-stand.json`. Dort steht `commit`/`commitText` = letzte geholte Version, `geprueft` = letzte Prüfung,
  `github` = ok oder fehler.
- **Protokoll:** Container Manager › Container › `im-web-update` › Protokoll.
- **Hyper Backup:** den Ordner `docker/im-web` mitsichern. Darin liegt die vollständige Kopie der Programme,
  auch wenn GitHub einmal ganz wegfällt.
- **Fällt GitHub dauerhaft weg:** im-web läuft mit dem letzten Stand einfach weiter. Neue Versionen kann man dann direkt in
  `docker/im-web/programme/lohnarbeit-planer` ersetzen (aus dem Gesamtpaket). Den Container `im-web-update` in dem Fall anhalten.
- **im-web selbst aktualisieren:** neue Dateien in `docker/im-web` kopieren (Schlüssel und Datenpfad in `docker-compose.yml` wieder
  eintragen), im Container Manager das Projekt anhalten und neu erstellen.
- **Update von v1.0 auf v1.1:** Ordner `daten` mit `server.js` neu, `docker-compose.yml`, `nginx.conf` und `update.sh` ersetzen,
  Schlüssel und Datenpfad eintragen, Projekt anhalten › Aktion › Erstellen (bzw. neu erstellen).

## 6 · Notbetrieb ohne Dropbox (Datenquelle NAS)

**Wann:** nur wenn die Dropbox nicht erreichbar ist (Störung, Konto gesperrt, Internet weg …).

1. Am Arbeits-PC `http://localhost:8788/lohnarbeit-planer/start/` öffnen.
2. Ganz unten bei **Einstellungen › Notbetrieb: Datenquelle NAS** den Schlüssel eingeben › «Notbetrieb einschalten».
3. Ab jetzt zeigen IM-Verwaltung, IM-Vermietung, IM-Faktura und die Startseite unten einen **roten Balken**
   «Notbetrieb: Daten vom NAS». Sie lesen und speichern direkt im Cloud-Sync-Ordner auf dem NAS.
4. Ist die Dropbox wieder da: ein paar Minuten warten, bis Cloud Sync die Änderungen in die Dropbox übertragen hat
   (Cloud Sync zeigt «Aktuell»), dann im roten Balken oder auf der Startseite **«Zurück zu Dropbox»**.

Wichtig:
- **Während des Notbetriebs nur an diesem PC arbeiten.** Handy, Tablet und andere PCs speichern weiter in die Dropbox.
  Treffen sich beide Fassungen, legt Cloud Sync eine Konfliktkopie an statt zu überschreiben, dann muss man von Hand nachführen.
- Der Notbetrieb gilt nur für die NAS-Adresse auf diesem PC. Die normalen GitHub-Adressen und Apps arbeiten immer mit der Dropbox.
- Nicht dabei: **IM-Applikationskarten und IM-Feldbereinigung** (brauchen MyJohnDeere über jd-sync, das selbst die Dropbox braucht).
  Ebenfalls nicht im Notbetrieb: Kalender-Abo-Link der IM-Verwaltung (Dropbox-Freigabelink).
- Was in den letzten Minuten vor einem Dropbox-Ausfall gespeichert wurde, ist eventuell noch nicht aufs NAS synchronisiert.
- Im Notbetrieb gibt es keine Dropbox-Anmeldung. Wer nie angemeldet war, wird beim Zurückwechseln einmal nach der Dropbox-Anmeldung gefragt.

## Später möglich: Handy und Tablet (HTTPS)

Nur nötig, wenn der Notbetrieb auch auf Handy/Tablet laufen soll. Dafür braucht das NAS einen Namen mit gültigem Zertifikat
(z. B. `<name>.synology.me`) und einen Reverse Proxy im DSM:

1. Systemsteuerung › Anmeldeportal › Erweitert › Reverse Proxy: Quelle HTTPS `<NAS-Name>`:8789, Ziel HTTP localhost:8788.
2. Dem Eintrag das Zertifikat zuweisen.
3. In Dropbox die Redirect-URIs mit `https://<NAS-Name>:8789/lohnarbeit-planer/…` ergänzen.

Belegte Ports auf dem NAS: 8090 ETA Monitor · 8787 jd-sync · **8788 im-web** (· 8789 nur bei HTTPS). im-daten (8790) ist nur intern über im-web erreichbar.
