// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerData, Trade } from "../models";
import type { LedgerRepository } from "../repositories/ledgerRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { createSimpleTrade } from "../test/fixtures";
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
