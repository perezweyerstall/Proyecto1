// Biblioteca: búsqueda, filtros y lista de documentos.

import { type ReactNode, useMemo, useState } from 'react';
import { DocCard } from '../components/docs';
import { Button, Icon, IconButton, type MenuAction } from '../components/ui';
import type { DocMeta, DocSource } from '../lib/db';
import { usePlayer } from '../player/PlayerContext';
import { useLibrary, useNotify, useSettings } from '../state/AppState';
import { useAddContent } from '../state/addContent';
import { navigate } from '../state/router';
import { ConfirmDeleteDialog, RenameDialog } from './dialogs';

/** Acciones de menú por documento y sus diálogos. */
export function useDocActions(): { actionsFor: (doc: DocMeta) => MenuAction[]; dialogs: ReactNode } {
  const { rename, remove } = useLibrary();
  const player = usePlayer();
  const notify = useNotify();
  const [target, setTarget] = useState<{ doc: DocMeta; kind: 'rename' | 'delete' } | null>(null);

  const actionsFor = (doc: DocMeta): MenuAction[] => [
    { label: 'Cambiar nombre', icon: 'edit', onSelect: () => setTarget({ doc, kind: 'rename' }) },
    { label: 'Eliminar', icon: 'delete', danger: true, onSelect: () => setTarget({ doc, kind: 'delete' }) },
  ];

  const dialogs = target && (
    <>
      <RenameDialog
        open={target.kind === 'rename'}
        initial={target.doc.title}
        onClose={() => setTarget(null)}
        onSave={async (title) => {
          await rename(target.doc.id, title);
          setTarget(null);
        }}
      />
      <ConfirmDeleteDialog
        open={target.kind === 'delete'}
        title={target.doc.title}
        onClose={() => setTarget(null)}
        onConfirm={async () => {
          if (player.doc?.id === target.doc.id) player.close();
          await remove(target.doc.id);
          setTarget(null);
          notify('Documento eliminado');
        }}
      />
    </>
  );

  return { actionsFor, dialogs };
}

type Filter = 'all' | 'progress' | DocSource;

const FILTERS: { value: Filter; label: string; sources?: DocSource[] }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'progress', label: 'En curso' },
  { value: 'pdf', label: 'PDF', sources: ['pdf'] },
  { value: 'epub', label: 'Libros', sources: ['epub'] },
  { value: 'docx', label: 'Word', sources: ['docx'] },
  { value: 'text', label: 'Texto', sources: ['text', 'txt', 'markdown'] },
  { value: 'html', label: 'Web', sources: ['html'] },
];

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function Library() {
  const { docs, loading } = useLibrary();
  const { settings } = useSettings();
  const { openAdd } = useAddContent();
  const { actionsFor, dialogs } = useDocActions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const available = useMemo(
    () =>
      FILTERS.filter(
        (f) =>
          f.value === 'all' ||
          (f.value === 'progress'
            ? docs.some((d) => d.position > 0 && d.position < d.length - 1)
            : docs.some((d) => f.sources?.includes(d.source))),
      ),
    [docs],
  );

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    const rule = FILTERS.find((f) => f.value === filter);
    return docs.filter((doc) => {
      if (q && !normalize(doc.title).includes(q)) return false;
      if (filter === 'progress') return doc.position > 0 && doc.position < doc.length - 1;
      if (rule?.sources) return rule.sources.includes(doc.source);
      return true;
    });
  }, [docs, query, filter]);

  return (
    <div className="page">
      <header className="page-header page-header--stacked">
        <h1 className="headline-medium">Biblioteca</h1>
        <label className="search-bar">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Buscar en tu biblioteca"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          {query && <IconButton icon="close" label="Borrar búsqueda" onClick={() => setQuery('')} />}
        </label>
      </header>

      {available.length > 2 && (
        <div className="chip-row" role="group" aria-label="Filtrar por tipo">
          {available.map((f) => (
            <button
              key={f.value}
              type="button"
              className="chip state-layer"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {filter === f.value && <Icon name="check" size={18} />}
              {f.label}
            </button>
          ))}
        </div>
      )}

      {!loading && docs.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__art">
            <Icon name="auto_stories" size={48} />
          </span>
          <h2 className="headline-small">Tu biblioteca está vacía</h2>
          <p className="body-medium">Pega un texto o sube un PDF, un libro EPUB o un documento de Word.</p>
          <Button variant="filled" icon="add" onClick={openAdd}>
            Añadir contenido
          </Button>
        </div>
      ) : visible.length === 0 && !loading ? (
        <div className="empty-state">
          <span className="empty-state__art">
            <Icon name="search" size={48} />
          </span>
          <h2 className="headline-small">Sin resultados</h2>
          <p className="body-medium">
            Ningún documento coincide{query ? ` con «${query}»` : ''}
            {filter !== 'all' ? ` en ${FILTERS.find((f) => f.value === filter)?.label}` : ''}.
          </p>
        </div>
      ) : (
        <ul className="doc-list doc-list--grid" aria-label="Documentos">
          {visible.map((doc) => (
            <DocCard
              key={doc.id}
              doc={doc}
              rate={settings.rate}
              onOpen={() => navigate({ name: 'reader', id: doc.id })}
              actions={actionsFor(doc)}
            />
          ))}
        </ul>
      )}
      {dialogs}
    </div>
  );
}

