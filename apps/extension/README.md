# Lotse Chrome extension

WXT 0.21.5 + TypeScript, Chrome MV3. This workspace observes local business-app pages and talks to the independent runtime at `http://localhost:3001`. It does not contain Next.js server code or a Gemini key.

Start with the [handoff](../../docs/handoff-extension.md) and [API contract](../../docs/extension-observability.md).

From the repository root:

```sh
npm install
npm run build -w @lotse/extension
```

Load `apps/extension/.output/chrome-mv3` via Chrome's Extensions page → Developer mode → Load unpacked. Open a permitted local test app, click Lotse's toolbar icon, enter the demo role/application knowledge and start observation. `Alt+L` opens the question panel.

Proactive: `/state` → local inferred state history → `/intent` → `/decide` → only if positive `/ask` with selected screenshots. Explicit questions go directly to `/ask`. State, intent and decision calls receive no images. The user implements the runtime endpoints.

Recorded observations stay in a bounded local buffer; editable input values are not logged. Screenshots are unmasked, so use sample data only. Real wake-word/microphone input, automatic plan advancement, extension login and analytics batching remain separate work.

Static validation: `npm run typecheck` and `npm run lint` at the repo root. No tests or PRs; commit/push directly to main per the user's standing instruction.
