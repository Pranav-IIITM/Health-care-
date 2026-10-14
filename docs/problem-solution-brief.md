# The follow-up blind spot: problem and solution brief

AI Synergy Hackathon 2026, Round 1. Track 03: Healthcare.

Evidence labels used throughout: **CASE** (from the case file), **EXTERNAL** (independent source, cited), **ASSUMPTION** (believed, not yet verified), **UNKNOWN** (could change the decision).

---

## 1. The case in brief

A district hospital runs high-volume outpatient clinics. Clinicians can tell who needs to come back, but the hospital struggles to make sure those patients return at the right time with the right information. The hospital wants fewer avoidable losses to follow-up without any unsafe automated medical decisions.

Stakeholders: patients and caregivers; doctors and nurses; registration and records staff; community health workers (ASHA); hospital administration.

## 2. Evidence

| Label | Claim | What it means for the design |
|---|---|---|
| CASE | About 900 outpatient visits a day. | Any step per patient has to take seconds. |
| CASE | 28% of patients marked for follow-up did not return within the recommended window (three-month sample). | Baseline for the main measure: 72% on time. |
| CASE | Follow-up instructions are free text and vary by clinician. | No system holds a due date, so nobody can see a miss. This is the root of the problem. |
| CASE | 19% of records share a household phone; 7% have an unreachable number. | About a quarter of patients cannot be reached safely by a plain text. Contact has to be checked while the patient is present. |
| CASE | A small records team cannot prioritise every missed appointment. | Staff need one list, in order, with a reason on every row. |
| CASE | Clinical teams reject any system that diagnoses, changes treatment or gives emergency advice. | Importance comes from the clinician. Software never reads symptoms or diagnoses. |
| ASSUMPTION | 20–30% of OPD visits end with a follow-up request: about 180–270 a day, so 50–75 new misses a day at 28%. | Around 1,500–2,300 misses a month. Calling everyone by hand is not possible. |
| ASSUMPTION | A records clerk can make 40–50 contact attempts a day (8–10 minutes each, with logging). | Order matters more than speed. |
| ASSUMPTION | The OPD exit desk can spend 60–90 seconds per patient. | Confirmation must be one page, with the answers already proposed. |
| UNKNOWN | Which missed visits are clinically important. | Not guessed. The clinician ticks routine, important or must not miss. |
| UNKNOWN | How well the rule reader copes with this hospital’s real notes. | Measured in the Build Round on de-identified notes, by nurse correction rate. |
| UNKNOWN | Which contact routes patients will agree to. | Asked one by one at the desk. The route follows the answers. |
| EXTERNAL | A Cochrane review of 8 trials found low to moderate quality evidence that text reminders increase attendance compared with no reminder, with a similar effect to phone-call reminders. [1] | Reminders are worth sending, but they are only one part of the answer. |
| EXTERNAL | India’s Digital Personal Data Protection Act, 2023 (s.6) expects consent that is free, specific, informed, unconditional and unambiguous, by a clear affirmative action. [2] | Each contact route is asked separately, nothing is pre-ticked, and the date and role are recorded. |
| EXTERNAL | On the Gemini API free tier, Google may use inputs and outputs to improve its products and human reviewers may read them; the terms say not to submit sensitive or personal information. [3] | Free tier with simulated data only. Only the instruction text is sent, with numbers removed. |

## 3. Problem framings compared

| Framing | Main stakeholder | Verdict |
|---|---|---|
| Send automatic reminders | Patients | Needs a due date that does not exist yet; fails the quarter of patients on shared or dead numbers; does nothing for misses already piling up. Kept as one component. |
| Predict who will miss, or score clinical urgency | Administration | No recorded outcomes to learn from; staff could not see why a score was given; judging urgency belongs to clinicians under the case boundary. |
| Solve transport and distance | Patients far away | Real, but outside the OPD and dependent on funding. The worklist records barriers so the case can be made later. |
| **Record the follow-up properly, then track and recover the misses** | Patients and caregivers (benefit); OPD nurse and records staff (use it) | **Chosen.** Fixes the root cause, uses the one moment the patient is present to check contact and consent, and gives staff an order they can explain. Needs no clinical judgement from software. Buildable and testable in a week. |

What changes if a different stakeholder is primary: with the **records team** as primary, the answer drifts towards a better call list; with **administration**, towards prediction and dashboards. Putting **patients and caregivers** first is what moves the fix upstream, to the desk, while the patient is still present.

## 4. Problem statement

> When an OPD clinician asks a patient to come back, the request lives only as free text on a slip. The hospital has no record of who is due, by when, why it matters or how to reach them. So the 28% who miss their window go unnoticed, and a small records team cannot tell which missed visits to chase first, or how.

It is worth solving because every later step (reminders, recovery, measurement) depends on the missing record. It is tractable because the instruction language is narrow and formulaic. It is testable because “missed” and “returned” are facts in registration data.

## 5. Solution: LoopBack

