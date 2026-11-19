# jd-sync auf dem Synology-NAS einrichten

**jd-sync** (Version 70, Stand 19.11.2026) ist der Hintergrunddienst aller IM-Programme. Er läuft als Container auf dem
Synology-NAS und erledigt, was kein Browser-Programm selbst kann:

| Aufgabe | Ergebnis in der Dropbox | genutzt von |
|---|---|---|
| Kunden (Mandanten oder Betriebe), Felder, Vermessungen aus MyJohnDeere holen | `jd-sync.json` | IM-Verwaltung, IM-Applikationskarten, IM-Feldbereinigung |
| Geometrie aller Vermessungen (seit v59) | `jd-feldgrenzen.json` | IM-Applikationskarten, IM-Feldbereinigung, IM-Verwaltung (Karte des Feldes) |
| Arbeitsgänge mit Messwerten, bedeckte Fläche ohne Überlappungen, virtuelle Feldgrenzen (seit v53) | `jd-arbeiten.json`, `jd-grenzen.json` | IM-Verwaltung › Bericht und Abrechnung, IM-Feldbereinigung |
| Ertragskarten der ausgewählten Kunden (seit v64) | `/jd-ertrag/` | IM-Applikationskarten |
| Aufträge an MyJohnDeere ausführen (seit v61/v64): Applikationskarten hochladen, Feldgrenzen speichern, Grenzen aktiv/archiviert setzen, Felder anlegen | `/jd-upload/` (Auftrag → Rückmeldung `.status.json`) | IM-Applikationskarten, IM-Feldbereinigung, IM-Verwaltung |
| **Datensicherung aller Programme** + wöchentliche Excel-Dateien + Prüfung der Datenbeziehungen (v69) | `Sicherungen/` | alle |
| Meldungen aufs Handy bei Problemen (Telegram, v70) | – | Andreas |

In MyJohnDeere ändert jd-sync nur, was ausdrücklich als Auftrag aus einem IM-Programm kommt; Kunden und Betriebe legt er nie an,
Felder werden nur neu angelegt, nie archiviert oder gelöscht. Für das Schreiben braucht die John-Deere-App die Freigaben
**Files** und **Boundaries Write** (Scopes `ag3`, `files`) – nach einem Update von einer Version vor v61 **einmal neu bei John Deere anmelden** (Schritt 2).
Klappt das Abholen der Arbeitsdaten einmal nicht, läuft der Abgleich von Kunden und Feldern trotzdem normal.

- Das NAS muss **nicht aus dem Internet erreichbar** sein (keine Portfreigabe, kein DynDNS).
- Das Client Secret von John Deere bleibt auf dem NAS.
- Nach MyJohnDeere wird nur auf ausdrücklichen Auftrag aus einem IM-Programm geschrieben (siehe oben), nie gelöscht.

Zeitaufwand: ca. 20 Minuten.

---

## 1 · John-Deere-App vorbereiten (developer.deere.com)

Du kannst die App verwenden, die du für JD_Arbeitsbericht angelegt hast.

1. <https://developer.deere.com> › *My Applications* › deine App öffnen.
2. **Redirect URI** ergänzen: `http://localhost:9090/callback`
   (steht evtl. schon drin; muss exakt gleich sein wie später in jd-sync).
3. Notiere **Application ID** (Client-ID) und **Secret**.
4. Für die Arbeitsdaten braucht die App zusätzlich die Berechtigung **ag2** (Arbeitsdaten / Field Operations
   lesen). Prüfe unter *API Access*, dass die Schnittstellen **Field Operations** (bzw. «Work Data») aktiviert sind,
   und beantrage sie falls nötig. Ohne ag2 läuft alles andere normal, jd-sync meldet nur bei den Arbeitsdaten einen Hinweis.
5. Die App muss Zugriff auf deine Organisation haben («Connections»). Falls nicht, zeigt dir jd-sync in Schritt 4
   einen Link «Zugriff freigeben».

## 2 · Dateien aufs NAS kopieren

1. Im DSM: **Paket-Zentrum › Container Manager** installieren (falls noch nicht vorhanden).
   Läuft auf den meisten «+»-Modellen mit DSM 7.2. Ohne Container Manager siehe «Variante ohne Container» unten.
2. In der **File Station** den Ordner `docker/jd-sync` anlegen und den Inhalt dieses ZIP hineinkopieren:
   ```
   docker/jd-sync/docker-compose.yml
   docker/jd-sync/app/server.js
   docker/jd-sync/data/            (leerer Ordner)
   ```
