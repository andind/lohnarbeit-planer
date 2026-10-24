# Lohnarbeit-Planer – Einrichtung (Dropbox)

Die App ist eine Web-App, die du auf dem PC und dem iPhone wie eine normale App installierst.
Alle Daten liegen als eine Datei in deiner Dropbox (`Apps/<Name deiner App>/planung.json`) und werden
zwischen den Geräten automatisch abgeglichen. Ohne Netz (z.B. auf dem Feld) arbeitet die App
mit der Kopie auf dem Gerät weiter und gleicht ab, sobald wieder Empfang da ist.

Einmalige Einrichtung: ca. 15–20 Minuten. Du brauchst ein Dropbox-Konto (Gratis-Konto genügt) und ein GitHub-Konto.

---

## Schritt 1 – App ins Internet stellen (GitHub Pages, gratis)

Die App braucht eine https-Adresse, damit iPhone und Dropbox-Anmeldung funktionieren.

1. Auf <https://github.com> ein Konto anlegen (falls noch keines).
2. Oben rechts **＋ › New repository**. Name: `lohnarbeit-planer`, **Public**, dann **Create repository**.
3. Auf der neuen Seite **uploading an existing file** anklicken und **alle Dateien und den Ordner `icons`**
   aus diesem ZIP hineinziehen (nicht den übergeordneten Ordner). **Commit changes**.
4. **Settings › Pages**: bei *Branch* `main` und `/ (root)` wählen, **Save**.
5. Nach 1–2 Minuten ist die App erreichbar unter
   `https://DEIN-GITHUB-NAME.github.io/lohnarbeit-planer/`

Hinweis: Öffentlich ist nur der Programmcode – deine Kunden- und Auftragsdaten liegen ausschliesslich in deiner Dropbox.

Du kannst die App jetzt schon öffnen und ausprobieren (Status oben: «Nur lokal»).

## Schritt 2 – Dropbox-App anlegen

1. <https://www.dropbox.com/developers/apps> öffnen, mit deinem Dropbox-Konto anmelden, **Create app**.
2. Einstellungen:
   - *Choose an API:* **Scoped access**
   - *Choose the type of access:* **App folder** (die App sieht nur ihren eigenen Ordner, nicht deine übrigen Dateien)
   - *Name your app:* z.B. `Lohnarbeit-Planer-DeinName` (der Name muss weltweit eindeutig sein;
     so heisst später auch der Ordner unter *Dropbox › Apps*)
   - **Create app**
3. Reiter **Permissions**: Häkchen bei **files.content.write** und **files.content.read** setzen (files.metadata.read wird automatisch mit aktiviert),
   unten **Submit** klicken. *(Wichtig: vor der ersten Anmeldung erledigen.)*
4. Reiter **Settings**:
   - Bei **OAuth 2 › Redirect URIs** die Adresse aus Schritt 1 **mit Schrägstrich am Ende** eintragen,
     z.B. `https://DEIN-GITHUB-NAME.github.io/lohnarbeit-planer/`, dann **Add**.
     (Die App zeigt die exakte Adresse auch unter **Mehr › Dropbox** an.)
   - **Allow public clients (Implicit Grant & PKCE)** muss auf **Allow** stehen (Standard).
   - Den **App key** kopieren (ca. 15 Zeichen, z.B. `a1b2c3d4e5f6g7h`). Das *App secret* wird **nicht** benötigt.

Der Status «Development» kannst du so lassen – für deine eigenen Geräte ist keine Freigabe durch Dropbox nötig.

## Schritt 3 – App-Key eintragen

1. Im GitHub-Repository die Datei `config.js` öffnen und auf den **Stift** (Edit) klicken.
2. `HIER-APP-KEY-EINTRAGEN` durch den kopierten App key ersetzen.
3. **Commit changes**. Nach ca. 1 Minute ist die Änderung online.

## Schritt 4 – Anmelden

App öffnen › **Mehr › Mit Dropbox anmelden** › **Zulassen**.
Oben steht danach «Dropbox 19:05» (Zeit des letzten Abgleichs).
Auf jedem Gerät **mit derselben Dropbox** anmelden. Die Anmeldung bleibt bestehen, bis du dich abmeldest.

## Schritt 5 – Installieren

