"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  usePersistentLedger,
  type PersistentLedgerState,
} from "../../hooks/usePersistentLedger";
import type { Trade, ValuationPriceMode } from "../../models";
import {
  INDEXED_DB_LEDGER_CAPABILITIES,
  READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
  type LedgerSession,
  type LedgerRepository,
  type LedgerSessionCapabilities,
  type SessionQuiesceReason,
  type LedgerStorageKind,
} from "../../repositories/ledgerRepository";
import {
  buildHoldingAllocation,
  buildHoldingHistory,
  buildTradeHeatmap,
  type ChartRange,
} from "../../services/chartDataService";
import { getPositionsFromLedger } from "../../services/positionService";
import { validateTradeRemoval } from "../../services/tradeRemovalService";
import {
  getLedgerDateKey,
  isLedgerFactInFuture,
  systemLedgerClock,
  type LedgerClock,
} from "../../utils/ledgerDate";
import { PriceForm } from "../prices/PriceForm";
import { TradeForm } from "../trades/TradeForm";
import { BackupControls } from "../backup/BackupControls";
import { ChartsOverview } from "../charts/ChartsOverview";
import { MarketDataControls } from "../market-data/MarketDataControls";
import {
  ConfirmDeleteButton,
  type ConfirmDeleteOutcome,
} from "../common/ConfirmDeleteButton";

const LEGACY_CLEAR_LEDGER_CONFIRMATION_TEXT = "CLEAR LOCAL LEDGER";

type ClearConfirmationMode = "normal" | "recovery";

