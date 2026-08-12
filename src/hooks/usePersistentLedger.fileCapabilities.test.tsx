// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "../adapters/ledgerFileHandleAdapter";
import type { LedgerFileSessionLease } from "../coordination/ledgerFileSessionCoordinator";
import { bytesToBase64Url } from "../encryption/cryptoEncoding";
import type { LedgerFileV2 } from "../encryption/ledgerFileContract";
import {
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  type LedgerRepository,
} from "../repositories/ledgerRepository";
import { LedgerFileRepository } from "../repositories/ledgerFileRepository";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import type { LedgerClock } from "@/core/shared";
import { usePersistentLedger } from "./usePersistentLedger";

const PASSPHRASE = "correct horse battery staple";
const HOOK_TEST_LEASE: LedgerFileSessionLease = {
  sessionId: "hook-file-capabilities",
  runExclusiveWrite: (operation) => operation(),
  release: async () => undefined,
};

const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-28T12:00:00.000Z"),
};

afterEach(cleanup);

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

class ControlledLedgerHandle implements LedgerFileHandle {
  bytes = new Uint8Array();
  writeCount = 0;
  mutateAfterClose: ((serialized: string) => string) | null = null;
  private failReadAfterClose = false;
  private failNextRead = false;
  private readFailureObserved: Deferred<void> | null = null;
  private closeStarted: Deferred<void> | null = null;
  private closeRelease: Deferred<void> | null = null;

  constructor(readonly name = "hook-ledger.lftl") {}

  async getFile() {
    if (this.failNextRead) {
      this.failNextRead = false;
      this.readFailureObserved?.resolve();
      this.readFailureObserved = null;
      throw new Error("readback failed");
    }
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  async createWritable(): Promise<LedgerFileWritable> {
    let pending: Uint8Array | null = null;
    return {
      write: async (serialized) => {
        this.writeCount += 1;
        pending = new TextEncoder().encode(serialized);
      },
      close: async () => {
        const closeStarted = this.closeStarted;
        const closeRelease = this.closeRelease;
        this.closeStarted = null;
        this.closeRelease = null;
        closeStarted?.resolve();
        if (closeRelease) {
          await closeRelease.promise;
        }
        if (!pending) return;
        const serialized = new TextDecoder().decode(pending);
        const published = this.mutateAfterClose
          ? this.mutateAfterClose(serialized)
          : serialized;
        this.mutateAfterClose = null;
        this.bytes = new TextEncoder().encode(published);
        if (this.failReadAfterClose) {
          this.failReadAfterClose = false;
          this.failNextRead = true;
        }
      },
      abort: async () => {
        pending = null;
      },
    };
  }

  async isSameEntry(other: LedgerFileHandle): Promise<boolean> {
    return other === this;
  }

  pauseNextClose(): {
    started: Promise<void>;
    release: () => void;
  } {
    const closeStarted = createDeferred<void>();
    const closeRelease = createDeferred<void>();
    this.closeStarted = closeStarted;
    this.closeRelease = closeRelease;
    return {
      started: closeStarted.promise,
      release: () => closeRelease.resolve(),
    };
  }

  failNextReadbackAfterClose(): Promise<void> {
    const observed = createDeferred<void>();
    this.failReadAfterClose = true;
    this.readFailureObserved = observed;
    return observed.promise;
  }
}

class GatedHookSessionLease implements LedgerFileSessionLease {
  readonly sessionId = "hook-latest-save";
  operationCount = 0;
  private writeTail: Promise<void> = Promise.resolve();
  private nextGate:
    | {
        started: Deferred<void>;
        release: Deferred<void>;
      }
    | null = null;

  gateNextOperation(): {
    started: Promise<void>;
    release(): void;
  } {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    this.nextGate = { started, release };
    return {
      started: started.promise,
      release: () => release.resolve(),
    };
  }

  runExclusiveWrite<T>(operation: () => Promise<T>): Promise<T> {
    this.operationCount += 1;
    const result = this.writeTail.then(async () => {
      const gate = this.nextGate;
      if (gate) {
        this.nextGate = null;
        gate.started.resolve();
        await gate.release.promise;
      }
      return operation();
    });
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async release(): Promise<void> {
    await this.writeTail;
  }
}

function replaceLedgerFileSalt(serialized: string): string {
  const file = JSON.parse(serialized) as LedgerFileV2;
  return JSON.stringify({
    ...file,
    crypto: {
      ...file.crypto,
      kdf: {
        ...file.crypto.kdf,
        saltBase64Url: bytesToBase64Url(new Uint8Array(16).fill(7)),
      },
    },
  });
}

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
    const file = JSON.parse(
      new TextDecoder().decode(handle.bytes),
    ) as LedgerFileV2;
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
    const file = JSON.parse(
      new TextDecoder().decode(handle.bytes),
    ) as LedgerFileV2;
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
        result.current.clearLedger("清空当前C账本"),
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
        result.current.clearLedger("清空当前C账本"),
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
        result.current.clearLedger("清空当前C账本"),
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
        result.current.clearLedger("清空当前C账本"),
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
    const serializedA = new TextDecoder().decode(handle.bytes);
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
    expect(new TextDecoder().decode(handle.bytes)).toBe(serializedA);
    await expect(repository.load()).resolves.toEqual(ledgerA);
  });

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
    const disk302 = new TextDecoder().decode(handle.bytes);
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
    expect(new TextDecoder().decode(handle.bytes)).toBe(disk302);

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
    expect(new TextDecoder().decode(handle.bytes)).toBe(disk302);
    let retried = true;
    await act(async () => {
      retried = await result.current.retryPersistence();
    });
    expect(retried).toBe(false);
    expect(handle.writeCount).toBe(writesAfterExternal);
    expect(new TextDecoder().decode(handle.bytes)).toBe(disk302);

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
    expect(new TextDecoder().decode(handle.bytes)).toBe(disk302);
    await expect(externalRepository.load()).resolves.toEqual(
      ledger302,
    );
  });
});
