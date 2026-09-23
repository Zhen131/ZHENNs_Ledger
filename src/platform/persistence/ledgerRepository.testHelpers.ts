import type { StorageAdapter } from "@/platform/legacy";
import {
  createBackupEnvelope,
  serializeBackupEnvelope,
} from "@/features/backup";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  preflightBackupJson,
  type BackupImportPreflightResult,
  type LedgerBackupImportEvidence,
} from "@/features/backup";
import type { StoredLedgerEnvelopeV2 } from "@/platform/legacy";
import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { validateLedgerData } from "@/core/validation";
import { sampleUsdtTrades } from "@/test-support";

export class MemoryStorageAdapter implements StorageAdapter {
  envelope: unknown | null = null;

  async read() {
    return this.envelope;
  }

  async write(envelope: StoredLedgerEnvelopeV2) {
    this.envelope = structuredClone(envelope);
  }

  async clear() {
    this.envelope = null;
  }
}

export function createLedger(): LedgerData {
  return {
    ...createInitialLedgerData(),
    trades: structuredClone(sampleUsdtTrades),
  };
}

export function canonicalLedger(ledgerData: LedgerData): LedgerData {
  const result = validateLedgerData(ledgerData);
  if (!result.ok) {
    throw new Error("Test ledger must be valid");
  }
  return result.value;
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export async function createReadyImportEvidence(
  candidate: LedgerData,
  selectionGeneration = 1,
): Promise<
  Readonly<{
    evidence: LedgerBackupImportEvidence;
    preflight: BackupImportPreflightResult;
  }>
> {
  const envelope = createBackupEnvelope(candidate, {
    appVersion: "0.1.0",
    exportedAt: "2026-07-31T08:00:00.000Z",
  });
  if (!envelope.ok) {
    throw new Error("Ready-import fixture must form a backup envelope");
  }
  const preflight = await preflightBackupJson(
    serializeBackupEnvelope(envelope.value),
    {
      todayKey: "2026-07-31",
      selectionGeneration,
      requireHistoricalRawText: true,
    },
  );
  const confirmation =
    preflight.suspiciousGroupCount === 0
      ? null
      : confirmBackupImportSuspiciousGroups(preflight);
  const evidence = createLedgerBackupImportEvidence(
    preflight,
    confirmation,
  );
  if (!evidence) {
    throw new Error("Ready-import fixture must produce an active receipt");
  }
  return { evidence, preflight };
}
