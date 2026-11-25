// Photos and videos wait here (IndexedDB) until they are uploaded, so a weak
// venue signal or a closed tab never loses a shot.

export type Job = {
  id: string;
  blob: Blob;
  kind: 'photo' | 'video';
  author: string;
  secs?: number;
  at: number;
};

const DB = 'kanta-queue';
const STORE = 'jobs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no idb')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { resolve(req.result); db.close(); };
      tx.onerror = () => { reject(tx.error); db.close(); };
    });
  } catch {
    return undefined; // storage unavailable (e.g. private mode): the in-memory queue still works
  }
}

export const putJob = (j: Job) => run('readwrite', s => s.put(j));
export const deleteJob = (id: string) => run('readwrite', s => s.delete(id));
export const allJobs = async (): Promise<Job[]> => ((await run('readonly', s => s.getAll())) as Job[] | undefined) ?? [];
