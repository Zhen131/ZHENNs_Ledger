import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "../adapters/ledgerFileHandleAdapter";
import { IndexedDbStorageAdapter } from "../adapters/indexedDbStorageAdapter";
import { IndexedDbLedgerFileConnectionAdapter } from "../adapters/ledgerFileConnectionAdapter";
import { createNoopStoredLedgerEnvelope } from "../encryption/noopEncryptionService";
import type {
  LedgerFileSessionCoordinator,
  LedgerFileSessionLease,
} from "../coordination/ledgerFileSessionCoordinator";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { sampleUsdtTrades } from "../test/fixtures";
import {
  DefaultLedgerAccessController,
  LEDGER_ACCESS_ERROR_CODES,
} from "./ledgerAccessController";
import {
  DefaultLedgerFileAccessController,
  LEDGER_FILE_ACCESS_ERROR_CODES,
} from "./ledgerFileAccessController";
import {
  createApplicationLedgerAccessController,
  createApplicationLedgerFileAccessController,
  getDefaultLedgerAccessController,
  getDefaultLedgerFileAccessController,
} from "./ledgerAccessComposition";

const TEST_PASSPHRASE = "correct horse battery staple";
const TARGET_PASSPHRASE = "new ledger file password";

class MigrationFileHandle implements LedgerFileHandle {
  private bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();

  readonly name = "migrated-ledger.lftl";

  async getFile() {
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => new Uint8Array(snapshot).buffer,
    };
  }

  async createWritable(): Promise<LedgerFileWritable> {
    let pending: Uint8Array | null = null;
    return {
      write: async (serialized) => {
        pending = new TextEncoder().encode(serialized);
      },
      close: async () => {
        if (pending) {
          this.bytes = pending;
        }
      },
      abort: async () => {
        pending = null;
      },
    };
  }

  async isSameEntry(
    other: LedgerFileHandle,
  ): Promise<boolean> {
    return other === this;
  }

  async queryPermission() {
    return "granted" as const;
  }

  async requestPermission() {
    return "granted" as const;
  }
}

