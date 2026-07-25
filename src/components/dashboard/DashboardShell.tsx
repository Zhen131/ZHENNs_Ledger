"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { usePersistentLedger } from "../../hooks/usePersistentLedger";
import type { Trade, ValuationPriceMode } from "../../models";
import type { LedgerRepository } from "../../repositories/ledgerRepository";
import {
  buildHoldingAllocation,
  buildHoldingHistory,
  buildTradeHeatmap,
} from "../../services/chartDataService";
import { getPositionsFromLedger } from "../../services/positionService";
import { validateTradeRemoval } from "../../services/tradeRemovalService";
import { createSystemLedgerClock, isLedgerFactInFuture } from "../../utils/ledgerDate";
import { PriceForm } from "../prices/PriceForm";
import { TradeForm } from "../trades/TradeForm";
import { BackupControls } from "../backup/BackupControls";
import { ChartOverviewSummary } from "../charts/ChartOverviewSummary";
import { MarketDataControls } from "../market-data/MarketDataControls";

const CLEAR_LEDGER_CONFIRMATION_TEXT = "清空本地账本";

type ClearConfirmationMode = "normal" | "recovery";

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
  onDelete?: (tradeId: string) => void;
  deleteDisabled?: boolean;
  todayKey?: string;
}>) {
  const columnCount = onDelete ? 7 : 6;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="py-2 font-medium">日期</th>
            <th className="py-2 font-medium">类型</th>
            <th className="py-2 font-medium">资产</th>
            <th className="py-2 font-medium">数量</th>
            <th className="py-2 font-medium">均价</th>
            <th className="py-2 font-medium">总金额</th>
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
            trades.map((trade) => (
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
                {onDelete ? (
                  <td className="py-3">
                    <button
                      aria-label={`删除 ${
                        trade.type === "buy" ? "买入" : "卖出"
                      } ${trade.assetSymbol} ${trade.occurredAt}`}
                      className="text-sm font-medium text-red-700 hover:text-red-900 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={deleteDisabled}
                      onClick={() => onDelete(trade.id)}
                      type="button"
                    >
                      删除
                    </button>
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
  repository,
}: Readonly<{
  repository: LedgerRepository;
}>) {
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
  } = usePersistentLedger(repository);
  const [valuationPriceMode, setValuationPriceMode] =
    useState<ValuationPriceMode>("auto");
  const [tradeRemovalError, setTradeRemovalError] = useState("");
  const [clearConfirmationMode, setClearConfirmationMode] =
    useState<ClearConfirmationMode | null>(null);
  const [clearConfirmationValue, setClearConfirmationValue] = useState("");
  const [clearConfirmationError, setClearConfirmationError] = useState("");
  const [clearSuccessMessage, setClearSuccessMessage] = useState("");
  const mountedRef = useRef(true);
  const currentRepositoryRef = useRef(repository);
  currentRepositoryRef.current = repository;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setClearConfirmationMode(null);
    setClearConfirmationValue("");
    setClearConfirmationError("");
    setClearSuccessMessage("");
  }, [repository]);

  const isWritable =
    hydrationStatus === "ready" &&
    persistenceOperation === "idle" &&
    !repositorySwitchBlocked &&
    !isReadOnly &&
    !isFutureFactCorrectionMode;
  const todayKey = createSystemLedgerClock().todayKey();
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
    range: "30d",
  });
  const heatmap = buildTradeHeatmap(ledgerData, todayKey);
  const futureTrades = ledgerData.trades.filter((trade) =>
    isLedgerFactInFuture(trade.occurredAt, todayKey),
  );
  const futurePriceSnapshots = ledgerData.priceSnapshots.filter((snapshot) =>
    isLedgerFactInFuture(snapshot.recordedAt, todayKey),
  );

  function handleDeleteTrade(tradeId: string) {
    if (!isWritable) {
      return;
    }

    const result = validateTradeRemoval(tradeId, ledgerData);

    if (!result.ok) {
      setTradeRemovalError(
        result.error.code === "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE"
          ? "无法删除：这笔交易支撑了后续卖出，删除后持仓时间线会失效"
          : "无法删除：没有找到这笔交易",
      );
      return;
    }

    applyLedgerAction({ type: "trade/delete", tradeId: result.tradeId });
    setTradeRemovalError("");
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
    if (clearConfirmationValue !== CLEAR_LEDGER_CONFIRMATION_TEXT) {
      setClearConfirmationError(
        `请输入完整确认文本“${CLEAR_LEDGER_CONFIRMATION_TEXT}”`,
      );
      return;
    }

    const operationRepository = repository;
    setClearConfirmationError("");
    setClearSuccessMessage("");
    const result = await clearLedger();

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
    setClearConfirmationMode(null);
    setClearConfirmationValue("");
    setClearSuccessMessage("账本已清空");
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
        </header>

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
          {isFutureFactCorrectionMode ? (
            <div className="mb-5 grid gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-950">
              <p className="font-semibold">未来事实纠正模式</p>
              <p>
                未来交易和价格不会进入持仓、行情选择或图表。普通新增、正常历史删除和 Binance 刷新已暂停；仍可救援导出、导入合法整账、清空或删除全部无效未来事实。
              </p>
              <ul className="grid gap-1">
                {futureTrades.map((trade) => (
                  <li key={trade.id}>
                    未来交易：{trade.occurredAt} · {trade.assetSymbol} · {trade.type}
                  </li>
                ))}
                {futurePriceSnapshots.map((snapshot) => (
                  <li key={snapshot.id}>
                    未来价格：{snapshot.recordedAt} · {snapshot.assetSymbol} · {snapshot.price} {snapshot.currency}
                  </li>
                ))}
              </ul>
              <button
                className="w-fit rounded-md bg-red-800 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={persistenceOperation !== "idle" || isReadOnly}
                onClick={() =>
                  applyLedgerAction({
                    type: "futureFacts/deleteAll",
                    todayKey,
                  })
                }
                type="button"
              >
                删除全部无效未来事实
              </button>
            </div>
          ) : null}

          <div className="grid gap-5">
            <Section title="图表总览与 Binance 行情">
              <MarketDataControls
                applyLedgerMutation={applyLedgerMutation}
                isWritable={isWritable}
                ledgerData={ledgerData}
                ledgerEpoch={ledgerEpoch}
                mode={valuationPriceMode}
                onModeChange={setValuationPriceMode}
              />
            </Section>

            <Section title="账本图表">
              <ChartOverviewSummary
                allocation={allocation}
                heatmap={heatmap}
                history={history}
              />
            </Section>

            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Section title="资产汇总">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 font-medium">资产</th>
                        <th className="py-2 font-medium">持仓数量</th>
                        <th className="py-2 font-medium">平均成本</th>
                        <th className="py-2 font-medium">
                          剩余成本基础（暂不计手续费）
                        </th>
                        <th className="py-2 font-medium">
                          已实现盈亏（暂不计手续费）
                        </th>
                        <th className="py-2 font-medium">当前价格</th>
                        <th className="py-2 font-medium">当前市值</th>
                        <th className="py-2 font-medium">未实现盈亏</th>
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
                                ? "未输入价格"
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

              <Section title="价格输入">
                <fieldset
                  className={isWritable ? "" : "opacity-60"}
                  disabled={!isWritable}
                >
                  <PriceForm
                    ledgerData={ledgerData}
                    onPriceSnapshotCreated={(priceSnapshot) =>
                      applyLedgerAction({
                        type: "priceSnapshot/add",
                        priceSnapshot,
                      })
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
                  ledgerData={ledgerData}
                  onTradeCreated={(trade) =>
                    applyLedgerAction({ type: "trade/add", trade })
                  }
                />
              </fieldset>
            </Section>

            <Section title="交易列表">
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
                trades={ledgerData.trades}
                todayKey={todayKey}
              />
            </Section>

            <Section title="数据管理">
              <div className="grid gap-4 text-sm text-slate-700">
                <p>
                  本区只管理当前浏览器 origin 下的完整本地账本记录。
                </p>

                <BackupControls
                  hydrationStatus={hydrationStatus}
                  isDirty={isDirty}
                  isReadOnly={isReadOnly}
                  ledgerData={ledgerData}
                  onImport={replaceLedgerFromBackup}
                  persistenceOperation={persistenceOperation}
                  persistenceStatus={persistenceStatus}
                />

                {hydrationStatus === "loading" ? (
                  <p aria-live="polite">本地账本读取完成前不可清空。</p>
                ) : null}

                {hydrationStatus === "ready" ? (
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
                    清空本地账本
                  </button>
                ) : null}

                {hydrationStatus === "error" ? (
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
                        ? "这会永久删除自定义资产、交易、价格和手续费规则。请先导出完整账本备份。"
                        : "读取失败可能只是暂时性错误；继续将删除仍可能可恢复的自定义资产、交易、价格和手续费规则。请先使用有效备份恢复，或确认永久删除。"}
                    </p>
                    <label className="grid gap-2 font-medium text-red-900">
                      输入“{CLEAR_LEDGER_CONFIRMATION_TEXT}”以确认
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
                        确认永久清空
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
