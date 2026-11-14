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
