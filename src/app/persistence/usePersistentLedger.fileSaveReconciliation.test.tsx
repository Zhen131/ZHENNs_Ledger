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
import {
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  type LedgerRepository,
} from "@/platform/persistence";
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
  replaceLedgerFileSalt,
} from "./usePersistentLedger.fileCapabilities.testHelpers";

describe("usePersistentLedger file session capabilities", () => {
  it("keeps a C clear unconfirmed after readback failure and reconciles the same intent on retry", async () => {
    const handle = new ControlledLedgerHandle();
    const original = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "uncertain-clear",
          "buy",
          "BTC",
          "1",
        ),
      ],
    };
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      original,
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-uncertain-clear")
          .mockReturnValueOnce("revision-before-clear")
          .mockReturnValueOnce("revision-clear-intent"),
        now: vi
          .fn<() => Date>()
          .mockReturnValueOnce(
            new Date("2026-07-28T10:00:00.000Z"),
          )
          .mockReturnValueOnce(
            new Date("2026-07-28T10:01:00.000Z"),
          ),
        sessionLease: HOOK_TEST_LEASE,
      },
    );
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver: repository,
      createSessionId: () => "hook-uncertain-clear",
    });
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        fixedClock,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    handle.failNextReadbackAfterClose();

    await act(async () => {
      await expect(
        result.current.clearLedger("清空当前账本"),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED",
      });
    });
    expect(result.current.ledgerData).toEqual(original);
    expect(result.current.persistenceError).toContain(
      "结果未确认",
    );
    const writesAfterUncertainClear = handle.writeCount;

    await act(async () => {
      await expect(
        result.current.clearLedger("清空当前账本"),
      ).resolves.toEqual({ ok: true });
    });
    expect(handle.writeCount).toBe(writesAfterUncertainClear);
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
  });

  it("preserves the failed save retry when C clear is blocked by that pending save intent", async () => {
    const handle = new ControlledLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-save-before-blocked-clear")
          .mockReturnValueOnce("revision-initial")
          .mockReturnValueOnce("revision-pending-save"),
        now: vi
          .fn<() => Date>()
          .mockReturnValueOnce(
            new Date("2026-07-28T10:00:00.000Z"),
          )
          .mockReturnValueOnce(
            new Date("2026-07-28T10:01:00.000Z"),
          ),
        sessionLease: HOOK_TEST_LEASE,
      },
    );
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver: repository,
      createSessionId: () => "hook-pending-save-clear",
    });
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        fixedClock,
        session.capabilities,
        session,
      ),
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
            "pending-save-before-clear",
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
      expect(result.current.canRetryPersistence).toBe(true);
    });
    const failedSaveMessage = result.current.persistenceError;
    expect(failedSaveMessage).not.toBeNull();
    const writesAfterFailedSave = handle.writeCount;

    await act(async () => {
      await expect(
        result.current.clearLedger("清空当前账本"),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED",
      });
    });
    expect(handle.writeCount).toBe(writesAfterFailedSave);
    expect(result.current.canRetryPersistence).toBe(true);
    expect(result.current.persistenceError).toBe(
      failedSaveMessage,
    );
    expect(result.current.ledgerData.trades).toHaveLength(1);

    let retried = false;
    await act(async () => {
      retried = await result.current.retryPersistence();
    });
    expect(retried).toBe(true);
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.canRetryPersistence).toBe(false);
    });
    expect(handle.writeCount).toBe(writesAfterFailedSave);
    await expect(repository.load()).resolves.toEqual(
      result.current.ledgerData,
    );
  });

  it("keeps C hydration-error clear closed before authorization or writes", async () => {
    const repository: LedgerRepository = {
      load: vi.fn(async () => {
        throw new Error("damaged C");
      }),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const authorizeReadyClear = vi.fn(() => null);
    const clearReadyLedger = vi.fn(async () => undefined);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver: {
        authorizeReadyClear,
        clearReadyLedger,
      },
      createSessionId: () => "damaged-c",
    });
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        fixedClock,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("error");
    });

    await act(async () => {
      await expect(
        result.current.clearLedger("清空当前账本"),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED",
      });
    });
    expect(authorizeReadyClear).not.toHaveBeenCalled();
    expect(clearReadyLedger).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
  });

  it("keeps a real ledger-file salt-drift save dirty and never publishes saved", async () => {
    const handle = new ControlledLedgerHandle();
    const generateId = vi
      .fn<() => string>()
      .mockReturnValueOnce("file-hook")
      .mockReturnValueOnce("revision-initial")
      .mockReturnValueOnce("revision-mutated");
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-07-28T10:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-07-28T10:01:00.000Z"));
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      { generateId, now, sessionLease: HOOK_TEST_LEASE },
    );
    const close = handle.pauseNextClose();
    handle.mutateAfterClose = replaceLedgerFileSalt;
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
    act(() => {
      expect(
        result.current.applyLedgerAction({
          type: "trade/add",
          trade: createSimpleTrade(
            "hook-salt-drift",
            "buy",
            "BTC",
            "1",
          ),
        }),
      ).toBe("applied");
    });
    await act(async () => {
      await close.started;
    });

    expect(result.current.persistenceStatus).toBe("saving");
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.isDirty).toBe(true);

    act(() => {
      close.release();
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });

    expect(result.current.persistenceError).toMatch(/尚未保存/);
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.isDirty).toBe(true);
    expect(
      result.current.ledgerData.trades.map((trade) => trade.id),
    ).toEqual(["hook-salt-drift"]);
    expect(handle.writeCount).toBe(2);
  });

  it("keeps A dirty while obsolete B waits for the file lock and persists only the latest A", async () => {
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
          .mockReturnValueOnce("file-hook-latest")
          .mockReturnValueOnce("revision-hook-a"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
        sessionLease,
      },
    );
    const serializedA = ledgerFileBytesToTestString(handle.bytes);
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
    const gate = sessionLease.gateNextOperation();

    act(() => {
      expect(
        result.current.applyLedgerAction({
          type: "trade/add",
          trade: createSimpleTrade(
            "obsolete-b",
            "buy",
            "BTC",
            "1",
          ),
        }),
      ).toBe("applied");
    });
    await gate.started;
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

    expect(result.current.ledgerData).toEqual(ledgerA);
    expect(result.current.mutationVersion).toBe(2);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.persistenceStatus).toBe("saving");
    expect(result.current.isDirty).toBe(true);
    expect(handle.writeCount).toBe(1);

    act(() => {
      gate.release();
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.persistedVersion).toBe(2);
      expect(result.current.isDirty).toBe(false);
    });

    expect(handle.writeCount).toBe(1);
    expect(ledgerFileBytesToTestString(handle.bytes)).toBe(serializedA);
    await expect(repository.load()).resolves.toEqual(ledgerA);
  });
});
