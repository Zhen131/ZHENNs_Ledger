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
  isBackupImportSuspicionConfirmationValid,
  preflightBackupJson,
  revokeBackupImportPreflightReceipt,
  type BackupImportPreflightResult,
  type BackupPreflightDetail,
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
  autoPairMissingBinanceMappings,
  getBinanceMappingSignature,
  listAssetsMissingBinanceMapping,
  mergeAutoPairedBinanceMappings,
  mergeBinancePriceRefresh,
  type BinanceAutoPairFailure,
  type BinanceAutoPairSuccess,
  type BinanceRefreshSuccess,
} from "@/features/market-data";
import {
  createBinanceMarketDataClient,
  type BinanceMarketDataClient,
} from "@/platform/integrations";
import { LedgerNumber, useLanguage } from "@/ui";

const defaultMarketDataClient = createBinanceMarketDataClient();
type Translate = ReturnType<typeof useLanguage>["t"];

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

type PostImportPairingFailure = Readonly<{
  assetSymbol: string;
  code: string;
  message: string;
}>;

type PostImportPairingState = Readonly<{
  symbols: readonly string[];
  status:
    | "prompt"
    | "validating"
    | "saving-mappings"
    | "fetching-prices"
    | "saving-prices"
    | "success"
    | "partial"
    | "error";
  message: string;
  failures: readonly PostImportPairingFailure[];
}>;

