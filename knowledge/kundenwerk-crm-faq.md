# Kundenwerk CRM: Funktionen, Knöpfe und häufige Fragen

Kundenwerk CRM ist eine Demo-Anwendung zur Kundenverwaltung. Alle Daten darin sind erfunden. Diese Datei beschreibt, welche Funktionen es gibt, welcher Knopf was tut und welche Rolle was darf.

## Navigation

- **Seitenleiste links:** „Dashboard“, „Kunden“, „Aufgaben“, „Angebote“ und – nur für Admins – „Einstellungen“.
- **Einklappen:** Knopf „Navigation einklappen“ oben links (danach „Navigation ausklappen“).
- **Globale Suche** in der Kopfzeile („Kunden, Aufgaben, Angebote suchen …“, Knopf „Suchen“): findet nur Kunden, Aufgaben und Angebote, keine Funktionen oder Einstellungen. Wer „IBAN“ oder „Zahlungsziel“ sucht, bekommt „Keine Ergebnisse“.
- **Kopfzeile rechts:** Auswahl „Rolle“ (Demo-Rollenwechsel), „Hilfe“, Glocke „Benachrichtigungen“, Benutzermenü mit „Mein Profil“, „Tastenkürzel“, „Abmelden“.
- **Tastenkürzel:** „/“ springt in die Suche, Esc schließt Menüs.
- **Unten in der Seitenleiste:** „Demo-Daten zurücksetzen“ stellt alle Daten wieder her und setzt die Rolle auf Vertrieb.

## Rollen und Rechte

- **Vertrieb** (Standard): Kunden ansehen, Aufgaben und Angebote erstellen. Zahlungsdaten nur lesen. Keine Einstellungen.
- **Buchhaltung:** Kunden, Aufgaben und Zahlungsdaten bearbeiten. „Angebot erstellen“ ist gesperrt. Keine Einstellungen.
- **Admin:** alles, einschließlich „Einstellungen“.
- Gesperrte Knöpfe wirken ausgegraut. Ein Klick zeigt „Keine Berechtigung …“ mit der nötigen Rolle.
- Rolle wechseln (nur Demo): Kopfzeile → „Rolle“ → Vertrieb, Buchhaltung oder Admin wählen.

## Dashboard

Startseite mit Kennzahlen und dem, was heute ansteht.

**Inhalt**
- Kennzahlen: „Aktive Kunden“, „Offene Aufgaben“, „Offene Angebote“, „Umsatz (12 Monate)“.
- „Meine Aufgaben heute“, „Letzte Aktivitäten“, „Offene Angebote“.

**So geht's**
- Aufgabe abhaken: unter „Meine Aufgaben heute“ die Checkbox „Erledigt: <Aufgabentitel>“ anklicken.
- Neue Aufgabe: Link „Neue Aufgabe“.

**Knöpfe**
- „Alle Aufgaben anzeigen“ → zur Aufgabenliste.
- „Zu den Angeboten“ → zur Angebotsliste.

## Kunden

Liste aller Kundenfirmen mit Suche und Filtern.

**So geht's**
- Kunden finden: Seitenleiste → „Kunden“ → Feld „Kunden durchsuchen“ (Firma, Ort oder Ansprechpartner).
- Filtern: „Status“ (Aktiv, Inaktiv, Interessent), „Branche“, „Betreuer“.
- Kunden öffnen: in der Liste auf den Firmennamen klicken.

**Knöpfe**
- „Filter zurücksetzen“ → alle Filter leeren.

**Spalten**
- Firma, Ort, Branche, Status, Betreuer, Umsatz (12 Monate).

**Häufige Fragen**
- „Ich finde einen Kunden nicht.“ → Filter prüfen, dann „Filter zurücksetzen“ und erneut suchen.

## Kundendetail

Alles zu einem Kunden, aufgeteilt in vier Tabs: „Übersicht“, „Ansprechpartner“, „Zahlungsdaten“, „Verlauf“.

**Tabs**
- „Übersicht“ → Stammdaten und „Auf einen Blick“ (u. a. offene Aufgaben).
- „Ansprechpartner“ → Name, Position, E-Mail, Telefon.
- „Zahlungsdaten“ → Bankverbindung (Kontoinhaber, IBAN, BIC, Bank) und Zahlungsziel des Kunden.
- „Verlauf“ → Notizen und Änderungen zum Kunden.

**So geht's**
- Bankverbindung ändern (Buchhaltung oder Admin): Kunden → Kunde → Tab „Zahlungsdaten“ → „Bankverbindung bearbeiten“ → „IBAN“ (ggf. „BIC“, „Bank“, „Kontoinhaber“) → „Speichern“.
- Notiz hinzufügen: Tab „Verlauf“ → Feld „Neue Notiz“ → „Notiz speichern“.
- Aufgabe für diesen Kunden: Knopf „Aufgabe anlegen“ oben im Kundendetail; der Kunde ist schon ausgewählt.

**Knöpfe**
- „Zurück zur Kundenliste“ → zurück zu „Kunden“.
- „Abbrechen“ → Bearbeiten ohne Speichern beenden.

## Aufgaben

Aufgaben zu Kunden mit Fälligkeit und Priorität.

**So geht's**
- Aufgabe anlegen: Seitenleiste → „Aufgaben“ → „Neue Aufgabe“ → „Titel“ (Pflicht) → „Kunde“ → „Fällig am“ → „Priorität“ (Hoch, Mittel, Niedrig) → optional „Notiz (optional)“ → „Aufgabe speichern“.
- Erledigt markieren: Checkbox „Erledigt: <Aufgabentitel>“ in der Liste.
- Liste filtern: „Anzeigen“ → „Offene Aufgaben“, „Erledigte Aufgaben“ oder „Alle Aufgaben“.