3. `docker-compose.yml` öffnen (Rechtsklick › Öffnen mit Texteditor) und bei `UI_PASSWORD` ein eigenes Passwort
   eintragen. Damit ist die Weboberfläche geschützt.

## 3 · Container starten

1. **Container Manager › Projekt › Erstellen**
2. Projektname: `jd-sync`, Pfad: `/docker/jd-sync`, Quelle: *vorhandene docker-compose.yml verwenden*.
3. *Weiter* › *Fertig*. Der Container lädt das Node-Image (einmalig) und startet.
4. Im Browser öffnen: `http://<IP-deines-NAS>:8787` – Benutzername beliebig, Passwort aus Schritt 2.

## 4 · In der Weboberfläche einrichten

1. **John-Deere-App:** Client-ID, Secret, Redirect URI (`http://localhost:9090/callback`), Schnittstelle
   `partnerapi.deere.com` und den **Dropbox App key** (derselbe wie in `config.js` des Planers) eintragen › *Speichern*.
2. **Bei John Deere anmelden ↗** – anmelden und zustimmen. Danach landet der Browser auf
   `http://localhost:9090/callback?code=…` und zeigt evtl. «Seite nicht erreichbar». **Das ist richtig.**
   Die **ganze Adresse aus der Browserzeile kopieren**, in jd-sync einfügen › *Übernehmen*.
3. **Organisation** wählen (bei nur einer wird sie automatisch gewählt). Steht «Zugriff noch nicht freigegeben»,
   den Link öffnen, die Organisation freigeben und *neu laden*.
4. **Bei Dropbox anmelden ↗** – *Zulassen*; Dropbox zeigt einen Code › in jd-sync einfügen › *Übernehmen*.
5. **Jetzt abgleichen** – nach ein paar Sekunden zeigt der Status z.B. «54 Mandanten · 470 Felder».
   Im Protokoll unten steht jeder Schritt.

Ab jetzt läuft der Abgleich automatisch, standardmässig **täglich um 5 Uhr** (Rhythmus einstellbar, siehe unten), und jede Nacht um 00:00 die **Datensicherung**.

### Arbeitsdaten

- Abschnitt **Arbeitsdaten (Vorrat)**: ein/aus und **Ab Datum** (Standard: 1. Januar des Vorjahres).
  Ein früheres Datum holt mehr Historie, der erste Lauf dauert dann etwas länger.
- Täglich werden nur die letzten 14 Tage nachgeführt, alle 7 Tage einmal alles ab dem Startdatum
  (damit auch nachträglich in MyJohnDeere bearbeitete Arbeitsgänge stimmen).
- *Speichern und komplett neu laden* verwirft den Vorrat auf dem NAS und lädt beim nächsten Abgleich alles neu.
- Der Planer zeigt diese Daten im Modul **Bericht** (JD-Arbeitsbericht) mit Filtern, Gruppierung, PDF und Excel-Export.
- Zusätzlich werden – soweit John Deere sie liefert – Maschinen, Fahrer, Produkte und Sorten der Arbeitsgänge abgeholt.
- Inhalt pro Arbeitsgang: Mandant, Feld, Art (`seeding`, `application`, `harvest`, `tillage` …), Saison,
  Beginn/Ende, Messwerte (Fläche, Menge, Ertrag, Produkte …) und die Originaldaten von John Deere.
- **Fläche je Arbeitsgang** (wie JD_Arbeitsbericht 1.14, aber ohne Feldgrenze), mit Angabe der **Flächen-Quelle**:
  1. *Maschine* – Messwert von John Deere (Ergebnis-Messungen bevorzugt; fehlt er in der Übersicht, werden die einzelnen Ergebnis-Messungen abgefragt).
  2. *Bedeckungskarte* – fehlt der Messwert, rechnet jd-sync die Fläche aus der Bedeckungskarte (Punkt-Export: Arbeitsbreite × Distanz je Messpunkt, Überlappungen nur einmal). John Deere erstellt die Karte teils erst auf Anfrage; was nicht innert 10 Minuten bereit ist, folgt beim nächsten Abgleich. Ergebnisse werden auf dem NAS gemerkt.
  Ohne Messwert und ohne Bedeckungskarte bleibt die Fläche leer (die Feldgrenze wird bewusst nicht als Ersatz verwendet).