1. **Capture.** A rule reader proposes a due date and bring list from the clinician’s words. It handles clinical shorthand (n/7, n/52, n/12), Hinglish and Devanagari; ignores medicine durations; aligns to the clinic’s OPD days; and flags contradictions, conditions, events and missing dates as decisions for a person. The OPD nurse confirms.
2. **Check contact.** With the patient present: number, shared or not, language, and consent per route. The patient leaves with a bilingual slip that carries the clinician’s return precautions word for word.
3. **Track.** The window comes from the confirmed date plus a grace period set by importance (3, 5 or 7 days, shorter for short intervals). A reminder goes two days before, with consent. Registration records the return.
4. **Recover.** Misses go into one ordered list. The route follows consent: phone, caregiver, ASHA visit, or an alert at the next visit. Clinical questions go to a nurse.

Optional second reader: Gemini (free tier) can cross-check the reading. Its answer is kept only where its evidence appears word for word in the instruction. Agreement is noted; disagreement becomes a decision for the nurse.

## 6. Basic SRS and implementation plan

### 6.1 Users and roles

| Role | Uses | Can |
|---|---|---|
| OPD nurse | Follow-up desk, nurse review | Confirm follow-ups; record contact and consent; see the clinician’s note; close any case with a reason |
| Records staff | Worklist, registration | Send reminders and texts; call; log outcomes; escalate; close routine and important cases with a reason |
| ASHA worker | ASHA visit list | Log home-visit outcomes; escalate |
| Hospital admin | Today page, audit trail | Read only |
| Clinician | (writes the instruction and ticks importance on the OPD slip) | Settle anything flagged “decide” |

### 6.2 Inputs and outputs

- **Inputs:** the clinician’s instruction (free text), department, visit date, importance tick, patient registration details, contact details and consent from the desk, registration check-ins, call and visit outcomes.
- **Outputs:** a confirmed follow-up record, a bilingual patient slip, reminder and missed-visit texts (fixed templates), an ordered worklist per lane, the Today page figures and fairness check, and an audit trail.

### 6.3 Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | The desk lists patients leaving OPD with the clinician’s instruction and a proposed reading. Nothing is saved until the OPD nurse confirms. |
| FR-2 | The reader proposes a due date from intervals (including clinical shorthand, Hinglish and Hindi), explicit dates and weekdays; ignores medicine durations; moves the date to the department’s next OPD day. |
| FR-3 | The reader never invents a date. SOS and as-needed, event-based, conditional and contradictory instructions are flagged for a person to decide. |
| FR-4 | Importance (routine, important, must not miss) is set by the clinician and recorded by the nurse. The system only points out emphasis words. |
| FR-5 | A follow-up is missed when its window closes without a registration visit. A return is recorded only from registration. |
| FR-6 | Reminder texts go two days before the due date, only to patients who agreed to texts. |
| FR-7 | Misses are listed in one order by a published points rule. Phone access and distance change the route, never the rank. |
| FR-8 | Contact uses only routes the patient agreed to; otherwise the patient is flagged for registration. |
| FR-9 | Texts use fixed templates that never include the department, tests, diagnosis or clinician’s words. Shared phones get household wording. |
| FR-10 | Staff log every attempt with an outcome. Clinical questions and support needs go to a nurse. Retries are scheduled. |
| FR-11 | No follow-up is closed without a recorded reason. Must-not-miss cases and closures for declined, deceased or clinician-cancelled need a nurse. Only a registration visit resolves a case automatically. |
| FR-12 | The optional Gemini reader receives only scrubbed instruction text. Its answer is kept only where it quotes the instruction; disagreements go to the nurse. |
| FR-13 | Every action, and every view of a full phone number or the clinician’s note, is written to the audit trail with date and role. |
| FR-14 | The Today page shows open and uncontacted misses, on-time and recovery rates, the fairness check by contact group, and how often nurses corrected the reader. |

### 6.4 AI and human responsibilities

| Step | System | People |
|---|---|---|
| Reading the instruction | Rule reader proposes; Gemini optionally cross-checks; both flag what they cannot read | Nurse confirms or corrects every field; clinician settles flags |
| Importance | Points out emphasis words | Clinician sets; nurse records |
| Missed / returned | Date arithmetic; registration feed | Registration checks patients in |
| Order of work | Points rule, reason on every row | Staff work from the top; can escalate |
| Contact | First consented route; fixed message wording | Patient consents; staff call and text |
| Clinical questions | Never answered | Nurse or clinician |
| Closing | Never, except a registration visit | Records or nurse, always with a reason |

### 6.5 Constraints

- No diagnosis, triage, treatment change or medical advice anywhere in the software.
- Works offline. The rule reader runs in the browser; Gemini is optional.
- Consent per contact route, recorded with date and role; nothing pre-ticked.
- No patient identifiers sent to any AI service.
- Due dates respect each department’s OPD days and fixed public holidays.

### 6.6 When information is missing, conflicting or unreliable

