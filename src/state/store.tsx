import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RuleError } from '../core/actions';
import { createSeedState } from '../core/seed';
import type { AppState } from '../core/types';

const STORAGE_KEY = 'dobara:state:v1';

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

interface Store {
  state: AppState;
  /** Runs a core action. Rule errors become a toast and leave state unchanged. Returns true on success. */
  act: (fn: (s: AppState) => AppState, success?: string) => boolean;
  toast: Toast | null;
  notify: (kind: Toast['kind'], text: string) => void;
  dismiss: () => void;
  reset: () => void;
}

const StoreContext = createContext<Store | null>(null);

function load(): AppState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.followUps)) return parsed;
    }
  } catch {
    // Storage unavailable or corrupted: start from the simulated seed.
  }
  return createSeedState();
}

function save(state: AppState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or full storage: the demo still works for this session.
  }
}

export function StoreProvider({ children, initial }: { children: ReactNode; initial?: AppState }) {
  const [state, setState] = useState<AppState>(() => initial ?? load());
  const [toast, setToast] = useState<Toast | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const toastSeq = useRef(0);

  useEffect(() => {
    if (!initial) save(state);
  }, [state, initial]);

  const notify = useCallback((kind: Toast['kind'], text: string) => {
    setToast({ id: ++toastSeq.current, kind, text });
  }, []);

  const act = useCallback(
    (fn: (s: AppState) => AppState, success?: string) => {
      try {
        const next = fn(stateRef.current);
        stateRef.current = next;
        setState(next);
        if (success) notify('ok', success);
        return true;
      } catch (e) {
        if (e instanceof RuleError) {
          notify('error', e.message);
          return false;
        }
        throw e;
      }
    },
    [notify],
  );

  const reset = useCallback(() => {
    const fresh = createSeedState();
    stateRef.current = fresh;
    setState(fresh);
    notify('ok', 'Demo data reset to the simulated starting point.');
  }, [notify]);

  const dismiss = useCallback(() => setToast(null), []);

  const value = useMemo(() => ({ state, act, toast, notify, dismiss, reset }), [state, act, toast, notify, dismiss, reset]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
