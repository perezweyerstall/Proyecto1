// Importación de archivos a texto plano.
// Formatos: TXT, Markdown, HTML, PDF, EPUB y DOCX.

import type { DocSource } from './db';

export interface Imported {
  title: string;
  text: string;
  source: DocSource;
}

export const ACCEPTED_FILES =
  '.txt,.text,.md,.markdown,.html,.htm,.pdf,.epub,.docx,text/plain,text/markdown,text/html,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class ImportError extends Error {}

function extension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function baseName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim() || 'Documento';
}

/** Usa el título de metadatos salvo que parezca un nombre de archivo o esté vacío. */
function pickTitle(meta: string | undefined, fallback: string): string {
  if (!meta || meta.length < 3 || /\.(docx?|pdf|txt|tex|indd)$|^untitled|^microsoft word/i.test(meta)) {
    return fallback;
  }
  return meta;
}

export async function importFile(file: File): Promise<Imported> {
  const ext = extension(file.name);
  const title = baseName(file.name);
  switch (ext) {
    case 'txt':
    case 'text':
      return { title, text: await file.text(), source: 'txt' };
    case 'md':
    case 'markdown':
      return { title, text: stripMarkdown(await file.text()), source: 'markdown' };
    case 'html':
    case 'htm': {
      const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
      const docTitle = doc.querySelector('title')?.textContent?.trim();
      return { title: docTitle || title, text: htmlToText(doc), source: 'html' };
    }
    case 'pdf': {
      const pdf = await pdfToText(file);
      return { title: pickTitle(pdf.title, title), text: pdf.text, source: 'pdf' };
    }
    case 'epub': {
      const epub = await epubToText(file);
      return { title: epub.title || title, text: epub.text, source: 'epub' };
    }
    case 'docx': {
      const docx = await docxToText(file);
      return { title: pickTitle(docx.title, title), text: docx.text, source: 'docx' };
    }
    default:
      if (file.type.startsWith('text/')) return { title, text: await file.text(), source: 'txt' };
      throw new ImportError(`Formato no compatible: ${ext ? `.${ext}` : file.type || 'desconocido'}`);
  }
}

/** Quita la sintaxis de Markdown y conserva el texto legible. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/^```.*$/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/^[ \t]*\d+\.[ \t]+/gm, '')
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1');
}

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'IFRAME', 'TEMPLATE', 'HEAD',
]);
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL',
  'BLOCKQUOTE', 'PRE', 'TR', 'TABLE', 'FIGCAPTION', 'DT', 'DD', 'BR', 'HR',
]);

/** Extrae texto de un documento HTML. Cada bloque produce un párrafo. */
export function htmlToText(doc: Document): string {
  const root = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body ?? doc.documentElement;
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push((node.textContent ?? '').replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push('\n\n');
    node.childNodes.forEach(walk);
    if (block) parts.push('\n\n');
  };
  if (root) walk(root);
  return parts.join('');
}

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

async function pdfToText(file: File): Promise<{ text: string; title?: string }> {
  // La versión legacy incluye polyfills: la estándar exige APIs de 2026 (Map.getOrInsertComputed).
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const pdf = await task.promise;
  try {
    const lines: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let line = '';
      for (const item of content.items as PdfTextItem[]) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        }
      }
      if (line) lines.push(line);
      lines.push('');
      page.cleanup();
    }
    const text = joinPdfLines(lines);
    if (!text.trim()) {
      throw new ImportError('El PDF no contiene texto seleccionable. Puede ser un escaneo.');
    }
    const meta = await pdf.getMetadata().catch(() => null);
    const info = meta?.info as { Title?: string } | undefined;
    return { text, title: info?.Title?.trim() || undefined };
  } finally {
    await task.destroy();
  }
}

/**
 * Une líneas de PDF en párrafos.
 * Una línea corta que termina en puntuación final cierra párrafo.
 * Un guion final une la palabra partida.
 */
export function joinPdfLines(lines: string[]): string {
  const trimmed = lines.map((l) => l.replace(/\s+/g, ' ').trim());
  const lengths = trimmed.filter((l) => l.length > 0).map((l) => l.length).sort((a, b) => a - b);
  const typical = lengths.length ? lengths[Math.floor(lengths.length * 0.75)] : 0;
  let out = '';
  let paragraph = '';
  const flush = () => {
    if (paragraph.trim()) out += (out ? '\n\n' : '') + paragraph.trim();
    paragraph = '';
  };
  for (const line of trimmed) {
    if (!line) {
      // Fin de página: solo cierra párrafo si la última línea acabó en puntuación final.
      if (/[.!?:…"”»]$/.test(paragraph)) flush();
      continue;
    }
    if (/\p{L}-$/u.test(paragraph)) paragraph = paragraph.slice(0, -1) + line;
    else paragraph += (paragraph ? ' ' : '') + line;
    const endsSentence = /[.!?:…"”»]$/.test(line);
    if (endsSentence && line.length < typical * 0.8) flush();
  }
  flush();
  return out;
}

async function loadZip(file: File) {
  const { default: JSZip } = await import('jszip');
  try {
    return await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new ImportError('El archivo está dañado o no es un paquete válido.');
  }
}

function parseXml(source: string, type: DOMParserSupportedType = 'application/xml'): Document {
  return new DOMParser().parseFromString(source, type);
}

function resolvePath(base: string, href: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const segment of decodeURIComponent(href.split('#')[0]).split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

async function epubToText(file: File): Promise<{ text: string; title?: string }> {
  const zip = await loadZip(file);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new ImportError('EPUB sin META-INF/container.xml.');
  const opfPath = parseXml(container).querySelector('rootfile')?.getAttribute('full-path');
  const opfSource = opfPath ? await zip.file(opfPath)?.async('string') : undefined;
  if (!opfPath || !opfSource) throw new ImportError('EPUB sin paquete OPF.');
  const opf = parseXml(opfSource);

  const manifest = new Map<string, string>();
  for (const item of Array.from(opf.getElementsByTagName('item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, resolvePath(opfPath, href));
  }
  const chapters: string[] = [];
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    const path = manifest.get(ref.getAttribute('idref') ?? '');
    const source = path ? await zip.file(path)?.async('string') : undefined;
    if (!source) continue;
    let doc = parseXml(source, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = parseXml(source, 'text/html');
    chapters.push(htmlToText(doc));
  }
  const text = chapters.join('\n\n');
  if (!text.trim()) throw new ImportError('El EPUB no contiene texto legible.');
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim();
  return { text, title: title || undefined };
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function docxToText(file: File): Promise<{ text: string; title?: string }> {
  const zip = await loadZip(file);
  const source = await zip.file('word/document.xml')?.async('string');
  if (!source) throw new ImportError('DOCX sin word/document.xml.');
  const doc = parseXml(source);
  const paragraphs: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))) {
    let line = '';
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child.namespaceURI === W_NS && child.localName === 't') line += child.textContent ?? '';
        else if (child.namespaceURI === W_NS && (child.localName === 'tab' || child.localName === 'br')) line += ' ';
        else walk(child);
      }
    };
    walk(p);
    paragraphs.push(line);
  }
  const text = paragraphs.join('\n\n');
  if (!text.trim()) throw new ImportError('El documento de Word está vacío.');
  const core = await zip.file('docProps/core.xml')?.async('string');
  const title = core ? parseXml(core).getElementsByTagName('dc:title')[0]?.textContent?.trim() : undefined;
  return { text, title: title || undefined };
}
