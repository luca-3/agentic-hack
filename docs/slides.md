# Valo: slides (copy into Google Slides)

Five slides max. One idea per slide; the live demo carries the rest.

---

## 1 · Title

**Valo**
Your coach for business software: notices when you're stuck, shows where to click, gets quieter as you learn.

Luca · Nils · Ismail · {Tech: Europe} Agentic AI Hack Karlsruhe · 14 Nov 2026
Built on Google Gemini · hosted on Codesphere

---

## 2 · Problem

**New software fails at adoption, not features.**

- Fuller GmbH's employees spend minutes looking for a function in CORPUS
- They ask a colleague, or go back to the old way
- Training is forgotten within a week
- Nobody knows: is the app the problem, or the training?

---

## 3 · How it works

```
Browser extension  ──▶  Valo runtime (our harness)  ──▶  Gemini
 observe · rules         state → intent → decide → guide     4 argon · 3.8 flash · 3.5 flash-lite
 pseudonymize            model router · streaming tools      Decisions API · Live · TTS · embeddings
 spotlight · voice                    │
                                      ▼
                     Supabase EU (pgvector, RLS)  ◀──▶  Dashboard
```

- **Explore once:** an admin runs one read-only crawl → feature map
- **Steps in on its own:** local stuck signals + calibrated Gemini decision
- **Shows, never acts:** spotlight, cursor, step-by-step plans, ~0.9 s to first highlight
- **"Hey Valo":** our own wake word model, runs in the browser

---

## 4 · What's different

| Others | Valo |
| --- | --- |
| WalkMe / Whatfix / Userlane: tours built by hand | Sets itself up in one exploration run |
| Hints never fade | Gets quieter the better you get (per person) |
| Copilot / Gemini in Chrome: wait for a question, or click for you | Steps in on its own and only shows |
| Analytics per employee | Aggregates of ≥ 5 people, pseudonymized in the browser |
| — | "Still stuck after the hint?" → fix the app vs. train the people |

---

## 5 · Team & next

**Fuller wants to roll Valo out on CORPUS.**

Next: company-wide install via Chrome policy · dashboard-managed blocklists · EU-region model hosting · per-task fading

Luca: agent runtime & voice · Nils: Chrome extension · Ismail: dashboard, data & hosting

github.com/luca-3/agentic-hack
