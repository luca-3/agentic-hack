/*
 * Kundenwerk CRM – gemeinsame Oberfläche (Top-Bar, Sidebar, Suche, Rollen, Toasts).
 * Wird von jeder Seite nach data.js geladen. Die Seite setzt <body data-page="…">.
 */
(function () {
  "use strict";

  var CRM = window.CRM;
  var FLASH_KEY = "kundenwerk-crm:flash";

  var ICONS = {
    dashboard:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>',
    kunden:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>',
    aufgaben:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>',
    angebote:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
    einstellungen:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.48.48 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.03 7.03 0 00-1.62-.94l-.36-2.54A.48.48 0 0013.93 2h-3.84a.48.48 0 00-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.73 8.47a.47.47 0 00.12.61l2.03 1.58a7.07 7.07 0 000 1.88l-2.03 1.58a.48.48 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 00-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
    bell:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 00-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>',
    help:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18h2v-2h-2v2zm1-16a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16zm0-14a4 4 0 00-4 4h2a2 2 0 114 0c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5a4 4 0 00-4-4z"/></svg>',
    menu:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    chevron:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>',
    kebab:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z"/></svg>',
    command:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zM6.7 15.3l-1.4-1.4L7.2 12 5.3 10.1l1.4-1.4L10 12l-3.3 3.3zM18 16h-6v-2h6v2z"/></svg>',
    verwaltung:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>',
  };

  var NAV = [
    { href: "index.html", label: "Dashboard", page: "dashboard", icon: "dashboard" },
    { href: "kunden.html", label: "Kunden", page: "kunden", icon: "kunden" },
    { href: "aufgaben.html", label: "Aufgaben", page: "aufgaben", icon: "aufgaben" },
    { href: "angebote.html", label: "Angebote", page: "angebote", icon: "angebote" },
    {
      group: "Verwaltung",
      id: "nav-group-verwaltung",
      icon: "verwaltung",
      children: [
        { href: "einstellungen.html", label: "Einstellungen", page: "einstellungen", icon: "einstellungen", permission: "viewSettings" },
        { href: "einstellungen.html#benutzer", label: "Benutzer", page: "", icon: "kunden", permission: "viewSettings" },
        { href: "import-export.html", label: "Import/Export", page: "import-export", icon: "angebote", permission: "dataExchange" },
      ],
    },
  ];
  var NAV_GROUP_KEY = "kundenwerk-crm:nav-verwaltung-collapsed";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- Toasts ----------
  function toast(message, type) {
    var region = document.getElementById("toast-region");
    if (!region) return;
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "success");
    el.textContent = message;
    region.appendChild(el);
    setTimeout(function () {
      el.classList.add("toast-hide");
      setTimeout(function () {
        el.remove();
      }, 300);
    }, 4500);
  }

  // Toast über einen Seitenwechsel/Reload hinweg anzeigen.
  function flash(message, type) {
    try {
      sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message: message, type: type || "success" }));
    } catch (e) {
      /* ignorieren */
    }
  }

  function showFlash() {
    try {
      var raw = sessionStorage.getItem(FLASH_KEY);
      if (raw) {
        sessionStorage.removeItem(FLASH_KEY);
        var f = JSON.parse(raw);
        toast(f.message, f.type);
      }
    } catch (e) {
      /* ignorieren */
    }
  }

  // ---------- Shell ----------
  function renderTopbar(role) {
    var user = CRM.CURRENT_USER;
    var roleOptions = CRM.ROLES.map(function (r) {
      return '<option value="' + r + '"' + (r === role ? " selected" : "") + ">" + r + "</option>";
    }).join("");

    return (
      '<div class="topbar-left">' +
      '<button type="button" class="icon-btn" id="sidebar-toggle" aria-label="Navigation einklappen" aria-expanded="true" aria-controls="sidebar">' +
      ICONS.menu +
      "</button>" +
      '<a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">K</span><span>Kundenwerk <span class="brand-sub">CRM</span></span></a>' +
      "</div>" +
      '<form class="global-search" id="global-search-form" role="search" autocomplete="off">' +
      '<label for="global-search" class="sr-only">Globale Suche</label>' +
      '<input type="search" id="global-search" name="q" placeholder="Kunden, Aufgaben, Angebote suchen …" />' +
      '<button type="submit" class="icon-btn" aria-label="Suchen">' +
      ICONS.search +
      "</button>" +
      '<div class="search-results" id="search-results" role="region" aria-label="Suchergebnisse" hidden></div>' +
      "</form>" +
      '<div class="topbar-right">' +
      '<div class="role-switch"><label for="role-switcher">Rolle</label><select id="role-switcher">' +
      roleOptions +
      "</select></div>" +
      '<button type="button" class="icon-btn" id="palette-button" aria-label="Befehlspalette öffnen" aria-keyshortcuts="Control+K Meta+K" title="Befehlspalette (Strg+K / ⌘K)">' +
      ICONS.command +
      "</button>" +
      '<button type="button" class="icon-btn" id="help-button" aria-label="Hilfe">' +
      ICONS.help +
      "</button>" +
      '<div class="dropdown">' +
      '<button type="button" class="icon-btn" id="notifications-button" aria-label="Benachrichtigungen" aria-haspopup="true" aria-expanded="false" aria-controls="notifications-panel">' +
      ICONS.bell +
      '<span class="badge-dot" aria-hidden="true">3</span></button>' +
      '<div class="dropdown-panel" id="notifications-panel" hidden>' +
      '<h2 class="dropdown-title">Benachrichtigungen</h2>' +
      '<ul class="notification-list">' +
      "<li><strong>Aufgabe fällig:</strong> Rückruf wegen Rechnungsfrage (Müller Logistik GmbH)</li>" +
      "<li><strong>Angebot angenommen:</strong> ANG-2026-035 (Bauer Agrar eG)</li>" +
      "<li><strong>Hinweis:</strong> Weber Elektrotechnik KG hat eine neue Bankverbindung angekündigt.</li>" +
      "</ul></div></div>" +
      '<div class="dropdown">' +
      '<button type="button" class="user-menu-btn" id="user-menu-button" aria-label="Benutzermenü" aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu">' +
      '<span class="avatar" aria-hidden="true">' +
      user.initials +
      "</span>" +
      '<span class="user-meta"><span class="user-name">' +
      escapeHtml(user.name) +
      '</span><span class="user-role">' +
      escapeHtml(role) +
      "</span></span>" +
      ICONS.chevron +
      "</button>" +
      '<ul class="dropdown-panel menu" id="user-menu" role="menu" aria-label="Benutzermenü" hidden>' +
      '<li role="none" class="menu-info">Angemeldet als <strong>' +
      escapeHtml(user.name) +
      "</strong><br />Rolle: " +
      escapeHtml(role) +
      "</li>" +
      '<li role="none"><a role="menuitem" href="konto.html">Mein Konto</a></li>' +
      '<li role="none"><a role="menuitem" href="konto.html#abwesenheit">Abwesenheit</a></li>' +
      '<li role="none"><button type="button" role="menuitem" data-action="shortcuts">Tastenkürzel</button></li>' +
      '<li role="none"><button type="button" role="menuitem" data-action="logout">Abmelden</button></li>' +
      "</ul></div>" +
      "</div>"
    );
  }

  function navLink(item, page) {
    var active = item.page && item.page === page;
    return (
      '<li><a href="' +
      item.href +
      '"' +
      (active ? ' class="active" aria-current="page"' : "") +
      ">" +
      ICONS[item.icon] +
      "<span>" +
      item.label +
      "</span></a></li>"
    );
  }

  function readGroupCollapsed() {
    try {
      return localStorage.getItem(NAV_GROUP_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function renderSidebar(page) {
    var items = NAV.map(function (item) {
      if (!item.group) return !item.permission || CRM.can(item.permission) ? navLink(item, page) : "";
      var children = item.children.filter(function (c) {
        return !c.permission || CRM.can(c.permission);
      });
      if (children.length === 0) return "";
      var collapsed = readGroupCollapsed();
      return (
        '<li class="nav-group"><button type="button" class="nav-group-btn" id="' + item.id + '-button" aria-expanded="' + String(!collapsed) +
        '" aria-controls="' + item.id + '">' + ICONS[item.icon] + "<span>" + item.group + "</span>" + ICONS.chevron + "</button>" +
        '<ul class="nav-sublist" id="' + item.id + '"' + (collapsed ? " hidden" : "") + ">" +
        children.map(function (c) { return navLink(c, page); }).join("") +
        "</ul></li>"
      );
    }).join("");
    return (
      '<ul class="nav-list">' +
      items +
      "</ul>" +
      '<div class="sidebar-footer">' +
      '<p class="sidebar-note">Demo-Umgebung · fiktive Daten</p>' +
      '<a href="#" id="reset-demo">Demo-Daten zurücksetzen</a>' +
      "</div>"
    );
  }

  // ---------- Globale Suche ----------
  function runSearch(term) {
    var q = CRM.normalizeText(term.trim());
    var d = CRM.db();
    var results = [];
    if (!q) return results;
    d.customers.forEach(function (c) {
      var hay = [c.name, c.city, c.industry].concat(c.contacts.map(function (p) {
        return p.name;
      }));
      if (CRM.normalizeText(hay.join(" ")).indexOf(q) >= 0) {
        results.push({ kind: "Kunde", label: c.name, sub: c.city, href: "kunde.html?id=" + encodeURIComponent(c.id) });
      }
    });
    d.tasks.forEach(function (t) {
      if (CRM.normalizeText(t.title).indexOf(q) >= 0) {
        results.push({ kind: "Aufgabe", label: t.title, sub: CRM.customerName(t.customerId), href: "aufgaben.html" });
      }
    });
    d.offers.forEach(function (o) {
      if (CRM.normalizeText(o.number + " " + o.title).indexOf(q) >= 0) {
        results.push({ kind: "Angebot", label: o.number + " – " + o.title, sub: CRM.customerName(o.customerId), href: "angebote.html" });
      }
    });
    return results;
  }

  function wireSearch() {
    var form = document.getElementById("global-search-form");
    var input = document.getElementById("global-search");
    var panel = document.getElementById("search-results");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var term = input.value.trim();
      if (!term) {
        panel.hidden = true;
        return;
      }
      var results = runSearch(term);
      var html = '<p class="search-heading">Suchergebnisse für „' + escapeHtml(term) + "“</p>";
      if (results.length === 0) {
        html += '<p class="search-empty">Keine Ergebnisse für „' + escapeHtml(term) + "“</p>";
      } else {
        html +=
          '<ul class="search-list">' +
          results
            .slice(0, 10)
            .map(function (r) {
              return (
                '<li><a href="' +
                r.href +
                '"><span class="search-kind">' +
                r.kind +
                "</span>" +
                escapeHtml(r.label) +
                '<span class="search-sub">' +
                escapeHtml(r.sub) +
                "</span></a></li>"
              );
            })
            .join("") +
          "</ul>";
      }
      panel.innerHTML = html;
      panel.hidden = false;
    });

    input.addEventListener("input", function () {
      if (!input.value.trim()) panel.hidden = true;
    });
  }

  // ---------- Dropdowns ----------
  function wireDropdown(buttonId, panelId) {
    var btn = document.getElementById(buttonId);
    var panel = document.getElementById(panelId);
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = panel.hidden;
      closeAllDropdowns();
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    });
    panel.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }

  // ---------- Generische Menüs (Overflow/Kebab, Aktionen, Untermenüs) ----------
  // Button: class "js-menu-btn", aria-haspopup="menu", aria-controls=<Panel-ID>; Panel: class "js-menu-panel".
  function closeMenus(keep) {
    Array.prototype.forEach.call(document.querySelectorAll(".js-menu-panel"), function (panel) {
      if (keep && panel.contains(keep)) return;
      panel.hidden = true;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-menu-btn"), function (btn) {
      var panel = document.getElementById(btn.getAttribute("aria-controls"));
      if (!panel || panel.hidden) btn.setAttribute("aria-expanded", "false");
    });
  }

  function toggleMenu(btn) {
    var panel = document.getElementById(btn.getAttribute("aria-controls"));
    if (!panel) return;
    var open = panel.hidden;
    closeMenus(btn);
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) {
      var first = panel.querySelector('[role="menuitem"]');
      if (first && btn.classList.contains("js-submenu-btn") === false) first.focus();
    }
  }

  function closeAllDropdowns() {
    ["notifications-panel", "user-menu"].forEach(function (id) {
      var p = document.getElementById(id);
      if (p) p.hidden = true;
    });
    ["notifications-button", "user-menu-button"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }

  // ---------- Befehlspalette (Strg/⌘ + K) ----------
  var COMMANDS = [
    { group: "Navigation", label: "Gehe zu Dashboard", href: "index.html" },
    { group: "Navigation", label: "Gehe zu Kunden", href: "kunden.html" },
    { group: "Navigation", label: "Gehe zu Aufgaben", href: "aufgaben.html" },
    { group: "Navigation", label: "Gehe zu Angebote", href: "angebote.html" },
    { group: "Aktionen", label: "Neue Aufgabe anlegen", href: "aufgaben.html#neu", keywords: "task todo rückruf" },
    { group: "Aktionen", label: "Neues Angebot erstellen", href: "angebote.html#neu", permission: "createOffer" },
    { group: "Aktionen", label: "Angebote zur Freigabe anzeigen", href: "angebote.html?status=Zur%20Freigabe", permission: "approveOffer", keywords: "freigabe genehmigen" },
    { group: "Konto", label: "Mein Konto öffnen", href: "konto.html", keywords: "profil account" },
    { group: "Konto", label: "Passwort ändern", href: "konto.html#sicherheit", keywords: "sicherheit kennwort" },
    { group: "Konto", label: "Zwei-Faktor-Authentifizierung einrichten", href: "konto.html#sicherheit", keywords: "2fa sicherheit" },
    { group: "Konto", label: "Abwesenheit & Vertretung einrichten", href: "konto.html#abwesenheit", keywords: "urlaub vertretung abwesend" },
    { group: "Konto", label: "E-Mail-Signatur bearbeiten", href: "konto.html#signatur" },
    { group: "Konto", label: "Benachrichtigungen anpassen", href: "konto.html#benachrichtigungen" },
    { group: "Konto", label: "API-Token verwalten", href: "konto.html#api-zugang", permission: "manageApi", keywords: "api schnittstelle" },
    { group: "Verwaltung", label: "Einstellungen öffnen", href: "einstellungen.html", permission: "viewSettings" },
    { group: "Verwaltung", label: "Benutzer verwalten", href: "einstellungen.html#benutzer", permission: "viewSettings" },
    { group: "Verwaltung", label: "Daten importieren oder exportieren", href: "import-export.html", permission: "dataExchange", keywords: "csv excel datev" },
  ];

  function initPalette() {
    var dlg = document.createElement("dialog");
    dlg.id = "command-palette";
    dlg.className = "palette";
    dlg.setAttribute("aria-labelledby", "palette-title");
    dlg.innerHTML =
      '<h2 id="palette-title" class="sr-only">Befehlspalette</h2>' +
      '<div class="palette-search"><label for="palette-input" class="sr-only">Befehl suchen</label>' +
      ICONS.search +
      '<input type="search" id="palette-input" placeholder="Befehl oder Seite suchen …" autocomplete="off" aria-controls="palette-list" />' +
      '<kbd>Esc</kbd></div>' +
      '<div id="palette-list" class="palette-list" role="region" aria-label="Befehle"></div>';
    document.body.appendChild(dlg);
    var input = dlg.querySelector("#palette-input");
    var list = dlg.querySelector("#palette-list");
    var active = 0;

    function visible() {
      var q = CRM.normalizeText(input.value.trim());
      return COMMANDS.filter(function (c) {
        if (c.permission && !CRM.can(c.permission)) return false;
        if (!q) return true;
        return CRM.normalizeText(c.label + " " + c.group + " " + (c.keywords || "")).indexOf(q) >= 0;
      });
    }

    function render() {
      var cmds = visible();
      if (active >= cmds.length) active = 0;
      if (cmds.length === 0) {
        list.innerHTML = '<p class="search-empty">Kein Befehl gefunden für „' + escapeHtml(input.value.trim()) + "“</p>";
        return;
      }
      var html = "";
      var lastGroup = "";
      cmds.forEach(function (c, i) {
        if (c.group !== lastGroup) {
          html += '<p class="palette-group">' + c.group + "</p>";
          lastGroup = c.group;
        }
        html += '<button type="button" class="palette-item' + (i === active ? " active" : "") + '" data-index="' + i + '">' + escapeHtml(c.label) + "</button>";
      });
      list.innerHTML = html;
    }

    function run(cmd) {
      if (!cmd) return;
      dlg.close();
      var target = new URL(cmd.href, location.href);
      var samePage = target.pathname === location.pathname && target.search === location.search;
      location.href = cmd.href;
      if (samePage && target.hash) location.reload();
    }

    input.addEventListener("input", function () {
      active = 0;
      render();
    });
    input.addEventListener("keydown", function (e) {
      var cmds = visible();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + cmds.length) % Math.max(cmds.length, 1);
        render();
      } else if (e.key === "Enter") {
        e.preventDefault();
        run(cmds[active]);
      }
    });
    list.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-index]");
      if (btn) run(visible()[Number(btn.getAttribute("data-index"))]);
    });
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });

    function open() {
      if (dlg.open) return;
      closeAllDropdowns();
      closeMenus();
      input.value = "";
      active = 0;
      render();
      dlg.showModal();
      input.focus();
    }
    document.getElementById("palette-button").addEventListener("click", open);
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (dlg.open) dlg.close();
        else open();
      }
    });
  }

  function init() {
    var page = document.body.getAttribute("data-page");
    var role = CRM.getRole();
    CRM.db(); // Seed beim ersten Laden

    var topbar = document.getElementById("topbar");
    var sidebar = document.getElementById("sidebar");
    topbar.innerHTML = renderTopbar(role);
    sidebar.innerHTML = renderSidebar(page);
    sidebar.setAttribute("aria-label", "Hauptnavigation");

    if (!document.getElementById("toast-region")) {
      var region = document.createElement("div");
      region.id = "toast-region";
      region.className = "toast-region";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }

    wireSearch();
    wireDropdown("notifications-button", "notifications-panel");
    wireDropdown("user-menu-button", "user-menu");

    document.addEventListener("click", function (e) {
      var menuBtn = e.target.closest && e.target.closest(".js-menu-btn");
      if (menuBtn) toggleMenu(menuBtn);
      else if (!(e.target.closest && e.target.closest('[role="menuitem"][aria-disabled="true"]'))) closeMenus();
      closeAllDropdowns();
      var panel = document.getElementById("search-results");
      var form = document.getElementById("global-search-form");
      if (panel && !form.contains(e.target)) panel.hidden = true;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeAllDropdowns();
        closeMenus();
        var panel = document.getElementById("search-results");
        if (panel) panel.hidden = true;
      }
    });

    document.getElementById("user-menu").addEventListener("click", function (e) {
      var action = e.target.getAttribute && e.target.getAttribute("data-action");
      if (!action) return;
      closeAllDropdowns();
      if (action === "shortcuts") toast("Tastenkürzel: / fokussiert die Suche, Strg+K (⌘K) öffnet die Befehlspalette, Esc schließt Menüs.", "info");
      if (action === "logout") toast("Abmelden ist in der Demo deaktiviert.", "info");
    });

    document.getElementById("role-switcher").addEventListener("change", function (e) {
      CRM.setRole(e.target.value);
      flash("Rolle gewechselt: " + e.target.value, "info");
      // Seiten, die die neue Rolle nicht sehen darf, zeigen eine Fehlermeldung.
      location.reload();
    });

    document.getElementById("help-button").addEventListener("click", function () {
      toast("Das Hilfe-Center ist in der Demo nicht verfügbar.", "info");
    });

    document.getElementById("sidebar-toggle").addEventListener("click", function (e) {
      var collapsed = document.body.classList.toggle("sidebar-collapsed");
      e.currentTarget.setAttribute("aria-expanded", String(!collapsed));
      e.currentTarget.setAttribute("aria-label", collapsed ? "Navigation ausklappen" : "Navigation einklappen");
    });

    var groupBtn = document.getElementById("nav-group-verwaltung-button");
    if (groupBtn) {
      groupBtn.addEventListener("click", function () {
        var list = document.getElementById("nav-group-verwaltung");
        var collapse = !list.hidden;
        list.hidden = collapse;
        groupBtn.setAttribute("aria-expanded", String(!collapse));
        try {
          localStorage.setItem(NAV_GROUP_KEY, collapse ? "1" : "0");
        } catch (err) {
          /* ignorieren */
        }
      });
    }

    initPalette();

    document.getElementById("reset-demo").addEventListener("click", function (e) {
      e.preventDefault();
      CRM.reset();
      flash("Demo-Daten wurden zurückgesetzt.", "info");
      location.href = "index.html";
    });

    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      if (e.key === "/" && tag !== "input" && tag !== "textarea" && tag !== "select") {
        e.preventDefault();
        document.getElementById("global-search").focus();
      }
    });

    showFlash();
  }

  // ---------- Kleine UI-Helfer für die Seiten ----------
  function priorityBadge(p) {
    var cls = p === "Hoch" ? "badge-red" : p === "Mittel" ? "badge-amber" : "badge-gray";
    return '<span class="badge ' + cls + '">' + escapeHtml(p) + "</span>";
  }

  function statusBadge(s) {
    var map = {
      Aktiv: "badge-green",
      Interessent: "badge-blue",
      Inaktiv: "badge-gray",
      Entwurf: "badge-gray",
      Versendet: "badge-blue",
      Angenommen: "badge-green",
      Abgelehnt: "badge-red",
      "Zur Freigabe": "badge-amber",
      Freigegeben: "badge-green",
      Gekündigt: "badge-red",
    };
    return '<span class="badge ' + (map[s] || "badge-gray") + '">' + escapeHtml(s) + "</span>";
  }

  // Einfache Tabs nach WAI-ARIA (role=tablist/tab/tabpanel); Hash in der URL hält den Tab.
  function initTabs(tablist, onChange) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]')).filter(function (t) {
      return !t.hidden;
    });
    function select(tab, updateHash) {
      tabs.forEach(function (t) {
        var selected = t === tab;
        t.setAttribute("aria-selected", String(selected));
        t.tabIndex = selected ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
      });
      if (updateHash) location.hash = tab.getAttribute("data-hash");
      if (onChange) onChange(tab);
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () {
        select(tab, true);
      });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = tabs[(i + 1) % tabs.length];
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (next) {
          e.preventDefault();
          next.focus();
          select(next, true);
        }
      });
    });
    function fromHash() {
      var h = location.hash.replace("#", "");
      var match = tabs.filter(function (t) {
        return t.getAttribute("data-hash") === h;
      })[0];
      select(match || tabs[0], false);
    }
    window.addEventListener("hashchange", fromHash);
    fromHash();
  }

  function setFieldError(input, errorEl, message) {
    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      input.setAttribute("aria-invalid", "true");
    } else {
      errorEl.textContent = "";
      errorEl.hidden = true;
      input.removeAttribute("aria-invalid");
    }
  }

  function customerOptions(selectedId) {
    return CRM.db()
      .customers.slice()
      .sort(function (a, b) {
        return a.name.localeCompare(b.name, "de");
      })
      .map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === selectedId ? " selected" : "") + ">" + escapeHtml(c.name) + "</option>";
      })
      .join("");
  }

  // Prüft eine Berechtigung; zeigt sonst Fehlermeldung (alert + Toast). Gibt true zurück, wenn erlaubt.
  function requirePermission(permission, alertEl, message) {
    if (CRM.can(permission)) return true;
    var text = "Keine Berechtigung: " + message + " Ihre Rolle: " + CRM.getRole() + ".";
    if (alertEl) {
      alertEl.textContent = text;
      alertEl.hidden = false;
    }
    toast(text, "error");
    return false;
  }

  function rolesFor(permission) {
    return (CRM.PERMISSIONS[permission] || []).join(", ").replace(/, ([^,]*)$/, " oder $1");
  }

  function userOptions(selectedName, includeMe) {
    return CRM.db()
      .users.filter(function (u) {
        return includeMe || u.name !== CRM.CURRENT_USER.name;
      })
      .map(function (u) {
        return '<option value="' + escapeHtml(u.name) + '"' + (u.name === selectedName ? " selected" : "") + ">" + escapeHtml(u.name) + " (" + escapeHtml(u.role) + ")</option>";
      })
      .join("");
  }

  CRM.ui = {
    requirePermission: requirePermission,
    rolesFor: rolesFor,
    userOptions: userOptions,
    closeMenus: closeMenus,
    ICONS: ICONS,
    escapeHtml: escapeHtml,
    toast: toast,
    flash: flash,
    priorityBadge: priorityBadge,
    statusBadge: statusBadge,
    initTabs: initTabs,
    setFieldError: setFieldError,
    customerOptions: customerOptions,
  };

  init();
})();
