// @vitest-environment jsdom

import { Suspense, startTransition, useState } from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerData, Trade } from "../models";
import type { StorageAdapter } from "../adapters/storageAdapter";
import type { StoredLedgerEnvelopeV2 } from "../encryption/cryptoEnvelope";
import {
  createNoopStoredLedgerEnvelope,
  NoopEncryptionService,
} from "../encryption/noopEncryptionService";
import {
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
} from "../backup/backupEnvelope";
import { createTestLedgerRepository } from "../test/createTestLedgerRepository";
import {
  claimLedgerSessionPersistencePort,
  createLedgerSession,
  DefaultLedgerRepository,
  INDEXED_DB_LEDGER_CAPABILITIES,
  LEDGER_FILE_CAPABILITIES,
  LEDGER_REPOSITORY_ERROR_CODES,
  LedgerSessionLifecycleError,
  type LedgerRepository,
} from "../repositories/ledgerRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  createAsset,
  createPriceSnapshot,
  createSimpleTrade,
  sampleTrades,
} from "../test/fixtures";
import type { LedgerClock } from "../utils/ledgerDate";
import { usePersistentLedger as usePersistentLedgerRuntime } from "./usePersistentLedger";

const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00"),
};

function usePersistentLedger(repository: LedgerRepository) {
  return usePersistentLedgerRuntime(repository, fixedClock);
}

afterEach(() => {
  cleanup();
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function dispatchBeforeUnload(): BeforeUnloadEvent {
  const event = new Event("beforeunload", {
    cancelable: true,
  }) as BeforeUnloadEvent;
  Object.defineProperty(event, "returnValue", {
    configurable: true,
    value: "unchanged",
    writable: true,
  });
  window.dispatchEvent(event);
  return event;
}

function createRepository(overrides: Partial<LedgerRepository> = {}) {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    ...overrides,
  } satisfies LedgerRepository;
}

function createMemoryStorageAdapter(
  initialLedger: LedgerData | null,
  write: (envelope: StoredLedgerEnvelopeV2) => Promise<void> = async () => undefined,
) {
  let stored: StoredLedgerEnvelopeV2 | null = initialLedger
    ? createNoopStoredLedgerEnvelope(JSON.stringify(initialLedger))
    : null;

  const adapter: StorageAdapter = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (envelope) => {
      await write(envelope);
      stored = envelope;
    }),
    clear: vi.fn(async () => {
      stored = null;
    }),
  };

  return { adapter, readStored: () => stored };
}

function addTrade(
  applyLedgerAction: ReturnType<
    typeof usePersistentLedger
  >["applyLedgerAction"],
  trade: Trade,
) {
  return applyLedgerAction({ type: "trade/add", trade });
}

