import { useEffect, type ReactNode } from 'react';
import { ROLE_LABEL, setRole } from '../core/actions';
import { IMPORTANCE_LABEL } from '../core/policy';
import { segmentHighlights } from '../core/reader';
import type { Slip } from '../core/slip';
import { STATUS_LABEL } from '../core/tracking';
import type { HighlightKind, Importance, Patient, Reading, Role, Status } from '../core/types';
import { useStore } from '../state/store';

export type Tone = 'blue' | 'grey' | 'red' | 'orange' | 'yellow' | 'green' | 'navy';

export function Tag({ tone = 'blue', children }: { tone?: Tone; children: ReactNode }) {
  return <strong className={`tag${tone === 'blue' ? '' : ` tag--${tone}`}`}>{children}</strong>;
}

const IMPORTANCE_TONE: Record<Importance, Tone> = { must_not_miss: 'red', important: 'orange', routine: 'grey' };

export function ImportanceTag({ level }: { level: Importance }) {
  return <Tag tone={IMPORTANCE_TONE[level]}>{IMPORTANCE_LABEL[level]}</Tag>;
}

const STATUS_TONE: Record<Status, Tone> = {
  missed: 'red',
  due: 'yellow',
  upcoming: 'grey',
  returned_on_time: 'green',
  returned_late: 'green',
  closed: 'grey',
  not_tracked: 'grey',
};

export function StatusTag({ status }: { status: Status }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>;
}

export interface SummaryRow {
  key: ReactNode;
  value: ReactNode;
  action?: ReactNode;
}

