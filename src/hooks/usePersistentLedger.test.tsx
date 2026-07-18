// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerData, Trade } from "../models";
import {
  LEDGER_REPOSITORY_ERROR_CODES,
  type LedgerRepository,
} from "../repositories/ledgerRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  createAsset,
  createPriceSnapshot,
  createSimpleTrade,
} from "../test/fixtures";
import { usePersistentLedger } from "./usePersistentLedger";

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

function createRepository(overrides: Partial<LedgerRepository> = {}) {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    ...overrides,
  } satisfies LedgerRepository;
}

function addTrade(
  dispatch: ReturnType<typeof usePersistentLedger>["dispatch"],
  trade: Trade,
) {
  dispatch({ type: "trade/add", trade });
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

describe("usePersistentLedger hydration safety", () => {
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
        result.current.dispatch,
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
        result.current.dispatch,
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
        result.current.dispatch,
        createSimpleTrade("trade-1", "buy", "BTC", "1"),
      );
    });
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });

    act(() => {
      addTrade(
        result.current.dispatch,
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
        result.current.dispatch,
        createSimpleTrade("trade-kept", "buy", "BTC", "1"),
      );
    });

    await waitFor(() => {
      expect(result.current.persistenceError).toMatch(/本地保存失败/);
    });
    expect(result.current.ledgerData.trades.map((trade) => trade.id)).toEqual([
      "trade-kept",
    ]);

    act(() => {
      addTrade(
        result.current.dispatch,
        createSimpleTrade("trade-retry", "buy", "ETH", "2"),
      );
    });

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
      expect(result.current.persistenceError).toBeNull();
    });
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
        result.current.dispatch,
        createSimpleTrade("trade-blocked", "buy", "BTC", "1"),
      );
    });

    expect(result.current.ledgerData.trades).toEqual([]);
    expect(repository.save).not.toHaveBeenCalled();
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
    expect(repository.save).not.toHaveBeenCalled();
    await expect(repository.load()).resolves.toBeNull();

    act(() => {
      addTrade(
        result.current.dispatch,
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
        result.current.dispatch,
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
        result.current.dispatch,
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
        result.current.dispatch,
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
});
