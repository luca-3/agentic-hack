# Lotse — agent wiki

Shared context for humans **and coding agents** working on this repo. Read this before building anything product-related.
Status: 2026-11-14 (hackathon day). Repo setup and conventions: `AGENTS.md`, `SETUP.md`.

| File | What's in it |
| --- | --- |
| [requirements.md](requirements.md) | What Lotse is, users, requirement catalog (with priority), demo script, hackathon rules |
| [architecture.md](architecture.md) | The 3 components, extension internals, main flows, data model, agent tools |
| [decisions.md](decisions.md) | Decision log (D-xx) incl. open questions — **the source of truth for "why"** |
| [research.md](research.md) | Technical findings with sources (extension limits, Gemini Live, PostHog, ADK, competitors …) |

## Lotse in one paragraph

Lotse is a voice-native assistant for business web apps (first targets: **CORPUS**, an internal app of Fuller, and the **EBV-Portal**). A Chrome extension watches how employees use the app, notices when someone is stuck, and shows on screen where to click (frame + arrow + one plain sentence), optionally clicking itself. Users can also ask by voice ("Hey Lotse, wie ändere ich die IBAN?"). A central dashboard lets each organization manage app knowledge, users and roles, and shows aggregated pain points as training suggestions and UX improvement potential. Everything runs on Google Gemini.

## Rules for maintaining this wiki

- **New decision →** append to `decisions.md` (next D-number). Never rewrite an old decision; mark it `Superseded by D-xx`.
- **Requirement done/changed →** update its status in `requirements.md`.
- **New finding →** add to `research.md` with source link and date.
- Keep it short: bullet points, no prose walls. English. Never put keys, passwords or real customer data here.

## Glossary

| Term | Meaning |
| --- | --- |
| Extension | Lotse Chrome extension (MV3) running in the employee's browser |
| Runtime | Our server (this Next.js app): agent, decision API, token minting, ingest |
| Dashboard | Admin UI for organizations (part of this Next.js app) |
| Snapshot | Numbered list of the interactive elements on the current page (number, role, label, route) |
| Feature list / manifest | Per-app list of functions: name, route, click path, required role |
| Stuck signal | Rule hit that suggests the user needs help (e.g. 3 searches without result) |
| Org | Customer organization (tenant) with its users, apps and settings |
| CORPUS | Fuller's internal app; only a **local test instance with sample data** is used |
