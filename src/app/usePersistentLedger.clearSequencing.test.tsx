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
import type { LedgerData } from "@/core/models";
import {
  LEDGER_REPOSITORY_ERROR_CODES,
  type LedgerRepository,
} from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import {
  addTrade,
  createCompleteLedger,
  createDeferred,
  createRepository,
  usePersistentLedger,
} from "./usePersistentLedger.testHelpers";

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
