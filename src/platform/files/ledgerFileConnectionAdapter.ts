import type { LedgerFileHandle } from "./ledgerFileHandleAdapter";
import { LEDGER_FILE_V2_CONSTANTS } from "@/platform/files";

export const LEDGER_FILE_CONNECTION_DEFAULTS = {
  databaseName: "local-first-trading-ledger-file-connections",
  databaseVersion: 1,
  storeName: "connections",
  recordKey: "current:v1",
} as const;

export type LedgerFileConnectionRecordV1 = {
  connectionFormatVersion: 1;
  handle: LedgerFileHandle;
  expectedFileId: string;
};

export interface LedgerFileConnectionAdapter {
  read(signal?: AbortSignal): Promise<LedgerFileConnectionRecordV1 | null>;
  write(
    record: LedgerFileConnectionRecordV1,
    signal?: AbortSignal,
  ): Promise<void>;
  clear(signal?: AbortSignal): Promise<void>;
}

export type IndexedDbLedgerFileConnectionAdapterOptions = {
  databaseName?: string;
  databaseVersion?: number;
  storeName?: string;
  recordKey?: IDBValidKey;
  indexedDBFactory?: IDBFactory;
};

export class LedgerFileConnectionRecordError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LedgerFileConnectionRecordError";
  }
}

/**
 * Stores only the browser file handle and the minimum identity needed to
 * reconnect it. The encrypted ledger and every runtime secret remain outside
 * this database.
 */
export class IndexedDbLedgerFileConnectionAdapter
  implements LedgerFileConnectionAdapter
{
  private readonly databaseName: string;
  private readonly databaseVersion: number;
  private readonly storeName: string;
  private readonly recordKey: IDBValidKey;
  private readonly indexedDBFactory: IDBFactory | undefined;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbLedgerFileConnectionAdapterOptions = {}) {
    this.databaseName =
      options.databaseName ?? LEDGER_FILE_CONNECTION_DEFAULTS.databaseName;
    this.databaseVersion =
      options.databaseVersion ??
      LEDGER_FILE_CONNECTION_DEFAULTS.databaseVersion;
    this.storeName =
      options.storeName ?? LEDGER_FILE_CONNECTION_DEFAULTS.storeName;
    this.recordKey =
      options.recordKey ?? LEDGER_FILE_CONNECTION_DEFAULTS.recordKey;
    this.indexedDBFactory =
      options.indexedDBFactory ?? globalThis.indexedDB;
  }

  async read(
    signal?: AbortSignal,
  ): Promise<LedgerFileConnectionRecordV1 | null> {
    const database = await this.openDatabase();
    const stored = await runRequest<unknown>(
      database,
      this.storeName,
      "readonly",
      (store) => store.get(this.recordKey),
      "read",
      signal,
    );
    if (stored === undefined) {
      return null;
    }
    return validateLedgerFileConnectionRecord(stored);
  }

  async write(
    record: LedgerFileConnectionRecordV1,
    signal?: AbortSignal,
  ): Promise<void> {
    const validated = validateLedgerFileConnectionRecord(record);
    const database = await this.openDatabase();
    await runRequest(
      database,
      this.storeName,
      "readwrite",
      (store) => store.put(validated, this.recordKey),
      "write",
      signal,
    );
  }

  async clear(signal?: AbortSignal): Promise<void> {
    const database = await this.openDatabase();
    await runRequest(
      database,
      this.storeName,
      "readwrite",
      (store) => store.delete(this.recordKey),
      "clear",
      signal,
    );
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) {
      return this.databasePromise;
    }
    if (!this.indexedDBFactory) {
      return Promise.reject(
        new LedgerFileConnectionRecordError(
          "IndexedDB is unavailable for the ledger file connection",
        ),
      );
    }

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDBFactory!.open(
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
          if (this.databasePromise === opening) {
            this.databasePromise = undefined;
          }
        };
        resolve(database);
      };
      request.onerror = () => {
        reject(
          new LedgerFileConnectionRecordError(
            "Could not open the ledger file connection database",
            request.error,
          ),
        );
      };
      request.onblocked = () => {
        reject(
          new LedgerFileConnectionRecordError(
            "Ledger file connection database upgrade is blocked",
          ),
        );
      };
    }).catch((error: unknown) => {
      if (this.databasePromise === opening) {
        this.databasePromise = undefined;
      }
      throw error;
    });
    this.databasePromise = opening;
    return opening;
  }
}

