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
import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { validateLedgerData } from "@/core/validation";
import { sampleUsdtTrades } from "@/test-support";

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
