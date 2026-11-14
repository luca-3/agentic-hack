# Kundenwerk CRM (Demo-Ziel für Valo)

Statische Demo-CRM-Web-App (HTML/CSS/Vanilla-JS, kein Build, keine Abhängigkeiten, keine Netzwerk-Requests) als Testziel für die Valo-Extension. Alle Daten sind fiktiv; IBANs sind Testwerte.

## Starten

```bash
python3 -m http.server 4000 --directory demo-crm   # im Repo-Root
# → http://localhost:4000
```

(http statt `file://`, damit die Extension normal greift.)

## Seiten

| Datei | Inhalt |
| --- | --- |
| `index.html` | Dashboard: Kennzahlen, „Meine Aufgaben heute“, letzte Aktivitäten, offene Angebote |
| `kunden.html` | Kundenliste (15 Firmen) mit Suche und Filtern (Status, Branche, Betreuer) |
| `kunde.html?id=…` | Kundendetail mit Tabs Übersicht, Ansprechpartner, Zahlungsdaten, Verlauf, Verträge, Dokumente (Tab steht im Hash, z. B. `#zahlungsdaten`, `#vertraege`, `#dokumente`). Ansprechpartner: Drei-Punkte-Menü „Weitere Aktionen“ → „Hauptansprechpartner festlegen“. Verträge: „Vertrag kündigen“ mit Grund, Kündigungsfrist-Warnung und zweitem Bestätigungsdialog. Dokumente: „Dokument hochladen“ (nur Dateiname, keine echte Datei) |
| `aufgaben.html` | Aufgabenliste, „Neue Aufgabe“ als `<dialog>` (`#neu` öffnet den Dialog direkt) mit Zuständig, Wiederholung (+ „Wiederholen bis“) und Checkliste. „Details“ je Zeile klappt die Checkliste auf. Filter + „Ansicht speichern“, Sammelaktionen über „Auswählen: …“-Checkboxen |
| `angebote.html` | Angebotsliste (Angebotsnummer verlinkt aufs Detail, `?status=Zur%20Freigabe` filtert vor), „Angebot erstellen“ als 3-Schritt-Formular (`#neu`) |
| `angebot.html?id=…` | Angebotsdetail: Positionen mit Rabatt je Position (Summen live), „Speichern“ vs. „Speichern & schließen“, Status-Workflow Entwurf → Zur Freigabe → Freigegeben → Versendet (→ Angenommen/Abgelehnt), Menü „Aktionen“ mit Untermenü „Exportieren“ („Als PDF exportieren“ simuliert) und „Angebot duplizieren“ |
| `konto.html` | „Mein Konto“ (nur über Benutzermenü oder Befehlspalette): Tabs Profil (lange Form, Fehler nur oben), Sicherheit (Passwort ändern, „Zwei-Faktor aktivieren“ als 3-Schritt-Dialog, Demo-Code `123456`), Benachrichtigungen (gruppierte Schalter, „Erweiterte Optionen“, Felder erst nach Schalter sichtbar), Abwesenheit („Ich bin abwesend“ → „Vertretung festlegen“), Signatur, API-Zugang (nur Admin, „Token erstellen“ mit Bestätigungsdialog) |
| `einstellungen.html` | Nur Admin. Standard-Zahlungsziel versteckt unter Abrechnung → Erweitert |
| `import-export.html` | Buchhaltung + Admin. Export/Import simuliert |

## Navigation

- Seitenleiste mit einklappbarer Gruppe **Verwaltung** (Einstellungen, Benutzer, Import/Export; nur sichtbar, wenn die Rolle mindestens einen Eintrag darf; Zustand in `localStorage`).
- Brotkrumen auf Kundendetail, Angebotsdetail, Mein Konto, Import/Export.
- **Befehlspalette**: Strg+K / ⌘K oder Icon-Button „Befehlspalette öffnen“ – findet Seiten und Aktionen (im Gegensatz zur Globalen Suche).
- Benutzermenü (Button „Benutzermenü“): „Mein Konto“, „Abwesenheit“, „Tastenkürzel“, „Abmelden“.