function createCompleteLedger(): LedgerData {
  const initialLedger = createInitialLedgerData();

  return {
    ...initialLedger,
    assets: [...initialLedger.assets, createAsset("SOL", "Solana")],
    trades: [createSimpleTrade("trade-clear", "buy", "BTC", "1")],
    priceSnapshots: [
      createPriceSnapshot(
        "price-clear",
        "BTC",
        "80000",
        "2026-07-16",
      ),
    ],
    feeRules: [
      {
        id: "fee-clear",
        name: "Clear test fee",
        platform: "Test",
        type: "percentage",
        rate: "0.001",
        currency: "USD",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ],
  };
}

function createCompleteBackupLedger(): LedgerData {
  const initialLedger = createInitialLedgerData();
  const feeRule = {
    id: "fee-backup",
    name: "Backup test fee",
    platform: "Test",
    type: "percentage" as const,
    rate: "0.001",
    currency: "USD",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };

  return {
    ...initialLedger,
    assets: [...initialLedger.assets, createAsset("SOL", "Solana")],
    trades: structuredClone(sampleTrades).map((trade, index) => ({
      ...trade,
      note: index === 0 ? "golden backup note" : trade.note,
      rawText: trade.rawText ?? `golden backup ${index}`,
      feeRuleId: index === 0 ? feeRule.id : undefined,
    })),
    priceSnapshots: [
      createPriceSnapshot("price-backup-btc", "BTC", "80000", "2026-07-16"),
      createPriceSnapshot("price-backup-eth", "ETH", "2200", "2026-07-16"),
      {
        ...createPriceSnapshot(
          "price-backup-binance",
          "ADA",
          "0.75",
          "2026-07-17",
        ),
        source: "api",
        binanceProvenance: {
          provider: "binance",
          symbol: "ADAUSDT",
          sourceQuoteCurrency: "USDT",
          fetchedAt: "2026-07-17T08:00:00Z",
        },
      },
    ],
    feeRules: [feeRule],
  };
}

describe("usePersistentLedger hydration safety", () => {
  it("refreshes the shared day at local midnight and recalibrates on focus or visibility", async () => {
    vi.useFakeTimers();
    const repository = createRepository();
    let currentTime = new Date(2026, 6, 25, 23, 59, 59, 900);
    const clock: LedgerClock = {
      now: vi.fn(() => new Date(currentTime)),
    };
    const originalVisibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );

    try {
      const { result, unmount } = renderHook(() =>
        usePersistentLedgerRuntime(repository, clock),
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.todayKey).toBe("2026-07-25");

      currentTime = new Date(2026, 6, 26, 0, 0, 0, 0);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current.todayKey).toBe("2026-07-26");

      currentTime = new Date(2026, 6, 27, 9, 0, 0, 0);
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(result.current.todayKey).toBe("2026-07-27");

      currentTime = new Date(2026, 6, 28, 9, 0, 0, 0);
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(result.current.todayKey).toBe("2026-07-28");

      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (originalVisibility) {
        Object.defineProperty(
          document,
          "visibilityState",
          originalVisibility,
        );
      }
      vi.useRealTimers();
    }
  });

  it("persists one multi-price market refresh as one mutation and one save", async () => {
    const repository = createRepository();
    const { result } = renderHook(() => usePersistentLedger(repository));
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    act(() => {
      expect(
        result.current.applyLedgerMutation((current) => ({
          ...current,
          priceSnapshots: [
            ...current.priceSnapshots,
            createPriceSnapshot("btc-batch", "BTC", "70000", "2026-07-25"),
            createPriceSnapshot("eth-batch", "ETH", "2000", "2026-07-25"),
          ],
        })),
      ).toBe("applied");
    });

    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(result.current.persistenceStatus).toBe("saved");
    });
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(1);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        priceSnapshots: expect.arrayContaining([
          expect.objectContaining({ id: "btc-batch" }),
          expect.objectContaining({ id: "eth-batch" }),
        ]),
      }),
    );
  });

  it("increments ledgerEpoch only for whole-ledger replacement and enforces future correction mode", async () => {
    const futureLedger = createInitialLedgerData();
    futureLedger.trades = [
      createSimpleTrade("future-trade", "buy", "BTC", "1", "2099-01-01"),
    ];
    const repository = createRepository({
      load: vi.fn(async () => futureLedger),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    expect(result.current.ledgerEpoch).toBe(1);
    expect(result.current.isFutureFactCorrectionMode).toBe(true);
    expect(
      result.current.compatibilityWarnings.some(
        (warning) => warning.path === "trades[0].occurredAt",
      ),
    ).toBe(true);

    act(() => {
      expect(
        addTrade(
          result.current.applyLedgerAction,
          createSimpleTrade("normal-trade", "buy", "BTC", "1", "2020-01-01"),
        ),
      ).toBe("rejected");
      expect(
        result.current.applyLedgerAction({
          type: "trade/delete",
          tradeId: "normal-trade",
        }),
      ).toBe("rejected");
      expect(
        result.current.applyLedgerAction({
          type: "futureFacts/deleteAll",
          todayKey: "2026-07-25",
        }),
      ).toBe("applied");
    });

    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saved");
    });
    expect(result.current.isFutureFactCorrectionMode).toBe(false);
    expect(result.current.ledgerEpoch).toBe(1);

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(createInitialLedgerData()),
      ).resolves.toEqual({ ok: true });
    });
    expect(result.current.ledgerEpoch).toBe(2);

    await act(async () => {
      await expect(result.current.clearLedger()).resolves.toEqual({ ok: true });
    });
    expect(result.current.ledgerEpoch).toBe(3);
  });

  it("reports rejected, noop, and applied mutations with versioned persistence", async () => {
    const loadDeferred = createDeferred<LedgerData | null>();
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      load: vi.fn(() => loadDeferred.promise),
      save: vi.fn(() => saveDeferred.promise),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));
    const trade = createSimpleTrade("trade-versioned", "buy", "BTC", "1");

    let rejectedResult: ReturnType<
      typeof result.current.applyLedgerAction
    >;
    act(() => {
      rejectedResult = addTrade(result.current.applyLedgerAction, trade);
    });
    expect(rejectedResult!).toBe("rejected");
    expect(result.current.mutationVersion).toBe(0);
    expect(result.current.persistedVersion).toBe(0);

    await act(async () => {
      loadDeferred.resolve(null);
      await loadDeferred.promise;
    });
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    let noopResult: ReturnType<typeof result.current.applyLedgerAction>;
    act(() => {
      noopResult = result.current.applyLedgerAction({
        type: "trade/delete",
        tradeId: "missing-trade",
      });
    });
    expect(noopResult!).toBe("noop");
    expect(result.current.mutationVersion).toBe(0);

    let appliedResult: ReturnType<typeof result.current.applyLedgerAction>;
    act(() => {
      appliedResult = addTrade(result.current.applyLedgerAction, trade);
    });
    expect(appliedResult!).toBe("applied");
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(result.current.persistenceStatus).toBe("saving");
    });
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(0);

    await act(async () => {
      saveDeferred.resolve();
      await saveDeferred.promise;
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.persistedVersion).toBe(1);
    });
  });

  it("does not dispatch or save before hydration completes", async () => {
    const loadDeferred = createDeferred<LedgerData | null>();
    const savedLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade("trade-saved", "buy", "BTC", "1"),
      ],
    };
    const repository = createRepository({
      load: vi.fn(() => loadDeferred.promise),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-too-early", "buy", "ETH", "2"),
      );
    });

    expect(result.current.hydrationStatus).toBe("loading");
    expect(result.current.ledgerData.trades).toEqual([]);
    expect(repository.save).not.toHaveBeenCalled();
    await expect(result.current.clearLedger()).resolves.toEqual({
      ok: false,
      code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
    });
    expect(repository.clear).not.toHaveBeenCalled();

    await act(async () => {
      loadDeferred.resolve(savedLedger);
      await loadDeferred.promise;
    });

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    expect(result.current.ledgerData).toEqual(savedLedger);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("treats an empty database as no saved data without writing initial state", async () => {
    const repository = createRepository();
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    expect(result.current.ledgerData).toEqual(createInitialLedgerData());
    expect(repository.save).not.toHaveBeenCalled();

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-first", "buy", "BTC", "1"),
      );
    });

    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(1);
    });
  });

  it("serializes rapid writes so an older save cannot finish after a newer save", async () => {
    const firstSave = createDeferred<void>();
    const secondSave = createDeferred<void>();
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const repository = createRepository({ save });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-1", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-2", "buy", "ETH", "2"),
      );
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve();
      await firstSave.promise;
    });
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(save.mock.calls[1][0].trades.map((trade) => trade.id)).toEqual([
      "trade-1",
      "trade-2",
    ]);

    await act(async () => {
      secondSave.resolve();
      await secondSave.promise;
    });
  });

  it("does not report saved while a newer mutation is still pending", async () => {
    const firstSave = createDeferred<void>();
    const secondSave = createDeferred<void>();
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const repository = createRepository({ save });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-version-a", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-version-b", "buy", "ETH", "2"),
      );
    });

    await act(async () => {
      firstSave.resolve();
      await firstSave.promise;
    });
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
      expect(result.current.persistedVersion).toBe(1);
    });
    expect(result.current.mutationVersion).toBe(2);
    expect(result.current.persistenceStatus).toBe("saving");

    await act(async () => {
      secondSave.resolve();
      await secondSave.promise;
    });
    await waitFor(() => {
      expect(result.current.persistedVersion).toBe(2);
      expect(result.current.persistenceStatus).toBe("saved");
    });
  });

  it("ignores a completed save from an old repository generation", async () => {
    const oldSave = createDeferred<void>();
    const oldRepository = createRepository({
      save: vi.fn(() => oldSave.promise),
    });
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("trade-new-generation", "buy", "ETH", "2")],
    };
    const newRepository = createRepository({
      load: vi.fn(async () => structuredClone(newLedger)),
    });
    const { result, rerender } = renderHook(
      ({ repository }) => usePersistentLedger(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-old-generation", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(oldRepository.save).toHaveBeenCalledOnce();
    });

    rerender({ repository: newRepository });
    expect(result.current.repositorySwitchBlocked).toBe(true);
    expect(newRepository.load).not.toHaveBeenCalled();
    act(() => {
      expect(
        result.current.discardDirtyChangesAndSwitchRepository(),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(newLedger);
    });
    expect(result.current.mutationVersion).toBe(0);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.persistenceStatus).toBe("idle");

    await act(async () => {
      oldSave.resolve();
      await oldSave.promise;
    });
    expect(result.current.ledgerData).toEqual(newLedger);
    expect(result.current.mutationVersion).toBe(0);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.persistenceStatus).toBe("idle");
    expect(newRepository.save).not.toHaveBeenCalled();
  });

  it("keeps page state and exposes an error when a save fails", async () => {
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce();
    const repository = createRepository({ save });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-kept", "buy", "BTC", "1"),
      );
    });

    await waitFor(() => {
      expect(result.current.persistenceError).toMatch(/本地保存失败/);
    });
    expect(result.current.persistenceStatus).toBe("error");
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.ledgerData.trades.map((trade) => trade.id)).toEqual([
      "trade-kept",
    ]);

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-retry", "buy", "ETH", "2"),
      );
    });

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
      expect(result.current.persistenceError).toBeNull();
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.mutationVersion).toBe(2);
      expect(result.current.persistedVersion).toBe(2);
    });

    await expect(result.current.retryPersistence()).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("retries the latest failed ledger without requiring another mutation", async () => {
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce();
    const repository = createRepository({ save });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-direct-retry", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });

    await act(async () => {
      await expect(result.current.retryPersistence()).resolves.toBe(true);
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].trades.map((trade) => trade.id)).toEqual([
      "trade-direct-retry",
    ]);
    expect(result.current.persistenceError).toBeNull();
    expect(result.current.persistenceStatus).toBe("saved");
    expect(result.current.persistedVersion).toBe(1);
  });

  it("deduplicates repeated retry requests for the same failed version", async () => {
    const retrySave = createDeferred<void>();
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockImplementationOnce(() => retrySave.promise);
    const repository = createRepository({ save });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-dedup-retry", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });

    let firstRetry!: ReturnType<typeof result.current.retryPersistence>;
    let secondRetry!: ReturnType<typeof result.current.retryPersistence>;
    act(() => {
      firstRetry = result.current.retryPersistence();
      secondRetry = result.current.retryPersistence();
    });

    expect(firstRetry).toBe(secondRetry);
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    retrySave.resolve();
    await expect(Promise.all([firstRetry, secondRetry])).resolves.toEqual([
      true,
      true,
    ]);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("queues a newer mutation after an in-flight retry and persists it last", async () => {
    const retrySave = createDeferred<void>();
    const latestSave = createDeferred<void>();
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockImplementationOnce(() => retrySave.promise)
      .mockImplementationOnce(() => latestSave.promise);
    const repository = createRepository({ save });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-retry-a", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });

    let retryPromise!: ReturnType<typeof result.current.retryPersistence>;
    act(() => {
      retryPromise = result.current.retryPersistence();
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-retry-b", "buy", "ETH", "2"),
      );
    });
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });

    retrySave.resolve();
    await expect(retryPromise).resolves.toBe(true);
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(3);
    });
    expect(save.mock.calls[2][0].trades.map((trade) => trade.id)).toEqual([
      "trade-retry-a",
      "trade-retry-b",
    ]);
    expect(result.current.persistenceStatus).toBe("saving");

    latestSave.resolve();
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.persistedVersion).toBe(2);
    });
  });

  it("ignores retry completion after switching repositories", async () => {
    const retrySave = createDeferred<void>();
    const oldSave = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockImplementationOnce(() => retrySave.promise);
    const oldRepository = createRepository({ save: oldSave });
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("trade-retry-new-repo", "buy", "ETH", "2")],
    };
    const newRepository = createRepository({
      load: vi.fn(async () => structuredClone(newLedger)),
    });
    const { result, rerender } = renderHook(
      ({ repository }) => usePersistentLedger(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-retry-old-repo", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });
    const retryPromise = result.current.retryPersistence();
    await waitFor(() => {
      expect(oldSave).toHaveBeenCalledTimes(2);
    });

    rerender({ repository: newRepository });
    expect(result.current.repositorySwitchBlocked).toBe(true);
    expect(newRepository.load).not.toHaveBeenCalled();
    act(() => {
      expect(
        result.current.discardDirtyChangesAndSwitchRepository(),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(newLedger);
    });
    retrySave.resolve();
    await expect(retryPromise).resolves.toBe(false);

    expect(result.current.ledgerData).toEqual(newLedger);
    expect(result.current.persistenceStatus).toBe("idle");
    expect(result.current.persistenceError).toBeNull();
    expect(newRepository.save).not.toHaveBeenCalled();
  });

  it("invalidates a failed version after clear succeeds", async () => {
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"));
    const repository = createRepository({ save });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-retry-before-clear", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
      expect(result.current.canRetryPersistence).toBe(true);
    });

    await act(async () => {
      await expect(result.current.clearLedger()).resolves.toEqual({ ok: true });
    });

    expect(result.current.canRetryPersistence).toBe(false);
    await expect(result.current.retryPersistence()).resolves.toBe(false);
    expect(save).toHaveBeenCalledOnce();
    expect(repository.clear).toHaveBeenCalledOnce();
  });

  it("ignores retry completion after unmount", async () => {
    const retrySave = createDeferred<void>();
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockImplementationOnce(() => retrySave.promise);
    const repository = createRepository({ save });
    const { result, unmount } = renderHook(() =>
      usePersistentLedger(repository),
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-retry-unmount", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });
    const retryPromise = result.current.retryPersistence();
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });

    unmount();
    retrySave.resolve();

    await expect(retryPromise).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("enters error state and never saves when hydration fails", async () => {
    const repository = createRepository({
      load: vi.fn(async () => {
        throw new Error("read failed");
      }),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("error");
    });
    expect(result.current.persistenceError).toMatch(/避免覆盖原数据/);

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-blocked", "buy", "BTC", "1"),
      );
    });

    expect(result.current.ledgerData.trades).toEqual([]);
    expect(repository.save).not.toHaveBeenCalled();
  });
});

