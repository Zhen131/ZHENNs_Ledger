import { expect, vi } from "vitest";

import { LedgerFileHandleAdapter } from "./ledgerFileHandleAdapter";
import {
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "./ledgerFileHandleAdapterContract";
import { createLedgerDataContentIdentity } from "@/platform/persistence";
import {
  createBackupEnvelope,
  serializeBackupEnvelope,
} from "@/features/backup";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  preflightBackupJson,
} from "@/features/backup";
import { bytesToBase64Url } from "@/platform/encryption";
import {
  type DecryptedLedgerPayloadV4,
  validateDecryptedLedgerPayloadV4,
} from "./ledgerFileContract";
import { LedgerFileCrypto } from "./ledgerFileCrypto";
import type { CashEvent, LedgerData, Trade } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import {
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  LEDGER_FILE_READY_IMPORT_CAPABILITIES,
  type LedgerBackupImportEvidence,
} from "@/platform/persistence";
import { LedgerFileRepository } from "./ledgerFileRepository";
import type { LedgerFileSessionLease } from "./ledgerFileSessionLease";
import {
  ledgerFileBodySlotOffsetV3S3,
  LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  type LedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  parseLedgerFileV3S3Candidates,
} from "./ledgerFileChunkedContainerV3Parse";
import {
  decryptLedgerFileGenerationForTest,
  encryptLedgerFileGenerationForTest,
  ledgerFileBytesToTestString,
  ledgerFileTestStringToBytes,
  readLedgerFileForTest,
  serializeLedgerFileForTest,
  type LedgerFileForTest,
  validateLedgerFileForTest,
  applyLedgerFileWritableDataForTest,
} from "@/test-support";

export const PASSPHRASE = "correct horse battery staple";
export const TEST_SESSION_LEASE: LedgerFileSessionLease = {
  sessionId: "repository-test-session",
  runExclusiveWrite: (operation) => operation(),
  release: async () => undefined,
};

export function createReadyClearSession(
  repository: LedgerFileRepository,
  sessionId: string,
) {
  return createLedgerSession({
    storageKind: "ledger-file",
    repository,
    capabilities: LEDGER_FILE_CAPABILITIES,
    readyClearDriver: repository,
    createSessionId: () => sessionId,
  });
}

export function createReadyImportSession(
  repository: LedgerFileRepository,
  sessionId: string,
) {
  return createLedgerSession({
    storageKind: "ledger-file",
    repository,
    capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
    readyImportDriver: repository,
    createSessionId: () => sessionId,
  });
}

export async function createImportEvidence(
  candidate: LedgerData,
  overrides: Partial<LedgerBackupImportEvidence> = {},
): Promise<LedgerBackupImportEvidence> {
  const envelope = createBackupEnvelope(candidate, {
    appVersion: "0.1.0",
    exportedAt: "2026-07-31T07:59:00.000Z",
  });
  if (!envelope.ok) {
    throw new Error("Import evidence fixture must form a backup envelope");
  }
  const preflight = await preflightBackupJson(
    serializeBackupEnvelope(envelope.value),
    {
      todayKey: "2026-07-31",
      selectionGeneration: 1,
      requireHistoricalRawText: true,
    },
  );
  const confirmation =
    preflight.suspiciousGroupCount === 0
      ? null
      : confirmBackupImportSuspiciousGroups(preflight);
  const genuineEvidence = createLedgerBackupImportEvidence(
    preflight,
    confirmation,
  );
  const evidence =
    genuineEvidence ??
    ({
      contentIdentity: preflight.contentIdentity.value,
      candidateIdentity:
        await createLedgerDataContentIdentity(candidate),
      selectionGeneration: 1,
      hardErrorCount: 0,
      suspiciousGroupCount: 0,
      suspiciousGroupIdentity: preflight.suspiciousGroupIdentity,
      confirmedSuspiciousGroupIdentity: null,
      requireHistoricalRawText: true,
    } satisfies LedgerBackupImportEvidence);
  return Object.keys(overrides).length === 0
    ? evidence
    : { ...evidence, ...overrides };
}

export function invokeRawReadyClear(
  repository: LedgerFileRepository,
  authorization: unknown,
  executionContext?: unknown,
): Promise<void> {
  return (
    repository.clearReadyLedger as unknown as (
      authorization: unknown,
      executionContext?: unknown,
    ) => Promise<void>
  ).call(repository, authorization, executionContext);
}

