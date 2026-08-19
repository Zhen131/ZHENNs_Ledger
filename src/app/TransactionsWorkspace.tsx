"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { LedgerData } from "@/core/models";
import { addLedgerDays } from "@/core/shared";
import {
  ActivityTable,
  buildLedgerActivityItems,
  filterLedgerActivityItems,
  type LedgerActivityItem,
  type LedgerActivityTypeFilter,
} from "@/features/activity";
import { projectLedgerCashMutation } from "@/features/cash";
import { NegativeCashConfirmationDialog } from "@/features/cash/ui";
import { validateTradeRemoval } from "@/features/trades";
import { SurfaceCard } from "@/ui";
import type { LedgerWorkspaceIntent } from "./useLedgerWorkspaceSession";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "./usePersistentLedger";

type TimeFilter = "all" | "today" | "7d" | "1y";
type ActivityKind = LedgerActivityItem["kind"];

type PendingDelete =
  | {
      itemId: string;
      itemKind: ActivityKind;
      phase: "countdown";
      deadline: number;
    }
  | {
      itemId: string;
      itemKind: ActivityKind;
      phase: "persisting";
      expectedMutationVersion: number;
    };

type PendingNegativeDelete = Readonly<{
  itemId: string;
  itemKind: ActivityKind;
  projection: ReturnType<typeof projectLedgerCashMutation>;
  expectedLedgerEpoch: number;
  expectedMutationVersion: number;
  expectedPersistedVersion: number;
  expectedTodayKey: string;
}>;

type ActivityLocationRequest = Readonly<{
  date: string;
  requestId: number;
}>;

