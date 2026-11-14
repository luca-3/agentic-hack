# Kundenwerk CRM (Demo-Ziel für Lotse)

Statische Demo-CRM-Web-App (HTML/CSS/Vanilla-JS, kein Build, keine Abhängigkeiten, keine Netzwerk-Requests) als Testziel für die Lotse-Extension. Alle Daten sind fiktiv; IBANs sind Testwerte.

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
| `kunde.html?id=…` | Kundendetail mit Tabs Übersicht, Ansprechpartner, Zahlungsdaten, Verlauf (Tab steht im Hash, z. B. `#zahlungsdaten`) |
| `aufgaben.html` | Aufgabenliste, „Neue Aufgabe“ als `<dialog>` (`#neu` öffnet den Dialog direkt) |
| `angebote.html` | Angebotsliste, „Angebot erstellen“ als 3-Schritt-Formular (`#neu`) |
| `einstellungen.html` | Nur Admin. Standard-Zahlungsziel versteckt unter Abrechnung → Erweitert |

## Rollen

Umschalten über **Rolle** in der Kopfzeile (wird in `localStorage` gespeichert):

| Rolle | Darf |
| --- | --- |
| Vertrieb (Standard) | Kunden, Aufgaben, Angebote erstellen. Zahlungsdaten nur lesen. Keine Einstellungen. |
| Buchhaltung | Kunden, Aufgaben, Zahlungsdaten bearbeiten. „Angebot erstellen“ gesperrt. Keine Einstellungen. |
| Admin | Alles inkl. Einstellungen |

Gesperrte Buttons sind `aria-disabled="true"` (klickbar, zeigen dann eine Fehlermeldung „Keine Berechtigung …“), damit Lotse den Klick und den Fehler sieht.

## Daten & Zurücksetzen

- Seed in `data.js`, beim ersten Laden in `localStorage` (`kundenwerk-crm:data:v1`) geschrieben; Änderungen bleiben seitenübergreifend erhalten.
- **Demo-Daten zurücksetzen** (Link unten in der Seitenleiste) stellt den Seed wieder her und setzt die Rolle auf Vertrieb.
- Fälligkeitsdaten sind relativ zum Tag des Seedings (heute, überfällig, morgen …).

## Für Lotse

- `SCENARIOS.md` – 8 Testszenarien inkl. „stuck“-Varianten.
- `lotse-features.json` – Feature-Liste (Route, Klickpfad mit echten Labels, Rollen). `<Kundenname>` / `<Aufgabentitel>` sind Platzhalter für datenabhängige Labels.
- Keine speziellen Lotse-Attribute; alle Bedienelemente sind native `<button>`, `<a>`, `<input>`/`<select>` mit `<label for>` oder `aria-label` (Icon-Buttons: „Navigation einklappen“, „Suchen“, „Hilfe“, „Benachrichtigungen“, „Dialog schließen“, „Aufgabe löschen: …“).
- Globale Suche findet nur Kunden, Aufgaben und Angebote – Begriffe wie „IBAN“ oder „Zahlungsziel“ ergeben „Keine Ergebnisse“ (gewollt für Stuck-Tests).
