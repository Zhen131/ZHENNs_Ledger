"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  usePersistentLedger,
  type LedgerSessionFatalSignal,
  type PersistentLedgerState,
} from "./usePersistentLedger";
import { LedgerWorkspaceFrame } from "./LedgerWorkspaceFrame";
import { HomeWorkspace } from "./HomeWorkspace";
import { RecordWorkspace } from "./RecordWorkspace";
import { TransactionsWorkspace } from "./TransactionsWorkspace";
import { TransferWorkspace } from "./TransferWorkspace";
import { SettingsWorkspace } from "./SettingsWorkspace";
import { useLedgerWorkspaceSession } from "./useLedgerWorkspaceSession";
import {
  INDEXED_DB_LEDGER_CAPABILITIES,
  READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
  type LedgerSession,
  type LedgerRepository,
  type LedgerSessionCapabilities,
  type SessionQuiesceReason,
  type LedgerStorageKind,
} from "@/platform/persistence";
import { USDT_USD_APPROXIMATION_DISCLOSURE } from "@/features/portfolio";
import { validateTradeRemoval } from "@/features/trades";
import { validateAssetTransferRemoval } from "@/features/asset-transfers";
import {
  getLedgerDateKey,
  isLedgerFactInFuture,
  systemLedgerClock,
  type LedgerClock,
} from "@/core/shared";
import { PriceForm } from "@/features/prices/ui";
import { TradeForm, TradeTable } from "@/features/trades/ui";
import { FeeRuleManager } from "@/features/fees/ui";
import { BackupControls } from "@/features/backup/ui";
import { ChartsOverview } from "@/features/charts/ui";
import { MarketDataControls } from "@/features/market-data/ui";
import { LocalAssetManager } from "@/features/assets/ui";
import {
  ConfirmDeleteButton,
  LedgerNumber,
  useLanguage,
  type ConfirmDeleteOutcome,
} from "@/ui";
import {
  resolveDashboardDerivations,
  type DashboardDerivationCache,
  type DashboardDerivationOptions,
  type DashboardDerivations,
} from "./dashboardDerivations";
import type { ClearConfirmationMode } from "./DashboardShellTypes";
import {
  FILE_SAVED_FEEDBACK_MS,
  getWorkspaceFileStatus,
  shortLedgerId,
} from "./DashboardShellHelpers";
import { Section } from "./Section";
import { SummaryMetricCard } from "./SummaryMetricCard";
import { SessionFatalPanel } from "./SessionFatalPanel";
import { SessionQuiescingPanel } from "./SessionQuiescingPanel";
import { LockConfirmationPanel } from "./LockConfirmationPanel";