## Rollen

Umschalten über **Rolle** in der Kopfzeile (wird in `localStorage` gespeichert):

| Rolle | Darf |
| --- | --- |
| Vertrieb (Standard) | Kunden, Aufgaben, Angebote erstellen/bearbeiten/einreichen/versenden. Zahlungsdaten nur lesen. Nicht: Angebote freigeben, Verträge kündigen, Aufgaben gesammelt zuweisen, Einstellungen, Import/Export, API-Token. |
| Vertriebsleitung | Wie Vertrieb, zusätzlich Angebote freigeben/zurückweisen, Verträge kündigen, Aufgaben zuweisen. **Keine** Zahlungsdaten, keine Einstellungen. |
| Buchhaltung | Kunden, Aufgaben, Zahlungsdaten bearbeiten, Import/Export. „Angebot erstellen“ und Angebotsbearbeitung gesperrt. Keine Einstellungen. |
| Admin | Alles inkl. Einstellungen, Benutzer, API-Token |

Gesperrte Buttons sind `aria-disabled="true"` (klickbar, zeigen dann eine Fehlermeldung „Keine Berechtigung …“), damit Valo den Klick und den Fehler sieht. Ausnahmen mit echtem `disabled` + Tooltip (`role="tooltip"`, per `aria-describedby`): „Versenden“ (erst nach Freigabe) und „Ausgewählte als erledigt markieren“ (erst nach Auswahl).

Bewusste Stolperfallen: „Speichern“ vs. „Speichern & schließen“ (Profil, Angebotsdetail), Fehler nur oben im Profil-Formular, Felder erst nach Schalter sichtbar (Tägliche Zusammenfassung, Ruhezeiten, Abwesenheit → Vertretung, Wiederholung → Wiederholen bis, Import → Überschreiben-Warnung), zwei Checkboxen pro Aufgabenzeile („Auswählen: …“ vs. „Erledigt: …“), drei gleichnamige „Weitere Aktionen“-Buttons.

## Daten & Zurücksetzen

- Seed in `data.js`, beim ersten Laden in `localStorage` (`kundenwerk-crm:data:v1`) geschrieben; Änderungen bleiben seitenübergreifend erhalten. Ältere gespeicherte Daten werden beim Laden additiv ergänzt (`schema: 2`: Verträge, Dokumente, Konto-Einstellungen, Angebotspositionen, Unteraufgaben, Benutzerin Katrin Albers/Vertriebsleitung, Angebot ANG-2026-044 „Zur Freigabe“).
- **Demo-Daten zurücksetzen** (Link unten in der Seitenleiste) stellt den Seed wieder her und setzt die Rolle auf Vertrieb.
- Fälligkeitsdaten sind relativ zum Tag des Seedings (heute, überfällig, morgen …).

## Für Valo

- `SCENARIOS.md` – 16 Testszenarien inkl. „stuck“-Varianten (9–16: mehrstufig, verschachtelte Dialoge, Rollen-Blockaden, ähnliche Buttons, versteckt bis Schalter).
- `lotse-features.json` – Feature-Liste (Route, Klickpfad mit echten Labels, Rollen). `<Kundenname>` / `<Aufgabentitel>` / `<Angebotsnummer>` / `<Vertragsname>` / `<Unteraufgabe>` sind Platzhalter für datenabhängige Labels. 39 Features (13 ursprüngliche unverändert + 26 neue).
- Keine speziellen Valo-Attribute; alle Bedienelemente sind native `<button>`, `<a>`, `<input>`/`<select>` mit `<label for>` oder `aria-label` (Icon-Buttons: „Navigation einklappen“, „Suchen“, „Hilfe“, „Benachrichtigungen“, „Dialog schließen“, „Aufgabe löschen: …“, „Befehlspalette öffnen“, „Weitere Aktionen“, „Dokument löschen: …“, „Position n entfernen“).
- Globale Suche findet nur Kunden, Aufgaben und Angebote – Begriffe wie „IBAN“ oder „Zahlungsziel“ ergeben „Keine Ergebnisse“ (gewollt für Stuck-Tests).
