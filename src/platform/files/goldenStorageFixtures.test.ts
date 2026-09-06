import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseBackupJson } from "@/features/backup";
import {
  GOLDEN_LEDGER_FILE_V2_PASSPHRASE,
  GOLDEN_LEDGER_FILE_V3_PASSPHRASE,
} from "@/test-support";
import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
} from "./ledgerFileHandleAdapter";
import {
  inspectLedgerFile,
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepository,
} from "./ledgerFileRepository";
import type { LedgerFileSessionLease } from "./ledgerFileSessionLease";

const GOLDEN_BACKUP_URL = new URL(
  "../../../test-fixtures/golden/golden-backup-format-v3-ledger-schema-v4-rich.json",
  import.meta.url,
);
const GOLDEN_LEDGER_FILE_URL = new URL(
  "../../../test-fixtures/golden/golden-ledger-file-format-v2-crypto-v1-ledger-schema-v4.lftl",
  import.meta.url,
);
const GOLDEN_LEDGER_FILE_V3_URL = new URL(
  "../../../test-fixtures/golden/golden-ledger-file-format-v3-crypto-v1-ledger-schema-v4.lftl",
  import.meta.url,
);
const GOLDEN_BACKUP_SHA256 =
  "b8ffaedf8b4d74b1636aac17401a30fe4c7011d7db5179f2bfbc9bee8060aa3c";
const GOLDEN_LEDGER_FILE_SHA256 =
  "d143d621cb2dbb4404d254114294132a54213c70fbd445c6bc0fb49b42447427";
const GOLDEN_LEDGER_FILE_V3_SHA256 =
  "116bbeab8d8a9c610bd2946319dbcc1d243264601a772d0f8c78dd15704f0668";
const GOLDEN_LEDGER_FILE_V5_URL = new URL(
  "../../../test-fixtures/golden/golden-ledger-file-format-v3-crypto-v1-ledger-schema-v5-time-zone.lftl",
  import.meta.url,
);
const GOLDEN_LEDGER_FILE_V5_SHA256 =
  "7a02c017f3f7edc3b54ffb52620aebd7a4057a71cf0afe63e00f6db91701ca65";
const GOLDEN_LEDGER_FILE_V5_PASSPHRASE =
  "W16-Golden-V5-Fictional-Ledger";

const TEST_SESSION_LEASE: LedgerFileSessionLease = {
  sessionId: "golden-storage-fixture-test",
  runExclusiveWrite: (operation) => operation(),
  release: async () => undefined,
};

class ReadOnlyGoldenLedgerHandle implements LedgerFileHandle {
  writeAttempts = 0;

  constructor(
    private readonly bytes: Uint8Array,
    readonly name = "golden-ledger-file-format-v2-crypto-v1-ledger-schema-v4.lftl",
  ) {}

