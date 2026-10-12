/// <reference types="vitest/config" />
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

type Handler = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => Promise<void>;

/**
 * Serves /api/second-reader (optional Gemini cross-check) from the dev server. The handler
 * is loaded through Vite on first use, so the API key stays on the server and the config
 * does not depend on application code.
 */
function secondReaderApi(env: Record<string, string>): Plugin {
  let handler: Promise<Handler> | null = null;
  const load = (server: ViteDevServer) =>
    (handler ??= server
      .ssrLoadModule('/server/secondReaderApi.ts')
      .then((mod) => (mod as typeof import('./server/secondReaderApi')).secondReaderMiddleware({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL,
      })));
  return {
    name: 'second-reader-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/second-reader')) return next();
        load(server)
          .then((h) => h(req, res, next))
          .catch(next);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Reads .env / .env.local without the VITE_ prefix filter. Used here only, never sent to the browser.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), secondReaderApi(env)],
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      environment: 'node',
    },
  };
});
