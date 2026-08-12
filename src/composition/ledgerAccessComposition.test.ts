import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import type { LedgerFileHandle } from "../adapters/ledgerFileHandleAdapter";
import { IndexedDbStorageAdapter } from "../adapters/indexedDbStorageAdapter";
import { createNoopStoredLedgerEnvelope } from "@/test-support";
import { LEDGER_FILE_ACCESS_ERROR_CODES } from "./ledgerFileAccessController";
import {
  createApplicationLedgerAccessController,
  createApplicationLedgerFileAccessController,
  getDefaultLedgerAccessController,
  getDefaultLedgerFileAccessController,
} from "./ledgerAccessComposition";

const TEST_PASSPHRASE = "correct horse battery staple";

describe("ledger access composition", () => {
  it("exposes IndexedDB only as a read-only legacy presence detector", async () => {
    const indexedDBFactory = new IDBFactory();
    const controller = createApplicationLedgerAccessController({
      databaseName: "composition-integration-test",
      indexedDBFactory,
    });

    await expect(controller.inspect()).resolves.toEqual({
      status: "setup-required",
    });
    expect(Object.keys(controller)).toEqual(["inspect"]);
  });

  it("detects a legacy record without assembling its autosave path", async () => {
    const indexedDBFactory = new IDBFactory();
    const databaseName = "composition-legacy-detection-test";
    const options = { databaseName, indexedDBFactory };
    const storage = new IndexedDbStorageAdapter(options);
    await storage.write(createNoopStoredLedgerEnvelope("{}"));
    await storage.close();

    const controller = createApplicationLedgerAccessController(options);
    await expect(controller.inspect()).resolves.toEqual({
      status: "unlock-required",
    });
    expect(Object.keys(controller)).toEqual(["inspect"]);
  });

  it("returns one shared default access controller for application consumers", () => {
    expect(getDefaultLedgerAccessController()).toBe(
      getDefaultLedgerAccessController(),
    );
  });

  it("returns one shared default ledger-file controller for application consumers", () => {
    expect(getDefaultLedgerFileAccessController()).toBe(
      getDefaultLedgerFileAccessController(),
    );
  });

  it("keeps the legacy record separate from the file-connection database", async () => {
    const indexedDBFactory = new IDBFactory();
    const legacyOptions = {
      databaseName: "composition-legacy-ledger",
      indexedDBFactory,
    };
    const legacyStorage = new IndexedDbStorageAdapter(legacyOptions);
    await legacyStorage.write(createNoopStoredLedgerEnvelope("{}"));
    await legacyStorage.close();

    const fileController = createApplicationLedgerFileAccessController({
      databaseName: "composition-file-connections",
      indexedDBFactory,
    });
    await expect(
      fileController.inspectRememberedConnection(),
    ).resolves.toEqual({ status: "none", ok: true });
    await expect(
      createApplicationLedgerAccessController(legacyOptions).inspect(),
    ).resolves.toEqual({ status: "unlock-required" });
  });

  it("fails closed before writing when browser coordination is unavailable", async () => {
    const getFile = vi.fn(async () => ({
      size: 0,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    const createWritable = vi.fn(async () => ({
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    }));
    const isSameEntry = vi.fn(async () => true);
    const handle: LedgerFileHandle = {
      name: "composition-ledger.lftl",
      getFile,
      createWritable,
      isSameEntry,
    };
    const showSaveFilePicker = vi.fn(async () => handle);
    const showOpenFilePicker = vi.fn(async () => [handle]);

    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("showSaveFilePicker", showSaveFilePicker);
    vi.stubGlobal("showOpenFilePicker", showOpenFilePicker);
    try {
      const controller = createApplicationLedgerFileAccessController();

      await expect(controller.create(TEST_PASSPHRASE)).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED,
      });
      expect(showSaveFilePicker).toHaveBeenCalledOnce();
      expect(getFile).not.toHaveBeenCalled();
      expect(createWritable).not.toHaveBeenCalled();
      expect(isSameEntry).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
