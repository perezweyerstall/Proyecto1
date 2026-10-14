// Caché del audio generado. Volver a escuchar una frase no gasta cuota ni conexión.

export interface ClipCache {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  clear(): Promise<void>;
}

interface ClipRow {
  key: string;
  blob: Blob;
  at: number;
}

const DB_NAME = 'escucha-audio';
const STORE = 'clips';
/** Número máximo de frases guardadas. Unas 6000 frases son unos 150 MB. */
const MAX_CLIPS = 6000;
const PRUNE_BATCH = 500;

/** Hash rápido de 53 bits (cyrb53). Basta para claves de caché. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function clipKey(voice: string, text: string): string {
  return `${voice}|${text.length}|${hashText(text)}`;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Caché en IndexedDB. Si IndexedDB falla, funciona sin guardar nada. */
export function createClipCache(): ClipCache {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () => {
    dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('at', 'at');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
    return dbPromise;
  };

  async function prune(db: IDBDatabase): Promise<void> {
    const count = await promisify(db.transaction(STORE).objectStore(STORE).count());
    if (count <= MAX_CLIPS) return;
    const tx = db.transaction(STORE, 'readwrite');
    const index = tx.objectStore(STORE).index('at');
    let removed = 0;
    await new Promise<void>((resolve) => {
      const cursorRequest = index.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || removed >= PRUNE_BATCH) return resolve();
        cursor.delete();
        removed++;
        cursor.continue();
      };
      cursorRequest.onerror = () => resolve();
    });
  }

  return {
    async get(key) {
      try {
        const db = await open();
        const row = await promisify<ClipRow | undefined>(db.transaction(STORE).objectStore(STORE).get(key));
        return row?.blob;
      } catch {
        return undefined;
      }
    },
    async put(key, blob) {
      try {
        const db = await open();
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, blob, at: Date.now() } satisfies ClipRow);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        await prune(db);
      } catch {
        // Sin espacio o sin IndexedDB: el audio se usa sin guardar.
      }
    },
    async clear() {
      try {
        const db = await open();
        await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
      } catch {
        // Nada que borrar.
      }
    },
  };
}
