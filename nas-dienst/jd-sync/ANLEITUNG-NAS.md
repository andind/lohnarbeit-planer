# jd-sync auf dem Synology-NAS einrichten

**jd-sync** liest einmal täglich und auf Anfrage aus dem Planer **nur Mandanten (Kunden) und Felder mit Fläche**
aus MyJohnDeere und legt sie als `jd-sync.json` in den Dropbox-Ordner des IM-Verwalters.
Der Planer übernimmt die Datei beim nächsten Öffnen automatisch.

Zusätzlich holt jd-sync die **Arbeitsdaten** (Arbeitsgänge wie Säen, Spritzen, Ernten, Bodenbearbeitung mit Messwerten)
und legt sie als `jd-arbeiten.json` daneben ab – als Vorrat für später. Der Planer liest diese Datei derzeit nicht.
Klappt das Abholen der Arbeitsdaten einmal nicht, läuft der Abgleich von Mandanten und Feldern trotzdem normal.

- Das NAS muss **nicht aus dem Internet erreichbar** sein (keine Portfreigabe, kein DynDNS).
- Das Client Secret von John Deere bleibt auf dem NAS.
- Es wird nichts nach MyJohnDeere zurückgeschrieben (nur Lesezugriff).

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

### Datensicherung

Abschnitt **Datensicherung** (Standard: täglich um 00:00):
- sichert `planung.json` als `planung_JJJJ-MM-TT_HHMM.json` auf dem NAS (Ordner `docker/jd-sync/sicherungen`) und in der Dropbox (`Apps/<Planer-App>/Sicherungen`)
- behält die letzten 30 Tage und je eine Sicherung pro Monat für 24 Monate (einstellbar), ältere werden gelöscht
- **wöchentlicher Excel-Export** aller Daten als `IM-Verwalter-Daten_<Datum>.xlsx` (gleiche Blätter wie «Alles als Excel» im IM-Verwalter, ab Version 52 auch Vermessungen, Spritzprogramme, Vorbestellung, Rübensamen, Rübensamen Sorten, JD-Abrechnung, Einstellungen und Eigener Betrieb (Parzellen, Kulturen, Fruchtfolge, Düngung, Dünger, Zwischenfrüchte, Bodenproben); ältere Dateien «Lohnarbeit-Daten_…» werden weiterhin aufgeräumt) nach `Apps/<Planer-App>/Sicherungen/Excel`, Standard: in der Nacht auf Montag; 26 Wochen werden behalten
- **IM-Vermietung (ab Version 57):** gleich gesichert wie der IM-Verwalter – `vermietung.json` täglich als `vermietung_JJJJ-MM-TT_HHMM.json` (NAS `docker/jd-sync/sicherungen/vermietung`, Dropbox `Apps/<Planer-App>/Sicherungen/Vermietung`, gleiche Aufbewahrung) und am Excel-Tag zusätzlich `IM-Vermietung-Daten_<Datum>.xlsx` (Einsätze, Kunden, Maschinen) im Excel-Ordner. Ein/aus und Pfade unter «IM-Vermietung mitsichern». Zurückspielen in der IM-Vermietung unter *Mehr › Wiederherstellen…*.
- *Jetzt sichern* und *Excel jetzt erstellen* für sofort (beide inkl. IM-Vermietung)
- **Zurückspielen:** Sicherungsdatei herunterladen, im Planer *Mehr › Sicherung einlesen*
- Liegt die Datendatei nicht unter `/planung.json`, den Pfad bei «Datendatei des Planers» anpassen (wie `dataPath` in `config.js`).

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

- **Version:** steht oben auf der Seite von jd-sync (z.B. «Version 52 · Datum») und beim Start im Protokoll; der IM-Verwalter zeigt sie unter *Mehr › Version*.
- **Aktualisieren:** neue `server.js` in `docker/jd-sync/app` kopieren, im Container Manager das Projekt neu starten.
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
