import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, GoogleGenAI } from '@google/genai';
import {
  isSecondProposal,
  scrubIdentifiers,
  SECOND_READER_INSTRUCTIONS,
  SECOND_READER_SCHEMA,
} from '../src/core/secondReader';

/*
 * Optional second reader on the Gemini API (free tier is enough for a demo).
 *
 * Runs server-side so the API key never reaches the browser. Only the clinician's
 * instruction is sent, with identifiers scrubbed — no name, phone or registration
 * number. Free-tier prompts may be used by Google to improve its products, so use
 * it with simulated data only. Request bodies are never logged.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const MAX_INSTRUCTION = 600;
const TIMEOUT_MS = 20_000;

export interface SecondReaderConfig {
  apiKey?: string;
  model?: string;
}

type Next = (err?: unknown) => void;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function secondReaderMiddleware(config: SecondReaderConfig) {
  const model = config.model?.trim() || DEFAULT_GEMINI_MODEL;
  const client = config.apiKey?.trim() ? new GoogleGenAI({ apiKey: config.apiKey.trim() }) : null;

  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/api/second-reader/status' && req.method === 'GET') {
      send(res, 200, { enabled: client !== null, model: client ? model : null });
      return;
    }
    if (path !== '/api/second-reader') {
      next();
      return;
    }
    if (req.method !== 'POST') {
      send(res, 405, { error: 'Use POST.' });
      return;
    }
    if (!client) {
      send(res, 503, { error: 'Gemini is not configured. Add GEMINI_API_KEY to .env.local and restart the dev server.' });
      return;
    }

    let instruction: unknown;
    let visitDate: unknown;
    try {
      ({ instruction, visitDate } = JSON.parse(await readBody(req, 4096)) as Record<string, unknown>);
    } catch {
      send(res, 400, { error: 'Send JSON: { "instruction": "...", "visitDate": "YYYY-MM-DD" }.' });
      return;
    }
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > MAX_INSTRUCTION) {
      send(res, 400, { error: `The instruction must be 1–${MAX_INSTRUCTION} characters.` });
      return;
    }
    if (typeof visitDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
      send(res, 400, { error: 'visitDate must be YYYY-MM-DD.' });
      return;
    }

    try {
      const response = await client.models.generateContent({
        model,
        contents: JSON.stringify({ visit_date: visitDate, instruction: scrubIdentifiers(instruction) }),
        config: {
          systemInstruction: SECOND_READER_INSTRUCTIONS,
          responseMimeType: 'application/json',
          responseJsonSchema: SECOND_READER_SCHEMA,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        },
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.text ?? '');
      } catch {
        send(res, 502, { error: 'Gemini did not return JSON. The rule reading still stands.' });
        return;
      }
      if (!isSecondProposal(parsed)) {
        send(res, 502, { error: 'Gemini returned JSON in an unexpected shape. The rule reading still stands.' });
        return;
      }
      send(res, 200, { model, proposal: parsed });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          send(res, 429, { error: 'Gemini free-tier limit reached. Wait a minute and try again.' });
        } else if (err.status === 400 || err.status === 404) {
          send(res, 502, { error: `Gemini rejected the request (${err.status}). Check GEMINI_MODEL ("${model}").` });
        } else if (err.status === 401 || err.status === 403) {
          send(res, 502, { error: 'Gemini refused the API key. Check GEMINI_API_KEY.' });
        } else {
          send(res, 502, { error: `Gemini error (${err.status}).` });
        }
        return;
      }
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        send(res, 504, { error: 'Gemini took too long to answer.' });
        return;
      }
      send(res, 502, { error: 'Could not reach Gemini.' });
    }
  };
}