export function validateLedgerFileConnectionRecord(
  value: unknown,
): LedgerFileConnectionRecordV1 {
  if (!isPlainRecord(value)) {
    throw new LedgerFileConnectionRecordError(
      "Ledger file connection record must be an object",
    );
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "connectionFormatVersion" ||
    keys[1] !== "expectedFileId" ||
    keys[2] !== "handle"
  ) {
    throw new LedgerFileConnectionRecordError(
      "Ledger file connection record contains unsupported fields",
    );
  }
  if (value.connectionFormatVersion !== 1) {
    throw new LedgerFileConnectionRecordError(
      "Ledger file connection record version is unsupported",
    );
  }
  if (
    typeof value.expectedFileId !== "string" ||
    value.expectedFileId.length === 0 ||
    value.expectedFileId.trim().length === 0 ||
    value.expectedFileId.length >
      LEDGER_FILE_V2_CONSTANTS.maximumTechnicalIdLength
  ) {
    throw new LedgerFileConnectionRecordError(
      "Ledger file connection expectedFileId is invalid",
    );
  }
  if (
    typeof value.handle !== "object" ||
    value.handle === null ||
    typeof (value.handle as { name?: unknown }).name !== "string"
  ) {
    throw new LedgerFileConnectionRecordError(
      "Ledger file connection handle is invalid",
    );
  }

  return {
    connectionFormatVersion: 1,
    handle: value.handle as LedgerFileHandle,
    expectedFileId: value.expectedFileId,
  };
}

function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function runRequest<T = undefined>(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
  operation: "read" | "write" | "clear",
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new LedgerFileConnectionRecordError(
          `Ledger file connection ${operation} was cancelled`,
        ),
      );
      return;
    }
    let transaction: IDBTransaction;
    let request: IDBRequest<T>;
    try {
      transaction = database.transaction(storeName, mode);
      request = createRequest(transaction.objectStore(storeName));
    } catch (error) {
      reject(
        new LedgerFileConnectionRecordError(
          `Could not start ledger file connection ${operation}`,
          error,
        ),
      );
      return;
    }

    let settled = false;
    let result: T;
    const finish = (
      outcome: { ok: true; value: T } | { ok: false; error: Error },
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", abortTransaction);
      if (outcome.ok) {
        resolve(outcome.value);
      } else {
        reject(outcome.error);
      }
    };
    const abortTransaction = () => {
      try {
        transaction.abort();
      } catch {
        finish({
          ok: false,
          error: new LedgerFileConnectionRecordError(
            `Ledger file connection ${operation} was cancelled`,
          ),
        });
      }
    };
    signal?.addEventListener("abort", abortTransaction, {
      once: true,
    });
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => {
      finish({
        ok: false,
        error: new LedgerFileConnectionRecordError(
          `Ledger file connection ${operation} request failed`,
          request.error,
        ),
      });
    };
    transaction.oncomplete = () => {
      finish({ ok: true, value: result });
    };
    transaction.onerror = () => {
      finish({
        ok: false,
        error: new LedgerFileConnectionRecordError(
          `Ledger file connection ${operation} transaction failed`,
          transaction.error,
        ),
      });
    };
    transaction.onabort = () => {
      finish({
        ok: false,
        error: new LedgerFileConnectionRecordError(
          `Ledger file connection ${operation} transaction aborted`,
          transaction.error,
        ),
      });
    };
  });
}