describe("usePersistentLedger dirty lifecycle", () => {
  it("warns while a save is pending and removes the warning after latest success", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      save: vi.fn(() => saveDeferred.promise),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    expect(result.current.isDirty).toBe(false);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-dirty-pending", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saving");
      expect(result.current.isDirty).toBe(true);
    });
    const pendingEvent = dispatchBeforeUnload();
    expect(pendingEvent.defaultPrevented).toBe(true);
    expect(pendingEvent.returnValue).toBe("");

    await act(async () => {
      saveDeferred.resolve();
      await saveDeferred.promise;
    });
    await waitFor(() => {
      expect(result.current.isDirty).toBe(false);
      expect(result.current.persistenceStatus).toBe("saved");
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("keeps warning after save failure and removes it after retry success", async () => {
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce();
    const repository = createRepository({ save });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-dirty-error", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });
    expect(result.current.isDirty).toBe(true);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    await act(async () => {
      await result.current.retryPersistence();
    });
    await waitFor(() => {
      expect(result.current.isDirty).toBe(false);
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("stays dirty when an older save succeeds before the latest mutation", async () => {
    const firstSave = createDeferred<void>();
    const secondSave = createDeferred<void>();
    const save = vi
      .fn<LedgerRepository["save"]>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const repository = createRepository({ save });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-dirty-a", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-dirty-b", "buy", "ETH", "2"),
      );
    });
    firstSave.resolve();
    await waitFor(() => {
      expect(result.current.persistedVersion).toBe(1);
    });

    expect(result.current.isDirty).toBe(true);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    secondSave.resolve();
    await waitFor(() => {
      expect(result.current.isDirty).toBe(false);
    });
  });

  it("clears dirty state and the leave warning after successful clear", async () => {
    const repository = createRepository({
      save: vi.fn(async () => {
        throw new Error("write failed");
      }),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-dirty-clear", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.isDirty).toBe(true);
    });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    await act(async () => {
      await result.current.clearLedger();
    });
    expect(result.current.isDirty).toBe(false);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("removes the leave warning listener on unmount", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      save: vi.fn(() => saveDeferred.promise),
    });
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() =>
      usePersistentLedger(repository),
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-dirty-unmount", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.isDirty).toBe(true);
      expect(addEventListener).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      );
    });
    const beforeUnloadHandler = addEventListener.mock.calls.find(
      ([type]) => type === "beforeunload",
    )?.[1];

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith(
      "beforeunload",
      beforeUnloadHandler,
    );
    saveDeferred.resolve();
    addEventListener.mockRestore();
    removeEventListener.mockRestore();
  });

  it("blocks a dirty repository switch until the latest save succeeds", async () => {
    const oldSave = createDeferred<void>();
    const oldRepository = createRepository({
      save: vi.fn(() => oldSave.promise),
    });
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("trade-clean-switch", "buy", "ETH", "2")],
    };
    const newRepository = createRepository({
      load: vi.fn(async () => structuredClone(newLedger)),
    });
    const { result, rerender } = renderHook(
      ({ repository }) => usePersistentLedger(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-dirty-switch", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(oldRepository.save).toHaveBeenCalledOnce();
    });

    rerender({ repository: newRepository });
    expect(result.current.repositorySwitchBlocked).toBe(true);
    expect(result.current.ledgerData.trades.map((trade) => trade.id)).toEqual([
      "trade-dirty-switch",
    ]);
    expect(newRepository.load).not.toHaveBeenCalled();

    oldSave.resolve();
    await waitFor(() => {
      expect(newRepository.load).toHaveBeenCalledOnce();
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(newLedger);
      expect(result.current.repositorySwitchBlocked).toBe(false);
    });
  });

  it("switches only after the user explicitly abandons dirty state", async () => {
    const oldRepository = createRepository({
      save: vi.fn(async () => {
        throw new Error("write failed");
      }),
    });
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("trade-discard-switch", "buy", "ETH", "2")],
    };
    const newRepository = createRepository({
      load: vi.fn(async () => structuredClone(newLedger)),
    });
    const { result, rerender } = renderHook(
      ({ repository }) => usePersistentLedger(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-explicit-discard", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });
    rerender({ repository: newRepository });
    expect(result.current.repositorySwitchBlocked).toBe(true);
    expect(newRepository.load).not.toHaveBeenCalled();

    let discardResult = false;
    act(() => {
      discardResult =
        result.current.discardDirtyChangesAndSwitchRepository();
    });
    expect(discardResult).toBe(true);

    await waitFor(() => {
      expect(newRepository.load).toHaveBeenCalledOnce();
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(newLedger);
      expect(result.current.isDirty).toBe(false);
    });
  });
});

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

