// Escribe en dist/sw.js la lista de archivos que el service worker guarda al instalarse.
// Uso: node scripts/precache-sw.mjs (se ejecuta tras `vite build`).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const MARKER = '[/* __PRECACHE__ */]';
const files = readdirSync('dist/assets').filter((f) => !f.endsWith('.map'));
const list = ['./', './manifest.webmanifest', './icon.svg', ...files.map((f) => `./assets/${f}`)];
const version = createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 10);
const sw = readFileSync('dist/sw.js', 'utf8');
if (!sw.includes(MARKER)) throw new Error('dist/sw.js no contiene el marcador __PRECACHE__');
writeFileSync(
  'dist/sw.js',
  sw.replace(MARKER, JSON.stringify(list)).replace("'escucha-dev'", `'escucha-${version}'`),
);
console.log(`sw.js: ${list.length} archivos precargados, caché escucha-${version}`);
