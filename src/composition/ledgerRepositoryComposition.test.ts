import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "../state/initialLedgerData";
import { sampleTrades } from "../test/fixtures";
import {
  createApplicationLedgerRepository,
  getDefaultLedgerRepository,
} from "./ledgerRepositoryComposition";

describe("ledger repository composition", () => {
  it("round-trips through the assembled Noop + IndexedDB + repository chain", async () => {
    const repository = createApplicationLedgerRepository({
      databaseName: "composition-integration-test",
      indexedDBFactory: new IDBFactory(),
    });
    const ledgerData = {
      ...createInitialLedgerData(),
      trades: structuredClone(sampleTrades),
    };

    await repository.save(ledgerData);
    await expect(repository.load()).resolves.toEqual(ledgerData);
    await repository.clear();
    await expect(repository.load()).resolves.toBeNull();
  });

  it("returns one shared default repository for application consumers", () => {
    expect(getDefaultLedgerRepository()).toBe(getDefaultLedgerRepository());
  });
});
