// Optional local persistence of the user's own CAT.EXE (IndexedDB, this browser only).

const DB = 'alleycat-port';
const STORE = 'files';
const KEY = 'CAT.EXE';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
      }),
  );
}

export async function storeFile(bytes) {
  await tx('readwrite', (s) => s.put(bytes, KEY));
}

export async function loadStoredFile() {
  const v = await tx('readonly', (s) => s.get(KEY));
  return v ? new Uint8Array(v) : null;
}

export async function forgetFile() {
  await tx('readwrite', (s) => s.delete(KEY));
}
