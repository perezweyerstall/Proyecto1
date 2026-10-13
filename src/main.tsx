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
