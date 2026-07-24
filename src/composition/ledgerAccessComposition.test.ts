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
  createApplicationLedgerAccessController,
  getDefaultLedgerAccessController,
} from "./ledgerAccessComposition";

const TEST_PASSPHRASE = "correct horse battery staple";

describe("ledger access composition", () => {
  it("sets up and unlocks through the encrypted IndexedDB chain", async () => {
    const indexedDBFactory = new IDBFactory();
    const options = {
      databaseName: "composition-integration-test",
      indexedDBFactory,
    };
    const controller = createApplicationLedgerAccessController(options);
    const ledgerData = {
      ...createInitialLedgerData(),
      trades: structuredClone(sampleTrades),
    };

    await expect(controller.inspect()).resolves.toEqual({
      status: "setup-required",
    });
    const setup = await controller.setup(TEST_PASSPHRASE);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;

    const repository = setup.repository;
    await repository.save(ledgerData);
    await expect(repository.load()).resolves.toEqual(ledgerData);

    const remountedController =
      createApplicationLedgerAccessController(options);
    await expect(remountedController.inspect()).resolves.toEqual({
      status: "unlock-required",
    });
    const unlock = await remountedController.unlock(TEST_PASSPHRASE);
    expect(unlock.ok).toBe(true);
    if (!unlock.ok) return;
    await expect(unlock.repository.load()).resolves.toEqual(ledgerData);
  });

  it("restores a parsed complete backup after clear and a fresh setup", async () => {
    const indexedDBFactory = new IDBFactory();
    const databaseName = "backup-roundtrip-composition-test";
    const options = {
      databaseName,
      indexedDBFactory,
    };
    const controller = createApplicationLedgerAccessController(options);
    const setup = await controller.setup(TEST_PASSPHRASE);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    const repository = setup.repository;
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

    const freshSetup = await createApplicationLedgerAccessController(
      options,
    ).setup(TEST_PASSPHRASE);
    expect(freshSetup.ok).toBe(true);
    if (!freshSetup.ok) return;
    await freshSetup.repository.save(parsed.value.ledgerData);

    const remounted = createApplicationLedgerAccessController(options);
    const unlock = await remounted.unlock(TEST_PASSPHRASE);
    expect(unlock.ok).toBe(true);
    if (!unlock.ok) return;
    await expect(unlock.repository.load()).resolves.toEqual(ledgerData);
  });

  it("returns one shared default access controller for application consumers", () => {
    expect(getDefaultLedgerAccessController()).toBe(
      getDefaultLedgerAccessController(),
    );
  });
});
