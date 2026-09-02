// @vitest-environment jsdom

import {
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { StorageAdapter } from "@/platform/legacy";
import {
  createNoopStoredLedgerEnvelope,
  NoopEncryptionService,
} from "@/test-support";
import {
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
} from "@/features/backup";
import { createTestLedgerRepository } from "@/test-support";
import {
  DefaultLedgerRepository,
  LEDGER_REPOSITORY_ERROR_CODES,
  type LedgerRepository,
} from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import {
  addTrade,
  createCompleteBackupLedger,
  createCompleteLedger,
  createDeferred,
  createMemoryStorageAdapter,
  createRepository,
  usePersistentLedger,
} from "./usePersistentLedger.testHelpers";

describe("usePersistentLedger backup import", () => {
  it("validates a candidate before opening a repository write", async () => {
    const repository = createRepository();
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    await expect(result.current.replaceLedgerFromBackup({})).resolves.toEqual({
      ok: false,
      code: "LEDGER_IMPORT_INVALID_BACKUP",
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("writes once, replaces state only after success, and deduplicates concurrent import requests", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      save: vi.fn(() => saveDeferred.promise),
    });
    const candidate = createCompleteLedger();
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    let firstImport!: ReturnType<typeof result.current.replaceLedgerFromBackup>;
    let secondImport!: ReturnType<typeof result.current.replaceLedgerFromBackup>;
    act(() => {
      firstImport = result.current.replaceLedgerFromBackup(candidate);
      secondImport = result.current.replaceLedgerFromBackup(candidate);
    });

    expect(firstImport).toBe(secondImport);
    expect(result.current.persistenceOperation).toBe("importing");
    expect(result.current.ledgerData).toEqual(createInitialLedgerData());
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
    });

    await act(async () => {
      saveDeferred.resolve();
      await expect(firstImport).resolves.toEqual({ ok: true });
    });
    expect(result.current.ledgerData).toEqual(candidate);
    expect(result.current.persistenceStatus).toBe("saved");
    expect(result.current.isDirty).toBe(false);
  });

  it("rejects import while an explicit retry owns the write queue", async () => {
    const retrySave = createDeferred<void>();
    const repository = createRepository({
      save: vi
        .fn<LedgerRepository["save"]>()
        .mockRejectedValueOnce(new Error("write failed"))
        .mockImplementationOnce(() => retrySave.promise),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("retry-before-import", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.canRetryPersistence).toBe(true);
    });

    const retryPromise = result.current.retryPersistence();
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(2);
    });
    await expect(
      result.current.replaceLedgerFromBackup(createCompleteLedger()),
    ).resolves.toEqual({ ok: false, code: "LEDGER_IMPORT_NOT_ALLOWED" });
    expect(repository.save).toHaveBeenCalledTimes(2);

    retrySave.resolve();
    await expect(retryPromise).resolves.toBe(true);
  });

  it("keeps the prior record and page data when DefaultLedgerRepository import write fails", async () => {
    const priorLedger = createCompleteLedger();
    const { adapter, readStored } = createMemoryStorageAdapter(
      priorLedger,
      async () => {
        throw new Error("write failed");
      },
    );
    const repository = new DefaultLedgerRepository(
      adapter,
      new NoopEncryptionService(),
    );
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const pageBeforeImport = result.current.ledgerData;
    const candidate = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("backup-new", "buy", "BTC", "3")],
    };

    await expect(result.current.replaceLedgerFromBackup(candidate)).resolves.toEqual({
      ok: false,
      code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    });

    expect(result.current.ledgerData).toEqual(pageBeforeImport);
    expect(readStored()).toEqual(
      createNoopStoredLedgerEnvelope(JSON.stringify(priorLedger)),
    );
    await expect(repository.load()).resolves.toEqual(priorLedger);
  });

  it("does not auto-save a failed mutation again after a failed import", async () => {
    const initialLedger = createInitialLedgerData();
    let writeCount = 0;
    const { adapter, readStored } = createMemoryStorageAdapter(
      initialLedger,
      async () => {
        writeCount += 1;
        throw new Error(`write ${writeCount} failed`);
      },
    );
    const repository = new DefaultLedgerRepository(
      adapter,
      new NoopEncryptionService(),
    );
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("failed-before-import", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect(result.current.persistenceStatus).toBe("error");
      expect(result.current.canRetryPersistence).toBe(true);
    });

    const pageBeforeImport = result.current.ledgerData;
    const mutationVersionBeforeImport = result.current.mutationVersion;
    const persistedVersionBeforeImport = result.current.persistedVersion;

    await expect(
      result.current.replaceLedgerFromBackup(createCompleteLedger()),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    });

    await waitFor(() => {
      expect(adapter.write).toHaveBeenCalledTimes(2);
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.write).toHaveBeenCalledTimes(2);
    expect(result.current.ledgerData).toEqual(pageBeforeImport);
    expect(result.current.mutationVersion).toBe(mutationVersionBeforeImport);
    expect(result.current.persistedVersion).toBe(persistedVersionBeforeImport);
    expect(result.current.persistenceStatus).toBe("error");
    expect(result.current.canRetryPersistence).toBe(true);
    expect(result.current.isDirty).toBe(true);
    expect(readStored()).toEqual(
      createNoopStoredLedgerEnvelope(JSON.stringify(initialLedger)),
    );
  });

  it("queues import after an in-flight save and preserves the last successful record on import failure", async () => {
    const queuedSave = createDeferred<void>();
    let writeCount = 0;
    const priorLedger = createInitialLedgerData();
    const { adapter } = createMemoryStorageAdapter(priorLedger, async () => {
      writeCount += 1;
      if (writeCount === 1) {
        await queuedSave.promise;
        return;
      }
      throw new Error("import failed");
    });
    const repository = new DefaultLedgerRepository(
      adapter,
      new NoopEncryptionService(),
    );
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("queued-before-import", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(adapter.write).toHaveBeenCalledTimes(1);
    });
    const queuedLedger = result.current.ledgerData;
    const importPromise = result.current.replaceLedgerFromBackup(
      createCompleteLedger(),
    );

    queuedSave.resolve();
    await expect(importPromise).resolves.toEqual({
      ok: false,
      code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    });

    await expect(repository.load()).resolves.toEqual(queuedLedger);
    expect(result.current.ledgerData).toEqual(queuedLedger);
  });

  it("recovers from hydration failure without clearing first", async () => {
    const repository = createRepository({
      load: vi.fn(async () => {
        throw new Error("corrupt record");
      }),
    });
    const candidate = createCompleteLedger();
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("error");
    });
    await expect(result.current.replaceLedgerFromBackup(candidate)).resolves.toEqual({
      ok: true,
    });

    expect(repository.clear).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith(candidate);
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(candidate);
    });
  });

  it("preserves a corrupt record when hydration recovery import cannot write", async () => {
    const corruptEnvelope = {
      ...createNoopStoredLedgerEnvelope("{"),
      ciphertextBase64Url: "not valid!",
    };
    let storedEnvelope: unknown | null = corruptEnvelope;
    const adapter: StorageAdapter = {
      read: vi.fn(async () => storedEnvelope),
      write: vi.fn(async () => {
        throw new Error("write failed");
      }),
      clear: vi.fn(async () => {
        storedEnvelope = null;
      }),
    };
    const repository = new DefaultLedgerRepository(
      adapter,
      new NoopEncryptionService(),
    );
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("error");
    });
    await expect(
      result.current.replaceLedgerFromBackup(createCompleteLedger()),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    });

    expect(result.current.hydrationStatus).toBe("error");
    expect(storedEnvelope).toEqual(corruptEnvelope);
    expect(adapter.clear).not.toHaveBeenCalled();
    await expect(adapter.read()).resolves.toEqual(corruptEnvelope);
  });

  it("rejects import from a ready read-only ledger without opening a write", async () => {
    const oversizedLedger = {
      ...createInitialLedgerData(),
      trades: [
        {
          ...createSimpleTrade("read-only-import", "buy", "BTC", "1"),
          note: "n".repeat(4_097),
        },
      ],
    };
    const repository = createRepository({
      load: vi.fn(async () => oversizedLedger),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.isReadOnly).toBe(true);
    });

    await expect(
      result.current.replaceLedgerFromBackup(createCompleteLedger()),
    ).resolves.toEqual({
      ok: false,
      code: "LEDGER_IMPORT_NOT_ALLOWED",
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("does not apply an import that completes after unmount", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      save: vi.fn(() => saveDeferred.promise),
    });
    const { result, unmount } = renderHook(() =>
      usePersistentLedger(repository),
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const importPromise = result.current.replaceLedgerFromBackup(
      createCompleteLedger(),
    );
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
    });
    unmount();

    saveDeferred.resolve();
    await expect(importPromise).resolves.toEqual({ ok: true });
    expect(repository.save).toHaveBeenCalledOnce();
    expect(repository.clear).not.toHaveBeenCalled();
  });

  it("defers repository switching until an import completes", async () => {
    const saveDeferred = createDeferred<void>();
    const oldRepository = createRepository({
      save: vi.fn(() => saveDeferred.promise),
    });
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("new-repository", "buy", "ETH", "2")],
    };
    const newRepository = createRepository({
      load: vi.fn(async () => newLedger),
    });
    const { result, rerender } = renderHook(
      ({ repository }) => usePersistentLedger(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const importPromise = result.current.replaceLedgerFromBackup(
      createCompleteLedger(),
    );
    await waitFor(() => {
      expect(oldRepository.save).toHaveBeenCalledOnce();
    });

    rerender({ repository: newRepository });
    expect(result.current.repositorySwitchBlocked).toBe(true);
    expect(newRepository.load).not.toHaveBeenCalled();

    saveDeferred.resolve();
    await expect(importPromise).resolves.toEqual({ ok: true });
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(newLedger);
    });
  });

  it("switches repositories without applying an old import failure", async () => {
    const saveDeferred = createDeferred<void>();
    const oldLedger = createCompleteLedger();
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("new-after-import-failure", "buy", "ETH", "2")],
    };
    const oldRepository = createRepository({
      load: vi.fn(async () => oldLedger),
      save: vi.fn(() => saveDeferred.promise),
    });
    const newRepository = createRepository({
      load: vi.fn(async () => newLedger),
    });
    const { result, rerender } = renderHook(
      ({ repository }) => usePersistentLedger(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const importPromise = result.current.replaceLedgerFromBackup(
      createInitialLedgerData(),
    );
    await waitFor(() => {
      expect(oldRepository.save).toHaveBeenCalledOnce();
    });
    rerender({ repository: newRepository });
    expect(result.current.repositorySwitchBlocked).toBe(true);

    saveDeferred.reject(new Error("old import failed"));
    await expect(importPromise).resolves.toEqual({
      ok: false,
      code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    });
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(newLedger);
    });
    expect(newRepository.save).not.toHaveBeenCalled();
  });

  it("round-trips a complete backup through Hook clear, import, and repository remount", async () => {
    const indexedDBFactory = new IDBFactory();
    const databaseName = "hook-backup-roundtrip";
    const firstRepository = createTestLedgerRepository({
      databaseName,
      indexedDBFactory,
    });
    const fixture = createCompleteBackupLedger();
    const { result, unmount } = renderHook(() => usePersistentLedger(firstRepository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    await expect(result.current.replaceLedgerFromBackup(fixture)).resolves.toEqual({
      ok: true,
    });
    await waitFor(() => {
      expect(result.current.ledgerData).toEqual(fixture);
      expect(result.current.persistenceStatus).toBe("saved");
    });

    const envelope = createBackupEnvelope(result.current.ledgerData, {
      appVersion: "0.1.0",
      exportedAt: "2026-07-23T12:34:56Z",
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const parsed = parseBackupJson(serializeBackupEnvelope(envelope.value));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    await expect(result.current.clearLedger()).resolves.toEqual({ ok: true });
    await expect(firstRepository.load()).resolves.toBeNull();
    await expect(
      result.current.replaceLedgerFromBackup(parsed.value.ledgerData),
    ).resolves.toEqual({ ok: true });
    await waitFor(() => {
      expect(result.current.ledgerData).toEqual(fixture);
    });

    unmount();
    const remountedRepository = createTestLedgerRepository({
      databaseName,
      indexedDBFactory,
    });
    const remounted = renderHook(() => usePersistentLedger(remountedRepository));
    await waitFor(() => {
      expect(remounted.result.current.hydrationStatus).toBe("ready");
      expect(remounted.result.current.ledgerData).toEqual(fixture);
    });
    const reexportedEnvelope = createBackupEnvelope(
      remounted.result.current.ledgerData,
      {
        appVersion: envelope.value.appVersion,
        exportedAt: envelope.value.exportedAt,
      },
    );
    expect(reexportedEnvelope.ok).toBe(true);
    if (!reexportedEnvelope.ok) return;
    const reparsed = parseBackupJson(
      serializeBackupEnvelope(reexportedEnvelope.value),
    );
    expect(reparsed).toEqual(parsed);
    if (!reparsed.ok) return;
    expect(reparsed.value.ledgerData.assets[0].binanceMapping?.symbol).toBe(
      "BTCUSDT",
    );
    expect(
      reparsed.value.ledgerData.priceSnapshots.find(
        (snapshot) => snapshot.id === "price-backup-binance",
      )?.binanceProvenance,
    ).toEqual({
      provider: "binance",
      symbol: "ADAUSDT",
      sourceQuoteCurrency: "USDT",
      fetchedAt: "2026-07-17T08:00:00Z",
    });
    expect(reparsed.value.ledgerData.feeRules).toEqual([fixture.feeRules[0]]);
    for (const forbiddenKey of [
      "positions",
      "allocationSlices",
      "holdingHistory",
      "tradeHeatmap",
      "valuationPriceMode",
      "selectedTradeDate",
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(
          reparsed.value.ledgerData,
          forbiddenKey,
        ),
      ).toBe(false);
    }
    remounted.unmount();
  });
});
