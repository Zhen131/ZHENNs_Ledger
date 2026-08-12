"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { LedgerData } from "@/core/models";
import {
  addLedgerDays,
  compareLedgerFactOrder,
  getLedgerDateKey,
} from "@/core/shared";
import { validateTradeRemoval } from "@/features/trades";
import { TradeTable } from "@/features/trades/ui";
import { SurfaceCard } from "@/ui";
import type { LedgerWorkspaceIntent } from "./useLedgerWorkspaceSession";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "./usePersistentLedger";

type TimeFilter = "all" | "today" | "7d" | "1y";

type PendingDelete =
  | {
      tradeId: string;
      phase: "countdown";
      deadline: number;
    }
  | {
      tradeId: string;
      phase: "persisting";
      expectedMutationVersion: number;
    };

const DELETE_DELAY_MS = 5_000;

export function TransactionsWorkspace({
  active,
  intent,
  onIntentConsumed,
  ledgerData,
  ledgerEpoch,
  todayKey,
  isWritable,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  onDeleteTrade,
}: Readonly<{
  active: boolean;
  intent: Extract<LedgerWorkspaceIntent, { page: "transactions" }> | null;
  onIntentConsumed: () => void;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  todayKey: string;
  isWritable: boolean;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  onDeleteTrade: (tradeId: string) => ApplyLedgerActionResult;
}>) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [exactDate, setExactDate] = useState("");
  const [assetFilter, setAssetFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "buy" | "sell">(
    "all",
  );
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [armedTradeId, setArmedTradeId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [feedback, setFeedback] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingDeleteRef = useRef<PendingDelete | null>(null);
  const latestLedgerDataRef = useRef(ledgerData);
  const mutationVersionRef = useRef(mutationVersion);
  const onDeleteTradeRef = useRef(onDeleteTrade);
  latestLedgerDataRef.current = ledgerData;
  mutationVersionRef.current = mutationVersion;
  onDeleteTradeRef.current = onDeleteTrade;

  const clearTimers = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
  }, []);

  const clearPendingDelete = useCallback(() => {
    clearTimers();
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    setRemainingMs(0);
  }, [clearTimers]);

  const resetFilters = useCallback(() => {
    setTimeFilter("all");
    setExactDate("");
    setAssetFilter("all");
    setTypeFilter("all");
  }, []);

  const resetPageState = useCallback(() => {
    resetFilters();
    setExpandedTradeId(null);
    setArmedTradeId(null);
    clearPendingDelete();
    setFeedback("");
  }, [clearPendingDelete, resetFilters]);

  const formatRemovalError = useCallback(
    (result: ReturnType<typeof validateTradeRemoval>) => {
      if (result.ok) return "";
      return result.error.code === "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE"
        ? "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出"
        : "无法删除：没有找到这笔交易";
    },
    [],
  );

  const finalizeDeleteRef = useRef<(tradeId: string) => void>(() => undefined);
  finalizeDeleteRef.current = (tradeId) => {
    const current = pendingDeleteRef.current;
    if (
      current?.phase !== "countdown" ||
      current.tradeId !== tradeId
    ) {
      return;
    }
    clearTimers();

    const finalReview = validateTradeRemoval(
      tradeId,
      latestLedgerDataRef.current,
    );
    if (!finalReview.ok) {
      pendingDeleteRef.current = null;
      setPendingDelete(null);
      setRemainingMs(0);
      setFeedback(formatRemovalError(finalReview));
      return;
    }

    const expectedMutationVersion = mutationVersionRef.current + 1;
    const outcome = onDeleteTradeRef.current(tradeId);
    if (outcome !== "applied") {
      pendingDeleteRef.current = null;
      setPendingDelete(null);
      setRemainingMs(0);
      setFeedback(
        outcome === "rejected"
          ? "账本当前不可写，删除未执行"
          : "交易未发生变化，请刷新后重试",
      );
      return;
    }

    const persisting: PendingDelete = {
      tradeId,
      phase: "persisting",
      expectedMutationVersion,
    };
    pendingDeleteRef.current = persisting;
    setPendingDelete(persisting);
    setRemainingMs(0);
    setFeedback("删除正在保存…");
  };

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  useEffect(() => {
    if (active) return;
    resetPageState();
  }, [active, resetPageState]);

  useEffect(() => {
    resetPageState();
  }, [ledgerEpoch, resetPageState]);

  useEffect(() => {
    if (!active || !intent) return;
    resetFilters();
    setExpandedTradeId(null);
    setArmedTradeId(null);
    clearPendingDelete();
    setFeedback("");

    if ("filterDate" in intent && intent.filterDate) {
      setExactDate(intent.filterDate);
    }
    if ("expandTradeId" in intent && intent.expandTradeId) {
      setExpandedTradeId(intent.expandTradeId);
    }
    onIntentConsumed();
  }, [
    active,
    clearPendingDelete,
    intent,
    onIntentConsumed,
    resetFilters,
  ]);

  useEffect(() => {
    if (!active) return;
    const cancelWhenHidden = () => {
      if (document.hidden) {
        setArmedTradeId(null);
        clearPendingDelete();
        setFeedback("删除倒计时已取消");
      }
    };
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () =>
      document.removeEventListener("visibilitychange", cancelWhenHidden);
  }, [active, clearPendingDelete]);

  useEffect(() => {
    if (
      pendingDelete?.phase === "countdown" &&
      !ledgerData.trades.some((trade) => trade.id === pendingDelete.tradeId)
    ) {
      clearPendingDelete();
      setFeedback("删除倒计时已取消：交易已不在当前账本中");
    }
  }, [clearPendingDelete, ledgerData.trades, pendingDelete]);

  useEffect(() => {
    if (pendingDelete?.phase !== "persisting") return;
    if (persistenceStatus === "error") {
      setFeedback("删除已应用到内存，但尚未保存；请重试保存");
      return;
    }
    if (
      persistenceStatus === "saved" &&
      persistedVersion >= pendingDelete.expectedMutationVersion
    ) {
      clearPendingDelete();
      setFeedback("交易已删除");
    }
  }, [
    clearPendingDelete,
    pendingDelete,
    persistedVersion,
    persistenceStatus,
  ]);

  function armDelete(tradeId: string) {
    if (!isWritable || pendingDelete?.phase === "persisting") return;
    clearPendingDelete();
    setExpandedTradeId(null);
    setArmedTradeId(tradeId);
    setFeedback("");
  }

  function confirmDelete(tradeId: string) {
    if (!isWritable || armedTradeId !== tradeId) return;
    const firstReview = validateTradeRemoval(tradeId, latestLedgerDataRef.current);
    if (!firstReview.ok) {
      setArmedTradeId(null);
      setFeedback(formatRemovalError(firstReview));
      return;
    }

    const deadline = Date.now() + DELETE_DELAY_MS;
    const countdown: PendingDelete = {
      tradeId,
      phase: "countdown",
      deadline,
    };
    pendingDeleteRef.current = countdown;
    setPendingDelete(countdown);
    setRemainingMs(DELETE_DELAY_MS);
    setArmedTradeId(null);
    setFeedback("5 秒内可撤回，倒计时结束后会再次检查交易时间线");
    intervalRef.current = setInterval(() => {
      setRemainingMs(Math.max(0, deadline - Date.now()));
    }, 100);
    timeoutRef.current = setTimeout(
      () => finalizeDeleteRef.current(tradeId),
      DELETE_DELAY_MS,
    );
  }

  const filteredTrades = useMemo(() => {
    const earliestDate =
      timeFilter === "7d"
        ? addLedgerDays(todayKey, -6)
        : timeFilter === "1y"
          ? addLedgerDays(todayKey, -364)
          : null;

    return ledgerData.trades
      .filter((trade) => {
        const dateKey = getLedgerDateKey(trade.occurredAt);
        if (timeFilter === "today" && dateKey !== todayKey) return false;
        if (earliestDate && (dateKey < earliestDate || dateKey > todayKey)) {
          return false;
        }
        if (exactDate && dateKey !== exactDate) return false;
        if (assetFilter !== "all" && trade.assetSymbol !== assetFilter) {
          return false;
        }
        return typeFilter === "all" || trade.type === typeFilter;
      })
      .map((trade, index) => ({ trade, index }))
      .sort((left, right) => {
        const timeOrder = compareLedgerFactOrder(
          left.trade.occurredAt,
          right.trade.occurredAt,
          0,
          0,
        );
        return timeOrder === 0 ? left.index - right.index : -timeOrder;
      })
      .map(({ trade }) => trade);
  }, [
    assetFilter,
    exactDate,
    ledgerData.trades,
    timeFilter,
    todayKey,
    typeFilter,
  ]);

  const assetOptions = Array.from(
    new Set(ledgerData.trades.map((trade) => trade.assetSymbol)),
  ).sort((left, right) => left.localeCompare(right));
  const hasFilters =
    timeFilter !== "all" ||
    exactDate !== "" ||
    assetFilter !== "all" ||
    typeFilter !== "all";
  const timeLabel = {
    all: "全部",
    today: "今天",
    "7d": "最近 7 天",
    "1y": "最近 1 年",
  }[timeFilter];
  const typeLabel =
    typeFilter === "all" ? "全部" : typeFilter === "buy" ? "买入" : "卖出";

  return (
    <section
      aria-label="交易工作区"
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="transactions"
    >
      <SurfaceCard className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">交易记录</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
              共 {ledgerData.trades.length} 笔事实；筛选只作用于当前解锁会话。
            </p>
          </div>
          <p className="rounded-full bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-muted)]">
            当前显示 {filteredTrades.length} 笔
          </p>
        </div>
      </SurfaceCard>

      <SurfaceCard className="sticky top-0 z-20 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
            时间范围
            <select
              className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 text-sm text-[var(--ledger-ink)]"
              onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}
              value={timeFilter}
            >
              <option value="all">全部时间</option>
              <option value="today">今天</option>
              <option value="7d">最近 7 天</option>
              <option value="1y">最近 1 年</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
            准确日期
            <input
              className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 text-sm text-[var(--ledger-ink)]"
              onChange={(event) => setExactDate(event.target.value)}
              type="date"
              value={exactDate}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
            资产筛选
            <select
              className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 text-sm text-[var(--ledger-ink)]"
              onChange={(event) => setAssetFilter(event.target.value)}
              value={assetFilter}
            >
              <option value="all">全部资产</option>
              {assetOptions.map((asset) => (
                <option key={asset} value={asset}>{asset}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
            类型筛选
            <select
              className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 text-sm text-[var(--ledger-ink)]"
              onChange={(event) =>
                setTypeFilter(event.target.value as "all" | "buy" | "sell")
              }
              value={typeFilter}
            >
              <option value="all">全部类型</option>
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ledger-muted)]">
          <p>
            时间：{timeLabel}｜日期：{exactDate || "全部"}｜资产：
            {assetFilter === "all" ? "全部" : assetFilter}｜类型：{typeLabel}
          </p>
          {hasFilters ? (
            <button
              className="font-semibold text-[var(--ledger-accent-strong)]"
              onClick={resetFilters}
              type="button"
            >
              清除筛选
            </button>
          ) : null}
        </div>
      </SurfaceCard>

      {feedback ? (
        <p
          aria-live="polite"
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback === "交易已删除"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : feedback.includes("无法") || feedback.includes("尚未保存")
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {feedback}
        </p>
      ) : null}

      <SurfaceCard className="min-w-0 p-0">
        <TradeTable
          deleteDisabled={!isWritable}
          deleteState={{
            armedTradeId,
            pendingTradeId: pendingDelete?.tradeId ?? null,
            pendingPhase: pendingDelete?.phase ?? null,
            remainingMs,
          }}
          expandedTradeId={expandedTradeId}
          onArmDelete={armDelete}
          onCancelDelete={() => setArmedTradeId(null)}
          onConfirmDelete={confirmDelete}
          onExpandedTradeIdChange={setExpandedTradeId}
          onUndoDelete={() => {
            clearPendingDelete();
            setFeedback("已撤回，账本没有变化");
          }}
          todayKey={todayKey}
          trades={filteredTrades}
          variant="workspace"
        />
      </SurfaceCard>
    </section>
  );
}