export class AtomicLedgerHandle implements LedgerFileHandle {
  bytes: Uint8Array = new Uint8Array();
  writeCount = 0;
  closeCount = 0;
  failNextWrite = false;
  failNextClose = false;
  failAfterNextClosePublish = false;
  failNextRead = false;
  failNextCreateWritable = false;
  failReadAfterClose = false;
  publishBeforeFailingPositionedWrite = 0;
  blockReadAfterNextClose:
    | {
        started: Deferred<void>;
        release: Deferred<void>;
      }
    | null = null;
  private nextReadBlock:
    | {
        started: Deferred<void>;
        release: Deferred<void>;
      }
    | null = null;
  mutateAfterClose:
    | ((serialized: string) => string | Promise<string>)
    | null = null;
  private readsBeforeMutation = 0;
  private mutateBeforeRead: (() => void) | null = null;
  readonly writeOperations: Array<{
    position: number;
    byteLength: number;
  }> = [];

  constructor(
    readonly name = "ledger.lftl",
    private readonly events?: string[],
  ) {}

  async getFile() {
    this.events?.push("read");
    const readBlock = this.nextReadBlock;
    this.nextReadBlock = null;
    if (readBlock) {
      readBlock.started.resolve();
      await readBlock.release.promise;
    }
    if (this.mutateBeforeRead) {
      this.readsBeforeMutation -= 1;
      if (this.readsBeforeMutation === 0) {
        const mutate = this.mutateBeforeRead;
        this.mutateBeforeRead = null;
        mutate();
      }
    }
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error("read failed");
    }
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  mutateBeforeNthRead(readCount: number, mutate: () => void): void {
    this.readsBeforeMutation = readCount;
    this.mutateBeforeRead = mutate;
  }

