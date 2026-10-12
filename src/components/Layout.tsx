import { useMemo, type ReactNode } from 'react';
import { ROLE_LABEL, setRole } from '../core/actions';
import { formatDate } from '../core/dates';
import { HOSPITAL } from '../core/policy';
import { advanceDays } from '../core/simulation';
import type { Role } from '../core/types';
import { buildWorkItems } from '../core/worklist';
import { href, type Page } from '../state/router';
import { useStore } from '../state/store';
import { ToastHost } from './ui';

const ROLES: Role[] = ['nurse', 'records', 'chw', 'admin'];

export function Layout({ page, children }: { page: Page; children: ReactNode }) {
  const { state, act, reset } = useStore();
  const items = useMemo(() => buildWorkItems(state), [state]);
  const toWork = items.filter((i) => !i.waitingUntil && (i.lane === 'call' || i.lane === 'chw' || i.lane === 'nurse')).length;

  const nav: { page: Page; label: string; count?: number }[] = [
    { page: 'today', label: 'Today' },
    { page: 'desk', label: 'Follow-up desk', count: state.desk.length },
    { page: 'worklist', label: 'Worklist', count: toWork },
    { page: 'checkin', label: 'Registration' },
    { page: 'audit', label: 'Audit trail' },
    { page: 'brief', label: 'About this prototype' },
  ];

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="header">
        <div className="container header-inner">
          <a className="logo" href={href('today')}>
            <span className="logo-03" aria-hidden="true">
              03
            </span>
            <span>
              <span className="logo-name">
                Dobara
                <span className="hi" lang="hi">
                  दोबारा
                </span>
              </span>
              <span className="logo-sub">OPD follow-up register</span>
            </span>
          </a>
          <div className="header-right">
            <span className="header-track">TRACK 03 · HEALTHCARE</span>
            <span className="header-org">{HOSPITAL.name}</span>
          </div>
        </div>
      </header>

      <nav className="nav" aria-label="Menu">
        <div className="container">
          <ul className="nav-list">
            {nav.map((n) => (
              <li key={n.page}>
                <a href={href(n.page)} aria-current={page === n.page ? 'page' : undefined}>
                  {n.label}
                  {n.count !== undefined ? <span className="nav-count">({n.count})</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="strip">
        <div className="container strip-inner">
          <strong className="tag tag--sim">Simulation</strong>
          <span>Simulated patients and dates. Nothing here is real.</span>
          <div className="strip-controls">
            <label>
              Viewing as
              <select className="select" value={state.role} onChange={(e) => act((s) => setRole(s, e.target.value as Role))}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <span>
              Date: <strong>{formatDate(state.today, 'long')}</strong>
            </span>
            <button type="button" className="link-button" onClick={() => act((s) => advanceDays(s, 1), 'Moved to the next day. Registrations for that day are in.')}>
              Next day
            </button>
            <button type="button" className="link-button" onClick={() => act((s) => advanceDays(s, 7), 'Moved forward a week. Registrations for those days are in.')}>
              Next week
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                if (window.confirm('Reset all demo data to the starting point?')) reset();
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <main id="main" className="container main">
        {children}
      </main>

      <footer className="footer">
        <div className="container">
          <p>Round 1 prototype for the AI Synergy Hackathon 2026, Track 03: Healthcare.</p>
          <p>
            All patients, phone numbers and outcomes are simulated. <a href={href('brief')}>Read about the problem and the approach</a>.
          </p>
        </div>
      </footer>
      <ToastHost />
    </>
  );
}
