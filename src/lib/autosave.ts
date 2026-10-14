/** IndexedDB holds full projects, including imported mesh/texture data beyond localStorage's small quota. */
export const AUTOSAVE_KEY = "orbit-foundry.project.v1";
const DATABASE = "orbit-foundry-autosave",
  STORE = "projects";
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open browser storage"));
    request.onblocked = () => reject(new Error("Browser storage is blocked by another open tab"));
  });
}
export async function readAutosavedProject(): Promise<string | null> {
  // Successful IndexedDB writes remove this key. A remaining local fallback is therefore newer.
  try {
    const fallback = localStorage.getItem(AUTOSAVE_KEY);
    if (fallback !== null) return fallback;
  } catch {
    /* Continue with IndexedDB. */
  }
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    const result = await new Promise<unknown>((resolve, reject) => {
      const transaction = database!.transaction(STORE, "readonly"),
        request = transaction.objectStore(STORE).get(AUTOSAVE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return typeof result === "string" ? result : localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return localStorage.getItem(AUTOSAVE_KEY);
  } finally {
    database?.close();
  }
}
let pendingWrite: Promise<void> = Promise.resolve();
export function writeAutosavedProject(text: string): Promise<void> {
  const write = pendingWrite.catch(() => {}).then(() => writeProject(text));
  pendingWrite = write;
  return write;
}
async function writeProject(text: string): Promise<void> {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database!.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(text, AUTOSAVE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Browser storage write was aborted"));
    });
    // Migration succeeds only after the durable write; retain prior data on failure.
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      /* IndexedDB already saved the project. */
    }
  } catch (error) {
    // Private/restricted browsers may expose localStorage alone. Its quota error is surfaced to the user.
    try {
      localStorage.setItem(AUTOSAVE_KEY, text);
    } catch {
      throw new Error(
        `Browser autosave failed: ${(error as Error)?.message ?? "storage quota exceeded"}. Save a project file to keep all imported models and textures.`,
      );
    }
  } finally {
    database?.close();
  }
}
