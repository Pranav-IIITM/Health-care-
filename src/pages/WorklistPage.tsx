import { useEffect, useMemo, useState } from 'react';
import {
  assignChw,
  BARRIER_LABEL,
  canSeeClinicalText,
  CLOSURE_LABEL,
  closeFollowUp,
  escalate,
  logAttempt,
  nextVisitOnly,
  noteClinicalTextViewed,
  noteNumberViewed,
  returnToQueue,
  ROLE_LABEL,
  sendMissedMessage,
  sendReminders,
} from '../core/actions';
import { callScript, draftMessage, formatPhone, maskPhone } from '../core/contact';
import { addDays, formatDate, plural } from '../core/dates';
import { DEPARTMENTS, HOSPITAL, MUST_NOT_MISS_REVIEW_AFTER, nextOpdDay, RANK_WEIGHTS } from '../core/policy';
import { effectiveDue, statusOf } from '../core/tracking';
import {
  buildWorkItems,
  canRemind,
  CHANNEL_LABEL,
  channelFor,
  LANE_META,
  LANE_ORDER,
  laneFor,
  OUTCOME_LABEL,
  phoneUsable,
  scoreFor,
  type WorkItem,
} from '../core/worklist';
import type { Barrier, Channel, ClosureReason, FollowUp, ISODate, Lane, Outcome, Patient } from '../core/types';
import { Details, ImportanceTag, PatientBanner, Radios, StatusTag, SummaryList, Tag } from '../components/ui';
import { href, navigate, useRoute } from '../state/router';
import { useStore } from '../state/store';

function routeLabel(channel: Channel, p: Patient): string {
  if (channel === 'phone') return p.phoneOwner === 'shared' ? 'Shared phone' : 'Phone';
  if (channel === 'caregiver') return `Caregiver (${p.caregiver?.relation ?? 'family'})`;
  if (channel === 'chw') return 'ASHA visit';
  return 'Alert at next visit';
}

