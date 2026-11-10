import type { Lead } from "@/lib/constants";

// A tiny IndexedDB cache for the full leads list, used for stale-while-revalidate:
// the page paints instantly from the last complete set, then refreshes in the
// background. It stores the WHOLE list (never a capped subset), so counts shown
// from the cache are complete — just possibly a few seconds old until the
// background refresh lands. All failures degrade silently to "no cache".

const DB_NAME = "marshmallow";
const STORE = "leads_cache";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export interface LeadsCacheEntry {
  leads: Lead[];
  /** When this complete list was saved (ms since epoch), or null for old entries. */
  savedAt: number | null;
}

/** Read the cached full leads list for a cache key, or null if none/unavailable. */
export async function readLeadsCache(key: string): Promise<Lead[] | null> {
  return (await readLeadsCacheEntry(key))?.leads ?? null;
}

/** Read the cached list together with the time it was saved. */
export async function readLeadsCacheEntry(key: string): Promise<LeadsCacheEntry | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<LeadsCacheEntry | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const val = req.result as { leads?: unknown; savedAt?: unknown } | undefined;
        if (!val || !Array.isArray(val.leads)) return resolve(null);
        resolve({ leads: val.leads as Lead[], savedAt: typeof val.savedAt === "number" ? val.savedAt : null });
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/** Persist the full leads list for a cache key. Best-effort; ignores errors. */
export async function writeLeadsCache(key: string, leads: Lead[], savedAt: number = Date.now()): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ leads, savedAt }, key);
      const done = () => {
        try { db.close(); } catch { /* ignore */ }
        resolve();
      };
      tx.oncomplete = done;
      tx.onerror = done;
      tx.onabort = done;
    });
  } catch {
    // ignore quota / private-mode failures
  }
}
