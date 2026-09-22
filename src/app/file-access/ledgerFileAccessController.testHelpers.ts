import {
  expect,
  vi,
} from "vitest";
import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFilePickerProvider,
  type LedgerFileWritable,
} from "@/platform/files";
import {
  type
  LedgerFileConnectionAdapter,
  type
  LedgerFileConnectionRecordV1,
} from "@/platform/files";
import type {
  LedgerFileSessionCoordinator,
  LedgerFileSessionLease,
} from "@/platform/coordination";
import { bytesToBase64Url } from "@/platform/encryption";
import { LedgerFileRepository } from "@/platform/files";
import { createInitialLedgerData } from "@/core/state";
import {
  createUsdtSimpleTrade as createSimpleTrade,
  ledgerFileTestStringToBytes,
  readLedgerFileForTest,
  serializeLedgerFileForTest,
  applyLedgerFileWritableDataForTest,
} from "@/test-support";
import { DefaultLedgerFileAccessController } from "./ledgerFileAccessController";

export const PASSPHRASE = "correct horse battery staple";

export function createTestLease(
  sessionId = "controller-test-session",
): LedgerFileSessionLease {
  return {
    sessionId,
    runExclusiveWrite: (operation) => operation(),
    release: vi.fn(async () => undefined),
  };
}

export function createTestCoordinator(): LedgerFileSessionCoordinator {
  let nextSession = 0;
  return {
    acquire: vi.fn(async () => {
      nextSession += 1;
      return {
        status: "acquired" as const,
        lease: createTestLease(`controller-test-${nextSession}`),
      };
    }),
  };
}

export class MemoryFileHandle implements LedgerFileHandle {
  bytes: Uint8Array;
  writes = 0;
  permissionState: "granted" | "prompt" | "denied" = "granted";
  readonly remove = vi.fn(async () => undefined);
  readonly queryPermission = vi.fn(async () => this.permissionState);
  readonly requestPermission = vi.fn(async () => this.permissionState);

