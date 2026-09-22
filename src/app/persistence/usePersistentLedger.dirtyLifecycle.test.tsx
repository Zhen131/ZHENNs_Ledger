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
  dispatchBeforeUnload,
  usePersistentLedger,
} from "./usePersistentLedger.testHelpers";

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
