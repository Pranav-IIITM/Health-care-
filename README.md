# Dobara: OPD follow-up register

Round 1 prototype for the AI Synergy Hackathon 2026, **Track 03: Healthcare, “The Follow-Up Blind Spot”**.

*Dobara* (दोबारा) means “again”, as in *dobara dikhayen*: come back and see the doctor again.

## The problem

When an OPD clinician asks a patient to come back, the request lives only as free text on a slip. The hospital has no record of who is due, by when, why it matters or how to reach them. So the 28% who miss their window go unnoticed, and a small records team cannot tell which missed visits to chase first, or how.

Three linked failures sit behind it:

1. **The request is never captured.** “R/V 2/52 with CBC”, “SOS” and “2 hafte baad” never become a date anyone can track.
2. **Contact is checked too late.** Shared (19%) and unreachable (7%) numbers are found only after the miss, when the patient has gone.
3. **Misses have no owner or order.** Nothing says whom to call first.

The full reasoning, evidence labels and requirements are in [docs/problem-solution-brief.md](docs/problem-solution-brief.md).

## What the prototype does

| Step | What happens |
|---|---|
| Capture | At the OPD exit desk, a rule reader turns the clinician’s words into a proposed date and a list of things to bring. It understands clinical shorthand (2/52, 6/12), Hinglish and Hindi, ignores medicine courses (“x 14 days”), moves dates to days the clinic actually runs, and flags anything it cannot read safely. The nurse confirms. |
| Check contact | While the patient is still at the desk: the phone number, whether it is shared, the language for texts, and what they agree to (texts, calls, caregiver, ASHA visit). They leave with a slip in Hindi and English. |
| Track | Each follow-up gets a window based on the clinician’s importance level. A reminder goes two days before, with consent. Registration records the return. |
| Recover | Missed follow-ups go into one list, in an order set by a published points rule, and are contacted the way the patient agreed. Clinical questions go to a nurse. Nothing is closed without a reason. |

Who decides what:

- **The system** proposes dates, flags problems, does date arithmetic, orders the list and fills in fixed message wording.
- **People** confirm every follow-up, set its importance, make the calls, answer clinical questions and close cases.

The system never diagnoses, triages, changes treatment or gives medical advice.

## Run it

Needs Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 50 tests: reader, acceptance checks, dataset, UI flows
npm run build      # production build in dist/
```

Everything runs offline in the browser. Demo data lives in your browser’s local storage. Use **Reset** in the grey strip to start again.

### Optional: Gemini cross-check (free tier)

The rule reader works on its own. To add Gemini as a second reader:

1. Get a free API key from Google AI Studio.
2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. `GEMINI_MODEL` is optional; the default is `gemini-3.5-flash-lite`.
3. Restart `npm run dev`. A **Check with Gemini** button appears on the follow-up desk.

The key stays on the dev server. Only the instruction text is sent, with phone and registration numbers removed. Gemini’s answer is kept only where it quotes the instruction word for word. If it disagrees with the rule reader, the nurse decides.

On the free tier, Google may use what is sent to improve its products, so use it with simulated data only.

## A five-minute demo

1. **Follow-up desk.** Switch “Viewing as” to *OPD nurse*. Open **Sunita Devi**: “2/52” is highlighted and “x 14 days” is set aside. Choose an importance level, tick what she agrees to, and save to see the slip.
2. Open **Ramesh Kushwaha** (“1 wk / 10 days”). Both dates are offered and nothing is pre-chosen. Also try **Kamla Bai** (SOS), **Arjun Rawat** (“if fever persists”) and **Imran Khan** (“after completing ATT”).
3. **Worklist.** The call queue is ordered by points, and each row says why. Open a patient to see the call script, the privacy-safe text and the history, and record an outcome.
4. Switch to *records staff* and try to close a must-not-miss case. It is refused: only a nurse can.
5. Click **Next week** in the grey strip. Simulated registrations come in, and new misses appear.
6. **Registration.** Search for a patient on the worklist and check them in.
7. **About this prototype.** Read the brief and run the 16 acceptance checks.

## Project layout

```
src/core/          Pure TypeScript, no UI. All rules live here and are tested.
  reader.ts          Rule reader for clinicians' instructions
  secondReader.ts    Gemini contract: response schema, identifier scrubbing, grounding check, merge
  policy.ts          Hospital settings: OPD days, grace windows, ranking weights
  tracking.ts        Due, missed and returned (date arithmetic only)
  worklist.ts        Lanes, contact route, points rule
  actions.ts         Every state change, with role and consent rules and an audit entry
  contact.ts         Fixed message templates and call script
  slip.ts            Bilingual patient slip
  metrics.ts         Today page figures and the fairness check
  seed.ts            Simulated dataset (fixed seed)
  acceptance.ts      The 16 acceptance checks (run by the tests and the About page)
src/pages/         Today, Follow-up desk, Worklist, Registration, Audit trail, About
server/            Optional Gemini endpoint, served by the Vite dev server
tests/             Vitest suites
docs/              Problem and solution brief
```

## Data and licences

- All patients, phone numbers, places and outcomes are **simulated** from a fixed seed. Proportions follow the case file (28% missed, 19% shared phones, 7% unreachable). They are not real statistics about any hospital.
- Built with React, Vite, TypeScript and Vitest. Optional `@google/genai` for the Gemini cross-check.
- IBM Plex Sans, Plex Sans Devanagari and Plex Mono are bundled locally through Fontsource (SIL Open Font License). There are no web font or CDN calls, so the app works offline.