type PostImportPairingOperation = {
  controller: AbortController;
  ledgerEpoch: number;
  sessionGeneration: number;
  phase:
    | "validating"
    | "saving-mappings"
    | "fetching-prices"
    | "saving-prices";
  expectedPersistedVersion: number | null;
  expectedMappingSignature: string;
  mappingSuccesses: BinanceAutoPairSuccess[];
  mappingFailures: PostImportPairingFailure[];
  appliedMappingSymbols: string[];
  appliedPriceCount: number;
  priceFailures: PostImportPairingFailure[];
};

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
    const latest = pairingLatestRef.current;
    return (
      mountedRef.current &&
      pairingOperationRef.current === operation &&
      latest.isWritable &&
      latest.ledgerEpoch === operation.ledgerEpoch &&
      latest.sessionGeneration === operation.sessionGeneration
    );
  }

  function dismissPostImportPairing() {
    pairingOperationRef.current?.controller.abort();
    pairingOperationRef.current = null;
    setPostImportPairing(null);
  }

  async function startPostImportPairing() {
    const currentPrompt = postImportPairing;
    const latest = pairingLatestRef.current;
    if (
      !currentPrompt ||
      pairingOperationRef.current ||
      !latest.isWritable ||
      !applyLedgerMutation
    ) {
      return;
    }
    const currentMissing = new Set(
      listAssetsMissingBinanceMapping(latest.ledgerData),
    );
    const frozenSymbols = currentPrompt.symbols.filter((symbol) =>
      currentMissing.has(symbol),
    );
    if (frozenSymbols.length === 0) {
      setPostImportPairing({
        ...currentPrompt,
        status: "success",
      message: t("backup.pairing.allMappingsPresent"),
        failures: [],
      });
      return;
    }

    const operation: PostImportPairingOperation = {
      controller: new AbortController(),
      ledgerEpoch: latest.ledgerEpoch,
      sessionGeneration: latest.sessionGeneration,
      phase: "validating",
      expectedPersistedVersion: null,
      expectedMappingSignature: getBinanceMappingSignature(latest.ledgerData),
      mappingSuccesses: [],
      mappingFailures: [],
      appliedMappingSymbols: [],
      appliedPriceCount: 0,
      priceFailures: [],
    };
    pairingOperationRef.current = operation;
    setPostImportPairing({
      symbols: frozenSymbols,
      status: "validating",
      message: `${t("backup.pairing.validatingPrefix")}${frozenSymbols.length}${t("backup.pairing.validatingSuffix")}`,
      failures: [],
    });

    let result;
    try {
      result = await autoPairMissingBinanceMappings(
        marketDataClient,
        frozenSymbols,
        operation.controller.signal,
      );
    } catch {
      if (pairingOperationIsCurrent(operation)) {
        finishPostImportPairing(
          operation,
          "error",
          t("backup.pairing.validationFailed"),
        );
      }
      return;
    }
    if (!pairingOperationIsCurrent(operation)) return;

    operation.mappingFailures = result.failures.map((failure) =>
      normalizePairingFailure(failure, t),
    );
    if (result.successes.length === 0) {
      finishPostImportPairing(
        operation,
        "error",
        `${t("backup.pairing.noMappingPrefix")}${result.failures.length}${t("backup.pairing.noMappingSuffix")}`,
      );
      return;
    }

    const acceptedTime = captureLedgerTime(clock);
    const expectedVersion = pairingLatestRef.current.mutationVersion + 1;
    let appliedSymbols: string[] = [];
    let expectedSignature = operation.expectedMappingSignature;
    const mutationResult = applyLedgerMutation(
      (current) => {
        if (
          getBinanceMappingSignature(current) !==
          operation.expectedMappingSignature
        ) {
          return current;
        }
        const merged = mergeAutoPairedBinanceMappings(
          current,
          result.successes,
          acceptedTime.now.toISOString(),
        );
        appliedSymbols = merged.appliedAssetSymbols;
        expectedSignature = getBinanceMappingSignature(merged.ledgerData);
        return merged.ledgerData;
      },
      acceptedTime,
    );
    if (!pairingOperationIsCurrent(operation)) return;

    operation.appliedMappingSymbols = appliedSymbols;
    operation.mappingSuccesses = result.successes.filter((success) =>
      appliedSymbols.includes(success.assetSymbol),
    );
    operation.expectedMappingSignature = expectedSignature;
    if (mutationResult === "applied" && appliedSymbols.length > 0) {
      operation.phase = "saving-mappings";
      operation.expectedPersistedVersion = expectedVersion;
      setPostImportPairing({
        symbols: frozenSymbols,
        status: "saving-mappings",
        message: `${t("backup.pairing.validatedPrefix")}${appliedSymbols.length}${t("backup.pairing.validatedSuffix")}`,
        failures: operation.mappingFailures,
      });
      return;
    }

    operation.mappingFailures.push(
      ...result.successes.map(({ assetSymbol }) => ({
        assetSymbol,
        code: "BINANCE_MAPPING_NOT_APPLIED",
        message: t("backup.pairing.validationNotWritten"),
      })),
    );

    finishPostImportPairing(
      operation,
      operation.mappingFailures.length > 0 ? "partial" : "error",
      t("backup.pairing.mappingNotSaved"),
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
      setMessage(t("backup.export.invalidLedger"));
      return;
    }

    const serialized = serializeBackupEnvelope(envelopeResult.value);
    const bytePolicy = evaluateLedgerJsonResourcePolicy(serialized);
    if (!bytePolicy.ok) {
      setMessage(
        t("backup.export.tooLarge"),
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

function normalizePairingFailure(
  failure: BinanceAutoPairFailure,
  t: Translate,
): PostImportPairingFailure {
  return {
    assetSymbol: failure.assetSymbol,
    code: failure.code,
    message:
      failure.code === "BINANCE_VALIDATION_UNAVAILABLE"
        ? t("marketData.failure.validationUnavailable")
        : failure.message,
  };
}

function isPostImportPairingBusy(
  status: PostImportPairingState["status"],
): boolean {
  return (
    status === "validating" ||
    status === "saving-mappings" ||
    status === "fetching-prices" ||
    status === "saving-prices"
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
  const { t } = useLanguage();
  const unavailable = t("backup.report.unavailable");
  return (
    <section className="grid gap-3 border-t border-slate-200 pt-3">
      <h3 className="font-semibold text-slate-900">{t("backup.report.heading")}</h3>
      <p className="text-sm text-amber-900">
        {t("backup.report.privacy")}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm text-slate-700">
        <div>
          <dt className="text-slate-500">{t("backup.report.sourceFile")}</dt>
          <dd>{result.metadata?.sourceFileName ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.backupSchema")}</dt>
          <dd>
            {result.metadata?.backupFormatVersion ?? unavailable} /{" "}
            {result.metadata?.ledgerSchemaVersion ?? unavailable}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.appVersion")}</dt>
          <dd>{result.metadata?.appVersion ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.exportedAt")}</dt>
          <dd>{result.metadata?.exportedAt ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.assets")}</dt>
          <dd>{result.metadata?.assetCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.trades")}</dt>
          <dd>{result.metadata?.tradeCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.cashEvents")}</dt>
          <dd>{result.metadata?.cashEventCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.assetTransfers")}</dt>
          <dd>{result.metadata?.assetTransferCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.priceSnapshots")}</dt>
          <dd>{result.metadata?.priceSnapshotCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.feeRules")}</dt>
          <dd>{result.metadata?.feeRuleCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.cashBalance")}</dt>
          <dd>
            {result.metadata?.cashBalance === undefined ? (
              unavailable
            ) : (
              <LedgerNumber kind="money" value={result.metadata.cashBalance} />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.cashDeficit")}</dt>
          <dd>
            {result.metadata?.cashDeficit === undefined ? (
              unavailable
            ) : (
              <LedgerNumber kind="money" value={result.metadata.cashDeficit} />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.hardErrors")}</dt>
          <dd>{result.hardErrorCount}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.suspiciousGroups")}</dt>
          <dd>{result.suspiciousGroupCount}</dd>
        </div>
      </dl>
      <p className="text-sm text-slate-700">
        {t("backup.report.missingMapping")}
        {result.metadata?.missingMappingSymbols === undefined
          ? unavailable
          : result.metadata.missingMappingSymbols.length === 0
            ? t("backup.report.none")
            : result.metadata.missingMappingSymbols.join(t("backup.pairing.separator"))}
      </p>
      {result.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p>{t("backup.report.warnings")}</p>
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning.code}>
                <code>{warning.code}</code> · {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="break-all text-xs text-slate-600">
        {t("backup.report.sha256")}<code>{result.contentIdentity.sha256}</code>
      </p>
      {result.hardErrorCount > 0 ? (
        <p>
          {t("backup.errors.foundPrefix")} {result.hardErrorCount} {t("backup.errors.showingPrefix")}{" "}
          {Math.min(
            result.hardErrorCount,
            result.visibleDetails.filter(
              (detail) => detail.kind === "hard-error",
            ).length,
          )}{" "}
          {t("backup.errors.suffix")}
        </p>
      ) : null}

      {result.visibleDetails.length > 0 ? (
        <ol
          aria-label={t("backup.report.detailsAriaLabel")}
          className="grid max-h-80 gap-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-sm"
        >
          {result.visibleDetails.map((detail, index) => (
            <li key={detailKey(detail, index)}>
              {detail.kind === "hard-error" ? (
                <>
                  <strong>{t("backup.report.hardErrors")}</strong> · <code>{detail.code}</code> ·{" "}
                  <code>{detail.path}</code> · {detail.message}
                  {detail.line !== undefined && detail.column !== undefined
                    ? `${t("backup.report.locationPrefix")}${detail.line}${t("backup.report.locationMiddle")}${detail.column}${t("backup.report.locationSuffix")}`
                    : ""}
                </>
              ) : (
                <>
                  <strong>
                    {detail.group.level === "high"
                      ? t("backup.report.highSuspicion")
                      : t("backup.report.normalSuspicion")}
                  </strong>{" "}
                  ·{" "}
                  {detail.group.tradePaths.map((path) => (
                    <code className="mr-1" key={path}>
                      {path}
                    </code>
                  ))}
                  · {t("backup.report.notAutoModified")}
                </>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p>{t("backup.report.noIssues")}</p>
      )}

      <p className="text-sm text-slate-700">
        {t("backup.report.visiblePrefix")} {result.visibleDetails.length} {t("backup.report.visibleMiddle")}{" "}
        {result.retainedDetailCount} / {result.totalDetailCount} {t("backup.report.itemsSuffix")}
        {result.truncated
          ? t("backup.report.truncated")
          : ""}
      </p>
      {result.skippedChecks.length > 0 ? (
        <div className="text-sm text-amber-900">
          <p>{t("backup.report.skippedChecks")}</p>
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
          {t("backup.report.copy")}
        </button>
        {copyState === "copying" ? <span>{t("backup.report.copying")}</span> : null}
        {copyState === "copied" ? <span>{t("backup.report.copied")}</span> : null}
        {copyState === "error" ? (
          <span className="text-red-800">
            {t("backup.report.copyFailed")}
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
