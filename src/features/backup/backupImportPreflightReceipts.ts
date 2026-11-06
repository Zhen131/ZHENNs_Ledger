/**
 * 这个文件管预检之后那几样凭据。
 * 发确认、发导入凭据、核对、作废都在这里。
 * 预检本身在 `backupImportPreflight.ts`，真正写入在 app 的导入流程里。
 * 不显然的决定：凭据的底账只放在程序内存里，界面改不了；为什么，这是猜的，要核。
 */
import type {
  BackupImportPreflightResult,
  LedgerBackupImportEvidence,
  BackupSuspicionConfirmationReceipt,
  BackupImportPreflightAttestation,
} from "./backupImportPreflightResult";

type PreflightReceiptRuntime = {
  active: boolean;
  readonly attestation: BackupImportPreflightAttestation;
};

/**
 * 每次零硬错误预检的底账，按那份结果存放。
 * `active` 为假表示这次预检已作废。
 */
export const preflightReceiptRuntimes = new WeakMap<
  BackupImportPreflightResult,
  PreflightReceiptRuntime
>();
const suspicionConfirmationRuntimes = new WeakMap<
  BackupSuspicionConfirmationReceipt,
  Readonly<{
    preflight: BackupImportPreflightResult;
    suspiciousGroupIdentity: string;
  }>
>();
const importEvidenceRuntimes = new WeakMap<
  LedgerBackupImportEvidence,
  Readonly<{
    preflight: BackupImportPreflightResult;
    confirmation: BackupSuspicionConfirmationReceipt | null;
  }>
>();

/**
 * 这个函数发一张确认凭据。
 * 人确认「疑似重复照样导入」时用。
 * 这次预检已作废、或根本没有疑似重复，就返回空。
 * 不会出错。
 */
export function confirmBackupImportSuspiciousGroups(
  preflight: BackupImportPreflightResult,
): BackupSuspicionConfirmationReceipt | null {
  const runtime = preflightReceiptRuntimes.get(preflight);
  if (
    !runtime?.active ||
    runtime.attestation.suspiciousGroupCount === 0
  ) {
    return null;
  }

  const confirmation = Object.freeze(
    {},
  ) as BackupSuspicionConfirmationReceipt;
  suspicionConfirmationRuntimes.set(confirmation, {
    preflight,
    suspiciousGroupIdentity:
      runtime.attestation.suspiciousGroupIdentity,
  });
  return confirmation;
}

/**
 * 这个函数回答：这张确认凭据对这次预检还有效吗？
 * 没有疑似重复时，不带凭据才算对。
 * 有疑似重复时，凭据必须是这次预检发的，而且那一组没变。
 * 举例：换了一个 B 文件重新预检 → 旧凭据答无效。
 */
export function isBackupImportSuspicionConfirmationValid(
  preflight: BackupImportPreflightResult,
  confirmation: BackupSuspicionConfirmationReceipt | null,
): boolean {
  const runtime = preflightReceiptRuntimes.get(preflight);
  if (!runtime?.active) {
    return false;
  }
  if (runtime.attestation.suspiciousGroupCount === 0) {
    return confirmation === null;
  }
  if (!confirmation) {
    return false;
  }
  const confirmationRuntime =
    suspicionConfirmationRuntimes.get(confirmation);
  return Boolean(
    confirmationRuntime &&
      confirmationRuntime.preflight === preflight &&
      confirmationRuntime.suspiciousGroupIdentity ===
        runtime.attestation.suspiciousGroupIdentity,
  );
}

/**
 * 这个函数回答：现在能不能发一张导入凭据？能就发。
 * 预检已作废，或疑似重复还没被有效确认，就返回空。
 * 拿到空的一方不应继续导入。
 */
export function createLedgerBackupImportEvidence(
  preflight: BackupImportPreflightResult,
  confirmation: BackupSuspicionConfirmationReceipt | null = null,
): LedgerBackupImportEvidence | null {
  const runtime = preflightReceiptRuntimes.get(preflight);
  if (
    !runtime?.active ||
    !isBackupImportSuspicionConfirmationValid(
      preflight,
      confirmation,
    )
  ) {
    return null;
  }

  const { attestation } = runtime;
  const evidence: LedgerBackupImportEvidence = Object.freeze({
    contentIdentity: attestation.contentIdentity,
    candidateIdentity: attestation.candidateIdentity,
    selectionGeneration: attestation.selectionGeneration,
    hardErrorCount: attestation.hardErrorCount,
    suspiciousGroupCount: attestation.suspiciousGroupCount,
    suspiciousGroupIdentity: attestation.suspiciousGroupIdentity,
    confirmedSuspiciousGroupIdentity:
      attestation.suspiciousGroupCount === 0
        ? null
        : attestation.suspiciousGroupIdentity,
    requireHistoricalRawText:
      attestation.requireHistoricalRawText,
  });
  importEvidenceRuntimes.set(evidence, {
    preflight,
    confirmation,
  });
  return evidence;
}

/**
 * 这个函数回答：交来的导入凭据是不是真的、还有效？
 * 有效就返回当初那次预检的底账，否则返回空。
 * 凭据上任何一项和底账对不上，都算无效。
 */
export function inspectLedgerBackupImportEvidence(
  evidence: LedgerBackupImportEvidence,
): BackupImportPreflightAttestation | null {
  const evidenceRuntime = importEvidenceRuntimes.get(evidence);
  if (!evidenceRuntime) {
    return null;
  }
  const preflightRuntime =
    preflightReceiptRuntimes.get(evidenceRuntime.preflight);
  if (
    !preflightRuntime?.active ||
    !isBackupImportSuspicionConfirmationValid(
      evidenceRuntime.preflight,
      evidenceRuntime.confirmation,
    )
  ) {
    return null;
  }

  const { attestation } = preflightRuntime;
  if (
    evidence.contentIdentity !== attestation.contentIdentity ||
    evidence.candidateIdentity !== attestation.candidateIdentity ||
    evidence.selectionGeneration !==
      attestation.selectionGeneration ||
    evidence.hardErrorCount !== attestation.hardErrorCount ||
    evidence.suspiciousGroupCount !==
      attestation.suspiciousGroupCount ||
    evidence.suspiciousGroupIdentity !==
      attestation.suspiciousGroupIdentity ||
    evidence.confirmedSuspiciousGroupIdentity !==
      (attestation.suspiciousGroupCount === 0
        ? null
        : attestation.suspiciousGroupIdentity) ||
    evidence.requireHistoricalRawText !==
      attestation.requireHistoricalRawText
  ) {
    return null;
  }
  return attestation;
}

/**
 * 这个函数作废一次预检。
 * 之后凭它发的确认和导入凭据都失效。
 * 换文件、取消、离开页面时用。
 * 不会出错。
 */
export function revokeBackupImportPreflightReceipt(
  preflight: BackupImportPreflightResult,
): void {
  const runtime = preflightReceiptRuntimes.get(preflight);
  if (runtime) {
    runtime.active = false;
  }
}