**Knöpfe**
- „Neue Aufgabe“ → öffnet den Dialog.
- „Aufgabe speichern“ → legt die Aufgabe an.
- „Dialog schließen“ (×) oder „Abbrechen“ → Dialog ohne Speichern schließen.
- Papierkorb „Aufgabe löschen: <Aufgabentitel>“ → Aufgabe löschen.

**Häufige Fragen**
- „Warum lässt sich die Aufgabe nicht speichern?“ → Der Titel fehlt: „Bitte geben Sie einen Titel ein.“

## Angebote

Angebotsliste und ein Formular in drei Schritten.

**So geht's**
- Angebot erstellen (Vertrieb oder Admin): Seitenleiste → „Angebote“ → „Angebot erstellen“ →
  Schritt 1 „Kunde und Titel“: „Kunde“, „Titel“, optional „Ansprechpartner“, „Gültig bis“, „Zahlungsziel“ → „Weiter“ →
  Schritt 2 „Positionen“: „Beschreibung“, „Menge“, „Einzelpreis (€)“, weitere mit „Position hinzufügen“ → „Weiter“ →
  Schritt 3 „Prüfen und speichern“: „Zusammenfassung“ prüfen → „Angebot speichern“. Neue Angebote starten als Entwurf.
- Liste filtern: „Status“ → Entwurf, Versendet, Angenommen, Abgelehnt.

**Knöpfe**
- „Zurück“ → vorheriger Schritt.
- „Position <Nr.> entfernen“ → Position löschen.
- „Abbrechen“ → Formular verlassen.

**Häufige Fragen**
- „Warum kann ich kein Angebot erstellen?“ → Die Rolle Buchhaltung darf das nicht; Vertrieb oder Admin nötig.
- „Weiter geht nicht in Schritt 2.“ → Jede Position braucht Beschreibung, Menge und Einzelpreis.

## Einstellungen

Nur für Admins. Tabs: „Allgemein“, „Abrechnung“, „Benachrichtigungen“, „Benutzer & Rollen“, „Integrationen“.

**Tabs**
- „Allgemein“ → „Firmenname“, „Sprache“, „Zeitzone“; Knopf „Allgemeine Einstellungen speichern“.
- „Abrechnung“ → Steuern („Standard-Steuersatz“), Rechnungsstellung („Rechnungsnummer-Präfix“, „Rechnungsvorlage“), Mahnwesen („Zahlungserinnerung nach (Tagen)“), Skonto; Knopf „Abrechnungseinstellungen speichern“. Zugeklappt unten: „Erweitert“ mit dem Standard-Zahlungsziel.
- „Benachrichtigungen“ → „E-Mail bei fälligen Aufgaben“, „Hinweis, wenn ein Angebot angenommen wurde“, „Wöchentlicher Bericht“; Knopf „Benachrichtigungen speichern“.
- „Benutzer & Rollen“ → Benutzer mit Rolle und die „Rollenrechte“.
- „Integrationen“ → Status der Anbindungen (verbunden / nicht verbunden).

**So geht's**
- Standard-Zahlungsziel ändern: Seitenleiste → „Einstellungen“ → Tab „Abrechnung“ → nach unten scrollen → „Erweitert“ aufklappen → „Standard-Zahlungsziel ändern“ → „Neues Standard-Zahlungsziel (Tage)“ → „Übernehmen“.

## Häufige Fragen

- **„Wie ändere ich die IBAN eines Kunden?“** → Kunden → Kunde öffnen → Tab „Zahlungsdaten“ → „Bankverbindung bearbeiten“ → Feld „IBAN“ → „Speichern“. Nur Buchhaltung oder Admin.
- **„Meine IBAN wird abgelehnt.“** → Eine deutsche IBAN beginnt mit „DE“ und hat 22 Zeichen; bei „Die Prüfziffer stimmt nicht“ ist eine Ziffer vertippt.
- **„Ich kann die Bankverbindung nicht bearbeiten.“** → Die Rolle Vertrieb darf Zahlungsdaten nur lesen; bitte an die Buchhaltung wenden.
- **„Wo stelle ich das Standard-Zahlungsziel ein?“** → Einstellungen → „Abrechnung“ → „Erweitert“ aufklappen → „Standard-Zahlungsziel ändern“ → „Übernehmen“. Nur Admin. Nicht verwechseln mit „Zahlungserinnerung nach (Tagen)“.
- **„Ich sehe keine Einstellungen.“** → Der Menüpunkt erscheint nur für die Rolle Admin.
- **„Wo sehe ich das Zahlungsziel eines Kunden?“** → Kundendetail → Tab „Zahlungsdaten“ (nur Anzeige).
- **„Wie hake ich eine Aufgabe ab?“** → Checkbox „Erledigt: <Aufgabentitel>“ auf dem Dashboard oder in „Aufgaben“.
- **„Wie lege ich eine Rückruf-Aufgabe für einen Kunden an?“** → Am schnellsten im Kundendetail „Aufgabe anlegen“, sonst Aufgaben → „Neue Aufgabe“.
- **„Wie finde ich die Ansprechpartner eines Kunden?“** → Kundendetail → Tab „Ansprechpartner“.
- **„Wie mache ich alles rückgängig?“** → Unten in der Seitenleiste „Demo-Daten zurücksetzen“.
