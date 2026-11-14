# Valo — demo video script (≈ 3:30, cut freely)

**Story in one line:** Business software is built for digital natives. Valo sits next to everyone else — the older
colleague, the career changer, the person who works in their second language — and shows them where to click,
by voice, without ever clicking for them.

Say the lines in your own words; they are orientation, not a teleprompter. *Italic* = what is on screen.

## Before recording

- Fresh demo DB (`npx supabase db reset` → Erasmus app has no features yet), server `:3001`, dashboard `:3000`, demo CRM `:4000` running.
- `chrome://extensions` → reload Valo. Sign in to the extension as `admin@demo.test`.
- Wake word: use **"Hey Jarvis"** or the hotkey **⌘⇧K** (our own "Hey Valo" model triggers too often in conversation):
  service worker console → `chrome.storage.local.set({"lotse:voice-config": {keyword: "hey_jarvis"}})`.
- Side panel: "Read answers aloud" on. Mic allowed. System sounds and notifications off. Close other tabs.
- Tabs in this order: EBV-Portal (signed in), Kundenwerk CRM (`localhost:4000`), dashboard (`localhost:3000`).
- Have a mobility in status **"In Prüfung" / "zu prüfen"** with open checklist items ready for shot 4.

---

## 0 · Hook (0:00–0:20)

*Face or title card.*

> "Millions of people use business software every day that was never designed for them. Not everyone grew up with
> computers. When they get stuck, they ask a colleague, call the helpdesk — or give up quietly.
> We built Valo: a voice assistant that sits in the browser and shows people where to click."

## 1 · Valo learns a new app on its own (0:20–0:50)

*EBV-Portal as admin → side panel → "Explore app". Valo walks through the portal, page counter "Page 7 of up to 40" (speed up 4×).*

> "This is the EBV portal for Erasmus funding. Valo has never seen it. As an admin I press 'Explore', and Valo
> walks through the app by itself — up to 40 pages, read-only. It never presses delete, save or send."

## 2 · The memory is there (0:50–1:10)

*Dashboard → Apps & features → Erasmus-Förderhelfer: feature list + navigation tree. Optionally Learning → design findings.*

> "A minute later the dashboard knows the app: every feature, the click path to get there, which role may use it.
> No one wrote a manual or built a product tour. That's the knowledge Valo now uses to help people."

## 3 · Two questions by voice (1:10–1:50)

*Back to the portal. Wake word / ⌘⇧K → ask question 1 → cursor glides to the element, orange highlight, short spoken answer.
Then question 2 (ideally a multi-step one → step-by-step plan).*

Pick two features from the freshly explored list, e.g.:
- "Wo lege ich eine neue Mobilität an?"
- "Wie lade ich die Teilnehmerliste hoch?"

> "I just ask — in German, in English, however I talk. Valo doesn't explain the whole app; it points at the exact
> button and says one short sentence. For longer tasks it walks me through step by step, and it moves on as I click.
> It never clicks for me — people stay in control, and they actually learn the software."

## 4 · Valo notices on its own (1:50–2:20)

*Mobility in status "In Prüfung". Click the grey "Förderung genehmigen" button two or three times. The orb lights up,
Valo offers help without being asked → accept → Valo scrolls down and points at the checklist with the open items.*

> "Here's the part I love. I want to approve this funding, but the button is grey — and nobody tells me why.
> I click again. Valo notices I'm stuck — I didn't ask anything — and offers help. It shows me: these checklist items
> still have to be done first. That's exactly the moment where people usually give up or call someone."

## 5 · Plug and play (2:20–2:40)

*Switch the tab to Kundenwerk CRM. The orb switches to this app automatically. Ask: "Wo ändere ich die IBAN eines Kunden?"*

> "And it's plug and play. I switch to a completely different app — a CRM. No integration, no setup. Valo knows
> which app this is and answers in its context: here's where the bank details live."

## 6 · What the company learns (2:40–3:10)

*Dashboard → Trainings: the suggested training with "Asked by 61 people · 134 questions"; expand "5 more". Optionally Insights.*

> "For the company, every question is a signal. Valo turns them into trainings: 61 people asked about the offer
> workflow this month — so that's the training to run next. Admins see where the software loses people, never who:
> only aggregates, only from five people up, and everything personal is pseudonymized in the browser before it leaves."

## 7 · Close (3:10–3:30)

*Architecture slide or README chart.*

> "Under the hood: Gemini for perception, decisions and speech, our own agent harness for sub-second guidance, a wake
> word that runs locally — no audio leaves the laptop before you call Valo. Valo helps people who were never the
> target group of enterprise software to feel confident with it. Thank you."

---

**Fallbacks while recording:** wake word misfires → use ⌘⇧K and cut. Exploration slow → cut to the result.
Valo points at the wrong element → re-ask with the feature name from the dashboard; keep the better take.
