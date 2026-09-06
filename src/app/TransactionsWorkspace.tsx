"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { LedgerData } from "@/core/models";
import { addLedgerDays, getLedgerDateKey } from "@/core/shared";
import {
  buildLedgerActivityItems,
  filterLedgerActivityItems,
  getActivityPageCount,
  getActivityPageItems,
  ACTIVITY_PAGE_SIZE,
  type LedgerActivityItem,
  type LedgerActivityTypeFilter,
} from "@/features/activity";
import { ActivityTable } from "@/features/activity/ui";
import { projectLedgerCashMutation } from "@/features/cash";
import { NegativeCashConfirmationDialog } from "@/features/cash/ui";
import { validateTradeRemoval } from "@/features/trades";
import { SurfaceCard, useLanguage } from "@/ui";
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
  const { t } = useLanguage();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [exactDate, setExactDate] = useState("");
  const [assetFilter, setAssetFilter] = useState("all");
  const [typeFilter, setTypeFilter] =
    useState<LedgerActivityTypeFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
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
    setCurrentPage(1);
  }, []);

  const clearLocationRequest = useCallback(() => {
    locationRequestRef.current = null;
    setLocationRequest(null);
  }, []);

  const resetPageState = useCallback(() => {
    resetFilters();
    setCurrentPage(1);
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
        : t("transactions.delete.cashFactMissing");
    }
    const result = validateTradeRemoval(
      item.id,
      latestLedgerDataRef.current,
    );
    if (result.ok) return null;
    return result.error.code === "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE"
      ? t("transactions.delete.tradeHasDependents")
      : t("transactions.delete.tradeMissing");
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
          ? t("transactions.delete.ledgerNotWritable")
          : `${item.kind === "trade" ? t("transactions.item.trade") : t("transactions.item.cashFact")}${t("transactions.delete.unchangedSuffix")}`,
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
    setFeedback(t("transactions.delete.saving"));
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
        `${t("transactions.delete.countdownCancelledPrefix")}${itemKind === "trade" ? t("transactions.item.trade") : t("transactions.item.cashFact")}${t("transactions.delete.noLongerInLedger")}`,
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
        `${t("transactions.delete.negativePrefix")}${itemKind === "trade" ? t("transactions.item.tradeWithMeasure") : t("transactions.item.cashFactWithMeasure")}${t("transactions.delete.negativeSuffix")}`,
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
        setFeedback(t("transactions.locate.changed"));
      }
    },
    [clearLocationRequest, t],
  );

  useEffect(() => {
    if (!active) return;
    const cancelWhenHidden = () => {
      if (!document.hidden) return;
      setArmedItemId(null);
      clearPendingDelete();
      setPendingNegativeDelete(null);
      setFeedback(t("transactions.delete.countdownCancelled"));
    };
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () =>
      document.removeEventListener("visibilitychange", cancelWhenHidden);
  }, [active, clearPendingDelete, t]);

  useEffect(() => {
    if (pendingDelete?.phase !== "countdown") return;
    if (findCurrentItem(pendingDelete.itemId, pendingDelete.itemKind)) return;
    clearPendingDelete();
    setFeedback(
      `${t("transactions.delete.countdownCancelledPrefix")}${pendingDelete.itemKind === "trade" ? t("transactions.item.trade") : t("transactions.item.cashFact")}${t("transactions.delete.noLongerInLedger")}`,
    );
  }, [ledgerData.trades, ledgerData.cashEvents, pendingDelete, clearPendingDelete, t]);

  useEffect(() => {
    if (pendingDelete?.phase !== "persisting") return;
    if (persistenceStatus === "error") {
      setFeedback(t("transactions.delete.notPersisted"));
      return;
    }
    if (
      persistenceStatus === "saved" &&
      persistedVersion >= pendingDelete.expectedMutationVersion
    ) {
      const deletedKind = pendingDelete.itemKind;
      clearPendingDelete();
      setFeedback(deletedKind === "trade" ? t("transactions.delete.tradeDeleted") : t("transactions.delete.cashFactDeleted"));
    }
  }, [
    clearPendingDelete,
    pendingDelete,
    persistedVersion,
    persistenceStatus,
    t,
  ]);

  useEffect(() => {
    if (feedback !== t("transactions.delete.tradeDeleted") && feedback !== t("transactions.delete.cashFactDeleted")) return;
    const timeout = setTimeout(() => setFeedback(""), SUCCESS_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [feedback, t]);

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
      setFeedback(error ?? t("transactions.delete.factMissing"));
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
    setFeedback(t("transactions.delete.undoWindow"));
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
      setFeedback(t("transactions.delete.staleLedgerConfirmation"));
      return;
    }
    const item = findCurrentItem(pending.itemId, pending.itemKind);
    const error = item ? reviewRemoval(item) : t("transactions.delete.factMissing");
    if (!item || error) {
      setPendingNegativeDelete(null);
      setFeedback(error ?? t("transactions.delete.factMissing"));
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
      setFeedback(t("transactions.delete.staleCashConfirmation"));
      return;
    }
    applyReviewedDelete(item);
  }

  const { allItems, sequenceByItemKey } = useMemo(() => {
    const items = buildLedgerActivityItems(ledgerData);
    return {
      allItems: items,
      sequenceByItemKey: new Map(
        items.map((item, index) => [
          `${item.kind}:${item.id}`,
          items.length - index,
        ]),
      ),
    };
  }, [ledgerData]);
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
  const totalPages = getActivityPageCount(filteredItems.length);
  const currentPageItems = getActivityPageItems(filteredItems, currentPage);
  const locateTargetIndex = useMemo(
    () =>
      locationRequest
        ? filteredItems.findIndex(
            (item) => getLedgerDateKey(item.occurredAt) === locationRequest.date,
          )
        : -1,
    [filteredItems, locationRequest],
  );
  const locateTargetPage =
    locateTargetIndex < 0
      ? null
      : Math.floor(locateTargetIndex / ACTIVITY_PAGE_SIZE) + 1;
  const locateRequestForCurrentPage =
    locationRequest &&
    (locateTargetPage === null || locateTargetPage === currentPage)
      ? locationRequest
      : null;

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (locateTargetPage !== null) setCurrentPage(locateTargetPage);
  }, [locateTargetPage]);

  const assetOptions = ledgerData.assets
    .map((asset) => asset.symbol)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const hasFilters =
    timeFilter !== "all" ||
    exactDate !== "" ||
    assetFilter !== "all" ||
    typeFilter !== "all";
  const timeLabel = {
    all: t("transactions.time.all"),
    today: t("transactions.time.today"),
    "7d": t("transactions.time.7d"),
    "1y": t("transactions.time.1y"),
  }[timeFilter];
  const typeLabel = activityFilterLabel(typeFilter, t);

  return (
    <section
      aria-label={t("transactions.workspace.ariaLabel")}
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="transactions"
    >
      <SurfaceCard className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("transactions.heading")}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
              {t("transactions.summary.prefix")} {allItems.length} {t("transactions.summary.suffix")}
            </p>
          </div>
          <p className="rounded-full bg-[var(--ledger-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--ledger-muted)]">
            {t("transactions.currentlyShowing")} {filteredItems.length} {t("transactions.itemsMeasure")}
          </p>
        </div>
      </SurfaceCard>

      <SurfaceCard className="sticky top-0 z-20 p-4">
        <div className="grid gap-3 sm:grid-cols-2 min-[1100px]:grid-cols-4">
          <FilterSelect
            label={t("transactions.filter.time")}
            onChange={(value) => {
              setTimeFilter(value as TimeFilter);
              setCurrentPage(1);
            }}
            options={[
              ["all", t("transactions.time.allTime")],
              ["today", t("transactions.time.today")],
              ["7d", t("transactions.time.7d")],
              ["1y", t("transactions.time.1y")],
            ]}
            value={timeFilter}
          />
          <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
            {t("transactions.filter.exactDate")}
            <input
              className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 text-sm text-[var(--ledger-ink)]"
              onChange={(event) => {
                setExactDate(event.target.value);
                setCurrentPage(1);
              }}
              type="date"
              value={exactDate}
            />
          </label>
          <FilterSelect
            label={t("transactions.filter.asset")}
            onChange={(value) => {
              setAssetFilter(value);
              setCurrentPage(1);
            }}
            options={[
              ["all", t("transactions.filter.allAssets")],
              ["USDT", t("transactions.filter.cashUsdt")],
              ...assetOptions.map((asset) => [asset, asset] as const),
            ]}
            value={assetFilter}
          />
          <FilterSelect
            label={t("transactions.filter.type")}
            onChange={(value) => {
              setTypeFilter(value as LedgerActivityTypeFilter);
              setCurrentPage(1);
            }}
            options={[
              ["all", t("transactions.filter.allTypes")],
              ["buy", t("trades.type.buy")],
              ["sell", t("trades.type.sell")],
              ["deposit", t("transactions.type.deposit")],
              ["withdrawal", t("transactions.type.withdrawal")],
              ["external-expense", t("transactions.type.externalExpense")],
              ["balance-adjustment", t("transactions.type.balanceAdjustment")],
            ]}
            value={typeFilter}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ledger-muted)]">
          <p>
            {t("transactions.activeFilters.time")}{timeLabel}{t("transactions.activeFilters.date")}{exactDate || t("transactions.time.all")}{t("transactions.activeFilters.asset")}
            {assetFilter === "all"
              ? t("transactions.time.all")
              : assetFilter === "USDT"
                ? t("transactions.filter.cashUsdt")
                : assetFilter}
            {t("transactions.activeFilters.type")}{typeLabel}
          </p>
          {hasFilters ? (
            <button
              className="font-semibold text-[var(--ledger-accent-strong)]"
              onClick={resetFilters}
              type="button"
            >
              {t("transactions.filter.clear")}
            </button>
          ) : null}
        </div>
      </SurfaceCard>

      {feedback ? (
        <p
          aria-live="polite"
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback === t("transactions.delete.tradeDeleted") || feedback === t("transactions.delete.cashFactDeleted")
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 motion-safe:animate-[ledger-feedback-fade_4s_ease-in_forwards]"
              : feedback.includes(t("transactions.feedback.errorPrefix")) || feedback.includes(t("transactions.feedback.notPersistedFragment"))
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
          items={currentPageItems}
          locateRequest={locateRequestForCurrentPage}
          onArmDelete={armDelete}
          onCancelDelete={() => setArmedItemId(null)}
          onConfirmDelete={confirmDelete}
          onExpandedItemIdChange={setExpandedItemId}
          onLocateComplete={handleLocateComplete}
          onUndoDelete={() => {
            clearPendingDelete();
            setFeedback(t("transactions.delete.undone"));
          }}
          sequenceByItemKey={sequenceByItemKey}
          todayKey={todayKey}
        />
        {filteredItems.length > 0 ? (
          <div
            aria-label={t("transactions.pagination.ariaLabel")}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ledger-border)] px-4 py-3 text-sm"
          >
            <p className="text-[var(--ledger-muted)]">
              {t("transactions.pagination.totalPrefix")} {filteredItems.length} {t("transactions.pagination.totalMiddle")} {currentPage} / {totalPages} {t("transactions.pagination.pageSuffix")}
            </p>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={currentPage === 1}
                onClick={() => {
                  setExpandedItemId(null);
                  setCurrentPage((page) => page - 1);
                }}
                type="button"
              >
                {t("transactions.pagination.previous")}
              </button>
              <button
                className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={currentPage === totalPages}
                onClick={() => {
                  setExpandedItemId(null);
                  setCurrentPage((page) => page + 1);
                }}
                type="button"
              >
                {t("transactions.pagination.next")}
              </button>
            </div>
          </div>
        ) : null}
      </SurfaceCard>

      {pendingNegativeDelete ? (
        <NegativeCashConfirmationDialog
          confirmLabel={t("transactions.delete.confirm")}
          onCancel={() => {
            setPendingNegativeDelete(null);
            setFeedback(t("transactions.delete.cancelled"));
          }}
          onConfirm={confirmNegativeDelete}
          projection={pendingNegativeDelete.projection}
          title={`${t("transactions.delete.negativeTitlePrefix")}${
            pendingNegativeDelete.itemKind === "trade" ? t("transactions.item.trade") : t("transactions.item.cashFact")
          }${t("transactions.delete.negativeTitleSuffix")}`}
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

function activityFilterLabel(
  type: LedgerActivityTypeFilter,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  return {
    all: t("transactions.time.all"),
    buy: t("trades.type.buy"),
    sell: t("trades.type.sell"),
    deposit: t("transactions.type.deposit"),
    withdrawal: t("transactions.type.withdrawal"),
    "external-expense": t("transactions.type.externalExpense"),
    "balance-adjustment": t("transactions.type.balanceAdjustment"),
  }[type];
}
