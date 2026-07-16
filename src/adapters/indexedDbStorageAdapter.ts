import type {
  StorageAdapter,
  StoredLedgerEnvelope,
} from "./storageAdapter";

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
 * 原生 IndexedDB whole-blob 实现。
 *
 * 它只保存一个固定 key 的 envelope，不解析账本、不调用加密、不计算业务数据。
 */
export class IndexedDbStorageAdapter implements StorageAdapter {
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

  async read(): Promise<StoredLedgerEnvelope | null> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readonly");
      const request = transaction.objectStore(this.storeName).get(this.recordKey);
      let result: StoredLedgerEnvelope | null = null;

      request.onsuccess = () => {
        result =
          request.result === undefined
            ? null
            : (request.result as StoredLedgerEnvelope);
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

  async write(envelope: StoredLedgerEnvelope): Promise<void> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;

      try {
        transaction = database.transaction(this.storeName, "readwrite");
        transaction
          .objectStore(this.storeName)
          .put(envelope, this.recordKey);
      } catch (error) {
        reject(error);
        return;
      }

      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(
          transaction.error ?? new Error("IndexedDB write transaction failed"),
        );
      };
      transaction.onabort = () => {
        reject(
          transaction.error ?? new Error("IndexedDB write transaction aborted"),
        );
      };
    });
  }

  async clear(): Promise<void> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readwrite");
      transaction.objectStore(this.storeName).delete(this.recordKey);

      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(
          transaction.error ?? new Error("IndexedDB clear transaction failed"),
        );
      };
      transaction.onabort = () => {
        reject(
          transaction.error ?? new Error("IndexedDB clear transaction aborted"),
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
