// Genera src/components/icons.ts con los trazados SVG de Material Symbols Rounded.
// Uso: node scripts/gen-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(require.resolve('@material-symbols/svg-400/package.json')), 'rounded');

const names = [
  'add', 'arrow_back', 'article', 'auto_stories', 'brightness_auto', 'check', 'close',
  'content_paste', 'dark_mode', 'delete', 'description', 'docs', 'edit', 'error',
  'fast_forward', 'fast_rewind', 'format_size', 'graphic_eq', 'headphones', 'home',
  'info', 'keyboard_arrow_down', 'library_books', 'light_mode', 'local_fire_department',
  'menu_book', 'more_vert', 'my_location', 'palette', 'pause', 'picture_as_pdf',
  'play_arrow', 'record_voice_over', 'schedule', 'search', 'settings', 'speed',
  'upload_file', 'volume_up', 'remove', 'chevron_right', 'translate', 'tune', 'replay',
  'cloud', 'text_fields', 'keyboard', 'delete_forever', 'web', 'code',
];

const pathOf = (file) => {
  const svg = readFileSync(join(root, file), 'utf8');
  const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length === 0) throw new Error(`Sin trazado en ${file}`);
  return paths.join(' ');
};

const lines = names.map((name) => {
  const outline = pathOf(`${name}.svg`);
  const fill = pathOf(`${name}-fill.svg`);
  return `  ${name}: [${JSON.stringify(outline)}, ${JSON.stringify(fill)}],`;
});

const out = `// Archivo generado por scripts/gen-icons.mjs. No editar a mano.
// Fuente: Material Symbols Rounded (Apache-2.0), peso 400, viewBox 0 -960 960 960.
export const ICONS = {
${lines.join('\n')}
} as const satisfies Record<string, readonly [string, string]>;

export type IconName = keyof typeof ICONS;
`;
writeFileSync(new URL('../src/components/icons.ts', import.meta.url), out);
console.log(`Generados ${names.length} iconos.`);
