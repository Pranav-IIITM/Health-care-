import { useState } from 'react';
import { runAcceptanceChecks, type AcceptanceCheck, type CheckResult } from '../core/acceptance';
import { EQUITY_GAP_ALERT_PP } from '../core/policy';
import { SummaryList } from '../components/ui';
import { href } from '../state/router';

type Ev = 'case' | 'external' | 'assumption' | 'unknown';

const EV_LABEL: Record<Ev, string> = { case: 'CASE', external: 'EXTERNAL', assumption: 'ASSUMPTION', unknown: 'UNKNOWN' };

const EVIDENCE: { kind: Ev; claim: string; soWhat: string; source?: { label: string; url: string } }[] = [
  { kind: 'case', claim: 'About 900 outpatient visits a day.', soWhat: 'Any step per patient has to take seconds.' },
  {
    kind: 'case',
    claim: '28% of patients marked for follow-up did not return within the recommended window (three-month sample).',
    soWhat: 'Baseline for the main measure: 72% on time.',
  },
  {
    kind: 'case',
    claim: 'Follow-up instructions are free text and vary by clinician.',
    soWhat: 'No system holds a due date, so nobody can see a miss. This is the root of the problem.',
  },
  {
    kind: 'case',
    claim: '19% of records share a household phone and 7% have an unreachable number.',
    soWhat: 'About a quarter of patients cannot be reached safely by a plain text. Contact has to be checked while the patient is at the desk.',
  },
  { kind: 'case', claim: 'A small records team cannot prioritise every missed appointment.', soWhat: 'Staff need one list, in order, with a reason on every row.' },
  {
    kind: 'case',
    claim: 'Clinical teams reject any system that diagnoses, changes treatment or gives emergency advice.',
    soWhat: 'Importance comes from the clinician. The system never reads symptoms or diagnoses.',
  },
  {
    kind: 'assumption',
    claim: '20 to 30% of OPD visits end with a follow-up request: about 180 to 270 a day, so 50 to 75 new misses a day.',
    soWhat: 'Around 1,500 to 2,300 misses a month. Calling everyone by hand is not possible.',
  },
  {
    kind: 'assumption',
    claim: 'A records clerk can make 40 to 50 contact attempts a day, at 8 to 10 minutes each with logging.',
    soWhat: 'The order matters more than the speed. The first calls of the day must reach the right people.',
  },
  { kind: 'assumption', claim: 'The OPD exit desk can spend 60 to 90 seconds per patient.', soWhat: 'Confirming is one page, with the answers already proposed.' },
  { kind: 'unknown', claim: 'Which missed visits are clinically important.', soWhat: 'Not guessed. The clinician ticks routine, important or must not miss.' },
  {
    kind: 'unknown',
    claim: 'How well the reader copes with this hospital’s real notes.',
    soWhat: 'Measured in the Build Round on de-identified notes, by how often nurses correct it.',
  },
  { kind: 'unknown', claim: 'Which ways of being contacted patients will agree to.', soWhat: 'Asked one by one at the desk. The contact route follows the answers.' },
  {
    kind: 'external',
    claim: 'A Cochrane review of 8 trials found low to moderate quality evidence that text reminders increase attendance compared with no reminder, with a similar effect to phone-call reminders.',
    soWhat: 'Reminders are worth sending, but they are one part of the answer.',
    source: { label: 'Gurol-Urganci et al., Cochrane review CD007458, 2013', url: 'https://www.cochrane.org/CD007458' },
  },
  {
    kind: 'external',
    claim: 'India’s Digital Personal Data Protection Act, 2023 (section 6) expects consent that is free, specific, informed, unconditional and unambiguous, given by a clear affirmative action.',
    soWhat: 'Each way of contacting is asked separately, nothing is ticked in advance, and the date and role are recorded.',
    source: { label: 'DPDP Act 2023, section 6', url: 'https://www.dpdpa.com/dpdpa2023/chapter-2/section6.html' },
  },
  {
    kind: 'external',
    claim: 'On the free tier of the Gemini API, Google may use what is sent to improve its products, and people may read it. The terms say not to send sensitive or personal information.',
    soWhat: 'The free tier is used with simulated data only. Only the instruction text is sent, with numbers removed.',
    source: { label: 'Gemini API Additional Terms of Service', url: 'https://ai.google.dev/terms' },
  },
];

