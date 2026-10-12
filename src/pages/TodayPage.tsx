import { useMemo, type ReactNode } from 'react';
import { formatDate } from '../core/dates';
import { computeMetrics, pct } from '../core/metrics';
import { EQUITY_GAP_ALERT_PP } from '../core/policy';
import { FairnessTable, WeeklyOnTimeChart } from '../components/charts';
import { SummaryList, Tag, type Tone } from '../components/ui';
import { href } from '../state/router';
import { useStore } from '../state/store';

function Task({ link, name, hint, status }: { link: string; name: string; hint: string; status: ReactNode }) {
  return (
    <li className="task-item">
      <span>
        <a className="task-name" href={link}>
          {name}
        </a>
        <span className="task-hint">{hint}</span>
      </span>
      <span className="tags">{status}</span>
    </li>
  );
}

function count(n: number, word: string, tone: Tone = 'blue') {
  return n === 0 ? <Tag tone="grey">None</Tag> : <Tag tone={tone}>{`${n} ${word}`}</Tag>;
}

export function TodayPage() {
  const { state } = useStore();
  const m = useMemo(() => computeMetrics(state), [state]);
  const unchanged = m.corrections.confirmed ? m.corrections.unchanged / m.corrections.confirmed : null;

  return (
    <>
      <span className="caption">{formatDate(state.today, 'full')}</span>
      <h1>Follow-ups today</h1>

      <div className="figures">
        <div className="figure">
          <span className="figure-value">{m.openMissed}</span>
          <span className="figure-label">missed follow-ups still open</span>
        </div>
        <div className="figure figure--key">
          <span className="figure-value">{m.neverContacted}</span>
          <span className="figure-label">of them not contacted at all</span>
        </div>
        <div className="figure">
          <span className="figure-value">{pct(m.onTime)}</span>
          <span className="figure-label">came back on time in the last 13 weeks</span>
        </div>
        <div className="figure">
          <span className="figure-value">{pct(m.recovered)}</span>
          <span className="figure-label">came back after missing</span>
        </div>
      </div>

      <h2>Work for today</h2>
      <ul className="task-list">
        <Task
          link={href('desk')}
          name="Confirm follow-ups at the desk"
          hint="Patients leaving OPD today"
          status={
            <>
              {m.deskNeedsDecision ? <Tag tone="red">{`${m.deskNeedsDecision} need a decision`}</Tag> : null}
              {count(m.deskPending, 'waiting')}
            </>
          }
        />
        <Task link={href('worklist', { lane: 'call' })} name="Call patients who missed" hint="By phone or through a caregiver, in list order" status={count(m.lanes.call, 'to call')} />
        <Task link={href('worklist', { lane: 'reminder' })} name="Send reminders" hint="Due in the next two days, SMS agreed" status={count(m.lanes.reminder, 'to send')} />
        <Task
          link={href('worklist', { lane: 'nurse' })}
          name="Nurse review"
          hint="Questions from patients, closure requests, must-not-miss patients we cannot reach"
          status={count(m.lanes.nurse, 'to review', 'orange')}
        />
        <Task link={href('worklist', { lane: 'chw' })} name="ASHA home visits" hint="No working phone, home visit agreed" status={count(m.lanes.chw, 'to visit')} />
        <Task
          link={href('worklist', { lane: 'next_visit' })}
          name="Registration alerts"
          hint="No agreed way to contact them; flagged when they next come in"
          status={count(m.lanes.next_visit, 'flagged', 'grey')}
        />
      </ul>

      <div className="grid grid-2-1 section">
        <section>
          <h2>Returned on time, by week</h2>
          <WeeklyOnTimeChart weeks={m.weekly} overall={m.onTime} />
        </section>
        <section>
          <h2>Fairness check</h2>
          <p className="secondary">Do patients without their own phone come back less often?</p>
          <FairnessTable groups={m.groups} />
          <div className="inset">
            {m.equityGapPp === null ? (
              <p>Not enough closed follow-ups yet to compare groups.</p>
            ) : m.equityAlert ? (
              <p>
                <strong>The gap is {m.equityGapPp} points</strong>, over the review line of {EQUITY_GAP_ALERT_PP}. Look at contact routes and ASHA coverage
                for the groups falling behind.
              </p>
            ) : (
              <p>
                The gap between groups is {m.equityGapPp} points. It is reviewed if it goes over {EQUITY_GAP_ALERT_PP}. Groups with fewer than 10
                follow-ups are shown but not compared.
              </p>
            )}
          </div>
        </section>
      </div>

      <h2>Reading the clinicians’ notes</h2>
      <p className="secondary">How often the nurse at the desk changed what the reader proposed, last 13 weeks.</p>
      <SummaryList
        rows={[
          { key: 'Follow-ups confirmed', value: m.corrections.confirmed },
          { key: 'Accepted as read', value: `${pct(unchanged)} (${m.corrections.unchanged})` },
          { key: 'Date changed', value: m.corrections.byField.dueDate },
          { key: 'Bring list changed', value: m.corrections.byField.bring },
          { key: 'Tracked or not tracked changed', value: m.corrections.byField.tracking },
        ]}
      />
    </>
  );
}