describe("usePersistentLedger clear sequencing", () => {
  it("clears every persisted collection without recreating the initial ledger", async () => {
    let storedLedger: LedgerData | null = createCompleteLedger();
    const repository: LedgerRepository = {
      load: vi.fn(async () =>
        storedLedger === null ? null : structuredClone(storedLedger),
      ),
      save: vi.fn(async (ledgerData) => {
        storedLedger = structuredClone(ledgerData);
      }),
      clear: vi.fn(async () => {
        storedLedger = null;
      }),
    };
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    expect(result.current.ledgerData.assets.map((asset) => asset.symbol)).toContain(
      "SOL",
    );

    let clearResult: Awaited<ReturnType<typeof result.current.clearLedger>>;
    await act(async () => {
      clearResult = await result.current.clearLedger();
    });

    expect(clearResult!).toEqual({ ok: true });
    expect(repository.clear).toHaveBeenCalledOnce();
    expect(result.current.ledgerData).toEqual(createInitialLedgerData());
    expect(result.current.ledgerData.assets.map((asset) => asset.symbol)).toEqual([
      "BTC",
      "ETH",
      "ADA",
    ]);
    expect(result.current.ledgerData.trades).toEqual([]);
    expect(result.current.ledgerData.priceSnapshots).toEqual([]);
    expect(result.current.ledgerData.feeRules).toEqual([]);
    expect(result.current.persistenceStatus).toBe("idle");
    expect(result.current.mutationVersion).toBe(0);
    expect(result.current.persistedVersion).toBe(0);
    expect(repository.save).not.toHaveBeenCalled();
    await expect(repository.load()).resolves.toBeNull();

    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-after-clear", "buy", "BTC", "1"),
      );
    });

    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
    });
    await expect(repository.load()).resolves.toMatchObject({
      trades: [{ id: "trade-after-clear" }],
    });
  });

  it("waits for a queued save before clearing", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      save: vi.fn(() => saveDeferred.promise),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-queued", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
    });

    let clearPromise!: ReturnType<typeof result.current.clearLedger>;
    act(() => {
      clearPromise = result.current.clearLedger();
    });

    expect(result.current.persistenceOperation).toBe("clearing");
    expect(repository.clear).not.toHaveBeenCalled();

    await act(async () => {
      saveDeferred.resolve();
      await saveDeferred.promise;
      await clearPromise;
    });

    expect(repository.clear).toHaveBeenCalledOnce();
    expect(result.current.persistenceOperation).toBe("idle");
  });

  it("continues to clear after the preceding queued save fails", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      save: vi.fn(() => saveDeferred.promise),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-save-fails", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
    });

    let clearPromise!: ReturnType<typeof result.current.clearLedger>;
    act(() => {
      clearPromise = result.current.clearLedger();
    });
    await act(async () => {
      saveDeferred.reject(new Error("queued save failed"));
      await expect(saveDeferred.promise).rejects.toThrow("queued save failed");
      await expect(clearPromise).resolves.toEqual({ ok: true });
    });

    expect(repository.clear).toHaveBeenCalledOnce();
    expect(result.current.ledgerData).toEqual(createInitialLedgerData());
    expect(result.current.persistenceError).toBeNull();
  });

  it("blocks dispatch and automatic saves while clear is running", async () => {
    const clearDeferred = createDeferred<void>();
    const savedLedger = createCompleteLedger();
    const repository = createRepository({
      load: vi.fn(async () => structuredClone(savedLedger)),
      clear: vi.fn(() => clearDeferred.promise),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    let clearPromise!: ReturnType<typeof result.current.clearLedger>;
    act(() => {
      clearPromise = result.current.clearLedger();
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-blocked-by-clear", "buy", "ETH", "2"),
      );
    });

    expect(result.current.ledgerData).toEqual(savedLedger);
    expect(repository.save).not.toHaveBeenCalled();

    await act(async () => {
      clearDeferred.resolve();
      await clearPromise;
    });

    expect(repository.save).not.toHaveBeenCalled();
    expect(result.current.ledgerData).toEqual(createInitialLedgerData());
  });

  it("shares one promise and one repository call across repeated clear requests", async () => {
    const clearDeferred = createDeferred<void>();
    const repository = createRepository({
      clear: vi.fn(() => clearDeferred.promise),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    let firstPromise!: ReturnType<typeof result.current.clearLedger>;
    let secondPromise!: ReturnType<typeof result.current.clearLedger>;
    act(() => {
      firstPromise = result.current.clearLedger();
      secondPromise = result.current.clearLedger();
    });

    expect(firstPromise).toBe(secondPromise);
    await waitFor(() => {
      expect(repository.clear).toHaveBeenCalledOnce();
    });

    await act(async () => {
      clearDeferred.resolve();
      await Promise.all([firstPromise, secondPromise]);
    });
    expect(repository.clear).toHaveBeenCalledOnce();
  });

  it("keeps state and old storage intact when clear fails", async () => {
    const storedLedger: LedgerData | null = createCompleteLedger();
    const repository: LedgerRepository = {
      load: vi.fn(async () => structuredClone(storedLedger)),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => {
        throw new Error("clear failed");
      }),
    };
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const stateBeforeClear = structuredClone(result.current.ledgerData);

    let clearResult!: Awaited<ReturnType<typeof result.current.clearLedger>>;
    await act(async () => {
      clearResult = await result.current.clearLedger();
    });

    expect(clearResult).toEqual({
      ok: false,
      code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
    });
    expect(result.current.ledgerData).toEqual(stateBeforeClear);
    expect(result.current.persistenceError).toMatch(/清空本地账本失败/);
    expect(storedLedger).toEqual(stateBeforeClear);
    await expect(repository.load()).resolves.toEqual(stateBeforeClear);
    expect(repository.save).not.toHaveBeenCalled();
  });
});

