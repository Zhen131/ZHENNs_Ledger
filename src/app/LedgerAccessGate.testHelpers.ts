import { cleanup } from "@testing-library/react";
import {
  afterEach,
  vi,
} from "vitest";
import {
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "@/platform/files";
import type { LedgerFileSessionLease } from "@/platform/coordination";
import {
  type LedgerAccessController,
} from "@/platform/legacy";
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
} from "./ledgerFileAccessController";
import {
  claimLedgerSessionPersistencePort,
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  type LedgerRepository,
  type LedgerSession,
  type LedgerSessionPersistencePort,
} from "@/platform/persistence";
import { applyLedgerFileWritableDataForTest } from "@/test-support";

export const PASSPHRASE = "correct horse battery staple";
export const mockPersistencePorts = new WeakMap<
  LedgerSession,
  LedgerSessionPersistencePort
>();

export function getMockPersistencePort(
  session: LedgerSession,
): LedgerSessionPersistencePort {
  const existing = mockPersistencePorts.get(session);
  if (existing) {
    return existing;
  }
  const port = claimLedgerSessionPersistencePort(session, {});
  mockPersistencePorts.set(session, port);
  return port;
}

export const repository: LedgerRepository = {
  load: async () => null,
  save: async () => undefined,
  clear: async () => undefined,
};

export function createFileSession(
  sessionRepository: LedgerRepository = repository,
) {
  return createLedgerSession({
    storageKind: "ledger-file",
    repository: sessionRepository,
    capabilities: LEDGER_FILE_CAPABILITIES,
  });
}

afterEach(() => {
  cleanup();
});

export function createController(
  overrides: Partial<LedgerAccessController> = {},
): LedgerAccessController {
  return {
    inspect: vi.fn(async () => ({ status: "setup-required" as const })),
    ...overrides,
  };
}

export function createFileController(
  overrides: Partial<LedgerFileAccessController> = {},
): LedgerFileAccessController {
  return {
    inspectRememberedConnection: vi.fn(async () => ({
      status: "none" as const,
      ok: true as const,
    })),
    requestRememberedPermission: vi.fn(async () => ({
      status: "permission-prompt" as const,
      ok: false as const,
    })),
    reselectRememberedConnection: vi.fn(async () => ({
      ok: false as const,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
    })),
    forgetRememberedConnection: vi.fn(async () => undefined),
    create: vi.fn(async () => ({
      status: "unlocked" as const,
      ok: true as const,
      session: createFileSession(),
    })),
    selectExisting: vi.fn(async () => ({ ok: true as const })),
    unlockSelected: vi.fn(async () => ({
      status: "unlocked" as const,
      ok: true as const,
      session: createFileSession(),
    })),
    confirmRecovery: vi.fn(async () => ({
      status: "error" as const,
      ok: false as const,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND,
    })),
    cancelRecovery: vi.fn(async () => undefined),
    cancelPendingSelection: vi.fn(),
    ...overrides,
  };
}

export const GATE_TEST_LEASE: LedgerFileSessionLease = {
  sessionId: "gate-fixture",
  runExclusiveWrite: (operation) => operation(),
  release: async () => undefined,
};

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export class MemoryLedgerFileHandle implements LedgerFileHandle {
  bytes: Uint8Array = new Uint8Array();
  writes = 0;
  readonly remove = vi.fn(async () => undefined);

  constructor(
    readonly name = "gate-a.lftl",
    initial = "",
  ) {
    this.bytes = new TextEncoder().encode(initial);
  }

  async getFile() {
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  async createWritable(options?: {
    keepExistingData?: boolean;
  }): Promise<LedgerFileWritable> {
    let pending: Uint8Array = options?.keepExistingData
      ? Uint8Array.from(this.bytes)
      : new Uint8Array();
    let writeObserved = false;
    return {
      write: async (serialized) => {
        if (!writeObserved) {
          this.writes += 1;
          writeObserved = true;
        }
        pending = applyLedgerFileWritableDataForTest(pending, serialized);
      },
      close: async () => {
        this.bytes = pending;
      },
      abort: async () => undefined,
    };
  }

  async isSameEntry(other: LedgerFileHandle): Promise<boolean> {
    return other === this;
  }
}

export function createInspectableLedgerFile(ledgerSchemaVersion: number): string {
  return JSON.stringify({
    fileFormatVersion: 2,
    fileId: "fictional-retired-file",
    crypto: {
      cryptoVersion: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 600_000,
        saltBase64Url: "BwcHBwcHBwcHBwcHBwcHBw",
      },
      cipher: {
        name: "AES-GCM",
        keyLength: 256,
        tagLength: 128,
      },
    },
    current: {
      revisionId: "fictional-retired-revision",
      parentRevisionId: null,
      ledgerSchemaVersion,
      ivBase64Url: "CAgICAgICAgICAgI",
      ciphertextBase64Url: "CQkJCQkJCQkJCQkJCQkJCQ",
    },
    previous: null,
  });
}
