// Enrutado mínimo por hash. Funciona en hosting estático sin configuración.

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'settings' }
  | { name: 'reader'; id: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, arg] = path.split('/');
  switch (head) {
    case 'biblioteca':
      return { name: 'library' };
    case 'ajustes':
      return { name: 'settings' };
    case 'leer':
      return arg ? { name: 'reader', id: decodeURIComponent(arg) } : { name: 'library' };
    default:
      return { name: 'home' };
  }
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'library':
      return '#/biblioteca';
    case 'settings':
      return '#/ajustes';
    case 'reader':
      return `#/leer/${encodeURIComponent(route.id)}`;
  }
}

/** Entradas de historial creadas por la app en esta sesión. */
let depth = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    depth = Math.max(0, depth - 1);
  });
}

export function navigate(route: Route, replace = false): void {
  const href = routeHref(route);
  if (href === location.hash || (href === '#/' && location.hash === '')) return;
  if (replace) {
    history.replaceState(null, '', href);
  } else {
    history.pushState(null, '', href);
    depth++;
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Vuelve atrás si hay historial propio. Si no, va al destino indicado. */
export function goBack(fallback: Route): void {
  if (depth > 0) history.back();
  else navigate(fallback, true);
}

const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => location.hash);
}
