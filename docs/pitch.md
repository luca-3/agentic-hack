# Valo: 3-minute live pitch

Live demos from 20:00, about 3 minutes per team, then jury questions. One laptop, one driver at the keyboard (**Nils**), three speakers.
Lines are in English; *(DE: …)* = German cue words in case you lose the thread. Say it in your own words, keep the timing.

> Hard rules on stage: never open the vehicle module in CORPUS. No credentials on screen. Name no CORPUS functions out loud; say "a function" / "this button".

## Run of show

| Time | Who | Screen | Section |
| --- | --- | --- | --- |
| 0:00–0:20 | Ismail | Title / CORPUS start page | Hook & problem |
| 0:20–0:45 | Nils | EBV-Portal → side panel → Explore app | One-time setup |
| 0:45–1:35 | Nils | CORPUS on dev.fuller.de | Stuck → Valo steps in, spotlight, plan |
| 1:35–2:00 | Luca | CORPUS | "Hey Valo" by voice |
| 2:00–2:30 | Ismail | Dashboard | Learning, Insights |
| 2:30–2:50 | Ismail | Dashboard (or slide 4) | What's different |
| 2:50–3:00 | Ismail | Title slide | Close |

---

### 0:00–0:20 · Hook & problem (Ismail)

*Screen: title slide, or the CORPUS start page (dev.fuller.de, "Fuller GmbH (Demo)").*

- "Our customer, Fuller GmbH, has its own business app: CORPUS. The app works. The problem is getting people to use it." *(DE: Fuller, eigene App, App läuft – Problem ist die Nutzung)*
- "Employees spend minutes looking for a function, ask a colleague, or go back to the old way. Training is forgotten a week later." *(DE: minutenlang suchen, Kollegen fragen, alter Weg, Schulung vergessen)*
- "We built Valo, a coach that sits in the browser, notices when you're stuck and shows you where to click." *(DE: Coach im Browser, merkt Feststecken, zeigt wohin)*

**Fallback:** none needed, just talk.

### 0:20–0:45 · One-time setup: Valo explores an app it has never seen (Nils)

*Screen: EBV-Portal tab (ebv-portal.vercel.app, signed in as admin) → open the side panel (⌘⇧L) → **Explore app**. Page counter runs ("Page n of up to 40").*

- "This is the EBV portal for Erasmus funding, a test system. Valo has never seen it." *(DE: EBV-Portal, Erasmus, Testsystem, nie gesehen)*
- "An admin presses 'Explore' once. Valo walks the app by itself, read-only. It never presses save, delete or send." *(DE: einmal Explore, liest nur, nie speichern/löschen/senden)*
- "No product tour, no manual. That's the whole setup. We'll see the result in the dashboard in a minute." *(DE: keine Tour, kein Handbuch, Ergebnis gleich im Dashboard)*

*Let it keep running in its tab and switch to CORPUS.*

**Fallback:** if Explore hangs or the portal is slow, stop it and say "We ran this before the pitch; here's what it found", then jump straight to Dashboard → Apps & features → Erasmus app (feature list + navigation tree). Last resort: Luca's video, shot 1 (`docs/demo-script.md`).

### 0:45–1:35 · Someone is stuck in CORPUS (Nils)

*Screen: CORPUS tab on dev.fuller.de. The orb in the corner shows Valo is active (auto-start, no click needed).*

*Prepared beforehand, agreed verbally, not written down: one task outside the vehicle module where a button is greyed out or a function is hard to find.*

1. *Nils clicks the grey button 5 times, or searches and gets an empty result.*
   - "I want to finish this, but the button is grey and nothing tells me why. I click again… and again." *(DE: Knopf grau, keiner sagt warum, nochmal klicken)*
