"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import packageJson from "../../../package.json";
import { downloadBackupJson } from "../../backup/backupDownload";
import {
  createBackupEnvelope,
  serializeBackupEnvelope,
  type BackupEnvelopeError,
} from "../../backup/backupEnvelope";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  isBackupImportSuspicionConfirmationValid,
  preflightBackupJson,
  revokeBackupImportPreflightReceipt,
  type BackupImportPreflightResult,
  type BackupPreflightDetail,
  type BackupSuspicionConfirmationReceipt,
  type LedgerBackupImportEvidence,
} from "../../backup/backupImportPreflight";
import { formatBackupImportReportMarkdown } from "../../backup/backupImportReport";
import type { PersistenceOperation } from "../../hooks/usePersistentLedger";
import type { LedgerData } from "../../models";
import type { HydrationStatus } from "../../state/hydrationState";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "../../utils/ledgerDate";
import {
  evaluateLedgerByteLengthResourcePolicy,
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "../../validators";

type ImportState =
  | "idle"
  | "reading"
  | "preflighting"
  | "preflight-blocked"
  | "ready-without-suspicions"
  | "awaiting-suspicion-confirmation"
  | "awaiting-confirmation"
  | "importing"
  | "success"
  | "write-error";

type CopyState = "idle" | "copying" | "copied" | "error";

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
  requiresHistoricalRawText?: boolean;
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
  requiresHistoricalRawText = !canImportBackup,
  preflight = preflightBackupJson,
  onImport,
}: Readonly<BackupControlsProps>) {
  const [importState, setImportState] = useState<ImportState>("idle");
  const [message, setMessage] = useState("");
  const [importErrors, setImportErrors] = useState<BackupEnvelopeError[]>([]);
  const [preflightResult, setPreflightResult] =
    useState<BackupImportPreflightResult | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importAbortControllerRef.current?.abort();
      selectionGenerationRef.current += 1;
      if (selectedPreflightRef.current) {
        revokeBackupImportPreflightReceipt(
          selectedPreflightRef.current,
        );
      }
      selectedPreflightRef.current = null;
      suspicionConfirmationRef.current = null;
    };
  }, []);

  const showExport = hydrationStatus === "ready";
  const showPreflight =
    (hydrationStatus === "ready" && !isReadOnly) ||
    hydrationStatus === "error";
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

  function resetFileSelection() {
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

  function cancelSelection() {
    resetFileSelection();
    setImportState("idle");
  }

  function handleExport() {
    const exportedAt = captureLedgerTime(clock).now.toISOString();
    const envelopeResult = createBackupEnvelope(ledgerData, {
      appVersion: packageJson.version,
      exportedAt,
    });

    if (!envelopeResult.ok) {
      setMessage("Export failed: the current ledger did not pass structural validation.");
      return;
    }

    const serialized = serializeBackupEnvelope(envelopeResult.value);
    const bytePolicy = evaluateLedgerJsonResourcePolicy(serialized);
    if (!bytePolicy.ok) {
      setMessage(
        "Export failed: v1 cannot safely export this oversized ledger; no backup file was created.",
      );
      return;
    }

    const ledgerPolicy = evaluateLedgerResourcePolicy(ledgerData);
    if (!isReadOnly && !ledgerPolicy.ok) {
      setMessage("Export failed: the current ledger exceeds resource limits.");
      return;
    }

    const downloadResult = downloadBackupJson(serialized, exportedAt);
    if (!downloadResult.ok) {
      setMessage(
        "An export error occurred, so download success is unknown. Check the browser download list before retrying.",
      );
      return;
    }

    setMessage(
      isReadOnly
        ? "Read-only rescue backup download requested. The backup is unencrypted plaintext and may not be re-importable by this version if collections or strings exceed limits. Verify the download and destination, then move it to a secure location or delete it when no longer needed."
        : isDirty ||
            persistenceStatus === "saving" ||
              persistenceStatus === "error"
          ? "Rescue backup download requested. The unencrypted plaintext backup contains current page data and may be newer than the last successful save. Verify the download and destination, then secure or delete the file."
          : "Backup download requested. The backup is unencrypted plaintext. Verify the download and destination, then secure or delete the file.",
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    importAbortControllerRef.current?.abort();
    importAbortControllerRef.current = null;
    if (selectedPreflightRef.current) {
      revokeBackupImportPreflightReceipt(
        selectedPreflightRef.current,
      );
    }
    const file = event.target.files?.[0];
    const selectionTimeSnapshot = captureLedgerTime(clock);
    const selectionGeneration = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = selectionGeneration;
    selectedPreflightRef.current = null;
    suspicionConfirmationRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setPreflightResult(null);
    setCopyState("idle");
    setMessage("");
    setImportErrors([]);

    if (!file) {
      setImportState("idle");
      return;
    }

    const bytePolicy = evaluateLedgerByteLengthResourcePolicy(file.size);
    if (!bytePolicy.ok) {
      setImportState("preflight-blocked");
      setMessage("Import failed: the file exceeds the 8 MiB limit.");
      setImportErrors(bytePolicy.errors);
      return;
    }

    setImportState("reading");
    void (async () => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        if (isCurrentSelection(selectionGeneration)) {
          setImportState("preflight-blocked");
          setMessage("The backup file could not be read.");
        }
        return;
      }

      if (!isCurrentSelection(selectionGeneration)) {
        return;
      }

      setImportState("preflighting");
      let result: BackupImportPreflightResult;
      try {
        result = await preflight(text, {
          todayKey: selectionTimeSnapshot.todayKey,
          selectionGeneration,
          // C's new historical path is strict. Existing generic rescue restore
          // keeps the optional rawText schema contract.
          requireHistoricalRawText: requiresHistoricalRawText,
        });
      } catch {
        if (isCurrentSelection(selectionGeneration)) {
          setImportState("preflight-blocked");
          setMessage("Preflight failed; the current ledger and C file were not written.");
        }
        return;
      }

      if (!isCurrentSelection(selectionGeneration)) {
        revokeBackupImportPreflightReceipt(result);
        return;
      }

      selectedPreflightRef.current = result;
      setPreflightResult(result);
      if (result.hardErrorCount > 0) {
        setImportState("preflight-blocked");
        setMessage("Preflight found hard errors; import must not continue.");
        return;
      }
      if (result.suspiciousGroupCount > 0) {
        setImportState("awaiting-suspicion-confirmation");
        setMessage(
          "Preflight found no hard errors but did find suspicious duplicate groups. The app did not automatically modify, delete, merge, or deduplicate anything.",
        );
        return;
      }

      setImportState(
        canImportBackup
          ? "awaiting-confirmation"
          : "ready-without-suspicions",
      );
      setMessage(
        canImportBackup
          ? "Preflight passed. Writing begins only after confirmation."
          : "Preflight passed. The current C exposes read-only preflight only; no import or save capability was called.",
      );
    })();
  }

  function confirmSuspiciousGroups() {
    const result = selectedPreflightRef.current;
    if (
      !result ||
      result.hardErrorCount > 0 ||
      result.suspiciousGroupCount === 0 ||
      result.selectionGeneration !== selectionGenerationRef.current
    ) {
      return;
    }

    const confirmation =
      confirmBackupImportSuspiciousGroups(result);
    if (!confirmation) {
      return;
    }
    suspicionConfirmationRef.current = confirmation;
    setImportState(
      canImportBackup
        ? "awaiting-confirmation"
        : "ready-without-suspicions",
    );
    setMessage(
      canImportBackup
        ? "Current suspicious groups confirmed. Nothing has been written; full replacement still requires confirmation."
        : "Current suspicious groups confirmed. The current C remains read-only preflight and no write capability was called.",
    );
  }

  async function copyPreflightReport() {
    const result = selectedPreflightRef.current;
    if (
      !result ||
      result.selectionGeneration !== selectionGenerationRef.current
    ) {
      return;
    }

    const generation = result.selectionGeneration;
    const contentIdentity = result.contentIdentity.value;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(
        formatBackupImportReportMarkdown(result),
      );
    } catch {
      if (isSamePreflight(generation, contentIdentity)) {
        setCopyState("error");
      }
      return;
    }

    if (isSamePreflight(generation, contentIdentity)) {
      setCopyState("copied");
    }
  }

  async function confirmImport() {
    const result = selectedPreflightRef.current;
    if (
      !result ||
      !canCommit ||
      result.selectionGeneration !== selectionGenerationRef.current ||
      result.hardErrorCount > 0 ||
      result.candidate === undefined ||
      result.candidateIdentity === undefined ||
      !hasCurrentSuspicionConfirmation(
        result,
        suspicionConfirmationRef.current,
      )
    ) {
      return;
    }

    const generation = result.selectionGeneration;
    const contentIdentity = result.contentIdentity.value;
    const evidence = createLedgerBackupImportEvidence(
      result,
      suspicionConfirmationRef.current,
    );
    if (!evidence) {
      return;
    }
    const importController = new AbortController();
    importAbortControllerRef.current?.abort();
    importAbortControllerRef.current = importController;
    setImportState("importing");
    setMessage("");
    const importResult = await onImport(
      structuredClone(result.candidate),
      captureLedgerTime(clock),
      evidence,
      importController.signal,
    );
    if (importAbortControllerRef.current === importController) {
      importAbortControllerRef.current = null;
    }
    if (!isSamePreflight(generation, contentIdentity)) {
      return;
    }
    if (importResult.ok) {
      resetFileSelection();
      setImportState("success");
      setMessage("Backup restored and saved locally.");
      return;
    }

    if (importResult.errors) {
      setImportErrors(importResult.errors);
    }
    setImportState("write-error");
    setMessage(
      importResult.code === "LEDGER_IMPORT_NOT_ALLOWED"
        ? "The current state does not allow backup restoration."
        : importResult.code === "LEDGER_IMPORT_INVALID_BACKUP"
          ? "The backup content did not pass validation."
          : importResult.code === "LEDGER_IMPORT_CANCELLED"
            ? "Import canceled; the current page was not replaced."
            : importResult.code === "LEDGER_IMPORT_BASE_RESTORED"
              ? "Import did not complete. A reread confirmed C was restored to the complete pre-import version; the page did not change."
              : importResult.code === "LEDGER_IMPORT_SOURCE_CHANGED"
                ? "C changed externally before import writing. Nothing was written; reopen C."
                : importResult.code === "LEDGER_IMPORT_RECOVERY_BLOCKED"
                  ? "The import result cannot be confirmed and C restoration cannot be proven. Writes are disabled for this session; lock immediately and preserve the file for recovery."
                  : "Import failed and the page did not change. No further evidence confirms the underlying storage state; follow the error guidance.",
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
    <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
        Ledger backups are unencrypted plaintext. Anyone with file access may read all assets, trades, and prices. Export only requests a browser download; verify the result and destination, then secure or delete the file. Saving to
        a synchronized folder such as iCloud Drive or OneDrive may upload or synchronize it automatically.
      </p>
      <div className="flex flex-wrap gap-3">
        {showExport ? (
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canExport}
            onClick={handleExport}
            type="button"
          >
            Export complete ledger backup
          </button>
        ) : null}
        {showPreflight ? (
          <label className="w-fit cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            Select backup file and run preflight
            <input
              accept="application/json,.json"
              aria-label="Select ledger backup file"
              className="sr-only"
              disabled={!canSelect}
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
          </label>
        ) : null}
      </div>

      {hydrationStatus === "loading" ? <p>Preflight, import, and export are unavailable until loading completes.</p> : null}
      {hydrationStatus === "error" ? (
        <>
          <p>A valid backup can restore the local ledger.</p>
          <p>The system first performs a read-only preflight; restoration requires a write capability.</p>
        </>
      ) : null}
      {isReadOnly ? (
        <p>The ledger is read-only. Only an 8 MiB-limited rescue export is available; oversized collections or strings may prevent re-import, and read-only protection forbids overwriting the oversized ledger after preflight.</p>
      ) : null}
      {persistenceStatus === "saving" || persistenceStatus === "error" ? (
        <p>The current page ledger can be exported as a plaintext rescue backup and may be newer than the last successful save.</p>
      ) : null}

      {importState === "reading" || importState === "preflighting" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p aria-live="polite">
            {importState === "reading"
              ? "Reading the backup file."
              : "Running read-only preflight; the current ledger and C file will not be written."}
          </p>
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
            onClick={cancelSelection}
            type="button"
          >
            Cancel
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
            Review every suspicious duplicate group in the report. Confirmation only records that you read the warning; it does not delete, merge, or modify trades.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-amber-700 px-3 py-2 font-medium text-white"
              onClick={confirmSuspiciousGroups}
              type="button"
            >
              I reviewed every suspicious group
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
              onClick={cancelSelection}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {importState === "awaiting-confirmation" ? (
        <div className="grid gap-3 border-t border-slate-200 pt-3">
          <p className="font-medium text-amber-900">
            {hydrationStatus === "error"
              ? "A successful restore replaces the damaged record; failure retains the original record."
              : isDirty
                ? "Import completely replaces the current ledger without merging. Unsaved page data will also be replaced; export a rescue backup first if needed."
                : "Import completely replaces the current ledger without merging."}
          </p>
          <p className="text-sm leading-6 text-amber-900">
            The selected source backup remains unencrypted plaintext. This app does not move, delete, or upload it. If it resides in
            a synchronized folder such as iCloud Drive or OneDrive, the system may synchronize it automatically.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-slate-950 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canCommit}
              onClick={() => void confirmImport()}
              type="button"
            >
              Confirm backup restoration
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
              onClick={cancelSelection}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {importState === "ready-without-suspicions" && !canImportBackup ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
          The current C exposes only read-only B preflight and report copying. No import write capability exists, and this operation did not call
          save, clear, or any C writable.
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
          Cancel
        </button>
      ) : null}

      {importState === "preflight-blocked" && preflightResult ? (
        <p className="font-medium text-red-800">
          Hard errors exist. Continue import is unavailable and cannot be bypassed by suspicious-group confirmation.
        </p>
      ) : null}

      {importState === "importing" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p aria-live="polite">
            Writing and rereading C for verification. If writing has begun, cancel attempts to restore and reread the complete pre-import C. If restoration cannot be confirmed, the session disables further writes and reports an explicit error.
          </p>
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
            onClick={cancelSelection}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {importErrors.length > 0 ? (
        <div aria-live="polite" className="grid gap-2 text-sm text-red-800">
          <p>
            Found {importErrors.length} import errors; showing the first{" "}
            {Math.min(importErrors.length, 5)}.
          </p>
          <ul className="grid gap-1">
            {importErrors.slice(0, 5).map((error, index) => (
              <li key={`${error.code}-${error.path}-${index}`}>
                <code>{error.code}</code> · <code>{error.path}</code> ·{" "}
                {error.message}
                {"limit" in error
                  ? ` (limit ${error.limit}, actual ${error.actual})`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {message ? <p aria-live="polite">{message}</p> : null}
    </div>
  );
}

function PreflightReportView({
  copyState,
  onCopy,
  result,
}: Readonly<{
  copyState: CopyState;
  onCopy: () => void;
  result: BackupImportPreflightResult;
}>) {
  return (
    <section className="grid gap-3 border-t border-slate-200 pt-3">
      <h3 className="font-semibold text-slate-900">Historical B Import Preflight Report</h3>
      <p className="text-sm text-amber-900">
        Privacy notice: the report may contain trade dates, assets, directions, quantities, and amounts. Confirm the destination is secure before copying.
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm text-slate-700">
        <div>
          <dt className="text-slate-500">App version</dt>
          <dd>{result.metadata?.appVersion ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Exported at</dt>
          <dd>{result.metadata?.exportedAt ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Assets</dt>
          <dd>{result.metadata?.assetCount ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Trades</dt>
          <dd>{result.metadata?.tradeCount ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Price snapshots</dt>
          <dd>{result.metadata?.priceSnapshotCount ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Fee rules</dt>
          <dd>{result.metadata?.feeRuleCount ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Hard errors</dt>
          <dd>{result.hardErrorCount}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Suspicious duplicate groups</dt>
          <dd>{result.suspiciousGroupCount}</dd>
        </div>
      </dl>
      <p className="break-all text-xs text-slate-600">
        B SHA-256: <code>{result.contentIdentity.sha256}</code>
      </p>
      {result.hardErrorCount > 0 ? (
        <p>
          Found {result.hardErrorCount} import errors; the page shows the first{" "}
          {Math.min(
            result.hardErrorCount,
            result.visibleDetails.filter(
              (detail) => detail.kind === "hard-error",
            ).length,
          )}{" "}
          items.
        </p>
      ) : null}

      {result.visibleDetails.length > 0 ? (
        <ol
          aria-label="Preflight details (up to 50 items on the page)"
          className="grid max-h-80 gap-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-sm"
        >
          {result.visibleDetails.map((detail, index) => (
            <li key={detailKey(detail, index)}>
              {detail.kind === "hard-error" ? (
                <>
                  <strong>Hard error</strong> · <code>{detail.code}</code> ·{" "}
                  <code>{detail.path}</code> · {detail.message}
                  {detail.line !== undefined && detail.column !== undefined
                    ? ` (line ${detail.line}, column ${detail.column})`
                    : ""}
                </>
              ) : (
                <>
                  <strong>
                    {detail.group.level === "high"
                      ? "Highly suspicious"
                      : "Suspicious"}
                  </strong>{" "}
                  ·{" "}
                  {detail.group.tradePaths.map((path) => (
                    <code className="mr-1" key={path}>
                      {path}
                    </code>
                  ))}
                  · no automatic modification, deletion, merge, or deduplication
                </>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p>No hard errors or suspicious duplicate groups were found.</p>
      )}

      <p className="text-sm text-slate-700">
        The page shows {result.visibleDetails.length} items; the copied report retains{" "}
        {result.retainedDetailCount} / {result.totalDetailCount}.
        {result.truncated
          ? " Details after item 1000 were truncated; correct the data and run the check again."
          : ""}
      </p>
      {result.skippedChecks.length > 0 ? (
        <div className="text-sm text-amber-900">
          <p>The following checks did not run safely and cannot be reported as passed:</p>
          <ul>
            {result.skippedChecks.map(({ check, reason }) => (
              <li key={check}>
                <code>{check}</code> · {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={copyState === "copying"}
          onClick={onCopy}
          type="button"
        >
          Copy Markdown report
        </button>
        {copyState === "copying" ? <span>Copying report.</span> : null}
        {copyState === "copied" ? <span>Report copied.</span> : null}
        {copyState === "error" ? (
          <span className="text-red-800">
            Copy failed; this operation was not marked as copied.
          </span>
        ) : null}
      </div>
    </section>
  );
}

function hasCurrentSuspicionConfirmation(
  result: BackupImportPreflightResult,
  confirmation: BackupSuspicionConfirmationReceipt | null = null,
): boolean {
  return isBackupImportSuspicionConfirmationValid(
    result,
    confirmation,
  );
}

function detailKey(detail: BackupPreflightDetail, index: number): string {
  return detail.kind === "hard-error"
    ? `hard-${detail.stage}-${detail.code}-${detail.path}-${index}`
    : `group-${detail.group.tradeIndices.join("-")}-${index}`;
}