function shortLedgerId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function Section({
  title,
  children,
}: Readonly<{
  title: string;
  children: ReactNode;
}>) {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

export function TradeTable({
  trades,
  onDelete,
  deleteDisabled = false,
  todayKey,
}: Readonly<{
  trades: readonly Trade[];
  onDelete?: (
    tradeId: string,
  ) => ConfirmDeleteOutcome | Promise<ConfirmDeleteOutcome>;
  deleteDisabled?: boolean;
  todayKey?: string;
}>) {
  const columnCount = onDelete ? 7 : 6;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="py-2 font-medium">Date</th>
            <th className="py-2 font-medium">Type</th>
            <th className="py-2 font-medium">Asset</th>
            <th className="py-2 font-medium">Quantity</th>
            <th className="py-2 font-medium">Average price</th>
            <th className="py-2 font-medium">Total amount</th>
            {onDelete ? <th className="py-2 font-medium">Action</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {trades.length === 0 ? (
            <tr>
              <td
                className="py-8 text-center text-slate-500"
                colSpan={columnCount}
              >
                No trades yet. Added trades will appear here automatically.
              </td>
            </tr>
          ) : (
            trades.map((trade) => (
              <tr key={trade.id}>
                <td className="py-3 text-slate-600">
                  {trade.occurredAt}
                  {todayKey &&
                  isLedgerFactInFuture(trade.occurredAt, todayKey) ? (
                    <span className="ml-2 font-medium text-red-700">
                      Invalid future fact
                    </span>
                  ) : null}
                </td>
                <td className="py-3 text-slate-600">
                  {trade.type === "buy" ? "Buy" : "Sell"}
                </td>
                <td className="py-3 font-medium">{trade.assetSymbol}</td>
                <td className="py-3 text-slate-600">{trade.quantity}</td>
                <td className="py-3 text-slate-600">{trade.price}</td>
                <td className="py-3 text-slate-600">
                  {trade.totalValue} {trade.currency}
                </td>
                {onDelete ? (
                  <td className="py-3">
                    <ConfirmDeleteButton
                      ariaLabel={`Delete ${
                        trade.type === "buy" ? "buy" : "sell"
                      } ${trade.assetSymbol} ${trade.occurredAt}`}
                      disabled={deleteDisabled}
                      label="Delete"
                      onConfirm={() => onDelete(trade.id)}
                    />
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardShell({
  repository: providedRepository,
  clock = systemLedgerClock,
  capabilities: providedCapabilities = INDEXED_DB_LEDGER_CAPABILITIES,
  storageKind: providedStorageKind = "indexeddb",
  session,
  onFinalLock,
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
  onSessionDrainReady?: (
    session: LedgerSession,
    drain: PersistentLedgerState["drainForSessionQuiesce"],
  ) => void;
}>) {
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
      : LEGACY_CLEAR_LEDGER_CONFIRMATION_TEXT;
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
    isDirty,
    repositorySwitchBlocked,
    discardDirtyChangesAndSwitchRepository,
    compatibilityWarnings,
    isFutureFactCorrectionMode,
    ledgerEpoch,
    todayKey,
    lifecycleStatus,
    drainForSessionQuiesce,
  } = usePersistentLedger(
    repository,
    clock,
    capabilities,
    session,
  );
  const [valuationPriceMode, setValuationPriceMode] =
    useState<ValuationPriceMode>("auto");
  const [chartRange, setChartRange] = useState<ChartRange>("30d");
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
  const mountedRef = useRef(true);
  const currentRepositoryRef = useRef(repository);
  currentRepositoryRef.current = repository;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (session) {
      onSessionDrainReady?.(session, drainForSessionQuiesce);
    }
  }, [drainForSessionQuiesce, onSessionDrainReady, session]);

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
  const positions = getPositionsFromLedger(ledgerData, {
    todayKey,
    mode: valuationPriceMode,
  });
  const allocation = buildHoldingAllocation(ledgerData, {
    todayKey,
    mode: valuationPriceMode,
  });
  const history = buildHoldingHistory(ledgerData, {
    todayKey,
    mode: valuationPriceMode,
    range: chartRange,
  });
  const heatmap = buildTradeHeatmap(ledgerData, todayKey);
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

  function removeValidatedTrade(
    tradeId: string,
    setError: (message: string) => void,
  ): ConfirmDeleteOutcome {
    const result = validateTradeRemoval(tradeId, ledgerData);

    if (!result.ok) {
      setError(
        result.error.code === "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE"
          ? "Cannot delete: this trade supports a later sell. Delete dependent later sells first."
          : "Cannot delete: trade not found.",
      );
      return "rejected";
    }

    const outcome = applyLedgerAction({
      type: "trade/delete",
      tradeId: result.tradeId,
    });
    setError(
      outcome === "rejected" ? "The ledger is currently read-only; deletion was not performed." : "",
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
      outcome === "rejected" ? "The ledger is currently read-only; deletion was not performed." : "",
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
      outcome === "rejected" ? "The ledger is currently read-only; deletion was not performed." : "",
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
        `Enter the full confirmation text "${clearConfirmationText}".`,
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
        ? "The current C ledger content was cleared."
        : "The ledger was cleared.",
    );
  }

  function requestImmediateLock() {
    if (!session || !onFinalLock || lifecycleStatus !== "active") {
      return;
    }
    if (isDirty) {
      setShowLockConfirmation(true);
      return;
    }
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
    void onFinalLock(
      drainForSessionQuiesce,
      "immediate-lock",
    );
  }

  async function retrySaveBeforeLock() {
    const saved = await retryPersistence();
    if (saved && mountedRef.current) {
      setShowLockConfirmation(false);
    }
  }

  if (lifecycleStatus === "quiescing") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-950">
        <p aria-live="polite" className="text-sm text-slate-700">
          Locking safely: new operations are stopped while accepted saves finish…
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto min-h-screen w-full max-w-7xl px-5 py-6 sm:px-8 lg:px-10">
        <header className="mb-6 border-b border-slate-200 pb-6">
          <p className="text-sm font-medium text-slate-500">
            Local-First Trading Ledger
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            Local-First Trading Ledger
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Record trades and observed prices locally. Positions, profit and loss, and charts derive from the same ledger in real time.
          </p>
          {session?.storageKind === "ledger-file" && onFinalLock ? (
            <button
              className="mt-4 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
              onClick={requestImmediateLock}
              type="button"
            >
              Lock now
            </button>
          ) : null}
        </header>

          {showLockConfirmation ? (
            <section
              aria-label="Confirm locking with unsaved changes"
              className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900"
            >
              <p className="font-medium">Some changes are unsaved</p>
              <p className="mt-1 leading-6">
                Retry saving, or continue locking only if you want to discard these unsaved changes. Operations already writing to storage will finish safely and will not be interrupted.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  className="rounded-md border border-red-300 bg-white px-3 py-2 font-medium disabled:opacity-50"
                  disabled={
                    !canRetryPersistence ||
                    persistenceOperation !== "idle"
                  }
                  onClick={() => void retrySaveBeforeLock()}
                  type="button"
                >
                  Retry this save
                </button>
                <button
                  className="rounded-md bg-red-700 px-3 py-2 font-medium text-white"
                  onClick={confirmDiscardAndLock}
                  type="button"
                >
                  Discard changes and continue locking
                </button>
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
                  onClick={() => setShowLockConfirmation(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          {hydrationStatus === "loading" ? (
            <p
              aria-live="polite"
              className="mb-5 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600"
            >
              Loading the local ledger. No data will be written until loading completes.
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
                ? `The current ledger exceeds resource limits and was loaded read-only: ${resourcePolicyError.message}`
                : `The operation was rejected by a resource boundary: ${resourcePolicyError.message}`}
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
                  Retry save
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
                Saving locally
              </p>
            ) : persistenceStatus === "saved" ? (
              <p
                aria-live="polite"
                className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                Saved locally
              </p>
            ) : null
          ) : null}
          {repositorySwitchBlocked ? (
            <div
              aria-live="assertive"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              <p>
                The current ledger is unsaved, so switching local storage was blocked. Retry saving or explicitly discard unsaved changes.
              </p>
              <button
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium"
                onClick={discardDirtyChangesAndSwitchRepository}
                type="button"
              >
                Discard unsaved changes and switch
              </button>
            </div>
          ) : null}
          {compatibilityWarnings.length > 0 ? (
            <div
              aria-live="assertive"
              className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              <p className="font-semibold">Legacy ledger compatibility warning</p>
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
              <p className="font-semibold">Future-fact correction mode</p>
              <p>
                Future trades and prices are excluded from positions, market selection, and charts. Normal additions, historical deletions, and Binance refresh are paused. You can still delete future facts individually, export a rescue backup, import a valid whole ledger, clear the ledger, or delete all invalid future facts.
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
                      Future trade: {trade.type === "buy" ? "Buy" : "Sell"} ·{" "}
                      {trade.assetSymbol} · Quantity {trade.quantity} · Price{" "}
                      {trade.price} {trade.currency} · {trade.occurredAt} · ID{" "}
                      {shortLedgerId(trade.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`Delete future trade ${trade.assetSymbol} ${trade.occurredAt} ${trade.id}`}
                      disabled={!canCorrectFutureFacts}
                      label="Delete future trade"
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
                      Future price: {snapshot.assetSymbol} · {snapshot.price}{" "}
                      {snapshot.currency} · Source{" "}
                      {snapshot.source === "api" ? "Binance API" : "Manual"} ·{" "}
                      {snapshot.recordedAt} · ID {shortLedgerId(snapshot.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`Delete future price ${snapshot.assetSymbol} ${snapshot.recordedAt} ${snapshot.id}`}
                      disabled={!canCorrectFutureFacts}
                      label="Delete future price"
                      onConfirm={() =>
                        handleDeleteFuturePrice(snapshot.id)
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="w-fit">
                <ConfirmDeleteButton
                  ariaLabel="Delete all invalid future facts"
                  disabled={!canCorrectFutureFacts}
                  label="Delete all invalid future facts"
                  onConfirm={handleDeleteAllFutureFacts}
                />
              </div>
            </div>
          ) : null}

          <div className="grid gap-5">
            <Section title="Charts and Binance Market Data">
              <MarketDataControls
                applyLedgerMutation={applyLedgerMutation}
                clock={clock}
                isWritable={isWritable}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mode={valuationPriceMode}
                onModeChange={setValuationPriceMode}
                todayKey={todayKey}
              />
            </Section>

            <Section title="Ledger Charts">
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

            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Section title="Asset Summary">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 font-medium">Asset</th>
                        <th className="py-2 font-medium">Position quantity</th>
                        <th className="py-2 font-medium">Average cost</th>
                        <th className="py-2 font-medium">
                          Remaining cost basis (fees excluded)
                        </th>
                        <th className="py-2 font-medium">
                          Realized profit and loss (fees excluded)
                        </th>
                        <th className="py-2 font-medium">Current price</th>
                        <th className="py-2 font-medium">Current market value</th>
                        <th className="py-2 font-medium">Unrealized profit and loss</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {positions.length === 0 ? (
                        <tr>
                          <td
                            className="py-8 text-center text-slate-500"
                            colSpan={8}
                          >
                            No positions yet. Added trades will be summarized here automatically.
                          </td>
                        </tr>
                      ) : (
                        positions.map((position) => (
                          <tr
                            key={`${position.assetSymbol}-${position.currency}`}
                          >
                            <td className="py-3 font-medium">
                              {position.assetSymbol}
                            </td>
                            <td className="py-3 text-slate-600">
                              {position.quantity}
                            </td>
                            <td className="py-3 text-slate-600">
                              {position.averageCost} {position.currency}
                            </td>
                            <td className="py-3 text-slate-600">
                              {position.costBasis} {position.currency}
                            </td>
                            <td className="py-3 text-slate-600">
                              {position.realizedPnl} {position.currency}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.latestPrice === undefined
                                ? "No price entered"
                                : `${position.latestPrice} ${position.currency}`}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.marketValue === undefined
                                ? "--"
                                : `${position.marketValue} ${position.currency}`}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.unrealizedPnl === undefined
                                ? "--"
                                : `${position.unrealizedPnl} ${position.currency}`}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title="Price Entry">
                <fieldset
                  className={isWritable ? "" : "opacity-60"}
                  disabled={!isWritable}
                >
                  <PriceForm
                    clock={clock}
                    ledgerData={ledgerData}
                    onPriceSnapshotCreated={(priceSnapshot, timeSnapshot) =>
                      applyLedgerAction({
                        type: "priceSnapshot/add",
                        priceSnapshot,
                      }, timeSnapshot)
                    }
                  />
                </fieldset>
              </Section>
            </div>

            <Section title="Add Trade">
              <fieldset
                className={isWritable ? "" : "opacity-60"}
                disabled={!isWritable}
              >
                <TradeForm
                  clock={clock}
                  ledgerData={ledgerData}
                  onTradeCreated={(trade, timeSnapshot) =>
                    applyLedgerAction(
                      { type: "trade/add", trade },
                      timeSnapshot,
                    )
                  }
                />
              </fieldset>
            </Section>

            <Section
              title={
                selectedTradeDate
                  ? `Trade List · ${selectedTradeDate}`
                  : "Trade List"
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
                deleteDisabled={!isWritable}
                onDelete={
                  hydrationStatus === "ready" ? handleDeleteTrade : undefined
                }
                trades={displayedTrades}
                todayKey={todayKey}
              />
            </Section>

            <Section title="Data Management">
              <div className="grid gap-4 text-sm text-slate-700">
                <p>
                  {storageKind === "ledger-file"
                    ? "The current .lftl file is the only authoritative complete ledger. IndexedDB stores only the last selected file handle and minimal connection metadata."
                    : "This area manages only the complete local ledger record for the current browser origin."}
                </p>

                <BackupControls
                  canImportBackup={capabilities.canImportBackup}
                  clock={clock}
                  hydrationStatus={hydrationStatus}
                  isDirty={isDirty}
                  isReadOnly={isReadOnly}
                  ledgerData={ledgerData}
                  onImport={replaceLedgerFromBackup}
                  persistenceOperation={persistenceOperation}
                  persistenceStatus={persistenceStatus}
                  requiresHistoricalRawText={
                    storageKind === "ledger-file"
                  }
                />

                {(capabilities.canClearReadyLedger ||
                  capabilities.canClearHydrationError) &&
                hydrationStatus === "loading" ? (
                  <p aria-live="polite">The local ledger cannot be cleared until loading completes.</p>
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
                      ? "Clear current C ledger"
                      : "Clear local ledger"}
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
                    Clear damaged or unreadable local data
                  </button>
                ) : null}

                {clearConfirmationMode ? (
                  <div className="grid gap-3 rounded-md border border-red-200 bg-red-50 p-4">
                    <p className="font-medium text-red-900">
                      {clearConfirmationMode === "normal"
                        ? storageKind === "ledger-file"
                          ? "This clears only the current C ledger content. It does not delete the .lftl file or affect other C files. The file retains the previous usable version, so recovery after future corruption may restore pre-clear data."
                          : "This permanently deletes custom assets, trades, prices, and fee rules. Export a complete ledger backup first."
                        : "The loading failure may be temporary. Continuing deletes custom assets, trades, prices, and fee rules that may still be recoverable. Restore from a valid backup first or confirm permanent deletion."}
                    </p>
                    <label className="grid gap-2 font-medium text-red-900">
                      Enter &quot;{clearConfirmationText}&quot; to confirm
                      <input
                        aria-label="Enter clear confirmation text"
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
                        Clearing the local ledger. Do not close the page.
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
                          ? "Confirm clearing current C content"
                          : "Confirm permanent clear"}
                      </button>
                      <button
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={persistenceOperation !== "idle"}
                        onClick={cancelClearConfirmation}
                        type="button"
                      >
                        Cancel
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
      </div>
    </main>
  );
}
