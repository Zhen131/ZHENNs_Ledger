import { describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "../adapters/ledgerFileHandleAdapter";
import { bytesToBase64Url } from "../encryption/cryptoEncoding";
import {
  type DecryptedLedgerPayloadV1,
  type LedgerFileV1,
  validateDecryptedLedgerPayloadV1,
  validateLedgerFileV1,
} from "../encryption/ledgerFileContract";
import { LedgerFileCrypto } from "../encryption/ledgerFileCrypto";
import type { LedgerData, Trade } from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepository,
} from "./ledgerFileRepository";

const PASSPHRASE = "correct horse battery staple";

class AtomicLedgerHandle implements LedgerFileHandle {
  bytes = new Uint8Array();
  writeCount = 0;
  closeCount = 0;
  failNextWrite = false;
  failNextClose = false;
  failNextRead = false;
  mutateAfterClose: ((serialized: string) => string) | null = null;

  constructor(readonly name = "ledger.lftl") {}

  async getFile() {
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

  async createWritable(): Promise<LedgerFileWritable> {
    let pending: Uint8Array | null = null;
    return {
      write: async (serialized) => {
        this.writeCount += 1;
        if (this.failNextWrite) {
          this.failNextWrite = false;
          throw new Error("write failed");
        }
        pending = new TextEncoder().encode(serialized);
      },
      close: async () => {
        this.closeCount += 1;
        if (this.failNextClose) {
          this.failNextClose = false;
          throw new Error("close failed");
        }
        if (pending) {
          const serialized = new TextDecoder().decode(pending);
          const published = this.mutateAfterClose
            ? this.mutateAfterClose(serialized)
            : serialized;
          this.mutateAfterClose = null;
          this.bytes = new TextEncoder().encode(published);
        }
      },
      abort: async () => {
        pending = null;
      },
    };
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
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
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

async function readVerifiedFile(
  handle: AtomicLedgerHandle,
): Promise<{
  file: LedgerFileV1;
  current: DecryptedLedgerPayloadV1;
  previous: DecryptedLedgerPayloadV1 | null;
}> {
  const parsed: unknown = JSON.parse(handle.text());
  const validated = validateLedgerFileV1(parsed);
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

function parsePayload(serialized: string): DecryptedLedgerPayloadV1 {
  const result = validateDecryptedLedgerPayloadV1(JSON.parse(serialized));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("invalid test payload");
  return result.value.value;
}

describe("LedgerFileRepository", () => {
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
        { generateId, now },
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
      { generateId, now },
    );
    const original = handle.text();

    await repository.save(structuredClone(ledger));

    expect(handle.text()).toBe(original);
    expect(handle.writeCount).toBe(1);
    expect(generateId).toHaveBeenCalledTimes(2);
    expect(now).toHaveBeenCalledOnce();
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
      },
    );
    const original = handle.text();

    await expect(
      repository.save({
        ...ledger,
        schemaVersion: 2,
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
        { generateId, now },
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
      { generateId, now },
    );
    const candidate = {
      ...ledger,
      trades: [...ledger.trades, createTrade(3)],
    };
    handle.failNextRead = true;

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

  it.each([
    [
      "fileId",
      (serialized: string) => {
        const file = JSON.parse(serialized) as LedgerFileV1;
        return JSON.stringify({ ...file, fileId: "different-file" });
      },
    ],
    [
      "revision chain",
      (serialized: string) => {
        const file = JSON.parse(serialized) as LedgerFileV1;
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
        const file = JSON.parse(serialized) as LedgerFileV1;
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
        const file = JSON.parse(serialized) as LedgerFileV1;
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
      { expectedFileId: "file-a" },
    );
    await expect(opened.load()).resolves.toEqual(createLedgerWithTrades(1));
    expect((await readVerifiedFile(copy)).file.fileId).toBe("file-a");
  });

  it("rejects clear at both the repository and file adapter boundary without writing", async () => {
    const handle = new AtomicLedgerHandle();
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createLedgerWithTrades(1),
      {
        generateId: createIdGenerator(["file-a", "revision-a"]),
        now: createClock(["2026-07-28T10:00:00.000Z"]),
      },
    );

    await expect(repository.clear()).rejects.toMatchObject({
      code: "LEDGER_REPOSITORY_CLEAR_FAILED",
    });
    expect(handle.writeCount).toBe(1);
  });
});
