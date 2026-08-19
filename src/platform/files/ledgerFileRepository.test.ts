import { describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "./ledgerFileHandleAdapter";
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
  type DecryptedLedgerPayloadV3,
  type LedgerFileV2,
  validateDecryptedLedgerPayloadV3,
  validateLedgerFileV2,
} from "./ledgerFileContract";
import { LedgerFileCrypto } from "./ledgerFileCrypto";
import type { CryptoProvider } from "@/platform/encryption";
import type { LedgerData, Trade } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import {
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  LEDGER_FILE_READY_IMPORT_CAPABILITIES,
  LedgerSessionLifecycleError,
  type LedgerBackupImportEvidence,
} from "@/platform/persistence";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepository,
} from "./ledgerFileRepository";
import type { LedgerFileSessionLease } from "./ledgerFileSessionLease";

const PASSPHRASE = "correct horse battery staple";
const TEST_SESSION_LEASE: LedgerFileSessionLease = {
  sessionId: "repository-test-session",
  runExclusiveWrite: (operation) => operation(),
  release: async () => undefined,
};

function createReadyClearSession(
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

function createReadyImportSession(
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

async function createImportEvidence(
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
    } satisfies LedgerBackupImportEvidence);
  return Object.keys(overrides).length === 0
    ? evidence
    : { ...evidence, ...overrides };
}

