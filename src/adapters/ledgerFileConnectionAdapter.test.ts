import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import type { LedgerFileHandle } from "./ledgerFileHandleAdapter";
import {
  IndexedDbLedgerFileConnectionAdapter,
  LEDGER_FILE_CONNECTION_DEFAULTS,
  LedgerFileConnectionRecordError,
  validateLedgerFileConnectionRecord,
} from "./ledgerFileConnectionAdapter";

function createCloneableHandle(name = "ledger.lftl"): LedgerFileHandle {
  return { name } as LedgerFileHandle;
}

function createAdapter(
  factory = new IDBFactory(),
): IndexedDbLedgerFileConnectionAdapter {
  return new IndexedDbLedgerFileConnectionAdapter({
    indexedDBFactory: factory,
  });
}

describe("IndexedDbLedgerFileConnectionAdapter", () => {
  it("round-trips only version, handle and expectedFileId", async () => {
    const factory = new IDBFactory();
    const adapter = createAdapter(factory);
    const handle = createCloneableHandle();

    await adapter.write({
      connectionFormatVersion: 1,
      handle,
      expectedFileId: "file-123",
    });

    await expect(adapter.read()).resolves.toEqual({
      connectionFormatVersion: 1,
      handle: { name: "ledger.lftl" },
      expectedFileId: "file-123",
    });
    const raw = await readRawRecord(factory);
    expect(Object.keys(raw as object).sort()).toEqual([
      "connectionFormatVersion",
      "expectedFileId",
      "handle",
    ]);
    expect(JSON.stringify(raw)).not.toContain("ledgerData");
    expect(JSON.stringify(raw)).not.toContain("passphrase");
    expect(JSON.stringify(raw)).not.toContain("CryptoKey");
    expect(JSON.stringify(raw)).not.toContain("session");
    expect(JSON.stringify(raw)).not.toContain("lease");
  });

  it("returns null when no remembered connection exists and clear is idempotent", async () => {
    const adapter = createAdapter();

    await expect(adapter.read()).resolves.toBeNull();
    await expect(adapter.clear()).resolves.toBeUndefined();
    await expect(adapter.clear()).resolves.toBeUndefined();
  });

  it("clears only the fixed connection record", async () => {
    const factory = new IDBFactory();
    const adapter = createAdapter(factory);
    await adapter.write({
      connectionFormatVersion: 1,
      handle: createCloneableHandle(),
      expectedFileId: "file-123",
    });

    await adapter.clear();

    await expect(adapter.read()).resolves.toBeNull();
  });

  it.each([
    null,
    [],
    {},
    {
      connectionFormatVersion: 2,
      handle: createCloneableHandle(),
      expectedFileId: "file-123",
    },
    {
      connectionFormatVersion: 1,
      handle: null,
      expectedFileId: "file-123",
    },
    {
      connectionFormatVersion: 1,
      handle: createCloneableHandle(),
      expectedFileId: "",
    },
    {
      connectionFormatVersion: 1,
      handle: createCloneableHandle(),
      expectedFileId: "   ",
    },
    {
      connectionFormatVersion: 1,
      handle: createCloneableHandle(),
      expectedFileId: "x".repeat(257),
    },
    {
      connectionFormatVersion: 1,
      handle: createCloneableHandle(),
      expectedFileId: "file-123",
      passphrase: "must-not-be-stored",
    },
  ])("rejects an invalid or expanded connection record %#", (value) => {
    expect(() => validateLedgerFileConnectionRecord(value)).toThrow(
      LedgerFileConnectionRecordError,
    );
  });

  it("fails closed when raw IndexedDB contains a corrupt record", async () => {
    const factory = new IDBFactory();
    const adapter = createAdapter(factory);
    await writeRawRecord(factory, {
      connectionFormatVersion: 1,
      expectedFileId: "file-123",
    });

    await expect(adapter.read()).rejects.toBeInstanceOf(
      LedgerFileConnectionRecordError,
    );
  });

  it("keeps the previous valid record when structured clone rejects a write", async () => {
    const factory = new IDBFactory();
    const adapter = createAdapter(factory);
    await adapter.write({
      connectionFormatVersion: 1,
      handle: createCloneableHandle("first.lftl"),
      expectedFileId: "first",
    });

    await expect(
      adapter.write({
        connectionFormatVersion: 1,
        handle: {
          name: "uncloneable.lftl",
          getFile: async () => {
            throw new Error("not called");
          },
        } as unknown as LedgerFileHandle,
        expectedFileId: "second",
      }),
    ).rejects.toBeInstanceOf(LedgerFileConnectionRecordError);

    await expect(adapter.read()).resolves.toMatchObject({
      expectedFileId: "first",
      handle: { name: "first.lftl" },
    });
  });

  it("does not start a stale write after its operation signal is cancelled", async () => {
    const factory = new IDBFactory();
    const adapter = createAdapter(factory);
    await adapter.write({
      connectionFormatVersion: 1,
      handle: createCloneableHandle("first.lftl"),
      expectedFileId: "first",
    });
    const cancelled = new AbortController();
    cancelled.abort();

    await expect(
      adapter.write(
        {
          connectionFormatVersion: 1,
          handle: createCloneableHandle("stale.lftl"),
          expectedFileId: "stale",
        },
        cancelled.signal,
      ),
    ).rejects.toBeInstanceOf(LedgerFileConnectionRecordError);
    await expect(adapter.read()).resolves.toMatchObject({
      expectedFileId: "first",
      handle: { name: "first.lftl" },
    });
  });

  it("aborts and rolls back a connection-record transaction cancelled after it starts", async () => {
    const factory = new IDBFactory();
    const adapter = createAdapter(factory);
    await adapter.write({
      connectionFormatVersion: 1,
      handle: createCloneableHandle("first.lftl"),
      expectedFileId: "first",
    });
    const database = await openConnectionDatabase(factory);
    const databasePrototype = Object.getPrototypeOf(
      database,
    ) as IDBDatabase;
    const originalTransaction = databasePrototype.transaction;
    const cancelled = new AbortController();
    const transaction = vi
      .spyOn(databasePrototype, "transaction")
      .mockImplementation(function (
        this: IDBDatabase,
        ...args: Parameters<IDBDatabase["transaction"]>
      ) {
        const started = originalTransaction.apply(this, args);
        if (args[1] === "readwrite") {
          queueMicrotask(() => cancelled.abort());
        }
        return started;
      });

    try {
      await expect(
        adapter.write(
          {
            connectionFormatVersion: 1,
            handle: createCloneableHandle("stale.lftl"),
            expectedFileId: "stale",
          },
          cancelled.signal,
        ),
      ).rejects.toBeInstanceOf(LedgerFileConnectionRecordError);
    } finally {
      transaction.mockRestore();
      database.close();
    }

    await expect(adapter.read()).resolves.toMatchObject({
      expectedFileId: "first",
      handle: { name: "first.lftl" },
    });
  });

  it("uses a database separate from the legacy whole-ledger store", () => {
    expect(LEDGER_FILE_CONNECTION_DEFAULTS.databaseName).toBe(
      "local-first-trading-ledger-file-connections",
    );
    expect(LEDGER_FILE_CONNECTION_DEFAULTS.storeName).toBe("connections");
    expect(LEDGER_FILE_CONNECTION_DEFAULTS.recordKey).toBe("current:v1");
  });
});

async function openConnectionDatabase(
  factory: IDBFactory,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(
      LEDGER_FILE_CONNECTION_DEFAULTS.databaseName,
      LEDGER_FILE_CONNECTION_DEFAULTS.databaseVersion,
    );
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRawRecord(factory: IDBFactory): Promise<unknown> {
  const database = await openConnectionDatabase(factory);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      LEDGER_FILE_CONNECTION_DEFAULTS.storeName,
      "readonly",
    );
    const request = transaction
      .objectStore(LEDGER_FILE_CONNECTION_DEFAULTS.storeName)
      .get(LEDGER_FILE_CONNECTION_DEFAULTS.recordKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeRawRecord(
  factory: IDBFactory,
  value: unknown,
): Promise<void> {
  const adapter = createAdapter(factory);
  await adapter.read();
  const database = await openConnectionDatabase(factory);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      LEDGER_FILE_CONNECTION_DEFAULTS.storeName,
      "readwrite",
    );
    transaction
      .objectStore(LEDGER_FILE_CONNECTION_DEFAULTS.storeName)
      .put(value, LEDGER_FILE_CONNECTION_DEFAULTS.recordKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