export function WorklistPage() {
  const { state } = useStore();
  const { params } = useRoute();
  const items = useMemo(() => buildWorkItems(state), [state]);
  const laneParam = params.get('lane') as Lane | null;
  const lane: Lane = laneParam && LANE_ORDER.includes(laneParam) ? laneParam : 'call';
  const openId = params.get('id');
  const openFu = openId ? state.followUps.find((f) => f.id === openId) ?? null : null;

  if (openFu) {
    return <CasePage key={`${openFu.id}-${state.role}`} fu={openFu} patient={state.patients[openFu.patientId]} backLane={lane} />;
  }

  const laneItems = items.filter((i) => i.lane === lane);
  const active = laneItems.filter((i) => !i.waitingUntil);
  const waiting = laneItems.filter((i) => i.waitingUntil);

  return (
    <>
      <span className="caption">Worklist</span>
      <h1>Missed follow-ups</h1>
      <div className="tabs">
        <ul className="tabs-list" role="tablist">
          {LANE_ORDER.map((l) => (
            <li key={l}>
              <button type="button" role="tab" className="tab" aria-selected={lane === l} onClick={() => navigate('worklist', { lane: l })}>
                {LANE_META[l].title} ({items.filter((i) => i.lane === l).length})
              </button>
            </li>
          ))}
        </ul>
        <div className="tabs-panel" role="tabpanel">
          <h2>{LANE_META[lane].title}</h2>
          <p className="secondary">
            {LANE_META[lane].blurb} Worked by: {LANE_META[lane].owner.toLowerCase()}.
          </p>
          {lane === 'reminder' ? (
            <ReminderLane items={laneItems} />
          ) : laneItems.length === 0 ? (
            <p>No one in this list.</p>
          ) : (
            <div className="table-wrap">
              <table className="table table--register">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Clinic</th>
                    <th>Importance</th>
                    <th>Contact by</th>
                    <th>Why it is here</th>
                    <th className="numeric">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((item) => (
                    <Row key={item.fu.id} item={item} lane={lane} />
                  ))}
                  {waiting.length ? (
                    <>
                      <tr className="section-row">
                        <td colSpan={6}>Tried today, next try later ({waiting.length})</td>
                      </tr>
                      {waiting.map((item) => (
                        <Row key={item.fu.id} item={item} lane={lane} />
                      ))}
                    </>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
          <Details summary="How the order is worked out">
            <p>
              Points come from the importance the clinician set (must not miss {RANK_WEIGHTS.importance.must_not_miss}, important{' '}
              {RANK_WEIGHTS.importance.important}, routine {RANK_WEIGHTS.importance.routine}), plus {RANK_WEIGHTS.perDayLate} for each day past the
              window up to {RANK_WEIGHTS.maxLateDays}, plus {RANK_WEIGHTS.firstContact} if nobody has tried yet, plus {RANK_WEIGHTS.brokenPromise} if the
              patient missed a date they agreed on a call.
            </p>
            <p>
              Having a phone, sharing one, or living far away does not change the points. It only changes how the patient is contacted: call, caregiver,
              ASHA visit, or an alert at registration.
            </p>
            <p>
              After no answer, the next try waits a day. A must-not-miss patient goes to a nurse after {MUST_NOT_MISS_REVIEW_AFTER} failed attempts.
            </p>
          </Details>
        </div>
      </div>
    </>
  );
}

function Row({ item, lane }: { item: WorkItem; lane: Lane }) {
  const { fu, patient: p } = item;
  const due = effectiveDue(fu);
  return (
    <tr>
      <td style={{ minWidth: 220 }}>
        <a className="cell-name" href={href('worklist', { lane, id: fu.id })}>
          {p.name}
        </a>
        <span className="cell-sub mono">{p.regNo}</span>
        <span className="cell-sub" style={{ marginTop: 0 }}>
          {p.village}, {p.distanceKm} km
        </span>
      </td>
      <td className="nowrap">
        {DEPARTMENTS[fu.department].short}
        <span className="cell-sub">
          {fu.rescheduledTo ? 'Agreed' : 'Due'} {due ? formatDate(due, 'short') : ''}
          {item.waitingUntil ? `, next try ${formatDate(item.waitingUntil, 'short')}` : ''}
        </span>
      </td>
      <td>
        <ImportanceTag level={fu.plan.importance} />
      </td>
      <td className="nowrap">{routeLabel(item.channel, p)}</td>
      <td className="body-s">{item.reasons.slice(1).join('. ')}.</td>
      <td className="numeric">
        <strong>{item.score}</strong>
      </td>
    </tr>
  );
}

function ReminderLane({ items }: { items: WorkItem[] }) {
  const { state, act } = useStore();
  if (!items.length) return <p>No reminders due. They go out two days before the due date, only to patients who agreed to texts.</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="table table--register">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Due</th>
              <th>To</th>
              <th>Text (fixed wording)</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ fu, patient: p }) => {
              const m = draftMessage('reminder', fu, p, 'phone');
              return (
                <tr key={fu.id}>
                  <td>
                    <span className="cell-name">{p.name}</span>
                    <span className="cell-sub mono">{p.regNo}</span>
                  </td>
                  <td className="nowrap">{formatDate(effectiveDue(fu)!, 'short')}</td>
                  <td className="nowrap">
                    {maskPhone(p.phone)}
                    <span className="cell-sub">{p.phoneOwner === 'shared' ? 'Shared phone' : 'Own phone'}</span>
                  </td>
                  <td className={`body-s${m?.lang === 'hi' ? ' hi' : ''}`} lang={m?.lang}>
                    {m?.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="button-group">
        <button
          type="button"
          className="button"
          disabled={state.role !== 'records' && state.role !== 'nurse'}
          onClick={() => act((s) => sendReminders(s, items.map((i) => i.fu.id)), `${plural(items.length, 'reminder')} sent (simulated).`)}
        >
          Send {plural(items.length, 'reminder')}
        </button>
        <span className="body-s secondary">Texts go through a simulated gateway in this prototype.</span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Case page                                                           */
/* ------------------------------------------------------------------ */

const CALL_OUTCOMES: Outcome[] = ['will_come', 'needs_support', 'clinical_question', 'no_answer', 'wrong_number', 'care_elsewhere', 'declined', 'moved_away', 'deceased'];
const VISIT_OUTCOMES: Outcome[] = ['will_come', 'needs_support', 'clinical_question', 'not_found', 'care_elsewhere', 'declined', 'moved_away', 'deceased'];

function history(fu: FollowUp, today: ISODate): { on: ISODate; text: string; key?: boolean }[] {
  const ev: { on: ISODate; text: string; key?: boolean; i?: number }[] = [
    { on: fu.visitDate, text: `Seen in ${DEPARTMENTS[fu.department].name} OPD by ${fu.clinician}.`, key: true },
    {
      on: fu.plan.confirmedOn,
      text:
        fu.plan.tracking === 'dated' && fu.plan.dueDate
          ? `Nurse confirmed the follow-up for ${formatDate(fu.plan.dueDate, 'long')}.`
          : `Nurse recorded no fixed follow-up: ${fu.plan.notTrackedReason}.`,
    },
  ];
  if (fu.reminderSentOn) ev.push({ on: fu.reminderSentOn, text: 'Reminder text sent.' });
  const close = fu.plan.windowCloses;
  if (close && addDays(close, 1) <= today && (!fu.returnedOn || fu.returnedOn > close)) {
    ev.push({ on: addDays(close, 1), text: 'No visit by the end of the window. Marked as missed.', key: true });
  }
  if (fu.messageSentOn) ev.push({ on: fu.messageSentOn, text: 'Missed-visit text sent.' });
  for (const a of fu.attempts) {
    const extra = a.plannedDate ? `, agreed ${formatDate(a.plannedDate, 'long')}` : a.barrier ? `, ${BARRIER_LABEL[a.barrier].toLowerCase()}` : '';
    ev.push({ on: a.on, text: `${CHANNEL_LABEL[a.channel]} (${ROLE_LABEL[a.by].toLowerCase()}): ${OUTCOME_LABEL[a.outcome].toLowerCase()}${extra}.${a.note ? ` “${a.note}”` : ''}` });
  }
  if (fu.escalation) ev.push({ on: fu.escalation.on, text: `Sent to a nurse: ${fu.escalation.reason}.` });
  if (fu.closure) ev.push({ on: fu.closure.on, text: `Closed by ${ROLE_LABEL[fu.closure.by].toLowerCase()}: ${CLOSURE_LABEL[fu.closure.reason].toLowerCase()}.`, key: true });
  if (fu.returnedOn) ev.push({ on: fu.returnedOn, text: 'Came back. Registered at OPD.', key: true });
  return ev.map((e, i) => ({ ...e, i })).sort((a, b) => (a.on === b.on ? a.i - b.i : a.on < b.on ? -1 : 1));
}

function CasePage({ fu, patient: p, backLane }: { fu: FollowUp; patient: Patient; backLane: Lane }) {
  const { state, act } = useStore();
  const { today, role } = state;
  const status = statusOf(fu, today);
  const lane = laneFor(fu, p, status, today);
  const route = channelFor(fu, p);
  const { score, parts } = scoreFor(fu, today);
  const isOpen = status === 'missed';
  const first = p.name.split(' ')[0];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [fu.id]);

  const channels: Channel[] = [];
  if (role === 'records' || role === 'nurse') {
    if (phoneUsable(p) && p.consent.call) channels.push('phone');
    if (p.caregiver?.phone && p.consent.caregiver) channels.push('caregiver');
  }
  if ((role === 'chw' || role === 'nurse') && p.consent.chw && p.chwArea) channels.push('chw');

  const [numberShown, setNumberShown] = useState(false);
  const [textShown, setTextShown] = useState(false);
  const [channel, setChannel] = useState<Channel>(channels.includes(route) ? route : channels[0] ?? 'none');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [planned, setPlanned] = useState<ISODate>(nextOpdDay(addDays(today, 1), fu.department));
  const [barrier, setBarrier] = useState<Barrier | ''>('');
  const [note, setNote] = useState('');
  const [closeReason, setCloseReason] = useState<ClosureReason | ''>('');
  const [closeNote, setCloseNote] = useState('');
  const [escReason, setEscReason] = useState('');

  const message = route === 'phone' || route === 'caregiver' ? draftMessage('missed', fu, p, route) : null;
  const messageAllowed = route === 'phone' ? canRemind(p) : route === 'caregiver' ? p.consent.caregiver : false;
  const script = route === 'phone' || route === 'caregiver' ? callScript(fu, p, route, today) : null;
  const outcomes = channel === 'chw' ? VISIT_OUTCOMES : CALL_OUTCOMES;
  const backTo = lane ?? backLane;

  const saveOutcome = () => {
    if (!outcome) return;
    const ok = act(
      (s) => logAttempt(s, fu.id, { channel, outcome, plannedDate: outcome === 'will_come' ? planned : null, barrier: barrier || null, note }),
      'Saved.',
    );
    if (ok) {
      setOutcome(null);
      setNote('');
      setBarrier('');
    }
  };

  return (
    <>
      <a className="back-link" href={href('worklist', { lane: backTo })}>
        Back to {LANE_META[backTo].title.toLowerCase()}
      </a>
      <span className="caption">{status === 'missed' ? 'Missed follow-up' : 'Follow-up'}</span>
      <h1>{p.name}</h1>
      <PatientBanner patient={p} items={[['Clinic', `${DEPARTMENTS[fu.department].name}, ${fu.clinician}`]]} />
      <div className="tags" style={{ marginBottom: 30 }}>
        <ImportanceTag level={fu.plan.importance} />
        <StatusTag status={status} />
        {lane ? <Tag tone="navy">{LANE_META[lane].title}</Tag> : null}
      </div>

      <div className="grid grid-1-1">
        <div>
          {lane && lane !== 'reminder' ? (
            <section className="section">
              <h2>Why it is in this place</h2>
              <ul className="points">
                {parts.map((pt) => (
                  <li key={pt.label}>
                    <span>{pt.label}</span>
                    <span className="num">+{pt.points}</span>
                  </li>
                ))}
                <li className="total">
                  <span>Points</span>
                  <span className="num">{score}</span>
                </li>
              </ul>
              {fu.escalation ? (
                <div className="inset">
                  <p>
                    <strong>Waiting for a nurse:</strong> {fu.escalation.reason}. Sent {formatDate(fu.escalation.on, 'short')} by{' '}
                    {ROLE_LABEL[fu.escalation.by].toLowerCase()}.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="section">
            <h2>Follow-up</h2>
            <SummaryList
              rows={[
                { key: 'Seen', value: formatDate(fu.visitDate, 'long') },
                { key: 'Due', value: fu.plan.dueDate ? formatDate(fu.plan.dueDate, 'long') : 'No fixed date' },
                { key: 'Missed after', value: fu.plan.windowCloses ? formatDate(fu.plan.windowCloses, 'long') : '' },
                ...(fu.rescheduledTo ? [{ key: 'Agreed on a call', value: formatDate(fu.rescheduledTo, 'long') }] : []),
                { key: 'To bring', value: ['OPD card', ...fu.plan.bring.filter((b) => b !== 'OPD card')].join(', ') },
                {
                  key: 'Clinician’s note',
                  value: canSeeClinicalText(role) ? (textShown ? <span className="instruction instruction--s">{fu.instruction}</span> : 'Hidden until opened') : 'Visible to nurses only.',
                  action:
                    canSeeClinicalText(role) && !textShown ? (
                      <button type="button" className="link-button" onClick={() => act((s) => noteClinicalTextViewed(s, fu.id)) && setTextShown(true)}>
                        Show<span className="sr-only"> the clinician’s note</span>
                      </button>
                    ) : null,
                },
              ]}
            />
            <p className="body-s secondary">Opening the note or a full phone number is recorded in the audit trail.</p>
          </section>

          <section className="section">
            <h2>Contact</h2>
            <SummaryList
              rows={[
                {
                  key: 'Phone',
                  value: p.phone ? `${numberShown ? formatPhone(p.phone) : maskPhone(p.phone)} (${p.phoneOwner === 'shared' ? 'shared' : 'own'}, ${p.phoneStatus})` : 'None',
                  action:
                    p.phone && !numberShown && role !== 'admin' ? (
                      <button type="button" className="link-button" onClick={() => act((s) => noteNumberViewed(s, fu.id, 'patient')) && setNumberShown(true)}>
                        Show<span className="sr-only"> the full number</span>
                      </button>
                    ) : null,
                },
                {
                  key: 'Caregiver',
                  value: p.caregiver
                    ? `${p.caregiver.name}, ${p.caregiver.relation}${p.caregiver.phone ? ` (${numberShown ? formatPhone(p.caregiver.phone) : maskPhone(p.caregiver.phone)})` : ', no number'}`
                    : 'None',
                },
                { key: 'ASHA area', value: p.chwArea ?? 'Not known' },
                { key: 'Texts in', value: p.language === 'hi' ? 'Hindi' : 'English' },
                {
                  key: 'Agreed to',
                  value:
                    [p.consent.sms && 'texts', p.consent.call && 'calls', p.consent.caregiver && 'caregiver contact', p.consent.chw && 'ASHA visit']
                      .filter(Boolean)
                      .join(', ') || 'Nothing recorded',
                },
                { key: 'Contact now by', value: routeLabel(route, p) },
              ]}
            />
          </section>

          <section className="section">
            <h2>History</h2>
            <ol className="timeline">
              {history(fu, today).map((e, i) => (
                <li key={i} className={e.key ? 't-key' : undefined}>
                  <span className="t-date">{formatDate(e.on, 'medium')}</span>
                  <span>{e.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div>
          {!isOpen ? (
            <div className="inset">
              <p>
                {status === 'returned_on_time' || status === 'returned_late'
                  ? `Nothing to do. ${first} came back on ${formatDate(fu.returnedOn!, 'long')}.`
                  : status === 'closed'
                    ? `Nothing to do. Closed: ${CLOSURE_LABEL[fu.closure!.reason].toLowerCase()}.`
                    : status === 'not_tracked'
                      ? 'Nothing to do. This follow-up has no fixed date.'
                      : `Nothing to do yet. ${first} is not due to be counted as missed until after ${formatDate(fu.plan.windowCloses!, 'long')}.`}
              </p>
            </div>
          ) : null}

          {isOpen && script && channels.length ? (
            <section className="section">
              <h2>Call script</h2>
              <ol className="script">
                {script.map((s) => (
                  <li key={s.when}>
                    <strong>{s.when}</strong>
                    {s.say ? <span className="say">“{s.say}”</span> : null}
                    {s.then ? <span className="then">{s.then}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {isOpen && message ? (
            <section className="section">
              <h2>Text message</h2>
              <p className={`sms${message.lang === 'hi' ? ' hi' : ''}`} lang={message.lang}>
                {message.text}
              </p>
              <div className="button-group">
                <button
                  type="button"
                  className="button button--secondary button--small"
                  disabled={!messageAllowed || !!fu.messageSentOn || (role !== 'records' && role !== 'nurse')}
                  onClick={() => act((s) => sendMissedMessage(s, fu.id, route), 'Text sent (simulated).')}
                >
                  {fu.messageSentOn ? `Sent ${formatDate(fu.messageSentOn, 'short')}` : 'Send text'}
                </button>
                <span className="body-s secondary">
                  {messageAllowed ? 'Fixed wording. No clinic, tests or illness.' : `${first} has not agreed to texts on this route.`}
                </span>
              </div>
            </section>
          ) : null}

          {isOpen && channels.length && role !== 'admin' ? (
            <section className="section">
              <h2>Record what happened</h2>
              {channels.length > 1 ? (
                <div className="form-group">
                  <label className="label" htmlFor="via">
                    Contacted through
                  </label>
                  <select
                    id="via"
                    className="select"
                    value={channel}
                    onChange={(e) => {
                      setChannel(e.target.value as Channel);
                      setOutcome(null);
                    }}
                  >
                    {channels.map((c) => (
                      <option key={c} value={c}>
                        {routeLabel(c, p)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Radios<Outcome>
                name="outcome"
                legend={`What happened with ${first}?`}
                small
                value={outcome}
                onChange={setOutcome}
                options={outcomes.map((o) => ({
                  value: o,
                  label: OUTCOME_LABEL[o],
                  conditional:
                    o === 'will_come' ? (
                      <div className="form-group">
                        <label className="label" htmlFor="planned">
                          Date {first} agreed to
                        </label>
                        <span className="hint">Next {DEPARTMENTS[fu.department].short} OPD day: {formatDate(nextOpdDay(addDays(today, 1), fu.department), 'long')}.</span>
                        <input id="planned" type="date" className="input w-20" min={today} value={planned} onChange={(e) => setPlanned(e.target.value)} />
                      </div>
                    ) : o === 'needs_support' ? (
                      <div className="form-group">
                        <label className="label" htmlFor="barrier">
                          What is stopping them?
                        </label>
                        <select id="barrier" className="select" value={barrier} onChange={(e) => setBarrier(e.target.value as Barrier | '')}>
                          <option value="">Choose</option>
                          {(Object.keys(BARRIER_LABEL) as Barrier[]).map((b) => (
                            <option key={b} value={b}>
                              {BARRIER_LABEL[b]}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : ['care_elsewhere', 'declined', 'moved_away', 'deceased'].includes(o) ? (
                      <p className="body-s">
                        {role === 'nurse' ? 'This closes the follow-up with this reason.' : 'This closes it if your role allows. Otherwise it goes to a nurse to close.'}
                      </p>
                    ) : undefined,
                }))}
              />
              <div className="form-group">
                <label className="label" htmlFor="note">
                  Note (optional)
                </label>
                <span className="hint">No clinical details.</span>
                <input id="note" className="input" value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="button-group">
                <button type="button" className="button" disabled={!outcome} onClick={saveOutcome}>
                  Save
                </button>
              </div>
            </section>
          ) : null}

          {isOpen && role === 'nurse' ? (
            <section className="section">
              <h2>Nurse decision</h2>
              <div className="button-group">
                <button type="button" className="button button--secondary" onClick={() => act((s) => returnToQueue(s, fu.id), 'Back on the usual contact route.')}>
                  Back to the list
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={!p.consent.chw || !p.chwArea}
                  onClick={() => act((s) => assignChw(s, fu.id), `Sent for an ASHA visit in ${p.chwArea}.`)}
                >
                  Send ASHA
                </button>
                <button type="button" className="button button--secondary" onClick={() => act((s) => nextVisitOnly(s, fu.id), 'Alert at the next visit only.')}>
                  Wait for next visit
                </button>
              </div>
            </section>
          ) : null}

          {isOpen && (role === 'records' || role === 'chw') && !fu.escalation ? (
            <section className="section">
              <h2>Send to a nurse</h2>
              <div className="form-group">
                <label className="label" htmlFor="esc">
                  Why does this need a nurse?
                </label>
                <input id="esc" className="input" value={escReason} onChange={(e) => setEscReason(e.target.value)} />
              </div>
              <div className="button-group">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => act((s) => escalate(s, fu.id, escReason), 'Sent to the nurse review list.') && setEscReason('')}
                >
                  Send to nurse
                </button>
              </div>
            </section>
          ) : null}

          {isOpen && (role === 'records' || role === 'nurse') ? (
            <section className="section">
              <h2>Close without a visit</h2>
              <div className="form-group">
                <label className="label" htmlFor="close-reason">
                  Reason
                </label>
                <span className="hint">
                  Must-not-miss follow-ups, and closing for “declined”, “deceased” or “clinician cancelled”, need a nurse.
                </span>
                <select id="close-reason" className="select" value={closeReason} onChange={(e) => setCloseReason(e.target.value as ClosureReason | '')}>
                  <option value="">Choose a reason</option>
                  {(Object.keys(CLOSURE_LABEL) as ClosureReason[]).map((r) => (
                    <option key={r} value={r}>
                      {CLOSURE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="close-note">
                  Note
                </label>
                <input id="close-note" className="input" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
              </div>
              <div className="button-group">
                <button
                  type="button"
                  className="button button--warning"
                  onClick={() => act((s) => closeFollowUp(s, fu.id, closeReason || null, closeNote), 'Closed. The reason is in the audit trail.')}
                >
                  Close follow-up
                </button>
              </div>
            </section>
          ) : null}

          <p className="body-s secondary">
            If {first} asks about illness or medicines, a nurse calls back. In an emergency: nearest emergency department or {HOSPITAL.emergencyNumber}.
          </p>
        </div>
      </div>
    </>
  );
}
