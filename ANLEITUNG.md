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
3. Auf der neuen Seite **uploading an existing file** anklicken und **alle Dateien** aus diesem ZIP
   hineinziehen (nicht den übergeordneten Ordner). **Commit changes**.
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

- **Maschinen einrichten** (*Maschinen*, Maschine antippen):
  - **Flächenleistung (ha/h):** daraus berechnet die Planung die Dauer (Fläche ÷ Leistung, auf ¼ h aufgerundet).
  - **Arbeitsarten:** z.B. Säen, Mulchen, Dreschen – antippen oder neue eintippen. Bei der Planung werden
    zuerst die Maschinen vorgeschlagen, die zur Arbeit des Auftrags passen.
  - **Saison:** Monate, in denen die Maschine verfügbar ist. Ausserhalb der Saison erscheint sie weder in der
    Planung noch in der Auswahl.
  - Ansatz (CHF pro Einheit) ergänzen, dann rechnet der Export den Betrag gleich mit.
  Deine 12 Maschinen (Art.-Nr. 101–112) sind mit Einheit und einer ersten Arbeitsart vorerfasst – bitte prüfen
  und Flächenleistung sowie Saison ergänzen.
- **Kunden und Felder aus MyJohnDeere:** (NAS-Dienst einrichten: siehe ANLEITUNG-NAS.md im Paket jd-sync)
  *Kunden › ⟳ Jetzt abgleichen* fordert einen sofortigen Abgleich an; neue Daten übernimmt der Planer beim Öffnen automatisch.
  **Kunden und Felder aus MyJohnDeere:** Kunden (Mandanten) und ihre Felder werden im Operations Center gepflegt und
  mit *Kunden › MyJohnDeere-Abgleich* übernommen (Datei «jd-sync.json» im Dropbox-App-Ordner, später automatisch
  vom NAS-Dienst geschrieben). Beim ersten Abgleich ordnest du jeden Mandanten einem bestehenden Kunden zu
  (z.B. aus ErfassungPS, damit die Auftragshistorie erhalten bleibt) oder legst ihn neu an.
  - Ab dem ersten Abgleich lassen sich **Kunden nicht mehr neu anlegen, umbenennen oder löschen** und **Felder nicht
    bearbeiten** – das geschieht in MyJohnDeere. Im Planer bleiben nur Zusatzangaben bearbeitbar, die MyJohnDeere
    nicht kennt: Kunden-Nr., Adresse/Telefon, Spritzpreise, Zuschlag, Notizen und «Aktiv».
  - Kunden, die bereits aus dem MyJohnDeere-Feld-Export übernommen wurden, ordnet der erste automatische Abgleich
    anhand des Namens zu; Felder und Parzellen-Zuweisungen bleiben erhalten.
  - Im Operations Center archivierte oder gelöschte Felder werden im Planer als «archiviert» ausgeblendet, nie gelöscht.
  - **Feld im Auftrag:** Nach der Kundenwahl lässt sich ein Feld wählen; die Fläche wird übernommen.
  - **Pflanzenschutz-Parzellen** bleiben separat (Spritzen › Stammdaten › Parzellen). Jede Parzelle kann einem Feld
    aus der Kundenkartei zugewiesen werden – mehrere Parzellen pro Feld sind möglich: in der Kundenkarte beim Feld
    «Parzellen zuweisen» oder im Parzellen-Dialog. Wählt man im Spritzauftrag eine zugewiesene Parzelle, wird das Feld
    automatisch gesetzt.
- **Inaktive Kunden:** im Kunden-Dialog auf *inaktiv* setzen – sie verschwinden aus der Kundenliste und der Auswahl
  bei neuen Aufträgen (alte Aufträge und Berichte bleiben erhalten; «auch inaktive» zeigt sie wieder).
- **Auftrag erfassen:** ＋ oben rechts – Kunde, Arbeit (Pflichtfeld), Kultur, Fläche, Wunschdatum, Bemerkungen.
  Kunde, Arbeit und Kultur werden nur aus den bestehenden Listen gewählt – Tippfehler erzeugen so keine
  doppelten Einträge. Einen **neuen Kunden** erfasst du direkt mit dem **＋ neben dem Kundenfeld**; er wird
  danach gleich übernommen. Neue Arbeitsarten und Kulturen legst du unter *Mehr* an.
  Wer gleich einplanen will, klappt **Direkt einplanen** auf (Datum, Maschine; die Dauer wird vorgeschlagen
  und kann überschrieben werden).
