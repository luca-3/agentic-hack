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
    description: "Valo shows you where to click in web apps.",
    // offscreen: microphone (wake word + transcription) and spoken answers live in an offscreen document.
    permissions: ["sidePanel", "storage", "tabs", "activeTab", "offscreen"],
    // Local dev: our server (3001), dashboard (3000), demo CRM (4000), local CORPUS instance; CORPUS dev; EBV-Portal test system.
    host_permissions: ["http://localhost/*", "http://127.0.0.1/*", "https://dev.fuller.de/*", "https://ebv-portal.vercel.app/*"],
    action: { default_title: "Open Valo" },
    commands: {
      "lotse-ask": {
        suggested_key: { default: "Alt+L", mac: "Command+Shift+L" },
        description: "Open Valo and ask a question",
      },
      "lotse-listen": {
        suggested_key: { default: "Alt+Shift+L", mac: "Command+Shift+K" },
        description: "Let Valo listen (ask by voice)",
      },
    },
    // CSP: Chrome's MV3 default ("script-src 'self'; object-src 'self';") DISABLES WebAssembly → ONNX Runtime Web
    // (wake word + Silero VAD in the offscreen document) could not load. 'wasm-unsafe-eval' is the minimum Chrome allows.
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
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
