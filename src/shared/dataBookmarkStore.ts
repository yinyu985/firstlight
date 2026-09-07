const DATABASE_NAME = "firstlight-data-bookmarks";
const STORE_NAME = "entries";
const DATABASE_VERSION = 1;
const ENTRY_TTL_MS = 60 * 60 * 1000;

interface DataBookmarkEntry {
  id: string;
  url: string;
  createdAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Unable to open data bookmark storage."));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Data bookmark storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Data bookmark storage was aborted."));
  });
}

export function createDataBookmarkId(): string {
  return crypto.randomUUID();
}

export function dataBookmarkViewerUrl(id: string, baseUrl: string): string {
  const viewerUrl = new URL("data-viewer.html", baseUrl);
  viewerUrl.hash = encodeURIComponent(id);
  return viewerUrl.href;
}

export async function stageDataBookmark(id: string, url: string): Promise<void> {
  if (!url.toLowerCase().startsWith("data:")) {
    throw new Error("Only data URLs can be staged for the data bookmark viewer.");
  }

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const cutoff = Date.now() - ENTRY_TTL_MS;
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const entry = cursor.value as DataBookmarkEntry;
      if (entry.createdAt < cutoff) cursor.delete();
      cursor.continue();
    };
    store.put({ id, url, createdAt: Date.now() } satisfies DataBookmarkEntry);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function consumeDataBookmark(id: string): Promise<string | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    const entry = await new Promise<DataBookmarkEntry | undefined>((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result as DataBookmarkEntry | undefined;
        if (result) store.delete(id);
        resolve(result);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to read the data bookmark."));
    });
    await transactionDone(transaction);
    return entry && Number.isFinite(entry.createdAt) && entry.createdAt >= Date.now() - ENTRY_TTL_MS ? entry.url : null;
  } finally {
    database.close();
  }
}

export async function cleanDataBookmarks(removeId?: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (removeId) store.delete(removeId);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value as DataBookmarkEntry;
      if (!Number.isFinite(entry.createdAt) || entry.createdAt < Date.now() - ENTRY_TTL_MS) cursor.delete();
      cursor.continue();
    };
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
