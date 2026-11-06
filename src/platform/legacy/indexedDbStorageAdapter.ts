export const INDEXED_DB_STORAGE_DEFAULTS = {
  databaseName: "local-first-trading-ledger",
  databaseVersion: 1,
  storeName: "ledger",
  recordKey: "ledger:v1",
} as const;

export type IndexedDbStorageAdapterOptions = {
  databaseName?: string;
  databaseVersion?: number;
  storeName?: string;
  recordKey?: IDBValidKey;
  indexedDBFactory?: IDBFactory;
};

/**
 * Read-only view of where the retired browser whole-ledger used to live.
 *
 * The production composition calls only `read()` and reduces the result to
 * legacy presence. Nothing here writes, clears, or deletes that record; the
 * only side effect is the one `open()` itself has, which creates the empty
 * database and store when they do not exist yet.
 */
export class IndexedDbStorageAdapter {
  private readonly databaseName: string;
  private readonly databaseVersion: number;
  private readonly storeName: string;
  private readonly recordKey: IDBValidKey;
  private readonly indexedDBFactory: IDBFactory | undefined;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbStorageAdapterOptions = {}) {
    this.databaseName =
      options.databaseName ?? INDEXED_DB_STORAGE_DEFAULTS.databaseName;
    this.databaseVersion =
      options.databaseVersion ??
      INDEXED_DB_STORAGE_DEFAULTS.databaseVersion;
    this.storeName = options.storeName ?? INDEXED_DB_STORAGE_DEFAULTS.storeName;
    this.recordKey = options.recordKey ?? INDEXED_DB_STORAGE_DEFAULTS.recordKey;
    this.indexedDBFactory = options.indexedDBFactory ?? globalThis.indexedDB;
  }

  async read(): Promise<unknown | null> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readonly");
      const request = transaction.objectStore(this.storeName).get(this.recordKey);
      let result: unknown | null = null;

      request.onsuccess = () => {
        result =
          request.result === undefined
            ? null
            : request.result;
      };
      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB read request failed"));
      };
      transaction.oncomplete = () => {
        resolve(result);
      };
      transaction.onerror = () => {
        reject(
          transaction.error ?? new Error("IndexedDB read transaction failed"),
        );
      };
      transaction.onabort = () => {
        reject(
          transaction.error ?? new Error("IndexedDB read transaction aborted"),
        );
      };
    });
  }

  async close(): Promise<void> {
    if (!this.databasePromise) {
      return;
    }

    const database = await this.databasePromise;
    database.close();
    this.databasePromise = undefined;
  }

  private openDatabase(): Promise<IDBDatabase> {
    const indexedDBFactory = this.indexedDBFactory;

    if (!indexedDBFactory) {
      return Promise.reject(
        new Error("IndexedDB is not available in this environment"),
      );
    }

    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDBFactory.open(
          this.databaseName,
          this.databaseVersion,
        );

        request.onupgradeneeded = () => {
          const database = request.result;

          if (!database.objectStoreNames.contains(this.storeName)) {
            database.createObjectStore(this.storeName);
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            this.databasePromise = undefined;
          };
          resolve(database);
        };
        request.onerror = () => {
          reject(request.error ?? new Error("IndexedDB open failed"));
        };
        request.onblocked = () => {
          reject(new Error("IndexedDB upgrade is blocked by another connection"));
        };
      }).catch((error) => {
        this.databasePromise = undefined;
        throw error;
      });
    }

    return this.databasePromise;
  }
}
