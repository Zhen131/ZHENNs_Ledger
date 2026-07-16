import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import type { StoredLedgerEnvelope } from "./storageAdapter";
import { IndexedDbStorageAdapter } from "./indexedDbStorageAdapter";

const adapters: IndexedDbStorageAdapter[] = [];

afterEach(async () => {
  await Promise.all(adapters.map((adapter) => adapter.close()));
  adapters.length = 0;
});

function createAdapter(
  factory = new IDBFactory(),
  options: {
    databaseName?: string;
    databaseVersion?: number;
    storeName?: string;
  } = {},
) {
  const adapter = new IndexedDbStorageAdapter({
    indexedDBFactory: factory,
    databaseName: options.databaseName ?? "ledger-test",
    databaseVersion: options.databaseVersion,
    storeName: options.storeName,
  });
  adapters.push(adapter);
  return adapter;
}

describe("IndexedDbStorageAdapter", () => {
  it("returns null for an empty database", async () => {
    await expect(createAdapter().read()).resolves.toBeNull();
  });

  it("round-trips and atomically replaces the whole envelope", async () => {
    const adapter = createAdapter();
    const first: StoredLedgerEnvelope = {
      formatVersion: 1,
      encryptedPayload: "first",
    };
    const second: StoredLedgerEnvelope = {
      formatVersion: 1,
      encryptedPayload: "second",
    };

    await adapter.write(first);
    await expect(adapter.read()).resolves.toEqual(first);
    await adapter.write(second);
    await expect(adapter.read()).resolves.toEqual(second);
  });

  it("clears only the current ledger record", async () => {
    const adapter = createAdapter();
    await adapter.write({
      formatVersion: 1,
      encryptedPayload: "saved",
    });

    await adapter.clear();

    await expect(adapter.read()).resolves.toBeNull();
  });

  it("creates the ledger store during a database version upgrade", async () => {
    const factory = new IDBFactory();
    const databaseName = "ledger-upgrade-test";
    const legacyDatabase = await openDatabase(
      factory,
      databaseName,
      1,
      "legacy",
    );
    legacyDatabase.close();

    const adapter = createAdapter(factory, {
      databaseName,
      databaseVersion: 2,
      storeName: "ledger",
    });

    await expect(adapter.read()).resolves.toBeNull();
    await adapter.close();

    const upgradedDatabase = await openDatabase(factory, databaseName, 2);
    expect(Array.from(upgradedDatabase.objectStoreNames)).toEqual([
      "ledger",
      "legacy",
    ]);
    upgradedDatabase.close();
  });

  it("keeps the previous record when a replacement cannot be cloned", async () => {
    const adapter = createAdapter();
    const previous: StoredLedgerEnvelope = {
      formatVersion: 1,
      encryptedPayload: "safe-old-record",
    };
    await adapter.write(previous);

    const invalidEnvelope = {
      formatVersion: 1,
      encryptedPayload: () => "not cloneable",
    } as unknown as StoredLedgerEnvelope;

    await expect(adapter.write(invalidEnvelope)).rejects.toBeDefined();
    await expect(adapter.read()).resolves.toEqual(previous);
  });
});

function openDatabase(
  factory: IDBFactory,
  databaseName: string,
  version: number,
  storeName?: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, version);

    request.onupgradeneeded = () => {
      if (
        storeName &&
        !request.result.objectStoreNames.contains(storeName)
      ) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
