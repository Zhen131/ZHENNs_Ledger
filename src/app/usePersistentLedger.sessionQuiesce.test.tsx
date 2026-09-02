// @vitest-environment jsdom

import { Suspense, startTransition, useState } from "react";
import {
  act,
  render,
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
  claimLedgerSessionPersistencePort,
  createLedgerSession,
  INDEXED_DB_LEDGER_CAPABILITIES,
  LEDGER_FILE_CAPABILITIES,
  LedgerSessionLifecycleError,
} from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import { usePersistentLedger as usePersistentLedgerRuntime } from "./usePersistentLedger";
import {
  addTrade,
  createDeferred,
  createRepository,
  fixedClock,
} from "./usePersistentLedger.testHelpers";

describe("usePersistentLedger clear recovery and lifecycle", () => {
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
