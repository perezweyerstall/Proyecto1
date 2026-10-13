import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    // El paquete publica imports sin extensión que Node no resuelve.
    server: { deps: { inline: ['@material/material-color-utilities'] } },
  },
});
