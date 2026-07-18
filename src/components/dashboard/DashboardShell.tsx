"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { getDefaultLedgerRepository } from "../../composition/ledgerRepositoryComposition";
import { usePersistentLedger } from "../../hooks/usePersistentLedger";
import type { Trade } from "../../models";
import type { LedgerRepository } from "../../repositories/ledgerRepository";
import { getPositionsFromLedger } from "../../services/positionService";
import { validateTradeRemoval } from "../../services/tradeRemovalService";
import { PriceForm } from "../prices/PriceForm";
import { TradeForm } from "../trades/TradeForm";

const navItems = ["总览", "买入", "卖出", "交易记录", "价格", "报告", "设置"];
const CLEAR_LEDGER_CONFIRMATION_TEXT = "清空本地账本";

type ClearConfirmationMode = "normal" | "recovery";

function Section({
  title,
  eyebrow,
  children,
}: Readonly<{
  title: string;
  eyebrow?: string;
  children: ReactNode;
}>) {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 text-lg font-semibold text-slate-950">{title}</h2>
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
}: Readonly<{
  trades: readonly Trade[];
  onDelete?: (tradeId: string) => void;
  deleteDisabled?: boolean;
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
                <td className="py-3 text-slate-600">{trade.occurredAt}</td>
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
  repository = getDefaultLedgerRepository(),
}: Readonly<{
  repository?: LedgerRepository;
}> = {}) {
  const {
    ledgerData,
    applyLedgerAction,
    hydrationStatus,
    persistenceError,
    retryPersistence,
    canRetryPersistence,
    clearLedger,
    persistenceOperation,
    persistenceStatus,
  } = usePersistentLedger(repository);
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
    hydrationStatus === "ready" && persistenceOperation === "idle";
  const positions = getPositionsFromLedger(ledgerData);

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
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
        <aside className="border-b border-slate-200 bg-white px-5 py-4 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="mb-6">
            <p className="text-sm font-semibold text-slate-950">Local Ledger</p>
            <p className="mt-1 text-xs text-slate-500">Browser-only MVP shell</p>
          </div>
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {navItems.map((item) => (
              <a
                className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                href="#"
                key={item}
              >
                {item}
              </a>
            ))}
          </nav>
          <div className="mt-8 hidden border-t border-slate-200 pt-4 text-sm text-slate-500 lg:block">
            <p>帮助</p>
            <p className="mt-2">快捷键</p>
            <p className="mt-2">切换账本</p>
          </div>
        </aside>

        <div className="min-w-0 flex-1 px-5 py-6 sm:px-8 lg:px-10">
          <header className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">
                Local-first ledger
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                Local-First Trading Ledger
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                本地记录交易和价格，持仓与盈亏由同一份账本事实实时推导。
              </p>
            </div>
            <div className="flex w-full rounded-md border border-slate-200 bg-white p-1 text-sm md:w-auto">
              {["Today", "This Month", "All"].map((item) => (
                <button
                  className="flex-1 rounded px-3 py-2 text-slate-600 first:bg-slate-950 first:text-white md:flex-none"
                  key={item}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
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

          <div className="grid gap-5">
            <Section eyebrow="Future chart area" title="资产走势">
              <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <div>
                  <p className="font-medium text-slate-700">
                    未来这里显示资产净值曲线和 K 线。
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    Day 4 only reserves the space. No API, no live market data,
                    no chart logic yet.
                  </p>
                </div>
              </div>
            </Section>

            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Section eyebrow="Calculated later" title="资产汇总">
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

              <Section eyebrow="Manual source" title="价格输入">
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

            <Section eyebrow="Trade draft" title="新增交易">
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

            <Section eyebrow="LedgerData source" title="交易列表">
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
              />
            </Section>

            <Section eyebrow="Local data" title="数据管理">
              <div className="grid gap-4 text-sm text-slate-700">
                <p>
                  本区只管理当前浏览器 origin 下的完整本地账本记录。
                </p>

                {hydrationStatus === "loading" ? (
                  <p aria-live="polite">本地账本读取完成前不可清空。</p>
                ) : null}

                {hydrationStatus === "ready" ? (
                  <button
                    className="w-fit rounded-md border border-red-300 px-4 py-2 font-medium text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={persistenceOperation !== "idle"}
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
                        ? "这会永久删除自定义资产、交易、价格和手续费规则。Week 8 备份尚未实现，当前不可恢复。"
                        : "读取失败可能只是暂时性错误；继续将删除仍可能可恢复的自定义资产、交易、价格和手续费规则。Week 8 备份尚未实现，当前不可恢复。"}
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
      </div>
    </main>
  );
}
