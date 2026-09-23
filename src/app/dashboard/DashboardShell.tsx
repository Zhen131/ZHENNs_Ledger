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
} from "@/app/persistence";
import { LedgerWorkspaceFrame } from "./LedgerWorkspaceFrame";
import { HomeWorkspace } from "@/app/workspaces";
import { RecordWorkspace } from "@/app/workspaces";
import { TransactionsWorkspace } from "@/app/workspaces";
import { TransferWorkspace } from "@/app/workspaces";
import { SettingsWorkspace } from "@/app/workspaces";
import { useLedgerWorkspaceSession } from "@/app/workspaces";
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
import { getWorkspaceFileStatus } from "./DashboardShellHelpers";
import { Section } from "./Section";
import { SummaryMetricCard } from "./SummaryMetricCard";
import { SessionFatalPanel } from "./SessionFatalPanel";
import { SessionQuiescingPanel } from "./SessionQuiescingPanel";
import { LockConfirmationPanel } from "./LockConfirmationPanel";
import { FutureCorrectionPanel } from "./FutureCorrectionPanel";
import {
  doHandleClearLedger,
  doHandleDeleteAllFutureFacts,
  doHandleDeleteFutureAssetTransfer,
  doHandleDeleteFuturePrice,
  doHandleSettingsClear,
  doOpenClearConfirmation,
  doRemoveValidatedTrade,
  doRequestImmediateLock,
  runSavedFeedbackEffect,
} from "./dashboardShellActions";
import { CompatibilityWarningList } from "./CompatibilityWarningList";
import { RepositorySwitchBlockedNotice } from "./RepositorySwitchBlockedNotice";
import { PersistenceErrorNotice } from "./PersistenceErrorNotice";

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
  // What the reader is shown and must type: the phrase for the language on
  // screen (04A D-16a). It is deliberately NOT what gets handed to the
  // repository.
  const clearConfirmationPhrase =
    storageKind === "ledger-file"
      ? t("dashboard.dataManagement.confirmPhrase")
      : t("dashboard.clearConfirmation.legacy");
  // What the repository is handed once the typed phrase matches: the one
  // canonical value it has always accepted. Widening what the repository
  // accepts is out of bounds (04A D-16b).
  const clearConfirmationNonce =
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
    clock,
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
    return runSavedFeedbackEffect(
      {
        persistenceStatus,
        setShowSavedFeedback,
      },
    );
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
    return doRemoveValidatedTrade(
      {
        applyLedgerAction,
        ledgerData,
        t,
      },
      tradeId,
      setError,
    );
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
    return doHandleDeleteFuturePrice(
      {
        applyLedgerAction,
        canCorrectFutureFacts,
        setFutureCorrectionError,
        t,
      },
      priceSnapshotId,
    );
  }

  function handleDeleteFutureAssetTransfer(
    assetTransferId: string,
  ): ConfirmDeleteOutcome {
    return doHandleDeleteFutureAssetTransfer(
      {
        applyLedgerAction,
        canCorrectFutureFacts,
        ledgerData,
        setFutureCorrectionError,
        t,
      },
      assetTransferId,
    );
  }

  function handleDeleteAllFutureFacts(): ConfirmDeleteOutcome {
    return doHandleDeleteAllFutureFacts(
      {
        applyLedgerAction,
        canCorrectFutureFacts,
        setFutureCorrectionError,
        t,
        todayKey,
      },
    );
  }

  function openClearConfirmation(mode: ClearConfirmationMode) {
    return doOpenClearConfirmation(
      {
        hydrationStatus,
        isReadOnly,
        persistenceOperation,
        repositorySwitchBlocked,
        setClearConfirmationError,
        setClearConfirmationMode,
        setClearConfirmationValue,
        setClearSuccessMessage,
      },
      mode,
    );
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
    return doHandleClearLedger(
      {
        clearConfirmationNonce,
        clearConfirmationPhrase,
        clearConfirmationValue,
        clearLedger,
        currentRepositoryRef,
        mountedRef,
        repository,
        setClearConfirmationError,
        setClearConfirmationMode,
        setClearConfirmationValue,
        setClearSuccessMessage,
        setSelectedTradeDate,
        setTradeRemovalError,
        storageKind,
        t,
      },
    );
  }

  async function handleSettingsClear(
    mode: "normal" | "recovery",
  ): Promise<boolean> {
    return doHandleSettingsClear(
      {
        clearConfirmationNonce,
        clearLedger,
        currentRepositoryRef,
        hydrationStatus,
        mountedRef,
        repository,
        setSelectedTradeDate,
        setTradeRemovalError,
      },
      mode,
    );
  }

  function requestImmediateLock() {
    return doRequestImmediateLock(
      {
        drainForSessionQuiesce,
        isDirty,
        lifecycleStatus,
        onFinalLock,
        persistenceStatus,
        session,
        setLockConfirmationHasDrafts,
        setShowLockConfirmation,
        workspace,
        workspaceDraftsPresentRef,
      },
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
            <PersistenceErrorNotice
              canRetryPersistence={canRetryPersistence}
              persistenceError={persistenceError}
              persistenceOperation={persistenceOperation}
              retryPersistence={retryPersistence}
              t={t}
            />
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
            <RepositorySwitchBlockedNotice
              discardDirtyChangesAndSwitchRepository={discardDirtyChangesAndSwitchRepository}
              t={t}
            />
          ) : null}
          {compatibilityWarnings.length > 0 ? (
            <CompatibilityWarningList
              compatibilityWarnings={compatibilityWarnings}
              t={t}
            />
          ) : null}
          {isFutureFactCorrectionMode ? (
            <FutureCorrectionPanel
              canCorrectFutureFacts={canCorrectFutureFacts}
              futureAssetTransfers={futureAssetTransfers}
              futureCorrectionError={futureCorrectionError}
              futurePriceSnapshots={futurePriceSnapshots}
              futureTrades={futureTrades}
              handleDeleteAllFutureFacts={handleDeleteAllFutureFacts}
              handleDeleteFutureAssetTransfer={handleDeleteFutureAssetTransfer}
              handleDeleteFuturePrice={handleDeleteFuturePrice}
              handleDeleteFutureTrade={handleDeleteFutureTrade}
              t={t}
            />
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
                      {t("dashboard.dataManagement.confirmPrefix")}“{clearConfirmationPhrase}”{t("dashboard.dataManagement.confirmSuffix")}
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
