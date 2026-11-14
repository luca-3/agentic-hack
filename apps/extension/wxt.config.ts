import { defineConfig } from "wxt";

// Chrome extension (MV3) built with WXT — https://wxt.dev
// `npm run dev:extension` opens a Chrome with the extension loaded; or load `.output/chrome-mv3` via chrome://extensions → "Load unpacked".
export default defineConfig({
  manifest: {
    name: "Lotse (dev)",
    description: "Lotse zeigt dir in Web-Apps, wo du klicken musst.",
    permissions: ["sidePanel", "storage", "tabs", "activeTab"],
    // Local dev only: our server (3001), dashboard (3000), demo CRM (4000), local CORPUS instance.
    host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
    action: { default_title: "Lotse öffnen" },
    commands: {
      "lotse-ask": {
        suggested_key: { default: "Alt+L" },
        description: "Lotse öffnen und eine Frage stellen",
      },
    },
  },
  dev: {
    server: { port: 3002 }, // 3000/3001 are taken by dashboard/server
  },
});
