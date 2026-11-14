# Lotse-Testszenarien – Kundenwerk CRM

Start: `python3 -m http.server 4000 --directory demo-crm` → http://localhost:4000.
Vor jedem Durchlauf: **Demo-Daten zurücksetzen** (Link unten in der Seitenleiste) und dann die Rolle über **Rolle** in der Kopfzeile setzen.
Labels in „…“ sind die exakten sichtbaren Texte bzw. accessible names.

---

## 1. IBAN ändern (Hauptdemo)

- **Frage:** „Wie ändere ich die IBAN von Müller Logistik?“
- **Rolle:** Buchhaltung (oder Admin)
- **Startseite:** `index.html` (Dashboard)
- **Klickpfad:** Seitenleiste „Kunden“ → Zeile „Müller Logistik GmbH“ → Tab „Zahlungsdaten“ → „Bankverbindung bearbeiten“ → Feld „IBAN“ leeren und `DE02 1203 0000 0000 2020 51` eingeben → „Speichern“
- **Endzustand:** Toast „Bankverbindung für Müller Logistik GmbH gespeichert.“; IBAN in den Zahlungsdaten zeigt `DE02 1203 0000 0000 2020 51`; im Tab „Verlauf“ steht „Änderung: Bankverbindung geändert (neue IBAN endet auf 2051).“ URL: `kunde.html?id=mueller-logistik#zahlungsdaten`.
- **Stuck-Variante:** Nutzer tippt 3× „IBAN“ (bzw. „Bankverbindung“) in die „Globale Suche“ → jedes Mal „Keine Ergebnisse für „IBAN““. Alternativ: öffnet Müller Logistik und wechselt zwischen „Übersicht“ und „Ansprechpartner“ hin und her (Ping-Pong), ohne „Zahlungsdaten“ zu öffnen.

## 2. Ungültige IBAN (Fehler zweimal)

- **Frage:** „Warum kann ich die neue Bankverbindung von Hoffmann Feinkost nicht speichern?“
- **Rolle:** Buchhaltung
- **Startseite:** `kunde.html?id=hoffmann-feinkost#zahlungsdaten`
- **Klickpfad:** „Bankverbindung bearbeiten“ → „IBAN“ = `DE88 6005 0101 0002 3456` (zu kurz) → „Speichern“ → Fehler → korrekte IBAN `DE02 1203 0000 0000 2020 51` → „Speichern“
- **Endzustand:** Nach Korrektur Toast „Bankverbindung für Hoffmann Feinkost GmbH gespeichert.“
- **Stuck-Variante:** Nutzer klickt 2× „Speichern“ mit derselben falschen IBAN → zweimal die Inline-Fehlermeldung „Ungültige IBAN: Eine deutsche IBAN beginnt mit „DE“ und hat 22 Zeichen …“ (bzw. bei Tippfehler in der Prüfziffer: „Ungültige IBAN: Die Prüfziffer stimmt nicht …“). Lotse sollte das Format erklären und auf das Feld „IBAN“ zeigen.

## 3. Aufgabe anlegen (Lotse kann selbst ausführen)

- **Frage:** „Wie lege ich eine Aufgabe für den Rückruf bei Becker Maschinenbau an?“
- **Rolle:** Vertrieb
- **Startseite:** `index.html`
- **Klickpfad:** Seitenleiste „Aufgaben“ → „Neue Aufgabe“ (öffnet Dialog) → „Titel“ = `Rückruf wegen Wartungsvertrag` → „Kunde“ = „Becker Maschinenbau AG“ → „Fällig am“ = morgen → „Priorität“ = „Hoch“ → „Aufgabe speichern“
- **Endzustand:** Dialog geschlossen, neue Zeile in der Aufgabenliste (grün hinterlegt), Toast „Aufgabe „Rückruf wegen Wartungsvertrag“ wurde angelegt.“; Aufgabe erscheint auch im Tab „Übersicht“ von Becker (Offene Aufgaben +1).
- **Stuck-Variante:** Nutzer öffnet `kunde.html?id=becker-maschinenbau`, klickt alle Tabs durch und sucht dort nach „Aufgabe“; oder öffnet den Dialog, klickt „Aufgabe speichern“ ohne Titel → zweimal „Bitte geben Sie einen Titel ein.“. Abkürzung, die Lotse zeigen kann: Button „Aufgabe anlegen“ oben im Kundendetail (öffnet den Dialog mit vorausgewähltem Kunden).

## 4. Standard-Zahlungsziel finden (bewusst versteckt)

