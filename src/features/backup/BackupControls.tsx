"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  type BackupEnvelopeError,
} from "./backupEnvelope";
import {
  preflightBackupJson,
  type BackupImportPreflightResult,
  type BackupSuspicionConfirmationReceipt,
  type LedgerBackupImportEvidence,
} from "./backupImportPreflight";
import type {
  ApplyLedgerActionResult,
  PersistenceOperation,
} from "@/app";
import type { LedgerData } from "@/core/models";
import type { HydrationStatus } from "@/app";
import {
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  createBinanceMarketDataClient,
  type BinanceMarketDataClient,
} from "@/platform/integrations";
import { useLanguage } from "@/ui";
import {
  hasCurrentSuspicionConfirmation,
} from "./backupControlsHelpers";
import type {
  ImportState,
  CopyState,
  PostImportPairingState,
  PostImportPairingOperation,
} from "./backupControlsTypes";
import { PreflightReportView } from "./PreflightReportView";
import {
  doCompletePostImportPairing,
  doFetchPostImportPrices,
  doFinishPostImportPairing,
  doPairingOperationIsCurrent,
  doStartPostImportPairing,
  runPairingInvalidationEffect,
  runPairingPersistenceEffect,
} from "./backupControlsPairing";
import {
  doConfirmImport,
  doConfirmSuspiciousGroups,
  doCopyPreflightReport,
  doHandleExport,
  doHandleFileChange,
  doResetFileSelection,
  runBackupControlsMountEffect,
} from "./backupControlsActions";
import { BackupControlsActionRow } from "./BackupControlsActionRow";
import { BackupControlsPairingPanel } from "./BackupControlsPairingPanel";

const defaultMarketDataClient = createBinanceMarketDataClient();