- **Ablauf:** Zuerst werden die Arbeitsgänge geholt und mit den Flächen aus den Maschinendaten sofort in die Dropbox gelegt (Bericht ist damit schon aktuell). Danach folgen die Bedeckungskarten, höchstens 20 Minuten pro Abgleich; der Rest kommt beim nächsten Abgleich. Während des Laufs zeigt die Seite unter *Arbeitsdaten* «Läuft gerade … x von y». Der erste Lauf nach einem Update holt alle Arbeitsgänge neu und kann bei vielen Feldern über eine halbe Stunde dauern.
- **Maschinennamen** werden aus der Maschinenliste der Organisation übernommen (Seriennummer → Name wie im Operations Center). Dafür braucht es die Berechtigung *eq1*: nach dem Update **einmal neu bei John Deere anmelden** (Schritt 4.2). Ohne neue Anmeldung bleiben die bisherigen Maschinenbezeichnungen.

### Rhythmus des Abgleichs

Abschnitt **Rhythmus Abgleich mit MyJohnDeere**:
- **zu festen Uhrzeiten** – eine oder mehrere, z.B. `05:00, 12:00, 18:00`
- **regelmässig alle … Stunden** – z.B. alle 2 h von 06:00 bis 20:00
- **nur auf Anfrage** – nur wenn im Planer «Jetzt abgleichen» gedrückt wird
- wie oft Anfragen aus dem Planer geprüft werden (Standard 5 Minuten)

### Datensicherung – Sicherungsplan aller IM-Programme (ab Version 69)

Abschnitt **Datensicherung** (Standard: täglich um 00:00). Der NAS-Dienst ist die **eine Stelle**, die alle Daten sichert –
die Programme selbst brauchen dafür nichts zu tun.

| Daten | Datei in der Dropbox | Sicherung NAS (`docker/jd-sync/sicherungen/…`) | Sicherung Dropbox (`Apps/<App>/Sicherungen/…`) | Rhythmus | Aufbewahrung |
|---|---|---|---|---|---|
| IM-Verwaltung | `/planung.json` | `planung_JJJJ-MM-TT_HHMM.json` (Hauptordner) | `Sicherungen/` | täglich | 30 Tage · je Monat 24 Monate · je Jahr 10 Jahre |
| IM-Vermietung | `/vermietung.json` | `vermietung/` | `Sicherungen/Vermietung/` | täglich | wie oben |
| **IM-Faktura** | `/faktura.json` | `faktura/` | `Sicherungen/Faktura/` | täglich | 30 Tage · je Monat 24 Monate · **je Jahr mind. 10 Jahre** (Geschäftsbücher, OR 958f) |
| Eingang IM-Faktura | `/faktura-eingang/*.json` (gesendet, noch nicht übernommen) | `faktura/faktura-eingang_….zip` | `Sicherungen/Faktura/` | täglich, nur wenn etwas wartet | 60 Tage |
| IM-Applikationskarten | `/applikationskarten.json` | `applikationskarten/` | `Sicherungen/Applikationskarten/` | täglich | wie IM-Verwaltung |
| IM-Feldbereinigung | `/feldbereinigung.json` | `feldbereinigung/` | `Sicherungen/Feldbereinigung/` | täglich | 30 Tage · je Monat 24 Monate |
| MyJohnDeere-Daten | `jd-sync.json`, `jd-arbeiten.json`, `jd-grenzen.json`, `jd-feldgrenzen.json` + Zwischenspeicher `data/arbeiten.json`, `bedeckung-grenzen.json`, `grenzen.json`, `ertrag.json` (ohne Zugangsdaten) | `myjohndeere/jd-daten_….zip` | `Sicherungen/MyJohnDeere/` | wöchentlich (Excel-Tag) | 8 Wochen |
| Excel zum Lesen | – | `excel/` | `Sicherungen/Excel/` | wöchentlich | 26 Wochen (IM-Faktura zusätzlich je Jahr 10 Jahre) |

