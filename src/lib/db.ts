// Biblioteca persistente en IndexedDB.
// Los metadatos y el texto se guardan en almacenes separados. Listar no carga textos.

export type DocSource = 'text' | 'txt' | 'markdown' | 'html' | 'pdf' | 'epub' | 'docx';

export interface DocMeta {
  id: string;
  title: string;
  source: DocSource;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  /** Posición de lectura en caracteres. */
  position: number;
  /** Longitud del texto en caracteres. */
  length: number;
  wordCount: number;
  lang: string | null;
}

interface DocText {
  id: string;
  text: string;
}

const DB_NAME = 'escucha';
const DB_VERSION = 1;
const META = 'docs';
const TEXTS = 'texts';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(TEXTS)) db.createObjectStore(TEXTS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transacción abortada'));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Lista los documentos. Ordena por última apertura y después por creación. */
export async function listDocs(): Promise<DocMeta[]> {
  const db = await open();
  const docs = await result<DocMeta[]>(db.transaction(META).objectStore(META).getAll());
  return docs.sort(
    (a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt) || b.createdAt - a.createdAt,
  );
}

export async function getDoc(id: string): Promise<DocMeta | undefined> {
  const db = await open();
  return result<DocMeta | undefined>(db.transaction(META).objectStore(META).get(id));
}

export async function getText(id: string): Promise<string | undefined> {
  const db = await open();
  const row = await result<DocText | undefined>(db.transaction(TEXTS).objectStore(TEXTS).get(id));
  return row?.text;
}

export interface NewDoc {
  title: string;
  source: DocSource;
  text: string;
  wordCount: number;
  lang: string | null;
}

export async function addDoc(input: NewDoc): Promise<DocMeta> {
  const db = await open();
  const now = Date.now();
  const meta: DocMeta = {
    id: newId(),
    title: input.title,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    position: 0,
    length: input.text.length,
    wordCount: input.wordCount,
    lang: input.lang,
  };
  const tx = db.transaction([META, TEXTS], 'readwrite');
  tx.objectStore(META).put(meta);
  tx.objectStore(TEXTS).put({ id: meta.id, text: input.text } satisfies DocText);
  await done(tx);
  return meta;
}

/** Actualiza campos de metadatos. Devuelve el documento actualizado. */
export async function updateDoc(
  id: string,
  patch: Partial<Pick<DocMeta, 'title' | 'position' | 'lastOpenedAt'>>,
): Promise<DocMeta | undefined> {
  const db = await open();
  const tx = db.transaction(META, 'readwrite');
  const store = tx.objectStore(META);
  const current = await result<DocMeta | undefined>(store.get(id));
  if (!current) {
    await done(tx);
    return undefined;
  }
  const next: DocMeta = { ...current, ...patch, updatedAt: Date.now() };
  store.put(next);
  await done(tx);
  return next;
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([META, TEXTS], 'readwrite');
  tx.objectStore(META).delete(id);
  tx.objectStore(TEXTS).delete(id);
  await done(tx);
}

export async function clearAll(): Promise<void> {
  const db = await open();
  const tx = db.transaction([META, TEXTS], 'readwrite');
  tx.objectStore(META).clear();
  tx.objectStore(TEXTS).clear();
  await done(tx);
}
