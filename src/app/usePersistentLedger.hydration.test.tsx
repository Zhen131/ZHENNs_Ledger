// @vitest-environment jsdom

import {
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  AssetTransfer,
  LedgerData,
} from "@/core/models";
import { LEDGER_REPOSITORY_ERROR_CODES } from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import {
  createUsdtPriceSnapshot as createPriceSnapshot,
  createUsdtSimpleTrade as createSimpleTrade,
} from "@/test-support";
import type { LedgerClock } from "@/core/shared";
import { usePersistentLedger as usePersistentLedgerRuntime } from "./usePersistentLedger";
import {
  addTrade,
  createDeferred,
  createRepository,
  usePersistentLedger,
} from "./usePersistentLedger.testHelpers";

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
    const futureTransfer: AssetTransfer = {
      id: "future-transfer",
      occurredAt: "2099-01-01",
      timePrecision: "day",
      assetSymbol: "BTC",
      quantity: "1",
      category: "external-in",
      reason: "deposit",
      unitPrice: "1",
      toLocation: "exchange",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    futureLedger.assetTransfers = [futureTransfer];
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
    expect(
      result.current.compatibilityWarnings.some(
        (warning) => warning.path === "assetTransfers[0].occurredAt",
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
          type: "assetTransfer/add",
          assetTransfer: {
            ...futureTransfer,
            id: "normal-transfer",
            occurredAt: "2020-01-01",
          },
        }),
      ).toBe("rejected");
      expect(
        result.current.applyLedgerMutation((current) => ({
          ...current,
          assetTransfers: [],
        })),
      ).toBe("rejected");
      expect(
        result.current.applyLedgerAction({
          type: "assetTransfer/delete",
          assetTransferId: futureTransfer.id,
        }),
      ).toBe("applied");
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
});
