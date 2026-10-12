// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { createSeedState } from '../src/core/seed';
import { buildWorkItems } from '../src/core/worklist';
import type { AppState } from '../src/core/types';
import { StoreProvider } from '../src/state/store';

beforeAll(() => {
  window.scrollTo = () => {};
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

function renderAt(hash: string, state: AppState = createSeedState()) {
  window.location.hash = hash;
  return render(
    <StoreProvider initial={state}>
      <App />
    </StoreProvider>,
  );
}

describe('app smoke test', () => {
  it('shows the open misses and the work for today', () => {
    renderAt('#/today');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Follow-ups today');
    expect(screen.getByText('of them not contacted at all')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Work for today' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fairness check' })).toBeTruthy();
  });

  it('lets the nurse confirm a desk patient and shows the bilingual slip', () => {
    renderAt('#/desk', { ...createSeedState(), role: 'nurse' });
    expect(screen.getByRole('heading', { level: 1, name: 'Sunita Devi' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Routine'));
    fireEvent.click(screen.getByLabelText('Reminder texts to this number'));
    fireEvent.click(screen.getByRole('button', { name: 'Save and show slip' }));
    expect(screen.getByText(/Sunita Devi is booked for Monday, 26 Oct 2026/)).toBeTruthy();
    expect(screen.getByText('District Hospital · Follow-up slip')).toBeTruthy();
    expect(screen.getByText('जिला अस्पताल · दोबारा दिखाने की पर्ची')).toBeTruthy();
  });

  it('refuses to save without the clinician’s importance', () => {
    renderAt('#/desk', { ...createSeedState(), role: 'nurse' });
    fireEvent.click(screen.getByRole('button', { name: 'Save and show slip' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Choose the importance level/);
  });

  it('opens a case page from the worklist', async () => {
    const state = createSeedState();
    renderAt('#/worklist?lane=call', state);
    const first = buildWorkItems(state).find((i) => i.lane === 'call' && !i.waitingUntil)!;
    fireEvent.click(screen.getByRole('link', { name: first.patient.name }));
    expect(await screen.findByRole('heading', { level: 1, name: first.patient.name })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Why it is in this place' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
    expect(screen.getByText('Visible to nurses only.')).toBeTruthy();
  });

  it('runs every acceptance check and they pass', () => {
    renderAt('#/brief');
    fireEvent.click(screen.getByRole('button', { name: 'Run the checks' }));
    expect(screen.getByText('16 of 16 pass')).toBeTruthy();
  });

  it('checks a returning patient in at registration', () => {
    const state = createSeedState();
    const missed = buildWorkItems(state).find((i) => i.lane === 'call')!;
    renderAt('#/checkin', state);
    fireEvent.change(screen.getByLabelText('Find a patient'), { target: { value: missed.patient.regNo } });
    fireEvent.click(screen.getByRole('button', { name: missed.patient.name }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Here for this follow-up' })[0]);
    expect(screen.getByRole('status').textContent).toMatch(/checked in/);
  });

  it('renders the audit trail', () => {
    renderAt('#/audit');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Who did what');
    expect(screen.getAllByRole('row').length).toBeGreaterThan(10);
  });
});