const DELETE_DELAY_MS = 5_000;
const SUCCESS_FEEDBACK_MS = 4_000;

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
  onDeleteCashEvent = () => "rejected",
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
  onDeleteCashEvent?: (cashEventId: string) => ApplyLedgerActionResult;
}>) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [exactDate, setExactDate] = useState("");
  const [assetFilter, setAssetFilter] = useState("all");
  const [typeFilter, setTypeFilter] =
    useState<LedgerActivityTypeFilter>("all");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [armedItemId, setArmedItemId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingNegativeDelete, setPendingNegativeDelete] =
    useState<PendingNegativeDelete | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [locationRequest, setLocationRequest] =
    useState<ActivityLocationRequest | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingDeleteRef = useRef<PendingDelete | null>(null);
  const latestLedgerDataRef = useRef(ledgerData);
  const ledgerEpochRef = useRef(ledgerEpoch);
  const mutationVersionRef = useRef(mutationVersion);
  const persistedVersionRef = useRef(persistedVersion);
  const todayKeyRef = useRef(todayKey);
  const isWritableRef = useRef(isWritable);
  const onDeleteTradeRef = useRef(onDeleteTrade);
  const onDeleteCashEventRef = useRef(onDeleteCashEvent);
  const negativeDeleteTriggerRef = useRef<HTMLElement | null>(null);
  const locationRequestRef = useRef<ActivityLocationRequest | null>(null);
  const locationSequenceRef = useRef(0);
  latestLedgerDataRef.current = ledgerData;
  ledgerEpochRef.current = ledgerEpoch;
  mutationVersionRef.current = mutationVersion;
  persistedVersionRef.current = persistedVersion;
  todayKeyRef.current = todayKey;
  isWritableRef.current = isWritable;
  onDeleteTradeRef.current = onDeleteTrade;
  onDeleteCashEventRef.current = onDeleteCashEvent;

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

  const clearLocationRequest = useCallback(() => {
    locationRequestRef.current = null;
    setLocationRequest(null);
  }, []);

  const resetPageState = useCallback(() => {
    resetFilters();
    setExpandedItemId(null);
    setArmedItemId(null);
    clearPendingDelete();
    setPendingNegativeDelete(null);
    clearLocationRequest();
    setFeedback("");
  }, [clearLocationRequest, clearPendingDelete, resetFilters]);

  function findCurrentItem(
    itemId: string,
    itemKind: ActivityKind,
  ): LedgerActivityItem | null {
    const ledger = latestLedgerDataRef.current;
    if (itemKind === "trade") {
      const trade = ledger.trades.find((candidate) => candidate.id === itemId);
      return trade
        ? { kind: "trade", id: trade.id, occurredAt: trade.occurredAt, trade }
        : null;
    }
    const cashEvent = ledger.cashEvents.find(
      (candidate) => candidate.id === itemId,
    );
    return cashEvent
      ? {
          kind: "cash-event",
          id: cashEvent.id,
          occurredAt: cashEvent.occurredAt,
          cashEvent,
        }
      : null;
  }

  function reviewRemoval(item: LedgerActivityItem): string | null {
    if (item.kind === "cash-event") {
      return findCurrentItem(item.id, item.kind)
        ? null
        : "无法删除：没有找到这条现金事实";
    }
    const result = validateTradeRemoval(
      item.id,
      latestLedgerDataRef.current,
    );
    if (result.ok) return null;
    return result.error.code === "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE"
      ? "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出"
      : "无法删除：没有找到这笔交易";
  }

  function projectRemoval(item: LedgerActivityItem) {
    const currentLedger = latestLedgerDataRef.current;
    const nextLedger =
      item.kind === "trade"
        ? {
            ...currentLedger,
            trades: currentLedger.trades.filter(
              (trade) => trade.id !== item.id,
            ),
          }
        : {
            ...currentLedger,
            cashEvents: currentLedger.cashEvents.filter(
              (cashEvent) => cashEvent.id !== item.id,
            ),
          };
    return projectLedgerCashMutation(
      currentLedger,
      nextLedger,
      todayKeyRef.current,
    );
  }

  function applyReviewedDelete(item: LedgerActivityItem) {
    const expectedMutationVersion = mutationVersionRef.current + 1;
    const outcome =
      item.kind === "trade"
        ? onDeleteTradeRef.current(item.id)
        : onDeleteCashEventRef.current(item.id);
    if (outcome !== "applied") {
      clearPendingDelete();
      setPendingNegativeDelete(null);
      setFeedback(
        outcome === "rejected"
          ? "账本当前不可写，删除未执行"
          : `${item.kind === "trade" ? "交易" : "现金事实"}未发生变化，请刷新后重试`,
      );
      return;
    }
    const persisting: PendingDelete = {
      itemId: item.id,
      itemKind: item.kind,
      phase: "persisting",
      expectedMutationVersion,
    };
    pendingDeleteRef.current = persisting;
    setPendingDelete(persisting);
    setPendingNegativeDelete(null);
    setRemainingMs(0);
    setFeedback("删除正在保存…");
  }

  const finalizeDeleteRef = useRef<
    (itemId: string, itemKind: ActivityKind) => void
  >(() => undefined);
  finalizeDeleteRef.current = (itemId, itemKind) => {
    const current = pendingDeleteRef.current;
    if (
      current?.phase !== "countdown" ||
      current.itemId !== itemId ||
      current.itemKind !== itemKind
    ) {
      return;
    }
    clearTimers();
    const item = findCurrentItem(itemId, itemKind);
    if (!item) {
      clearPendingDelete();
      setFeedback(
        `删除倒计时已取消：${itemKind === "trade" ? "交易" : "现金事实"}已不在当前账本中`,
      );
      return;
    }
    const error = reviewRemoval(item);
    if (error) {
      clearPendingDelete();
      setFeedback(error);
      return;
    }
    const projection = projectRemoval(item);
    if (projection.requiresNegativeBalanceConfirmation) {
      clearPendingDelete();
      setPendingNegativeDelete({
        itemId,
        itemKind,
        projection,
        expectedLedgerEpoch: ledgerEpochRef.current,
        expectedMutationVersion: mutationVersionRef.current,
        expectedPersistedVersion: persistedVersionRef.current,
        expectedTodayKey: todayKeyRef.current,
      });
      setFeedback(
        `删除这${itemKind === "trade" ? "笔交易" : "条现金事实"}会使 USDT 现金为负，需要再次确认`,
      );
      return;
    }
    applyReviewedDelete(item);
  };

  useEffect(() => () => clearTimers(), [clearTimers]);
  useEffect(() => {
    if (!active) resetPageState();
  }, [active, resetPageState]);
  useEffect(() => resetPageState(), [ledgerEpoch, resetPageState]);

  useEffect(() => {
    if (!active || !intent) return;
    resetFilters();
    setExpandedItemId(null);
    setArmedItemId(null);
    clearPendingDelete();
    clearLocationRequest();
    setFeedback("");
    if ("filterDate" in intent && intent.filterDate) {
      setExactDate(intent.filterDate);
    }
    if ("expandTradeId" in intent && intent.expandTradeId) {
      setExpandedItemId(intent.expandTradeId);
    }
    if ("locateDate" in intent && intent.locateDate) {
      const request = {
        date: intent.locateDate,
        requestId: locationSequenceRef.current + 1,
      };
      locationSequenceRef.current = request.requestId;
      locationRequestRef.current = request;
      setLocationRequest(request);
    }
    onIntentConsumed();
  }, [
    active,
    clearLocationRequest,
    clearPendingDelete,
    intent,
    onIntentConsumed,
    resetFilters,
  ]);

  const handleLocateComplete = useCallback(
    (requestId: number, result: "found" | "missing") => {
      if (locationRequestRef.current?.requestId !== requestId) return;
      clearLocationRequest();
      if (result === "missing") {
        setFeedback("该日期的交易已发生变化，已显示完整交易列表");
      }
    },
    [clearLocationRequest],
  );

  useEffect(() => {
    if (!active) return;
    const cancelWhenHidden = () => {
      if (!document.hidden) return;
      setArmedItemId(null);
      clearPendingDelete();
      setPendingNegativeDelete(null);
      setFeedback("删除倒计时已取消");
    };
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () =>
      document.removeEventListener("visibilitychange", cancelWhenHidden);
  }, [active, clearPendingDelete]);

  useEffect(() => {
    if (pendingDelete?.phase !== "countdown") return;
    if (findCurrentItem(pendingDelete.itemId, pendingDelete.itemKind)) return;
    clearPendingDelete();
    setFeedback(
      `删除倒计时已取消：${pendingDelete.itemKind === "trade" ? "交易" : "现金事实"}已不在当前账本中`,
    );
  }, [ledgerData.trades, ledgerData.cashEvents, pendingDelete, clearPendingDelete]);

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
      const deletedKind = pendingDelete.itemKind;
      clearPendingDelete();
      setFeedback(deletedKind === "trade" ? "交易已删除" : "现金事实已删除");
    }
  }, [
    clearPendingDelete,
    pendingDelete,
    persistedVersion,
    persistenceStatus,
  ]);

  useEffect(() => {
    if (feedback !== "交易已删除" && feedback !== "现金事实已删除") return;
    const timeout = setTimeout(() => setFeedback(""), SUCCESS_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [feedback]);

  function armDelete(item: LedgerActivityItem) {
    if (
      !isWritable ||
      pendingDelete?.phase === "persisting" ||
      pendingNegativeDelete
    ) {
      return;
    }
    clearPendingDelete();
    setExpandedItemId(null);
    setArmedItemId(item.id);
    setFeedback("");
  }

  function confirmDelete(item: LedgerActivityItem) {
    if (!isWritable || armedItemId !== item.id) return;
    const current = findCurrentItem(item.id, item.kind);
    const error = current ? reviewRemoval(current) : reviewRemoval(item);
    if (error || !current) {
      setArmedItemId(null);
      setFeedback(error ?? "无法删除：事实已不在当前账本中");
      return;
    }
    negativeDeleteTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const deadline = Date.now() + DELETE_DELAY_MS;
    const countdown: PendingDelete = {
      itemId: item.id,
      itemKind: item.kind,
      phase: "countdown",
      deadline,
    };
    pendingDeleteRef.current = countdown;
    setPendingDelete(countdown);
    setRemainingMs(DELETE_DELAY_MS);
    setArmedItemId(null);
    setFeedback("5 秒内可撤回，倒计时结束后会再次检查账本事实");
    intervalRef.current = setInterval(() => {
      setRemainingMs(Math.max(0, deadline - Date.now()));
    }, 100);
    timeoutRef.current = setTimeout(
      () => finalizeDeleteRef.current(item.id, item.kind),
      DELETE_DELAY_MS,
    );
  }

  function confirmNegativeDelete() {
    const pending = pendingNegativeDelete;
    if (!pending) return;
    if (
      !isWritableRef.current ||
      ledgerEpochRef.current !== pending.expectedLedgerEpoch ||
      mutationVersionRef.current !== pending.expectedMutationVersion ||
      persistedVersionRef.current !== pending.expectedPersistedVersion ||
      todayKeyRef.current !== pending.expectedTodayKey
    ) {
      setPendingNegativeDelete(null);
      setFeedback("旧确认已失效：账本或保存状态已变化，请重新删除");
      return;
    }
    const item = findCurrentItem(pending.itemId, pending.itemKind);
    const error = item ? reviewRemoval(item) : "无法删除：事实已不在当前账本中";
    if (!item || error) {
      setPendingNegativeDelete(null);
      setFeedback(error ?? "无法删除：事实已不在当前账本中");
      return;
    }
    const projection = projectRemoval(item);
    if (
      !projection.requiresNegativeBalanceConfirmation ||
      projection.currentBalance !== pending.projection.currentBalance ||
      projection.delta !== pending.projection.delta ||
      projection.nextBalance !== pending.projection.nextBalance ||
      projection.deficit !== pending.projection.deficit
    ) {
      setPendingNegativeDelete(null);
      setFeedback("旧确认已失效：现金影响已变化，请重新删除");
      return;
    }
    applyReviewedDelete(item);
  }

  const allItems = useMemo(
    () => buildLedgerActivityItems(ledgerData),
    [ledgerData],
  );
  const filteredItems = useMemo(() => {
    const earliestDate =
      timeFilter === "7d"
        ? addLedgerDays(todayKey, -6)
        : timeFilter === "1y"
          ? addLedgerDays(todayKey, -364)
          : undefined;
    return filterLedgerActivityItems(allItems, {
      type: typeFilter,
      asset: assetFilter,
      ...(exactDate ? { exactDate } : {}),
      ...(timeFilter === "today" ? { exactDate: todayKey } : {}),
      ...(earliestDate ? { earliestDate, latestDate: todayKey } : {}),
    });
  }, [allItems, assetFilter, exactDate, timeFilter, todayKey, typeFilter]);

  const assetOptions = ledgerData.assets
    .map((asset) => asset.symbol)
    .sort((left, right) => left.localeCompare(right));
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
  const typeLabel = activityFilterLabel(typeFilter);

  return (
    <section
      aria-label="交易工作区"
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="transactions"
    >
      <SurfaceCard className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">统一流水</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
              共 {allItems.length} 条交易与现金事实；筛选只作用于当前解锁会话。
            </p>
          </div>
          <p className="rounded-full bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-muted)]">
            当前显示 {filteredItems.length} 笔
          </p>
        </div>
      </SurfaceCard>

      <SurfaceCard className="sticky top-0 z-20 p-4">
        <div className="grid gap-3 sm:grid-cols-2 min-[1100px]:grid-cols-4">
          <FilterSelect
            label="时间范围"
            onChange={(value) => setTimeFilter(value as TimeFilter)}
            options={[
              ["all", "全部时间"],
              ["today", "今天"],
              ["7d", "最近 7 天"],
              ["1y", "最近 1 年"],
            ]}
            value={timeFilter}
          />
          <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
            准确日期
            <input
              className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 text-sm text-[var(--ledger-ink)]"
              onChange={(event) => setExactDate(event.target.value)}
              type="date"
              value={exactDate}
            />
          </label>
          <FilterSelect
            label="资产筛选"
            onChange={setAssetFilter}
            options={[
              ["all", "全部资产"],
              ["USDT", "现金 USDT"],
              ...assetOptions.map((asset) => [asset, asset] as const),
            ]}
            value={assetFilter}
          />
          <FilterSelect
            label="类型筛选"
            onChange={(value) =>
              setTypeFilter(value as LedgerActivityTypeFilter)
            }
            options={[
              ["all", "全部类型"],
              ["buy", "买入"],
              ["sell", "卖出"],
              ["deposit", "入金"],
              ["withdrawal", "出金"],
              ["external-expense", "外部支出"],
              ["balance-adjustment", "余额校准"],
            ]}
            value={typeFilter}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ledger-muted)]">
          <p>
            时间：{timeLabel}｜日期：{exactDate || "全部"}｜资产：
            {assetFilter === "all"
              ? "全部"
              : assetFilter === "USDT"
                ? "现金 USDT"
                : assetFilter}
            ｜类型：{typeLabel}
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
            feedback === "交易已删除" || feedback === "现金事实已删除"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 motion-safe:animate-[ledger-feedback-fade_4s_ease-in_forwards]"
              : feedback.includes("无法") || feedback.includes("尚未保存")
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {feedback}
        </p>
      ) : null}

      <SurfaceCard className="min-w-0 p-0">
        <ActivityTable
          deleteDisabled={!isWritable}
          deleteState={{
            armedItemId,
            pendingItemId: pendingDelete?.itemId ?? null,
            pendingPhase: pendingDelete?.phase ?? null,
            remainingMs,
          }}
          expandedItemId={expandedItemId}
          items={filteredItems}
          locateRequest={locationRequest}
          onArmDelete={armDelete}
          onCancelDelete={() => setArmedItemId(null)}
          onConfirmDelete={confirmDelete}
          onExpandedItemIdChange={setExpandedItemId}
          onLocateComplete={handleLocateComplete}
          onUndoDelete={() => {
            clearPendingDelete();
            setFeedback("已撤回，账本没有变化");
          }}
          todayKey={todayKey}
        />
      </SurfaceCard>

      {pendingNegativeDelete ? (
        <NegativeCashConfirmationDialog
          confirmLabel="确认并删除"
          onCancel={() => {
            setPendingNegativeDelete(null);
            setFeedback("已取消，账本没有变化");
          }}
          onConfirm={confirmNegativeDelete}
          projection={pendingNegativeDelete.projection}
          title={`确认删除${
            pendingNegativeDelete.itemKind === "trade" ? "交易" : "现金事实"
          }后的负现金`}
          triggerRef={negativeDeleteTriggerRef}
        />
      ) : null}
    </section>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}>) {
  return (
    <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
      {label}
      <select
        className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 text-sm text-[var(--ledger-ink)]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function activityFilterLabel(type: LedgerActivityTypeFilter): string {
  return {
    all: "全部",
    buy: "买入",
    sell: "卖出",
    deposit: "入金",
    withdrawal: "出金",
    "external-expense": "外部支出",
    "balance-adjustment": "余额校准",
  }[type];
}
