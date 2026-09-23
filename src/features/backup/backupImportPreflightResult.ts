import type { LedgerData } from "@/core/models";
import type {
  BackupContentIdentity,
  BackupPreflightHardError,
  BackupPreflightSuspiciousDetail,
  BackupPreflightSkippedCheck,
  BackupPreflightMetadata,
  BackupPreflightWarning,
} from "./backupImportPreflightTypes";

export type BackupPreflightDetail =
  | BackupPreflightHardError
  | BackupPreflightSuspiciousDetail;

export type BackupImportPreflightResult = Readonly<{
  contentIdentity: BackupContentIdentity;
  selectionGeneration: number;
  suspiciousGroupIdentity: string;
  hardErrorCount: number;
  suspiciousGroupCount: number;
  warningCount: number;
  warnings: readonly BackupPreflightWarning[];
  totalDetailCount: number;
  retainedDetailCount: number;
  truncated: boolean;
  retainedDetails: readonly BackupPreflightDetail[];
  visibleDetails: readonly BackupPreflightDetail[];
  skippedChecks: readonly BackupPreflightSkippedCheck[];
  metadata?: BackupPreflightMetadata;
  candidate?: Readonly<LedgerData>;
  candidateIdentity?: string;
}>;

export type LedgerBackupImportEvidence = Readonly<{
  contentIdentity: string;
  candidateIdentity: string;
  selectionGeneration: number;
  hardErrorCount: number;
  suspiciousGroupCount: number;
  suspiciousGroupIdentity: string;
  confirmedSuspiciousGroupIdentity: string | null;
  requireHistoricalRawText: boolean;
}>;

declare const backupSuspicionConfirmationBrand: unique symbol;

export type BackupSuspicionConfirmationReceipt = Readonly<{
  [backupSuspicionConfirmationBrand]: true;
}>;

export type BackupImportPreflightAttestation = Readonly<{
  contentIdentity: string;
  candidateIdentity: string;
  selectionGeneration: number;
  hardErrorCount: 0;
  suspiciousGroupCount: number;
  suspiciousGroupIdentity: string;
  requireHistoricalRawText: boolean;
}>;
