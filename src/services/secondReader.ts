import { isSecondProposal, type SecondProposal } from '../core/secondReader';
import type { ISODate } from '../core/types';

export interface ReaderStatus {
  enabled: boolean;
  model: string | null;
}

/** Static hosting has no /api route: anything that is not our JSON means "not configured". */
export async function fetchReaderStatus(): Promise<ReaderStatus> {
  try {
    const res = await fetch('/api/second-reader/status', { headers: { Accept: 'application/json' } });
    if (!res.ok) return { enabled: false, model: null };
    const body = (await res.json()) as { enabled?: unknown; model?: unknown };
    return { enabled: body.enabled === true, model: typeof body.model === 'string' ? body.model : null };
  } catch {
    return { enabled: false, model: null };
  }
}

export type SecondReaderResult = { ok: true; proposal: SecondProposal; model: string } | { ok: false; error: string };

export async function askSecondReader(instruction: string, visitDate: ISODate): Promise<SecondReaderResult> {
  try {
    const res = await fetch('/api/second-reader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ instruction, visitDate }),
    });
    const body = (await res.json().catch(() => null)) as { error?: unknown; proposal?: unknown; model?: unknown } | null;
    if (!res.ok || !body) {
      return { ok: false, error: typeof body?.error === 'string' ? body.error : `Gemini is unavailable (${res.status}).` };
    }
    if (!isSecondProposal(body.proposal)) return { ok: false, error: 'Gemini returned an answer in an unexpected shape.' };
    return { ok: true, proposal: body.proposal, model: typeof body.model === 'string' ? body.model : 'Gemini' };
  } catch {
    return { ok: false, error: 'Could not reach the second-reader service.' };
  }
}
