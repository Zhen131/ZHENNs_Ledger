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
import { inspectLedgerFile, LedgerFileRepository } from "./ledgerFileRepository";
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

  constructor(private readonly bytes: Uint8Array) {}

  async getFile() {
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  async createWritable(): Promise<never> {
    throw new Error("Golden fixture tests must remain read-only");
  }

  async isSameEntry(other: LedgerFileHandle): Promise<boolean> {
    return other === this;
  }
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

  it("freezes and opens the product-path file format V2 fixture", async () => {
    const bytes = new Uint8Array(readFileSync(GOLDEN_LEDGER_FILE_URL));

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      GOLDEN_LEDGER_FILE_SHA256,
    );
    const handle = new ReadOnlyGoldenLedgerHandle(bytes);
    const adapter = new LedgerFileHandleAdapter();
    const envelope = await inspectLedgerFile(adapter, handle);
    expect(envelope.fileFormatVersion).toBe(2);
    expect(envelope.crypto.cryptoVersion).toBe(1);
    expect(envelope.current.ledgerSchemaVersion).toBe(4);
    expect(envelope.previous?.ledgerSchemaVersion).toBe(4);

    const repository = await LedgerFileRepository.open(
      adapter,
      handle,
      GOLDEN_LEDGER_FILE_V2_PASSPHRASE,
      { sessionLease: TEST_SESSION_LEASE },
    );
    await expect(repository.load()).resolves.toEqual(
      createGoldenStorageScenario(),
    );
  });
});
