# Submission texts (copy & paste)

Form texts for the {Tech: Europe} Agentic AI Hack Karlsruhe, 14 Nov 2026. Only claims that work today.

## Project name

Valo

## One-liner (≤ 140 characters)

AI onboarding coach for business web apps: notices when you're stuck, shows where to click, and gets quieter as you learn.

## Short description (~100 words)

Companies roll out business software and their people don't use it. Our customer Fuller GmbH sees employees search for minutes in its internal app CORPUS. Valo is a Chrome extension plus an admin dashboard. It runs next to any web app with no code changes. An admin lets Valo explore the app once; after that Valo notices when someone is stuck, offers help on its own, spotlights the right control and walks multi-step plans. It never clicks for you. Ask "Hey Valo, …" and it answers by voice in your language. The dashboard separates "fix the app" from "needs training" using aggregates of at least 5 people only.

## Full description

### Problem

New business software fails at adoption, not at features. At Fuller GmbH, employees spend minutes hunting for a function in the internal app CORPUS, ask a colleague, or go back to the old way. Training is forgotten within a week, and nobody can tell whether the app or the training is to blame. Digital adoption platforms (WalkMe, Whatfix, Userlane) need hand-built tours. AI assistants (Gemini in Chrome, Copilot) wait for a question, or click for you, so nobody learns.

### Solution

Valo is a coach that sits in the browser next to the app:

- **Zero-setup onboarding of an app.** An admin presses "Explore app" once. Valo walks the app read-only (it never presses save, delete or send) and builds the feature list: routes, click paths, roles. Shown live on the EBV-Portal (Erasmus funding, test system), which Valo had never seen.
- **Proactive help.** Local rules spot stuck signals (repeated clicks on a disabled button, empty searches, idle time, errors). A calibrated "needs help?" decision gates every offer, against a per-person threshold that rises when you decline or rate down. Valo gets quieter the better you get.
- **Shows, never acts.** Spotlight, agent cursor and multi-step plans that advance as you click.
- **Voice.** "Hey Valo, …": a wake word model we trained today runs in the browser, and audio leaves the laptop only after the wake word. Answers come in the language of the question and are spoken when you asked by voice.
- **Dashboard for the organization.** Learning review (admins approve or reject what the agent learned), Insights that separate "fix the app" (people still stuck after the hint) from "needs training", a knowledge base, trainings suggested from real employee questions, team and roles. Reports need at least 5 people; there are no per-person views.
- **Privacy by design.** Names, emails, IBANs and IDs are pseudonymized in the browser before anything is sent; row-level security on every table; per-person data export and deletion.

### What's new

- A "still stuck after the hint" signal that tells a design flaw apart from a training need.
- Hints that fade per person, through an adaptive interrupt threshold.
- Live stuck detection with an LLM gate and no hand-built tours.
- It measures the interface, not the people: aggregates only, pseudonymized at the source.

### How we built it

- **Gemini models:** `gemini-4-argon` (hard reasoning), `gemini-3.8-flash` (guidance with tools), `gemini-3.5-flash-lite` (fast single-marker answers and classification), **Decisions API `gemini-decision-1`** (calibrated "should I interrupt?" plus "which feature?" in one call), **Gemini Live** transcription with single-use tokens, **Gemini TTS** streamed as raw PCM (first audio in about 0.8 s), `gemini-embedding-2` (768 dims, pgvector RAG).
- **Our own agent harness** (the Vercel AI SDK only makes the model calls): staged perception pipeline (UI state → intent → decide → guide), a model router with three tiers, streaming UI tools (`pointTo`, `showPlan`, `say`) as NDJSON so the first highlight shows in about 0.9 s, context assembly (role-filtered feature graph, knowledge base, agent memory, screenshots), guardrails (pseudonymization, prompt-injection delimiting, blocked routes, rate limits, token budgets, kill switch, every call traced), and a learning loop with agent memory that is promoted only with evidence from at least 5 people or admin approval.
- **Our own wake word model** for "Hey Valo", trained during the hackathon on synthetic speech only (Gemini TTS and macOS voices). 400 KB ONNX, runs in the browser. 96 % hits on held-out voices, < 1 % false triggers on office and pitch sentences.
- **Stack:** Chrome MV3 extension (WXT), Next.js 16 server and dashboard, Supabase (Postgres, pgvector, Auth), zod contract shared across the apps.
- **Hosting:** dashboard and runtime on **Codesphere** (partner), database, auth and vector search on **Supabase Cloud, EU (eu-central-1)**. The extension is built in the deployment pipeline and can be downloaded from the dashboard (`/install`).

### Partner technology used

- **Google DeepMind / Gemini:** every model call (reasoning, guidance, Decisions API, Live, TTS, embeddings).
- **Codesphere:** hosting of dashboard and agent runtime, including the extension build in the CI pipeline.

### Honest limits

- Not a production rollout yet: the extension is loaded unpacked; company-wide install via Chrome policy is the next step.
- The CORPUS demo runs on Fuller's dev system with sample data only (dev.fuller.de, "Fuller GmbH (Demo)").
- Insights numbers in the dashboard are partly demo data; the pipeline that computes them from real events is built.
- No automated tests (hackathon decision); validated with typecheck, lint and builds.

## Links

- Repo: https://github.com/luca-3/agentic-hack
- Live: https://691180.1.cloud.codesphere.com (invite-only, access on request)

## Note on timing

Starter template (Next.js + Supabase) committed on 13 Nov; all product code from kickoff on 14 Nov – see commit history.

## Team

- **Luca**: server and agent runtime, voice, wake word model
- **Nils**: Chrome extension: observation, stuck detection, app exploration, guidance UI
- **Ismail**: dashboard, database and hosting
