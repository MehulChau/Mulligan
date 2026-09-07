/**
 * A tiny promisified wrapper around exactly the slice of IndexedDB this app
 * needs: one database, one object store, get/set/delete by key. Not a
 * general-purpose idb library -- there's only ever one record in play here
 * (the in-progress round), so the extra surface area a real library brings
 * (cursors, indexes, transactions spanning multiple stores) would be
 * unused weight. IndexedDB's raw callback API is annoying, not unsafe, so
 * this doesn't carry the same "don't hand-roll it" risk the service worker
 * did.
 */

const DB_NAME = "mulligan";
const DB_VERSION = 1;

function openDb(storeName: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(storeName)) {
        req.result.createObjectStore(storeName);
      }
    };
    req.onsuccess = () => {
      settled = true;
      resolve(req.result);
    };
    req.onerror = () => {
      // Private browsing in some browsers, quota exhaustion, disabled
      // storage -- persistence degrades to "off" rather than breaking the
      // game. Never resolve twice if onblocked fires an eventual onerror too.
      if (!settled) {
        settled = true;
        resolve(null);
      }
    };
  });
}

export async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb(storeName);
  if (!db) return undefined;
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

export async function idbSet<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openDb(storeName);
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve(); // best-effort -- a failed save just means the next reload starts fresh
  });
}

export async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDb(storeName);
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
