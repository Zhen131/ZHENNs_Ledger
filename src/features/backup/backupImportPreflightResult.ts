/**
 * 这个文件放预检整份结果的类型。
 * 导入时要出示的几样凭据的类型也在这里。
 * 凭据怎么发、怎么查在 `backupImportPreflightReceipts.ts`。
 * 不显然的决定：确认只对这一次预检有效，换文件就作废；2026-07-31 定（W11 03A 第 4.5 节）。
 */
import type { LedgerData } from "@/core/models";
import type {
  BackupContentIdentity,
  BackupPreflightHardError,
  BackupPreflightSuspiciousDetail,
  BackupPreflightSkippedCheck,
  BackupPreflightMetadata,
  BackupPreflightWarning,
} from "./backupImportPreflightTypes";

/** 报告里的一条详情：一条硬错误，或一组疑似重复。 */
export type BackupPreflightDetail =
  | BackupPreflightHardError
  | BackupPreflightSuspiciousDetail;

/**
 * 一次预检的整份结果。
 * 有内容身份、第几次选文件、各类数目。
 * 还有详情和没做的检查。
 * 零硬错误时，还带一份冻住的、可以导入的账本和它的身份。
 */
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

/**
 * 导入时交给写入那一步的凭据。
 * 它说明这份账本过了哪次预检、疑似重复有没有被确认。
 */
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

/**
 * 「我看过疑似重复、照样导入」的确认凭据。
 * 只能由 `confirmBackupImportSuspiciousGroups` 发出，别处造不出来。
 */
export type BackupSuspicionConfirmationReceipt = Readonly<{
  [backupSuspicionConfirmationBrand]: true;
}>;

/** 一次零硬错误预检记下的底账，用来核对后面交来的凭据。 */
export type BackupImportPreflightAttestation = Readonly<{
  contentIdentity: string;
  candidateIdentity: string;
  selectionGeneration: number;
  hardErrorCount: 0;
  suspiciousGroupCount: number;
  suspiciousGroupIdentity: string;
  requireHistoricalRawText: boolean;
}>;
