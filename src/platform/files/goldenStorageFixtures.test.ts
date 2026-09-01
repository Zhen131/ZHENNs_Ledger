import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseBackupJson, serializeBackupEnvelope } from "@/features/backup";
import {
  createGoldenStorageScenario,
  GOLDEN_LEDGER_FILE_V2_PASSPHRASE,
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
const GOLDEN_BACKUP_SHA256 =
  "b8ffaedf8b4d74b1636aac17401a30fe4c7011d7db5179f2bfbc9bee8060aa3c";
const GOLDEN_LEDGER_FILE_SHA256 =
  "d143d621cb2dbb4404d254114294132a54213c70fbd445c6bc0fb49b42447427";

const TEST_SESSION_LEASE: LedgerFileSessionLease = {
  sessionId: "golden-storage-fixture-test",
  runExclusiveWrite: (operation) => operation(),
  release: async () => undefined,
};

class ReadOnlyGoldenLedgerHandle implements LedgerFileHandle {
  readonly name = "golden-ledger-file-format-v2-crypto-v1-ledger-schema-v4.lftl";
  writeAttempts = 0;

  constructor(private readonly bytes: Uint8Array) {}

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

async function expectV2Rejection(
  operation: () => Promise<unknown>,
): Promise<void> {
  await expect(operation()).rejects.toMatchObject({
    code: LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
    message: expect.stringContaining("V2"),
    cause: expect.arrayContaining([
      expect.objectContaining({
        code: "LEDGER_FILE_UNSUPPORTED_VERSION",
        path: "fileFormatVersion",
        message: expect.stringContaining("V2"),
      }),
    ]),
  });
}

describe("storage golden fixtures", () => {
  it("freezes and parses the rich backup format V3 schema V4 fixture", () => {
    const serialized = readFileSync(GOLDEN_BACKUP_URL, "utf8");

    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      GOLDEN_BACKUP_SHA256,
    );
    const result = parseBackupJson(serialized, "2026-08-31");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backupFormatVersion).toBe(3);
    expect(result.value.ledgerSchemaVersion).toBe(4);
    expect(result.value.ledgerData).toEqual(createGoldenStorageScenario());
    expect(serializeBackupEnvelope(result.value)).toBe(serialized);
  });

  it("freezes and rejects the product-path file format V2 fixture without mutation", async () => {
    const bytes = new Uint8Array(readFileSync(GOLDEN_LEDGER_FILE_URL));

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      GOLDEN_LEDGER_FILE_SHA256,
    );
    const handle = new ReadOnlyGoldenLedgerHandle(bytes);
    const before = handle.snapshot();
    const adapter = new LedgerFileHandleAdapter();

    await expectV2Rejection(() => inspectLedgerFile(adapter, handle));
    await expectV2Rejection(() =>
      LedgerFileRepository.open(
        adapter,
        handle,
        GOLDEN_LEDGER_FILE_V2_PASSPHRASE,
        { sessionLease: TEST_SESSION_LEASE },
      ),
    );

    expect(handle.writeAttempts).toBe(0);
    const after = handle.snapshot();
    expect(after.byteLength).toBe(before.byteLength);
    expect(createHash("sha256").update(after).digest("hex")).toBe(
      GOLDEN_LEDGER_FILE_SHA256,
    );
    expect(after).toEqual(before);
  });
});