const FRAMINGS: { name: string; who: string; verdict: string; chosen?: boolean }[] = [
  {
    name: 'Send automatic reminders',
    who: 'Patients',
    verdict: 'Needs a due date that does not exist yet. Fails the quarter of patients on shared or dead numbers. Does nothing for misses already piling up. Kept as one part of the design.',
  },
  {
    name: 'Predict who will miss, or score clinical urgency',
    who: 'Hospital administration',
    verdict: 'There are no recorded outcomes to learn from, staff could not see why a score was given, and judging urgency is the clinician’s job under the case rules.',
  },
  {
    name: 'Solve transport and distance',
    who: 'Patients who live far away',
    verdict: 'A real problem, but outside the OPD and dependent on funding. The worklist records what stops people coming, so the case for it can be made.',
  },
  {
    name: 'Record the follow-up properly, then track and recover the misses',
    who: 'Patients and caregivers. Used by the OPD nurse and records staff.',
    verdict: 'Fixes the root cause, uses the one moment the patient is present to check contact details and consent, and gives staff an order they can explain. Needs no clinical judgement from software, and can be built and tested in a week.',
    chosen: true,
  },
];

const RESPONSIBILITIES: { step: string; system: string; people: string }[] = [
  {
    step: 'Reading the instruction',
    system: 'Proposes the date and what to bring. Flags contradictions, conditions and missing dates. Gemini can give a second reading.',
    people: 'The nurse confirms or corrects every field. The clinician settles anything flagged.',
  },
  { step: 'Importance', system: 'Points out emphasis words the clinician wrote.', people: 'The clinician sets it. The nurse records it.' },
  { step: 'Deciding a visit was missed', system: 'Date arithmetic on confirmed dates. A return comes only from registration.', people: 'Registration checks the patient in.' },
  { step: 'Order of calls', system: 'Applies the published points rule and shows the reason on every row.', people: 'Staff work from the top and can send any case to a nurse.' },
  { step: 'How to contact', system: 'Uses the first route the patient agreed to.', people: 'The patient agrees route by route. A nurse can change the route.' },
  { step: 'Text messages', system: 'Fills in fixed, approved wording with no clinical content.', people: 'Records staff send texts and make calls.' },
  { step: 'Clinical questions', system: 'Never answers them.', people: 'A nurse or the clinician.' },
  {
    step: 'Closing a case',
    system: 'Never closes one, except when registration shows the patient came back.',
    people: 'Records staff for routine and important cases, a nurse for the rest, always with a reason.',
  },
];

