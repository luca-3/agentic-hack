/*
 * Kundenwerk CRM – Demo-Daten und Speicher.
 * Alle Daten sind frei erfunden. IBANs sind Testwerte mit gültiger Prüfsumme.
 * Beim ersten Laden wird der Seed in localStorage geschrieben; Änderungen bleiben
 * seitenübergreifend erhalten, bis "Demo-Daten zurücksetzen" geklickt wird.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "kundenwerk-crm:data:v1";
  var ROLE_KEY = "kundenwerk-crm:role";
  var ROLES = ["Vertrieb", "Buchhaltung", "Admin"];
  var DEFAULT_ROLE = "Vertrieb";

  var CURRENT_USER = {
    name: "Jana Lehmann",
    email: "jana.lehmann@example.com",
    initials: "JL",
  };

  // Wer darf was? (Rollenmodell der Demo)
  var PERMISSIONS = {
    editPayment: ["Buchhaltung", "Admin"],
    createOffer: ["Vertrieb", "Admin"],
    viewSettings: ["Admin"],
  };

  function isoDate(offsetDays) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function isoDateTime(offsetDays, hour, minute) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(hour, minute || 0, 0, 0);
    return d.toISOString();
  }

  function contact(first, last, position, phone) {
    return {
      name: first + " " + last,
      position: position,
      email:
        (first + "." + last)
          .toLowerCase()
          .replace(/ä/g, "ae")
          .replace(/ö/g, "oe")
          .replace(/ü/g, "ue")
          .replace(/ß/g, "ss")
          .replace(/\s+/g, "") + "@example.com",
      phone: phone,
    };
  }

  function seed() {
    var customers = [
      {
        id: "mueller-logistik",
        name: "Müller Logistik GmbH",
        industry: "Logistik",
        city: "Hamburg",
        street: "Am Hafenrand 12",
        zip: "20457",
        status: "Aktiv",
        owner: "Jana Lehmann",
        revenue: 184500,
        customerSince: "2019-03-01",
        contacts: [
          contact("Thomas", "Müller", "Geschäftsführer", "+49 40 555 0101"),
          contact("Anke", "Brandt", "Leitung Einkauf", "+49 40 555 0102"),
          contact("Kevin", "Ohlsen", "Disposition", "+49 40 555 0103"),
        ],
        payment: {
          holder: "Müller Logistik GmbH",
          iban: "DE89370400440532013000",
          bic: "COBADEFFXXX",
          bank: "Commerzbank Testfiliale",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [
          { date: isoDate(-2), type: "Anruf", text: "Rückfrage zur Rechnung 2026-0412, geklärt.", author: "Jana Lehmann" },
          { date: isoDate(-9), type: "E-Mail", text: "Angebot ANG-2026-041 versendet.", author: "Jana Lehmann" },
          { date: isoDate(-40), type: "Termin", text: "Jahresgespräch vor Ort in Hamburg.", author: "Tobias Krüger" },
        ],
      },
      {
        id: "becker-maschinenbau",
        name: "Becker Maschinenbau AG",
        industry: "Maschinenbau",
        city: "Stuttgart",
        street: "Industriestraße 88",
        zip: "70565",
        status: "Aktiv",
        owner: "Tobias Krüger",
        revenue: 312000,
        customerSince: "2017-06-15",
        contacts: [
          contact("Petra", "Becker", "Vorstand Technik", "+49 711 555 0201"),
          contact("Jürgen", "Haas", "Instandhaltung", "+49 711 555 0202"),
        ],
        payment: {
          holder: "Becker Maschinenbau AG",
          iban: "DE12500105170648489890",
          bic: "INGDDEFFXXX",
          bank: "Testbank Frankfurt",
          paymentTermDays: 45,
          method: "Überweisung",
        },
        history: [
          { date: isoDate(-1), type: "Anruf", text: "Interesse an erweitertem Wartungsvertrag.", author: "Tobias Krüger" },
          { date: isoDate(-21), type: "Notiz", text: "Budgetfreigabe erst im neuen Quartal.", author: "Tobias Krüger" },
        ],
      },
      {
        id: "schneider-partner",
        name: "Schneider & Partner Steuerberatung",
        industry: "Beratung",
        city: "München",
        street: "Leopoldstraße 21",
        zip: "80802",
        status: "Aktiv",
        owner: "Jana Lehmann",
        revenue: 48200,
        customerSince: "2021-01-10",
        contacts: [contact("Claudia", "Schneider", "Partnerin", "+49 89 555 0301")],
        payment: {
          holder: "Schneider & Partner mbB",
          iban: "DE97200411110123456700",
          bic: "COBADEHD001",
          bank: "Testbank Hamburg",
          paymentTermDays: 14,
          method: "Lastschrift",
        },
        history: [{ date: isoDate(-5), type: "E-Mail", text: "Bitte um aktualisierte Preisliste.", author: "Jana Lehmann" }],
      },
      {
        id: "fischer-bau",
        name: "Fischer Bau GmbH",
        industry: "Bau",
        city: "Köln",
        street: "Rheinuferweg 3",
        zip: "50668",
        status: "Interessent",
        owner: "Jana Lehmann",
        revenue: 0,
        customerSince: "2026-09-02",
        contacts: [
          contact("Markus", "Fischer", "Geschäftsführer", "+49 221 555 0401"),
          contact("Sandra", "Yilmaz", "Projektleitung", "+49 221 555 0402"),
        ],
        payment: {
          holder: "Fischer Bau GmbH",
          iban: "DE57700202700015505050",
          bic: "HYVEDEMMXXX",
          bank: "Testbank München",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-3), type: "Termin", text: "Erstgespräch: Bedarf an Baustellenlogistik-Software.", author: "Jana Lehmann" }],
      },
      {
        id: "weber-elektrotechnik",
        name: "Weber Elektrotechnik KG",
        industry: "Elektrotechnik",
        city: "Nürnberg",
        street: "Siemensring 40",
        zip: "90431",
        status: "Aktiv",
        owner: "Sabine Vogt",
        revenue: 97300,
        customerSince: "2018-11-20",
        contacts: [
          contact("Stefan", "Weber", "Inhaber", "+49 911 555 0501"),
          contact("Lea", "Graf", "Buchhaltung", "+49 911 555 0502"),
        ],
        payment: {
          holder: "Weber Elektrotechnik KG",
          iban: "DE16100500000611223344",
          bic: "BELADEBEXXX",
          bank: "Testbank Berlin",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-6), type: "E-Mail", text: "Neue Bankverbindung angekündigt – Formular folgt.", author: "Sabine Vogt" }],
      },
      {
        id: "hoffmann-feinkost",
        name: "Hoffmann Feinkost GmbH",
        industry: "Lebensmittel",
        city: "Frankfurt am Main",
        street: "Kleinmarkthalle 7",
        zip: "60311",
        status: "Aktiv",
        owner: "Tobias Krüger",
        revenue: 26400,
        customerSince: "2022-04-04",
        contacts: [contact("Ingrid", "Hoffmann", "Geschäftsführerin", "+49 69 555 0601")],
        payment: {
          holder: "Hoffmann Feinkost GmbH",
          iban: "DE88600501010002345678",
          bic: "SOLADEST600",
          bank: "Testsparkasse Stuttgart",
          paymentTermDays: 14,
          method: "Lastschrift",
        },
        history: [{ date: isoDate(-15), type: "Notiz", text: "Saisonale Bestellspitzen im Dezember beachten.", author: "Tobias Krüger" }],
      },
      {
        id: "schulz-medizintechnik",
        name: "Schulz Medizintechnik GmbH",
        industry: "Medizintechnik",
        city: "Berlin",
        street: "Charitéplatz 9",
        zip: "10117",
        status: "Aktiv",
        owner: "Sabine Vogt",
        revenue: 221800,
        customerSince: "2016-02-12",
        contacts: [
          contact("Dr. Frank", "Schulz", "Geschäftsführer", "+49 30 555 0701"),
          contact("Mira", "Kaya", "Qualitätsmanagement", "+49 30 555 0702"),
        ],
        payment: {
          holder: "Schulz Medizintechnik GmbH",
          iban: "DE20250501800098765432",
          bic: "SPKHDE2HXXX",
          bank: "Testsparkasse Hannover",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-4), type: "Anruf", text: "Audit-Unterlagen angefragt.", author: "Sabine Vogt" }],
      },
      {
        id: "wagner-energie",
        name: "Wagner Energie AG",
        industry: "Energie",
        city: "Hannover",
        street: "Windparkallee 1",
        zip: "30159",
        status: "Interessent",
        owner: "Tobias Krüger",
        revenue: 0,
        customerSince: "2026-10-01",
        contacts: [contact("Holger", "Wagner", "Leitung IT", "+49 511 555 0801")],
        payment: {
          holder: "Wagner Energie AG",
          iban: "DE48430609674011223300",
          bic: "GENODEM1GLS",
          bank: "Testbank Bochum",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-8), type: "E-Mail", text: "Demo-Termin vereinbart.", author: "Tobias Krüger" }],
      },
      {
        id: "koch-druck",
        name: "Koch Druck & Medien GmbH",
        industry: "Medien",
        city: "Leipzig",
        street: "Buchgasse 15",
        zip: "04109",
        status: "Inaktiv",
        owner: "Jana Lehmann",
        revenue: 5200,
        customerSince: "2015-08-08",
        contacts: [contact("Rainer", "Koch", "Inhaber", "+49 341 555 0901")],
        payment: {
          holder: "Koch Druck & Medien GmbH",
          iban: "DE12300209000700800900",
          bic: "CMCIDEDDXXX",
          bank: "Testbank Düsseldorf",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-120), type: "Notiz", text: "Vertrag ausgelaufen, kein Interesse an Verlängerung.", author: "Jana Lehmann" }],
      },
      {
        id: "bauer-agrar",
        name: "Bauer Agrar eG",
        industry: "Landwirtschaft",
        city: "Münster",
        street: "Feldweg 22",
        zip: "48149",
        status: "Aktiv",
        owner: "Sabine Vogt",
        revenue: 63900,
        customerSince: "2020-05-18",
        contacts: [
          contact("Heinrich", "Bauer", "Vorstand", "+49 251 555 1001"),
          contact("Julia", "Kämper", "Verwaltung", "+49 251 555 1002"),
        ],
        payment: {
          holder: "Bauer Agrar eG",
          iban: "DE64120300000000202099",
          bic: "BYLADEM1001",
          bank: "Testbank Berlin-Mitte",
          paymentTermDays: 45,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-12), type: "Termin", text: "Schulung für neue Mitarbeitende durchgeführt.", author: "Sabine Vogt" }],
      },
      {
        id: "richter-it",
        name: "Richter IT-Services GmbH",
        industry: "IT",
        city: "Dresden",
        street: "Elbchaussee 5",
        zip: "01067",
        status: "Aktiv",
        owner: "Jana Lehmann",
        revenue: 138700,
        customerSince: "2019-09-30",
        contacts: [
          contact("Nina", "Richter", "CTO", "+49 351 555 1101"),
          contact("Paul", "Seidel", "Einkauf", "+49 351 555 1102"),
        ],
        payment: {
          holder: "Richter IT-Services GmbH",
          iban: "DE10760260000012345600",
          bic: "GENODEF1N02",
          bank: "Testbank Nürnberg",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-7), type: "Anruf", text: "Verlängerung Supportvertrag besprochen.", author: "Jana Lehmann" }],
      },
      {
        id: "klein-moebelwerk",
        name: "Klein Möbelwerk GmbH",
        industry: "Möbel",
        city: "Bielefeld",
        street: "Holzweg 31",
        zip: "33602",
        status: "Aktiv",
        owner: "Tobias Krüger",
        revenue: 54100,
        customerSince: "2021-07-07",
        contacts: [contact("Oliver", "Klein", "Geschäftsführer", "+49 521 555 1201")],
        payment: {
          holder: "Klein Möbelwerk GmbH",
          iban: "DE83520604100004455661",
          bic: "GENODEF1EK1",
          bank: "Testbank Kassel",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-18), type: "E-Mail", text: "Reklamation Lieferung 07/2026 erledigt.", author: "Tobias Krüger" }],
      },
      {
        id: "wolf-spedition",
        name: "Wolf Spedition GmbH & Co. KG",
        industry: "Logistik",
        city: "Bremen",
        street: "Überseetor 4",
        zip: "28217",
        status: "Interessent",
        owner: "Sabine Vogt",
        revenue: 0,
        customerSince: "2026-10-20",
        contacts: [contact("Daniel", "Wolf", "Prokurist", "+49 421 555 1301")],
        payment: {
          holder: "Wolf Spedition GmbH & Co. KG",
          iban: "DE34290501010033300011",
          bic: "SBREDE22XXX",
          bank: "Testsparkasse Bremen",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-2), type: "Anruf", text: "Rückruf erbeten wegen Preisstaffel.", author: "Sabine Vogt" }],
      },
      {
        id: "neumann-textil",
        name: "Neumann Textil GmbH",
        industry: "Textil",
        city: "Augsburg",
        street: "Spinnereistraße 2",
        zip: "86153",
        status: "Aktiv",
        owner: "Jana Lehmann",
        revenue: 41800,
        customerSince: "2018-03-03",
        contacts: [contact("Eva", "Neumann", "Geschäftsführerin", "+49 821 555 1401")],
        payment: {
          holder: "Neumann Textil GmbH",
          iban: "DE64720501010009876543",
          bic: "BYLADEM1AUG",
          bank: "Testsparkasse Augsburg",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-25), type: "Notiz", text: "Zahlungen kommen regelmäßig verspätet.", author: "Jana Lehmann" }],
      },
      {
        id: "schwarz-labortechnik",
        name: "Schwarz Labortechnik GmbH",
        industry: "Labor",
        city: "Mainz",
        street: "Rheinallee 60",
        zip: "55118",
        status: "Aktiv",
        owner: "Sabine Vogt",
        revenue: 76500,
        customerSince: "2020-12-01",
        contacts: [
          contact("Katrin", "Schwarz", "Laborleitung", "+49 6131 555 1501"),
          contact("Ben", "Hartmann", "Einkauf", "+49 6131 555 1502"),
        ],
        payment: {
          holder: "Schwarz Labortechnik GmbH",
          iban: "DE05550501200101010101",
          bic: "MALADE51MNZ",
          bank: "Testsparkasse Mainz",
          paymentTermDays: 30,
          method: "Überweisung",
        },
        history: [{ date: isoDate(-11), type: "E-Mail", text: "Rahmenvertrag 2027 in Vorbereitung.", author: "Sabine Vogt" }],
      },
    ];

    var tasks = [
      { id: "t1", title: "Rückruf wegen Rechnungsfrage", customerId: "mueller-logistik", due: isoDate(0), priority: "Hoch", done: false, assignee: "Jana Lehmann" },
      { id: "t2", title: "Angebot nachfassen", customerId: "richter-it", due: isoDate(0), priority: "Mittel", done: false, assignee: "Jana Lehmann" },
      { id: "t3", title: "Unterlagen für Erstgespräch vorbereiten", customerId: "fischer-bau", due: isoDate(0), priority: "Mittel", done: false, assignee: "Jana Lehmann" },
      { id: "t4", title: "Preisliste 2027 senden", customerId: "schneider-partner", due: isoDate(-2), priority: "Hoch", done: false, assignee: "Jana Lehmann" },
      { id: "t5", title: "Wartungsvertrag kalkulieren", customerId: "becker-maschinenbau", due: isoDate(1), priority: "Hoch", done: false, assignee: "Tobias Krüger" },
      { id: "t6", title: "Neue Bankverbindung prüfen", customerId: "weber-elektrotechnik", due: isoDate(2), priority: "Mittel", done: false, assignee: "Sabine Vogt" },
      { id: "t7", title: "Demo-Termin vorbereiten", customerId: "wagner-energie", due: isoDate(3), priority: "Niedrig", done: false, assignee: "Tobias Krüger" },
      { id: "t8", title: "Zahlungserinnerung abstimmen", customerId: "neumann-textil", due: isoDate(5), priority: "Mittel", done: false, assignee: "Jana Lehmann" },
      { id: "t9", title: "Audit-Unterlagen zusammenstellen", customerId: "schulz-medizintechnik", due: isoDate(-1), priority: "Hoch", done: false, assignee: "Sabine Vogt" },
      { id: "t10", title: "Jahresgespräch protokollieren", customerId: "mueller-logistik", due: isoDate(-6), priority: "Niedrig", done: true, assignee: "Jana Lehmann" },
      { id: "t11", title: "Reklamation abschließen", customerId: "klein-moebelwerk", due: isoDate(-10), priority: "Mittel", done: true, assignee: "Tobias Krüger" },
    ];

    var offers = [
      { id: "o1", number: "ANG-2026-041", title: "Flottenmanagement-Lizenz 2027", customerId: "mueller-logistik", amount: 24800, status: "Versendet", date: isoDate(-9), validUntil: isoDate(21) },
      { id: "o2", number: "ANG-2026-042", title: "Wartungsvertrag Premium", customerId: "becker-maschinenbau", amount: 58200, status: "Entwurf", date: isoDate(-1), validUntil: isoDate(29) },
      { id: "o3", number: "ANG-2026-038", title: "Supportverlängerung 24 Monate", customerId: "richter-it", amount: 31500, status: "Versendet", date: isoDate(-14), validUntil: isoDate(16) },
      { id: "o4", number: "ANG-2026-035", title: "Schulungspaket Verwaltung", customerId: "bauer-agrar", amount: 6900, status: "Angenommen", date: isoDate(-30), validUntil: isoDate(0) },
      { id: "o5", number: "ANG-2026-033", title: "Laborsoftware Rahmenvertrag", customerId: "schwarz-labortechnik", amount: 42000, status: "Angenommen", date: isoDate(-35), validUntil: isoDate(-5) },
      { id: "o6", number: "ANG-2026-029", title: "Druckvorstufe Cloud", customerId: "koch-druck", amount: 9800, status: "Abgelehnt", date: isoDate(-60), validUntil: isoDate(-30) },
      { id: "o7", number: "ANG-2026-043", title: "Pilotprojekt Netzleitstelle", customerId: "wagner-energie", amount: 18500, status: "Entwurf", date: isoDate(0), validUntil: isoDate(30) },
    ];

    var activities = [
      { when: isoDateTime(0, 9, 12), text: "Aufgabe „Rückruf wegen Rechnungsfrage“ angelegt", customerId: "mueller-logistik", author: "Jana Lehmann" },
      { when: isoDateTime(-1, 16, 40), text: "Angebot ANG-2026-042 als Entwurf gespeichert", customerId: "becker-maschinenbau", author: "Tobias Krüger" },
      { when: isoDateTime(-1, 11, 5), text: "Anruf protokolliert: Interesse an Wartungsvertrag", customerId: "becker-maschinenbau", author: "Tobias Krüger" },
      { when: isoDateTime(-2, 14, 30), text: "Rückfrage zur Rechnung geklärt", customerId: "mueller-logistik", author: "Jana Lehmann" },
      { when: isoDateTime(-3, 10, 0), text: "Erstgespräch durchgeführt", customerId: "fischer-bau", author: "Jana Lehmann" },
      { when: isoDateTime(-6, 8, 45), text: "E-Mail: neue Bankverbindung angekündigt", customerId: "weber-elektrotechnik", author: "Sabine Vogt" },
    ];

    var settings = {
      companyName: "Kundenwerk Demo GmbH",
      language: "Deutsch",
      timezone: "Europe/Berlin",
      defaultPaymentTermDays: 30,
      invoicePrefix: "RE-2026-",
      invoiceTemplate: "Standard",
      defaultVatRate: 19,
      reminderAfterDays: 7,
      cashDiscountPercent: 2,
      cashDiscountDays: 10,
      notifications: { taskDue: true, offerAccepted: true, weeklyReport: false },
    };

    var users = [
      { name: "Jana Lehmann", email: "jana.lehmann@example.com", role: "Vertrieb" },
      { name: "Tobias Krüger", email: "tobias.krueger@example.com", role: "Vertrieb" },
      { name: "Sabine Vogt", email: "sabine.vogt@example.com", role: "Buchhaltung" },
      { name: "Michael Roth", email: "michael.roth@example.com", role: "Admin" },
    ];

    return {
      version: 1,
      seededAt: new Date().toISOString(),
      customers: customers,
      tasks: tasks,
      offers: offers,
      activities: activities,
      settings: settings,
      users: users,
      counters: { task: 100, offer: 44 },
    };
  }

  // ---------- Speicher ----------
  var cache = null;

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* Speicher nicht verfügbar – Demo läuft dann nur im Speicher */
    }
  }

  function db() {
    if (cache) return cache;
    var raw = readStorage(STORAGE_KEY);
    if (raw) {
      try {
        cache = JSON.parse(raw);
      } catch (e) {
        cache = null;
      }
    }
    if (!cache || cache.version !== 1) {
      cache = seed();
      save();
    }
    return cache;
  }

  function save() {
    writeStorage(STORAGE_KEY, JSON.stringify(cache));
  }

  function reset() {
    cache = seed();
    save();
    writeStorage(ROLE_KEY, DEFAULT_ROLE);
  }

  function getRole() {
    var r = readStorage(ROLE_KEY);
    return ROLES.indexOf(r) >= 0 ? r : DEFAULT_ROLE;
  }

  function setRole(role) {
    if (ROLES.indexOf(role) >= 0) writeStorage(ROLE_KEY, role);
  }

  function can(permission) {
    var allowed = PERMISSIONS[permission];
    return !allowed || allowed.indexOf(getRole()) >= 0;
  }

  // ---------- Helfer ----------
  function getCustomer(id) {
    var list = db().customers;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function customerName(id) {
    var c = getCustomer(id);
    return c ? c.name : "–";
  }

  function normalizeIban(value) {
    return String(value || "").replace(/\s+/g, "").toUpperCase();
  }

  function formatIban(value) {
    return normalizeIban(value).replace(/(.{4})/g, "$1 ").trim();
  }

  function maskIban(value) {
    var n = normalizeIban(value);
    return n.slice(0, 4) + " •••• •••• " + n.slice(-4);
  }

  // Liefert null, wenn gültig, sonst eine deutsche Fehlermeldung.
  function validateIban(value) {
    var iban = normalizeIban(value);
    if (!iban) return "Bitte geben Sie eine IBAN ein.";
    if (!/^DE\d{20}$/.test(iban)) {
      return "Ungültige IBAN: Eine deutsche IBAN beginnt mit „DE“ und hat 22 Zeichen (z. B. DE89 3704 0044 0532 0130 00).";
    }
    var rearranged = iban.slice(4) + iban.slice(0, 4);
    var digits = rearranged.replace(/[A-Z]/g, function (ch) {
      return String(ch.charCodeAt(0) - 55);
    });
    var rest = 0;
    for (var i = 0; i < digits.length; i++) rest = (rest * 10 + Number(digits[i])) % 97;
    if (rest !== 1) return "Ungültige IBAN: Die Prüfziffer stimmt nicht. Bitte prüfen Sie die Eingabe auf Tippfehler.";
    return null;
  }

  function formatEuro(amount) {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount || 0);
  }

  function formatDate(iso) {
    if (!iso) return "–";
    var d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function formatDateTime(iso) {
    var d = new Date(iso);
    return (
      d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) +
      ", " +
      d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) +
      " Uhr"
    );
  }

  function today() {
    return isoDate(0);
  }

  function nextId(kind) {
    var d = db();
    d.counters[kind] = (d.counters[kind] || 0) + 1;
    return d.counters[kind];
  }

  function logActivity(text, customerId) {
    db().activities.unshift({ when: new Date().toISOString(), text: text, customerId: customerId || null, author: CURRENT_USER.name });
  }

  // Für Suchen: Umlaute vereinheitlichen, Groß-/Kleinschreibung ignorieren.
  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss");
  }

  window.CRM = {
    ROLES: ROLES,
    CURRENT_USER: CURRENT_USER,
    PERMISSIONS: PERMISSIONS,
    db: db,
    save: save,
    reset: reset,
    getRole: getRole,
    setRole: setRole,
    can: can,
    getCustomer: getCustomer,
    customerName: customerName,
    normalizeIban: normalizeIban,
    formatIban: formatIban,
    maskIban: maskIban,
    validateIban: validateIban,
    formatEuro: formatEuro,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    today: today,
    isoDate: isoDate,
    nextId: nextId,
    logActivity: logActivity,
    normalizeText: normalizeText,
  };
})();