function invokeRawReadyClear(
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

class AtomicLedgerHandle implements LedgerFileHandle {
  bytes = new Uint8Array();
  writeCount = 0;
  closeCount = 0;
  failNextWrite = false;
  failNextClose = false;
  failAfterNextClosePublish = false;
  failNextRead = false;
  failNextCreateWritable = false;
  failReadAfterClose = false;
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

  async createWritable(): Promise<LedgerFileWritable> {
    this.events?.push("open-writable");
    if (this.failNextCreateWritable) {
      this.failNextCreateWritable = false;
      throw Object.assign(
        new Error("write permission denied"),
        { name: "NotAllowedError" },
      );
    }
    let pending: Uint8Array | null = null;
    return {
      write: async (serialized) => {
        this.events?.push("write");
        this.writeCount += 1;
        if (this.failNextWrite) {
          this.failNextWrite = false;
          throw new Error("write failed");
        }
        pending = new TextEncoder().encode(serialized);
      },
      close: async () => {
        this.events?.push("close");
        this.closeCount += 1;
        if (this.failNextClose) {
          this.failNextClose = false;
          throw new Error("close failed");
        }
        if (pending) {
          const serialized = new TextDecoder().decode(pending);
          const published = this.mutateAfterClose
            ? await this.mutateAfterClose(serialized)
            : serialized;
          this.mutateAfterClose = null;
          this.bytes = new TextEncoder().encode(published);
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
    return new TextDecoder().decode(this.bytes);
  }
}

function createIdGenerator(ids: string[]) {
  const generate = vi.fn(() => {
    const value = ids.shift();
    if (!value) throw new Error("test ID sequence exhausted");
    return value;
  });
  return generate;
}

function createClock(values: string[]) {
  return vi.fn(() => {
    const value = values.shift();
    if (!value) throw new Error("test clock sequence exhausted");
    return new Date(value);
  });
}

function createTrade(index: number, symbol?: string): Trade {
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

function createLedgerWithTrades(count: number): LedgerData {
  return {
    ...createInitialLedgerData(),
    trades: Array.from({ length: count }, (_, index) =>
      createTrade(index),
    ),
  };
}

function replaceLedgerFileSalt(
  serialized: string,
  saltByte = 9,
): string {
  const file = JSON.parse(serialized) as LedgerFileV2;
  return JSON.stringify({
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

function replacePublishedLedgerFile(
  handle: AtomicLedgerHandle,
  serialized: string,
): void {
  handle.bytes = new TextEncoder().encode(serialized);
}

function createSessionLease(
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

class GatedSessionLease implements LedgerFileSessionLease {
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

function corruptCurrentCiphertext(serialized: string): string {
  const file = JSON.parse(serialized) as LedgerFileV2;
  return JSON.stringify({
    ...file,
    current: {
      ...file.current,
      ciphertextBase64Url: bytesToBase64Url(
        new Uint8Array(32).fill(11),
      ),
    },
  });
}

function corruptPreviousCiphertext(serialized: string): string {
  const file = JSON.parse(serialized) as LedgerFileV2;
  return JSON.stringify({
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

async function replaceCurrentPlaintext(
  serialized: string,
  plaintext: string,
): Promise<string> {
  const file = JSON.parse(serialized) as LedgerFileV2;
  const crypto = await LedgerFileCrypto.createForUnlock(
    PASSPHRASE,
    file.crypto,
  );
  const current = await crypto.encryptGeneration(
    file.fileId,
    {
      revisionId: file.current.revisionId,
      parentRevisionId: file.current.parentRevisionId,
      ledgerSchemaVersion: file.current.ledgerSchemaVersion,
    },
    plaintext,
  );
  return JSON.stringify({ ...file, current });
}

async function replacePreviousPlaintext(
  serialized: string,
  plaintext: string,
): Promise<string> {
  const file = JSON.parse(serialized) as LedgerFileV2;
  if (!file.previous) {
    throw new Error("test fixture requires a previous generation");
  }
  const crypto = await LedgerFileCrypto.createForUnlock(
    PASSPHRASE,
    file.crypto,
  );
  const previous = await crypto.encryptGeneration(
    file.fileId,
    {
      revisionId: file.previous.revisionId,
      parentRevisionId: file.previous.parentRevisionId,
      ledgerSchemaVersion: file.previous.ledgerSchemaVersion,
    },
    plaintext,
  );
  return JSON.stringify({ ...file, previous });
}

async function reencryptCurrentWithSamePlaintext(
  serialized: string,
): Promise<string> {
  const file = JSON.parse(serialized) as LedgerFileV2;
  const crypto = await LedgerFileCrypto.createForUnlock(
    PASSPHRASE,
    file.crypto,
  );
  const plaintext = await crypto.decryptGeneration(
    file.fileId,
    file.current,
  );
  const current = await crypto.encryptGeneration(
    file.fileId,
    {
      revisionId: file.current.revisionId,
      parentRevisionId: file.current.parentRevisionId,
      ledgerSchemaVersion: file.current.ledgerSchemaVersion,
    },
    plaintext,
  );
  return JSON.stringify({ ...file, current });
}

async function readVerifiedFile(
  handle: AtomicLedgerHandle,
): Promise<{
  file: LedgerFileV2;
  current: DecryptedLedgerPayloadV3;
  previous: DecryptedLedgerPayloadV3 | null;
}> {
  const parsed: unknown = JSON.parse(handle.text());
  const validated = validateLedgerFileV2(parsed);
  expect(validated.ok).toBe(true);
  if (!validated.ok) throw new Error("invalid test ledger file");
  const crypto = await LedgerFileCrypto.createForUnlock(
    PASSPHRASE,
    validated.value.crypto,
  );
  const current = parsePayload(
    await crypto.decryptGeneration(
      validated.value.fileId,
      validated.value.current,
    ),
  );
  const previous = validated.value.previous
    ? parsePayload(
        await crypto.decryptGeneration(
          validated.value.fileId,
          validated.value.previous,
        ),
      )
    : null;
  return { file: validated.value, current, previous };
}

function parsePayload(serialized: string): DecryptedLedgerPayloadV3 {
  const result = validateDecryptedLedgerPayloadV3(JSON.parse(serialized));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("invalid test payload");
  return result.value.value;
}

async function createTwoGenerationLedgerFile(): Promise<{
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

describe("LedgerFileRepository", () => {
  it("round-trips a mapping-null fictional asset with multi-day manual prices through C", async () => {
    const handle = new AtomicLedgerHandle("manual-prices.lftl");
    const ledger = createInitialLedgerData();
    ledger.assets.push({
      id: "asset-knight-c-roundtrip",
      symbol: "KNIGHT",
      name: "KNIGHT",
      quoteCurrency: "USDT",
      binanceMapping: null,
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:00.000Z",
    });
    ledger.trades.push({
      id: "trade-knight-c-roundtrip",
      occurredAt: "2026-08-10",
      timePrecision: "day",
      type: "buy",
      assetSymbol: "KNIGHT",
      quantity: "2",
      price: "5",
      totalValue: "10",
      currency: "USDT",
      fee: "0",
      feeCurrency: "USDT",
      createdAt: "2026-08-10T08:01:00.000Z",
      updatedAt: "2026-08-10T08:01:00.000Z",
    });
    ledger.priceSnapshots.push(
      {
        id: "price-knight-c-day-1",
        assetSymbol: "KNIGHT",
        price: "10",
        currency: "USDT",
        recordedAt: "2026-08-11",
        source: "manual",
        createdAt: "2026-08-11T08:00:00.000Z",
        updatedAt: "2026-08-11T08:00:00.000Z",
      },
      {
        id: "price-knight-c-day-2",
        assetSymbol: "KNIGHT",
        price: "20",
        currency: "USDT",
        recordedAt: "2026-08-12",
        source: "manual",
        createdAt: "2026-08-12T08:00:00.000Z",
        updatedAt: "2026-08-12T08:00:00.000Z",
      },
    );
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-manual-prices",
          "revision-manual-prices",
        ]),
        now: createClock(["2026-08-19T13:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );

    const loaded = await repository.load();
    expect(
      loaded.assets.find(({ symbol }) => symbol === "KNIGHT")?.binanceMapping,
    ).toBeNull();
    expect(
      loaded.priceSnapshots.filter(
        ({ assetSymbol }) => assetSymbol === "KNIGHT",
      ),
    ).toEqual(ledger.priceSnapshots);
  });

  it(
    "creates 300 then saves 301 and 302 as two adjacent independently decryptable full generations",
    async () => {
      const handle = new AtomicLedgerHandle();
      const adapter = new LedgerFileHandleAdapter();
      const generateId = createIdGenerator([
        "file-a",
        "revision-300",
        "revision-301",
        "revision-302",
      ]);
      const now = createClock([
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T10:01:00.000Z",
        "2026-07-28T10:02:00.000Z",
      ]);
      const ledger300 = createLedgerWithTrades(300);
      const repository = await LedgerFileRepository.create(
        adapter,
        handle,
        PASSPHRASE,
        ledger300,
        { generateId, now, sessionLease: TEST_SESSION_LEASE },
      );

      const first = await readVerifiedFile(handle);
      expect(handle.text()).not.toContain('"assets"');
      expect(handle.text()).not.toContain('"trades"');
      expect(handle.text()).not.toContain('"priceSnapshots"');
      expect(handle.text()).not.toContain('"feeRules"');
      expect(handle.text()).not.toContain('"savedAt"');
      expect(first.current.ledgerData.trades).toHaveLength(300);
      expect(first.previous).toBeNull();
      expect(first.file.current.parentRevisionId).toBeNull();

      const ledger301 = {
        ...ledger300,
        trades: [...ledger300.trades, createTrade(300, "BTC")],
      };
      await repository.save(ledger301);
      const second = await readVerifiedFile(handle);
      expect(second.current.ledgerData.trades).toHaveLength(301);
      expect(second.previous?.ledgerData.trades).toHaveLength(300);
      expect(second.file.current.parentRevisionId).toBe(
        second.file.previous?.revisionId,
      );
      expect(second.file.current.ivBase64Url).not.toBe(
        second.file.previous?.ivBase64Url,
      );

      const ledger302 = {
        ...ledger301,
        trades: [...ledger301.trades, createTrade(301, "ETH")],
      };
      await repository.save(ledger302);
      const third = await readVerifiedFile(handle);
      expect(third.current.ledgerData.trades).toHaveLength(302);
      expect(third.previous?.ledgerData.trades).toHaveLength(301);
      expect(third.file.current.revisionId).toBe("revision-302");
      expect(third.file.previous?.revisionId).toBe("revision-301");
      expect(third.file.current.parentRevisionId).toBe("revision-301");
      expect(third.file.crypto.kdf.saltBase64Url).toBe(
        first.file.crypto.kdf.saltBase64Url,
      );
      expect(new Set([
        first.file.current.ivBase64Url,
        second.file.current.ivBase64Url,
        third.file.current.ivBase64Url,
      ]).size).toBe(3);
      await expect(repository.load()).resolves.toEqual(ledger302);
      expect(handle.writeCount).toBe(3);
      expect(handle.closeCount).toBe(3);
    },
    15_000,
  );

  it("treats the same canonical ledger as a no-op without new time, revision, IV, or write", async () => {
    const handle = new AtomicLedgerHandle();
    const generateId = createIdGenerator(["file-a", "revision-a"]);
    const now = createClock(["2026-07-28T10:00:00.000Z"]);
    const ledger = createLedgerWithTrades(3);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      { generateId, now, sessionLease: TEST_SESSION_LEASE },
    );
    const original = handle.text();

    await repository.save(structuredClone(ledger));

    expect(handle.text()).toBe(original);
    expect(handle.writeCount).toBe(1);
    expect(generateId).toHaveBeenCalledTimes(2);
    expect(now).toHaveBeenCalledOnce();
  });

  it("keeps ordinary save re-read, write, close, and readback inside the session write lock", async () => {
    const events: string[] = [];
    const handle = new AtomicLedgerHandle("ledger.lftl", events);
    const ledger = createLedgerWithTrades(1);
    const sessionLease = createSessionLease(
      "ordinary-save-order",
      events,
    );
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease,
      },
    );
    events.length = 0;

    await repository.save({
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    });

    expect(events).toEqual([
      "lock-enter",
      "read",
      "open-writable",
      "write",
      "close",
      "read",
      "lock-exit",
    ]);
  });

  it("drops an older valid save candidate that is still waiting for the write lock", async () => {
    const handle = new AtomicLedgerHandle();
    const sessionLease = new GatedSessionLease();
    const ledgerA = createLedgerWithTrades(1);
    const ledgerB = {
      ...ledgerA,
      trades: [...ledgerA.trades, createTrade(1)],
    };
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerA,
      {
        generateId: createIdGenerator(["file-a", "revision-a"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease,
      },
    );
    const serializedA = handle.text();
    const gate = sessionLease.gateNextOperation();

    const obsoleteSave = repository.save(ledgerB);
    await gate.started;
    const latestSave = repository.save(structuredClone(ledgerA));
    expect(sessionLease.operationCount).toBe(3);
    gate.release();
    await Promise.all([obsoleteSave, latestSave]);

    expect(handle.writeCount).toBe(1);
    expect(handle.text()).toBe(serializedA);
    await expect(repository.load()).resolves.toEqual(ledgerA);
  });

  it("does not let an invalid newer request cancel the latest legal candidate waiting for the write lock", async () => {
    const handle = new AtomicLedgerHandle();
    const sessionLease = new GatedSessionLease();
    const ledgerA = createLedgerWithTrades(1);
    const ledgerB = {
      ...ledgerA,
      trades: [...ledgerA.trades, createTrade(1)],
    };
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledgerA,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease,
      },
    );
    const gate = sessionLease.gateNextOperation();

    const legalSave = repository.save(ledgerB);
    await gate.started;
    await expect(
      repository.save({
        ...ledgerA,
        schemaVersion: 1,
      } as unknown as LedgerData),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
    });
    expect(sessionLease.operationCount).toBe(2);
    gate.release();
    await legalSave;

    expect(handle.writeCount).toBe(2);
    await expect(repository.load()).resolves.toEqual(ledgerB);
  });

  it("keeps a pending-intent write and its no-write reconcile inside the same session write lock", async () => {
    const events: string[] = [];
    const handle = new AtomicLedgerHandle("ledger.lftl", events);
    const ledger = createLedgerWithTrades(1);
    const sessionLease = createSessionLease(
      "pending-order",
      events,
    );
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease,
      },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    };
    events.length = 0;
    handle.failReadAfterClose = true;

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    expect(events).toEqual([
      "lock-enter",
      "read",
      "open-writable",
      "write",
      "close",
      "read",
      "lock-exit",
    ]);

    events.length = 0;
    await repository.save(candidate);
    expect(events).toEqual([
      "lock-enter",
      "read",
      "lock-exit",
    ]);
  });

  it("keeps recovery re-read, write, close, and readback inside the retained session write lock", async () => {
    const events: string[] = [];
    const handle = new AtomicLedgerHandle("ledger.lftl", events);
    const ledger301 = createLedgerWithTrades(1);
    const ledger302 = {
      ...ledger301,
      trades: [...ledger301.trades, createTrade(1)],
    };
    const sessionLease = createSessionLease(
      "recovery-order",
      events,
    );
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger301,
      {
        generateId: createIdGenerator([
          "file-recovery-order",
          "revision-301",
          "revision-302",
          "revision-recovered",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
          "2026-07-28T10:02:00.000Z",
        ]),
        sessionLease,
      },
    );
    await repository.save(ledger302);
    replacePublishedLedgerFile(
      handle,
      corruptCurrentCiphertext(handle.text()),
    );
    const opened = await LedgerFileRepository.openForAccess(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        expectedFileId: "file-recovery-order",
        generateId: createIdGenerator(["revision-recovered"]),
        now: createClock(["2026-07-28T10:02:00.000Z"]),
        sessionLease,
      },
    );
    expect(opened.status).toBe("recovery-required");
    if (opened.status !== "recovery-required") return;
    events.length = 0;

    await opened.candidate.confirm();

    expect(events).toEqual([
      "lock-enter",
      "read",
      "open-writable",
      "write",
      "close",
      "read",
      "lock-exit",
    ]);
  });

  it("rejects invalid and resource-violating candidates before opening a writable", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(3);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator(["file-a", "revision-a"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const original = handle.text();

    await expect(
      repository.save({
        ...ledger,
        schemaVersion: 1,
      } as unknown as LedgerData),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
    });
    await expect(
      repository.save({
        ...ledger,
        trades: [
          { ...ledger.trades[0], note: "x".repeat(4_097) },
          ...ledger.trades.slice(1),
        ],
      }),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
    });
    expect(handle.text()).toBe(original);
    expect(handle.writeCount).toBe(1);
  });

  it.each(["write", "close"] as const)(
    "does not publish %s failure as success and retries the same savedAt, revision, IV, and ciphertext",
    async (stage) => {
      const handle = new AtomicLedgerHandle();
      const ledger = createLedgerWithTrades(3);
      const generateId = createIdGenerator([
        "file-a",
        "revision-a",
        "revision-b",
      ]);
      const now = createClock([
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T10:01:00.000Z",
      ]);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        ledger,
        { generateId, now, sessionLease: TEST_SESSION_LEASE },
      );
      const original = handle.text();
      const candidate = {
        ...ledger,
        trades: [...ledger.trades, createTrade(3)],
      };
      if (stage === "write") handle.failNextWrite = true;
      if (stage === "close") handle.failNextClose = true;

      await expect(repository.save(candidate)).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.WRITE_FAILED,
      });
      expect(handle.text()).toBe(original);

      await repository.save(candidate);
      const result = await readVerifiedFile(handle);
      expect(result.file.current.revisionId).toBe("revision-b");
      expect(result.current.savedAt).toBe("2026-07-28T10:01:00.000Z");
      expect(generateId).toHaveBeenCalledTimes(3);
      expect(now).toHaveBeenCalledTimes(2);
    },
    15_000,
  );

  it("confirms an already-written pending revision on retry without writing a new generation", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(3);
    const generateId = createIdGenerator([
      "file-a",
      "revision-a",
      "revision-b",
    ]);
    const now = createClock([
      "2026-07-28T10:00:00.000Z",
      "2026-07-28T10:01:00.000Z",
    ]);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      { generateId, now, sessionLease: TEST_SESSION_LEASE },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(3)],
    };
    handle.failReadAfterClose = true;

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    expect(handle.writeCount).toBe(2);

    await repository.save(candidate);
    expect(handle.writeCount).toBe(2);
    const result = await readVerifiedFile(handle);
    expect(result.file.current.revisionId).toBe("revision-b");
    expect(result.current.ledgerData.trades).toHaveLength(4);
    expect(generateId).toHaveBeenCalledTimes(3);
  });

  it("rejects a create readback that was re-encrypted outside the exact write intent", async () => {
    const handle = new AtomicLedgerHandle();
    handle.mutateAfterClose = reencryptCurrentWithSamePlaintext;

    await expect(
      LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        createLedgerWithTrades(1),
        {
          generateId: createIdGenerator(["file-a", "revision-a"]),
          now: createClock(["2026-07-28T10:00:00.000Z"]),
          sessionLease: createSessionLease(
            "create-exact-generation",
          ),
        },
      ),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    expect((await readVerifiedFile(handle)).file.current.revisionId).toBe(
      "revision-a",
    );
  });

  it("rejects a save readback that has the same payload but a different encrypted current generation", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: createSessionLease(
          "save-exact-generation",
        ),
      },
    );
    handle.mutateAfterClose = reencryptCurrentWithSamePlaintext;

    await expect(
      repository.save({
        ...ledger,
        trades: [...ledger.trades, createTrade(1)],
      }),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    await expect(repository.load()).resolves.toEqual(ledger);
    expect((await readVerifiedFile(handle)).file.current.revisionId).toBe(
      "revision-b",
    );
  });

  it("rejects create when close-after-readback sees a valid but different on-disk salt", async () => {
    const handle = new AtomicLedgerHandle();
    handle.mutateAfterClose = (serialized) =>
      replaceLedgerFileSalt(serialized);

    await expect(
      LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        createLedgerWithTrades(1),
        {
          generateId: createIdGenerator(["file-a", "revision-a"]),
          now: createClock(["2026-07-28T10:00:00.000Z"]),
          sessionLease: TEST_SESSION_LEASE,
        },
      ),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
    });

    await expect(
      LedgerFileRepository.open(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        { sessionLease: TEST_SESSION_LEASE },
      ),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
    });
  });

  it("rejects save salt drift without advancing the last verified ledger", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    };
    handle.mutateAfterClose = (serialized) =>
      replaceLedgerFileSalt(serialized);

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
    });
    await expect(repository.load()).resolves.toEqual(ledger);

    const diskFile = JSON.parse(handle.text()) as LedgerFileV2;
    expect(diskFile.current.revisionId).toBe("revision-b");
    expect(handle.writeCount).toBe(2);
  });

  it("rejects pending-intent reconcile salt drift, retains the intent, and creates no extra generation", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    };
    handle.failReadAfterClose = true;

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    const committedBeforeDrift = handle.text();
    replacePublishedLedgerFile(
      handle,
      replaceLedgerFileSalt(committedBeforeDrift),
    );

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    });
    await expect(repository.load()).resolves.toEqual(ledger);
    expect(handle.writeCount).toBe(2);
    expect(
      (JSON.parse(handle.text()) as LedgerFileV2).current.revisionId,
    ).toBe("revision-b");

    replacePublishedLedgerFile(handle, committedBeforeDrift);
    await repository.save(candidate);
    expect(handle.writeCount).toBe(2);
    expect(
      (await readVerifiedFile(handle)).file.current.revisionId,
    ).toBe("revision-b");
  });

  it("classifies malformed external bytes during pending reconcile as an external change with zero writes", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger,
      {
        generateId: createIdGenerator([
          "file-a",
          "revision-a",
          "revision-b",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: createSessionLease(
          "pending-malformed-external",
        ),
      },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(1)],
    };
    handle.failReadAfterClose = true;

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    const exactPendingIntent = handle.text();
    const writesBeforeExternalChange = handle.writeCount;
    replacePublishedLedgerFile(handle, "{");

    await expect(repository.save(candidate)).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    });
    expect(handle.writeCount).toBe(writesBeforeExternalChange);
    expect(handle.text()).toBe("{");
    await expect(repository.load()).resolves.toEqual(ledger);

    replacePublishedLedgerFile(handle, exactPendingIntent);
    await repository.save(candidate);
    expect(handle.writeCount).toBe(writesBeforeExternalChange);
    await expect(repository.load()).resolves.toEqual(candidate);
  });

  it.each([
    [
      "fileId",
      (serialized: string) => {
        const file = JSON.parse(serialized) as LedgerFileV2;
        return JSON.stringify({ ...file, fileId: "different-file" });
      },
    ],
    [
      "revision chain",
      (serialized: string) => {
        const file = JSON.parse(serialized) as LedgerFileV2;
        return JSON.stringify({
          ...file,
          current: {
            ...file.current,
            parentRevisionId: "unexpected-parent",
          },
        });
      },
    ],
    [
      "current authentication",
      (serialized: string) => {
        const file = JSON.parse(serialized) as LedgerFileV2;
        return JSON.stringify({
          ...file,
          current: {
            ...file.current,
            ciphertextBase64Url: bytesToBase64Url(
              new Uint8Array(16).fill(4),
            ),
          },
        });
      },
    ],
    [
      "previous authentication",
      (serialized: string) => {
        const file = JSON.parse(serialized) as LedgerFileV2;
        return JSON.stringify({
          ...file,
          previous: file.previous
            ? {
                ...file.previous,
                ciphertextBase64Url: bytesToBase64Url(
                  new Uint8Array(16).fill(5),
                ),
              }
            : null,
        });
      },
    ],
  ] as const)(
    "does not resolve when close-after-readback detects %s mismatch",
    async (_name, mutate) => {
      const handle = new AtomicLedgerHandle();
      const ledger = createLedgerWithTrades(3);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        ledger,
        {
          generateId: createIdGenerator([
            "file-a",
            "revision-a",
            "revision-b",
          ]),
          now: createClock([
            "2026-07-28T10:00:00.000Z",
            "2026-07-28T10:01:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      handle.mutateAfterClose = mutate;

      await expect(
        repository.save({
          ...ledger,
          trades: [...ledger.trades, createTrade(3)],
        }),
      ).rejects.toBeDefined();
      await expect(repository.load()).resolves.toEqual(ledger);
    },
    15_000,
  );

  it("binds by fileId rather than filename and preserves a byte-copy identity", async () => {
    const first = new AtomicLedgerHandle("same-name.lftl");
    const second = new AtomicLedgerHandle("same-name.lftl");
    await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      first,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator(["file-a", "revision-a"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      second,
      PASSPHRASE,
      createLedgerWithTrades(2),
      {
        generateId: createIdGenerator(["file-b", "revision-b"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );

    expect((await readVerifiedFile(first)).file.fileId).toBe("file-a");
    expect((await readVerifiedFile(second)).file.fileId).toBe("file-b");

    const copy = new AtomicLedgerHandle("renamed-copy.lftl");
    copy.bytes = first.bytes.slice();
    const opened = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      copy,
      PASSPHRASE,
      {
        expectedFileId: "file-a",
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await expect(opened.load()).resolves.toEqual(createLedgerWithTrades(1));
    expect((await readVerifiedFile(copy)).file.fileId).toBe("file-a");
  });

  it(
    "offers an explicit recovery candidate and restores exactly the independently verified previous generation",
    async () => {
      const { handle, ledger301, published302 } =
        await createTwoGenerationLedgerFile();
      const publishedFile = JSON.parse(published302) as LedgerFileV2;
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const recoveryLease = createSessionLease("recovery-success");

      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          expectedFileId: "file-recovery",
          generateId: createIdGenerator(["revision-recovered"]),
          now: createClock(["2026-07-28T10:02:00.000Z"]),
          sessionLease: recoveryLease,
        },
      );

      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;
      const recovered = await opened.candidate.confirm();
      await expect(recovered.load()).resolves.toEqual(ledger301);
      const verified = await readVerifiedFile(handle);
      expect(verified.current.ledgerData).toEqual(ledger301);
      expect(verified.current.savedAt).toBe(
        "2026-07-28T10:02:00.000Z",
      );
      expect(verified.file.current.revisionId).toBe(
        "revision-recovered",
      );
      expect(verified.file.current.parentRevisionId).toBe(
        "revision-301",
      );
      expect(verified.file.previous).toEqual(
        publishedFile.previous,
      );
      expect(verified.previous?.ledgerData).toEqual(ledger301);
      expect(handle.writeCount).toBe(3);
    },
    15_000,
  );

  it(
    "cancels a recovery candidate with zero writes and releases its own lease",
    async () => {
      const { handle, published302 } =
        await createTwoGenerationLedgerFile();
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const recoveryLease = createSessionLease("recovery-cancel");
      const writesBeforeCancel = handle.writeCount;
      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          sessionLease: recoveryLease,
        },
      );
      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;

      await opened.candidate.cancel();

      expect(handle.writeCount).toBe(writesBeforeCancel);
      expect(recoveryLease.release).toHaveBeenCalledOnce();
    },
    15_000,
  );

  it(
    "requires a valid previous generation and never turns a wrong password into a recovery oracle",
    async () => {
      const { handle, published302 } =
        await createTwoGenerationLedgerFile();

      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      await expect(
        LedgerFileRepository.openForAccess(
          new LedgerFileHandleAdapter(),
          handle,
          "wrong password that is long enough",
          {
            sessionLease: createSessionLease(
              "recovery-wrong-password",
            ),
          },
        ),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      });

      replacePublishedLedgerFile(
        handle,
        corruptPreviousCiphertext(published302),
      );
      await expect(
        LedgerFileRepository.openForAccess(
          new LedgerFileHandleAdapter(),
          handle,
          PASSPHRASE,
          {
            sessionLease: createSessionLease(
              "recovery-invalid-previous",
            ),
          },
        ),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      });
    },
    15_000,
  );

  it(
    "rejects every ineligible recovery source with zero writes",
    async () => {
      const adapter = new LedgerFileHandleAdapter();
      const oneGenerationHandle = new AtomicLedgerHandle();
      await LedgerFileRepository.create(
        adapter,
        oneGenerationHandle,
        PASSPHRASE,
        createLedgerWithTrades(1),
        {
          generateId: createIdGenerator([
            "file-one-generation",
            "revision-one-generation",
          ]),
          now: createClock(["2026-07-28T10:00:00.000Z"]),
          sessionLease: createSessionLease(
            "recovery-matrix-one-generation-create",
          ),
        },
      );
      replacePublishedLedgerFile(
        oneGenerationHandle,
        corruptCurrentCiphertext(oneGenerationHandle.text()),
      );
      const oneGenerationWrites = oneGenerationHandle.writeCount;
      await expect(
        LedgerFileRepository.openForAccess(
          adapter,
          oneGenerationHandle,
          PASSPHRASE,
          {
            sessionLease: createSessionLease(
              "recovery-matrix-no-previous",
            ),
          },
        ),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      });
      expect(oneGenerationHandle.writeCount).toBe(
        oneGenerationWrites,
      );

      const { handle, published302 } =
        await createTwoGenerationLedgerFile();
      const verified302 = await readVerifiedFile(handle);
      const previousValidatorFailure = JSON.stringify({
        ...verified302.previous,
        ledgerData: {
          ...verified302.previous!.ledgerData,
          schemaVersion: 1,
        },
      });
      const previousResourceFailure = JSON.stringify({
        ...verified302.previous,
        ledgerData: {
          ...verified302.previous!.ledgerData,
          trades: [
            {
              ...verified302.previous!.ledgerData.trades[0],
              note: "x".repeat(4_097),
            },
          ],
        },
      });
      const publishedFile = JSON.parse(published302) as LedgerFileV2;
      const ineligibleCases: Array<{
        name: string;
        serialized: string;
        expectedFileId?: string;
        code: string;
      }> = [
        {
          name: "both generations fail authentication",
          serialized: corruptPreviousCiphertext(
            corruptCurrentCiphertext(published302),
          ),
          code:
            LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        },
        {
          name: "expected file identity differs",
          serialized: corruptCurrentCiphertext(published302),
          expectedFileId: "different-file-id",
          code: LEDGER_FILE_REPOSITORY_ERROR_CODES.FILE_ID_MISMATCH,
        },
        {
          name: "revision chain is not adjacent",
          serialized: JSON.stringify({
            ...publishedFile,
            current: {
              ...publishedFile.current,
              parentRevisionId: "untrusted-parent",
            },
          }),
          code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
        },
        {
          name: "crypto metadata no longer authenticates the source",
          serialized: replaceLedgerFileSalt(
            corruptCurrentCiphertext(published302),
          ),
          code:
            LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        },
        {
          name: "previous fails the ledger validator",
          serialized: corruptCurrentCiphertext(
            await replacePreviousPlaintext(
              published302,
              previousValidatorFailure,
            ),
          ),
          code:
            LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        },
        {
          name: "previous exceeds the resource policy",
          serialized: corruptCurrentCiphertext(
            await replacePreviousPlaintext(
              published302,
              previousResourceFailure,
            ),
          ),
          code:
            LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        },
      ];

      for (const recoveryCase of ineligibleCases) {
        replacePublishedLedgerFile(handle, recoveryCase.serialized);
        const writesBeforeOpen = handle.writeCount;
        await expect(
          LedgerFileRepository.openForAccess(
            adapter,
            handle,
            PASSPHRASE,
            {
              expectedFileId: recoveryCase.expectedFileId,
              sessionLease: createSessionLease(
                `recovery-matrix-${recoveryCase.name}`,
              ),
            },
          ),
          recoveryCase.name,
        ).rejects.toMatchObject({ code: recoveryCase.code });
        expect(
          handle.writeCount,
          recoveryCase.name,
        ).toBe(writesBeforeOpen);
      }
    },
    30_000,
  );

  it(
    "offers recovery for authenticated current JSON, Validator, and ResourcePolicy failures",
    async () => {
      const { handle, published302 } =
        await createTwoGenerationLedgerFile();
      const verified302 = await readVerifiedFile(handle);
      const invalidValidatorPayload = JSON.stringify({
        ...verified302.current,
        ledgerData: {
          ...verified302.current.ledgerData,
          schemaVersion: 1,
        },
      });
      const oversizedPayload = JSON.stringify({
        ...verified302.current,
        ledgerData: {
          ...verified302.current.ledgerData,
          trades: [
            {
              ...verified302.current.ledgerData.trades[0],
              note: "x".repeat(4_097),
            },
          ],
        },
      });
      const damagedFiles = [
        await replaceCurrentPlaintext(published302, "{"),
        await replaceCurrentPlaintext(
          published302,
          invalidValidatorPayload,
        ),
        await replaceCurrentPlaintext(
          published302,
          oversizedPayload,
        ),
      ];

      for (const [index, damaged] of damagedFiles.entries()) {
        replacePublishedLedgerFile(handle, damaged);
        const opened = await LedgerFileRepository.openForAccess(
          new LedgerFileHandleAdapter(),
          handle,
          PASSPHRASE,
          {
            sessionLease: createSessionLease(
              `recovery-payload-${index}`,
            ),
          },
        );
        expect(opened.status).toBe("recovery-required");
        if (opened.status === "recovery-required") {
          await opened.candidate.cancel();
        }
      }
    },
    15_000,
  );

  it(
    "stops recovery with zero writes when the exact prompted baseline changes",
    async () => {
      const { handle, published302 } =
        await createTwoGenerationLedgerFile();
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          generateId: createIdGenerator(["revision-recovered"]),
          now: createClock(["2026-07-28T10:02:00.000Z"]),
          sessionLease: createSessionLease(
            "recovery-external-change",
          ),
        },
      );
      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;
      const writesBeforeConfirm = handle.writeCount;
      replacePublishedLedgerFile(handle, published302);

      await expect(opened.candidate.confirm()).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
      });
      expect(handle.writeCount).toBe(writesBeforeConfirm);
      expect(handle.text()).toBe(published302);
      await opened.candidate.cancel();
    },
    15_000,
  );

  it(
    "reconciles the same recovery intent after close succeeded but readback was not confirmed",
    async () => {
      const { handle, ledger301, published302 } =
        await createTwoGenerationLedgerFile();
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          generateId: createIdGenerator(["revision-recovered"]),
          now: createClock(["2026-07-28T10:02:00.000Z"]),
          sessionLease: createSessionLease("recovery-reconcile"),
        },
      );
      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;
      handle.failReadAfterClose = true;

      await expect(opened.candidate.confirm()).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
      });
      expect(handle.writeCount).toBe(3);
      const recovered = await opened.candidate.confirm();

      expect(handle.writeCount).toBe(3);
      await expect(recovered.load()).resolves.toEqual(ledger301);
      expect((await readVerifiedFile(handle)).file.current.revisionId).toBe(
        "revision-recovered",
      );
    },
    15_000,
  );

  it(
    "rejects recovery readback when an outside writer re-encrypts the same recovered payload",
    async () => {
      const { handle, ledger301, published302 } =
        await createTwoGenerationLedgerFile();
      replacePublishedLedgerFile(
        handle,
        corruptCurrentCiphertext(published302),
      );
      const opened = await LedgerFileRepository.openForAccess(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          generateId: createIdGenerator(["revision-recovered"]),
          now: createClock(["2026-07-28T10:02:00.000Z"]),
          sessionLease: createSessionLease(
            "recovery-exact-generation",
          ),
        },
      );
      expect(opened.status).toBe("recovery-required");
      if (opened.status !== "recovery-required") return;
      handle.mutateAfterClose = reencryptCurrentWithSamePlaintext;

      await expect(opened.candidate.confirm()).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
      });
      expect((await readVerifiedFile(handle)).current.ledgerData).toEqual(
        ledger301,
      );
      await opened.candidate.cancel();
    },
    15_000,
  );

  it(
    "re-reads before no-op and refuses to overwrite an externally saved R302",
    async () => {
      const handle = new AtomicLedgerHandle();
      const ledger301 = createLedgerWithTrades(3);
      const staleRepository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        ledger301,
        {
          generateId: createIdGenerator([
            "file-external",
            "revision-301",
          ]),
          now: createClock(["2026-07-28T10:00:00.000Z"]),
          sessionLease: createSessionLease("stale-page"),
        },
      );
      const externalRepository = await LedgerFileRepository.open(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          generateId: createIdGenerator(["revision-302"]),
          now: createClock(["2026-07-28T10:01:00.000Z"]),
          sessionLease: createSessionLease("external-program"),
        },
      );
      const ledger302 = {
        ...ledger301,
        trades: [...ledger301.trades, createTrade(3, "ETH")],
      };
      await externalRepository.save(ledger302);
      const disk302 = handle.text();
      const writesAfterExternal = handle.writeCount;

      await expect(
        staleRepository.save(structuredClone(ledger301)),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
      });

      expect(handle.writeCount).toBe(writesAfterExternal);
      expect(handle.text()).toBe(disk302);
      await expect(externalRepository.load()).resolves.toEqual(
        ledger302,
      );
      await expect(staleRepository.load()).resolves.toEqual(ledger301);
    },
    15_000,
  );

  it("keeps generic clear fail-closed without writing", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator(["file-a", "revision-a"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );

    await expect(repository.clear()).rejects.toMatchObject({
      code: "LEDGER_REPOSITORY_CLEAR_FAILED",
    });
    expect(handle.writeCount).toBe(1);
  });

  it("forces an authorized ready clear into a new verified current while preserving the prior current as previous", async () => {
    const handle = new AtomicLedgerHandle();
    const originalLedger = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      originalLedger,
      {
        generateId: createIdGenerator([
          "file-clear",
          "revision-before-clear",
          "revision-after-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const before = JSON.parse(handle.text()) as LedgerFileV2;
    expect(
      repository.authorizeReadyClear({
        sessionId: "forged-direct-call",
        generation: 0,
        confirmationNonce: "清空当前C账本",
      }),
    ).toBeNull();
    const session = createReadyClearSession(
      repository,
      "ready-clear-session",
    );
    expect(
      session.readyClearPort?.authorizeReadyClear("任意非空文本"),
    ).toBeNull();
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;

    const writesBeforeClear = handle.writeCount;
    await expect(
      invokeRawReadyClear(
        repository,
        authorization,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    await expect(
      invokeRawReadyClear(
        repository,
        authorization,
        {
          sessionId: session.sessionId,
          generation: session.generation,
        },
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(writesBeforeClear);
    await session.readyClearPort.clearReadyLedger(authorization);

    const after = JSON.parse(handle.text()) as LedgerFileV2;
    expect(after.fileId).toBe(before.fileId);
    expect(after.crypto).toEqual(before.crypto);
    expect(after.current.revisionId).toBe(
      "revision-after-clear",
    );
    expect(after.current.parentRevisionId).toBe(
      "revision-before-clear",
    );
    expect(after.previous).toEqual(before.current);
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(2);
  });

  it("forces a new revision, IV, and savedAt even when the current ledger is already empty", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-empty-clear",
          "revision-empty-before",
          "revision-empty-after",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const before = await readVerifiedFile(handle);
    const session = createReadyClearSession(
      repository,
      "ready-empty-clear",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;

    await session.readyClearPort.clearReadyLedger(authorization);

    const after = await readVerifiedFile(handle);
    expect(after.file.current.revisionId).toBe(
      "revision-empty-after",
    );
    expect(after.file.current.ivBase64Url).not.toBe(
      before.file.current.ivBase64Url,
    );
    expect(after.current.savedAt).toBe(
      "2026-07-28T10:01:00.000Z",
    );
    expect(after.file.previous).toEqual(before.file.current);
    expect(handle.writeCount).toBe(2);
  });

  it("clears only the selected C and the same file reopens with the verified empty current", async () => {
    const selectedHandle = new AtomicLedgerHandle("selected.lftl");
    const otherHandle = new AtomicLedgerHandle("other.lftl");
    const selected = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      selectedHandle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "selected-file",
          "selected-before",
          "selected-after",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const otherLedger = createLedgerWithTrades(2);
    const other = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      otherHandle,
      PASSPHRASE,
      otherLedger,
      {
        generateId: createIdGenerator([
          "other-file",
          "other-revision",
        ]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const otherBefore = otherHandle.bytes.slice();
    const session = createReadyClearSession(
      selected,
      "selected-clear-session",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;

    await session.readyClearPort.clearReadyLedger(authorization);

    expect(otherHandle.bytes).toEqual(otherBefore);
    await expect(other.load()).resolves.toEqual(otherLedger);
    const reopened = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      selectedHandle,
      PASSPHRASE,
      {
        expectedFileId: "selected-file",
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await expect(reopened.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
    expect(selectedHandle.name).toBe("selected.lftl");
  });

  it("rejects stale and cross-repository clear authorizations with zero clear writes", async () => {
    const firstHandle = new AtomicLedgerHandle("first.lftl");
    const secondHandle = new AtomicLedgerHandle("second.lftl");
    const first = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      firstHandle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-first",
          "revision-first",
          "revision-first-save",
          "unused-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const second = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      secondHandle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-second",
          "revision-second",
        ]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const firstSession = createReadyClearSession(
      first,
      "ready-clear-session",
    );
    const secondSession = createReadyClearSession(
      second,
      "ready-clear-second-session",
    );
    const authorization =
      firstSession.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(authorization).not.toBeNull();
    if (
      !authorization ||
      !firstSession.readyClearPort ||
      !secondSession.readyClearPort
    ) {
      return;
    }

    expect(() =>
      secondSession.readyClearPort?.clearReadyLedger(
        authorization,
      ),
    ).toThrow(LedgerSessionLifecycleError);
    await first.save(createLedgerWithTrades(2));
    const writesAfterSave = firstHandle.writeCount;
    await expect(
      firstSession.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    expect(firstHandle.writeCount).toBe(writesAfterSave);
    expect(secondHandle.writeCount).toBe(1);
  });

  it("rejects a raw ready clear after quiesce even when its authorization was valid before lock", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-clear-after-quiesce",
          "revision-before-quiesce",
          "unused-clear-revision",
        ]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const session = createReadyClearSession(
      repository,
      "ready-clear-after-quiesce",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    const writesBeforeQuiesce = handle.writeCount;

    session.beginQuiesce("immediate-lock");

    await expect(
      invokeRawReadyClear(
        repository,
        authorization,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    });
    expect(() =>
      session.readyClearPort?.clearReadyLedger(authorization),
    ).toThrow(LedgerSessionLifecycleError);
    expect(handle.writeCount).toBe(writesBeforeQuiesce);
  });

  it("reconciles the same clear intent after an uncertain readback without creating another generation", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-clear-retry",
          "revision-before-clear",
          "revision-clear-intent",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const session = createReadyClearSession(
      repository,
      "ready-clear-retry",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    handle.failReadAfterClose = true;

    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    const committedButUnconfirmed = handle.text();
    const writesAfterUncertainReadback = handle.writeCount;

    await session.readyClearPort.clearReadyLedger(authorization);

    expect(handle.writeCount).toBe(writesAfterUncertainReadback);
    expect(handle.text()).toBe(committedButUnconfirmed);
    const file = JSON.parse(handle.text()) as LedgerFileV2;
    expect(file.current.revisionId).toBe("revision-clear-intent");
    expect(file.previous?.revisionId).toBe(
      "revision-before-clear",
    );
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it.each(["write", "close"] as const)(
    "does not publish clear success after a %s failure and retries the same intent",
    async (failure) => {
      const handle = new AtomicLedgerHandle();
      const original = createLedgerWithTrades(1);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        original,
        {
          generateId: createIdGenerator([
            `file-clear-${failure}-failure`,
            "revision-before-clear",
            "revision-clear-intent",
          ]),
          now: createClock([
            "2026-07-28T10:00:00.000Z",
            "2026-07-28T10:01:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const baseBytes = handle.bytes.slice();
      const session = createReadyClearSession(
        repository,
        `ready-clear-${failure}-failure`,
      );
      const authorization =
        session.readyClearPort?.authorizeReadyClear(
          "清空当前C账本",
        );
      expect(authorization).not.toBeNull();
      if (!authorization || !session.readyClearPort) return;
      if (failure === "write") {
        handle.failNextWrite = true;
      } else {
        handle.failNextClose = true;
      }

      await expect(
        session.readyClearPort.clearReadyLedger(authorization),
      ).rejects.toMatchObject({
        code: LEDGER_FILE_REPOSITORY_ERROR_CODES.WRITE_FAILED,
      });
      expect(handle.bytes).toEqual(baseBytes);
      await expect(repository.load()).resolves.toEqual(original);
      const retryAuthorization =
        session.readyClearPort.authorizeReadyClear(
          "清空当前C账本",
        );
      expect(retryAuthorization).toBe(authorization);
      if (!retryAuthorization) return;

      await session.readyClearPort.clearReadyLedger(
        retryAuthorization,
      );
      const verified = await readVerifiedFile(handle);
      expect(verified.file.current.revisionId).toBe(
        "revision-clear-intent",
      );
      expect(verified.file.previous?.revisionId).toBe(
        "revision-before-clear",
      );
      expect(verified.current.ledgerData).toEqual(
        createInitialLedgerData(),
      );
    },
  );

  it("reuses the same authorization when clear fails before creating an intent", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-clear-pre-intent-retry",
          "revision-before-clear",
          "revision-after-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const session = createReadyClearSession(
      repository,
      "ready-clear-pre-intent-retry",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    handle.failNextRead = true;

    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
    });
    const retriedAuthorization =
      session.readyClearPort.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(retriedAuthorization).toBe(authorization);
    if (!retriedAuthorization) return;

    await session.readyClearPort.clearReadyLedger(
      retriedAuthorization,
    );
    expect(handle.writeCount).toBe(2);
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("keeps a lease-rejected clear at zero writes and permits only the same authorized retry", async () => {
    let rejectNextExclusiveWrite = false;
    const lease: LedgerFileSessionLease = {
      sessionId: "clear-lease-retry",
      runExclusiveWrite: async (operation) => {
        if (rejectNextExclusiveWrite) {
          rejectNextExclusiveWrite = false;
          throw new Error("lease rejected clear");
        }
        return operation();
      },
      release: async () => undefined,
    };
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator([
          "file-clear-lease-retry",
          "revision-before-clear",
          "revision-after-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:01:00.000Z",
        ]),
        sessionLease: lease,
      },
    );
    const session = createReadyClearSession(
      repository,
      "ready-clear-lease-retry",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    rejectNextExclusiveWrite = true;
    const writesBeforeClear = handle.writeCount;

    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toThrow("lease rejected clear");
    expect(handle.writeCount).toBe(writesBeforeClear);
    const retryAuthorization =
      session.readyClearPort.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(retryAuthorization).toBe(authorization);
    if (!retryAuthorization) return;

    await session.readyClearPort.clearReadyLedger(
      retryAuthorization,
    );
    expect(handle.writeCount).toBe(writesBeforeClear + 1);
  });

  it("rechecks the disk after clear encryption and preserves a late external revision", async () => {
    const handle = new AtomicLedgerHandle();
    const ledger301 = createLedgerWithTrades(1);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      ledger301,
      {
        generateId: createIdGenerator([
          "file-clear-drift",
          "revision-301",
          "revision-clear",
        ]),
        now: createClock([
          "2026-07-28T10:00:00.000Z",
          "2026-07-28T10:02:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const serialized301 = handle.bytes.slice();
    const externalRepository = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        generateId: createIdGenerator(["revision-302"]),
        now: createClock(["2026-07-28T10:01:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const ledger302 = createLedgerWithTrades(2);
    await externalRepository.save(ledger302);
    const serialized302 = handle.bytes.slice();
    handle.bytes = serialized301;
    const writesBeforeClear = handle.writeCount;
    const session = createReadyClearSession(
      repository,
      "ready-clear-late-drift",
    );
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前C账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;
    handle.mutateBeforeNthRead(2, () => {
      handle.bytes = serialized302;
    });

    await expect(
      session.readyClearPort.clearReadyLedger(authorization),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    });
    expect(handle.writeCount).toBe(writesBeforeClear);
    expect(handle.bytes).toEqual(serialized302);
    await expect(externalRepository.load()).resolves.toEqual(
      ledger302,
    );
  });

  it(
    "imports one exact 300-trade B into a new empty C and reopens the verified two-generation file",
    async () => {
      const handle = new AtomicLedgerHandle("import-300.lftl");
      const initialLedger = createInitialLedgerData();
      const candidate = createLedgerWithTrades(300);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        initialLedger,
        {
          generateId: createIdGenerator([
            "file-import-300",
            "revision-empty",
            "revision-import-300",
          ]),
          now: createClock([
            "2026-07-31T08:00:00.000Z",
            "2026-07-31T08:01:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const before = await readVerifiedFile(handle);
      const session = createReadyImportSession(
        repository,
        "import-300-session",
      );
      const evidence = await createImportEvidence(candidate);
      const authorization =
        session.readyImportPort?.authorizeReadyImport(
          evidence,
          0,
          evidence.candidateIdentity,
        );
      expect(authorization).not.toBeNull();
      if (!authorization || !session.readyImportPort) return;

      await expect(
        session.readyImportPort.importReadyLedger(
          authorization,
          candidate,
          new AbortController().signal,
        ),
      ).resolves.toEqual(candidate);

      const after = await readVerifiedFile(handle);
      expect(after.current.ledgerData).toEqual(candidate);
      expect(after.current.ledgerData.trades).toHaveLength(300);
      expect(after.previous?.ledgerData).toEqual(initialLedger);
      expect(after.file.previous).toEqual(before.file.current);
      expect(after.file.current.parentRevisionId).toBe(
        "revision-empty",
      );
      expect(after.file.current.revisionId).toBe(
        "revision-import-300",
      );
      expect(handle.writeCount).toBe(2);

      const reopened = await LedgerFileRepository.open(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        {
          expectedFileId: "file-import-300",
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      await expect(reopened.load()).resolves.toEqual(candidate);
    },
    20_000,
  );

  it.each([
    "create-writable",
    "write",
    "close",
    "readback",
  ] as const)(
    "restores and fully verifies the exact pre-import C after a %s failure",
    async (failure) => {
      const handle = new AtomicLedgerHandle(
        `import-${failure}.lftl`,
      );
      const initialLedger = createInitialLedgerData();
      const candidate = createLedgerWithTrades(3);
      const repository = await LedgerFileRepository.create(
        new LedgerFileHandleAdapter(),
        handle,
        PASSPHRASE,
        initialLedger,
        {
          generateId: createIdGenerator([
            `file-import-${failure}`,
            "revision-empty",
            `revision-import-${failure}`,
          ]),
          now: createClock([
            "2026-07-31T08:00:00.000Z",
            "2026-07-31T08:01:00.000Z",
          ]),
          sessionLease: TEST_SESSION_LEASE,
        },
      );
      const baseline = handle.text();
      const before = await readVerifiedFile(handle);
      const session = createReadyImportSession(
        repository,
        `import-${failure}-session`,
      );
      const evidence = await createImportEvidence(candidate);
      const authorization =
        session.readyImportPort?.authorizeReadyImport(
          evidence,
          0,
          evidence.candidateIdentity,
        );
      expect(authorization).not.toBeNull();
      if (!authorization || !session.readyImportPort) return;
      if (failure === "create-writable") {
        handle.failNextCreateWritable = true;
      }
      if (failure === "write") handle.failNextWrite = true;
      if (failure === "close") handle.failNextClose = true;
      if (failure === "readback") {
        handle.failReadAfterClose = true;
      }

      await expect(
        session.readyImportPort.importReadyLedger(
          authorization,
          candidate,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code:
          LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED,
      });

      expect(handle.text()).toBe(baseline);
      expect(handle.bytes).toEqual(
        new TextEncoder().encode(baseline),
      );
      const after = await readVerifiedFile(handle);
      expect(after.file).toEqual(before.file);
      expect(after.current).toEqual(before.current);
      expect(after.previous).toEqual(before.previous);
      await expect(repository.load()).resolves.toEqual(initialLedger);
      const writesAfterFailure = handle.writeCount;
      await expect(
        session.readyImportPort.importReadyLedger(
          authorization,
          candidate,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code:
          LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
      });
      expect(handle.writeCount).toBe(writesAfterFailure);
    },
    20_000,
  );

  it("restores and exactly re-reads the old C when close publishes the candidate and then throws", async () => {
    const handle = new AtomicLedgerHandle(
      "import-close-published-then-failed.lftl",
    );
    const initialLedger = createInitialLedgerData();
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      initialLedger,
      {
        generateId: createIdGenerator([
          "file-import-close-published-then-failed",
          "revision-empty",
          "revision-import-close-published-then-failed",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baselineBytes = handle.bytes.slice();
    const before = await readVerifiedFile(handle);
    const session = createReadyImportSession(
      repository,
      "import-close-published-then-failed-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    const writesBeforeImport = handle.writeCount;
    handle.failAfterNextClosePublish = true;

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED,
    });

    expect(handle.writeCount).toBe(writesBeforeImport + 2);
    expect(handle.bytes).toEqual(baselineBytes);
    const after = await readVerifiedFile(handle);
    expect(after.file).toEqual(before.file);
    expect(after.current).toEqual(before.current);
    expect(after.previous).toEqual(before.previous);
    const reopened = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        expectedFileId:
          "file-import-close-published-then-failed",
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await expect(reopened.load()).resolves.toEqual(initialLedger);
  });

  it("restores and exactly re-reads the old C when cancellation arrives during candidate readback", async () => {
    const handle = new AtomicLedgerHandle(
      "import-cancel-during-readback.lftl",
    );
    const initialLedger = createInitialLedgerData();
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      initialLedger,
      {
        generateId: createIdGenerator([
          "file-import-cancel-during-readback",
          "revision-empty",
          "revision-import-cancel-during-readback",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baselineBytes = handle.bytes.slice();
    const before = await readVerifiedFile(handle);
    const readbackStarted = createDeferred<void>();
    const releaseReadback = createDeferred<void>();
    handle.blockReadAfterNextClose = {
      started: readbackStarted,
      release: releaseReadback,
    };
    const session = createReadyImportSession(
      repository,
      "import-cancel-during-readback-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    const controller = new AbortController();
    const writesBeforeImport = handle.writeCount;

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        controller.signal,
      );
    await readbackStarted.promise;
    expect(handle.bytes).not.toEqual(baselineBytes);
    controller.abort("cancelled during candidate readback");
    releaseReadback.resolve();

    await expect(importPromise).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED,
    });
    expect(handle.writeCount).toBe(writesBeforeImport + 2);
    expect(handle.bytes).toEqual(baselineBytes);
    const after = await readVerifiedFile(handle);
    expect(after.file).toEqual(before.file);
    expect(after.current).toEqual(before.current);
    expect(after.previous).toEqual(before.previous);
    const reopened = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        expectedFileId: "file-import-cancel-during-readback",
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    await expect(reopened.load()).resolves.toEqual(initialLedger);
  });

  it("marks the session recovery-blocked when neither compensation nor final read can prove the old bytes", async () => {
    const handle = new AtomicLedgerHandle("import-blocked.lftl");
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-blocked",
          "revision-empty",
          "revision-import-blocked",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baseline = handle.text();
    const session = createReadyImportSession(
      repository,
      "import-blocked-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    handle.mutateAfterClose = (serialized) => {
      handle.failNextRead = true;
      handle.failNextWrite = true;
      return serialized;
    };

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });

    expect(handle.text()).not.toBe(baseline);
    await expect(repository.load()).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });
    const writesAfterBlocked = handle.writeCount;
    await expect(repository.save(candidate)).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(writesAfterBlocked);
  });

  it("blocks the session when the exact base bytes are present but cannot be fully authenticated during recovery", async () => {
    const decrypt = vi.fn(
      globalThis.crypto.subtle.decrypt.bind(
        globalThis.crypto.subtle,
      ),
    );
    const cryptoProvider = {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
      subtle: {
        importKey: globalThis.crypto.subtle.importKey.bind(
          globalThis.crypto.subtle,
        ),
        deriveKey: globalThis.crypto.subtle.deriveKey.bind(
          globalThis.crypto.subtle,
        ),
        encrypt: globalThis.crypto.subtle.encrypt.bind(
          globalThis.crypto.subtle,
        ),
        decrypt,
      },
    } as unknown as CryptoProvider;
    const handle = new AtomicLedgerHandle(
      "import-base-verification-blocked.lftl",
    );
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        cryptoProvider,
        generateId: createIdGenerator([
          "file-import-base-verification-blocked",
          "revision-empty",
          "revision-import-blocked",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const nativeDecrypt =
      globalThis.crypto.subtle.decrypt.bind(
        globalThis.crypto.subtle,
      );
    decrypt
      .mockImplementationOnce(nativeDecrypt)
      .mockImplementationOnce(nativeDecrypt)
      .mockRejectedValueOnce(
        new Error("recovery authentication unavailable"),
      );
    const baseline = handle.text();
    const session = createReadyImportSession(
      repository,
      "import-base-verification-blocked-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    handle.failNextWrite = true;

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });

    expect(handle.text()).toBe(baseline);
    await expect(repository.load()).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });
    const writesAfterBlocked = handle.writeCount;
    await expect(repository.save(candidate)).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(writesAfterBlocked);
  });

  it("does not compensate over valid but non-exact candidate readback bytes", async () => {
    const handle = new AtomicLedgerHandle(
      "import-non-exact-readback.lftl",
    );
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-non-exact-readback",
          "revision-empty",
          "revision-import-non-exact",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baseline = handle.text();
    const writesBeforeImport = handle.writeCount;
    const session = createReadyImportSession(
      repository,
      "import-non-exact-readback-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    handle.mutateAfterClose = (serialized) => `${serialized}\n`;

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });

    expect(handle.text()).not.toBe(baseline);
    expect(handle.text().endsWith("\n")).toBe(true);
    expect(handle.writeCount).toBe(writesBeforeImport + 1);
    await expect(repository.load()).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    });
  });

  it("revokes an import queued before its write-lock claim when the session quiesces", async () => {
    const lease = new GatedSessionLease();
    const handle = new AtomicLedgerHandle("import-queued.lftl");
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-queued",
          "revision-empty",
          "unused-import-revision",
        ]),
        now: createClock(["2026-07-31T08:00:00.000Z"]),
        sessionLease: lease,
      },
    );
    const writesBeforeImport = handle.writeCount;
    const session = createReadyImportSession(
      repository,
      "import-queued-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    const gate = lease.gateNextOperation();

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    await gate.started;
    session.beginQuiesce("immediate-lock");
    gate.release();

    await expect(importPromise).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    });
    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(handle.closeCount).toBe(writesBeforeImport);
  });

  it("rejects a generic save admitted while import owns the write slot, then allows saves after a verified import completes", async () => {
    const lease = new GatedSessionLease();
    const handle = new AtomicLedgerHandle(
      "import-save-admission.lftl",
    );
    const candidate = createLedgerWithTrades(2);
    const laterCandidate = createLedgerWithTrades(3);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-save-admission",
          "revision-empty",
          "revision-import",
          "revision-later-save",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
          "2026-07-31T08:02:00.000Z",
        ]),
        sessionLease: lease,
      },
    );
    const session = createReadyImportSession(
      repository,
      "import-save-admission-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    const gate = lease.gateNextOperation();
    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    await gate.started;
    const operationCountDuringImport = lease.operationCount;

    await expect(repository.save(laterCandidate)).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    });
    expect(lease.operationCount).toBe(operationCountDuringImport);

    gate.release();
    await expect(importPromise).resolves.toEqual(candidate);
    await expect(repository.save(laterCandidate)).resolves.toBeUndefined();
    await expect(repository.load()).resolves.toEqual(laterCandidate);
    expect(handle.writeCount).toBe(3);
  });

  it("restores the old C when quiesce starts after the candidate close has begun", async () => {
    const handle = new AtomicLedgerHandle("import-active.lftl");
    const candidate = createLedgerWithTrades(2);
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-active",
          "revision-empty",
          "revision-import-active",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baseline = handle.text();
    const closeStarted = createDeferred<void>();
    const releaseClose = createDeferred<void>();
    handle.mutateAfterClose = async (serialized) => {
      closeStarted.resolve();
      await releaseClose.promise;
      return serialized;
    };
    const session = createReadyImportSession(
      repository,
      "import-active-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    await closeStarted.promise;
    session.beginQuiesce("immediate-lock");
    releaseClose.resolve();

    await expect(importPromise).rejects.toMatchObject({
      code:
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED,
    });
    expect(handle.text()).toBe(baseline);
    await expect(repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("rejects non-empty C targets and unconfirmed or hard-error evidence before writable creation", async () => {
    const handle = new AtomicLedgerHandle("import-rejected.lftl");
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-rejected",
          "revision-empty",
          "revision-non-empty",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const candidate = createLedgerWithTrades(2);
    const session = createReadyImportSession(
      repository,
      "import-rejected-session",
    );
    const hardErrorEvidence = await createImportEvidence(candidate, {
      hardErrorCount: 1,
    });
    expect(
      session.readyImportPort?.authorizeReadyImport(
        hardErrorEvidence,
        0,
        hardErrorEvidence.candidateIdentity,
      ),
    ).toBeNull();
    const unconfirmedEvidence = await createImportEvidence(
      candidate,
      {
        suspiciousGroupCount: 1,
        suspiciousGroupIdentity: "groups-a",
      },
    );
    expect(
      session.readyImportPort?.authorizeReadyImport(
        unconfirmedEvidence,
        0,
        unconfirmedEvidence.candidateIdentity,
      ),
    ).toBeNull();
    expect(handle.writeCount).toBe(1);

    await repository.save(createLedgerWithTrades(1));
    const writesAfterSave = handle.writeCount;
    const nonEmptyEvidence = await createImportEvidence(candidate);
    expect(
      session.readyImportPort?.authorizeReadyImport(
        nonEmptyEvidence,
        0,
        nonEmptyEvidence.candidateIdentity,
      ),
    ).toBeNull();
    expect(handle.writeCount).toBe(writesAfterSave);
  });

  it("rejects a structurally valid candidate with forged zero-error evidence when historical rawText is missing", async () => {
    const handle = new AtomicLedgerHandle(
      "import-missing-raw-text.lftl",
    );
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: createIdGenerator([
          "file-import-missing-raw-text",
          "revision-empty",
          "unused-import-revision",
        ]),
        now: createClock(["2026-07-31T08:00:00.000Z"]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const candidate = createLedgerWithTrades(2);
    delete candidate.trades[1].rawText;
    const evidence = await createImportEvidence(candidate);
    const session = createReadyImportSession(
      repository,
      "import-missing-raw-text-session",
    );
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    const writesBeforeImport = handle.writeCount;
    expect(authorization).toBeNull();
    expect(handle.writeCount).toBe(writesBeforeImport);
  });

  it("re-reads after import encryption and preserves a late external revision with zero import writes", async () => {
    const handle = new AtomicLedgerHandle(
      "import-late-external.lftl",
    );
    const initialLedger = createInitialLedgerData();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      initialLedger,
      {
        generateId: createIdGenerator([
          "file-import-late-external",
          "revision-empty",
          "unused-import-revision",
        ]),
        now: createClock([
          "2026-07-31T08:00:00.000Z",
          "2026-07-31T08:02:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const baseline = handle.bytes.slice();
    const externalRepository = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      {
        generateId: createIdGenerator([
          "revision-external",
        ]),
        now: createClock([
          "2026-07-31T08:01:00.000Z",
        ]),
        sessionLease: TEST_SESSION_LEASE,
      },
    );
    const externalLedger = createLedgerWithTrades(1);
    await externalRepository.save(externalLedger);
    const externalBytes = handle.bytes.slice();
    handle.bytes = baseline;
    const writesBeforeImport = handle.writeCount;
    const candidate = createLedgerWithTrades(2);
    const session = createReadyImportSession(
      repository,
      "import-late-external-session",
    );
    const evidence = await createImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;
    handle.mutateBeforeNthRead(2, () => {
      handle.bytes = externalBytes;
    });

    await expect(
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    });
    expect(handle.writeCount).toBe(writesBeforeImport);
    expect(handle.bytes).toEqual(externalBytes);
    await expect(externalRepository.load()).resolves.toEqual(
      externalLedger,
    );
  });
});
