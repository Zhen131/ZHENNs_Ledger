import {
  type StoredLedgerEnvelopeV2,
  validateStoredLedgerEnvelopeV2,
} from "./cryptoEnvelope";
import type {
  LegacyLedgerConditionalDeleteResult,
  LegacyLedgerExitStorageAdapter,
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
 * Retired native IndexedDB whole-blob implementation.
 *
 * The V2 production composition calls only `read()` and reduces the result to
 * legacy presence. Historical write, clear, and conditional-delete methods
 * remain available to explicit negative tests, not to the V2 UI controller.
 */
export class IndexedDbStorageAdapter
  implements LegacyLedgerExitStorageAdapter
{
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

  async write(envelope: StoredLedgerEnvelopeV2): Promise<void> {
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

  async deleteIfUnchanged(
    expectedEnvelope: StoredLedgerEnvelopeV2,
  ): Promise<LegacyLedgerConditionalDeleteResult> {
    const expectedValidation =
      validateStoredLedgerEnvelopeV2(expectedEnvelope);
    if (!expectedValidation.ok) {
      throw new Error(
        "Legacy ledger conditional delete requires a valid V2 envelope",
      );
    }
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      let result: LegacyLedgerConditionalDeleteResult = "changed";
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(
          this.storeName,
          "readwrite",
        );
        const store = transaction.objectStore(this.storeName);
        const readRequest = store.get(this.recordKey);
        readRequest.onsuccess = () => {
          if (readRequest.result === undefined) {
            result = "missing";
            return;
          }
          const currentValidation =
            validateStoredLedgerEnvelopeV2(readRequest.result);
          if (
            !currentValidation.ok ||
            !sameStoredLedgerEnvelope(
              currentValidation.value,
              expectedValidation.value,
            )
          ) {
            result = "changed";
            return;
          }
          result = "deleted";
          store.delete(this.recordKey);
        };
        readRequest.onerror = () => {
          transaction.abort();
        };
      } catch (error) {
        reject(error);
        return;
      }

      transaction.oncomplete = () => {
        resolve(result);
      };
      transaction.onerror = () => {
        reject(
          transaction.error ??
            new Error(
              "IndexedDB conditional delete transaction failed",
            ),
        );
      };
      transaction.onabort = () => {
        reject(
          transaction.error ??
            new Error(
              "IndexedDB conditional delete transaction aborted",
            ),
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

function sameStoredLedgerEnvelope(
  left: StoredLedgerEnvelopeV2,
  right: StoredLedgerEnvelopeV2,
): boolean {
  return (
    left.formatVersion === right.formatVersion &&
    left.cryptoVersion === right.cryptoVersion &&
    left.ledgerSchemaVersion === right.ledgerSchemaVersion &&
    left.kdf.name === right.kdf.name &&
    left.kdf.hash === right.kdf.hash &&
    left.kdf.iterations === right.kdf.iterations &&
    left.kdf.saltBase64Url === right.kdf.saltBase64Url &&
    left.cipher.name === right.cipher.name &&
    left.cipher.keyLength === right.cipher.keyLength &&
    left.cipher.ivBase64Url === right.cipher.ivBase64Url &&
    left.cipher.tagLength === right.cipher.tagLength &&
    left.ciphertextBase64Url === right.ciphertextBase64Url
  );
}
