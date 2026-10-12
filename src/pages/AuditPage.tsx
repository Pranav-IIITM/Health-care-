import { useMemo, useState } from 'react';
import { ROLE_LABEL } from '../core/actions';
import { formatDate } from '../core/dates';
import type { AuditAction } from '../core/types';
import { useStore } from '../state/store';

const ACTION_LABEL: Record<AuditAction, string> = {
  confirmed: 'Follow-up confirmed',
  not_tracked: 'No fixed follow-up recorded',
  contact_updated: 'Contact and consent recorded',
  reminder_sent: 'Reminder text sent',
  message_sent: 'Missed-visit text sent',
  attempt_logged: 'Contact attempt',
  escalated: 'Sent to a nurse',
  returned_to_queue: 'Nurse review done',
  chw_assigned: 'Sent for an ASHA visit',
  closed: 'Closed with a reason',
  returned: 'Patient came back',
  number_viewed: 'Full phone number viewed',
  clinical_text_viewed: 'Clinician’s note viewed',
  clock_advanced: 'Demo date moved',
};

export function AuditPage() {
  const { state } = useStore();
  const [action, setAction] = useState<AuditAction | ''>('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...state.audit]
      .reverse()
      .filter((e) => (!action || e.action === action) && (!needle || (e.regNo ?? '').toLowerCase().includes(needle) || e.detail.toLowerCase().includes(needle)));
  }, [state.audit, action, q]);

  return (
    <>
      <span className="caption">Audit trail</span>
      <h1>Who did what</h1>
      <p className="lead">Every confirmation, consent, text, call, escalation and closure, with the date and the role. Opening a full phone number or a clinician’s note is recorded too.</p>
      <div className="inline-fields" style={{ marginBottom: 25 }}>
        <div className="form-group">
          <label className="label" htmlFor="a-action">
            Action
          </label>
          <select id="a-action" className="select" value={action} onChange={(e) => setAction(e.target.value as AuditAction | '')}>
            <option value="">All actions</option>
            {(Object.keys(ACTION_LABEL) as AuditAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="label" htmlFor="a-q">
            Registration number or text
          </label>
          <input id="a-q" className="input" style={{ width: 280 }} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="secondary" style={{ margin: '0 0 8px' }}>
          {rows.length} entries
        </p>
      </div>
      <div className="table-wrap">
        <table className="table table--s">
          <thead>
            <tr>
              <th>Date</th>
              <th>By</th>
              <th>Action</th>
              <th>Patient</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((e) => (
              <tr key={e.seq}>
                <td className="nowrap num">{formatDate(e.on, 'medium')}</td>
                <td className="nowrap">{e.role === 'system' ? 'System' : ROLE_LABEL[e.role]}</td>
                <td className="nowrap">{ACTION_LABEL[e.action]}</td>
                <td className="mono nowrap">{e.regNo ?? ''}</td>
                <td>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit ? (
        <button type="button" className="button button--secondary" onClick={() => setLimit((l) => l + 100)}>
          Show more
        </button>
      ) : null}
    </>
  );
}