| Situation | Behaviour |
|---|---|
| No time in the instruction | No date proposed; flagged “decide”; nurse asks the clinician or records “no fixed date” with a reason |
| Two different times (“1 wk / 10 days”) | Both shown; nothing pre-selected |
| “If fever persists”, “after completing ATT”, “2 weeks after surgery” | Flagged; a person decides whether and when to track |
| “6/12” could be a date or six months | Read as six months, flagged to check |
| Medicine durations (“x 14 days”) | Set aside, shown as such |
| Date on a day the clinic does not run | Moved to the next OPD day, with the reason shown |
| Shared phone | Household wording only; privacy script for calls |
| Wrong number | Number marked unreachable; next consented route used |
| No consented route | Registration alert; must-not-miss goes to a nurse |
| Gemini unavailable, slow, over quota or ungrounded | Rule reading stands; reason shown; ungrounded parts discarded |

### 6.7 Acceptance tests

The 16 checks below run in `npm test` and on the About page.

| ID | Check | Covers |
|---|---|---|
| AT-01 | Shorthand becomes a proposed date; nothing saves until the nurse confirms | FR-1, FR-2 |
| AT-02 | No date is invented for SOS | FR-3 |
| AT-03 | Contradictory instructions are shown side by side, not resolved | FR-3 |
| AT-04 | Medicine durations are not taken as the follow-up time | FR-2 |
| AT-05 | Conditional and event-based returns need a human decision | FR-3 |
| AT-06 | Importance is never set by the system | FR-4 |
| AT-07 | No message names the department, a test or the clinician’s words | FR-9 |
| AT-08 | Reachability changes the route, never the rank | FR-7 |
| AT-09 | Must-not-miss comes first; routine patients rise as they wait | FR-7 |
| AT-10 | Nothing is closed silently | FR-11 |
| AT-11 | The clinician’s note is visible to nurses only | Privacy |
| AT-12 | “Missed” is date arithmetic; “returned” comes from registration | FR-5 |
| AT-13 | Due dates land on days the OPD runs | FR-2 |
| AT-14 | Gemini’s answer is kept only where it quotes the instruction | FR-12 |
| AT-15 | Identifiers are removed before any text goes to Gemini | FR-12 |
| AT-16 | Every contact route needs recorded consent | FR-8 |

### 6.8 What version 1 will not do

- Diagnose, triage, change treatment or give medical advice.
- Predict who will miss, or judge clinical urgency.
- Contact anyone without recorded consent for that route. Texts go through a simulated gateway.
- Close a follow-up by itself, other than a return seen at registration.
- Send names, phone numbers or registration numbers to any AI service.
- Connect to the hospital information system, or book transport.

## 7. How we will know it works

| Measure | Definition | Baseline / target |
|---|---|---|
| Main outcome | Follow-ups returned within the window | Case baseline 72%; report the change, no promised number |
| Recovery | Misses that return within 30 days of the window closing | Measured from the first pilot week |
| Process | Confirmed date and checked contact at the desk; days from miss to first contact; misses never contacted | Never-contacted must-not-miss misses older than 2 working days: zero |
| Harm and exclusion | On-time and recovery gaps between own-phone, shared-phone and unreachable patients (and by distance) | Review if a gap exceeds 10 percentage points |
| Privacy | Texts revealing clinic, test or diagnosis | Zero (AT-07) |
| Reader quality | Nurse corrections per field; Gemini disagreement rate | Tracked weekly |

Comparison: four weeks before against four weeks after, in one OPD (Medicine), from registration records.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Nurses accept proposals without reading them | Decide-flags block auto-fill; corrections are tracked; audit trail |
| The rule reader misses a phrasing used locally | Flags instead of guesses; Gemini as optional second reader; vocabulary extended from correction data |
| Shared phones reveal sensitive visits | Household wording, no clinic or test names, privacy script, AT-07 |
| Hard-to-reach patients fall further behind | Route by consent, not rank; ASHA lane; fairness check on the Today page |
| Free-tier AI used with real patient text | Off by default; identifiers scrubbed; documented as simulated-data only; production needs a paid tier or an on-premise model under a data agreement |

## 9. Build Round plan

1. Import a de-identified sample of real follow-up instructions; measure reader accuracy and extend the vocabulary.
2. Replace the simulated registration feed with a CSV or HL7 import from the hospital’s registration system.
3. Connect a real SMS gateway behind the same templates and consent checks.
4. Add a printed or WhatsApp-friendly ASHA visit list.
5. Run the four-week before/after comparison in one OPD.

## 10. References

1. Gurol-Urganci I, de Jongh T, Vodopivec-Jamsek V, Atun R, Car J. Mobile phone messaging reminders for attendance at healthcare appointments. *Cochrane Database of Systematic Reviews* 2013, Issue 12, CD007458. https://www.cochrane.org/CD007458
2. Digital Personal Data Protection Act, 2023 (India), section 6. https://www.dpdpa.com/dpdpa2023/chapter-2/section6.html
3. Gemini API Additional Terms of Service. https://ai.google.dev/terms

## 11. Declarations

- **Data:** every patient, phone number, place and outcome is simulated from a fixed seed. Proportions follow the case file and are not real statistics.
- **Reused components:** React, Vite, TypeScript, Vitest, Testing Library, Fontsource IBM Plex fonts (SIL OFL), `@google/genai` (optional). No templates or UI kits.