describe("ledger access composition", () => {
  it("exposes IndexedDB only as a read-only legacy presence detector", async () => {
    const indexedDBFactory = new IDBFactory();
    const options = {
      databaseName: "composition-integration-test",
      indexedDBFactory,
    };
    const controller = createApplicationLedgerAccessController(options);

    await expect(controller.inspect()).resolves.toEqual({
      status: "setup-required",
    });
    expect("setup" in controller).toBe(false);
    expect("unlock" in controller).toBe(false);
    expect("resetEncryptedLedger" in controller).toBe(false);
    expect("unlockLegacyForMigration" in controller).toBe(false);
    expect("authorizeLegacyMigrationDeletion" in controller).toBe(false);
    expect("deleteLegacyAfterMigration" in controller).toBe(false);
  });

  it("detects a legacy record without assembling its autosave path", async () => {
    const indexedDBFactory = new IDBFactory();
    const databaseName = "composition-legacy-detection-test";
    const options = {
      databaseName,
      indexedDBFactory,
    };
    const storage = new IndexedDbStorageAdapter(options);
    await storage.write(createNoopStoredLedgerEnvelope("{}"));
    await storage.close();

    const controller = createApplicationLedgerAccessController(options);
    await expect(controller.inspect()).resolves.toEqual({
      status: "unlock-required",
    });
    expect("setup" in controller).toBe(false);
    expect("unlock" in controller).toBe(false);
    expect("unlockLegacyForMigration" in controller).toBe(false);
    expect("authorizeLegacyMigrationDeletion" in controller).toBe(false);
    expect("deleteLegacyAfterMigration" in controller).toBe(false);
  });

  it("migrates a verified legacy ledger into a new C before conditionally deleting only the unchanged legacy record", async () => {
    const indexedDBFactory = new IDBFactory();
    const legacyStorage = new IndexedDbStorageAdapter({
      databaseName: "composition-real-legacy-migration",
      indexedDBFactory,
    });
    const legacyController = new DefaultLedgerAccessController(
      legacyStorage,
    );
    const setup = await legacyController.setup(TEST_PASSPHRASE);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    const legacyLedger = {
      ...createInitialLedgerData(),
      trades: structuredClone(sampleUsdtTrades),
    };
    await setup.repository.save(legacyLedger);
    const sourceBeforeMigration = await legacyStorage.read();
    const unlocked =
      await legacyController.unlockLegacyForMigration(
        TEST_PASSPHRASE,
      );
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) return;

    const handle = new MigrationFileHandle();
    const pickerProvider = {
      showSaveFilePicker: vi.fn(async () => handle),
      showOpenFilePicker: vi.fn(async () => [handle]),
    };
    const lease: LedgerFileSessionLease = {
      sessionId: "composition-migration-lease",
      runExclusiveWrite: (operation) => operation(),
      release: vi.fn(async () => undefined),
    };
    const coordinator: LedgerFileSessionCoordinator = {
      acquire: vi.fn(async () => ({
        status: "acquired" as const,
        lease,
      })),
    };
    const connectionAdapter =
      new IndexedDbLedgerFileConnectionAdapter({
        databaseName:
          "composition-real-migration-connections",
        indexedDBFactory,
      });
    const ids = [
      "migration-file",
      "migration-revision",
      "migration-save-revision",
      "migration-clear-revision",
    ];
    const fileController =
      new DefaultLedgerFileAccessController(
        new LedgerFileHandleAdapter(pickerProvider),
        {
          generateId: () => ids.shift()!,
          now: () =>
            new Date("2026-07-30T10:00:00.000Z"),
        },
        coordinator,
        undefined,
        connectionAdapter,
      );
    const created = await fileController.createFromLegacy(
      TARGET_PASSPHRASE,
      unlocked.candidate.readLedgerData(),
    );
    expect(created.status).toBe("unlocked");
    if (created.status !== "unlocked") return;
    await expect(created.session.repository.load()).resolves.toEqual(
      legacyLedger,
    );
    const receipt = await fileController.verifyMigrationTarget(
      created.session,
      legacyLedger,
    );
    expect(receipt).not.toBeNull();
    if (!receipt) return;
    const rememberedBeforeDelete = await connectionAdapter.read();
    expect(rememberedBeforeDelete).toMatchObject({
      connectionFormatVersion: 1,
      expectedFileId: "migration-file",
    });
    expect(await legacyStorage.read()).toEqual(
      sourceBeforeMigration,
    );
    await expect(
      legacyController.authorizeLegacyMigrationDeletion(
        unlocked.candidate,
        receipt,
        "任意非空文本",
      ),
    ).resolves.toBeNull();
    await expect(legacyStorage.read()).resolves.toEqual(
      sourceBeforeMigration,
    );

    const authorization =
      await legacyController.authorizeLegacyMigrationDeletion(
        unlocked.candidate,
        receipt,
        "删除旧浏览器账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization) return;
    const conditionalDelete = vi.spyOn(
      legacyStorage,
      "deleteIfUnchanged",
    );
    conditionalDelete.mockRejectedValueOnce(
      new Error("transient conditional delete failure"),
    );
    await expect(
      legacyController.deleteLegacyAfterMigration(authorization),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_DELETE_FAILED,
    });
    await expect(legacyStorage.read()).resolves.toEqual(
      sourceBeforeMigration,
    );
    await expect(
      legacyController.deleteLegacyAfterMigration(authorization),
    ).resolves.toEqual({ ok: true });

    await expect(legacyStorage.read()).resolves.toBeNull();
    await expect(connectionAdapter.read()).resolves.toEqual(
      rememberedBeforeDelete,
    );
    await expect(created.session.repository.load()).resolves.toEqual(
      legacyLedger,
    );
    const savedOnlyToC = {
      ...legacyLedger,
      trades: legacyLedger.trades.slice(0, 1),
    };
    await created.session.repository.save(savedOnlyToC);
    await expect(connectionAdapter.read()).resolves.toEqual(
      rememberedBeforeDelete,
    );
    const clearAuthorization =
      created.session.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(clearAuthorization).not.toBeNull();
    if (!clearAuthorization || !created.session.readyClearPort) {
      return;
    }
    await created.session.readyClearPort.clearReadyLedger(
      clearAuthorization,
    );
    await expect(created.session.repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
    await expect(connectionAdapter.read()).resolves.toEqual(
      rememberedBeforeDelete,
    );
    await expect(legacyStorage.read()).resolves.toBeNull();
    await expect(
      legacyController.deleteLegacyAfterMigration(authorization),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_TARGET_INVALID,
    });
    await fileController.releaseUnpublishedMigrationSession(
      created.session,
    );
    await legacyStorage.close();
  }, 20_000);

  it("keeps a changed legacy record even after the target C was fully verified", async () => {
    const indexedDBFactory = new IDBFactory();
    const legacyStorage = new IndexedDbStorageAdapter({
      databaseName: "composition-changed-legacy-migration",
      indexedDBFactory,
    });
    const legacyController = new DefaultLedgerAccessController(
      legacyStorage,
    );
    const setup = await legacyController.setup(TEST_PASSPHRASE);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    const sourceLedger = {
      ...createInitialLedgerData(),
      trades: structuredClone(sampleUsdtTrades),
    };
    await setup.repository.save(sourceLedger);
    const unlocked =
      await legacyController.unlockLegacyForMigration(
        TEST_PASSPHRASE,
      );
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) return;

    const handle = new MigrationFileHandle();
    const lease: LedgerFileSessionLease = {
      sessionId: "changed-source-lease",
      runExclusiveWrite: (operation) => operation(),
      release: vi.fn(async () => undefined),
    };
    const fileController =
      new DefaultLedgerFileAccessController(
        new LedgerFileHandleAdapter({
          showSaveFilePicker: async () => handle,
          showOpenFilePicker: async () => [handle],
        }),
        {
          generateId: (() => {
            const ids = [
              "changed-source-file",
              "changed-source-revision",
            ];
            return () => ids.shift()!;
          })(),
          now: () =>
            new Date("2026-07-30T10:00:00.000Z"),
        },
        {
          acquire: async () => ({
            status: "acquired",
            lease,
          }),
        },
      );
    const created = await fileController.createFromLegacy(
      TARGET_PASSPHRASE,
      sourceLedger,
    );
    expect(created.status).toBe("unlocked");
    if (created.status !== "unlocked") return;
    const receipt = await fileController.verifyMigrationTarget(
      created.session,
      sourceLedger,
    );
    expect(receipt).not.toBeNull();
    if (!receipt) return;
    const authorization =
      await legacyController.authorizeLegacyMigrationDeletion(
        unlocked.candidate,
        receipt,
        "删除旧浏览器账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization) return;
    const changedEnvelope =
      createNoopStoredLedgerEnvelope("changed-after-verify");
    await legacyStorage.write(changedEnvelope);

    await expect(
      legacyController.deleteLegacyAfterMigration(authorization),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_SOURCE_CHANGED,
    });
    await expect(legacyStorage.read()).resolves.toEqual(
      changedEnvelope,
    );
    await fileController.releaseUnpublishedMigrationSession(
      created.session,
    );
    await legacyStorage.close();
  }, 20_000);

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

  it("wires a dedicated connection database without deleting or reusing the legacy whole-ledger record", async () => {
    const indexedDBFactory = new IDBFactory();
    const legacyOptions = {
      databaseName: "composition-legacy-ledger",
      indexedDBFactory,
    };
    const legacyStorage = new IndexedDbStorageAdapter(legacyOptions);
    await legacyStorage.write(createNoopStoredLedgerEnvelope("{}"));
    await legacyStorage.close();

    const fileController =
      createApplicationLedgerFileAccessController({
        databaseName: "composition-file-connections",
        indexedDBFactory,
      });
    await expect(
      fileController.inspectRememberedConnection(),
    ).resolves.toEqual({ status: "none", ok: true });
    await expect(
      createApplicationLedgerAccessController({
        databaseName: "composition-legacy-ledger",
        indexedDBFactory,
      }).inspect(),
    ).resolves.toEqual({ status: "unlock-required" });
  });

  it("wires the default file coordinator and fails closed before writing when browser coordination is unavailable", async () => {
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
      const controller =
        createApplicationLedgerFileAccessController();

      await expect(
        controller.create(TEST_PASSPHRASE),
      ).resolves.toEqual({
        status: "error",
        ok: false,
        code:
          LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED,
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