describe("usePersistentLedger clear recovery and lifecycle", () => {
  it("recovers a hydration error through controlled clear", async () => {
    const repository = createRepository({
      load: vi.fn(async () => {
        throw new Error("read failed");
      }),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("error");
    });

    await act(async () => {
      await expect(result.current.clearLedger()).resolves.toEqual({ ok: true });
    });

    expect(repository.clear).toHaveBeenCalledOnce();
    expect(result.current.hydrationStatus).toBe("ready");
    expect(result.current.ledgerData).toEqual(createInitialLedgerData());
    expect(result.current.persistenceError).toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("stays in hydration error when recovery clear fails", async () => {
    const repository = createRepository({
      load: vi.fn(async () => {
        throw new Error("read failed");
      }),
      clear: vi.fn(async () => {
        throw new Error("clear failed");
      }),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("error");
    });

    await act(async () => {
      await expect(result.current.clearLedger()).resolves.toEqual({
        ok: false,
        code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
      });
    });

    expect(result.current.hydrationStatus).toBe("error");
    expect(result.current.persistenceError).toMatch(/清空本地账本失败/);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("does not let an old repository clear replace a newly hydrated ledger", async () => {
    const oldClearDeferred = createDeferred<void>();
    const oldLedger = createCompleteLedger();
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade("trade-new-repository", "buy", "ETH", "2"),
      ],
    };
    const oldRepository = createRepository({
      load: vi.fn(async () => structuredClone(oldLedger)),
      clear: vi.fn(() => oldClearDeferred.promise),
    });
    const newRepository = createRepository({
      load: vi.fn(async () => structuredClone(newLedger)),
    });
    const { result, rerender } = renderHook(
      ({ repository }) => usePersistentLedger(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    let oldClearPromise!: ReturnType<typeof result.current.clearLedger>;
    act(() => {
      oldClearPromise = result.current.clearLedger();
    });
    await waitFor(() => {
      expect(oldRepository.clear).toHaveBeenCalledOnce();
    });

    rerender({ repository: newRepository });
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(newLedger);
    });

    await act(async () => {
      oldClearDeferred.resolve();
      await oldClearPromise;
    });

    expect(result.current.ledgerData).toEqual(newLedger);
    expect(result.current.persistenceOperation).toBe("idle");
    expect(result.current.persistenceError).toBeNull();
    expect(newRepository.clear).not.toHaveBeenCalled();
    expect(newRepository.save).not.toHaveBeenCalled();
  });

  it("lets storage clear finish after unmount without further application work", async () => {
    const clearDeferred = createDeferred<void>();
    const repository = createRepository({
      clear: vi.fn(() => clearDeferred.promise),
    });
    const { result, unmount } = renderHook(() =>
      usePersistentLedger(repository),
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const clearPromise = result.current.clearLedger();
    await waitFor(() => {
      expect(repository.clear).toHaveBeenCalledOnce();
    });

    unmount();
    clearDeferred.resolve();

    await expect(clearPromise).resolves.toEqual({ ok: true });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("hydrates a structurally valid oversized ledger as read-only without saving or clearing it", async () => {
    const oversizedLedger = {
      ...createInitialLedgerData(),
      trades: [
        {
          ...createSimpleTrade("trade-oversized", "buy", "BTC", "1"),
          note: "n".repeat(4_097),
        },
      ],
    };
    const repository = createRepository({
      load: vi.fn(async () => structuredClone(oversizedLedger)),
    });
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.isReadOnly).toBe(true);
    });
    expect(result.current.resourcePolicyError).toEqual(
      expect.objectContaining({
        path: "trades[0].note",
        limit: 4_096,
        actual: 4_097,
      }),
    );

    let mutationResult!: ReturnType<typeof result.current.applyLedgerAction>;
    act(() => {
      mutationResult = addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("trade-blocked", "buy", "ETH", "1"),
      );
    });
    expect(mutationResult).toBe("rejected");
    await expect(result.current.clearLedger()).resolves.toEqual({
      ok: false,
      code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
  });

  it("rejects a new mutation before it enters state when it exceeds ResourcePolicy", async () => {
    const repository = createRepository();
    const { result } = renderHook(() => usePersistentLedger(repository));

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    let mutationResult!: ReturnType<typeof result.current.applyLedgerAction>;
    act(() => {
      mutationResult = addTrade(
        result.current.applyLedgerAction,
        {
          ...createSimpleTrade("trade-note-too-long", "buy", "BTC", "1"),
          note: "n".repeat(4_097),
        },
      );
    });

    expect(mutationResult).toBe("rejected");
    expect(result.current.ledgerData.trades).toEqual([]);
    expect(result.current.resourcePolicyError).toEqual(
      expect.objectContaining({ path: "trades[0].note" }),
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("synchronously registers an accepted mutation before quiesce and drains it before issuing the release proof", async () => {
    const saveDeferred = createDeferred<void>();
    const release = vi.fn(async () => undefined);
    const repository = createRepository({
      save: vi.fn(() => saveDeferred.promise),
    });
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "hook-file-session",
      release,
    });
    const { result } = renderHook(() =>
      usePersistentLedgerRuntime(
        session.repository,
        fixedClock,
        session.capabilities,
        session,
      ),
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    let tokenPromise!: ReturnType<
      typeof result.current.drainForSessionQuiesce
    >;
    act(() => {
      expect(
        addTrade(
          result.current.applyLedgerAction,
          createSimpleTrade(
            "accepted-before-effect",
            "buy",
            "BTC",
            "1",
          ),
        ),
      ).toBe("applied");
      const request =
        session.beginQuiesce("immediate-lock");
      tokenPromise =
        result.current.drainForSessionQuiesce(request);
    });

    expect(repository.save).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    expect(result.current.lifecycleStatus).toBe("quiescing");
    expect(
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade("too-late", "buy", "ETH", "1"),
      ),
    ).toBe("rejected");
    await expect(result.current.retryPersistence()).resolves.toBe(false);

    saveDeferred.resolve();
    const token = await tokenPromise;
    expect(release).not.toHaveBeenCalled();
    await session.lockAfterQuiesce(token);
    expect(release).toHaveBeenCalledOnce();
    expect(() => session.repository.load()).toThrow(
      LedgerSessionLifecycleError,
    );
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it("retains each committed session port so an old captured drain can release after a session switch without freezing the new session", async () => {
    const releaseOld = vi.fn(async () => undefined);
    const releaseCurrent = vi.fn(async () => undefined);
    const oldRepository = createRepository();
    const currentRepository = createRepository();
    const oldSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: oldRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "old-hook-session",
      release: releaseOld,
    });
    const currentSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: currentRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "current-hook-session",
      release: releaseCurrent,
    });
    const { result, rerender } = renderHook(
      ({ session }) =>
        usePersistentLedgerRuntime(
          session.repository,
          fixedClock,
          session.capabilities,
          session,
        ),
      { initialProps: { session: oldSession } },
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(oldRepository.load).toHaveBeenCalledOnce();
    });
    const beginOldQuiesce = oldSession.beginQuiesce;
    const drainOldSession = result.current.drainForSessionQuiesce;

    rerender({ session: currentSession });
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
      expect(currentRepository.load).toHaveBeenCalledOnce();
    });

    const oldRequest = beginOldQuiesce("route-leave");
    const oldToken = await drainOldSession(oldRequest);
    await oldSession.releaseAfterQuiesce(oldToken);

    expect(releaseOld).toHaveBeenCalledOnce();
    expect(releaseCurrent).not.toHaveBeenCalled();
    expect(() => oldSession.repository.load()).toThrow(
      LedgerSessionLifecycleError,
    );
    expect(result.current.lifecycleStatus).toBe("active");
    expect(
      addTrade(
        result.current.applyLedgerAction,
        createSimpleTrade(
          "current-session-still-writable",
          "buy",
          "BTC",
          "1",
        ),
      ),
    ).toBe("applied");
    await waitFor(() => {
      expect(currentRepository.save).toHaveBeenCalledOnce();
      expect(result.current.persistenceStatus).toBe("saved");
    });
  });

  it("keeps dirty state on the actual old session without rehydrating it while a requested session switch is blocked", async () => {
    const oldSave = createDeferred<void>();
    const oldRepository = createRepository({
      save: vi.fn(() => oldSave.promise),
    });
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "new-session-ledger",
          "buy",
          "ETH",
          "2",
        ),
      ],
    };
    const newRepository = createRepository({
      load: vi.fn(async () => structuredClone(newLedger)),
    });
    const oldSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: oldRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dirty-old-session",
    });
    const newSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: newRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dirty-new-session",
    });
    const { result, rerender } = renderHook(
      ({ session }) =>
        usePersistentLedgerRuntime(
          session.repository,
          fixedClock,
          session.capabilities,
          session,
        ),
      { initialProps: { session: oldSession } },
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    act(() => {
      expect(
        addTrade(
          result.current.applyLedgerAction,
          createSimpleTrade(
            "dirty-old-session-trade",
            "buy",
            "BTC",
            "1",
          ),
        ),
      ).toBe("applied");
    });
    await waitFor(() => {
      expect(oldRepository.save).toHaveBeenCalledOnce();
      expect(result.current.isDirty).toBe(true);
    });

    rerender({ session: newSession });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.repositorySwitchBlocked).toBe(true);
    expect(result.current.hydrationStatus).toBe("ready");
    expect(result.current.ledgerData.trades.map((trade) => trade.id)).toEqual([
      "dirty-old-session-trade",
    ]);
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.persistenceStatus).toBe("saving");
    expect(oldRepository.load).toHaveBeenCalledOnce();
    expect(newRepository.load).not.toHaveBeenCalled();

    oldSave.resolve();
    await waitFor(() => {
      expect(result.current.repositorySwitchBlocked).toBe(false);
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(newLedger);
      expect(newRepository.load).toHaveBeenCalledOnce();
    });
  });

  it("does not claim a provisional session when a dirty switch is blocked and then cancelled", async () => {
    const oldSave = createDeferred<void>();
    const oldRepository = createRepository({
      save: vi.fn(() => oldSave.promise),
    });
    const provisionalRepository = createRepository();
    const oldSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: oldRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "blocked-claim-old-session",
    });
    const provisionalSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: provisionalRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "blocked-claim-provisional-session",
    });
    const { result, rerender } = renderHook(
      ({ session }) =>
        usePersistentLedgerRuntime(
          session.repository,
          fixedClock,
          session.capabilities,
          session,
        ),
      { initialProps: { session: oldSession } },
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      expect(
        addTrade(
          result.current.applyLedgerAction,
          createSimpleTrade(
            "blocked-claim-dirty-trade",
            "buy",
            "BTC",
            "1",
          ),
        ),
      ).toBe("applied");
    });
    await waitFor(() => {
      expect(oldRepository.save).toHaveBeenCalledOnce();
    });

    rerender({ session: provisionalSession });
    expect(result.current.repositorySwitchBlocked).toBe(true);
    expect(provisionalRepository.load).not.toHaveBeenCalled();
    expect(() =>
      claimLedgerSessionPersistencePort(provisionalSession, {}),
    ).not.toThrow();

    rerender({ session: oldSession });
    expect(result.current.repositorySwitchBlocked).toBe(false);
    oldSave.resolve();
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.ledgerData.trades.map((trade) => trade.id)).toEqual([
        "blocked-claim-dirty-trade",
      ]);
    });
    expect(oldRepository.load).toHaveBeenCalledOnce();
    expect(provisionalRepository.load).not.toHaveBeenCalled();
  });

  it("keeps in-flight hydration owned by the old session so its captured drain waits for that work after switching", async () => {
    const oldLoad = createDeferred<LedgerData | null>();
    const releaseOld = vi.fn(async () => undefined);
    const oldRepository = createRepository({
      load: vi.fn(() => oldLoad.promise),
    });
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "hydrated-current-session",
          "buy",
          "ETH",
          "2",
        ),
      ],
    };
    const newRepository = createRepository({
      load: vi.fn(async () => structuredClone(newLedger)),
    });
    const oldSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: oldRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "hydrating-old-session",
      release: releaseOld,
    });
    const newSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: newRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "hydrated-new-session",
    });
    const { result, rerender } = renderHook(
      ({ session }) =>
        usePersistentLedgerRuntime(
          session.repository,
          fixedClock,
          session.capabilities,
          session,
        ),
      { initialProps: { session: oldSession } },
    );
    await waitFor(() => {
      expect(oldRepository.load).toHaveBeenCalledOnce();
    });
    const drainOldSession = result.current.drainForSessionQuiesce;

    rerender({ session: newSession });
    await waitFor(() => {
      expect(newRepository.load).toHaveBeenCalledOnce();
      expect(result.current.hydrationStatus).toBe("ready");
      expect(result.current.ledgerData).toEqual(newLedger);
    });

    const oldRequest = oldSession.beginQuiesce("route-leave");
    const oldTokenPromise = drainOldSession(oldRequest);
    let oldTokenIssued = false;
    void oldTokenPromise.then(() => {
      oldTokenIssued = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(oldTokenIssued).toBe(false);
    expect(result.current.lifecycleStatus).toBe("active");

    oldLoad.resolve(createInitialLedgerData());
    const oldToken = await oldTokenPromise;
    await oldSession.releaseAfterQuiesce(oldToken);
    expect(releaseOld).toHaveBeenCalledOnce();
    expect(result.current.ledgerData).toEqual(newLedger);
    expect(result.current.lifecycleStatus).toBe("active");
  });

  it("does not let an abandoned session render replace the committed repository refs", async () => {
    const oldLoad = createDeferred<LedgerData | null>();
    const oldRepository = createRepository({
      load: vi.fn(() => oldLoad.promise),
    });
    const proposedRepository = createRepository();
    const oldSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: oldRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "committed-render-session",
    });
    const proposedSession = createLedgerSession({
      storageKind: "ledger-file",
      repository: proposedRepository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "abandoned-render-session",
    });
    const oldLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "committed-hydration",
          "buy",
          "BTC",
          "1",
        ),
      ],
    };
    const neverCommit = new Promise<void>(() => undefined);
    let committedState:
      | ReturnType<typeof usePersistentLedgerRuntime>
      | null = null;
    let requestSessionSwitch: (() => void) | null = null;
    let abandonedRenderCount = 0;

    function HookProbe({ session }: { session: typeof oldSession }) {
      const state = usePersistentLedgerRuntime(
        session.repository,
        fixedClock,
        session.capabilities,
        session,
      );
      if (session === proposedSession) {
        abandonedRenderCount += 1;
        throw neverCommit;
      }
      committedState = state;
      return null;
    }

    function ConcurrentHarness() {
      const [session, setSession] = useState(oldSession);
      requestSessionSwitch = () => setSession(proposedSession);
      return (
        <Suspense fallback={null}>
          <HookProbe session={session} />
        </Suspense>
      );
    }

    const view = render(<ConcurrentHarness />);
    await waitFor(() => {
      expect(oldRepository.load).toHaveBeenCalledOnce();
    });
    act(() => {
      startTransition(() => requestSessionSwitch?.());
    });
    await waitFor(() => {
      expect(abandonedRenderCount).toBeGreaterThan(0);
    });
    expect(proposedRepository.load).not.toHaveBeenCalled();
    expect(() =>
      claimLedgerSessionPersistencePort(proposedSession, {}),
    ).not.toThrow();

    oldLoad.resolve(oldLedger);
    await waitFor(() => {
      expect(committedState?.hydrationStatus).toBe("ready");
      expect(committedState?.ledgerData).toEqual(oldLedger);
    });
    const readCommittedState = () => {
      if (!committedState) {
        throw new Error("committed Hook state is unavailable");
      }
      return committedState;
    };
    act(() => {
      expect(
        addTrade(
          readCommittedState().applyLedgerAction,
          createSimpleTrade(
            "committed-after-abandoned-render",
            "buy",
            "ETH",
            "1",
          ),
        ),
      ).toBe("applied");
    });
    await waitFor(() => {
      expect(oldRepository.save).toHaveBeenCalledOnce();
      expect(readCommittedState().persistenceStatus).toBe("saved");
    });
    expect(proposedRepository.load).not.toHaveBeenCalled();
    expect(proposedRepository.save).not.toHaveBeenCalled();
    view.unmount();
  });

  it("waits for an admitted hydration read before issuing a quiesce token and ignores its late UI result", async () => {
    const loadDeferred = createDeferred<LedgerData | null>();
    const release = vi.fn(async () => undefined);
    const savedLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "hydrated-before-lock",
          "buy",
          "BTC",
          "1",
        ),
      ],
    };
    const repository = createRepository({
      load: vi.fn(() => loadDeferred.promise),
    });
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "slow-hydration-session",
      release,
    });
    const { result } = renderHook(() =>
      usePersistentLedgerRuntime(
        session.repository,
        fixedClock,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(repository.load).toHaveBeenCalledOnce();
    });
    expect(result.current.hydrationStatus).toBe("loading");

    let tokenPromise!: ReturnType<
      typeof result.current.drainForSessionQuiesce
    >;
    act(() => {
      const request =
        session.beginQuiesce("immediate-lock");
      tokenPromise =
        result.current.drainForSessionQuiesce(request);
    });
    let tokenIssued = false;
    void tokenPromise.then(() => {
      tokenIssued = true;
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(tokenIssued).toBe(false);
    expect(() => session.repository.load()).toThrow(
      LedgerSessionLifecycleError,
    );
    expect(release).not.toHaveBeenCalled();

    await act(async () => {
      loadDeferred.resolve(savedLedger);
      await loadDeferred.promise;
    });
    const token = await tokenPromise;
    expect(result.current.lifecycleStatus).toBe("quiescing");
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
    await session.lockAfterQuiesce(token);
    expect(release).toHaveBeenCalledOnce();
  });

  it("drains an active clear and rejects a request from another session without freezing the current Hook", async () => {
    const clearDeferred = createDeferred<void>();
    const release = vi.fn(async () => undefined);
    const repository = createRepository({
      clear: vi.fn(() => clearDeferred.promise),
    });
    const session = createLedgerSession({
      storageKind: "indexeddb",
      repository,
      capabilities: INDEXED_DB_LEDGER_CAPABILITIES,
      createSessionId: () => "hook-clear-session",
      release,
    });
    const other = createLedgerSession({
      storageKind: "indexeddb",
      repository: createRepository(),
      capabilities: INDEXED_DB_LEDGER_CAPABILITIES,
      createSessionId: () => "other-session",
    });
    const { result } = renderHook(() =>
      usePersistentLedgerRuntime(
        session.repository,
        fixedClock,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    const wrongRequest = other.beginQuiesce("route-leave");
    expect(() =>
      result.current.drainForSessionQuiesce(wrongRequest),
    ).toThrow(LedgerSessionLifecycleError);
    expect(result.current.lifecycleStatus).toBe("active");

    let clearPromise!: ReturnType<typeof result.current.clearLedger>;
    act(() => {
      clearPromise = result.current.clearLedger();
    });
    await waitFor(() => {
      expect(repository.clear).toHaveBeenCalledOnce();
    });

    const request = session.beginQuiesce("route-leave");
    let tokenPromise!: ReturnType<
      typeof result.current.drainForSessionQuiesce
    >;
    act(() => {
      tokenPromise =
        result.current.drainForSessionQuiesce(request);
    });
    expect(release).not.toHaveBeenCalled();
    clearDeferred.resolve();
    await expect(clearPromise).resolves.toEqual({ ok: true });
    const token = await tokenPromise;
    await session.releaseAfterQuiesce(token);
    expect(release).toHaveBeenCalledOnce();
  });
});
