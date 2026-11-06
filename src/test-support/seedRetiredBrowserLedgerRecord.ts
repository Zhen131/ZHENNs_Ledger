import {
  INDEXED_DB_STORAGE_DEFAULTS,
  type IndexedDbStorageAdapterOptions,
} from "@/platform/legacy";

/**
 * Puts a non-empty value where the retired browser ledger used to live, so a
 * presence check has something to find. The product never writes there; only
 * tests do, through this helper, with the same factory and options the
 * detector under test uses. The value is fictional: detection only asks
 * whether a record exists.
 */
export function seedRetiredBrowserLedgerRecord(
  options: IndexedDbStorageAdapterOptions = {},
  value: unknown = { fictionalRetiredLedger: true },
): Promise<void> {
  const factory = options.indexedDBFactory ?? globalThis.indexedDB;
  const databaseName =
    options.databaseName ?? INDEXED_DB_STORAGE_DEFAULTS.databaseName;
  const storeName = options.storeName ?? INDEXED_DB_STORAGE_DEFAULTS.storeName;
  const recordKey = options.recordKey ?? INDEXED_DB_STORAGE_DEFAULTS.recordKey;

  return new Promise((resolve, reject) => {
    const request = factory.open(
      databaseName,
      INDEXED_DB_STORAGE_DEFAULTS.databaseVersion,
    );
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value, recordKey);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}
