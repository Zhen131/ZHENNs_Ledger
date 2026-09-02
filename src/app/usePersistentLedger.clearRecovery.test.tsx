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
import {
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  LEDGER_REPOSITORY_ERROR_CODES,
  LedgerSessionLifecycleError,
} from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import { usePersistentLedger as usePersistentLedgerRuntime } from "./usePersistentLedger";
import {
  addTrade,
  createCompleteLedger,
  createDeferred,
  createRepository,
  fixedClock,
  usePersistentLedger,
} from "./usePersistentLedger.testHelpers";

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
});