  async getFile() {
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  async createWritable(): Promise<never> {
    this.writeAttempts += 1;
    throw new Error("Golden fixture tests must remain read-only");
  }

  async isSameEntry(other: LedgerFileHandle): Promise<boolean> {
    return other === this;
  }

  snapshot(): Uint8Array {
    return this.bytes.slice();
  }
}

async function expectFrozenFileRejection(
  operation: () => Promise<unknown>,
  expectedCause: Record<string, unknown>,
): Promise<void> {
  await expect(operation()).rejects.toMatchObject({
    code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
    cause: expect.arrayContaining([expect.objectContaining(expectedCause)]),
  });
}

describe("storage golden fixtures", () => {
  it("freezes and rejects the rich V4 backup fixture", () => {
    const serialized = readFileSync(GOLDEN_BACKUP_URL, "utf8");

    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      GOLDEN_BACKUP_SHA256,
    );
    const result = parseBackupJson(serialized, "2026-08-31");
    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "BACKUP_SCHEMA_VERSION_MISMATCH",
          path: "ledgerSchemaVersion",
          message: "这是账本 schema V4 的备份；当前账本 schema 为 V5，且不提供迁移",
        }),
      ],
    });
    expect(readFileSync(GOLDEN_BACKUP_URL, "utf8")).toBe(serialized);
  });

  it("freezes and rejects the product-path file format V2 fixture without mutation", async () => {
    const bytes = new Uint8Array(readFileSync(GOLDEN_LEDGER_FILE_URL));

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      GOLDEN_LEDGER_FILE_SHA256,
    );
    const handle = new ReadOnlyGoldenLedgerHandle(bytes);
    const before = handle.snapshot();
    const adapter = new LedgerFileHandleAdapter();

    const v2SchemaCause = {
      code: "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA",
      path: "current.ledgerSchemaVersion",
    };
    await expectFrozenFileRejection(() => inspectLedgerFile(adapter, handle), v2SchemaCause);
    await expectFrozenFileRejection(() =>
      LedgerFileRepository.open(
        adapter,
        handle,
        GOLDEN_LEDGER_FILE_V2_PASSPHRASE,
        { sessionLease: TEST_SESSION_LEASE },
      ), v2SchemaCause,
    );

    expect(handle.writeAttempts).toBe(0);
    const after = handle.snapshot();
    expect(after.byteLength).toBe(before.byteLength);
    expect(createHash("sha256").update(after).digest("hex")).toBe(
      GOLDEN_LEDGER_FILE_SHA256,
    );
    expect(after).toEqual(before);
  });

  it("freezes and rejects the product-path V4 file without mutation", async () => {
    const bytes = new Uint8Array(readFileSync(GOLDEN_LEDGER_FILE_V3_URL));

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      GOLDEN_LEDGER_FILE_V3_SHA256,
    );
    const handle = new ReadOnlyGoldenLedgerHandle(
      bytes,
      "golden-ledger-file-format-v3-crypto-v1-ledger-schema-v4.lftl",
    );
    const before = handle.snapshot();
    const adapter = new LedgerFileHandleAdapter();
    const v3HeaderCause = {
      code: "LEDGER_FILE_INVALID_STRUCTURE",
      path: "header",
    };
    await expectFrozenFileRejection(() => inspectLedgerFile(adapter, handle), v3HeaderCause);
    await expectFrozenFileRejection(() => LedgerFileRepository.open(
      adapter,
      handle,
      GOLDEN_LEDGER_FILE_V3_PASSPHRASE,
      { sessionLease: TEST_SESSION_LEASE },
    ), v3HeaderCause);

    expect(handle.writeAttempts).toBe(0);
    const after = handle.snapshot();
    expect(after.byteLength).toBe(before.byteLength);
    expect(createHash("sha256").update(after).digest("hex")).toBe(
      GOLDEN_LEDGER_FILE_V3_SHA256,
    );
    expect(after).toEqual(before);
  });

  it("opens the immutable V5 product-path file with optional fact time zones", async () => {
    const bytes = new Uint8Array(readFileSync(GOLDEN_LEDGER_FILE_V5_URL));

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      GOLDEN_LEDGER_FILE_V5_SHA256,
    );
    const handle = new ReadOnlyGoldenLedgerHandle(
      bytes,
      "golden-ledger-file-format-v3-crypto-v1-ledger-schema-v5-time-zone.lftl",
    );
    const before = handle.snapshot();
    const repository = await LedgerFileRepository.open(
      new LedgerFileHandleAdapter(),
      handle,
      GOLDEN_LEDGER_FILE_V5_PASSPHRASE,
      { sessionLease: TEST_SESSION_LEASE },
    );
    const ledger = await repository.load();

    expect(ledger.schemaVersion).toBe(5);
    expect(ledger.trades[0]?.occurredTimeZone).toBe("Asia/Shanghai");
    expect(ledger.cashEvents[0]).not.toHaveProperty("occurredTimeZone");
    expect(ledger.assetTransfers[0]?.occurredTimeZone).toBe(
      "Europe/Budapest",
    );
    expect(ledger.priceSnapshots[0]?.occurredTimeZone).toBe("UTC");
    expect(handle.writeAttempts).toBe(0);
    expect(handle.snapshot()).toEqual(before);
  });
});
