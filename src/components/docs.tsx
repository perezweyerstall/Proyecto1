// Presentación de documentos: icono, etiqueta y tarjeta.

import type { DocMeta, DocSource } from '../lib/db';
import { estimateMinutes, formatDuration } from '../lib/text';
import type { IconName } from './icons';
import { Icon, LinearProgress, type MenuAction, OverflowMenu } from './ui';

const SOURCES: Record<DocSource, { label: string; icon: IconName; tone: 'primary' | 'secondary' | 'tertiary' }> = {
  pdf: { label: 'PDF', icon: 'picture_as_pdf', tone: 'tertiary' },
  epub: { label: 'EPUB', icon: 'menu_book', tone: 'primary' },
  docx: { label: 'Word', icon: 'docs', tone: 'primary' },
  html: { label: 'Web', icon: 'web', tone: 'secondary' },
  markdown: { label: 'Markdown', icon: 'code', tone: 'secondary' },
  txt: { label: 'Texto', icon: 'description', tone: 'secondary' },
  text: { label: 'Texto pegado', icon: 'content_paste', tone: 'secondary' },
};

export function sourceInfo(source: DocSource) {
  return SOURCES[source] ?? SOURCES.text;
}

export function DocTile({ source, size = 'medium' }: { source: DocSource; size?: 'medium' | 'large' }) {
  const info = sourceInfo(source);
  return (
    <span className={`doc-tile doc-tile--${info.tone} doc-tile--${size}`} aria-hidden="true">
      <Icon name={info.icon} filled size={size === 'large' ? 32 : 24} />
    </span>
  );
}

export function progressOf(doc: DocMeta): number {
  return doc.length > 0 ? Math.min(doc.position / doc.length, 1) : 0;
}

const numberFormat = new Intl.NumberFormat('es');

export function docMetaLine(doc: DocMeta, rate: number): string {
  const progress = progressOf(doc);
  const total = estimateMinutes(doc.wordCount, rate);
  const parts = [sourceInfo(doc.source).label];
  if (progress >= 0.995) parts.push('Terminado');
  else if (progress > 0) parts.push(`Quedan ${formatDuration(total * (1 - progress))}`);
  else parts.push(`${formatDuration(total)} · ${numberFormat.format(doc.wordCount)} palabras`);
  return parts.join(' · ');
}

export function DocCard({
  doc,
  rate,
  onOpen,
  actions,
}: {
  doc: DocMeta;
  rate: number;
  onOpen: () => void;
  actions: MenuAction[];
}) {
  const progress = progressOf(doc);
  return (
    <li className="doc-card">
      <button type="button" className="doc-card__main state-layer" onClick={onOpen}>
        <DocTile source={doc.source} />
        <span className="doc-card__text">
          <span className="doc-card__title title-medium">{doc.title}</span>
          <span className="doc-card__meta body-medium">{docMetaLine(doc, rate)}</span>
          {progress > 0 && progress < 0.995 && (
            <LinearProgress value={progress} label={`Progreso de ${doc.title}`} />
          )}
        </span>
      </button>
      <OverflowMenu label={`Opciones de ${doc.title}`} actions={actions} />
    </li>
  );
}
