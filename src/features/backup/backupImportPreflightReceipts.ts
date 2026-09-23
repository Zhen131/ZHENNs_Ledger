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

export function revokeBackupImportPreflightReceipt(
  preflight: BackupImportPreflightResult,
): void {
  const runtime = preflightReceiptRuntimes.get(preflight);
  if (runtime) {
    runtime.active = false;
  }
}
