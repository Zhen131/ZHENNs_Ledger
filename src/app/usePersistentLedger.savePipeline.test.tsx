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
import { type LedgerRepository } from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import {
  addTrade,
  createDeferred,
  createRepository,
  usePersistentLedger,
} from "./usePersistentLedger.testHelpers";

describe("usePersistentLedger hydration safety", () => {
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