  constructor(
    readonly name: string,
    initial: string | Uint8Array = "",
  ) {
    this.bytes =
      typeof initial === "string"
        ? new TextEncoder().encode(initial)
        : Uint8Array.from(initial);
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
      write: async (data) => {
        if (!writeObserved) {
          this.writes += 1;
          writeObserved = true;
        }
        pending = applyLedgerFileWritableDataForTest(pending, data);
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

export function createController(
  saveHandle: LedgerFileHandle,
  openHandle: LedgerFileHandle = saveHandle,
  coordinator: LedgerFileSessionCoordinator =
    createTestCoordinator(),
  createRecoveryId: () => string = () => "recovery-test",
  connectionAdapter?: LedgerFileConnectionAdapter,
) {
  const provider: LedgerFilePickerProvider = {
    showSaveFilePicker: vi.fn(async () => saveHandle),
    showOpenFilePicker: vi.fn(async () => [openHandle]),
  };
  return {
    provider,
    controller: new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(provider),
      {
        generateId: vi
          .fn()
          .mockReturnValueOnce("file-a")
          .mockReturnValueOnce("revision-a")
          .mockReturnValueOnce("revision-recovered"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
      },
      coordinator,
      createRecoveryId,
      connectionAdapter,
    ),
  };
}

export function createConnectionAdapter(
  initial: LedgerFileConnectionRecordV1 | null = null,
) {
  let current = initial;
  const adapter: LedgerFileConnectionAdapter = {
    read: vi.fn(async () => current),
    write: vi.fn(async (record) => {
      current = record;
    }),
    clear: vi.fn(async () => {
      current = null;
    }),
  };
  return {
    adapter,
    current: () => current,
  };
}

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export async function createExistingLedgerHandle(
  marker: string,
): Promise<MemoryFileHandle> {
  const handle = new MemoryFileHandle(`${marker}.lftl`);
  const ledger = {
    ...createInitialLedgerData(),
    trades: [
      createSimpleTrade(
        `trade-${marker}`,
        "buy",
        "BTC",
        "1",
      ),
    ],
  };
  await LedgerFileRepository.create(
    new LedgerFileHandleAdapter(),
    handle,
    PASSPHRASE,
    ledger,
    {
      generateId: vi
        .fn()
        .mockReturnValueOnce(`file-${marker}`)
        .mockReturnValueOnce(`revision-${marker}`),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
      sessionLease: createTestLease("fixture-create"),
    },
  );
  handle.writes = 0;
  return handle;
}

export function createInspectableLedgerFile(
  ledgerSchemaVersion: number,
  fileFormatVersion = 2,
): string {
  return JSON.stringify({
    fileFormatVersion,
    fileId: "fictional-retired-file",
    crypto: {
      cryptoVersion: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 600_000,
        saltBase64Url: bytesToBase64Url(new Uint8Array(16).fill(7)),
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
      ivBase64Url: bytesToBase64Url(new Uint8Array(12).fill(8)),
      ciphertextBase64Url: bytesToBase64Url(new Uint8Array(16).fill(9)),
    },
    previous: null,
  });
}

export async function createRecoverableLedgerHandle(): Promise<{
  handle: MemoryFileHandle;
  previousLedger: ReturnType<typeof createInitialLedgerData>;
}> {
  const handle = new MemoryFileHandle("recoverable.lftl");
  const previousLedger = {
    ...createInitialLedgerData(),
    trades: [
      createSimpleTrade(
        "trade-recovery-301",
        "buy",
        "BTC",
        "1",
      ),
    ],
  };
  const currentLedger = {
    ...previousLedger,
    trades: [
      ...previousLedger.trades,
      createSimpleTrade(
        "trade-damaged-302",
        "buy",
        "ADA",
        "2",
      ),
    ],
  };
  const repository = await LedgerFileRepository.create(
    new LedgerFileHandleAdapter(),
    handle,
    PASSPHRASE,
    previousLedger,
    {
      generateId: vi
        .fn<() => string>()
        .mockReturnValueOnce("file-recoverable")
        .mockReturnValueOnce("revision-301")
        .mockReturnValueOnce("revision-302"),
      now: vi
        .fn<() => Date>()
        .mockReturnValueOnce(
          new Date("2026-07-28T10:00:00.000Z"),
        )
        .mockReturnValueOnce(
          new Date("2026-07-28T10:01:00.000Z"),
        ),
      sessionLease: createTestLease("fixture-recovery"),
    },
  );
  await repository.save(currentLedger);
  const file = readLedgerFileForTest(handle.bytes);
  handle.bytes = ledgerFileTestStringToBytes(
    serializeLedgerFileForTest({
      ...file,
      current: {
        ...file.current,
        ciphertextBase64Url: bytesToBase64Url(
          new Uint8Array(32).fill(8),
        ),
      },
    }),
  );
  handle.writes = 0;
  return { handle, previousLedger };
}

export function createDeferredSelectionController(
  openResults: Array<Promise<LedgerFileHandle[]>>,
  saveHandle = new MemoryFileHandle("created.lftl"),
) {
  const provider: LedgerFilePickerProvider = {
    showSaveFilePicker: vi.fn(async () => saveHandle),
    showOpenFilePicker: vi.fn(() => {
      const next = openResults.shift();
      if (!next) throw new Error("test picker sequence exhausted");
      return next;
    }),
  };
  return {
    controller: new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(provider),
      {
        generateId: vi
          .fn()
          .mockReturnValueOnce("file-created")
          .mockReturnValueOnce("revision-created"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
      },
      createTestCoordinator(),
    ),
    provider,
  };
}

export async function expectSelectedTrade(
  controller: DefaultLedgerFileAccessController,
  tradeId: string,
): Promise<void> {
  const result = await controller.unlockSelected(PASSPHRASE);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  await expect(result.session.repository.load()).resolves.toMatchObject({
    trades: [expect.objectContaining({ id: tradeId })],
  });
}
