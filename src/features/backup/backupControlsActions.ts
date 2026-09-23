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