- **Planung:** Tages- oder Wochenansicht, die in Saison verfügbaren Maschinen stehen nebeneinander –
  in der Reihenfolge ihrer **Priorität** (unter *Maschinen* mit ▲▼ festlegen, oder Zahl im Maschinen-Dialog).
  Rechts (am iPhone unten) stehen die noch nicht eingeplanten Aufträge mit Wunschdatum und Bemerkung;
  überfällige Wunschdaten sind orange markiert. Die Kultur ist grün hervorgehoben.
  - **Tagesansicht:** senkrechte Zeitachse 0–24 Uhr; jeder Auftrag ist ein Block von Start bis Ende.
  - **Umschalten:** in der Woche auf einen **Wochentag** tippen → Tagesansicht dieses Tages;
    in der Tagesansicht auf die **Zeitskala** (links) tippen → Wochenansicht.
  - **Einfügen:** einen Auftrag auf einen anderen ziehen – obere Hälfte = davor, untere Hälfte = danach
    (in der Woche: auf eine Karte ziehen = davor). Alle folgenden Aufträge rutschen nach hinten.
  - **Langes Drücken auf eine freie Stelle** (am PC: Maustaste halten oder Rechtsklick) öffnet die noch
    nicht eingeplanten Aufträge, gefiltert nach den Arbeitsarten dieser Maschine und sortiert nach Wunschdatum.
    Antippen setzt den Auftrag an dieser Stelle ein. «Alle anzeigen» hebt den Filter auf, «＋ Neuer Auftrag hier»
    erfasst direkt einen neuen Auftrag für diese Maschine und Uhrzeit.
  - **Wochenansicht:** pro Maschine und Tag eine kleine 24-Stunden-Leiste und die Aufträge mit Uhrzeit.
  - **Andocken (Magnet):** Beim Ablegen in der Tagesansicht rastet ein Auftrag ein, wenn er bis 30 Minuten
    neben dem Ende eines anderen Auftrags, dem Arbeitsbeginn oder so liegt, dass er bündig vor dem nächsten endet.
    Ohne feste Startzeit docken Aufträge automatisch ab Arbeitsbeginn aneinander.
  - **Keine Überlappung:** Fällt ein Auftrag in einen anderen, wird er direkt dahinter angedockt; die folgenden
    rutschen nach («⤵ angedockt»). Wird später Platz frei, rücken sie wieder an ihre Wunschzeit.
  - **Mehrere verschieben:** am PC mit **Ctrl- oder Shift-Klick** auswählen und einen davon ziehen – alle bewegen
    sich gemeinsam (Abstände bleiben erhalten). Am iPhone «Mehrere auswählen» tippen, Aufträge antippen.
    Unten erscheint eine Leiste: *Verschieben…* (Datum, Maschine, Startzeit), *◀ 1 Tag / 1 Tag ▶*, *Ausplanen*.
    Esc oder «Aufheben» beendet die Auswahl.
  - **Tagesplan für den Fahrer:** auf den **Maschinennamen** (🖼) klicken/tippen. Es entsteht ein Bild mit allen
    Aufträgen des Tages (Zeit, Kunde, Adresse, Telefon, Arbeit, Kultur, Fläche, Bemerkung).
    Am iPhone «Teilen…» → direkt per WhatsApp, SMS oder Mail senden; am PC «Bild speichern» oder «Kopieren».
  - Der Balken pro Maschine und Tag zeigt die Auslastung gegenüber der Arbeitszeit (*Mehr › Arbeitszeit*); rot = überbucht.
  - Am iPhone: Auftrag antippen › Datum, Startzeit und Maschine wählen (Ziehen geht nur am PC).
  - **Vollbild:** «⛶ Vollbild» zeigt nur den Kalender über den ganzen Bildschirm (✕ oder Esc schliesst).
  - **Zoomen:** mit − / ＋, am iPhone mit zwei Fingern (auseinander/zusammen), am PC mit Ctrl + Mausrad.
    In der Tagesansicht wird die Zeitachse gestreckt, in der Wochenansicht der ganze Kalender.
  - Die Maschinennamen bleiben beim Scrollen oben stehen, die Tage bzw. Uhrzeiten links.
  - Filter: nach Arbeitsart oder «nur belegte Maschinen».
