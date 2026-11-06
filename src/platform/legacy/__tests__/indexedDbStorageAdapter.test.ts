import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { seedRetiredBrowserLedgerRecord } from "@/test-support";
import { IndexedDbStorageAdapter } from "../indexedDbStorageAdapter";

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
    recordKey?: IDBValidKey;
  } = {},
) {
  const adapter = new IndexedDbStorageAdapter({
    indexedDBFactory: factory,
    databaseName: options.databaseName ?? "ledger-test",
    databaseVersion: options.databaseVersion,
    storeName: options.storeName,
    recordKey: options.recordKey,
  });
  adapters.push(adapter);
  return adapter;
}

describe("IndexedDbStorageAdapter", () => {
  it("returns null for an empty database", async () => {
    await expect(createAdapter().read()).resolves.toBeNull();
  });

  it("reads a record that is already in the store", async () => {
    const factory = new IDBFactory();
    const options = {
      indexedDBFactory: factory,
      databaseName: "ledger-read-seeded",
    };
    const record = { fictionalRetiredLedger: "seeded" };
    await seedRetiredBrowserLedgerRecord(options, record);

    await expect(createAdapter(factory, options).read()).resolves.toEqual(
      record,
    );
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
