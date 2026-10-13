// Diálogos compartidos: añadir contenido, pegar texto, renombrar y eliminar.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, Icon } from '../components/ui';
import { ACCEPTED_FILES, ImportError, importFile } from '../lib/importers';
import { countWords, deriveTitle, normalizeText } from '../lib/text';
import { useLibrary, useNotify } from '../state/AppState';
import { navigate } from '../state/router';

export function RenameDialog({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: string;
  onClose: () => void;
  onSave: (title: string) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(initial);
  useEffect(() => setTitle(initial), [initial, open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cambiar nombre"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="text" type="submit" form="rename-form" disabled={!title.trim()}>
            Guardar
          </Button>
        </>
      }
    >
      <form
        id="rename-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) void onSave(title);
        }}
      >
        <label className="field">
          <span className="field__label">Nombre</span>
          <input
            className="field__input"
            value={title}
            data-autofocus
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
        </label>
      </form>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({
  open,
  title,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon="delete"
      title="¿Eliminar documento?"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="text" onClick={() => void onConfirm()}>
            Eliminar
          </Button>
        </>
      }
    >
      <p className="body-medium">
        «{title}» se eliminará de este dispositivo. No podrás recuperarlo.
      </p>
    </Dialog>
  );
}

const numberFormat = new Intl.NumberFormat('es');

export function PasteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addText } = useLibrary();
  const notify = useNotify();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setText('');
  }, [open]);

  const words = text.trim() ? countWords(text) : 0;

  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const meta = await addText({
        title: title.trim() || deriveTitle(normalizeText(text)),
        text,
        source: 'text',
      });
      onClose();
      navigate({ name: 'reader', id: meta.id });
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo guardar el texto.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Pegar texto"
      className="paste-dialog"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="filled" icon="headphones" disabled={!text.trim() || saving} onClick={save}>
            Escuchar
          </Button>
        </>
      }
    >
      <div className="paste-form">
        <label className="field">
          <span className="field__label">Título (opcional)</span>
          <input className="field__input" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        </label>
        <label className="field">
          <span className="field__label">Texto</span>
          <textarea
            className="field__input paste-form__text"
            value={text}
            data-autofocus
            rows={10}
            placeholder="Pega o escribe aquí el texto que quieres escuchar"
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <span className="field__support">{numberFormat.format(words)} palabras</span>
        </label>
        {'clipboard' in navigator && 'readText' in navigator.clipboard && (
          <Button
            variant="tonal"
            icon="content_paste"
            onClick={async () => {
              try {
                const clip = await navigator.clipboard.readText();
                if (clip) setText((current) => (current ? `${current}\n\n${clip}` : clip));
                else notify('El portapapeles está vacío.');
              } catch {
                notify('No hay permiso para leer el portapapeles. Usa Ctrl+V.');
              }
            }}
          >
            Pegar del portapapeles
          </Button>
        )}
      </div>
    </Dialog>
  );
}

/** Importa archivos a la biblioteca y abre el primero. */
export function useFileImport() {
  const { addText } = useLibrary();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      let first: string | null = null;
      let added = 0;
      for (const file of files) {
        try {
          const imported = await importFile(file);
          const meta = await addText(imported);
          first ??= meta.id;
          added++;
        } catch (error) {
          const reason =
            error instanceof ImportError || (error instanceof Error && error.message.startsWith('El documento'))
              ? error.message
              : 'No se pudo leer el archivo.';
          notify(`${file.name}: ${reason}`);
          console.error(error);
        }
      }
      setBusy(false);
      if (added > 1) notify(`${added} documentos añadidos`);
      if (first) navigate({ name: 'reader', id: first });
    },
    [addText, notify],
  );

  return { importFiles, busy };
}

export function AddSheet({
  open,
  onClose,
  onPaste,
  onPickFile,
}: {
  open: boolean;
  onClose: () => void;
  onPaste: () => void;
  onPickFile: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} sheet flush title="Añadir a la biblioteca">
      <ul className="list add-list">
        <li>
          <button type="button" className="list-item state-layer" onClick={onPaste}>
            <span className="list-item__leading add-list__icon">
              <Icon name="content_paste" />
            </span>
            <span className="list-item__text">
              <span className="list-item__headline">Pegar o escribir texto</span>
              <span className="list-item__supporting">Artículos, correos, apuntes…</span>
            </span>
            <Icon name="chevron_right" className="add-list__chevron" />
          </button>
        </li>
        <li>
          <button type="button" className="list-item state-layer" onClick={onPickFile}>
            <span className="list-item__leading add-list__icon">
              <Icon name="upload_file" />
            </span>
            <span className="list-item__text">
              <span className="list-item__headline">Subir archivo</span>
              <span className="list-item__supporting">PDF, EPUB, Word, TXT, Markdown o HTML</span>
            </span>
            <Icon name="chevron_right" className="add-list__chevron" />
          </button>
        </li>
      </ul>
    </Dialog>
  );
}

/** Entrada de archivo oculta y su disparador. */
export function useFilePicker(onFiles: (files: File[]) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_FILES}
      multiple
      hidden
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        e.currentTarget.value = '';
        onFiles(files);
      }}
    />
  );
  return { input, pick: () => inputRef.current?.click() };
}
