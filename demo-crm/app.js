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
  };

  var NAV = [
    { href: "index.html", label: "Dashboard", page: "dashboard", icon: "dashboard" },
    { href: "kunden.html", label: "Kunden", page: "kunden", icon: "kunden" },
    { href: "aufgaben.html", label: "Aufgaben", page: "aufgaben", icon: "aufgaben" },
    { href: "angebote.html", label: "Angebote", page: "angebote", icon: "angebote" },
    { href: "einstellungen.html", label: "Einstellungen", page: "einstellungen", icon: "einstellungen", permission: "viewSettings" },
  ];

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
      '<button type="button" class="user-menu-btn" id="user-menu-button" aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu">' +
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
      '<li role="none"><button type="button" role="menuitem" data-action="profile">Mein Profil</button></li>' +
      '<li role="none"><button type="button" role="menuitem" data-action="shortcuts">Tastenkürzel</button></li>' +
      '<li role="none"><button type="button" role="menuitem" data-action="logout">Abmelden</button></li>' +
      "</ul></div>" +
      "</div>"
    );
  }

  function renderSidebar(page) {
    var items = NAV.filter(function (item) {
      return !item.permission || CRM.can(item.permission);
    })
      .map(function (item) {
        var active = item.page === page;
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
      })
      .join("");
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
      closeAllDropdowns();
      var panel = document.getElementById("search-results");
      var form = document.getElementById("global-search-form");
      if (panel && !form.contains(e.target)) panel.hidden = true;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeAllDropdowns();
        var panel = document.getElementById("search-results");
        if (panel) panel.hidden = true;
      }
    });

    document.getElementById("user-menu").addEventListener("click", function (e) {
      var action = e.target.getAttribute && e.target.getAttribute("data-action");
      if (!action) return;
      closeAllDropdowns();
      if (action === "profile") toast("Profilseite ist in der Demo nicht verfügbar.", "info");
      if (action === "shortcuts") toast("Tastenkürzel: / fokussiert die Suche, Esc schließt Menüs.", "info");
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
    };
    return '<span class="badge ' + (map[s] || "badge-gray") + '">' + escapeHtml(s) + "</span>";
  }

  // Einfache Tabs nach WAI-ARIA (role=tablist/tab/tabpanel); Hash in der URL hält den Tab.
  function initTabs(tablist, onChange) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
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

  CRM.ui = {
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