- **iPhone:** Adresse in **Safari** öffnen › Teilen-Symbol › **Zum Home-Bildschirm**. Danach über das Symbol starten
  und dort einmal anmelden (die Home-Bildschirm-App hat eine eigene Anmeldung, getrennt von Safari).
- **Windows:** Adresse in **Edge** öffnen › Menü (…) › **Apps › Diese Seite als App installieren**
  (in Chrome: Installieren-Symbol in der Adressleiste). Die App erscheint im Startmenü.

---

## Erste Schritte in der App

- **Maschinen:** deine 12 Maschinen (Art.-Nr. 101–112, mit Einheit h/ha) sind bereits erfasst. Unter *Maschinen*
  kannst du Ansätze (CHF pro Einheit) ergänzen – dann rechnet der Export den Betrag gleich mit.
- **Kunden:** *Kunden › Import (Excel/CSV)* liest z.B. deine `Kunden.xlsx` ein. Erkannt werden Spalten wie
  Nr, Name, Vorname, Adresse/Strasse, PLZ, Ort, Telefon, E-Mail (erste Zeile = Überschriften).
  Kunden mit gleicher Nummer werden aktualisiert statt doppelt angelegt.
- **Fahrer:** unter *Mehr › Fahrer / Personal* erfassen; jede Person bekommt eine Farbe im Plan.
- **Auftrag erfassen:** ＋ oben rechts. Unbekannter Kundenname → Kunde wird automatisch angelegt.
  Mit «📍 Aktuellen Standort übernehmen» speicherst du direkt auf dem Feld die Koordinaten; später führt
  «Navigation» genau dorthin.
- **Einplanen:** im Auftrag «Geplant am» setzen – oder am PC im *Plan* die Karte auf den Tag ziehen.
  Ist eine Maschine am selben Tag schon verplant, erscheint ein ⚠-Hinweis.
- **Erledigt melden:** Knopf «✓ Erledigt» → pro Maschine die effektive Menge (ha bzw. h) eintragen.
- **Abrechnen:** *Mehr › Export* erstellt eine CSV für Excel (eine Zeile pro Maschine mit Art.-Nr., Menge,
  Einheit, Ansatz, Betrag). Optional werden die Aufträge danach als «verrechnet» markiert.

## Gut zu wissen

- **Abgleich:** beim Öffnen, nach jeder Änderung, beim Zurückwechseln in die App und jede Minute.
  Wurde auf zwei Geräten gleichzeitig gearbeitet, werden die Änderungen pro Eintrag zusammengeführt
  (der zuletzt geänderte Stand eines Auftrags gilt).
- **Datei nicht von Hand bearbeiten:** `planung.json` gehört der App. Für Auswertungen den CSV-Export verwenden.
- **Sicherung:** Dropbox behält ältere Versionen der Datei (Gratis-Konto: 30 Tage; Rechtsklick › Versionsverlauf).
  Zusätzlich gibt es unter *Mehr › Datensicherung* einen Export als Datei.
- **Mitarbeiter mit eigenem Gerät:** mit derselben Dropbox anmelden. Abmelden unter *Mehr* entzieht dem Gerät den Zugriff.
- **Gerät verloren:** auf dropbox.com › Einstellungen › Verbundene Apps die App entfernen – dann verlieren alle
  angemeldeten Geräte den Zugriff, und du meldest dich auf den anderen einfach neu an.
- **Updates:** geänderte Dateien einfach erneut ins GitHub-Repository hochladen; die Apps holen sich die neue
  Version beim nächsten Start.

## Probleme?

| Meldung | Ursache / Lösung |
|---|---|
| «Nur lokal» | App key in `config.js` fehlt (Schritt 3). |
| Dropbox: *Invalid redirect_uri* | Redirect URI in der Dropbox-App exakt wie unter *Mehr › Dropbox* angezeigt eintragen (mit `/` am Ende). |
| Sync-Fehler mit *missing_scope* | In der Dropbox-App unter *Permissions* `files.content.read` und `files.content.write` setzen, **Submit**, dann in der App abmelden und neu anmelden. |
| «Sync-Fehler» allgemein | Auf den Status tippen, um erneut zu versuchen. Details unter *Mehr › Dropbox*. |
