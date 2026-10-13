import '@fontsource-variable/google-sans-flex';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installRipple } from './components/ui';
import { loadSettings } from './state/settings';
import { applyScheme } from './theme/color';

// Aplica el tema antes del primer pintado para evitar destellos.
const initial = loadSettings();
const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
applyScheme(
  initial.seedColor,
  initial.themeMode === 'dark' || (initial.themeMode === 'system' && prefersDark),
);
installRipple();

// Tras una publicación nueva, los fragmentos antiguos (PDF, ZIP) ya no existen.
// Recarga una vez para usar la versión nueva.
window.addEventListener('vite:preloadError', () => {
  const KEY = 'escucha.chunk-reload';
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Sin almacenamiento de sesión: recarga igualmente.
  }
  location.reload();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Sin modo sin conexión', error));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
