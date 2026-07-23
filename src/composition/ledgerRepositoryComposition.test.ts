import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "../state/initialLedgerData";
import { sampleTrades } from "../test/fixtures";
import {
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
} from "../backup/backupEnvelope";
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

  it("restores a parsed complete backup after clear and survives repository remount", async () => {
    const indexedDBFactory = new IDBFactory();
    const databaseName = "backup-roundtrip-composition-test";
    const repository = createApplicationLedgerRepository({
      databaseName,
      indexedDBFactory,
    });
    const ledgerData = {
      ...createInitialLedgerData(),
      trades: structuredClone(sampleTrades),
    };
    const envelope = createBackupEnvelope(ledgerData, {
      appVersion: "0.1.0",
      exportedAt: "2026-07-23T12:34:56Z",
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;

    const parsed = parseBackupJson(serializeBackupEnvelope(envelope.value));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    await repository.save(ledgerData);
    await repository.clear();
    await expect(repository.load()).resolves.toBeNull();
    await repository.save(parsed.value.ledgerData);

    const remountedRepository = createApplicationLedgerRepository({
      databaseName,
      indexedDBFactory,
    });
    await expect(remountedRepository.load()).resolves.toEqual(ledgerData);
  });

  it("returns one shared default repository for application consumers", () => {
    expect(getDefaultLedgerRepository()).toBe(getDefaultLedgerRepository());
  });
});