- **Frage:** „Wo stelle ich das Standard-Zahlungsziel auf 14 Tage um?“
- **Rolle:** Admin
- **Startseite:** `index.html`
- **Klickpfad:** Seitenleiste „Einstellungen“ → Tab „Abrechnung“ → nach unten scrollen, „Erweitert“ aufklappen → „Standard-Zahlungsziel ändern“ → „Neues Standard-Zahlungsziel (Tage)“ = `14` → „Übernehmen“
- **Endzustand:** Toast „Standard-Zahlungsziel auf 14 Tage netto geändert.“; Text „Aktuell: 14 Tage netto“. Neue Angebote starten mit 14 Tagen im Feld „Zahlungsziel“. URL: `einstellungen.html#abrechnung`.
- **Stuck-Variante:** Nutzer sucht „Zahlungsziel“ in der „Globalen Suche“ (Keine Ergebnisse), wechselt zwischen „Allgemein“ und „Abrechnung“ hin und her, ändert fälschlich „Zahlungserinnerung nach (Tagen)“ oder bleibt > 30 s auf der Abrechnungsseite, ohne „Erweitert“ zu öffnen.

## 5. Angebot erstellen (mehrstufiges Formular)

- **Frage:** „Wie erstelle ich ein Angebot für Fischer Bau?“
- **Rolle:** Vertrieb
- **Startseite:** `angebote.html`
- **Klickpfad:** „Angebot erstellen“ → Schritt 1: „Kunde“ = „Fischer Bau GmbH“, „Titel“ = `Baustellenlogistik Pilot` → „Weiter“ → Schritt 2: „Beschreibung“ = `Einrichtung und Schulung`, „Menge“ = `1`, „Einzelpreis (€)“ = `4800` → „Weiter“ → Schritt 3: prüfen → „Angebot speichern“
- **Endzustand:** Zurück in der Liste, neue Zeile „ANG-2026-045 · Baustellenlogistik Pilot · Fischer Bau GmbH · Entwurf · 4.800,00 €“, Toast „Angebot ANG-2026-045 wurde als Entwurf gespeichert.“
- **Stuck-Variante:** Nutzer pendelt zwischen „Weiter“ und „Zurück“, oder klickt in Schritt 2 zweimal „Weiter“ ohne Einzelpreis → zweimal „Bitte füllen Sie für jede Position Beschreibung, Menge und Einzelpreis aus.“

## 6. Rollen-Blockade: Vertrieb will Zahlungsdaten ändern

- **Frage:** „Wie ändere ich die Bankverbindung von Weber Elektrotechnik?“
- **Rolle:** Vertrieb
- **Startseite:** `kunde.html?id=weber-elektrotechnik`
- **Klickpfad (versucht):** Tab „Zahlungsdaten“ → „Bankverbindung bearbeiten“ (aria-disabled, wirkt ausgegraut)
- **Erwarteter Endzustand:** Klick zeigt die Fehlermeldung „Keine Berechtigung: Zahlungsdaten können nur von den Rollen Buchhaltung oder Admin geändert werden. Ihre Rolle: Vertrieb.“ und einen Fehler-Toast. **Lotse soll keinen Weg vortäuschen**, sondern erklären, dass die Rolle Buchhaltung/Admin nötig ist (z. B. „Bitte wende dich an die Buchhaltung, Sabine Vogt“).
- **Stuck-Variante:** Nutzer klickt 2–3× auf „Bankverbindung bearbeiten“ → dieselbe Fehlermeldung mehrfach; danach sucht er „Bankverbindung“ in der Globalen Suche.

## 7. Rollen-Blockade: Einstellungen nicht sichtbar

- **Frage:** „Wo finde ich die Einstellungen? Ich will das Zahlungsziel ändern.“
- **Rolle:** Vertrieb (oder Buchhaltung)
- **Startseite:** `index.html`
- **Klickpfad:** Keiner – der Menüpunkt „Einstellungen“ fehlt in der Seitenleiste. Direkter Aufruf von `einstellungen.html` zeigt „Zugriff verweigert: Die Einstellungen sind nur für die Rolle Admin verfügbar.“
- **Erwarteter Endzustand:** Lotse erklärt, dass nur Admins das Standard-Zahlungsziel ändern dürfen. Ein kundenspezifisches Zahlungsziel ist im Tab „Zahlungsdaten“ des Kunden nur sichtbar.
- **Stuck-Variante:** Nutzer öffnet das Benutzermenü (Name + Rolle oben rechts), klickt „Hilfe“ (Icon-Button, Toast „nicht verfügbar“), dann Ping-Pong zwischen Dashboard und Kunden.

