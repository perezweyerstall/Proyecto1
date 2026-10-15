import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Las pruebas no usan el servidor de voz aunque el entorno lo defina.
    env: { VITE_TTS_URL: '' },
    // El paquete publica imports sin extensión que Node no resuelve.
    server: { deps: { inline: ['@material/material-color-utilities'] } },
  },
});