- **Unverändert = nicht doppelt:** hat sich eine Datei seit der letzten Sicherung nicht geändert, wird keine neue Kopie abgelegt (Protokoll «unverändert seit …»). Die neueste Sicherung jeder Datei wird nie gelöscht.
- **Plausibilität:** hat eine Datei plötzlich mindestens 20 % weniger Aufträge, Kunden, Rechnungen, Einsätze usw. als bei der letzten Sicherung, erscheint eine **Warnung** auf der Statusseite und in den Programmen (die älteren Sicherungen bleiben ja erhalten – dann rasch prüfen und ggf. zurückspielen).
- **Excel-Dateien** (wöchentlich, Standard in der Nacht auf Montag): `IM-Verwaltung-Daten_<Datum>.xlsx` (alle Blätter wie «Alles als Excel»), `IM-Vermietung-Daten_<Datum>.xlsx` (Einsätze, Kunden, Maschinen) und neu `IM-Faktura-Daten_<Datum>.xlsx` (Rechnungen mit Total/Bezahlt/Offen/Status, Positionen, Zahlungen, Kunden mit Verknüpfungen, Artikel).
- **Prüfung der Datenbeziehungen** (nach jeder Sicherung, nur lesen): Verknüpfungen zwischen IM-Verwaltung, IM-Vermietung und IM-Faktura (Kunden-Verknüpfungen ins Leere oder doppelt, doppelte Rechnungs- und Artikelnummern, fehlende Vorgabe-Artikel 30/52/100, Übergaben, die gesendet aber nie in IM-Faktura angekommen sind, Übergaben, die seit über 3 Tagen im Eingang warten, alte Entwürfe, Aufträge mit Feld eines anderen Kunden, erledigte Aufträge über 90 Tage unverrechnet, Einsätze ohne Kunde/Maschine). Ergebnis auf der Statusseite und in der IM-Verwaltung unter *Mehr › Datenprüfung*.
- **Status für alle Programme:** der Dienst schreibt `Sicherungen/status.json`; IM-Verwaltung (*Mehr › Datensicherung*), IM-Vermietung und IM-Faktura (*Mehr › Daten*) zeigen daraus die letzte Sicherung jeder Datei. Läuft zwei Tage keine Sicherung, erscheint dort ein orange Hinweis.
- Ein/aus je Programm, Aufbewahrung (Tage, Monate, **Jahre**) und Ordner in den Einstellungen des Abschnitts. *Jetzt sichern* sichert sofort alles (auch unveränderte Dateien), *Excel jetzt erstellen* erstellt alle drei Excel-Dateien.
- **Zurückspielen:** Sicherungsdatei aus `Sicherungen/…` herunterladen und im jeweiligen Programm einlesen – IM-Verwaltung *Mehr › Sicherung einlesen*, IM-Vermietung und IM-Faktura *Mehr › Wiederherstellen…*, IM-Applikationskarten *Laden … › JSON-Datei laden*. IM-Feldbereinigung: Datei in der Dropbox als `/feldbereinigung.json` zurückkopieren. Ein Eingang-ZIP entpacken und die Dateien wieder nach `/faktura-eingang/` legen.
- **Dritte Kopie:** siehe unten «Hyper Backup» – `data/` enthält die Zugangsdaten, die bewusst nicht in die Dropbox gehen.

### Hyper Backup – dritte Kopie auf USB-Festplatte (einmal einrichten, ca. 10 Minuten)

NAS und Dropbox sind zwei Orte; fällt das NAS aus oder wird die Dropbox gelöscht, rettet eine USB-Festplatte den Rest
(auch die Zugangsdaten in `data/`, die nur auf dem NAS liegen).

1. USB-Festplatte (ab 500 GB, am besten eine eigene nur dafür) hinten am DS223j einstecken. In DSM erscheint sie unter
   *Systemsteuerung › Externe Geräte*; bei Bedarf dort formatieren (exFAT oder ext4).
2. *Paketzentrum* › **Hyper Backup** installieren (von Synology, kostenlos) und öffnen.
3. **＋ › Datensicherungsaufgabe** › *Lokaler Ordner und USB* › Weiter › die USB-Festplatte wählen › Ordner `IM-Sicherung`.
4. Ordner auswählen: **`docker/jd-sync`** (enthält `sicherungen`, `data` und `app`). Falls der ETA-Monitor auch auf dem NAS liegt, dessen Ordner unter `docker` mit anhaken.
5. Anwendungen: keine nötig. Weiter.
6. Einstellungen: Name «IM-Programme», **Zeitplan täglich 02:00** (nach der Sicherung um 00:00), *Integritätsprüfung* wöchentlich ein,
   *Clientseitige Verschlüsselung* ein und das Passwort aufschreiben (ohne Passwort ist die Kopie unbrauchbar).