## 8. Aufgabe erledigen (Kurzfall)

- **Frage:** „Wie hake ich die Aufgabe ‚Angebot nachfassen‘ ab?“
- **Rolle:** beliebig
- **Startseite:** `index.html`
- **Klickpfad:** Unter „Meine Aufgaben heute“ die Checkbox „Erledigt: Angebot nachfassen“ anhaken (alternativ in „Aufgaben“ dieselbe Checkbox).
- **Endzustand:** Toast „Aufgabe „Angebot nachfassen“ als erledigt markiert.“; Aufgabe verschwindet aus „Meine Aufgaben heute“, KPI „Offene Aufgaben“ −1.
- **Stuck-Variante:** Nutzer öffnet „Aufgaben“, filtert unter „Anzeigen“ auf „Erledigte Aufgaben“ und findet die Aufgabe nicht.

---

# Erweiterte Szenarien (mehrstufig, verschachtelt, rollenabhängig)

Rollen jetzt: **Vertrieb**, **Vertriebsleitung**, **Buchhaltung**, **Admin**. Neue Seiten: `konto.html` (Mein Konto), `angebot.html?id=…` (Angebotsdetail), `import-export.html`. Befehlspalette: Strg+K / ⌘K oder Icon-Button „Befehlspalette öffnen“.

## 9. Vertretung für den Urlaub festlegen (tief versteckt, erst nach Schalter sichtbar)

- **Frage:** „Ich bin nächste Woche im Urlaub – wie trage ich Tobias als Vertretung ein?“
- **Rolle:** Vertrieb (beliebig)
- **Startseite:** `index.html`
- **Klickpfad:** „Benutzermenü“ (Name oben rechts) → „Mein Konto“ → Tab „Abwesenheit“ → Schalter „Ich bin abwesend“ einschalten → „Vertretung festlegen“ → „Vertretung von“ = nächster Montag, „Vertretung bis“ = Freitag → „Vertretung durch“ = „Tobias Krüger (Vertrieb)“ → „Vertretung speichern“
- **Endzustand:** Toast „Vertretung durch Tobias Krüger vom … bis … festgelegt.“; Text „Vertretung durch Tobias Krüger vom … bis …“ unter „Vertretung“. URL `konto.html#abwesenheit`.
- **Stuck-Variante:** Nutzer sucht „Vertretung“/„Urlaub“ in der „Globalen Suche“ (Keine Ergebnisse), öffnet „Einstellungen“ bzw. sieht sie nicht, wechselt in „Mein Konto“ zwischen „Profil“ und „Benachrichtigungen“, oder steht auf „Abwesenheit“ und findet „Vertretung festlegen“ nicht, weil der Schalter „Ich bin abwesend“ aus ist. Fehlerfall: Startdatum in der Vergangenheit → „Das Startdatum darf nicht in der Vergangenheit liegen.“ Abkürzung: Befehlspalette → „Abwesenheit & Vertretung einrichten“.

## 10. Angebot freigeben und versenden (rollenübergreifend, deaktivierter Button)

- **Frage (Vertrieb):** „Warum kann ich ANG-2026-044 nicht versenden?“ – **Frage (Vertriebsleitung):** „Wie gebe ich das Angebot für Becker frei?“
- **Rolle:** zuerst Vertrieb, dann Vertriebsleitung
- **Startseite:** `angebote.html`
- **Klickpfad:** „Angebote“ → Link „ANG-2026-044“ (Status „Zur Freigabe“). Als Vertrieb: „Versenden“ ist **deaktiviert** (Tooltip „Versenden ist erst möglich, wenn das Angebot freigegeben wurde.“), „Freigeben“ ist gesperrt (aria-disabled, Tooltip; Klick → „Keine Berechtigung: Angebote können nur von den Rollen Vertriebsleitung oder Admin freigegeben werden. Ihre Rolle: Vertrieb.“). Rolle → „Vertriebsleitung“ → Dashboard-Hinweis „Angebote zur Freigabe öffnen“ → „ANG-2026-044“ → „Freigeben“ → „Versenden“.
- **Endzustand:** Toasts „Angebot ANG-2026-044 wurde freigegeben.“ und „Angebot ANG-2026-044 wurde an Becker Maschinenbau AG versendet.“; Statusleiste steht auf „Versendet“, „Statusverlauf“ zeigt drei Einträge.
- **Stuck-Variante:** Vertrieb klickt 2–3× auf „Freigeben“ (gleiche Fehlermeldung) oder fährt über den deaktivierten „Versenden“-Button. Lotse soll erklären, dass die Vertriebsleitung (Katrin Albers) freigeben muss – nicht einen Umweg erfinden.

