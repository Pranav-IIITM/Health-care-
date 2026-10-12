import { useEffect, useMemo, useState } from 'react';
import { confirmFollowUp } from '../core/actions';
import { addDays, formatDate } from '../core/dates';
import { DEPARTMENTS, IMPORTANCE_LABEL, isOpdDay, opdDaysLabel } from '../core/policy';
import { proposalFrom, readInstruction } from '../core/reader';
import { groundProposal, mergeSecondReading } from '../core/secondReader';
import { ASHA_AREAS } from '../core/seed';
import { assignFate } from '../core/simulation';
import { buildSlip } from '../core/slip';
import { windowCloses } from '../core/tracking';
import { CHANNEL_LABEL, channelFor } from '../core/worklist';
import type { DeptCode, DeskItem, FollowUp, Importance, Lang, PhoneOwner, Reading } from '../core/types';
import { askSecondReader, fetchReaderStatus, type ReaderStatus } from '../services/secondReader';
import {
  Checkbox,
  HighlightedInstruction,
  PatientBanner,
  Radios,
  ReadingNotes,
  RoleNotice,
  SlipView,
  SummaryList,
  Tag,
} from '../components/ui';
import { useStore } from '../state/store';

function useReaderStatus(): ReaderStatus | null {
  const [status, setStatus] = useState<ReaderStatus | null>(null);
  useEffect(() => {
    let alive = true;
    fetchReaderStatus().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

const firstName = (name: string) => name.split(' ')[0];

export function DeskPage() {
  const { state } = useStore();
  const readerStatus = useReaderStatus();
  const [mode, setMode] = useState<'queue' | 'try'>('queue');
  const [selectedId, setSelectedId] = useState<string | null>(state.desk[0]?.id ?? null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const selected = state.desk.find((d) => d.id === selectedId) ?? state.desk[0] ?? null;
  const saved = savedId ? state.followUps.find((f) => f.id === savedId) ?? null : null;
  const decide = useMemo(
    () =>
      new Set(
        state.desk
          .filter((d) =>
            readInstruction({ instruction: d.instruction, visitDate: d.visitDate, department: d.department }).flags.some((f) => f.level === 'decide'),
          )
          .map((d) => d.id),
      ),
    [state.desk],
  );

  return (
    <div className="grid grid-1-3">
      <nav className="subnav" aria-label="Patients leaving OPD">
        <h2>Leaving OPD today</h2>
        {state.desk.length ? (
          <ul>
            {state.desk.map((d) => {
              const p = state.patients[d.patientId];
              const current = mode === 'queue' && !saved && selected?.id === d.id;
              return (
                <li key={d.id} className={current ? 'is-current' : undefined}>
                  <button
                    type="button"
                    className="link-button"
                    style={{ fontWeight: 600, textAlign: 'left' }}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => {
                      setMode('queue');
                      setSelectedId(d.id);
                      setSavedId(null);
                    }}
                  >
                    {p.name}
                  </button>
                  <span className="meta">
                    {DEPARTMENTS[d.department].short}
                    {decide.has(d.id) ? ', needs a decision' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="secondary">Everyone leaving OPD today has been seen at the desk.</p>
        )}
        <p className="body-s">
          <button type="button" className="link-button" onClick={() => setMode('try')}>
            Try the reader with your own text
          </button>
        </p>
      </nav>

      <div>
        {mode === 'try' ? (
          <ReaderSandbox readerStatus={readerStatus} />
        ) : saved ? (
          <SavedView
            fu={saved}
            onNext={() => {
              setSavedId(null);
              setSelectedId(state.desk[0]?.id ?? null);
            }}
          />
        ) : selected ? (
          <DeskForm key={selected.id} item={selected} readerStatus={readerStatus} onSaved={setSavedId} />
        ) : (
          <>
            <span className="caption">Follow-up desk</span>
            <h1>No one is waiting</h1>
            <p>Everyone leaving OPD today has a confirmed follow-up.</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ReaderLine({ reading, onReading, readerStatus }: { reading: Reading; onReading: (r: Reading) => void; readerStatus: ReaderStatus | null }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const crossCheck = async () => {
    setAsking(true);
    setError(null);
    const ctx = { instruction: reading.instruction, visitDate: reading.visitDate, department: reading.department };
    const res = await askSecondReader(reading.instruction, reading.visitDate);
    setAsking(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setModel(res.model);
    onReading(mergeSecondReading(readInstruction(ctx), groundProposal(res.proposal, ctx)));
  };

  return (
    <>
      <p className="body-s secondary">
        {reading.engine === 'rules' ? 'Read by the rule reader, which works offline.' : `Read by the rule reader and checked by ${model ?? 'Gemini'}.`}{' '}
        {readerStatus?.enabled ? null : readerStatus ? 'Gemini cross-check is not set up (add GEMINI_API_KEY to .env.local).' : null}
      </p>
      {readerStatus?.enabled && reading.engine === 'rules' ? (
        <div className="button-group">
          <button type="button" className="button button--secondary button--small" disabled={asking} onClick={crossCheck}>
            {asking ? 'Asking Gemini…' : 'Check with Gemini'}
          </button>
          <span className="body-s secondary">Free tier: Google may use what is sent. Only the instruction goes, with numbers removed.</span>
        </div>
      ) : null}
      {error ? (
        <div className="inset">
          <p>
            {error} The rule reading still stands.
          </p>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */

type When = `opt:${string}` | 'custom' | 'none';

function DeskForm({ item, readerStatus, onSaved }: { item: DeskItem; readerStatus: ReaderStatus | null; onSaved: (id: string) => void }) {
  const { state, act } = useStore();
  const patient = state.patients[item.patientId];
  const dept = DEPARTMENTS[item.department];
  const first = firstName(patient.name);
  const initial = useMemo(() => readInstruction({ instruction: item.instruction, visitDate: item.visitDate, department: item.department }), [item]);
  const [reading, setReading] = useState<Reading>(initial);
  const proposal = useMemo(() => proposalFrom(reading), [reading]);

  const [when, setWhen] = useState<When | null>(proposal.dueDate ? `opt:${proposal.dueDate}` : null);
  const [customDate, setCustomDate] = useState('');
  const [notTrackedReason, setNotTrackedReason] = useState(reading.noDate && reading.noDate.kind !== 'event' ? `“${reading.noDate.span.text}”: come if needed` : '');
  const [importance, setImportance] = useState<Importance | null>(null);
  const [bring, setBring] = useState<string[]>(proposal.bring);
  const [extraItem, setExtraItem] = useState('');

  const [phone, setPhone] = useState(patient.phone ?? '');
  const [owner, setOwner] = useState<PhoneOwner>(patient.phoneOwner);
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [language, setLanguage] = useState<Lang>(patient.language);
  const [cgName, setCgName] = useState(patient.caregiver?.name ?? '');
  const [cgRelation, setCgRelation] = useState(patient.caregiver?.relation ?? '');
  const [cgPhone, setCgPhone] = useState(patient.caregiver?.phone ?? '');
  const [chwArea, setChwArea] = useState(patient.chwArea ?? '');
  const [consent, setConsent] = useState({ sms: false, call: false, caregiver: false, chw: false });

  const applyReading = (r: Reading) => {
    setReading(r);
    const p = proposalFrom(r);
    setWhen(p.dueDate ? `opt:${p.dueDate}` : null);
  };

  const tracking: 'dated' | 'not_tracked' | null = when === null ? null : when === 'none' ? 'not_tracked' : 'dated';
  const dueDate = when?.startsWith('opt:') ? when.slice(4) : when === 'custom' ? customDate : '';
  const closes = tracking === 'dated' && dueDate && importance ? windowCloses(dueDate, item.visitDate, importance) : null;
  const hasPhone = owner !== 'none' && phone.replace(/\D/g, '').length > 0;
  const bringOptions = [...new Set([...reading.bring.map((b) => b.item), ...bring])];

  const save = () => {
    let id = '';
    const ok = act(
      (s) => {
        const r = confirmFollowUp(s, {
          deskItemId: item.id,
          reading,
          tracking,
          dueDate: tracking === 'dated' ? dueDate || null : null,
          importance,
          bring,
          notTrackedReason,
          contact: {
            phone: owner === 'none' ? '' : phone,
            phoneOwner: owner,
            phoneConfirmed,
            caregiverName: cgName,
            caregiverRelation: cgRelation,
            caregiverPhone: cgPhone,
            language,
            chwArea,
            consent,
          },
        });
        id = r.followUpId;
        return assignFate(r.state, r.followUpId);
      },
      `Saved. Give ${first} the slip.`,
    );
    if (ok) onSaved(id);
  };

  return (
    <>
      <RoleNotice need="nurse" what="Only the OPD nurse can save follow-ups." />
      <span className="caption">Follow-up desk</span>
      <h1>{patient.name}</h1>
      <PatientBanner
        patient={patient}
        items={[
          ['Clinic', `${dept.name}, ${item.clinician}`],
          ['Seen', formatDate(item.visitDate, 'medium')],
        ]}
      />

      <section className="section">
        <h2>What the clinician wrote</h2>
        <div className="inset">
          <HighlightedInstruction reading={reading} />
        </div>
        <ReaderLine reading={reading} onReading={applyReading} readerStatus={readerStatus} />
        <ReadingNotes reading={reading} />
      </section>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Radios<When>
          name="when"
          legend={`When should ${first} come back?`}
          value={when}
          onChange={setWhen}
          options={[
            ...reading.options.map((o) => ({
              value: `opt:${o.dueDate}` as When,
              label: formatDate(o.dueDate, 'full'),
              hint: (
                <>
                  From “{o.span.text}” ({o.label}
                  {o.source === 'llm' ? ', read by Gemini' : ''}). {o.shiftNote ?? ''}
                </>
              ),
            })),
            {
              value: 'custom' as When,
              label: 'Another date',
              conditional: (
                <div className="form-group">
                  <label className="label" htmlFor="custom-date">
                    Date the clinician gave
                  </label>
                  <input
                    id="custom-date"
                    type="date"
                    className="input w-20"
                    min={addDays(item.visitDate, 1)}
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                  />
                  {customDate && !isOpdDay(customDate, item.department) ? (
                    <span className="hint" style={{ marginTop: 6 }}>
                      {formatDate(customDate, 'long')} has no {dept.short} OPD. It runs {opdDaysLabel(item.department)}.
                    </span>
                  ) : null}
                </div>
              ),
            },
            {
              value: 'none' as When,
              label: 'No fixed date (SOS or as needed)',
              conditional: (
                <div className="form-group">
                  <label className="label" htmlFor="nt-reason">
                    Reason, for the record
                  </label>
                  <input id="nt-reason" className="input w-30" value={notTrackedReason} onChange={(e) => setNotTrackedReason(e.target.value)} />
                </div>
              ),
            },
          ]}
        />

        <Radios<Importance>
          name="importance"
          legend="How important is this follow-up?"
          hint="Use the clinician’s tick on the OPD slip. The system never sets this."
          value={importance}
          onChange={setImportance}
          inline
          options={[
            { value: 'routine', label: 'Routine' },
            { value: 'important', label: 'Important' },
            { value: 'must_not_miss', label: 'Must not miss' },
          ]}
          after={
            <>
              {reading.importanceHint && importance !== reading.importanceHint.level ? (
                <p className="body-s" style={{ marginTop: 12 }}>
                  The note says “{reading.importanceHint.span.text}”.{' '}
                  <button type="button" className="link-button" onClick={() => setImportance(reading.importanceHint!.level)}>
                    Use {IMPORTANCE_LABEL[reading.importanceHint.level].toLowerCase()}
                  </button>
                </p>
              ) : null}
              {closes ? (
                <p className="body-s secondary" style={{ marginTop: 12 }}>
                  Counted as missed if {first} has not come by {formatDate(closes, 'full')}.
                </p>
              ) : null}
            </>
          }
        />

        <fieldset className="fieldset">
          <legend className="legend">What should {first} bring?</legend>
          <span className="hint">The OPD card is always on the slip.</span>
          {bringOptions.map((b, i) => {
            const src = reading.bring.find((r) => r.item === b);
            return (
              <Checkbox
                key={b}
                id={`bring-${i}`}
                label={b}
                hint={src && !src.confident ? (src.source === 'llm' ? 'Suggested by Gemini' : 'Mentioned in the note, but not clearly as something to bring') : undefined}
                checked={bring.includes(b)}
                onChange={(on) => setBring((cur) => (on ? [...cur, b] : cur.filter((x) => x !== b)))}
              />
            );
          })}
          <div className="inline-fields" style={{ marginTop: 15 }}>
            <div className="form-group">
              <label className="label" htmlFor="extra-item">
                Add something else
              </label>
              <input id="extra-item" className="input" style={{ width: 260 }} value={extraItem} onChange={(e) => setExtraItem(e.target.value)} />
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                const v = extraItem.trim();
                if (v && !bring.includes(v)) setBring((cur) => [...cur, v]);
                setExtraItem('');
              }}
            >
              Add
            </button>
          </div>
        </fieldset>

        <h2>Contact details</h2>
        <div className="form-group">
          <label className="label" htmlFor="phone">
            Mobile number
          </label>
          <input
            id="phone"
            className="input w-20"
            inputMode="tel"
            autoComplete="off"
            value={owner === 'none' ? '' : phone}
            disabled={owner === 'none'}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <Radios<PhoneOwner>
          name="owner"
          legend="Whose phone is it?"
          small
          inline
          value={owner}
          onChange={(v) => {
            setOwner(v);
            if (v === 'none') setConsent((c) => ({ ...c, sms: false, call: false }));
          }}
          options={[
            { value: 'self', label: `${first}’s own` },
            { value: 'shared', label: 'Shared with family' },
            { value: 'none', label: 'No phone' },
          ]}
          after={
            <>
              {owner === 'shared' ? (
                <div className="inset" style={{ marginTop: 15 }}>
                  <p>Texts to a shared phone only say “a message for {first}”. They never mention the clinic, tests or illness.</p>
                </div>
              ) : null}
              {owner !== 'none' ? (
                <div style={{ marginTop: 15 }}>
                  <Checkbox
                    id="phone-checked"
                    label="Number checked now"
                    hint="A test SMS or a missed call reached this phone while the patient is at the desk."
                    checked={phoneConfirmed}
                    onChange={setPhoneConfirmed}
                  />
                </div>
              ) : null}
            </>
          }
        />
        <div className="inline-fields" style={{ marginBottom: 25 }}>
          <div className="form-group">
            <label className="label" htmlFor="cg-name">
              Caregiver’s name
            </label>
            <input id="cg-name" className="input" style={{ width: 240 }} value={cgName} onChange={(e) => setCgName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label" htmlFor="cg-rel">
              Relationship
            </label>
            <input id="cg-rel" className="input" style={{ width: 160 }} value={cgRelation} onChange={(e) => setCgRelation(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label" htmlFor="cg-phone">
              Caregiver’s mobile
            </label>
            <input id="cg-phone" className="input" style={{ width: 180 }} inputMode="tel" value={cgPhone} onChange={(e) => setCgPhone(e.target.value)} />
          </div>
        </div>
        <div className="inline-fields" style={{ marginBottom: 30 }}>
          <div className="form-group">
            <label className="label" htmlFor="asha">
              ASHA area
            </label>
            <select id="asha" className="select" value={chwArea} onChange={(e) => setChwArea(e.target.value)}>
              <option value="">Not known</option>
              {ASHA_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="label" htmlFor="lang">
              Language for texts
            </label>
            <select id="lang" className="select" value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
              <option value="hi">Hindi</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <fieldset className="fieldset">
          <legend className="legend">What has {first} agreed to?</legend>
          <div className="inset">
            <p>Read this out first:</p>
            <p>
              “We will send a reminder before your visit and call if you miss it. If we cannot reach you, the ASHA worker may visit your home. Messages
              will not mention your illness.”
            </p>
            <p className="hi" lang="hi">
              “आपकी अगली जाँच से पहले हम आपको याद दिलाएँगे, और न आने पर फ़ोन करेंगे। फ़ोन न लगे तो आशा कार्यकर्ता घर आ सकती हैं। संदेश में आपकी
              बीमारी का ज़िक्र नहीं होगा।”
            </p>
          </div>
          <span className="hint">Tick only what the patient agrees to.</span>
          <Checkbox id="c-sms" label="Reminder texts to this number" checked={consent.sms} disabled={!hasPhone} onChange={(v) => setConsent((c) => ({ ...c, sms: v }))} />
          <Checkbox id="c-call" label="Phone calls if the visit is missed" checked={consent.call} disabled={!hasPhone} onChange={(v) => setConsent((c) => ({ ...c, call: v }))} />
          <Checkbox
            id="c-cg"
            label={`Contacting the caregiver${cgName.trim() ? ` (${cgName.trim()})` : ''}`}
            hint={!cgPhone.trim() ? 'Needs the caregiver’s mobile number.' : undefined}
            checked={consent.caregiver}
            disabled={!cgName.trim() || !cgPhone.trim()}
            onChange={(v) => setConsent((c) => ({ ...c, caregiver: v }))}
          />
          <Checkbox
            id="c-chw"
            label="An ASHA home visit if we cannot reach them"
            hint={!chwArea ? 'Choose the ASHA area first.' : undefined}
            checked={consent.chw}
            disabled={!chwArea}
            onChange={(v) => setConsent((c) => ({ ...c, chw: v }))}
          />
        </fieldset>

        <div className="button-group">
          <button type="submit" className="button" disabled={state.role !== 'nurse'}>
            Save and show slip
          </button>
        </div>
      </form>
    </>
  );
}

/* ------------------------------------------------------------------ */

function SavedView({ fu, onNext }: { fu: FollowUp; onNext: () => void }) {
  const { state } = useStore();
  const p = state.patients[fu.patientId];
  const slip = buildSlip({ patient: p, department: fu.department, visitDate: fu.visitDate, plan: fu.plan, precautions: fu.reading.precautions });
  const route = channelFor(fu, p);
  const first = firstName(p.name);
  return (
    <>
      <div className="banner banner--success" role="status">
        <h2 className="banner-title">Saved</h2>
        <div className="banner-body">
          <p className="banner-heading">
            {fu.plan.tracking === 'dated' && fu.plan.dueDate
              ? `${p.name} is booked for ${formatDate(fu.plan.dueDate, 'full')}.`
              : `${p.name} has no fixed follow-up.`}
          </p>
          <p>
            {fu.plan.tracking === 'dated'
              ? `If ${first} has not come by ${formatDate(fu.plan.windowCloses!, 'long')}, the first contact will be: ${CHANNEL_LABEL[route].toLowerCase()}.`
              : `Reason recorded: ${fu.plan.notTrackedReason}`}
          </p>
        </div>
      </div>
      <h2>Slip for {first}</h2>
      <div className="print-area">
        <SlipView slip={slip} />
      </div>
      <div className="button-group">
        <button type="button" className="button button--secondary" onClick={() => window.print()}>
          Print slip
        </button>
        <button type="button" className="button" onClick={onNext}>
          Next patient
        </button>
      </div>
      <p className="body-s secondary">
        {fu.plan.corrections.length ? `You changed: ${fu.plan.corrections.join(', ')}. This is counted to check the reader.` : 'Saved as the reader proposed it.'}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */

const SAMPLES: [string, DeptCode][] = [
  ['Review after 2/52 with CBC, LFT. Tab Metformin 500 mg BD x 14 days.', 'MED'],
  ['R/V 1 wk / 10 days with X-ray', 'ORTHO'],
  ['Review after 3 days if fever persists', 'PAED'],
  ['SOS', 'EYE'],
  ['2 hafte baad dikhayen, sugar report lekar aayen', 'MED'],
  ['15 दिन बाद दिखाएँ, रिपोर्ट लेकर आएँ', 'MED'],
  ['Review 6/12 with ECG', 'MED'],
  ['Review 2 weeks after surgery', 'SURG'],
  ['ANC review after 4 weeks with Hb. Come immediately if bleeding. Without fail.', 'OBG'],
  ['Review after 10 days', 'ENT'],
];

function ReaderSandbox({ readerStatus }: { readerStatus: ReaderStatus | null }) {
  const { state } = useStore();
  const [text, setText] = useState(SAMPLES[0][0]);
  const [dept, setDept] = useState<DeptCode>(SAMPLES[0][1]);
  const base = useMemo(() => readInstruction({ instruction: text, visitDate: state.today, department: dept }), [text, dept, state.today]);
  const [override, setOverride] = useState<Reading | null>(null);
  const reading = override && override.instruction === text && override.department === dept && override.visitDate === state.today ? override : base;
  const proposal = proposalFrom(reading);

  return (
    <>
      <span className="caption">Follow-up desk</span>
      <h1>Try the reader</h1>
      <p className="lead">Type a follow-up instruction the way a clinician would. Nothing is saved.</p>

      <div className="form-group">
        <label className="label" htmlFor="try-text">
          Clinician’s instruction
        </label>
        <textarea id="try-text" className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="label" htmlFor="try-dept">
          Clinic
        </label>
        <span className="hint">Due dates move to the days this clinic runs. Visit date is {formatDate(state.today, 'long')}.</span>
        <select id="try-dept" className="select" value={dept} onChange={(e) => setDept(e.target.value as DeptCode)}>
          {Object.values(DEPARTMENTS).map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <h3>Examples</h3>
      <ul className="body-s" style={{ marginBottom: 30 }}>
        {SAMPLES.map(([s, d]) => (
          <li key={s}>
            <button
              type="button"
              className="link-button"
              lang={/[ऀ-ॿ]/.test(s) ? 'hi' : undefined}
              onClick={() => {
                setText(s);
                setDept(d);
              }}
            >
              {s}
            </button>{' '}
            <span className="secondary">({DEPARTMENTS[d].short})</span>
          </li>
        ))}
      </ul>

      <h2>How it was read</h2>
      <div className="inset">
        <HighlightedInstruction reading={reading} />
      </div>
      <ReaderLine reading={reading} onReading={setOverride} readerStatus={readerStatus} />
      <ReadingNotes reading={reading} />
      <SummaryList
        rows={[
          {
            key: 'Proposed date',
            value: proposal.dueDate ? formatDate(proposal.dueDate, 'full') : <Tag tone="red">None. A person decides.</Tag>,
          },
          {
            key: 'Times found',
            value: reading.options.length ? reading.options.map((o) => `“${o.span.text}” gives ${formatDate(o.dueDate, 'short')}`).join('; ') : 'None',
          },
          { key: 'To bring', value: proposal.bring.length ? proposal.bring.join(', ') : 'Nothing found' },
          {
            key: 'Importance',
            value: reading.importanceHint
              ? `The note says “${reading.importanceHint.span.text}”. The clinician still sets it.`
              : 'No emphasis words. The clinician sets it.',
          },
        ]}
      />
    </>
  );
}
