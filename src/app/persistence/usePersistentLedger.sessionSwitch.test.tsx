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
  claimLedgerSessionPersistencePort,
  createLedgerSession,
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
});