## 11. Rabatt auf eine Position – „Speichern“ vs. „Speichern & schließen“

- **Frage:** „Wie gebe ich Becker 10 % Rabatt auf die Wartung und reiche das Angebot dann zur Freigabe ein?“
- **Rolle:** Vertrieb
- **Startseite:** `angebote.html`
- **Klickpfad:** Link „ANG-2026-042“ → Feld „Rabatt (%) Position 1“ = `10` (Summen rechnen sich sofort neu, Hinweis „Ungespeicherte Änderungen“) → „Speichern“ (nicht „Speichern & schließen“) → „Zur Freigabe einreichen“
- **Endzustand:** Toast „Angebot ANG-2026-042 gespeichert.“, „Gesamt (brutto)“ 63.546,00 €, danach Toast „Angebot ANG-2026-042 wurde zur Freigabe eingereicht.“; Positionen sind jetzt schreibgeschützt.
- **Stuck-Variante:** (a) Nutzer klickt direkt „Zur Freigabe einreichen“ ohne zu speichern → Fehler „Bitte speichern Sie zuerst Ihre Änderungen an den Positionen (Button „Speichern“).“ (mehrfach). (b) Nutzer klickt „Speichern & schließen“, landet wieder in der Angebotsliste und sucht dort den Button „Zur Freigabe einreichen“. (c) Nutzer fügt mit „Position hinzufügen“ eine leere Zeile hinzu und speichert → „Position 3: Beschreibung fehlt. / Einzelpreis fehlt.“

## 12. Vertrag kündigen (verschachtelte Dialoge, Kündigungsfrist)

- **Frage:** „Müller Logistik will die Flottenmanagement-Lizenz kündigen – wie geht das und zu wann?“
- **Rolle:** Vertriebsleitung (oder Admin)
- **Startseite:** `kunde.html?id=mueller-logistik`
- **Klickpfad:** Tab „Verträge“ → „Kündigen“ (accessible name „Vertrag kündigen: Flottenmanagement-Lizenz“) → Dialog: Warnhinweis „Achtung: Kündigungsfrist 3 Monate zum Monatsende. Frühestmögliches Vertragsende: …“ → „Kündigungsgrund“ = „Wechsel zu Wettbewerber“ → „Gewünschtes Vertragsende“ (vorbelegt mit frühestem Datum) → „Weiter“ → zweiter Dialog „Kündigung bestätigen“ → „Endgültig kündigen“
- **Endzustand:** Toast „Vertrag „Flottenmanagement-Lizenz“ zum … gekündigt.“; Status „Gekündigt zum …“; Eintrag im Tab „Verlauf“. URL `kunde.html?id=mueller-logistik#vertraege`.
- **Stuck-Variante:** (a) Rolle Vertrieb: Klick auf „Kündigen“ → „Keine Berechtigung: Verträge können nur von den Rollen Vertriebsleitung oder Admin gekündigt werden. Ihre Rolle: Vertrieb.“ (b) Nutzer setzt ein früheres Vertragsende → zweimal „Das gewünschte Vertragsende liegt innerhalb der Kündigungsfrist. Frühestmöglich: …“. (c) Grund „Sonstiges“ ohne „Begründung“ → „Bitte begründen Sie die Kündigung kurz.“ (d) Im Bestätigungsdialog „Zurück“ statt „Endgültig kündigen“ → Ping-Pong zwischen den Dialogen.

## 13. Hauptansprechpartner ändern (nur über Overflow-Menü)

- **Frage:** „Wie mache ich Anke Brandt zur Hauptansprechpartnerin bei Müller Logistik?“
- **Rolle:** beliebig
- **Startseite:** `kunde.html?id=mueller-logistik`
- **Klickpfad:** Tab „Ansprechpartner“ → in der Zeile „Anke Brandt“ das Drei-Punkte-Icon „Weitere Aktionen“ → „Hauptansprechpartner festlegen“
- **Endzustand:** Toast „Anke Brandt ist jetzt Hauptansprechpartner für Müller Logistik GmbH.“; Badge „Hauptansprechpartner“ bei Anke Brandt; „Übersicht“ → „Hauptkontakt“ = Anke Brandt.
- **Stuck-Variante:** Nutzer klickt auf den Namen/die E-Mail in der Tabelle, sucht in „Übersicht“ (dort steht „Hauptkontakt“, aber ohne Bearbeiten-Button) oder öffnet das falsche „Weitere Aktionen“ (alle drei Icon-Buttons heißen gleich – Lotse muss die richtige Zeile treffen).

