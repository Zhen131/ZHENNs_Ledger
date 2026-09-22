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
import { LedgerFileHandleAdapter } from "@/platform/files";
import { LedgerFileRepository } from "@/platform/files";
import { createInitialLedgerData } from "@/core/state";
import {
  createUsdtSimpleTrade as createSimpleTrade,
  ledgerFileBytesToTestString,
} from "@/test-support";
import { usePersistentLedger } from "./usePersistentLedger";
import {
  ControlledLedgerHandle,
  GatedHookSessionLease,
  HOOK_TEST_LEASE,
  PASSPHRASE,
  fixedClock,
} from "./usePersistentLedger.fileCapabilities.testHelpers";

describe("usePersistentLedger file session capabilities", () => {
  it("keeps A dirty until a started B write is followed by the latest corrective A write", async () => {
    const handle = new ControlledLedgerHandle();
    const sessionLease = new GatedHookSessionLease();
    const ledgerA = createInitialLedgerData();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerA,
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-hook-corrective")
          .mockReturnValueOnce("revision-hook-a")
          .mockReturnValueOnce("revision-hook-b")
          .mockReturnValueOnce("revision-hook-a-corrective"),
        now: vi
          .fn<() => Date>()
          .mockReturnValueOnce(new Date("2026-07-28T10:00:00.000Z"))
          .mockReturnValueOnce(new Date("2026-07-28T10:01:00.000Z"))
          .mockReturnValueOnce(new Date("2026-07-28T10:02:00.000Z")),
        sessionLease,
      },
    );
    const { result } = renderHook(() =>
      usePersistentLedger(repository, fixedClock, {
        canClearReadyLedger: false,
        canClearHydrationError: false,
        canImportBackup: false,
      }),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const close = handle.pauseNextClose();

    act(() => {
      expect(
        result.current.applyLedgerAction({
          type: "trade/add",
          trade: createSimpleTrade(
            "started-b",
            "buy",
            "BTC",
            "1",
          ),
        }),
      ).toBe("applied");
    });
    await close.started;
    act(() => {
      expect(
        result.current.applyLedgerMutation(() =>
          structuredClone(ledgerA),
        ),
      ).toBe("applied");
    });
    await waitFor(() => {
      expect(sessionLease.operationCount).toBe(3);
    });

    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.persistenceStatus).toBe("saving");
    expect(result.current.isDirty).toBe(true);
    act(() => {
      close.release();
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.persistedVersion).toBe(2);
    });

    expect(handle.writeCount).toBe(3);
    await expect(repository.load()).resolves.toEqual(ledgerA);
    expect(result.current.ledgerData).toEqual(ledgerA);
    expect(result.current.isDirty).toBe(false);
  });

  it("does not clear the pending sentinel or report A saved when obsolete B closes but its readback fails", async () => {
    const handle = new ControlledLedgerHandle();
    const sessionLease = new GatedHookSessionLease();
    const ledgerA = createInitialLedgerData();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerA,
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-hook-readback-race")
          .mockReturnValueOnce("revision-hook-a")
          .mockReturnValueOnce("revision-hook-b")
          .mockReturnValueOnce("revision-hook-a-corrective"),
        now: vi
          .fn<() => Date>()
          .mockReturnValueOnce(new Date("2026-07-28T10:00:00.000Z"))
          .mockReturnValueOnce(new Date("2026-07-28T10:01:00.000Z"))
          .mockReturnValueOnce(new Date("2026-07-28T10:02:00.000Z")),
        sessionLease,
      },
    );
    const { result } = renderHook(() =>
      usePersistentLedger(repository, fixedClock, {
        canClearReadyLedger: false,
        canClearHydrationError: false,
        canImportBackup: false,
      }),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const close = handle.pauseNextClose();

    act(() => {
      expect(
        result.current.applyLedgerAction({
          type: "trade/add",
          trade: createSimpleTrade(
            "readback-race-b",
            "buy",
            "BTC",
            "1",
          ),
        }),
      ).toBe("applied");
    });
    await close.started;
    const correctiveGate = sessionLease.gateNextOperation();
    const readFailureObserved =
      handle.failNextReadbackAfterClose();
    await act(async () => {
      expect(
        result.current.applyLedgerMutation(() =>
          structuredClone(ledgerA),
        ),
      ).toBe("applied");
      close.release();
      await readFailureObserved;
      await Promise.resolve();
    });
    await correctiveGate.started;

    expect(result.current.ledgerData).toEqual(ledgerA);
    expect(result.current.mutationVersion).toBe(2);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.persistenceStatus).toBe("saving");
    expect(result.current.isDirty).toBe(true);
    expect(handle.writeCount).toBe(2);

    act(() => {
      correctiveGate.release();
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.persistedVersion).toBe(2);
      expect(result.current.isDirty).toBe(false);
    });

    expect(handle.writeCount).toBe(3);
    await expect(repository.load()).resolves.toEqual(ledgerA);
    expect(result.current.ledgerData).toEqual(ledgerA);
  });

  it("requires reconciliation when B readback fails before the user later returns to persisted A", async () => {
    const handle = new ControlledLedgerHandle();
    const sessionLease = new GatedHookSessionLease();
    const ledgerA = createInitialLedgerData();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerA,
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-hook-reconcile-required")
          .mockReturnValueOnce("revision-hook-a")
          .mockReturnValueOnce("revision-hook-b")
          .mockReturnValueOnce("revision-hook-a-corrective"),
        now: vi
          .fn<() => Date>()
          .mockReturnValueOnce(new Date("2026-07-28T10:00:00.000Z"))
          .mockReturnValueOnce(new Date("2026-07-28T10:01:00.000Z"))
          .mockReturnValueOnce(new Date("2026-07-28T10:02:00.000Z")),
        sessionLease,
      },
    );
    const { result } = renderHook(() =>
      usePersistentLedger(repository, fixedClock, {
        canClearReadyLedger: false,
        canClearHydrationError: false,
        canImportBackup: false,
      }),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const readFailureObserved =
      handle.failNextReadbackAfterClose();

    act(() => {
      expect(
        result.current.applyLedgerAction({
          type: "trade/add",
          trade: createSimpleTrade(
            "completed-failure-b",
            "buy",
            "BTC",
            "1",
          ),
        }),
      ).toBe("applied");
    });
    await readFailureObserved;
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.isDirty).toBe(true);
    expect(handle.writeCount).toBe(2);

    const correctiveGate = sessionLease.gateNextOperation();
    act(() => {
      expect(
        result.current.applyLedgerMutation(() =>
          structuredClone(ledgerA),
        ),
      ).toBe("applied");
    });
    await correctiveGate.started;

    expect(result.current.ledgerData).toEqual(ledgerA);
    expect(result.current.mutationVersion).toBe(2);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.persistenceStatus).toBe("saving");
    expect(result.current.isDirty).toBe(true);
    expect(handle.writeCount).toBe(2);

    act(() => {
      correctiveGate.release();
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.persistedVersion).toBe(2);
      expect(result.current.isDirty).toBe(false);
    });

    expect(handle.writeCount).toBe(3);
    await expect(repository.load()).resolves.toEqual(ledgerA);
    expect(result.current.ledgerData).toEqual(ledgerA);
  });

  it("keeps dirty state, disables ordinary retry, and preserves external R302 when a stale page tries to save", async () => {
    const handle = new ControlledLedgerHandle();
    const ledger301 = createInitialLedgerData();
    const staleRepository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger301,
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-hook-external")
          .mockReturnValueOnce("revision-301"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
        sessionLease: HOOK_TEST_LEASE,
      },
    );
    const { result } = renderHook(() =>
      usePersistentLedger(staleRepository, fixedClock, {
        canClearReadyLedger: false,
        canClearHydrationError: false,
        canImportBackup: false,
      }),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const staleSave = vi.spyOn(staleRepository, "save");

    const externalRepository = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("revision-302"),
        now: () => new Date("2026-07-28T10:01:00.000Z"),
        sessionLease: HOOK_TEST_LEASE,
      },
    );
    const ledger302 = {
      ...ledger301,
      trades: [
        createSimpleTrade(
          "external-r302-eth",
          "buy",
          "ETH",
          "2",
        ),
      ],
    };
    await externalRepository.save(ledger302);
    const disk302 = ledgerFileBytesToTestString(handle.bytes);
    const writesAfterExternal = handle.writeCount;

    act(() => {
      expect(
        result.current.applyLedgerMutation((current) =>
          structuredClone(current),
        ),
      ).toBe("applied");
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });

    expect(result.current.ledgerData).toEqual(ledger301);
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.canRetryPersistence).toBe(false);
    expect(staleSave).toHaveBeenCalledTimes(1);
    expect(handle.writeCount).toBe(writesAfterExternal);
    expect(ledgerFileBytesToTestString(handle.bytes)).toBe(disk302);

    act(() => {
      expect(
        result.current.applyLedgerAction({
          type: "trade/add",
          trade: createSimpleTrade(
            "stale-page-ada",
            "buy",
            "ADA",
            "3",
          ),
        }),
      ).toBe("applied");
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });

    expect(result.current.persistenceError).toMatch(
      /本页面之外发生变化/,
    );
    expect(result.current.mutationVersion).toBe(2);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.canRetryPersistence).toBe(false);
    expect(staleSave).toHaveBeenCalledTimes(2);
    expect(handle.writeCount).toBe(writesAfterExternal);
    expect(ledgerFileBytesToTestString(handle.bytes)).toBe(disk302);
    let retried = true;
    await act(async () => {
      retried = await result.current.retryPersistence();
    });
    expect(retried).toBe(false);
    expect(handle.writeCount).toBe(writesAfterExternal);
    expect(ledgerFileBytesToTestString(handle.bytes)).toBe(disk302);

    act(() => {
      expect(
        result.current.applyLedgerMutation(() =>
          structuredClone(ledger301),
        ),
      ).toBe("applied");
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });

    expect(result.current.ledgerData).toEqual(ledger301);
    expect(result.current.mutationVersion).toBe(3);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.canRetryPersistence).toBe(false);
    expect(staleSave).toHaveBeenCalledTimes(3);
    expect(handle.writeCount).toBe(writesAfterExternal);
    expect(ledgerFileBytesToTestString(handle.bytes)).toBe(disk302);
    await expect(externalRepository.load()).resolves.toEqual(
      ledger302,
    );
  });
});