7. Rotation: *Rotation aktivieren* › «Smart Recycle», höchstens **60 Versionen**.
8. *Jetzt sichern* drücken und warten, bis «Erfolgreich» steht.
9. Benachrichtigung: *Systemsteuerung › Benachrichtigung* › E-Mail oder Push (DS-finder-App) einrichten und bei Hyper Backup «Sicherung fehlgeschlagen» anhaken.
10. Zurückholen: Hyper Backup › Aufgabe › *Wiederherstellen › Daten* – einzelne Dateien oder den ganzen Ordner.

Zweimal im Jahr die Festplatte abziehen und z. B. im Wohnhaus statt im Büro lagern (Schutz vor Brand und Diebstahl) – eine zweite Festplatte im Wechsel ist ideal.

### Meldungen aufs Handy (Telegram, ab Version 70)

Abschnitt **Meldungen aufs Handy** auf der Statusseite: Bot-Token und Chat-ID eintragen – den Bot des **ETA-Monitors** kann man weiterverwenden
(Token und Chat-ID aus dessen Einstellungen kopieren). Sonst in Telegram @BotFather › `/newbot` → Token; dem neuen Bot eine Nachricht schicken und
die Chat-ID über @userinfobot herausfinden. *Testnachricht senden* prüft die Verbindung.

Gemeldet wird: fehlgeschlagene oder auffällige Sicherungen (deutlich weniger Einträge), neue Fehler der Prüfung der Datenbeziehungen,
Abgleich mit MyJohnDeere 3× nacheinander fehlgeschlagen (z. B. abgelaufene Anmeldung), fehlgeschlagene Aufträge an MyJohnDeere
(Applikationskarte, Feldgrenze, Feld) – und «wieder alles in Ordnung». Gleich bleibende Probleme höchstens alle 7 Tage als Erinnerung.
Token und Chat-ID bleiben in `data/config.json` auf dem NAS.
- Liegt die Datendatei der IM-Verwaltung nicht unter `/planung.json`, den Pfad bei «Datendatei der IM-Verwaltung» anpassen (wie `dataPath` in `config.js`).

## 5 · Im Planer

- Beim Öffnen übernimmt der Planer eine neue `jd-sync.json` automatisch und meldet kurz, was sich geändert hat.
- **Kunden › ⟳ Jetzt abgleichen** legt eine Anfrage in die Dropbox; jd-sync prüft alle 5 Minuten darauf, gleicht ab,
  und der Planer übernimmt das Ergebnis von selbst (auch unterwegs auf dem iPhone).
- Zuordnung: Mandanten werden über die John-Deere-ID wiedererkannt, beim ersten Mal über den Namen
  (deine bereinigten Kunden und Felder aus dem Excel-Export werden so übernommen, Parzellen-Zuweisungen bleiben).
  Neue Mandanten werden als Kunden angelegt, in MyJohnDeere gelöschte/archivierte als inaktiv bzw. archiviert markiert.
- **Kunden = Mandanten oder Betriebe:** jd-sync erkennt automatisch, ob deine Kunden in MyJohnDeere als Mandanten
  oder als Betriebe unter wenigen Mandanten angelegt sind (Einstellung in Abschnitt 1, «automatisch erkennen»).
  Der Status zeigt den Aufbau, z.B. «2 Mandanten · 54 Betriebe · 486 Felder»; *Diagnose herunterladen* liefert Details.
- Fläche: aus der **aktiven Feldgrenze**. Hat ein Feld keine Grenze, bleibt die bisherige Fläche stehen.
- **Vermessungen (ab Version 46):** jd-sync holt zu jedem Feld *alle* in MyJohnDeere gespeicherten Feldgrenzen
  mit Name, Fläche, bearbeitbarer Fläche, Quelle, Signaltyp (z.B. RTK, SF1), Erstellungs- und Änderungsdatum
  (Erstellungsdatum ab Version 47, Signaltyp ab Version 48). Ab Version 49 auch die nicht aktiven und archivierten
  Vermessungen (vorher lieferte John Deere nur die aktive). Der Planer
  zeigt sie in *Bericht* und *Abrechnung* im Infofenster eines Eintrags und beim Anklicken des Feldes in der Liste. Die Grenzen werden in `data/grenzen.json` zwischengespeichert und pro Feld höchstens alle 3 Tage
  neu abgefragt (der erste Abgleich nach dem Update dauert darum etwas länger).
- *Abgleich prüfen…* zeigt die Zuordnung zur Kontrolle und erlaubt manuelle Korrekturen.

## Wartung