  async createWritable(options?: {
    keepExistingData?: boolean;
  }): Promise<LedgerFileWritable> {
    this.events?.push("open-writable");
    if (this.failNextCreateWritable) {
      this.failNextCreateWritable = false;
      throw Object.assign(
        new Error("write permission denied"),
        { name: "NotAllowedError" },
      );
    }
    let pending: Uint8Array | null = options?.keepExistingData
      ? Uint8Array.from(this.bytes)
      : null;
    let writeObserved = false;
    let positionedWriteCount = 0;
    return {
      write: async (serialized) => {
        if (!writeObserved) {
          this.events?.push("write");
          this.writeCount += 1;
          writeObserved = true;
        }
        if (this.failNextWrite) {
          this.failNextWrite = false;
          throw new Error("write failed");
        }
        this.writeOperations.push(
          typeof serialized === "string"
            ? {
                position: 0,
                byteLength: new TextEncoder().encode(serialized).byteLength,
              }
            : serialized instanceof Uint8Array
              ? { position: 0, byteLength: serialized.byteLength }
              : {
                  position: serialized.position,
                  byteLength: serialized.data.byteLength,
                },
        );
        if (!(typeof serialized === "string") && !(serialized instanceof Uint8Array)) {
          positionedWriteCount += 1;
          if (
            this.publishBeforeFailingPositionedWrite ===
            positionedWriteCount
          ) {
            this.publishBeforeFailingPositionedWrite = 0;
            if (pending) this.bytes = Uint8Array.from(pending);
            throw new Error("positioned write failed after earlier bytes published");
          }
        }
        pending = applyLedgerFileWritableDataForTest(
          pending ?? new Uint8Array(),
          serialized,
        );
      },
      close: async () => {
        this.events?.push("close");
        this.closeCount += 1;
        if (this.failNextClose) {
          this.failNextClose = false;
          throw new Error("close failed");
        }
        if (pending) {
          const serialized = ledgerFileBytesToTestString(pending);
          const published = this.mutateAfterClose
            ? await this.mutateAfterClose(serialized)
            : serialized;
          this.mutateAfterClose = null;
          this.bytes = ledgerFileTestStringToBytes(published);
        }
        if (this.blockReadAfterNextClose) {
          this.nextReadBlock = this.blockReadAfterNextClose;
          this.blockReadAfterNextClose = null;
        }
        if (this.failAfterNextClosePublish) {
          this.failAfterNextClosePublish = false;
          throw new Error("close failed after publishing bytes");
        }
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

  text(): string {
    return ledgerFileBytesToTestString(this.bytes);
  }
}

export function createIdGenerator(ids: string[]) {
  const generate = vi.fn(() => {
    const value = ids.shift();
    if (!value) throw new Error("test ID sequence exhausted");
    return value;
  });
  return generate;
}

export function createClock(values: string[]) {
  return vi.fn(() => {
    const value = values.shift();
    if (!value) throw new Error("test clock sequence exhausted");
    return new Date(value);
  });
}

export function createTrade(index: number, symbol?: string): Trade {
  const assetSymbol = symbol ?? ["BTC", "ETH", "ADA"][index % 3];
  return {
    id: `fixture-trade-${index}`,
    occurredAt: "2026-01-01",
    timePrecision: "day",
    type: "buy",
    assetSymbol,
    quantity: "1",
    price: "10",
    totalValue: "10",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: `虚构历史交易原句 ${index + 1}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function createLedgerWithTrades(count: number): LedgerData {
  return {
    ...createInitialLedgerData(),
    trades: Array.from({ length: count }, (_, index) =>
      createTrade(index),
    ),
  };
}

export function createLedgerWithCashEvents(count: number): LedgerData {
  const cashEvents: CashEvent[] = Array.from(
    { length: count },
    (_, index) => ({
      id: `fixture-cash-${index}`,
      occurredAt: "2026-01-01",
      timePrecision: "day",
      type: "deposit",
      currency: "USDT",
      amount: "1",
      note: `虚构现金事实 ${index + 1}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  return {
    schemaVersion: 5,
    assets: [],
    trades: [],
    cashEvents,
    assetTransfers: [],
    priceSnapshots: [],
    feeRules: [],
  };
}

export function replaceLedgerFileSalt(
  serialized: string,
  saltByte = 9,
): string {
  const file = readLedgerFileForTest(serialized);
  return serializeLedgerFileForTest({
    ...file,
    crypto: {
      ...file.crypto,
      kdf: {
        ...file.crypto.kdf,
        saltBase64Url: bytesToBase64Url(
          new Uint8Array(16).fill(saltByte),
        ),
      },
    },
  });
}

export function replacePublishedLedgerFile(
  handle: AtomicLedgerHandle,
  serialized: string,
): void {
  handle.bytes = ledgerFileTestStringToBytes(serialized);
}

export function createSessionLease(
  sessionId: string,
  events?: string[],
): LedgerFileSessionLease {
  return {
    sessionId,
    runExclusiveWrite: async (operation) => {
      events?.push("lock-enter");
      try {
        return await operation();
      } finally {
        events?.push("lock-exit");
      }
    },
    release: vi.fn(async () => undefined),
  };
}

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

export class GatedSessionLease implements LedgerFileSessionLease {
  readonly sessionId = "gated-repository-session";
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

export function corruptCurrentCiphertext(serialized: string): string {
  const file = readLedgerFileForTest(serialized);
  return serializeLedgerFileForTest({
    ...file,
    current: {
      ...file.current,
      ciphertextBase64Url: bytesToBase64Url(
        new Uint8Array(32).fill(11),
      ),
    },
  });
}

export function corruptPreviousCiphertext(serialized: string): string {
  const file = readLedgerFileForTest(serialized);
  return serializeLedgerFileForTest({
    ...file,
    previous: file.previous
      ? {
          ...file.previous,
          ciphertextBase64Url: bytesToBase64Url(
            new Uint8Array(32).fill(12),
          ),
        }
      : null,
  });
}

export async function replaceCurrentPlaintext(
  serialized: string,
  plaintext: string,
): Promise<string> {
  const file = readLedgerFileForTest(serialized);
  const crypto = await LedgerFileCrypto.createForUnlock(
    PASSPHRASE,
    file.crypto,
  );
  const current = await encryptLedgerFileGenerationForTest(
    crypto,
    file,
    {
      revisionId: file.current.revisionId,
      parentRevisionId: file.current.parentRevisionId,
      ledgerSchemaVersion: file.current.ledgerSchemaVersion,
    },
    plaintext,
  );
  return serializeLedgerFileForTest({ ...file, current });
}

export async function replacePreviousPlaintext(
  serialized: string,
  plaintext: string,
): Promise<string> {
  const file = readLedgerFileForTest(serialized);
  if (!file.previous) {
    throw new Error("test fixture requires a previous generation");
  }
  const crypto = await LedgerFileCrypto.createForUnlock(
    PASSPHRASE,
    file.crypto,
  );
  const previous = await encryptLedgerFileGenerationForTest(
    crypto,
    file,
    {
      revisionId: file.previous.revisionId,
      parentRevisionId: file.previous.parentRevisionId,
      ledgerSchemaVersion: file.previous.ledgerSchemaVersion,
    },
    plaintext,
  );
  return serializeLedgerFileForTest({ ...file, previous });
}

export async function reencryptCurrentWithSamePlaintext(
  serialized: string,
): Promise<string> {
  const file = readLedgerFileForTest(serialized);
  const crypto = await LedgerFileCrypto.createForUnlock(
    PASSPHRASE,
    file.crypto,
  );
  const plaintext = await decryptLedgerFileGenerationForTest(
    crypto,
    file,
    file.current,
  );
  const current = await encryptLedgerFileGenerationForTest(
    crypto,
    file,
    {
      revisionId: file.current.revisionId,
      parentRevisionId: file.current.parentRevisionId,
      ledgerSchemaVersion: file.current.ledgerSchemaVersion,
    },
    plaintext,
  );
  return serializeLedgerFileForTest({ ...file, current });
}

export async function readVerifiedFile(
  handle: AtomicLedgerHandle,
): Promise<{
  file: LedgerFileForTest;
  current: DecryptedLedgerPayloadV4;
  previous: DecryptedLedgerPayloadV4 | null;
}> {
  const parsed: unknown = readLedgerFileForTest(handle.bytes);
  const validated = validateLedgerFileForTest(parsed);
  expect(validated.ok).toBe(true);
  if (!validated.ok) throw new Error("invalid test ledger file");
  const crypto = await LedgerFileCrypto.createForUnlock(
    PASSPHRASE,
    validated.value.crypto,
  );
  const current = parsePayload(
    await decryptLedgerFileGenerationForTest(
      crypto,
      validated.value,
      validated.value.current,
    ),
  );
  const previous = validated.value.previous
    ? parsePayload(
        await decryptLedgerFileGenerationForTest(
          crypto,
          validated.value,
          validated.value.previous,
        ),
      )
    : null;
  return { file: validated.value, current, previous };
}

export function readLatestChunkedFile(handle: AtomicLedgerHandle): LedgerFileV3S3 {
  const parsed = parseLedgerFileV3S3Candidates(handle.bytes);
  if (!parsed.ok) {
    throw new Error("invalid chunked test ledger file", {
      cause: parsed.errors,
    });
  }
  const latest = parsed.value.candidates
    .filter(({ referencedPaddingIsZero }) => referencedPaddingIsZero)
    .sort((left, right) => right.file.sequence - left.file.sequence)[0];
  if (!latest) throw new Error("missing chunked test header");
  return latest.file;
}

export function readChunkedBodySlots(
  bytes: Uint8Array,
  slots: readonly number[],
): Uint8Array {
  const result = new Uint8Array(
    slots.length * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  );
  for (let index = 0; index < slots.length; index += 1) {
    const offset = ledgerFileBodySlotOffsetV3S3(slots[index]!);
    result.set(
      bytes.subarray(offset, offset + LEDGER_FILE_V3_S3_BODY_SLOT_BYTES),
      index * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
    );
  }
  return result;
}

export function parsePayload(serialized: string): DecryptedLedgerPayloadV4 {
  const result = validateDecryptedLedgerPayloadV4(JSON.parse(serialized));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("invalid test payload");
  return result.value.value;
}

export async function createTwoGenerationLedgerFile(): Promise<{
  handle: AtomicLedgerHandle;
  repository: LedgerFileRepository;
  ledger301: LedgerData;
  ledger302: LedgerData;
  published302: string;
}> {
  const handle = new AtomicLedgerHandle();
  const ledger301 = createLedgerWithTrades(3);
  const ledger302 = {
    ...ledger301,
    trades: [...ledger301.trades, createTrade(3, "ADA")],
  };
  const repository = await LedgerFileRepository.create(
    new LedgerFileHandleAdapter(),
    handle,
    PASSPHRASE,
    ledger301,
    {
      generateId: createIdGenerator([
        "file-recovery",
        "revision-301",
        "revision-302",
      ]),
      now: createClock([
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T10:01:00.000Z",
      ]),
      sessionLease: createSessionLease("fixture-301"),
    },
  );
  await repository.save(ledger302);
  return {
    handle,
    repository,
    ledger301,
    ledger302,
    published302: handle.text(),
  };
}
