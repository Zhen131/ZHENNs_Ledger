"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import packageJson from "@root/package.json";
import { downloadBackupJson } from "./backupDownload";
import {
  createBackupEnvelope,
  serializeBackupEnvelope,
  type BackupEnvelopeError,
} from "./backupEnvelope";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  preflightBackupJson,
  revokeBackupImportPreflightReceipt,
  type BackupImportPreflightResult,
  type BackupSuspicionConfirmationReceipt,
  type LedgerBackupImportEvidence,
} from "./backupImportPreflight";
import { formatBackupImportReportMarkdown } from "./backupImportReport";
import type {
  ApplyLedgerActionResult,
  PersistenceOperation,
} from "@/app";
import type { LedgerData } from "@/core/models";
import type { HydrationStatus } from "@/app";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  evaluateLedgerByteLengthResourcePolicy,
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "@/core/validation";
import {
  getBinanceMappingSignature,
  listAssetsMissingBinanceMapping,
  mergeBinancePriceRefresh,
  type BinanceRefreshSuccess,
} from "@/features/market-data";
import {
  createBinanceMarketDataClient,
  type BinanceMarketDataClient,
} from "@/platform/integrations";
import { SUPPORTED_LEDGER_SCHEMA_VERSION } from "@/platform/files";
import { useLanguage } from "@/ui";
import {
  isPostImportPairingBusy,
  hasCurrentSuspicionConfirmation,
} from "./backupControlsHelpers";
import type {
  ImportState,
  CopyState,
  PostImportPairingFailure,
  PostImportPairingState,
  PostImportPairingOperation,
} from "./backupControlsTypes";
import { PreflightReportView } from "./PreflightReportView";
import {
  doPairingOperationIsCurrent,
  doStartPostImportPairing,
} from "./backupControlsPairing";

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
  }, []);

  useEffect(() => {
    const operation = pairingOperationRef.current;
    if (operation && !pairingOperationIsCurrent(operation)) {
      operation.controller.abort();
      pairingOperationRef.current = null;
      if (mountedRef.current) {
        setPostImportPairing((current) =>
          current
            ? {
                ...current,
                status: "error",
                message:
                  t("backup.pairing.cancelled"),
              }
            : current,
        );
      }
    }
  }, [isWritable, ledgerEpoch, sessionGeneration, t]);

  useEffect(() => {
    const operation = pairingOperationRef.current;
    if (
      !operation ||
      operation.expectedPersistedVersion === null ||
      !pairingOperationIsCurrent(operation)
    ) {
      return;
    }

    if (
      persistenceStatus === "error" &&
      mutationVersion >= operation.expectedPersistedVersion
    ) {
      finishPostImportPairing(
        operation,
        "error",
        operation.phase === "saving-mappings"
          ? t("backup.pairing.mappingNotPersisted")
          : t("backup.pairing.priceNotPersisted"),
      );
      return;
    }

    if (
      persistenceStatus === "saved" &&
      persistedVersion >= operation.expectedPersistedVersion
    ) {
      operation.expectedPersistedVersion = null;
      if (operation.phase === "saving-mappings") {
        operation.phase = "fetching-prices";
        setPostImportPairing((current) =>
          current
            ? {
                ...current,
                status: "fetching-prices",
                message: t("backup.pairing.mappingSavedFetching"),
              }
            : current,
        );
        void fetchPostImportPrices(operation);
      } else if (operation.phase === "saving-prices") {
        completePostImportPairing(operation);
      }
    }
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
    if (!pairingOperationIsCurrent(operation)) return;
    const marketSymbolToAsset = new Map(
      operation.mappingSuccesses.map((success) => [
        success.mapping.symbol,
        success.assetSymbol,
      ]),
    );
    let tickerResult;
    try {
      tickerResult = await marketDataClient.fetchLatestPrices(
        [...marketSymbolToAsset.keys()],
        operation.controller.signal,
      );
    } catch {
      if (pairingOperationIsCurrent(operation)) {
        operation.priceFailures = operation.mappingSuccesses.map(
          ({ assetSymbol }) => ({
            assetSymbol,
            code: "BINANCE_NETWORK_ERROR",
            message: t("backup.pairing.priceRequestFailed"),
          }),
        );
        completePostImportPairing(operation);
      }
      return;
    }
    if (!pairingOperationIsCurrent(operation)) return;

    const acceptedTime = captureLedgerTime(clock);
    const successes: BinanceRefreshSuccess[] = [];
    const failures: PostImportPairingFailure[] = tickerResult.failures.map(
      (failure) => ({
        assetSymbol:
          marketSymbolToAsset.get(failure.symbol) ?? failure.symbol,
        code: failure.code,
        message: failure.message,
      }),
    );
    const failedMarketSymbols = new Set(
      tickerResult.failures.map((failure) => failure.symbol),
    );
    for (const mappingSuccess of operation.mappingSuccesses) {
      if (failedMarketSymbols.has(mappingSuccess.mapping.symbol)) continue;
      const ticker = tickerResult.prices.find(
        (price) => price.symbol === mappingSuccess.mapping.symbol,
      );
      if (!ticker) {
        failures.push({
          assetSymbol: mappingSuccess.assetSymbol,
          code: "BINANCE_SYMBOL_MISSING",
          message: t("backup.pairing.tickerMissing"),
        });
        continue;
      }
      successes.push({
        assetSymbol: mappingSuccess.assetSymbol,
        mapping: mappingSuccess.mapping,
        price: ticker.price,
        recordedAt: acceptedTime.todayKey,
        fetchedAt: acceptedTime.now.toISOString(),
      });
    }
    operation.priceFailures = failures;
    if (successes.length === 0) {
      completePostImportPairing(operation);
      return;
    }

    const expectedVersion = pairingLatestRef.current.mutationVersion + 1;
    let appliedCount = 0;
    let skippedSymbols: string[] = [];
    const mutationResult = applyLedgerMutation?.(
      (current) => {
        if (
          getBinanceMappingSignature(current) !==
          operation.expectedMappingSignature
        ) {
          return current;
        }
        const merged = mergeBinancePriceRefresh(
          current,
          successes,
          generateId,
        );
        appliedCount = merged.appliedAssetSymbols.length;
        skippedSymbols = merged.skippedAssetSymbols;
        return merged.ledgerData;
      },
      acceptedTime,
    );
    if (!pairingOperationIsCurrent(operation)) return;
    operation.appliedPriceCount = appliedCount;
    operation.priceFailures.push(
      ...skippedSymbols.map((assetSymbol) => ({
        assetSymbol,
        code: "BINANCE_PRICE_NOT_APPLIED",
        message: t("backup.pairing.priceNotWritten"),
      })),
    );
    if (mutationResult === "applied" && appliedCount > 0) {
      operation.phase = "saving-prices";
      operation.expectedPersistedVersion = expectedVersion;
      setPostImportPairing((current) =>
        current
          ? {
              ...current,
              status: "saving-prices",
              message: `${t("backup.pairing.pricesFetchedPrefix")}${appliedCount}${t("backup.pairing.pricesFetchedSuffix")}`,
              failures: [
                ...operation.mappingFailures,
                ...operation.priceFailures,
              ],
            }
          : current,
      );
      return;
    }
    const failedPriceAssets = new Set(
      operation.priceFailures.map(({ assetSymbol }) => assetSymbol),
    );
    operation.priceFailures.push(
      ...successes
        .filter(({ assetSymbol }) => !failedPriceAssets.has(assetSymbol))
        .map(({ assetSymbol }) => ({
          assetSymbol,
          code: "BINANCE_PRICE_NOT_APPLIED",
          message: t("backup.pairing.priceNotWrittenByLedger"),
        })),
    );
    completePostImportPairing(operation);
  }

  function completePostImportPairing(
    operation: PostImportPairingOperation,
  ) {
    if (!pairingOperationIsCurrent(operation)) return;
    const failures = [
      ...operation.mappingFailures,
      ...operation.priceFailures,
    ];
    const successfulMutationCount =
      operation.appliedMappingSymbols.length + operation.appliedPriceCount;
    finishPostImportPairing(
      operation,
      failures.length === 0
        ? "success"
        : successfulMutationCount > 0
          ? "partial"
          : "error",
      `${t("backup.pairing.completePrefix")}${operation.appliedMappingSymbols.length}${t("backup.pairing.completeMappingMiddle")}${operation.appliedPriceCount}${t("backup.pairing.completePriceMiddle")}${failures.length}${t("backup.pairing.completeSuffix")}`,
    );
  }

  function finishPostImportPairing(
    operation: PostImportPairingOperation,
    status: "success" | "partial" | "error",
    message: string,
  ) {
    if (!pairingOperationIsCurrent(operation)) return;
    pairingOperationRef.current = null;
    setPostImportPairing((current) =>
      current
        ? {
            ...current,
            status,
            message,
            failures: [
              ...operation.mappingFailures,
              ...operation.priceFailures,
            ],
          }
        : current,
    );
  }

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

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    dismissPostImportPairing();
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
      setMessage(t("backup.import.fileTooLarge"));
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
          setMessage(t("backup.import.readFailed"));
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
          sourceFileName: file.name,
          // Normal V4 restore keeps Trade.rawText optional; only an explicitly
          // selected historical-ingest surface opts into strict source lines.
          requireHistoricalRawText: requiresHistoricalRawText,
        });
      } catch {
        if (isCurrentSelection(selectionGeneration)) {
          setImportState("preflight-blocked");
          setMessage(t("backup.import.preflightFailed"));
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
        setMessage(t("backup.import.hardErrors"));
        return;
      }
      if (result.suspiciousGroupCount > 0) {
        setImportState("awaiting-suspicion-confirmation");
        setMessage(
          t("backup.import.suspiciousGroups"),
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
          ? t("backup.import.preflightPassedWritable")
          : t("backup.import.preflightPassedReadOnly"),
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
        ? t("backup.import.suspicionConfirmedWritable")
        : t("backup.import.suspicionConfirmedReadOnly"),
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
      const missingMappingSymbols = listAssetsMissingBinanceMapping(
        result.candidate,
      );
      resetFileSelection();
      setImportState("success");
      setMessage(t("backup.import.restored"));
      setPostImportPairing(
        missingMappingSymbols.length === 0
          ? null
          : {
              symbols: missingMappingSymbols,
              status: "prompt",
              message:
                t("backup.pairing.ready"),
              failures: [],
            },
      );
      return;
    }

    if (importResult.errors) {
      setImportErrors(importResult.errors);
    }
    setImportState("write-error");
    setMessage(
      importResult.code === "LEDGER_IMPORT_NOT_ALLOWED"
        ? t("backup.import.statusNotAllowed")
        : importResult.code === "LEDGER_IMPORT_INVALID_BACKUP"
          ? t("backup.import.validationFailed")
          : importResult.code === "LEDGER_IMPORT_CANCELLED"
            ? t("backup.import.cancelled")
            : importResult.code === "LEDGER_IMPORT_BASE_RESTORED"
              ? t("backup.import.restoredOriginal")
              : importResult.code === "LEDGER_IMPORT_SOURCE_CHANGED"
                ? t("backup.import.externalChange")
                : importResult.code === "LEDGER_IMPORT_RECOVERY_BLOCKED"
                  ? t("backup.import.resultUnknown")
                  : t("backup.import.failed"),
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
      <div
        className={
          presentation === "transfer"
            ? "grid gap-3 min-[1100px]:grid-cols-[minmax(220px,.7fr)_minmax(0,1.3fr)]"
            : "flex flex-wrap gap-3"
        }
      >
        {showExport ? (
          <button
            aria-describedby={persistenceOperation !== "idle" ? "backup-controls-disabled-reason" : undefined}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canExport}
            onClick={handleExport}
            type="button"
          >
            {presentation === "transfer"
              ? t("backup.action.exportPlaintext")
              : t("backup.action.export")}
          </button>
        ) : null}
        {showPreflight ? (
          <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-center font-medium text-slate-800 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            {presentation === "transfer"
              ? t("backup.action.selectPlaintext")
              : t("backup.action.select")}
            <input
              accept="application/json,.json"
              aria-describedby={persistenceOperation !== "idle" ? "backup-controls-disabled-reason" : undefined}
              aria-label={t("backup.action.selectAriaLabel")}
              className="sr-only"
              disabled={!canSelect}
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
          </label>
        ) : null}
      </div>

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
        <section
          aria-label={t("backup.pairing.ariaLabel")}
          className="grid gap-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
        >
          <h3 className="font-semibold">{t("backup.pairing.heading")}</h3>
          <p aria-live="polite">{postImportPairing.message}</p>
          <p>
            {t("backup.pairing.pending")}<strong>{postImportPairing.symbols.join(t("backup.pairing.separator"))}</strong>
          </p>
          {postImportPairing.failures.length > 0 ? (
            <ul className="grid gap-1 text-red-800">
              {postImportPairing.failures.map((failure, index) => (
                <li key={`${failure.assetSymbol}-${failure.code}-${index}`}>
                  <strong>{failure.assetSymbol}</strong> ·{" "}
                  <code>{failure.code}</code> · {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-sky-900 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                isPostImportPairingBusy(postImportPairing.status) ||
                !isWritable ||
                !applyLedgerMutation
              }
              onClick={() => void startPostImportPairing()}
              type="button"
            >
              {isPostImportPairingBusy(postImportPairing.status)
                ? t("backup.pairing.running")
                : postImportPairing.status === "prompt"
                  ? t("backup.pairing.autoPair")
                  : t("backup.pairing.retry")}
            </button>
            <button
              className="rounded-md border border-sky-300 bg-white px-3 py-2 font-medium text-sky-900"
              disabled={isPostImportPairingBusy(postImportPairing.status)}
              onClick={dismissPostImportPairing}
              type="button"
            >
              {t("backup.pairing.later")}
            </button>
          </div>
          {!isWritable || !applyLedgerMutation ? (
            <p>
              {t("backup.pairing.notWritable")}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
