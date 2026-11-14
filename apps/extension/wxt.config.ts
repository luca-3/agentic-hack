import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { defineConfig } from "wxt";

const require = createRequire(import.meta.url);
// Voice assets (apps/extension/VOICE.md) — copied from node_modules into the bundle; MV3 forbids remote code.
const WAKEWORD_MODELS_DIR = join(dirname(require.resolve("openwakeword-wasm-browser/package.json")), "models");
const ORT_DIST_DIR = dirname(require.resolve("onnxruntime-web"));
const WAKEWORD_MODELS = ["melspectrogram.onnx", "embedding_model.onnx", "silero_vad.onnx", "hey_jarvis_v0.1.onnx"];

// Chrome extension (MV3) built with WXT — https://wxt.dev
// `npm run dev:extension` opens a Chrome with the extension loaded; or load `.output/chrome-mv3` via chrome://extensions → "Load unpacked".
export default defineConfig({
  manifest: {
    name: "Valo (dev)",
    description: "Valo zeigt dir in Web-Apps, wo du klicken musst.",
    // offscreen: microphone (wake word + transcription) and spoken answers live in an offscreen document.
    permissions: ["sidePanel", "storage", "tabs", "activeTab", "offscreen"],
    // Local dev only: our server (3001), dashboard (3000), demo CRM (4000), local CORPUS instance.
    host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
    action: { default_title: "Valo öffnen" },
    commands: {
      "lotse-ask": {
        suggested_key: { default: "Alt+L", mac: "Command+Shift+L" },
        description: "Valo öffnen und eine Frage stellen",
      },
      "lotse-listen": {
        suggested_key: { default: "Alt+Shift+L", mac: "Command+Shift+K" },
        description: "Valo zuhören lassen (Frage sprechen)",
      },
    },
    // CSP: WXT's MV3 default for extension pages already allows 'wasm-unsafe-eval' (ONNX Runtime Web) — nothing to add.
  },
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      for (const model of WAKEWORD_MODELS) files.push({ absoluteSrc: join(WAKEWORD_MODELS_DIR, model), relativeDest: `wakeword/${model}` });
      files.push({ absoluteSrc: join(ORT_DIST_DIR, "ort-wasm-simd-threaded.wasm"), relativeDest: "ort/ort-wasm-simd-threaded.wasm" });
      // AudioWorklet must be a real extension file (Blob/data URLs are blocked by the extension CSP).
      files.push({ absoluteSrc: resolve(import.meta.dirname, "utils/voice/pcm-worklet.js"), relativeDest: "voice/pcm-worklet.js" });
    },
  },
  dev: {
    server: { port: 3002 }, // 3000/3001 are taken by dashboard/server
  },
});