export function SummaryList({ rows, compact }: { rows: SummaryRow[]; compact?: boolean }) {
  return (
    <dl className={`summary-list${compact ? ' summary-list--compact' : ''}`}>
      {rows.map((r, i) => (
        <div key={i} className="summary-row">
          <dt className="summary-key">{r.key}</dt>
          <dd className="summary-value">{r.value}</dd>
          <dd className="summary-actions">{r.action ?? null}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WarningText({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <div className={`warning-text${small ? ' warning-text--small' : ''}`}>
      <span className="sr-only">Warning: </span>
      {children}
    </div>
  );
}

export function Details({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="details">
      <summary>{summary}</summary>
      <div className="details-text">{children}</div>
    </details>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  swatch?: string;
  conditional?: ReactNode;
  disabled?: boolean;
}

export function Radios<T extends string>({
  name,
  legend,
  hint,
  value,
  options,
  onChange,
  inline,
  small,
  after,
}: {
  name: string;
  legend: ReactNode;
  hint?: ReactNode;
  value: T | null;
  options: ChoiceOption<T>[];
  onChange: (v: T) => void;
  inline?: boolean;
  small?: boolean;
  after?: ReactNode;
}) {
  return (
    <fieldset className="fieldset">
      <legend className={`legend${small ? ' legend--s' : ''}`}>{legend}</legend>
      {hint ? <span className="hint">{hint}</span> : null}
      <div className={`choices${inline ? ' choices--inline' : ''}`}>
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          return (
            <div key={o.value}>
              <div className="choice choice--radio">
                <input
                  id={id}
                  type="radio"
                  name={name}
                  value={o.value}
                  checked={value === o.value}
                  disabled={o.disabled}
                  onChange={() => onChange(o.value)}
                />
                <label className="choice-label" htmlFor={id}>
                  {o.swatch ? <span className="choice-swatch" style={{ background: o.swatch }} aria-hidden="true" /> : null}
                  {o.label}
                </label>
                {o.hint ? <span className="choice-hint">{o.hint}</span> : null}
              </div>
              {o.conditional && value === o.value ? <div className="conditional">{o.conditional}</div> : null}
            </div>
          );
        })}
      </div>
      {after}
    </fieldset>
  );
}

export function Checkbox({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="choice choice--check">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label className="choice-label" htmlFor={id}>
        {label}
      </label>
      {hint ? <span className="choice-hint">{hint}</span> : null}
    </div>
  );
}

export function PatientBanner({ patient, items = [] }: { patient: Patient; items?: [string, ReactNode][] }) {
  const base: [string, ReactNode][] = [
    ['Registration no.', <span className="mono">{patient.regNo}</span>],
    ['Age and sex', `${patient.age} ${patient.sex === 'F' ? 'female' : 'male'}`],
    ['Village', `${patient.village} (${patient.distanceKm} km)`],
  ];
  return (
    <div className="patient-banner">
      {[...base, ...items].map(([k, v]) => (
        <div key={k} className="pb-item">
          <span className="pb-label">{k}</span>
          <span className="pb-value">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** "Records staff" becomes "records staff", but "OPD nurse" and "ASHA worker" keep their capitals. */
export function roleInSentence(role: Role): string {
  const label = ROLE_LABEL[role];
  return /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

export function RoleNotice({ need, what }: { need: Role; what: string }) {
  const { state, act } = useStore();
  if (state.role === need) return null;
  return (
    <WarningText small>
      You are viewing as {roleInSentence(state.role)}. {what}{' '}
      <button type="button" className="link-button" onClick={() => act((s) => setRole(s, need))}>
        Switch to {roleInSentence(need)}
      </button>
    </WarningText>
  );
}

const KEY: { kind: HighlightKind; label: string }[] = [
  { kind: 'timing', label: 'Follow-up time' },
  { kind: 'bring', label: 'To bring' },
  { kind: 'importance', label: 'Emphasis' },
  { kind: 'precaution', label: 'Come-back-sooner advice' },
  { kind: 'condition', label: 'Condition' },
  { kind: 'nodate', label: 'No fixed date' },
  { kind: 'ignored', label: 'Medicine course, ignored' },
];

export function HighlightedInstruction({ reading, small }: { reading: Reading; small?: boolean }) {
  const segments = segmentHighlights(reading.instruction, reading.highlights);
  const present = new Set(reading.highlights.map((h) => h.kind));
  const fromGemini = reading.highlights.some((h) => h.source === 'llm');
  return (
    <>
      <p className={`instruction${small ? ' instruction--s' : ''}`}>
        {segments.map((s, i) =>
          s.highlight ? (
            <mark key={i} className={`hl hl-${s.highlight.kind}${s.highlight.source === 'llm' ? ' hl-llm' : ''}`} title={s.highlight.note}>
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </p>
      {present.size ? (
        <ul className="key" aria-label="Key">
          {KEY.filter((k) => present.has(k.kind)).map((k) => (
            <li key={k.kind}>
              <span className={`key-sample hl hl-${k.kind}`} aria-hidden="true" />
              {k.label}
            </li>
          ))}
          {fromGemini ? (
            <li>
              <span className="hl-llm" aria-hidden="true" /> found by Gemini
            </li>
          ) : null}
        </ul>
      ) : null}
    </>
  );
}

/** "Decide" flags are warnings; "check" flags are shown plainly; notes on how the text was read are folded away. */
export function ReadingNotes({ reading }: { reading: Reading }) {
  const decide = reading.flags.filter((f) => f.level === 'decide');
  const check = reading.flags.filter((f) => f.level === 'check');
  const info = reading.flags.filter((f) => f.level === 'info');
  return (
    <>
      {decide.map((f, i) => (
        <WarningText key={`d${i}`} small>
          {f.message}
        </WarningText>
      ))}
      {check.length ? (
        <div className="inset">
          {check.map((f, i) => (
            <p key={`c${i}`}>{f.message}</p>
          ))}
        </div>
      ) : null}
      {info.length ? (
        <Details summary={`How the text was read (${info.length} ${info.length === 1 ? 'note' : 'notes'})`}>
          <ul className="notes">
            {info.map((f, i) => (
              <li key={`i${i}`}>{f.message}</li>
            ))}
          </ul>
        </Details>
      ) : null}
    </>
  );
}

export function SlipView({ slip }: { slip: Slip }) {
  return (
    <article className="slip" aria-label="Patient follow-up slip">
      <div className="slip-head">
        <div>
          <div className="slip-title">{slip.en.title}</div>
          <div className="slip-title hi" lang="hi">
            {slip.hi.title}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div>
            <strong>{slip.name}</strong>, {slip.ageSex}
          </div>
          <div className="mono">{slip.regNo}</div>
          <div className="body-s">Seen {slip.visit}</div>
        </div>
      </div>
      <div className="slip-cols">
        {(['en', 'hi'] as const).map((lang) => {
          const side = slip[lang];
          return (
            <div key={lang} className={`slip-side${lang === 'hi' ? ' hi' : ''}`} lang={lang}>
              <div>
                <div className="slip-k">{side.comeOn}</div>
                <div className="slip-due">{side.dueLine}</div>
                {side.latestLine ? <div className="body-s">{side.latestLine}</div> : null}
              </div>
              <div>
                <div className="slip-k">{side.whereLabel}</div>
                <div>{side.where}</div>
              </div>
              <div>
                <div className="slip-k">{side.bringLabel}</div>
                <ul>
                  {side.bring.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
      {slip.advice.length ? (
        <div className="slip-advice">
          <div className="slip-k">
            {slip.en.adviceLabel} / <span className="hi">{slip.hi.adviceLabel}</span>
          </div>
          {slip.advice.map((a) => (
            <div key={a} lang="en">
              “{a}”
            </div>
          ))}
        </div>
      ) : null}
      <div className="slip-foot">
        <div>{slip.en.cannotCome}</div>
        <div className="hi" lang="hi">
          {slip.hi.cannotCome}
        </div>
      </div>
    </article>
  );
}

export function ToastHost() {
  const { toast, dismiss } = useStore();
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(dismiss, toast.kind === 'error' ? 8000 : 4000);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div className={`toast${toast.kind === 'error' ? ' toast-error' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span>{toast.text}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
