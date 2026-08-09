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
import { calculateTradeCashImpact } from "../../calculators/tradeCashImpact";
import {
  buildLedgerPnlSummary,
  type SummaryMetric,
} from "../../services/pnlSummaryService";
import { getPositionsFromLedger } from "../../services/positionService";
import { USDT_USD_APPROXIMATION_DISCLOSURE } from "../../services/valuationDisplay";
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

const LEGACY_CLEAR_LEDGER_CONFIRMATION_TEXT = "清空本地账本";

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

function SummaryMetricCard({
  label,
  metric,
  valuationLabel,
}: Readonly<{
  label: string;
  metric: SummaryMetric;
  valuationLabel: string;
}>) {
  return (
    <article className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-medium text-slate-600">{label}</h3>
      <p className="mt-2 text-xl font-semibold text-slate-950">
        {metric.value === undefined
          ? "不可完整计算"
          : `${metric.value} ${valuationLabel}`}
      </p>
      {metric.missingReasons.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-xs leading-5 text-amber-800">
          {metric.missingReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </article>
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
  const columnCount = onDelete ? 9 : 8;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="py-2 font-medium">日期</th>
            <th className="py-2 font-medium">类型</th>
            <th className="py-2 font-medium">资产</th>
            <th className="py-2 font-medium">数量</th>
            <th className="py-2 font-medium">均价</th>
            <th className="py-2 font-medium">成交金额（不含手续费）</th>
            <th className="py-2 font-medium">实际手续费</th>
            <th className="py-2 font-medium">现金影响</th>
            {onDelete ? <th className="py-2 font-medium">操作</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {trades.length === 0 ? (
            <tr>
              <td
                className="py-8 text-center text-slate-500"
                colSpan={columnCount}
              >
                暂无交易。添加交易后，这里会自动显示。
              </td>
            </tr>
          ) : (
            trades.map((trade) => {
              const cashImpact = calculateTradeCashImpact(trade);
              return (
              <tr key={trade.id}>
                <td className="py-3 text-slate-600">
                  {trade.occurredAt}
                  {todayKey &&
                  isLedgerFactInFuture(trade.occurredAt, todayKey) ? (
                    <span className="ml-2 font-medium text-red-700">
                      无效未来事实
                    </span>
                  ) : null}
                </td>
                <td className="py-3 text-slate-600">
                  {trade.type === "buy" ? "买入" : "卖出"}
                </td>
                <td className="py-3 font-medium">{trade.assetSymbol}</td>
                <td className="py-3 text-slate-600">{trade.quantity}</td>
                <td className="py-3 text-slate-600">{trade.price}</td>
                <td className="py-3 text-slate-600">
                  {trade.totalValue} {trade.currency}
                </td>
                <td className="py-3 text-slate-600">
                  {trade.fee} {trade.feeCurrency}
                </td>
                <td className="py-3 text-slate-600">
                  {cashImpact.ok ? (
                    <>
                      {cashImpact.amount} {cashImpact.currency}
                      <span className="block text-xs text-slate-500">
                        {cashImpact.kind === "buy-outflow"
                          ? "买入总支出"
                          : "卖出净到账"}
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-800">
                      不可可靠计算：{cashImpact.feeCurrency} 手续费未换算
                    </span>
                  )}
                </td>
                {onDelete ? (
                  <td className="py-3">
                    <ConfirmDeleteButton
                      ariaLabel={`删除 ${
                        trade.type === "buy" ? "买入" : "卖出"
                      } ${trade.assetSymbol} ${trade.occurredAt}`}
                      disabled={deleteDisabled}
                      label="删除"
                      onConfirm={() => onDelete(trade.id)}
                    />
                  </td>
                ) : null}
              </tr>
              );
            })
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
  const pnlSummary = buildLedgerPnlSummary(ledgerData, {
    todayKey,
    mode: valuationPriceMode,
  });
  const hasLegacyUsdAssets = ledgerData.assets.some(
    (asset) => asset.quoteCurrency === "USD",
  );
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
          ? "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出"
          : "无法删除：没有找到这笔交易",
      );
      return "rejected";
    }

    const outcome = applyLedgerAction({
      type: "trade/delete",
      tradeId: result.tradeId,
    });
    setError(
      outcome === "rejected" ? "账本当前不可写，删除未执行" : "",
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
      outcome === "rejected" ? "账本当前不可写，删除未执行" : "",
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
      outcome === "rejected" ? "账本当前不可写，删除未执行" : "",
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
        `请输入完整确认文本“${clearConfirmationText}”`,
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
        ? "当前 C 账本内容已清空"
        : "账本已清空",
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
          正在安全锁定：已停止新操作，正在等待已接受的保存收尾…
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto min-h-screen w-full max-w-7xl px-5 py-6 sm:px-8 lg:px-10">
        <header className="mb-6 border-b border-slate-200 pb-6">
          <p className="text-sm font-medium text-slate-500">
            本地优先交易账本
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            Local-First Trading Ledger
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            本地记录交易和真实价格事实，持仓、盈亏与图表由同一份账本实时推导。
          </p>
          {session?.storageKind === "ledger-file" && onFinalLock ? (
            <button
              className="mt-4 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
              onClick={requestImmediateLock}
              type="button"
            >
              立即锁定
            </button>
          ) : null}
        </header>

          {showLockConfirmation ? (
            <section
              aria-label="未保存修改锁定确认"
              className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900"
            >
              <p className="font-medium">还有内容没保存</p>
              <p className="mt-1 leading-6">
                你可以重新保存；如果确定这些未保存修改不要了，再继续锁定。已经进入底层写入的操作仍会安全收尾，不会被强行打断。
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
                  重新保存
                </button>
                <button
                  className="rounded-md bg-red-700 px-3 py-2 font-medium text-white"
                  onClick={confirmDiscardAndLock}
                  type="button"
                >
                  我确定不要了，继续锁定
                </button>
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
                  onClick={() => setShowLockConfirmation(false)}
                  type="button"
                >
                  取消
                </button>
              </div>
            </section>
          ) : null}

          {hydrationStatus === "loading" ? (
            <p
              aria-live="polite"
              className="mb-5 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600"
            >
              正在读取本地账本，完成前不会写入任何数据。
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
                ? `当前账本超过资源上限，已只读加载：${resourcePolicyError.message}`
                : `操作被资源边界拒绝：${resourcePolicyError.message}`}
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
                  重试保存
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
                正在保存到本地
              </p>
            ) : persistenceStatus === "saved" ? (
              <p
                aria-live="polite"
                className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                已保存到本地
              </p>
            ) : null
          ) : null}
          {repositorySwitchBlocked ? (
            <div
              aria-live="assertive"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              <p>
                当前账本尚未保存，已阻止切换本地账本存储。请先重试保存，或明确放弃未保存更改。
              </p>
              <button
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium"
                onClick={discardDirtyChangesAndSwitchRepository}
                type="button"
              >
                放弃未保存更改并切换
              </button>
            </div>
          ) : null}
          {compatibilityWarnings.length > 0 ? (
            <div
              aria-live="assertive"
              className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              <p className="font-semibold">旧账本兼容警告</p>
              <ul className="mt-2 grid gap-1">
                {compatibilityWarnings.slice(0, 8).map((warning, index) => (
                  <li key={`${warning.code}-${warning.path}-${index}`}>
                    <code>{warning.path}</code> · {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hydrationStatus === "ready" && hasLegacyUsdAssets ? (
            <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
              <p className="font-semibold">旧 USD 账本兼容读取</p>
              <p>
                旧交易和价格仍可查看；USD 资产不接受新的交易、手动价格或 Binance 价格事实。请在新的 USDT 账本中继续录入。
              </p>
            </div>
          ) : null}
          {isFutureFactCorrectionMode ? (
            <div className="mb-5 grid gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-950">
              <p className="font-semibold">未来事实纠正模式</p>
              <p>
                未来交易和价格不会进入持仓、行情选择或图表。普通新增、正常历史删除和 Binance 刷新已暂停；仍可逐条删除未来事实、救援导出、导入合法整账、清空或删除全部无效未来事实。
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
                      未来交易：{trade.type === "buy" ? "买入" : "卖出"} ·{" "}
                      {trade.assetSymbol} · 数量 {trade.quantity} · 价格{" "}
                      {trade.price} {trade.currency} · {trade.occurredAt} · ID{" "}
                      {shortLedgerId(trade.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`删除未来交易 ${trade.assetSymbol} ${trade.occurredAt} ${trade.id}`}
                      disabled={!canCorrectFutureFacts}
                      label="删除未来交易"
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
                      未来价格：{snapshot.assetSymbol} · {snapshot.price}{" "}
                      {snapshot.currency} · 来源{" "}
                      {snapshot.source === "api" ? "Binance API" : "手动"} ·{" "}
                      {snapshot.recordedAt} · ID {shortLedgerId(snapshot.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`删除未来价格 ${snapshot.assetSymbol} ${snapshot.recordedAt} ${snapshot.id}`}
                      disabled={!canCorrectFutureFacts}
                      label="删除未来价格"
                      onConfirm={() =>
                        handleDeleteFuturePrice(snapshot.id)
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="w-fit">
                <ConfirmDeleteButton
                  ariaLabel="删除全部无效未来事实"
                  disabled={!canCorrectFutureFacts}
                  label="删除全部无效未来事实"
                  onConfirm={handleDeleteAllFutureFacts}
                />
              </div>
            </div>
          ) : null}

          <div className="grid gap-5">
            <Section title="图表总览与 Binance 行情">
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

            <Section title="账本图表">
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

            <Section title="净盈亏摘要">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SummaryMetricCard
                  label="累计买入总支出"
                  metric={pnlSummary.buyOutflow}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label="累计卖出净到账"
                  metric={pnlSummary.sellProceeds}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label="剩余含费成本"
                  metric={pnlSummary.remainingCostBasis}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label="已实现净盈亏"
                  metric={pnlSummary.realizedPnl}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label="未实现净盈亏"
                  metric={pnlSummary.unrealizedPnl}
                  valuationLabel={pnlSummary.valuation.label}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                买入总支出 = 成交金额 + 实际手续费；卖出净到账 = 成交金额 - 实际手续费。缺价或无法换算的异币手续费不会按 0 补入。
              </p>
              {pnlSummary.valuation.usesApproximation ? (
                <p className="mt-2 text-sm font-medium text-amber-800">
                  {USDT_USD_APPROXIMATION_DISCLOSURE}
                </p>
              ) : null}
            </Section>

            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Section title="资产汇总">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 font-medium">资产</th>
                        <th className="py-2 font-medium">持仓数量</th>
                        <th className="py-2 font-medium">含费平均成本</th>
                        <th className="py-2 font-medium">剩余含费成本</th>
                        <th className="py-2 font-medium">已实现净盈亏</th>
                        <th className="py-2 font-medium">当前价格</th>
                        <th className="py-2 font-medium">当前市值</th>
                        <th className="py-2 font-medium">未实现净盈亏</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {positions.length === 0 ? (
                        <tr>
                          <td
                            className="py-8 text-center text-slate-500"
                            colSpan={8}
                          >
                            暂无持仓。添加交易后，这里会自动汇总。
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
                                  异币手续费未换算
                                </span>
                              ) : null}
                            </td>
                            <td className="py-3 text-slate-600">
                              {position.quantity}
                            </td>
                            <td className="py-3 text-slate-600">
                              {feeAccountingReliable
                                ? `${position.averageCost} ${position.currency}`
                                : "不可可靠计算"}
                            </td>
                            <td className="py-3 text-slate-600">
                              {feeAccountingReliable
                                ? `${position.costBasis} ${position.currency}`
                                : "不可可靠计算"}
                            </td>
                            <td className="py-3 text-slate-600">
                              {feeAccountingReliable
                                ? `${position.realizedPnl} ${position.currency}`
                                : "不可可靠计算"}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.latestPrice === undefined
                                ? "未输入价格"
                                : `${position.latestPrice} ${position.currency}`}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.marketValue === undefined
                                ? "--"
                                : `${position.marketValue} ${position.currency}`}
                            </td>
                            <td className="py-3 text-slate-500">
                              {!feeAccountingReliable
                                ? "不可可靠计算"
                                : position.unrealizedPnl === undefined
                                  ? "缺少合法价格"
                                : `${position.unrealizedPnl} ${position.currency}`}
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title="价格输入">
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

            <Section title="新增交易">
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
                  ? `交易列表 · ${selectedTradeDate}`
                  : "交易列表"
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

            <Section title="数据管理">
              <div className="grid gap-4 text-sm text-slate-700">
                <p>
                  {storageKind === "ledger-file"
                    ? "当前 .lftl 文件是唯一正式完整账本；IndexedDB 只保存上次选择的文件句柄和少量连接信息。"
                    : "本区只管理当前浏览器 origin 下的完整本地账本记录。"}
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
                  <p aria-live="polite">本地账本读取完成前不可清空。</p>
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
                      ? "清空当前 C 账本"
                      : "清空本地账本"}
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
                    清除损坏或无法读取的本地数据
                  </button>
                ) : null}

                {clearConfirmationMode ? (
                  <div className="grid gap-3 rounded-md border border-red-200 bg-red-50 p-4">
                    <p className="font-medium text-red-900">
                      {clearConfirmationMode === "normal"
                        ? storageKind === "ledger-file"
                          ? "这只会清空当前 C 的账本内容，不删除 .lftl 文件，也不影响其他 C。文件仍会保留清空前的上一可用版，之后若当前代损坏，恢复可能回到清空前数据。"
                          : "这会永久删除自定义资产、交易、价格和手续费规则。请先导出完整账本备份。"
                        : "读取失败可能只是暂时性错误；继续将删除仍可能可恢复的自定义资产、交易、价格和手续费规则。请先使用有效备份恢复，或确认永久删除。"}
                    </p>
                    <label className="grid gap-2 font-medium text-red-900">
                      输入“{clearConfirmationText}”以确认
                      <input
                        aria-label="输入清空确认文本"
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
                        正在清空本地账本，请勿关闭页面。
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
                          ? "确认清空当前 C 内容"
                          : "确认永久清空"}
                      </button>
                      <button
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={persistenceOperation !== "idle"}
                        onClick={cancelClearConfirmation}
                        type="button"
                      >
                        取消
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