## 14. Zwei-Faktor-Authentifizierung aktivieren (3-Schritt-Dialog, Abhängigkeit zum Profil)

- **Frage:** „Die IT sagt, ich soll 2FA einschalten – wo geht das?“
- **Rolle:** beliebig
- **Startseite:** `index.html`
- **Klickpfad:** „Benutzermenü“ → „Mein Konto“ → Tab „Sicherheit“ → „Zwei-Faktor aktivieren“ → Schritt 1 „Authenticator-App“ → „Weiter“ → Schritt 2 „Bestätigungscode“ = `123456` → „Weiter“ → Schritt 3 „Ich habe die Wiederherstellungscodes gespeichert“ anhaken → „Aktivieren“
- **Endzustand:** Toast „Zwei-Faktor-Authentifizierung ist jetzt aktiviert.“; Status „Aktiviert (Authenticator-App)“, Button „Zwei-Faktor deaktivieren“.
- **Stuck-Variante:** (a) Nutzer wählt „SMS an Mobilnummer“ → „Für SMS ist eine Mobilnummer erforderlich. Bitte tragen Sie zuerst unter Profil → Mobil eine Nummer ein …“ (Seed hat keine Mobilnummer) – Lotse muss auf Tab „Profil“ → „Mobil“ verweisen oder die App-Methode empfehlen. (b) Falscher Code zweimal → „Der Code ist ungültig …“. (c) In Schritt 3 „Aktivieren“ ohne Häkchen → „Bitte bestätigen Sie, dass Sie die Wiederherstellungscodes gespeichert haben.“

## 15. Profil speichern – Fehler steht nur oben im langen Formular

- **Frage:** „Ich will meine Telefonnummer ändern, aber Speichern macht nichts.“
- **Rolle:** beliebig
- **Startseite:** `konto.html#profil`
- **Klickpfad:** Feld „Telefon“ = `+49 30 555 0188` → nach unten scrollen → „Speichern“
- **Endzustand:** Toast „Profil gespeichert.“
- **Stuck-Variante:** Nutzer tippt `030/555-0188 Durchwahl 2` (Buchstaben) oder leert „Nachname“ und klickt mehrfach „Speichern“ → der Fehlerkasten „Das Profil konnte nicht gespeichert werden (… Fehler): Telefon: Ungültiges Format …“ erscheint **nur oben** (role=alert), das Feld selbst ist nicht markiert und die Seite scrollt nicht. Alternativ klickt der Nutzer „Speichern & schließen“ und wundert sich, dass er auf dem Dashboard landet. Lotse soll auf den Fehlerkasten oben und dann auf das Feld „Telefon“ zeigen.

## 16. Mehrere Aufgaben auf einmal erledigen (deaktivierter Button mit Tooltip, zwei Checkboxen pro Zeile)

- **Frage:** „Wie hake ich ‚Preisliste 2027 senden‘ und ‚Demo-Termin vorbereiten‘ in einem Rutsch ab?“
- **Rolle:** Vertrieb (Zuweisen: Vertriebsleitung)
- **Startseite:** `aufgaben.html`
- **Klickpfad:** Checkbox „Auswählen: Preisliste 2027 senden“ und „Auswählen: Demo-Termin vorbereiten“ (erste Spalte, **nicht** „Erledigt: …“) → „Ausgewählte als erledigt markieren“. Variante Vertriebsleitung: nach Auswahl „Ausgewählte zuweisen an“ = „Sabine Vogt (Buchhaltung)“ → „Zuweisen“.
- **Endzustand:** Toast „2 Aufgaben als erledigt markiert.“, beide verschwinden aus „Offene Aufgaben“; bzw. „2 Aufgaben an Sabine Vogt zugewiesen.“
- **Stuck-Variante:** (a) Nutzer klickt/hovert den deaktivierten Button „Ausgewählte als erledigt markieren“ ohne Auswahl → nichts passiert, Tooltip „Wählen Sie zuerst mindestens eine Aufgabe aus …“. (b) Rolle Vertrieb klickt „Zuweisen“ → „Keine Berechtigung: Aufgaben anderen zuweisen dürfen nur die Rollen Vertriebsleitung oder Admin. Ihre Rolle: Vertrieb.“ (c) Wiederkehrende Aufgabe „Zahlungserinnerung abstimmen“ (monatlich) abhaken → sie „taucht wieder auf“ (nächste Wiederholung wird angelegt) – Nutzer glaubt, das Abhaken habe nicht funktioniert.