- **Version:** steht oben auf der Seite von jd-sync (z.B. «Version 52 · Datum») und beim Start im Protokoll; die IM-Verwaltung zeigt sie unter *Mehr › Version*.
- **Aktualisieren:** neue `server.js` in `docker/jd-sync/app` kopieren, im Container Manager das Projekt neu starten.
- **Update auf Version 70:** nur `server.js` ersetzen und neu starten; danach im Abschnitt «Meldungen aufs Handy» Telegram eintragen. Alte Excel-Sicherungen «Lohnarbeit-Daten_…»/«IM-Verwalter-Daten_…» werden bei der nächsten Sicherung einmalig in «IM-Verwaltung-Daten_…» umbenannt.
- **Update auf Version 69 (Sicherungsplan):** nur `server.js` ersetzen und neu starten. Danach einmal *Jetzt sichern* drücken – die neuen Ordner (`faktura`, `applikationskarten`, `feldbereinigung`, `myjohndeere`) werden selbst angelegt; der Abschnitt Datensicherung zeigt die Tabelle aller Daten und die erste Prüfung der Datenbeziehungen.
- **Update auf die Version mit Flächen-Quelle (Bedeckungskarte):** der erste Abgleich danach holt einmal alle Arbeitsgänge neu und fragt die Bedeckungskarten ab – das kann einige Minuten dauern. Für die Maschinennamen einmal neu bei John Deere anmelden.
- **Update auf die Version mit Datensicherung:** in `docker-compose.yml` unter `volumes:` die Zeile `- ./sicherungen:/backup` ergänzen (oder die neue Datei übernehmen und das Passwort wieder eintragen), den Ordner `docker/jd-sync/sicherungen` anlegen, dann im Container Manager das Projekt **erstellen/neu starten**. Ohne diese Zeile legt der Dienst die NAS-Sicherungen im Ordner `data/sicherungen` ab.
- **Update von einer Version ohne Arbeitsdaten:** nach dem Aktualisieren **einmal neu bei John Deere anmelden**
  (Schritt 4.2), damit die zusätzliche Berechtigung erteilt wird. Bis dahin zeigt jd-sync einen Hinweis,
  Mandanten und Felder laufen normal weiter.
- **John Deere meldet «Anmeldung abgelaufen»:** in jd-sync erneut «Bei John Deere anmelden» (Schritt 4.2).
- Zugangsdaten liegen in `docker/jd-sync/data` (nur auf dem NAS). Diesen Ordner nicht freigeben.

## Variante ohne Container

Paket-Zentrum › **Node.js v20** installieren. Systemsteuerung › Aufgabenplaner › *Erstellen › Ausgelöste Aufgabe ›
Benutzerdefiniertes Skript*, Ereignis *Hochfahren*, Benutzer *root*:
```
DATA_DIR=/volume1/docker/jd-sync/data UI_PASSWORD=deinPasswort TZ=Europe/Zurich \
  /usr/local/bin/node /volume1/docker/jd-sync/app/server.js >> /volume1/docker/jd-sync/data/jd-sync.log 2>&1 &
```
Einmal manuell ausführen, danach wie oben ab Schritt 4.

## Probleme?

| Meldung im Protokoll | Lösung |
|---|---|
| `invalid_client` | Client-ID oder Secret falsch. |
| `redirect_uri` / `invalid_grant` | Redirect URI in jd-sync und in der John-Deere-App exakt gleich? Code ist nur kurz gültig – Anmeldung wiederholen. |
| `Kein Zugriff (403)` | Organisation für die App freigeben (Link in Schritt 4.3). |
| Flächen fehlen im Bericht | Auf der Seite von jd-sync unter *Arbeitsdaten* stehen die Flächen je Quelle und die letzte Abfrage der Bedeckungskarten mit den Antworten von John Deere. *Diagnose herunterladen* enthält zusätzlich Beispiele von Arbeitsgängen ohne Fläche – diese Datei an Claude schicken. |
| `Arbeitsdaten FEHLER: … neu … anmelden` | Einmal neu bei John Deere anmelden (Schritt 4.2). |
| `Arbeitsdaten FEHLER: Keine Berechtigung … (403)` | In der John-Deere-App die Field-Operations-Schnittstelle (ag2) freischalten, dann neu anmelden. |
| `Dropbox: …` | Dropbox-Anmeldung wiederholen; App key muss derselbe sein wie im Planer. |
| Anderes | Die letzten Zeilen aus dem Protokoll an Claude schicken. |