- **Spritzen (eigenes Modul, ersetzt ErfassungPS):** Reiter *Planung · Journal · Abrechnung · ÖLN-Nachweis · Stammdaten*.
  - **Daten übernehmen (einmalig):** *Spritzen › Stammdaten › Import* → Datei **ErfassungPS-Import.json** wählen.
    Übernommen werden Kunden (mit Spritzpreisen und Mittelzuschlag), Parzellen, Produkte (Zulassung, Preis,
    Inventar), Kulturen, Düsen, Traktoren und alle Spritzaufträge seit 2010 (Aufträge bis 2025 als «verrechnet»,
    2026 als «erledigt»). Dazu wird die Maschine «Feldspritze» angelegt (Flächenleistung dort ergänzen).
    Mehrfaches Importieren schadet nicht – Vorhandenes wird nicht überschrieben.
  - **Spritzauftrag erfassen** (＋ Spritzauftrag oder Arbeit «Spritzen»): Parzelle (übernimmt Feld, Kultur und
    Fläche; ＋ für neue Parzelle), Wassermenge, Stadium, Düse, Traktor, Erntejahr (Vorschlag: Winterkulturen ab
    August → nächstes Jahr), Nicht ÖLN-konform, Produkte mit Menge/ha und je Produkt «⚠ÖLN».
  - **Journal:** gegliedert nach Kultur und Parzelle; durchsuchen (Kunde, Parzelle, Kultur, Produkt), Filter Erntejahr.
  - **Abrechnung:** Zeitraum und Kunde wählen (zur Auswahl stehen nur Kunden mit Aufträgen im Zeitraum; ohne Kunde:
    Übersicht aller). Gegliedert nach Kultur und Parzelle. Arbeit = Fläche × (Spritze + Fahrer + Traktor pro ha),
    Mittel = Menge × Preis inkl. Zuschlag – beides auf 5 Rappen gerundet wie in ErfassungPS (im Bericht nicht aufgeführt).
    *Drucken / PDF*, *CSV*, und erledigte Aufträge als «verrechnet» markieren. Preise pro Kunde unter *Kunden*.
    In Abrechnung und Nachweis öffnet ein Antippen der Zeile den Auftrag zum Bearbeiten.
  - **ÖLN-Nachweis:** Erntejahr, Kunde und Kultur (z.B. Zuckerrüben) wählen → Spritzprotokoll mit Datum, Parzelle,
    Kultur, Fläche, Stadium, Produkt, Zulassungs-Nr. und Menge/ha (ohne Hinweise auf nicht ÖLN-konforme Behandlungen).
    Zur Auswahl stehen nur Kunden mit Behandlungen im gewählten Erntejahr.
    *Drucken / PDF* (jeder Kunde auf eigener Seite) oder *CSV*.
  - **Stammdaten:** Produkte (Zulassung, Einheit, Preis, Inventar, aktuell ja/nein; Lagerwert), Parzellen pro Kunde,
    Düsen und Traktoren.
  - **Planung:** Zeitraum wählen → **Produktbedarf** je Produkt (pro Tag und total), dazu Wasser und Fläche –
    als Bild oder CSV. In der Hauptplanung erscheinen Feld und Produkte ohne Mengen; der Tagesplan für den
    Fahrer (Maschinenname antippen) enthält alle Mengen.
- **Arbeitsarten und Kulturen:** unter *Mehr* mit «Bearbeiten» umbenennen, ergänzen, entfernen und mit ▲▼
  sortieren (oder «Alphabetisch sortieren»). In dieser Reihenfolge erscheinen sie in den Auswahllisten.
  Umbenennen ändert auch bestehende Aufträge (und bei Arbeitsarten die Maschinen). Nur hier (und bei den
  Maschinen) können neue Arbeitsarten bzw. Kulturen angelegt werden.
- **Erledigt melden:** Knopf «✓ Erledigt» → effektive Fläche und Stunden eintragen.
- **Abrechnen:** *Mehr › Export* erstellt eine CSV für Excel (Art.-Nr., Fläche, Stunden, Verrechnungsmenge
  in der Einheit der Maschine, Ansatz, Betrag). Optional werden die Aufträge danach als «verrechnet» markiert.

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
