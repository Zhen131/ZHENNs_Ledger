import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup } from "@testing-library/react";
import {
  afterEach,
  vi,
} from "vitest";
import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "@/platform/files";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  preflightBackupJson,
  type BackupImportPreflightResult,
} from "@/features/backup";
import type { LedgerFileSessionLease } from "@/platform/coordination";
import {
  createLedgerSession,
  LEDGER_FILE_READY_IMPORT_CAPABILITIES,
  type LedgerBackupImportEvidence,
} from "@/platform/persistence";
import { LedgerFileRepository } from "@/platform/files";
import { createInitialLedgerData } from "@/core/state";
import type { LedgerClock } from "@/core/shared";
import {
  ledgerFileBytesToTestString,
  ledgerFileTestStringToBytes,
  applyLedgerFileWritableDataForTest,
} from "@/test-support";

export const PASSPHRASE = "correct horse battery staple";
export const FIXED_CLOCK: LedgerClock = {
  now: () => new Date("2026-07-31T12:00:00.000Z"),
};

afterEach(cleanup);

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export class ImportLedgerHandle implements LedgerFileHandle {
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  createWritableCount = 0;
  writeCount = 0;
  closeCount = 0;
  failNextRead = false;
  failNextWrite = false;
  mutateAfterClose: ((serialized: string) => string) | null = null;
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

  async createWritable(options?: {
    keepExistingData?: boolean;
  }): Promise<LedgerFileWritable> {
    this.createWritableCount += 1;
    let pending: Uint8Array | null = options?.keepExistingData
      ? Uint8Array.from(this.bytes)
      : null;
    let writeObserved = false;
    return {
      write: async (serialized) => {
        if (!writeObserved) {
          this.writeCount += 1;
          writeObserved = true;
        }
        if (this.failNextWrite) {
          this.failNextWrite = false;
          throw new Error("write failed");
        }
        pending = applyLedgerFileWritableDataForTest(
          pending ?? new Uint8Array(),
          serialized,
        );
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
          const serialized = ledgerFileBytesToTestString(pending);
          const committed = this.mutateAfterClose?.(serialized) ?? serialized;
          this.mutateAfterClose = null;
          const encoded = ledgerFileTestStringToBytes(committed);
          this.bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
          this.bytes.set(encoded);
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
    return ledgerFileBytesToTestString(this.bytes);
  }
}

export function createLease(sessionId: string): LedgerFileSessionLease {
  return {
    sessionId,
    runExclusiveWrite: (operation) => operation(),
    release: async () => undefined,
  };
}

export function createIdGenerator(ids: string[]) {
  return vi.fn(() => {
    const id = ids.shift();
    if (!id) {
      throw new Error("test ID sequence exhausted");
    }
    return id;
  });
}

export function readFixture(name: string): string {
  return readFileSync(
    resolve(process.cwd(), `test-fixtures/w11-b-import/${name}`),
    "utf8",
  );
}

export async function readPreflight(
  name: string,
  selectionGeneration = 1,
): Promise<BackupImportPreflightResult> {
  return preflightBackupJson(readFixture(name), {
    todayKey: "2026-07-31",
    selectionGeneration,
    requireHistoricalRawText: true,
  });
}

export function evidenceFromPreflight(
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

export async function createHarness(
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