type BackupControlsProps = {
  clock?: LedgerClock;
  ledgerData: LedgerData;
  hydrationStatus: HydrationStatus;
  persistenceOperation: PersistenceOperation;
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  isReadOnly: boolean;
  isDirty: boolean;
  /**
   * This capability controls only the final write. Pure B preflight remains
   * available to a ready C session while this value is false.
   */
  canImportBackup?: boolean;
  canPreflightBackup?: boolean;
  requiresHistoricalRawText?: boolean;
  ledgerEpoch?: number;
  sessionGeneration?: number;
  mutationVersion?: number;
  persistedVersion?: number;
  isWritable?: boolean;
  applyLedgerMutation?: (
    mutation: (current: LedgerData) => LedgerData,
    timeSnapshot?: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  marketDataClient?: BinanceMarketDataClient;
  generateId?: () => string;
  preflight?: typeof preflightBackupJson;
  onImport: (
    candidate: LedgerData,
    timeSnapshot?: LedgerTimeSnapshot,
    evidence?: LedgerBackupImportEvidence,
    signal?: AbortSignal,
  ) => Promise<{
    ok: boolean;
    code?: string;
    errors?: BackupEnvelopeError[];
  }>;
  presentation?: "legacy" | "transfer";
  showPlaintextWarning?: boolean;
};

export function BackupControls({
  clock = systemLedgerClock,
  ledgerData,
  hydrationStatus,
  persistenceOperation,
  persistenceStatus,
  isReadOnly,
  isDirty,
  canImportBackup = true,
  canPreflightBackup = true,
  requiresHistoricalRawText = false,
  ledgerEpoch = 0,
  sessionGeneration = ledgerEpoch,
  mutationVersion = 0,
  persistedVersion = 0,
  isWritable = false,
  applyLedgerMutation,
  marketDataClient = defaultMarketDataClient,
  generateId = () => globalThis.crypto.randomUUID(),
  preflight = preflightBackupJson,
  onImport,
  presentation = "legacy",
  showPlaintextWarning = true,
}: Readonly<BackupControlsProps>) {
  const { t } = useLanguage();
  const [importState, setImportState] = useState<ImportState>("idle");
  const [message, setMessage] = useState("");
  const [importErrors, setImportErrors] = useState<BackupEnvelopeError[]>([]);
  const [preflightResult, setPreflightResult] =
    useState<BackupImportPreflightResult | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [postImportPairing, setPostImportPairing] =
    useState<PostImportPairingState | null>(null);
  const selectedPreflightRef =
    useRef<BackupImportPreflightResult | null>(null);
  const suspicionConfirmationRef =
    useRef<BackupSuspicionConfirmationReceipt | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectionGenerationRef = useRef(0);
  const importAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const mountedRef = useRef(true);
  const pairingOperationRef = useRef<PostImportPairingOperation | null>(null);
  const pairingLatestRef = useRef({
    ledgerData,
    ledgerEpoch,
    sessionGeneration,
    mutationVersion,
    persistedVersion,
    persistenceStatus,
    isWritable,
  });
  pairingLatestRef.current = {
    ledgerData,
    ledgerEpoch,
    sessionGeneration,
    mutationVersion,
    persistedVersion,
    persistenceStatus,
    isWritable,
  };

  useEffect(() => {
    return runBackupControlsMountEffect(
      {
        importAbortControllerRef,
        mountedRef,
        pairingOperationRef,
        selectedPreflightRef,
        selectionGenerationRef,
        suspicionConfirmationRef,
      },
    );
  }, []);

  useEffect(() => {
    return runPairingInvalidationEffect(
      {
        mountedRef,
        pairingOperationIsCurrent,
        pairingOperationRef,
        setPostImportPairing,
        t,
      },
    );
  }, [isWritable, ledgerEpoch, sessionGeneration, t]);

  useEffect(() => {
    return runPairingPersistenceEffect(
      {
        completePostImportPairing,
        fetchPostImportPrices,
        finishPostImportPairing,
        mutationVersion,
        pairingOperationIsCurrent,
        pairingOperationRef,
        persistedVersion,
        persistenceStatus,
        setPostImportPairing,
        t,
      },
    );
    // Mutable operation tokens deliberately advance only on persistence facts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutationVersion, persistedVersion, persistenceStatus]);

  const showExport = hydrationStatus === "ready";
  const showPreflight =
    canPreflightBackup &&
    ((hydrationStatus === "ready" && !isReadOnly) ||
      hydrationStatus === "error");
  const canExport = showExport && persistenceOperation === "idle";
  const canSelect =
    showPreflight &&
    persistenceOperation === "idle" &&
    importState !== "importing";
  const canCommit =
    canImportBackup &&
    persistenceOperation === "idle" &&
    preflightResult?.hardErrorCount === 0 &&
    preflightResult.candidate !== undefined &&
    preflightResult.candidateIdentity !== undefined &&
    hasCurrentSuspicionConfirmation(
      preflightResult,
      suspicionConfirmationRef.current,
    );

  function pairingOperationIsCurrent(
    operation: PostImportPairingOperation,
  ): boolean {
    return doPairingOperationIsCurrent(
      {
        mountedRef,
        pairingLatestRef,
        pairingOperationRef,
      },
      operation,
    );
  }

  function dismissPostImportPairing() {
    pairingOperationRef.current?.controller.abort();
    pairingOperationRef.current = null;
    setPostImportPairing(null);
  }

  async function startPostImportPairing() {
    return doStartPostImportPairing(
      {
        applyLedgerMutation,
        clock,
        finishPostImportPairing,
        marketDataClient,
        pairingLatestRef,
        pairingOperationIsCurrent,
        pairingOperationRef,
        postImportPairing,
        setPostImportPairing,
        t,
      },
    );
  }

  async function fetchPostImportPrices(
    operation: PostImportPairingOperation,
  ) {
    return doFetchPostImportPrices(
      {
        applyLedgerMutation,
        clock,
        completePostImportPairing,
        generateId,
        marketDataClient,
        pairingLatestRef,
        pairingOperationIsCurrent,
        setPostImportPairing,
        t,
      },
      operation,
    );
  }

  function completePostImportPairing(
    operation: PostImportPairingOperation,
  ) {
    return doCompletePostImportPairing(
      {
        finishPostImportPairing,
        pairingOperationIsCurrent,
        t,
      },
      operation,
    );
  }

  function finishPostImportPairing(
    operation: PostImportPairingOperation,
    status: "success" | "partial" | "error",
    message: string,
  ) {
    return doFinishPostImportPairing(
      {
        pairingOperationIsCurrent,
        pairingOperationRef,
        setPostImportPairing,
      },
      operation,
      status,
      message,
    );
  }

  function resetFileSelection() {
    return doResetFileSelection(
      {
        fileInputRef,
        importAbortControllerRef,
        selectedPreflightRef,
        selectionGenerationRef,
        setCopyState,
        setImportErrors,
        setMessage,
        setPreflightResult,
        suspicionConfirmationRef,
      },
    );
  }

  function cancelSelection() {
    resetFileSelection();
    setImportState("idle");
  }

  function handleExport() {
    return doHandleExport(
      {
        clock,
        isDirty,
        isReadOnly,
        ledgerData,
        persistenceStatus,
        setMessage,
        t,
      },
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    return doHandleFileChange(
      {
        canImportBackup,
        clock,
        dismissPostImportPairing,
        fileInputRef,
        importAbortControllerRef,
        isCurrentSelection,
        preflight,
        requiresHistoricalRawText,
        selectedPreflightRef,
        selectionGenerationRef,
        setCopyState,
        setImportErrors,
        setImportState,
        setMessage,
        setPreflightResult,
        suspicionConfirmationRef,
        t,
      },
      event,
    );
  }

  function confirmSuspiciousGroups() {
    return doConfirmSuspiciousGroups(
      {
        canImportBackup,
        selectedPreflightRef,
        selectionGenerationRef,
        setImportState,
        setMessage,
        suspicionConfirmationRef,
        t,
      },
    );
  }

  async function copyPreflightReport() {
    return doCopyPreflightReport(
      {
        isSamePreflight,
        selectedPreflightRef,
        selectionGenerationRef,
        setCopyState,
      },
    );
  }

  async function confirmImport() {
    return doConfirmImport(
      {
        canCommit,
        clock,
        importAbortControllerRef,
        isSamePreflight,
        onImport,
        resetFileSelection,
        selectedPreflightRef,
        selectionGenerationRef,
        setImportErrors,
        setImportState,
        setMessage,
        setPostImportPairing,
        suspicionConfirmationRef,
        t,
      },
    );
  }

  function isCurrentSelection(selectionGeneration: number): boolean {
    return (
      mountedRef.current &&
      selectionGenerationRef.current === selectionGeneration
    );
  }

  function isSamePreflight(
    selectionGeneration: number,
    contentIdentity: string,
  ): boolean {
    return (
      isCurrentSelection(selectionGeneration) &&
      selectedPreflightRef.current?.contentIdentity.value === contentIdentity
    );
  }

  return (
    <div
      className={
        presentation === "transfer"
          ? "grid min-w-0 gap-4"
          : "grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4"
      }
    >
      {showPlaintextWarning ? (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
        {t("backup.privacyWarning")}
      </p>
      ) : null}
      <BackupControlsActionRow
        canExport={canExport}
        canSelect={canSelect}
        fileInputRef={fileInputRef}
        handleExport={handleExport}
        handleFileChange={handleFileChange}
        persistenceOperation={persistenceOperation}
        presentation={presentation}
        showExport={showExport}
        showPreflight={showPreflight}
        t={t}
      />

      {persistenceOperation !== "idle" ? (
        <p className="text-sm text-[var(--ledger-muted)]" id="backup-controls-disabled-reason">
          {t("backup.availability.operationInProgress")}
        </p>
      ) : null}

      {hydrationStatus === "loading" ? <p>{t("backup.availability.loading")}</p> : null}
      {hydrationStatus === "error" ? (
        <>
          <p>{t("backup.description.recover")}</p>
          <p>{t("backup.description.preflight")}</p>
        </>
      ) : null}
      {isReadOnly ? (
        <p>{t("backup.description.readOnly")}</p>
      ) : null}
      {persistenceStatus === "saving" || persistenceStatus === "error" ? (
        <p>{t("backup.description.dirty")}</p>
      ) : null}

      {importState === "reading" || importState === "preflighting" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p aria-live="polite">
            {importState === "reading"
              ? t("backup.progress.reading")
              : t("backup.progress.preflighting")}
          </p>
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
            onClick={cancelSelection}
            type="button"
          >
            {t("backup.action.cancel")}
          </button>
        </div>
      ) : null}

      {preflightResult ? (
        <PreflightReportView
          copyState={copyState}
          onCopy={() => void copyPreflightReport()}
          result={preflightResult}
        />
      ) : null}

      {importState === "awaiting-suspicion-confirmation" ? (
        <div className="grid gap-3 border-t border-slate-200 pt-3">
          <p className="font-medium text-amber-900">
            {t("backup.confirmSuspicion.description")}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-amber-700 px-3 py-2 font-medium text-white"
              onClick={confirmSuspiciousGroups}
              type="button"
            >
              {t("backup.confirmSuspicion.action")}
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
              onClick={cancelSelection}
              type="button"
            >
              {t("backup.action.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {importState === "awaiting-confirmation" ? (
        <div className="grid gap-3 border-t border-slate-200 pt-3">
          <p className="font-medium text-amber-900">
            {hydrationStatus === "error"
              ? t("backup.confirmImport.recovery")
              : isDirty
                ? t("backup.confirmImport.dirty")
                : t("backup.confirmImport.normal")}
          </p>
          <p className="text-sm leading-6 text-amber-900">
            {t("backup.confirmImport.privacy")}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-slate-950 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canCommit}
              onClick={() => void confirmImport()}
              type="button"
            >
              {t("backup.confirmImport.action")}
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
              onClick={cancelSelection}
              type="button"
            >
              {t("backup.action.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {importState === "ready-without-suspicions" && !canImportBackup ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
          {t("backup.readOnlyNotice")}
        </p>
      ) : null}

      {importState === "preflight-blocked" ||
      (preflightResult &&
        importState === "ready-without-suspicions") ? (
        <button
          className="w-fit rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
          onClick={cancelSelection}
          type="button"
        >
          {t("backup.action.cancel")}
        </button>
      ) : null}

      {importState === "preflight-blocked" && preflightResult ? (
        <p className="font-medium text-red-800">
          {t("backup.hardErrorNotice")}
        </p>
      ) : null}

      {importState === "importing" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p aria-live="polite">
            {t("backup.progress.importing")}
          </p>
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
            onClick={cancelSelection}
            type="button"
          >
            {t("backup.action.cancel")}
          </button>
        </div>
      ) : null}

      {importErrors.length > 0 ? (
        <div aria-live="polite" className="grid gap-2 text-sm text-red-800">
          <p>
            {t("backup.errors.foundPrefix")} {importErrors.length} {t("backup.errors.showingPrefix")} {Math.min(importErrors.length, 5)} {t("backup.errors.suffix")}
          </p>
          <ul className="grid gap-1">
            {importErrors.slice(0, 5).map((error, index) => (
              <li key={`${error.code}-${error.path}-${index}`}>
                <code>{error.code}</code> · <code>{error.path}</code> ·{" "}
                {error.message}
                {"limit" in error
                  ? `${t("backup.errors.limitPrefix")}${error.limit}${t("backup.errors.limitMiddle")}${error.actual}${t("backup.errors.limitSuffix")}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {message ? <p aria-live="polite">{message}</p> : null}
      {postImportPairing ? (
        <BackupControlsPairingPanel
          applyLedgerMutation={applyLedgerMutation}
          dismissPostImportPairing={dismissPostImportPairing}
          isWritable={isWritable}
          postImportPairing={postImportPairing}
          startPostImportPairing={startPostImportPairing}
          t={t}
        />
      ) : null}
    </div>
  );
}