2. *The orb lights up and Valo offers help without being asked → accept.*
   - "I didn't ask anything. Valo noticed I'm stuck, and a Gemini decision call checked that it's worth interrupting me." *(DE: nicht gefragt, Valo merkt's, Gemini entscheidet ob unterbrechen)*
3. *Spotlight on the right control; the rest of the page dims; multi-step plan in the side panel.*
   - "It doesn't click for me. It puts a spotlight on the right place and walks me through step by step. The plan moves on as I click." *(DE: klickt nicht selbst, Spotlight, Schritt für Schritt, geht mit)*
   - "And if I say 'no thanks' or rate it down, my personal threshold goes up: Valo gets quieter the better I get." *(DE: Nein/Daumen runter → Schwelle hoch → leiser)*

**Fallback:** if no offer appears within ~10 s, ask in the side panel by text: "How do I …?" → same spotlight and plan. If the spotlight lands on the wrong element: "It shows, it never acts, so a miss costs one second, not a wrong booking", then ask again with the exact function name. If CORPUS or the network is down: Luca's video, shot 4 (proactive offer) plus shot 3 (plan), from the EBV-Portal.

### 1:35–2:00 · "Hey Valo" by voice (Luca)

*Screen: still CORPUS. Luca speaks into the mic. Ask the prepared question in **German** (shows the language switch).*

- "Now by voice. The wake word model is our own. We trained it today on synthetic voices, and it runs in the browser: no audio leaves the laptop before 'Hey Valo'." *(DE: eigenes Wake-Word, heute trainiert, läuft lokal, kein Ton vorher raus)*
- *"Hey Valo, wie … ?"* (prepared question) → cursor glides, spotlight, short spoken answer in German.
- "I asked in German, it answered in German. Ask in English, it answers in English. It only speaks when a marker alone isn't enough." *(DE: Sprache der Frage, spricht nur wenn nötig)*

**Fallback:** wake word doesn't fire (room noise) → press **⌘⇧K** and ask: "Same pipeline, just the hotkey; in a loud room you'd use this." No sound from the speakers → point at the transcript and the answer in the side panel. Voice dead entirely → type the question; mention it once, move on.

### 2:00–2:30 · What the company sees (Ismail)

*Screen: Dashboard tab (https://691180.1.cloud.codesphere.com, signed in as admin).*

1. *Apps & features → Erasmus app:* "Here's what the exploration found: every feature, its click path, which role uses it." *(DE: Ergebnis der Erkundung, Klickpfade, Rollen)*
2. *Learning:* "Valo keeps learning from usage, but nothing becomes active without evidence from at least 5 people or an admin's approval. I approve or reject here." *(DE: lernt weiter, erst ab 5 Personen oder Freigabe)*
3. *Insights:* "And this is the question no one answers today: if people are still stuck after Valo showed them the way, the app needs fixing. If not, they need training." *(DE: nach Hinweis immer noch fest → App fixen, sonst Schulung)*
   - "Only aggregates, only from 5 people up, pseudonymized in the browser. We measure the interface, not the people." *(DE: nur Aggregate, ab 5, pseudonymisiert, Oberfläche nicht Menschen)*

**Fallback:** dashboard won't load (Codesphere / Wi-Fi) → switch to hotspot and reload; otherwise screenshots of Apps / Learning / Insights (prepare them!) or Luca's video, shot 2 + shot 6.

### 2:30–2:50 · What's different (Ismail)

*Screen: stay on Insights, or the "What's different" slide.*

- "WalkMe, Whatfix, Userlane: someone has to build tours by hand, and the hints never go away." *(DE: Touren von Hand, Hinweise bleiben)*
- "Copilot, Gemini in Chrome: they wait for your question, or they click for you, and you learn nothing." *(DE: warten auf Frage oder klicken selbst)*
- "Valo sets itself up in one run, steps in on its own, gets quieter the better you get, and tells the company whether to fix the app or train the people." *(DE: ein Lauf, meldet sich selbst, wird leiser, App vs. Schulung)*

### 2:50–3:00 · Close (Ismail)

- "Fuller wants to roll Valo out on CORPUS. Next step: install it company-wide through Chrome policy. No code change in the app." *(DE: Fuller will es einsetzen, nächster Schritt Chrome-Policy)*
- "Valo. Thank you."

**General fallback:** if two sections in a row fail, stop live-demoing and play Luca's recorded video (≈ 3:30, start at shot 3) while narrating over it. Keep it open in a tab, muted, ready to go.

---

## Jury questions: short answers

**"Doesn't WalkMe / Whatfix / Userlane do this?"**
They need tours built by hand and maintained when the app changes. Their hints never fade, and their analytics are mostly per user. Valo sets itself up with one exploration run, detects stuck moments live with a Gemini gate, fades per person, and reports aggregates only. Userlane is closest on privacy, but still needs hand-built guides.

**"Why not just use Gemini in Chrome / Copilot?"**
They wait for you to ask, they don't know your company's app, roles or click paths, and they tend to act for you. Valo knows the org's feature map, steps in on its own, never clicks, and gives the company insights. We do use Gemini underneath, with our own harness around it.

**"Isn't this employee surveillance?"**
It's built so it can't be used for that. Pseudonymization happens in the browser before anything is sent. Admins see only aggregates of at least 5 people, with no per-person views. Each person's threshold is private. Everyone can export and delete their own data. Blocked routes are never observed. In Germany a works-council agreement (§ 87 BetrVG) is needed anyway, and aggregate-only design makes that agreement easy.

**"Did you build CORPUS? Was this built before today?"**
No. CORPUS is Fuller's existing internal app. We run on its dev system with sample data and didn't touch its code, which is the point: no SDK, no code changes. The EBV-Portal is also an existing test system. Valo was built today. The only earlier code is a starter template (Next.js + Supabase) committed on 13 Nov, which we disclosed. The commit history shows the rest.

**"How reliable is it?"**
It isn't production-grade yet; it's one day old. It is designed so misses are cheap: it only shows and never acts, so a wrong marker costs a second, not a wrong booking. Proactive offers fire only above a calibrated confidence. Measured: first highlight ≈ 0.9 s, interrupt decision 0.2–0.5 s. Wake word: 96 % hits on unseen voices, < 1 % false triggers on sentences. Every model call is traced, and agent errors feed the learning loop.

**"What does it cost to run?"**
Most events never reach a model: local rules in the browser filter them, and only a stuck signal triggers a decision call. Simple "where do I click" questions go to the cheapest tier (flash-lite); only hard ones go to the big model. Each user also has a hard daily token budget. We haven't measured a per-seat cost yet, so we won't quote a number.

**"Data privacy / where does the data live?"**
Database, auth and vectors are on Supabase in Frankfurt (eu-central-1). The server never sees names, emails or IBANs, only placeholders. Gemini runs on a paid key, so there's no training on our data. Full EU residency for the model calls means moving to Vertex AI in an EU region. That's planned, not done.

**"What's the business model?"**
Per-seat SaaS for small and mid-sized companies that can't afford a WalkMe rollout. Install the extension and it's running. The buyer pays for the insights: "fix the app" vs. "train the people". Pricing isn't set yet; Fuller is our first customer.

**"What's next?"**
A pilot at Fuller on CORPUS with company-wide install via Chrome policy. A per-app blocklist managed in the dashboard. EU-region model hosting. Per-task fading, so Valo remembers what you already know.

**"How does Valo know the app?"**
From three sources: the one-time exploration (feature list, click paths, roles), the company's knowledge base, and agent memory learned from usage, which becomes active only with evidence from 5 people or an admin's approval. On the page it reads the live DOM, pseudonymized.

**"Why voice?"**
Many people who struggle with software are better at asking than at searching menus. The wake word runs locally, so audio leaves the laptop only after "Hey Valo". Valo talks only when a marker isn't enough.

**"What if the app changes?"**
The learning loop runs every 10 minutes and flags stale click paths and unknown features. Re-running the exploration updates the map. Nothing has to be re-recorded by hand.

---

## Before the stage (15 min before)

**Browser (one Chrome window, close everything else):**
- [ ] Tab 1: EBV-Portal (ebv-portal.vercel.app), signed in as admin
- [ ] Tab 2: CORPUS (dev.fuller.de), signed in, on a page outside the vehicle module
- [ ] Tab 3: Dashboard (https://691180.1.cloud.codesphere.com), signed in as admin, on Apps & features
- [ ] Tab 4: Luca's recorded video, muted and paused (fallback)
- [ ] Screenshots of Apps / Learning / Insights in a folder (fallback)
- [ ] Decide what Explore does live: if the Erasmus app already has features from rehearsal, Explore adds to them. Either clear them, or say "we ran it earlier" and show the result.

**Extension:**
- [ ] Valo loaded from the hosted `/install` ZIP (not a local build), pinned, signed in in the side panel
- [ ] Orb visible on EBV-Portal and CORPUS (reload both tabs once)
- [ ] "Read answers aloud" on, proactive help on
- [ ] One dry run: the stuck task in CORPUS plus one voice question in German
- [ ] Hotkeys ready: ⌘⇧L side panel, ⌘⇧K voice

**Audio & screen:**
- [ ] Mic allowed and set to the right input (headset if the room is loud)
- [ ] Sound on, volume up, output = speakers/HDMI, tested in the room
- [ ] Screen mirroring (not extended), browser zoom ~125 % so the back row can read
- [ ] Do Not Disturb on: no notifications, no Slack/Mail popups
- [ ] Phone hotspot on and joined once as Wi-Fi fallback

**Safety:**
- [ ] No passwords, keys or `.env` files visible: no open terminal, no password manager popup, no Supabase/Codesphere consoles
- [ ] Never open the vehicle module in CORPUS; don't name CORPUS functions out loud
- [ ] Timer on a phone: 3:00
