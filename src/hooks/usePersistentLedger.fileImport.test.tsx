// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Suspense, startTransition, useState } from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "../adapters/ledgerFileHandleAdapter";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  preflightBackupJson,
  type BackupImportPreflightResult,
} from "../backup/backupImportPreflight";
import type { LedgerFileSessionLease } from "../coordination/ledgerFileSessionCoordinator";
import { normalizeLedgerDataForRuntime } from "../policies/ledgerFactPolicy";
import {
  claimLedgerSessionPersistencePort,
  createLedgerSession,
  LEDGER_FILE_READY_IMPORT_CAPABILITIES,
  type LedgerBackupImportEvidence,
  type LedgerSession,
} from "../repositories/ledgerRepository";
import { LedgerFileRepository } from "../repositories/ledgerFileRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import type { LedgerClock } from "../utils/ledgerDate";
import { usePersistentLedger } from "./usePersistentLedger";

const PASSPHRASE = "correct horse battery staple";
const FIXED_CLOCK: LedgerClock = {
  now: () => new Date("2026-07-31T12:00:00.000Z"),
};

afterEach(cleanup);

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class ImportLedgerHandle implements LedgerFileHandle {
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  createWritableCount = 0;
  writeCount = 0;
  closeCount = 0;
  failNextRead = false;
  private closeGate:
    | {
        started: Deferred<void>;
        release: Deferred<void>;
      }
    | null = null;
  private readAfterCloseGate:
    | {
        armed: boolean;
        started: Deferred<void>;
        release: Deferred<void>;
      }
    | null = null;

  constructor(readonly name = "hook-import.lftl") {}

  async getFile() {
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error("read failed");
    }
    const readGate = this.readAfterCloseGate;
    if (readGate?.armed) {
      this.readAfterCloseGate = null;
      readGate.started.resolve();
      await readGate.release.promise;
    }
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  async createWritable(): Promise<LedgerFileWritable> {
    this.createWritableCount += 1;
    let pending: Uint8Array<ArrayBuffer> | null = null;
    return {
      write: async (serialized) => {
        this.writeCount += 1;
        const encoded = new TextEncoder().encode(serialized);
        pending = new Uint8Array(new ArrayBuffer(encoded.byteLength));
        pending.set(encoded);
      },
      close: async () => {
        this.closeCount += 1;
        const gate = this.closeGate;
        this.closeGate = null;
        gate?.started.resolve();
        if (gate) {
          await gate.release.promise;
        }
        if (pending) {
          this.bytes = pending;
        }
        if (this.readAfterCloseGate) {
          this.readAfterCloseGate.armed = true;
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
    release(): void;
  } {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    this.closeGate = { started, release };
    return {
      started: started.promise,
      release: () => release.resolve(),
    };
  }

  pauseNextReadAfterClose(): {
    started: Promise<void>;
    release(): void;
  } {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    this.readAfterCloseGate = {
      armed: false,
      started,
      release,
    };
    return {
      started: started.promise,
      release: () => release.resolve(),
    };
  }

  text(): string {
    return new TextDecoder().decode(this.bytes);
  }
}

function createLease(sessionId: string): LedgerFileSessionLease {
  return {
    sessionId,
    runExclusiveWrite: (operation) => operation(),
    release: async () => undefined,
  };
}

function createIdGenerator(ids: string[]) {
  return vi.fn(() => {
    const id = ids.shift();
    if (!id) {
      throw new Error("test ID sequence exhausted");
    }
    return id;
  });
}

function readFixture(name: string): string {
  return readFileSync(
    resolve(process.cwd(), `test-fixtures/w11-b-import/${name}`),
    "utf8",
  );
}

async function readPreflight(
  name: string,
  selectionGeneration = 1,
): Promise<BackupImportPreflightResult> {
  return preflightBackupJson(readFixture(name), {
    todayKey: "2026-07-31",
    selectionGeneration,
    requireHistoricalRawText: true,
  });
}

function evidenceFromPreflight(
  preflight: BackupImportPreflightResult,
): LedgerBackupImportEvidence {
  const confirmation =
    preflight.suspiciousGroupCount === 0
      ? null
      : confirmBackupImportSuspiciousGroups(preflight);
  const evidence = createLedgerBackupImportEvidence(
    preflight,
    confirmation,
  );
  if (!evidence) {
    throw new Error("test preflight requires an active import receipt");
  }
  return evidence;
}

async function createHarness(
  handle = new ImportLedgerHandle(),
): Promise<{
  handle: ImportLedgerHandle;
  repository: LedgerFileRepository;
  session: ReturnType<typeof createLedgerSession>;
}> {
  const repository = await LedgerFileRepository.create(
    new LedgerFileHandleAdapter(),
    handle,
    PASSPHRASE,
    createInitialLedgerData(),
    {
      generateId: createIdGenerator([
        "hook-import-file",
        "hook-import-empty-revision",
        "hook-import-candidate-revision",
      ]),
      now: vi
        .fn<() => Date>()
        .mockReturnValueOnce(new Date("2026-07-31T08:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-07-31T08:01:00.000Z")),
      sessionLease: createLease("hook-import-lease"),
    },
  );
  const session = createLedgerSession({
    storageKind: "ledger-file",
    repository,
    capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
    readyImportDriver: repository,
    createSessionId: () => "hook-import-session",
  });
  return { handle, repository, session };
}

describe("usePersistentLedger ready C import", () => {
  it(
    "publishes the exact verified 300-trade candidate only after the repository readback succeeds",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      expect(preflight.hardErrorCount).toBe(0);
      expect(preflight.suspiciousGroupCount).toBe(0);
      expect(preflight.candidate?.trades).toHaveLength(300);
      if (!preflight.candidate) return;
      const { handle, repository, session } = await createHarness();
      const readbackGate = handle.pauseNextReadAfterClose();
      const { result } = renderHook(() =>
        usePersistentLedger(
          session.repository,
          FIXED_CLOCK,
          session.capabilities,
          session,
        ),
      );
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
      });

      let importResult:
        | Awaited<
            ReturnType<
              typeof result.current.replaceLedgerFromBackup
            >
          >
        | undefined;
      let importPromise!: ReturnType<
        typeof result.current.replaceLedgerFromBackup
      >;
      act(() => {
        importPromise =
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            {
              now: FIXED_CLOCK.now(),
              todayKey: "2026-07-31",
            },
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          );
      });
      await readbackGate.started;
      expect(result.current.ledgerData).toEqual(
        createInitialLedgerData(),
      );
      expect(result.current.persistenceOperation).toBe(
        "importing",
      );
      readbackGate.release();
      await act(async () => {
        importResult = await importPromise;
      });

      expect(importResult).toEqual({ ok: true });
      expect(result.current.ledgerData).toEqual(
        preflight.candidate,
      );
      expect(result.current.ledgerData.trades).toHaveLength(300);
      expect(result.current.persistenceStatus).toBe("saved");
      expect(result.current.isDirty).toBe(false);
      await expect(repository.load()).resolves.toEqual(
        preflight.candidate,
      );
    },
    20_000,
  );

  it("keeps the 147th-trade hard-error fixture outside the ready-import driver with zero C writes", async () => {
    const serialized = readFixture(
      "invalid-trade-147.backup.json",
    );
    const preflight = await readPreflight(
      "invalid-trade-147.backup.json",
    );
    const invalidCandidate = JSON.parse(serialized).ledgerData;
    const { handle, repository, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;
    const closesBeforeImport = handle.closeCount;

    expect(preflight.hardErrorCount).toBeGreaterThan(0);
    expect(preflight.candidate).toBeUndefined();
    expect(
      preflight.retainedDetails.some(
        (detail) =>
          detail.kind === "hard-error" &&
          detail.path === "trades[146].quantity",
      ),
    ).toBe(true);

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          invalidCandidate,
          undefined,
          {
            contentIdentity: preflight.contentIdentity.value,
            candidateIdentity: "invalid-candidate",
            selectionGeneration: preflight.selectionGeneration,
            hardErrorCount: preflight.hardErrorCount,
            suspiciousGroupCount: preflight.suspiciousGroupCount,
            suspiciousGroupIdentity:
              preflight.suspiciousGroupIdentity,
            confirmedSuspiciousGroupIdentity: null,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_INVALID_BACKUP",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(handle.closeCount).toBe(closesBeforeImport);
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("accepts a valid legacy B whose built-in Binance mapping is added by the shared canonical identity", async () => {
    const parsed = JSON.parse(
      readFixture("valid-300.backup.json"),
    );
    delete parsed.ledgerData.assets[0].binanceMapping;
    const preflight = await preflightBackupJson(
      `${JSON.stringify(parsed, null, 2)}\n`,
      {
        todayKey: "2026-07-31",
        selectionGeneration: 2,
        requireHistoricalRawText: true,
      },
    );
    expect(preflight.hardErrorCount).toBe(0);
    if (!preflight.candidate) return;
    const normalized = normalizeLedgerDataForRuntime(
      preflight.candidate,
    );
    const { repository, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidenceFromPreflight(preflight),
          new AbortController().signal,
        ),
      ).resolves.toEqual({ ok: true });
    });

    expect(result.current.ledgerData).toEqual(normalized);
    await expect(repository.load()).resolves.toEqual(normalized);
  });

  it("rejects forged zero-error evidence when a historical trade has no rawText", async () => {
    const parsed = JSON.parse(
      readFixture("valid-300.backup.json"),
    );
    delete parsed.ledgerData.trades[146].rawText;
    const { handle, repository, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          parsed.ledgerData,
          undefined,
          {
            contentIdentity: "forged-content",
            candidateIdentity: "forged-candidate",
            selectionGeneration: 1,
            hardErrorCount: 0,
            suspiciousGroupCount: 0,
            suspiciousGroupIdentity: "forged-groups",
            confirmedSuspiciousGroupIdentity: null,
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_INVALID_BACKUP",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("rejects an already-cancelled selection before ready-import authorization or writable creation", async () => {
    const preflight = await readPreflight(
      "valid-300.backup.json",
    );
    if (!preflight.candidate) return;
    const { handle, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;
    const controller = new AbortController();
    controller.abort();

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidenceFromPreflight(preflight),
          controller.signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_CANCELLED",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(result.current.ledgerData).toEqual(
      createInitialLedgerData(),
    );
  });

  it(
    "aborts and restores an in-flight candidate before quiesce drain can issue its token",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      if (!preflight.candidate) return;
      const { handle, repository, session } = await createHarness();
      const baseline = handle.text();
      const closeGate = handle.pauseNextClose();
      const { result } = renderHook(() =>
        usePersistentLedger(
          session.repository,
          FIXED_CLOCK,
          session.capabilities,
          session,
        ),
      );
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
      });

      let importPromise!: ReturnType<
        typeof result.current.replaceLedgerFromBackup
      >;
      act(() => {
        importPromise =
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            undefined,
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          );
      });
      await closeGate.started;

      let drainPromise!: ReturnType<
        typeof result.current.drainForSessionQuiesce
      >;
      act(() => {
        const request = session.beginQuiesce("immediate-lock");
        drainPromise =
          result.current.drainForSessionQuiesce(request);
      });
      let drainSettled = false;
      void drainPromise.then(() => {
        drainSettled = true;
      });
      await Promise.resolve();
      expect(drainSettled).toBe(false);
      closeGate.release();

      await act(async () => {
        await expect(importPromise).resolves.toEqual({
          ok: false,
          code: "LEDGER_IMPORT_BASE_RESTORED",
        });
      });
      await expect(drainPromise).resolves.toMatchObject({
        sessionId: session.sessionId,
        generation: session.generation,
      });
      expect(handle.text()).toBe(baseline);
      await expect(repository.load()).resolves.toEqual(
        createInitialLedgerData(),
      );
      expect(result.current.ledgerData).toEqual(
        createInitialLedgerData(),
      );
      expect(result.current.persistenceError).toBe(
        "导入未完成；已复读确认 C 恢复为导入前的完整版本，页面没有替换。",
      );
    },
    20_000,
  );

  it(
    "restores the old C when the Hook unmounts after the candidate close starts",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      if (!preflight.candidate) return;
      const { handle, repository, session } = await createHarness();
      const baseline = handle.text();
      const closeGate = handle.pauseNextClose();
      const { result, unmount } = renderHook(() =>
        usePersistentLedger(
          session.repository,
          FIXED_CLOCK,
          session.capabilities,
          session,
        ),
      );
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
      });

      let importPromise!: ReturnType<
        typeof result.current.replaceLedgerFromBackup
      >;
      act(() => {
        importPromise =
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            undefined,
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          );
      });
      await closeGate.started;
      unmount();
      closeGate.release();

      await expect(importPromise).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_BASE_RESTORED",
      });
      expect(handle.text()).toBe(baseline);
      await expect(repository.load()).resolves.toEqual(
        createInitialLedgerData(),
      );
    },
    20_000,
  );

  it(
    "aborts and restores the old C before switching to another ledger-file session",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      if (!preflight.candidate) return;
      const original = await createHarness();
      const replacement = await createHarness(
        new ImportLedgerHandle("hook-import-replacement.lftl"),
      );
      const originalBaseline = original.handle.text();
      const replacementWrites =
        replacement.handle.writeCount;
      const replacementCloses =
        replacement.handle.closeCount;
      const closeGate = original.handle.pauseNextClose();
      const { result, rerender } = renderHook(
        ({ session }) =>
          usePersistentLedger(
            session.repository,
            FIXED_CLOCK,
            session.capabilities,
            session,
          ),
        { initialProps: { session: original.session } },
      );
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
      });

      let importPromise!: ReturnType<
        typeof result.current.replaceLedgerFromBackup
      >;
      act(() => {
        importPromise =
          result.current.replaceLedgerFromBackup(
            preflight.candidate,
            undefined,
            evidenceFromPreflight(preflight),
            new AbortController().signal,
          );
      });
      await closeGate.started;

      rerender({ session: replacement.session });
      closeGate.release();

      await act(async () => {
        await expect(importPromise).resolves.toEqual({
          ok: false,
          code: "LEDGER_IMPORT_BASE_RESTORED",
        });
      });
      await waitFor(() => {
        expect(result.current.hydrationStatus).toBe("ready");
        expect(result.current.repositorySwitchBlocked).toBe(false);
      });
      expect(original.handle.text()).toBe(originalBaseline);
      await expect(original.repository.load()).resolves.toEqual(
        createInitialLedgerData(),
      );
      expect(replacement.handle.writeCount).toBe(
        replacementWrites,
      );
      expect(replacement.handle.closeCount).toBe(
        replacementCloses,
      );
      expect(result.current.ledgerData).toEqual(
        createInitialLedgerData(),
      );
    },
    20_000,
  );

  it(
    "does not claim the proposed session or cancel the current import when a concurrent render is abandoned before commit",
    async () => {
      const preflight = await readPreflight(
        "valid-300.backup.json",
      );
      if (!preflight.candidate) return;
      const original = await createHarness();
      const replacement = await createHarness(
        new ImportLedgerHandle("abandoned-render.lftl"),
      );
      const closeGate = original.handle.pauseNextClose();
      const neverCommit = new Promise<void>(() => undefined);
      let committedState: ReturnType<typeof usePersistentLedger> | null = null;
      let requestSessionSwitch: (() => void) | null = null;
      let abandonedRenderCount = 0;

      function HookProbe({ session }: { session: LedgerSession }) {
        const state = usePersistentLedger(
          session.repository,
          FIXED_CLOCK,
          session.capabilities,
          session,
        );
        if (session === replacement.session) {
          abandonedRenderCount += 1;
          throw neverCommit;
        }
        committedState = state;
        return null;
      }

      function ConcurrentHarness() {
        const [session, setSession] = useState(original.session);
        requestSessionSwitch = () => setSession(replacement.session);
        return (
          <Suspense fallback={null}>
            <HookProbe session={session} />
          </Suspense>
        );
      }

      const view = render(<ConcurrentHarness />);
      await waitFor(() => {
        expect(committedState?.hydrationStatus).toBe("ready");
      });
      const readCommittedState = () => {
        if (!committedState) {
          throw new Error("committed Hook state is unavailable");
        }
        return committedState;
      };

      let importPromise!: ReturnType<
        ReturnType<typeof usePersistentLedger>["replaceLedgerFromBackup"]
      >;
      act(() => {
        importPromise = readCommittedState().replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidenceFromPreflight(preflight),
          new AbortController().signal,
        );
      });
      await closeGate.started;

      act(() => {
        startTransition(() => requestSessionSwitch?.());
      });
      await waitFor(() => {
        expect(abandonedRenderCount).toBeGreaterThan(0);
      });

      expect(() =>
        claimLedgerSessionPersistencePort(
          replacement.session,
          {},
        ),
      ).not.toThrow();
      closeGate.release();

      await act(async () => {
        await expect(importPromise).resolves.toEqual({ ok: true });
      });
      expect(readCommittedState().ledgerData.trades).toHaveLength(300);
      view.unmount();
    },
    20_000,
  );

  it("reports a pre-write external C change without claiming recovery or creating a writable", async () => {
    const preflight = await readPreflight(
      "valid-300.backup.json",
    );
    if (!preflight.candidate) return;
    const { handle, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;
    const writablesBeforeImport = handle.createWritableCount;
    const externallyChanged = new TextEncoder().encode(
      `${handle.text()}\n`,
    );
    const exactExternalBytes = new Uint8Array(
      new ArrayBuffer(externallyChanged.byteLength),
    );
    exactExternalBytes.set(externallyChanged);
    handle.bytes = exactExternalBytes;

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidenceFromPreflight(preflight),
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_SOURCE_CHANGED",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(handle.createWritableCount).toBe(
      writablesBeforeImport,
    );
    expect(result.current.persistenceError).toBe(
      "导入写入前发现 C 已在本页面之外发生变化；本次导入没有写入，请重新打开该 C。",
    );
  });

  it("reports an authorization mismatch without claiming that C was restored", async () => {
    const preflight = await readPreflight(
      "valid-300.backup.json",
    );
    if (!preflight.candidate) return;
    const { handle, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;
    const evidence = {
      ...evidenceFromPreflight(preflight),
      candidateIdentity: "sha256:forged:0",
    };

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidence,
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_NOT_ALLOWED",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(result.current.persistenceError).toBeNull();
  });

  it("reports an unexpected pre-write read failure without inventing restoration evidence", async () => {
    const preflight = await readPreflight(
      "valid-300.backup.json",
    );
    if (!preflight.candidate) return;
    const { handle, session } = await createHarness();
    const { result } = renderHook(() =>
      usePersistentLedger(
        session.repository,
        FIXED_CLOCK,
        session.capabilities,
        session,
      ),
    );
    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    const writesBeforeImport = handle.writeCount;
    handle.failNextRead = true;

    await act(async () => {
      await expect(
        result.current.replaceLedgerFromBackup(
          preflight.candidate,
          undefined,
          evidenceFromPreflight(preflight),
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_WRITE_FAILED",
      });
    });

    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(result.current.persistenceError).toBe(
      "导入在写入 C 前失败，页面没有替换；未取得“旧 C 已恢复”的事后证据。",
    );
  });
});