export function DashboardShell({
  repository: providedRepository,
  clock = systemLedgerClock,
  capabilities: providedCapabilities = INDEXED_DB_LEDGER_CAPABILITIES,
  storageKind: providedStorageKind = "indexeddb",
  session,
  onFinalLock,
  onSessionFatal,
  onSessionDrainReady,
}: Readonly<{
  repository?: LedgerRepository;
  clock?: LedgerClock;
  capabilities?: LedgerSessionCapabilities;
  storageKind?: LedgerStorageKind;
  session?: LedgerSession;
  onFinalLock?: (
    drain: PersistentLedgerState["drainForSessionQuiesce"],
    reason: SessionQuiesceReason,
  ) => Promise<void>;
  onSessionFatal?: (
    drain: PersistentLedgerState["drainForSessionQuiesce"],
    signal: LedgerSessionFatalSignal,
  ) => Promise<void>;
  onSessionDrainReady?: (
    session: LedgerSession,
    drain: PersistentLedgerState["drainForSessionQuiesce"],
  ) => void;
}>) {
  const { t } = useLanguage();
  const repository = session?.repository ?? providedRepository;
  if (!repository) {
    throw new Error("DashboardShell requires a LedgerSession or repository");
  }
  const capabilities =
    session?.capabilities ?? providedCapabilities;
  const storageKind =
    session?.storageKind ?? providedStorageKind;
  const clearConfirmationText =
    storageKind === "ledger-file"
      ? READY_LEDGER_CLEAR_CONFIRMATION_TEXT
      : t("dashboard.clearConfirmation.legacy");
  const {
    ledgerData,
    applyLedgerAction,
    applyLedgerMutation,
    hydrationStatus,
    persistenceError,
    resourcePolicyError,
    isReadOnly,
    retryPersistence,
    canRetryPersistence,
    clearLedger,
    replaceLedgerFromBackup,
    persistenceOperation,
    persistenceStatus,
    mutationVersion,
    persistedVersion,
    isDirty,
    repositorySwitchBlocked,
    discardDirtyChangesAndSwitchRepository,
    compatibilityWarnings,
    isFutureFactCorrectionMode,
    ledgerEpoch,
    todayKey,
    lifecycleStatus,
    sessionFatalSignal,
    drainForSessionQuiesce,
  } = usePersistentLedger(
    repository,
    clock,
    capabilities,
    session,
  );
  const workspace = useLedgerWorkspaceSession({
    defaultAssetSymbol: ledgerData.assets[0]?.symbol ?? "",
    ledgerEpoch,
    todayKey,
  });
  const {
    valuationPriceMode,
    setValuationPriceMode,
    chartRange,
    setChartRange,
  } = workspace;
  const [selectedTradeDate, setSelectedTradeDate] = useState<string | null>(
    null,
  );
  const [tradeRemovalError, setTradeRemovalError] = useState("");
  const [futureCorrectionError, setFutureCorrectionError] = useState("");
  const [clearConfirmationMode, setClearConfirmationMode] =
    useState<ClearConfirmationMode | null>(null);
  const [clearConfirmationValue, setClearConfirmationValue] = useState("");
  const [clearConfirmationError, setClearConfirmationError] = useState("");
  const [clearSuccessMessage, setClearSuccessMessage] = useState("");
  const [showLockConfirmation, setShowLockConfirmation] =
    useState(false);
  const [lockConfirmationHasDrafts, setLockConfirmationHasDrafts] =
    useState(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const mountedRef = useRef(true);
  const workspaceDraftsPresentRef = useRef(false);
  const deliveredFatalSignalRef = useRef<LedgerSessionFatalSignal | null>(null);
  const currentRepositoryRef = useRef(repository);
  currentRepositoryRef.current = repository;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    workspaceDraftsPresentRef.current = false;
    setLockConfirmationHasDrafts(false);
  }, [ledgerEpoch]);

  useEffect(() => {
    if (persistenceStatus !== "saved") {
      setShowSavedFeedback(false);
      return;
    }

    setShowSavedFeedback(true);
    const timeout = setTimeout(
      () => setShowSavedFeedback(false),
      FILE_SAVED_FEEDBACK_MS,
    );
    return () => clearTimeout(timeout);
  }, [persistedVersion, persistenceStatus]);

  useEffect(() => {
    if (
      showLockConfirmation &&
      persistenceStatus === "saved" &&
      !isDirty &&
      !lockConfirmationHasDrafts
    ) {
      setShowLockConfirmation(false);
    }
  }, [
    isDirty,
    lockConfirmationHasDrafts,
    persistenceStatus,
    showLockConfirmation,
  ]);

  useLayoutEffect(() => {
    if (session) {
      onSessionDrainReady?.(session, drainForSessionQuiesce);
    }
  }, [drainForSessionQuiesce, onSessionDrainReady, session]);

  useEffect(() => {
    if (
      !session ||
      !sessionFatalSignal ||
      !onSessionFatal ||
      sessionFatalSignal.sessionId !== session.sessionId ||
      sessionFatalSignal.sessionGeneration !== session.generation ||
      deliveredFatalSignalRef.current === sessionFatalSignal
    ) {
      return;
    }
    deliveredFatalSignalRef.current = sessionFatalSignal;
    void onSessionFatal(
      drainForSessionQuiesce,
      sessionFatalSignal,
    );
  }, [
    drainForSessionQuiesce,
    onSessionFatal,
    session,
    sessionFatalSignal,
  ]);

  useEffect(() => {
    setClearConfirmationMode(null);
    setClearConfirmationValue("");
    setClearConfirmationError("");
    setClearSuccessMessage("");
  }, [repository]);

  useEffect(() => {
    setSelectedTradeDate(null);
  }, [ledgerEpoch]);

  const isWritable =
    lifecycleStatus === "active" &&
    hydrationStatus === "ready" &&
    persistenceOperation === "idle" &&
    !repositorySwitchBlocked &&
    !isReadOnly &&
    !isFutureFactCorrectionMode;
  const canCorrectFutureFacts =
    hydrationStatus === "ready" &&
    persistenceOperation === "idle" &&
    !repositorySwitchBlocked &&
    !isReadOnly &&
    isFutureFactCorrectionMode;
  const {
    projection,
    pnlSummary,
    allocation,
    history,
    heatmap,
  } = useWriteCycleDashboardDerivations(
    ledgerData,
    {
      todayKey,
      valuationPriceMode,
      chartRange,
    },
    ledgerEpoch,
  );
  const positions = projection.positions;
  const displayedTrades = selectedTradeDate
    ? ledgerData.trades.filter(
        (trade) => getLedgerDateKey(trade.occurredAt) === selectedTradeDate,
      )
    : ledgerData.trades;
  const futureTrades = ledgerData.trades.filter((trade) =>
    isLedgerFactInFuture(trade.occurredAt, todayKey),
  );
  const futurePriceSnapshots = ledgerData.priceSnapshots.filter((snapshot) =>
    isLedgerFactInFuture(snapshot.recordedAt, todayKey),
  );
  const futureAssetTransfers = ledgerData.assetTransfers.filter((transfer) =>
    isLedgerFactInFuture(transfer.occurredAt, todayKey),
  );

  function removeValidatedTrade(
    tradeId: string,
    setError: (message: string) => void,
  ): ConfirmDeleteOutcome {
    const result = validateTradeRemoval(tradeId, ledgerData);

    if (!result.ok) {
      setError(
        result.error.code === "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE"
          ? t("dashboard.delete.tradeHasDependents")
          : t("dashboard.delete.tradeMissing"),
      );
      return "rejected";
    }

    const outcome = applyLedgerAction({
      type: "trade/delete",
      tradeId: result.tradeId,
    });
    setError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
  }

  function handleDeleteTrade(tradeId: string): ConfirmDeleteOutcome {
    if (!isWritable) {
      return "rejected";
    }
    return removeValidatedTrade(tradeId, setTradeRemovalError);
  }

  function handleDeleteFutureTrade(tradeId: string): ConfirmDeleteOutcome {
    if (!canCorrectFutureFacts) {
      return "rejected";
    }
    return removeValidatedTrade(tradeId, setFutureCorrectionError);
  }

  function handleDeleteFuturePrice(
    priceSnapshotId: string,
  ): ConfirmDeleteOutcome {
    if (!canCorrectFutureFacts) {
      return "rejected";
    }
    const outcome = applyLedgerAction({
      type: "priceSnapshot/delete",
      priceSnapshotId,
    });
    setFutureCorrectionError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
  }

  function handleDeleteFutureAssetTransfer(
    assetTransferId: string,
  ): ConfirmDeleteOutcome {
    if (!canCorrectFutureFacts) {
      return "rejected";
    }

    const result = validateAssetTransferRemoval(assetTransferId, ledgerData);
    if (!result.ok) {
      setFutureCorrectionError(result.error.message);
      return "rejected";
    }

    const outcome = applyLedgerAction({
      type: "assetTransfer/delete",
      assetTransferId: result.assetTransferId,
    });
    setFutureCorrectionError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
  }

  function handleDeleteAllFutureFacts(): ConfirmDeleteOutcome {
    if (!canCorrectFutureFacts) {
      return "rejected";
    }
    const outcome = applyLedgerAction({
      type: "futureFacts/deleteAll",
      todayKey,
    });
    setFutureCorrectionError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
  }

  function openClearConfirmation(mode: ClearConfirmationMode) {
    if (
      persistenceOperation !== "idle" ||
      repositorySwitchBlocked ||
      isReadOnly ||
      (mode === "normal" && hydrationStatus !== "ready") ||
      (mode === "recovery" && hydrationStatus !== "error")
    ) {
      return;
    }

    setClearConfirmationMode(mode);
    setClearConfirmationValue("");
    setClearConfirmationError("");
    setClearSuccessMessage("");
  }

  function cancelClearConfirmation() {
    if (persistenceOperation !== "idle") {
      return;
    }

    setClearConfirmationMode(null);
    setClearConfirmationValue("");
    setClearConfirmationError("");
  }

  async function handleClearLedger() {
    if (clearConfirmationValue !== clearConfirmationText) {
      setClearConfirmationError(
        `${t("dashboard.clearConfirmation.errorPrefix")}“${clearConfirmationText}”`,
      );
      return;
    }

    const operationRepository = repository;
    setClearConfirmationError("");
    setClearSuccessMessage("");
    const result = await clearLedger(clearConfirmationValue);

    if (
      !mountedRef.current ||
      currentRepositoryRef.current !== operationRepository
    ) {
      return;
    }

    if (!result.ok) {
      return;
    }

    setTradeRemovalError("");
    setSelectedTradeDate(null);
    setClearConfirmationMode(null);
    setClearConfirmationValue("");
    setClearSuccessMessage(
      storageKind === "ledger-file"
        ? t("dashboard.clearSuccess.file")
        : t("dashboard.clearSuccess.legacy"),
    );
  }

  async function handleSettingsClear(
    mode: "normal" | "recovery",
  ): Promise<boolean> {
    if (
      (mode === "normal" && hydrationStatus !== "ready") ||
      (mode === "recovery" && hydrationStatus !== "error")
    ) {
      return false;
    }
    const operationRepository = repository;
    const result = await clearLedger(clearConfirmationText);
    if (
      !mountedRef.current ||
      currentRepositoryRef.current !== operationRepository ||
      !result.ok
    ) {
      return false;
    }
    setTradeRemovalError("");
    setSelectedTradeDate(null);
    return true;
  }

  function requestImmediateLock() {
    if (!session || !onFinalLock || lifecycleStatus !== "active") {
      return;
    }
    const hasDrafts = workspaceDraftsPresentRef.current;
    if (
      isDirty ||
      hasDrafts ||
      persistenceStatus === "saving" ||
      persistenceStatus === "error"
    ) {
      setLockConfirmationHasDrafts(hasDrafts);
      setShowLockConfirmation(true);
      return;
    }
    workspace.resetSessionUi();
    void onFinalLock(
      drainForSessionQuiesce,
      "immediate-lock",
    );
  }

  function confirmDiscardAndLock() {
    if (!session || !onFinalLock || lifecycleStatus !== "active") {
      return;
    }
    setShowLockConfirmation(false);
    workspace.resetSessionUi();
    void onFinalLock(
      drainForSessionQuiesce,
      "immediate-lock",
    );
  }

  async function retrySaveBeforeLock() {
    await retryPersistence();
  }

  const fileStatus = getWorkspaceFileStatus({
    hydrationStatus,
    persistenceStatus,
    hasError: persistenceError !== null,
    isDirty,
    isReadOnly,
    repositorySwitchBlocked,
    t,
  });

  if (
    session &&
    sessionFatalSignal?.sessionId === session.sessionId
  ) {
    return (
      <SessionFatalPanel t={t} />
    );
  }

  if (lifecycleStatus === "quiescing") {
    return (
      <SessionQuiescingPanel t={t} />
    );
  }

  return (
    <LedgerWorkspaceFrame
      currentPage={workspace.currentPage}
      fileStatusLabel={fileStatus.label}
      fileStatusTone={fileStatus.tone}
      onLock={
        session?.storageKind === "ledger-file" && onFinalLock
          ? requestImmediateLock
          : undefined
      }
      onNavigate={(page) => {
        setSelectedTradeDate(null);
        workspace.navigateToPage(page);
      }}
    >
      {showLockConfirmation ? (
        <LockConfirmationPanel
          canRetryPersistence={canRetryPersistence}
          confirmDiscardAndLock={confirmDiscardAndLock}
          lockConfirmationHasDrafts={lockConfirmationHasDrafts}
          persistenceOperation={persistenceOperation}
          retrySaveBeforeLock={retrySaveBeforeLock}
          setShowLockConfirmation={setShowLockConfirmation}
          t={t}
        />
          ) : null}

          {hydrationStatus === "loading" ? (
            <p
              aria-live="polite"
              className="mb-5 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600"
            >
              {t("dashboard.hydration.loading")}
            </p>
          ) : null}
          {hydrationStatus === "error" ? (
            <p
              aria-live="assertive"
              className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {persistenceError}
            </p>
          ) : null}
          {hydrationStatus === "ready" && resourcePolicyError ? (
            <p
              aria-live="assertive"
              className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {isReadOnly
                ? `${t("dashboard.resource.readOnlyPrefix")}${resourcePolicyError.message}`
                : `${t("dashboard.resource.rejectedPrefix")}${resourcePolicyError.message}`}
            </p>
          ) : null}
          {hydrationStatus === "ready" && persistenceError ? (
            <div
              aria-live="assertive"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <p>{persistenceError}</p>
              {canRetryPersistence ? (
                <button
                  className="rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={persistenceOperation !== "idle"}
                  onClick={() => void retryPersistence()}
                  type="button"
                >
                  {t("dashboard.action.retrySave")}
                </button>
              ) : null}
            </div>
          ) : null}
          {hydrationStatus === "ready" && !persistenceError ? (
            persistenceStatus === "saving" ? (
              <p
                aria-live="polite"
                className="mb-5 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
              >
                {t("dashboard.persistence.saving")}
              </p>
            ) : persistenceStatus === "saved" && showSavedFeedback ? (
              <p
                aria-live="polite"
                className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 motion-safe:animate-[ledger-feedback-fade_4s_ease-in_forwards]"
              >
                {t("dashboard.persistence.saved")}
              </p>
            ) : null
          ) : null}
          {repositorySwitchBlocked ? (
            <div
              aria-live="assertive"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              <p>
                {t("dashboard.repositorySwitchBlocked.description")}
              </p>
              <button
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium"
                onClick={discardDirtyChangesAndSwitchRepository}
                type="button"
              >
                {t("dashboard.repositorySwitchBlocked.action")}
              </button>
            </div>
          ) : null}
          {compatibilityWarnings.length > 0 ? (
            <div
              aria-live="assertive"
              className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              <p className="font-semibold">{t("dashboard.compatibility.heading")}</p>
              <ul className="mt-2 grid gap-1">
                {compatibilityWarnings.slice(0, 8).map((warning, index) => (
                  <li key={`${warning.code}-${warning.path}-${index}`}>
                    <code>{warning.path}</code> · {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {isFutureFactCorrectionMode ? (
            <div className="mb-5 grid gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-950">
              <p className="font-semibold">{t("dashboard.futureFacts.heading")}</p>
              <p>
                {t("dashboard.futureFacts.description")}
              </p>
              {futureCorrectionError ? (
                <p
                  aria-live="polite"
                  className="rounded-md border border-red-300 bg-white px-3 py-2 text-red-900"
                >
                  {futureCorrectionError}
                </p>
              ) : null}
              <ul className="grid gap-1">
                {futureTrades.map((trade) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-white p-3"
                    key={trade.id}
                  >
                    <span>
                      {t("dashboard.futureFacts.trade")}{t("dashboard.futureFacts.colonSeparator")}{trade.type === "buy" ? t("trades.type.buy") : t("trades.type.sell")} ·{" "}
                      {trade.assetSymbol} · {t("dashboard.futureFacts.quantity")} {" "}
                      <LedgerNumber kind="quantity" value={trade.quantity} /> · {t("dashboard.futureFacts.price")} {" "}
                      <LedgerNumber kind="money" value={trade.price} />{" "}
                      {trade.currency} · {trade.occurredAt} · ID{" "}
                      {shortLedgerId(trade.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`${t("dashboard.futureFacts.deleteTrade")} ${trade.assetSymbol} ${trade.occurredAt} ${trade.id}`}
                      disabled={!canCorrectFutureFacts}
                      label={t("dashboard.futureFacts.deleteTrade")}
                      onConfirm={() => handleDeleteFutureTrade(trade.id)}
                    />
                  </li>
                ))}
                {futurePriceSnapshots.map((snapshot) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-white p-3"
                    key={snapshot.id}
                  >
                    <span>
                      {t("dashboard.futureFacts.priceSnapshot")}{t("dashboard.futureFacts.colonSeparator")}{snapshot.assetSymbol} ·{" "}
                      <LedgerNumber kind="money" value={snapshot.price} />{" "}
                      {snapshot.currency} · {t("dashboard.futureFacts.source")} {" "}
                      {snapshot.source === "api" ? "Binance API" : t("dashboard.futureFacts.manual")} ·{" "}
                      {snapshot.recordedAt} · ID {shortLedgerId(snapshot.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`${t("dashboard.futureFacts.deletePrice")} ${snapshot.assetSymbol} ${snapshot.recordedAt} ${snapshot.id}`}
                      disabled={!canCorrectFutureFacts}
                      label={t("dashboard.futureFacts.deletePrice")}
                      onConfirm={() =>
                        handleDeleteFuturePrice(snapshot.id)
                      }
                    />
                  </li>
                ))}
                {futureAssetTransfers.map((assetTransfer) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-white p-3"
                    key={assetTransfer.id}
                  >
                    <span>
                      {t("dashboard.futureFacts.assetTransfer")}{t("dashboard.futureFacts.colonSeparator")}{assetTransfer.assetSymbol} · {t("dashboard.futureFacts.quantity")} {" "}
                      <LedgerNumber
                        kind="quantity"
                        value={assetTransfer.quantity}
                      />{" "}
                      · {assetTransfer.occurredAt} · ID{" "}
                      {shortLedgerId(assetTransfer.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`${t("dashboard.futureFacts.deleteAssetTransfer")} ${assetTransfer.assetSymbol} ${assetTransfer.occurredAt} ${assetTransfer.id}`}
                      disabled={!canCorrectFutureFacts}
                      label={t("dashboard.futureFacts.deleteAssetTransfer")}
                      onConfirm={() =>
                        handleDeleteFutureAssetTransfer(assetTransfer.id)
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="w-fit">
                <ConfirmDeleteButton
                  ariaLabel={t("dashboard.futureFacts.deleteAll")}
                  disabled={!canCorrectFutureFacts}
                  label={t("dashboard.futureFacts.deleteAll")}
                  onConfirm={handleDeleteAllFutureFacts}
                />
              </div>
            </div>
          ) : null}

          {session === undefined ? (
          <div className="grid gap-5">
            {session === undefined ? (
            <>
            <Section title={t("dashboard.section.chartAndMarketData")}>
              <MarketDataControls
                applyLedgerMutation={applyLedgerMutation}
                clock={clock}
                isWritable={session === undefined && isWritable}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mode={valuationPriceMode}
                mutationVersion={mutationVersion}
                onModeChange={setValuationPriceMode}
                persistedVersion={persistedVersion}
                persistenceStatus={persistenceStatus}
                sessionGeneration={ledgerEpoch}
                todayKey={todayKey}
              />
            </Section>

            <Section title={t("dashboard.section.charts")}>
              <ChartsOverview
                allocation={allocation}
                heatmap={heatmap}
                history={history}
                onRangeChange={setChartRange}
                onSelectedTradeDateChange={setSelectedTradeDate}
                range={chartRange}
                selectedTradeDate={selectedTradeDate}
              />
            </Section>

            <Section title={t("dashboard.section.pnlSummary")}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SummaryMetricCard
                  label={t("dashboard.pnl.buyOutflow")}
                  metric={pnlSummary.buyOutflow}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label={t("dashboard.pnl.sellProceeds")}
                  metric={pnlSummary.sellProceeds}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label={t("dashboard.pnl.remainingCostBasis")}
                  metric={pnlSummary.remainingCostBasis}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label={t("dashboard.pnl.realized")}
                  metric={pnlSummary.realizedPnl}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label={t("dashboard.pnl.unrealized")}
                  metric={pnlSummary.unrealizedPnl}
                  valuationLabel={pnlSummary.valuation.label}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                {t("dashboard.pnl.description")}
              </p>
              {pnlSummary.valuation.usesApproximation ? (
                <p className="mt-2 text-sm font-medium text-amber-800">
                  {USDT_USD_APPROXIMATION_DISCLOSURE}
                </p>
              ) : null}
            </Section>

            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Section title={t("dashboard.section.assets")}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 font-medium">{t("dashboard.assets.asset")}</th>
                        <th className="py-2 font-medium">{t("dashboard.assets.quantity")}</th>
                        <th className="py-2 font-medium">{t("dashboard.assets.averagePrice")}</th>
                        <th className="py-2 font-medium">{t("dashboard.pnl.remainingCostBasis")}</th>
                        <th className="py-2 font-medium">{t("dashboard.pnl.realized")}</th>
                        <th className="py-2 font-medium">{t("dashboard.assets.currentPrice")}</th>
                        <th className="py-2 font-medium">{t("dashboard.assets.marketValue")}</th>
                        <th className="py-2 font-medium">{t("dashboard.pnl.unrealized")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {positions.length === 0 ? (
                        <tr>
                          <td
                            className="py-8 text-center text-slate-500"
                            colSpan={8}
                          >
                            {t("dashboard.assets.empty")}
                          </td>
                        </tr>
                      ) : (
                        positions.map((position) => {
                          const feeAccountingReliable =
                            !position.feeAccountingIssues;
                          return (
                          <tr
                            key={`${position.assetSymbol}-${position.currency}`}
                          >
                            <td className="py-3 font-medium">
                              <span>{position.assetSymbol}</span>
                              {!feeAccountingReliable ? (
                                <span className="mt-1 block text-xs font-normal text-amber-800">
                                  {t("dashboard.assets.unconvertedFee")}
                                </span>
                              ) : null}
                            </td>
                            <td className="py-3 text-slate-600">
                              <LedgerNumber
                                kind="quantity"
                                value={position.quantity}
                              />
                            </td>
                            <td className="py-3 text-slate-600">
                              {feeAccountingReliable ? (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.averageCost}
                                  />{" "}
                                  {position.currency}
                                </>
                              ) : (
                                t("dashboard.assets.unreliable")
                              )}
                            </td>
                            <td className="py-3 text-slate-600">
                              {feeAccountingReliable ? (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.costBasis}
                                  />{" "}
                                  {position.currency}
                                </>
                              ) : (
                                t("dashboard.assets.unreliable")
                              )}
                            </td>
                            <td className="py-3 text-slate-600">
                              {feeAccountingReliable ? (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.realizedPnl}
                                  />{" "}
                                  {position.currency}
                                </>
                              ) : (
                                t("dashboard.assets.unreliable")
                              )}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.latestPrice === undefined ? (
                                t("dashboard.assets.noEnteredPrice")
                              ) : (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.latestPrice}
                                  />{" "}
                                  {position.currency}
                                </>
                              )}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.marketValue === undefined ? (
                                "--"
                              ) : (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.marketValue}
                                  />{" "}
                                  {position.currency}
                                </>
                              )}
                            </td>
                            <td className="py-3 text-slate-500">
                              {!feeAccountingReliable
                                ? t("dashboard.assets.unreliable")
                                : position.unrealizedPnl === undefined
                                  ? t("dashboard.assets.missingValidPrice")
                                  : (
                                      <>
                                        <LedgerNumber
                                          kind="money"
                                          value={position.unrealizedPnl}
                                        />{" "}
                                        {position.currency}
                                      </>
                                    )}
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title={t("dashboard.section.priceInput")}>
                <fieldset
                  className={
                    session === undefined && isWritable ? "" : "opacity-60"
                  }
                  disabled={session !== undefined || !isWritable}
                >
                  <PriceForm
                    clock={clock}
                    ledgerData={ledgerData}
                    ledgerEpoch={ledgerEpoch}
                    mutationVersion={mutationVersion}
                    onPriceSnapshotCreated={(priceSnapshot, timeSnapshot) =>
                      applyLedgerAction({
                        type: "priceSnapshot/add",
                        priceSnapshot,
                      }, timeSnapshot)
                    }
                    persistedVersion={persistedVersion}
                    persistenceStatus={persistenceStatus}
                  />
                </fieldset>
              </Section>
            </div>

            <Section title={t("dashboard.section.addTrade")}>
              <fieldset
                className={
                  session === undefined && isWritable ? "" : "opacity-60"
                }
                disabled={session !== undefined || !isWritable}
              >
                <TradeForm
                  clock={clock}
                  ledgerData={ledgerData}
                  ledgerEpoch={ledgerEpoch}
                  mutationVersion={mutationVersion}
                  onTradeCreated={(trade, timeSnapshot) =>
                    applyLedgerAction(
                      { type: "trade/add", trade },
                      timeSnapshot,
                    )
                  }
                  persistedVersion={persistedVersion}
                  persistenceStatus={persistenceStatus}
                />
              </fieldset>
            </Section>

            <Section title={t("dashboard.section.feeRules")}>
              <FeeRuleManager
                clock={clock}
                isWritable={session === undefined && isWritable}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mutationVersion={mutationVersion}
                onAction={applyLedgerAction}
                persistedVersion={persistedVersion}
                persistenceStatus={persistenceStatus}
              />
            </Section>

            <Section
              title={
                selectedTradeDate
                  ? `${t("dashboard.section.tradeList")} · ${selectedTradeDate}`
                  : t("dashboard.section.tradeList")
              }
            >
              {tradeRemovalError ? (
                <p
                  aria-live="polite"
                  className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {tradeRemovalError}
                </p>
              ) : null}
              <TradeTable
                deleteDisabled={session !== undefined || !isWritable}
                onDelete={
                  hydrationStatus === "ready" ? handleDeleteTrade : undefined
                }
                trades={displayedTrades}
                todayKey={todayKey}
              />
            </Section>

            </>
            ) : null}

            <Section title={t("dashboard.section.dataManagement")}>
              <div className="grid gap-4 text-sm text-slate-700">
                <p>
                  {storageKind === "ledger-file"
                    ? t("dashboard.dataManagement.fileDescription")
                    : t("dashboard.dataManagement.legacyDescription")}
                </p>

                <BackupControls
                  applyLedgerMutation={applyLedgerMutation}
                  canImportBackup={capabilities.canImportBackup}
                  clock={clock}
                  hydrationStatus={hydrationStatus}
                  isDirty={isDirty}
                  isReadOnly={isReadOnly}
                  isWritable={isWritable}
                  ledgerData={ledgerData}
                  ledgerEpoch={ledgerEpoch}
                  mutationVersion={mutationVersion}
                  onImport={replaceLedgerFromBackup}
                  persistenceOperation={persistenceOperation}
                  persistenceStatus={persistenceStatus}
                  persistedVersion={persistedVersion}
                  sessionGeneration={ledgerEpoch}
                />

                {(capabilities.canClearReadyLedger ||
                  capabilities.canClearHydrationError) &&
                hydrationStatus === "loading" ? (
                  <p aria-live="polite">{t("dashboard.dataManagement.clearUnavailable")}</p>
                ) : null}

                {capabilities.canClearReadyLedger &&
                hydrationStatus === "ready" ? (
                  <button
                    className="w-fit rounded-md border border-red-300 px-4 py-2 font-medium text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      persistenceOperation !== "idle" ||
                      repositorySwitchBlocked ||
                      isReadOnly
                    }
                    onClick={() => openClearConfirmation("normal")}
                    type="button"
                  >
                    {storageKind === "ledger-file"
                      ? t("dashboard.dataManagement.clearFile")
                      : t("dashboard.dataManagement.clearLegacy")}
                  </button>
                ) : null}

                {capabilities.canClearHydrationError &&
                hydrationStatus === "error" ? (
                  <button
                    className="w-fit rounded-md border border-red-300 px-4 py-2 font-medium text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={persistenceOperation !== "idle"}
                    onClick={() => openClearConfirmation("recovery")}
                    type="button"
                  >
                    {t("dashboard.dataManagement.clearDamaged")}
                  </button>
                ) : null}

                {clearConfirmationMode ? (
                  <div className="grid gap-3 rounded-md border border-red-200 bg-red-50 p-4">
                    <p className="font-medium text-red-900">
                      {clearConfirmationMode === "normal"
                        ? storageKind === "ledger-file"
                          ? t("dashboard.dataManagement.clearFileWarning")
                          : t("dashboard.dataManagement.clearLegacyWarning")
                        : t("dashboard.dataManagement.clearRecoveryWarning")}
                    </p>
                    <label className="grid gap-2 font-medium text-red-900">
                      {t("dashboard.dataManagement.confirmPrefix")}“{clearConfirmationText}”{t("dashboard.dataManagement.confirmSuffix")}
                      <input
                        aria-label={t("dashboard.dataManagement.confirmAriaLabel")}
                        className="rounded-md border border-red-300 bg-white px-3 py-2 font-normal text-slate-950 outline-none focus:border-red-500"
                        disabled={persistenceOperation !== "idle"}
                        onChange={(event) => {
                          setClearConfirmationValue(event.target.value);
                          setClearConfirmationError("");
                        }}
                        value={clearConfirmationValue}
                      />
                    </label>
                    {clearConfirmationError ? (
                      <p aria-live="polite" className="text-red-800">
                        {clearConfirmationError}
                      </p>
                    ) : null}
                    {persistenceOperation === "clearing" ? (
                      <p aria-live="polite" className="font-medium text-red-900">
                        {t("dashboard.dataManagement.clearing")}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <button
                        className="rounded-md bg-red-800 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={persistenceOperation !== "idle"}
                        onClick={() => void handleClearLedger()}
                        type="button"
                      >
                        {storageKind === "ledger-file"
                          ? t("dashboard.dataManagement.confirmClearFile")
                          : t("dashboard.dataManagement.confirmClearLegacy")}
                      </button>
                      <button
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={persistenceOperation !== "idle"}
                        onClick={cancelClearConfirmation}
                        type="button"
                      >
                        {t("dashboard.action.cancel")}
                      </button>
                    </div>
                  </div>
                ) : null}

                {clearSuccessMessage ? (
                  <p
                    aria-live="polite"
                    className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800"
                  >
                    {clearSuccessMessage}
                  </p>
                ) : null}
              </div>
            </Section>
          </div>
          ) : null}
      {session && workspace.currentPage === "home" ? (
        <HomeWorkspace
          active
          allocation={allocation}
          cashBalance={projection.cash.balance}
          detailsOpen={workspace.homeDetailsOpen}
          heatmap={heatmap}
          history={history}
          ledgerData={ledgerData}
          onNavigateToPrice={() =>
            workspace.navigate({ page: "record", focus: "price" })
          }
          onNavigateToTrade={() =>
            workspace.navigate({ page: "record", focus: "trade" })
          }
          onNavigateToTransactions={(intent) => {
            if ("clearFilters" in intent) {
              workspace.navigate({
                page: "transactions",
                clearFilters: true,
              });
            } else {
              workspace.navigate({
                page: "transactions",
                locateDate: intent.locateDate,
              });
            }
          }}
          onDetailsOpenChange={workspace.setHomeDetailsOpen}
          onRangeChange={setChartRange}
          onValuationPriceModeChange={setValuationPriceMode}
          pnlSummary={pnlSummary}
          positions={positions}
          range={chartRange}
          valuationPriceMode={valuationPriceMode}
        />
      ) : null}
      {session && workspace.currentPage === "record" ? (
        <RecordWorkspace
          active
          cashBalance={projection.cash.balance}
          clock={clock}
          focusIntent={
            workspace.intent?.page === "record" ? workspace.intent.focus : null
          }
          initialPriceDraft={workspace.priceDraftRef.current}
          initialTradeDraft={workspace.tradeDraftRef.current}
          isWritable={isWritable}
          ledgerData={ledgerData}
          ledgerEpoch={ledgerEpoch}
          marketDataPanel={
            <MarketDataControls
              applyLedgerMutation={applyLedgerMutation}
              clock={clock}
              isWritable={isWritable}
              ledgerData={ledgerData}
              ledgerEpoch={ledgerEpoch}
              mode={valuationPriceMode}
              mutationVersion={mutationVersion}
              onModeChange={setValuationPriceMode}
              persistedVersion={persistedVersion}
              persistenceStatus={persistenceStatus}
              positions={positions}
              sessionGeneration={session.generation}
              showMappings={false}
              todayKey={todayKey}
            />
          }
          mutationVersion={mutationVersion}
          onAssetTransferCreated={(assetTransfer, timeSnapshot) =>
            applyLedgerAction(
              { type: "assetTransfer/add", assetTransfer },
              timeSnapshot,
            )
          }
          onAssetTransferDeleted={(assetTransferId, timeSnapshot) =>
            applyLedgerAction(
              { type: "assetTransfer/delete", assetTransferId },
              timeSnapshot,
            )
          }
          onCashEventCreated={(cashEvent, timeSnapshot) =>
            applyLedgerAction(
              { type: "cashEvent/add", cashEvent },
              timeSnapshot,
            )
          }
          onCashEventDeleted={(cashEventId, timeSnapshot) =>
            applyLedgerAction(
              { type: "cashEvent/delete", cashEventId },
              timeSnapshot,
            )
          }
          onDraftStatusChange={(hasDrafts) => {
            workspaceDraftsPresentRef.current = hasDrafts;
            if (showLockConfirmation) {
              setLockConfirmationHasDrafts(hasDrafts);
            }
          }}
          onIntentConsumed={workspace.consumeIntent}
          onPriceDraftChange={(draft) => {
            workspace.priceDraftRef.current = draft;
          }}
          onPriceSnapshotCreated={(priceSnapshot, timeSnapshot) =>
            applyLedgerAction(
              { type: "priceSnapshot/add", priceSnapshot },
              timeSnapshot,
            )
          }
          onRecordTargetChange={workspace.setRecordTarget}
          onTradeCreated={(trade, timeSnapshot) =>
            applyLedgerAction({ type: "trade/add", trade }, timeSnapshot)
          }
          onTradeDraftChange={(draft) => {
            workspace.tradeDraftRef.current = draft;
          }}
          persistedVersion={persistedVersion}
          persistenceStatus={persistenceStatus}
          recordTarget={workspace.recordTarget}
        />
      ) : null}
      {session && workspace.currentPage === "transactions" ? (
        <TransactionsWorkspace
          active
          intent={
            workspace.intent?.page === "transactions"
              ? workspace.intent
              : null
          }
          isWritable={isWritable}
          ledgerData={ledgerData}
          ledgerEpoch={ledgerEpoch}
          mutationVersion={mutationVersion}
          onDeleteTrade={(tradeId) =>
            applyLedgerAction({ type: "trade/delete", tradeId })
          }
          onDeleteCashEvent={(cashEventId) =>
            applyLedgerAction({ type: "cashEvent/delete", cashEventId })
          }
          onIntentConsumed={workspace.consumeIntent}
          persistedVersion={persistedVersion}
          persistenceStatus={persistenceStatus}
          todayKey={todayKey}
        />
      ) : null}
      {session && workspace.currentPage === "transfer" ? (
        <TransferWorkspace
          active
          backupPanel={
            <BackupControls
              applyLedgerMutation={applyLedgerMutation}
              canImportBackup={capabilities.canImportBackup}
              clock={clock}
              hydrationStatus={hydrationStatus}
              isDirty={isDirty}
              isReadOnly={isReadOnly}
              isWritable={isWritable}
              ledgerData={ledgerData}
              ledgerEpoch={ledgerEpoch}
              mutationVersion={mutationVersion}
              onImport={replaceLedgerFromBackup}
              persistenceOperation={persistenceOperation}
              persistenceStatus={persistenceStatus}
              persistedVersion={persistedVersion}
              presentation="transfer"
              sessionGeneration={session.generation}
              showPlaintextWarning={false}
            />
          }
          storageKind={storageKind}
        />
      ) : null}
      {session && workspace.currentPage === "settings" ? (
        <SettingsWorkspace
          active
          canClearHydrationError={capabilities.canClearHydrationError}
          canClearReadyLedger={capabilities.canClearReadyLedger}
          feePanel={
            <FeeRuleManager
              clock={clock}
              isWritable={isWritable}
              ledgerData={ledgerData}
              ledgerEpoch={ledgerEpoch}
              mutationVersion={mutationVersion}
              onAction={applyLedgerAction}
              persistedVersion={persistedVersion}
              persistenceStatus={persistenceStatus}
              presentation="settings"
            />
          }
          hydrationStatus={hydrationStatus}
          isReadOnly={isReadOnly}
          ledgerEpoch={ledgerEpoch}
          marketPanel={
            <div className="grid gap-6">
              <LocalAssetManager
                clock={clock}
                isWritable={isWritable}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mutationVersion={mutationVersion}
                onAssetCreated={(asset, timeSnapshot) =>
                  applyLedgerAction({ type: "asset/add", asset }, timeSnapshot)
                }
                onAssetDeleted={(assetSymbol, timeSnapshot) =>
                  applyLedgerAction(
                    { type: "asset/remove", assetSymbol },
                    timeSnapshot,
                  )
                }
                persistedVersion={persistedVersion}
                persistenceStatus={persistenceStatus}
              />
              <div className="border-t border-[var(--ledger-border)] pt-5">
                <MarketDataControls
                  applyLedgerMutation={applyLedgerMutation}
                  clock={clock}
                  compactMappings
                  expandMappings
                  isWritable={isWritable}
                  ledgerData={ledgerData}
                  ledgerEpoch={ledgerEpoch}
                  mode={valuationPriceMode}
                  mutationVersion={mutationVersion}
                  onModeChange={setValuationPriceMode}
                  persistedVersion={persistedVersion}
                  persistenceStatus={persistenceStatus}
                  positions={positions}
                  sessionGeneration={session.generation}
                  showRefresh={false}
                  todayKey={todayKey}
                />
              </div>
            </div>
          }
          onClear={handleSettingsClear}
          persistenceOperation={persistenceOperation}
          repositorySwitchBlocked={repositorySwitchBlocked}
          storageKind={storageKind}
        />
      ) : null}
    </LedgerWorkspaceFrame>
  );
}

function useWriteCycleDashboardDerivations(
  ledgerData: PersistentLedgerState["ledgerData"],
  options: DashboardDerivationOptions,
  ledgerEpoch: number,
): DashboardDerivations {
  const cacheRef = useRef<DashboardDerivationCache | null>(null);
  const resolution = resolveDashboardDerivations(
    cacheRef.current,
    ledgerData,
    options,
    ledgerEpoch,
  );
  cacheRef.current = resolution.cache;
  return resolution.values;
}
