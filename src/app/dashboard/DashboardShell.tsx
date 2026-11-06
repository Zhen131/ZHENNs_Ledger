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
import { RecordWorkspace } from "@/app/workspaces";
import { TransactionsWorkspace } from "@/app/workspaces";
import { TransferWorkspace } from "@/app/workspaces";
import { useLedgerWorkspaceSession } from "@/app/workspaces";
import {
  READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
  type LedgerSession,
  type SessionQuiesceReason,
} from "@/platform/persistence";
import {
  isLedgerFactInFuture,
  systemLedgerClock,
  type LedgerClock,
} from "@/core/shared";
import { BackupControls } from "@/features/backup/ui";
import { MarketDataControls } from "@/features/market-data/ui";
import {
  useLanguage,
  type ConfirmDeleteOutcome,
} from "@/ui";
import {
  resolveDashboardDerivations,
  type DashboardDerivationCache,
  type DashboardDerivationOptions,
  type DashboardDerivations,
} from "./dashboardDerivations";
import { getWorkspaceFileStatus } from "./DashboardShellHelpers";
import { SessionFatalPanel } from "./SessionFatalPanel";
import { SessionQuiescingPanel } from "./SessionQuiescingPanel";
import { LockConfirmationPanel } from "./LockConfirmationPanel";
import { FutureCorrectionPanel } from "./FutureCorrectionPanel";
import {
  doHandleDeleteAllFutureFacts,
  doHandleDeleteFutureAssetTransfer,
  doHandleDeleteFuturePrice,
  doHandleSettingsClear,
  doRemoveValidatedTrade,
  doRequestImmediateLock,
  runSavedFeedbackEffect,
  runSessionFatalDeliveryEffect,
} from "./dashboardShellActions";
import { CompatibilityWarningList } from "./CompatibilityWarningList";
import { RepositorySwitchBlockedNotice } from "./RepositorySwitchBlockedNotice";
import { PersistenceErrorNotice } from "./PersistenceErrorNotice";
import { DashboardShellHomePage } from "./DashboardShellHomePage";
import { DashboardShellSettingsPage } from "./DashboardShellSettingsPage";

export function DashboardShell({
  clock = systemLedgerClock,
  session,
  onFinalLock,
  onSessionFatal,
  onSessionDrainReady,
}: Readonly<{
  clock?: LedgerClock;
  session: LedgerSession;
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
  const repository = session.repository;
  const capabilities = session.capabilities;
  // What the repository is handed once the typed phrase matches: the one
  // canonical value it has always accepted. Widening what the repository
  // accepts is out of bounds (04A D-16b).
  const clearConfirmationNonce = READY_LEDGER_CLEAR_CONFIRMATION_TEXT;
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
  const [futureCorrectionError, setFutureCorrectionError] = useState("");
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
    onSessionDrainReady?.(session, drainForSessionQuiesce);
  }, [drainForSessionQuiesce, onSessionDrainReady, session]);

  useEffect(() => {
    return runSessionFatalDeliveryEffect(
      {
        deliveredFatalSignalRef,
        drainForSessionQuiesce,
        onSessionFatal,
        session,
        sessionFatalSignal,
      },
    );
  }, [
    drainForSessionQuiesce,
    onSessionFatal,
    session,
    sessionFatalSignal,
  ]);

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
    if (!onFinalLock || lifecycleStatus !== "active") {
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

  if (sessionFatalSignal?.sessionId === session.sessionId) {
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
        onFinalLock
          ? requestImmediateLock
          : undefined
      }
      onNavigate={(page) => {
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

      {workspace.currentPage === "home" ? (
        <DashboardShellHomePage
          allocation={allocation}
          chartRange={chartRange}
          heatmap={heatmap}
          history={history}
          ledgerData={ledgerData}
          pnlSummary={pnlSummary}
          positions={positions}
          projection={projection}
          setChartRange={setChartRange}
          setValuationPriceMode={setValuationPriceMode}
          valuationPriceMode={valuationPriceMode}
          workspace={workspace}
        />
      ) : null}
      {workspace.currentPage === "record" ? (
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
      {workspace.currentPage === "transactions" ? (
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
      {workspace.currentPage === "transfer" ? (
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
              sessionGeneration={session.generation}
              showPlaintextWarning={false}
            />
          }
        />
      ) : null}
      {workspace.currentPage === "settings" ? (
        <DashboardShellSettingsPage
          applyLedgerAction={applyLedgerAction}
          applyLedgerMutation={applyLedgerMutation}
          capabilities={capabilities}
          clock={clock}
          handleSettingsClear={handleSettingsClear}
          hydrationStatus={hydrationStatus}
          isReadOnly={isReadOnly}
          isWritable={isWritable}
          ledgerData={ledgerData}
          ledgerEpoch={ledgerEpoch}
          mutationVersion={mutationVersion}
          persistedVersion={persistedVersion}
          persistenceOperation={persistenceOperation}
          persistenceStatus={persistenceStatus}
          positions={positions}
          repositorySwitchBlocked={repositorySwitchBlocked}
          session={session}
          setValuationPriceMode={setValuationPriceMode}
          todayKey={todayKey}
          valuationPriceMode={valuationPriceMode}
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
