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
  readLedgerFileForTest,
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
  it("rejects clear and B import before invoking a file repository", async () => {
    const repository: LedgerRepository = {
      load: vi.fn(async () => createInitialLedgerData()),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
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

    await act(async () => {
      await expect(result.current.clearLedger()).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED",
      });
      await expect(
        result.current.replaceLedgerFromBackup(createInitialLedgerData()),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_NOT_ALLOWED",
      });
    });

    expect(repository.clear).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("clears a ready C only through its session-bound port and keeps B import closed", async () => {
    const handle = new ControlledLedgerHandle();
    const original = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "ready-clear",
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
          .mockReturnValueOnce("file-ready-clear")
          .mockReturnValueOnce("revision-before-clear")
          .mockReturnValueOnce("revision-after-clear"),
        now: vi
          .fn<() => Date>()
          .mockReturnValueOnce(new Date("2026-07-28T10:00:00.000Z"))
          .mockReturnValueOnce(new Date("2026-07-28T10:01:00.000Z")),
        sessionLease: HOOK_TEST_LEASE,
      },
    );
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver: repository,
      createSessionId: () => "hook-ready-clear",
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

    await act(async () => {
      await expect(result.current.clearLedger()).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED",
      });
      await expect(
        result.current.clearLedger("任意非空文本"),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED",
      });
      expect(handle.writeCount).toBe(1);
      await expect(
        result.current.clearLedger("清空当前C账本"),
      ).resolves.toEqual({ ok: true });
    });

    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
    expect(handle.writeCount).toBe(2);
    const file = readLedgerFileForTest(handle.bytes);
    expect(file.current.revisionId).toBe(
      "revision-after-clear",
    );
    expect(file.previous?.revisionId).toBe(
      "revision-before-clear",
    );
    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(original),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_NOT_ALLOWED",
      });
    });
  });

  it("queues C clear after an admitted save and preserves that saved current as previous", async () => {
    const handle = new ControlledLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-clear-queue")
          .mockReturnValueOnce("revision-initial")
          .mockReturnValueOnce("revision-saved")
          .mockReturnValueOnce("revision-cleared"),
        now: vi
          .fn<() => Date>()
          .mockReturnValueOnce(new Date("2026-07-28T10:00:00.000Z"))
          .mockReturnValueOnce(new Date("2026-07-28T10:01:00.000Z"))
          .mockReturnValueOnce(new Date("2026-07-28T10:02:00.000Z")),
        sessionLease: HOOK_TEST_LEASE,
      },
    );
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver: repository,
      createSessionId: () => "hook-clear-queue",
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
    const close = handle.pauseNextClose();
    act(() => {
      expect(
        result.current.applyLedgerAction({
          type: "trade/add",
          trade: createSimpleTrade(
            "save-before-clear",
            "buy",
            "BTC",
            "1",
          ),
        }),
      ).toBe("applied");
    });
    await close.started;
    let clearResult:
      | Awaited<ReturnType<typeof result.current.clearLedger>>
      | undefined;
    const clearPromise = act(async () => {
      clearResult = await result.current.clearLedger(
        "清空当前C账本",
      );
    });
    expect(handle.writeCount).toBe(2);
    act(() => close.release());
    await clearPromise;

    expect(clearResult).toEqual({ ok: true });
    const file = readLedgerFileForTest(handle.bytes);
    expect(file.current.revisionId).toBe("revision-cleared");
    expect(file.previous?.revisionId).toBe("revision-saved");
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
  });

  it("drains an admitted C clear before immediate lock releases the session", async () => {
    const handle = new ControlledLedgerHandle();
    const lease = new GatedHookSessionLease();
    const releaseLease = vi.spyOn(lease, "release");
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        ...createInitialLedgerData(),
        trades: [
          createSimpleTrade(
            "clear-before-lock",
            "buy",
            "BTC",
            "1",
          ),
        ],
      },
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-clear-before-lock")
          .mockReturnValueOnce("revision-before-lock")
          .mockReturnValueOnce("revision-cleared-before-lock"),
        now: vi
          .fn<() => Date>()
          .mockReturnValueOnce(
            new Date("2026-07-28T10:00:00.000Z"),
          )
          .mockReturnValueOnce(
            new Date("2026-07-28T10:01:00.000Z"),
          ),
        sessionLease: lease,
      },
    );
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver: repository,
      release: () => lease.release(),
      createSessionId: () => "hook-clear-before-lock",
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
    const operationGate = lease.gateNextOperation();
    let clearPromise!: ReturnType<typeof result.current.clearLedger>;
    act(() => {
      clearPromise = result.current.clearLedger(
        "清空当前C账本",
      );
    });
    await operationGate.started;
    const request = session.beginQuiesce("immediate-lock");
    const tokenPromise =
      result.current.drainForSessionQuiesce(request);
    let tokenSettled = false;
    void tokenPromise.then(
      () => {
        tokenSettled = true;
      },
      () => {
        tokenSettled = true;
      },
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tokenSettled).toBe(false);
    expect(releaseLease).not.toHaveBeenCalled();

    act(() => {
      operationGate.release();
    });
    await expect(clearPromise).resolves.toEqual({ ok: true });
    const token = await tokenPromise;
    await expect(
      session.lockAfterQuiesce(token),
    ).resolves.toBeUndefined();
    expect(releaseLease).toHaveBeenCalledOnce();
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
    expect(() => session.repository.load()).toThrow();
  });
});
