import packageJson from "@root/package.json";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  CopyState,
  PostImportPairingOperation,
} from "./backupControlsTypes";
import type {
  BackupImportPreflightResult,
  BackupSuspicionConfirmationReceipt,
} from "./backupImportPreflight";
import { revokeBackupImportPreflightReceipt } from "./backupImportPreflight";
import type { BackupEnvelopeError } from "./backupEnvelope";
import type { LedgerClock } from "@/core/shared";
import type { LedgerData } from "@/core/models";
import type { useLanguage } from "@/ui";
import { captureLedgerTime } from "@/core/shared";
import {
  createBackupEnvelope,
  serializeBackupEnvelope,
} from "./backupEnvelope";
import { SUPPORTED_LEDGER_SCHEMA_VERSION } from "@/platform/files";
import {
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "@/core/validation";
import { downloadBackupJson } from "./backupDownload";

type BackupControlsMountEffectDeps = {
  importAbortControllerRef: RefObject<AbortController | null>;
  mountedRef: RefObject<boolean>;
  pairingOperationRef: RefObject<PostImportPairingOperation | null>;
  selectedPreflightRef: RefObject<BackupImportPreflightResult | null>;
  selectionGenerationRef: RefObject<number>;
  suspicionConfirmationRef: RefObject<BackupSuspicionConfirmationReceipt | null>;
};

export function runBackupControlsMountEffect(
  deps: BackupControlsMountEffectDeps,
) {
  const {
    importAbortControllerRef,
    mountedRef,
    pairingOperationRef,
    selectedPreflightRef,
    selectionGenerationRef,
    suspicionConfirmationRef,
  } = deps;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importAbortControllerRef.current?.abort();
      pairingOperationRef.current?.controller.abort();
      pairingOperationRef.current = null;
      selectionGenerationRef.current += 1;
      if (selectedPreflightRef.current) {
        revokeBackupImportPreflightReceipt(
          selectedPreflightRef.current,
        );
      }
      selectedPreflightRef.current = null;
      suspicionConfirmationRef.current = null;
    };
}

type ResetFileSelectionDeps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  importAbortControllerRef: RefObject<AbortController | null>;
  selectedPreflightRef: RefObject<BackupImportPreflightResult | null>;
  selectionGenerationRef: RefObject<number>;
  setCopyState: Dispatch<SetStateAction<CopyState>>;
  setImportErrors: Dispatch<SetStateAction<BackupEnvelopeError[]>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPreflightResult: Dispatch<SetStateAction<BackupImportPreflightResult | null>>;
  suspicionConfirmationRef: RefObject<BackupSuspicionConfirmationReceipt | null>;
};

export function doResetFileSelection(
  deps: ResetFileSelectionDeps,
) {
  const {
    fileInputRef,
    importAbortControllerRef,
    selectedPreflightRef,
    selectionGenerationRef,
    setCopyState,
    setImportErrors,
    setMessage,
    setPreflightResult,
    suspicionConfirmationRef,
  } = deps;
    importAbortControllerRef.current?.abort();
    importAbortControllerRef.current = null;
    selectionGenerationRef.current += 1;
    if (selectedPreflightRef.current) {
      revokeBackupImportPreflightReceipt(
        selectedPreflightRef.current,
      );
    }
    selectedPreflightRef.current = null;
    suspicionConfirmationRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setPreflightResult(null);
    setImportErrors([]);
    setCopyState("idle");
    setMessage("");
}

type HandleExportDeps = {
  clock: LedgerClock;
  isDirty: boolean;
  isReadOnly: boolean;
  ledgerData: LedgerData;
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  setMessage: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doHandleExport(
  deps: HandleExportDeps,
) {
  const {
    clock,
    isDirty,
    isReadOnly,
    ledgerData,
    persistenceStatus,
    setMessage,
    t,
  } = deps;
    const exportTime = captureLedgerTime(clock);
    const exportedAt = exportTime.now.toISOString();
    const envelopeResult = createBackupEnvelope(ledgerData, {
      appVersion: packageJson.version,
      exportedAt,
    }, exportTime.todayKey);

    if (!envelopeResult.ok) {
      setMessage(
        t("backup.export.invalidLedgerPrefix") +
          SUPPORTED_LEDGER_SCHEMA_VERSION +
          t("backup.export.invalidLedgerSuffix"),
      );
      return;
    }

    const serialized = serializeBackupEnvelope(envelopeResult.value);
    const bytePolicy = evaluateLedgerJsonResourcePolicy(serialized);
    if (!bytePolicy.ok) {
      setMessage(
        t("backup.export.tooLargePrefix") +
          SUPPORTED_LEDGER_SCHEMA_VERSION +
          t("backup.export.tooLargeSuffix"),
      );
      return;
    }

    const ledgerPolicy = evaluateLedgerResourcePolicy(ledgerData);
    if (!isReadOnly && !ledgerPolicy.ok) {
      setMessage(t("backup.export.resourceLimit"));
      return;
    }

    const downloadResult = downloadBackupJson(serialized, exportedAt);
    if (!downloadResult.ok) {
      setMessage(
        t("backup.export.exception"),
      );
      return;
    }

    setMessage(
      isReadOnly
          ? t("backup.export.readOnlyRescueStarted")
        : isDirty ||
            persistenceStatus === "saving" ||
              persistenceStatus === "error"
          ? t("backup.export.rescueStarted")
          : t("backup.export.started"),
    );
}