export function BriefPage() {
  const [results, setResults] = useState<(AcceptanceCheck & CheckResult)[] | null>(null);
  const passed = results?.filter((r) => r.pass).length ?? 0;

  return (
    <>
      <span className="caption">About this prototype · AI Synergy Hackathon 2026, Round 1</span>
      <h1>The follow-up blind spot</h1>
      <p className="lead" style={{ marginBottom: 30 }}>
        Track 03 gives a problem space, not a problem. This page sets out the problem we chose, the evidence behind it, and how the prototype responds. Every
        claim is labelled: case file, outside source, assumption or unknown.
      </p>

      <section className="statement">
        <h2>Problem statement</h2>
        <p>
          When an OPD clinician asks a patient to come back, the request lives only as free text on a slip. The hospital has no record of who is due, by when,
          why it matters or how to reach them. So the 28% who miss their window go unnoticed, and a small records team cannot tell which missed visits to
          chase first, or how.
        </p>
      </section>

      <section className="section">
        <h2>Three failures behind it</h2>
        <ol className="steps steps--3">
          <li>
            <h3>The request is never captured</h3>
            <p>“R/V 2/52 with CBC”, “SOS” and “2 hafte baad” never become a date anyone can track.</p>
          </li>
          <li>
            <h3>Contact is checked too late</h3>
            <p>Shared and dead numbers are found only after the miss, when the patient has left.</p>
          </li>
          <li>
            <h3>Misses have no owner or order</h3>
            <p>Nothing says whom to call first. Routine and must-not-miss patients look the same on paper.</p>
          </li>
        </ol>
        <p>
          <strong>Who it is for:</strong> patients and caregivers. It is used by the OPD nurse, records staff and ASHA workers. Clinicians stay in charge of
          anything clinical.
        </p>
      </section>

      <section className="section">
        <h2>Evidence</h2>
        <div className="table-wrap">
          <table className="table table--register">
            <thead>
              <tr>
                <th>Type</th>
                <th>Claim</th>
                <th>What it means for the design</th>
              </tr>
            </thead>
            <tbody>
              {EVIDENCE.map((e) => (
                <tr key={e.claim}>
                  <td>
                    <span className={`ev ev-${e.kind}`}>{EV_LABEL[e.kind]}</span>
                  </td>
                  <td>
                    {e.claim}
                    {e.source ? (
                      <span className="cell-sub">
                        <a href={e.source.url} target="_blank" rel="noreferrer">
                          {e.source.label}
                        </a>
                      </span>
                    ) : null}
                  </td>
                  <td>{e.soWhat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Framings we compared</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Framing</th>
              <th>Main stakeholder</th>
              <th>Why we did or did not choose it</th>
            </tr>
          </thead>
          <tbody>
            {FRAMINGS.map((f) => (
              <tr key={f.name}>
                <td style={{ fontWeight: 600, minWidth: 200 }}>
                  {f.name}
                  {f.chosen ? (
                    <span className="cell-sub">
                      <strong className="tag tag--green">Chosen</strong>
                    </span>
                  ) : null}
                </td>
                <td>{f.who}</td>
                <td>{f.verdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <h2>How the prototype closes the loop</h2>
        <ol className="steps">
          <li>
            <h3>Capture</h3>
            <p>The reader proposes a date and a list of things to bring from the clinician’s words, and flags what it cannot read. The nurse confirms.</p>
          </li>
          <li>
            <h3>Check contact</h3>
            <p>While the patient is at the desk: the number, whether it is shared, the language, and what they agree to. They leave with a slip in Hindi and English.</p>
          </li>
          <li>
            <h3>Track</h3>
            <p>The window is set from confirmed dates and the days each OPD runs. A reminder goes two days before, with consent. Registration records the return.</p>
          </li>
          <li>
            <h3>Recover</h3>
            <p>Misses go into one list, ordered by a published rule, and are contacted the way the patient agreed: call, caregiver, ASHA visit or an alert at registration.</p>
          </li>
        </ol>
        <p>
          <a className="button" href={href('desk')}>
            Start at the follow-up desk
          </a>
        </p>
      </section>

      <section className="section">
        <h2>Who decides what</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Step</th>
              <th>The system</th>
              <th>People</th>
            </tr>
          </thead>
          <tbody>
            {RESPONSIBILITIES.map((r) => (
              <tr key={r.step}>
                <td style={{ fontWeight: 600 }}>{r.step}</td>
                <td>{r.system}</td>
                <td>{r.people}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid grid-1-1 section">
        <section>
          <h2>What version 1 will not do</h2>
          <ul>
            <li>Diagnose, triage, change treatment or give medical advice.</li>
            <li>Predict who will miss, or judge clinical urgency from notes.</li>
            <li>Contact anyone in a way they have not agreed to. Texts go through a simulated gateway.</li>
            <li>Close a follow-up by itself, except when registration shows the patient came back.</li>
            <li>Send names, phone numbers or registration numbers to any AI service.</li>
            <li>Connect to the hospital information system, or book transport.</li>
          </ul>
        </section>
        <section>
          <h2>How we will know it works</h2>
          <SummaryList
            compact
            rows={[
              { key: 'Main measure', value: 'Share of follow-ups returned within the window. Case baseline: 72%.' },
              { key: 'Recovery', value: 'Share of misses that come back within 30 days of the window closing.' },
              { key: 'Process', value: 'Follow-ups with a confirmed date and checked contact. Days from a miss to first contact. Misses never contacted.' },
              {
                key: 'Harm and exclusion',
                value: `Gap in on-time and recovery rates between own-phone, shared-phone and unreachable patients. Reviewed above ${EQUITY_GAP_ALERT_PP} points. Texts that reveal a clinic, test or diagnosis: none, checked by AT-07.`,
              },
              { key: 'Reader quality', value: 'How often nurses correct the proposal, and how often Gemini and the rule reader disagree.' },
              { key: 'Comparison', value: 'Four weeks before against four weeks after, in one OPD, from registration records.' },
            ]}
          />
        </section>
      </div>

      <section className="section">
        <h2>Acceptance checks</h2>
        <p>The same 16 checks run in the automated tests. They call the same code the pages use.</p>
        <div className="button-group">
          <button type="button" className="button" onClick={() => setResults(runAcceptanceChecks())}>
            {results ? 'Run again' : 'Run the checks'}
          </button>
          {results ? (
            <strong>
              {passed} of {results.length} pass
            </strong>
          ) : null}
        </div>
        {results ? (
          <div className="table-wrap">
            <table className="table table--s">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Result</th>
                  <th>What happened</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="mono">{r.id}</span> {r.title}
                      <span className="cell-sub">{r.requirement}</span>
                    </td>
                    <td className={r.pass ? 'result-pass' : 'result-fail'}>{r.pass ? 'Pass' : 'Fail'}</td>
                    <td>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="section">
        <h2>Data and tools</h2>
        <ul>
          <li>Every patient, phone number, place and outcome is simulated from a fixed seed. The proportions follow the case file. None are real statistics.</li>
          <li>The rule reader runs in the browser and works offline. Gemini is optional, off unless an API key is set, and only sees the instruction text.</li>
          <li>Built with React, Vite and TypeScript. IBM Plex fonts are bundled under the SIL Open Font License.</li>
        </ul>
      </section>
    </>
  );
}
