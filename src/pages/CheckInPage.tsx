import { useMemo, useState } from 'react';
import { markReturned } from '../core/actions';
import { formatDate, plural } from '../core/dates';
import { DEPARTMENTS } from '../core/policy';
import { effectiveDue, statusOf } from '../core/tracking';
import { buildWorkItems } from '../core/worklist';
import type { Patient } from '../core/types';
import { ImportanceTag, PatientBanner, StatusTag, WarningText } from '../components/ui';
import { useStore } from '../state/store';

export function CheckInPage() {
  const { state, act } = useStore();
  const [query, setQuery] = useState('');
  const [pid, setPid] = useState<string | null>(null);
  const patients = useMemo(() => Object.values(state.patients), [state.patients]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q.length < 2) return [];
    const lastFour = /^\d{4}$/.test(q);
    return patients
      .filter((p) => p.name.toLowerCase().includes(q) || p.regNo.toLowerCase().includes(q) || (lastFour && (p.phone?.endsWith(q) || p.caregiver?.phone?.endsWith(q))))
      .slice(0, 8);
  }, [patients, q]);

  const patient: Patient | null = pid ? state.patients[pid] ?? null : null;
  const pendingFor = (id: string) =>
    state.followUps.filter((fu) => fu.patientId === id && !fu.closure && !fu.returnedOn && fu.plan.tracking === 'dated' && fu.visitDate < state.today);
  const pending = patient ? pendingFor(patient.id) : [];
  const household = patient?.phone ? patients.filter((o) => o.id !== patient.id && o.phone === patient.phone).length : 0;
  const alerts = useMemo(() => buildWorkItems(state).filter((i) => i.lane === 'next_visit'), [state]);

  return (
    <>
      <span className="caption">Registration</span>
      <h1>Check in a returning patient</h1>
      <div className="grid grid-2-1">
        <div>
          <div className="form-group">
            <label className="label" htmlFor="find">
              Find a patient
            </label>
            <span className="hint">Name, registration number, or the last 4 digits of their phone</span>
            <input
              id="find"
              className="input w-30"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPid(null);
              }}
            />
          </div>

          {!patient && matches.length ? (
            <table className="table">
              <caption className="sr-only">Matching patients</caption>
              <tbody>
                {matches.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button type="button" className="link-button" style={{ fontWeight: 600 }} onClick={() => setPid(p.id)}>
                        {p.name}
                      </button>
                      <span className="cell-sub">
                        <span className="mono">{p.regNo}</span>, {p.age} {p.sex}, {p.village}
                      </span>
                    </td>
                    <td className="numeric">{pendingFor(p.id).length ? <StatusTag status="due" /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {!patient && q.length >= 2 && !matches.length ? <p>No patient found.</p> : null}

          {patient ? (
            <section>
              <button type="button" className="back-link link-button" onClick={() => setPid(null)}>
                Back to results
              </button>
              <h2>{patient.name}</h2>
              <PatientBanner patient={patient} />
              {pending.length === 0 ? (
                <div className="inset">
                  <p>No follow-up is pending. Register this as a new visit.</p>
                </div>
              ) : (
                pending.map((fu) => {
                  const status = statusOf(fu, state.today);
                  const due = effectiveDue(fu);
                  return (
                    <div key={fu.id} className="section">
                      <WarningText>
                        {patient.name.split(' ')[0]} has a {status === 'missed' ? 'missed' : 'pending'} follow-up in {DEPARTMENTS[fu.department].name} OPD.
                      </WarningText>
                      <div className="tags" style={{ marginBottom: 15 }}>
                        <ImportanceTag level={fu.plan.importance} />
                        <StatusTag status={status} />
                      </div>
                      <p>
                        {status === 'missed' ? 'It was due' : 'It is due'} on {due ? formatDate(due, 'long') : ''}. Seen {formatDate(fu.visitDate, 'medium')} by {fu.clinician}.
                      </p>
                      <p>Ask for: {['OPD card', ...fu.plan.bring.filter((b) => b !== 'OPD card')].join(', ')}.</p>
                      <button
                        type="button"
                        className="button"
                        onClick={() => act((s) => markReturned(s, fu.id), `${patient.name} checked in for the ${DEPARTMENTS[fu.department].short} follow-up.`)}
                      >
                        Here for this follow-up
                      </button>
                    </div>
                  );
                })
              )}
              {household > 0 ? (
                <p className="body-s secondary">
                  This phone number is also on file for {plural(household, 'other patient')}, so texts to it use the household wording.
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside>
          <h2>Registration alerts</h2>
          <p className="body-s secondary">Missed follow-ups with no agreed way to contact the patient. Check this list when someone registers.</p>
          {alerts.length ? (
            <table className="table table--s">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Importance</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(({ fu, patient: p }) => (
                  <tr key={fu.id}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          setQuery(p.regNo);
                          setPid(p.id);
                        }}
                      >
                        {p.name}
                      </button>
                      <span className="cell-sub">
                        {DEPARTMENTS[fu.department].short}, due {formatDate(fu.plan.dueDate!, 'short')}
                      </span>
                    </td>
                    <td>
                      <ImportanceTag level={fu.plan.importance} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No alerts.</p>
          )}
        </aside>
      </div>
    </>
  );
}
