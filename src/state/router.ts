import { useCallback, useEffect, useState } from 'react';

export type Page = 'today' | 'desk' | 'worklist' | 'checkin' | 'audit' | 'brief';

const PAGES: Page[] = ['today', 'desk', 'worklist', 'checkin', 'audit', 'brief'];

export interface Route {
  page: Page;
  params: URLSearchParams;
}

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const page = (PAGES as string[]).includes(path) ? (path as Page) : 'today';
  return { page, params: new URLSearchParams(query) };
}

export function href(page: Page, params?: Record<string, string>): string {
  const q = params ? new URLSearchParams(params).toString() : '';
  return `#/${page}${q ? `?${q}` : ''}`;
}

export function navigate(page: Page, params?: Record<string, string>): void {
  window.location.hash = href(page, params);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  const onChange = useCallback(() => setRoute(parse(window.location.hash)), []);
  useEffect(() => {
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [onChange]);
  return route;
}
