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
import { NegativeCashConfirmationDialog } from "@/features/cash/ui";
import { SurfaceCard, useLanguage } from "@/ui";
import type { LedgerWorkspaceIntent } from "./useLedgerWorkspaceSession";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app/persistence";
import {
  SUCCESS_FEEDBACK_MS,
  activityFilterLabel,
} from "./transactionsWorkspaceHelpers";
import type {
  TimeFilter,
  ActivityKind,
  PendingDelete,
  PendingNegativeDelete,
  ActivityLocationRequest,
} from "./transactionsWorkspaceTypes";
import {
  doApplyReviewedDelete,
  doArmDelete,
  doConfirmDelete,
  doConfirmNegativeDelete,
  doFindCurrentItem,
  doProjectRemoval,
  doReviewRemoval,
  runDeletionPersistenceEffect,
  runHiddenCancelEffect,
} from "./transactionsWorkspaceDeletion";
import { runIntentEffect } from "./transactionsWorkspaceIntent";
import { TransactionsWorkspaceActivityCard } from "./TransactionsWorkspaceActivityCard";
import { TransactionsWorkspaceFilterCard } from "./TransactionsWorkspaceFilterCard";

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
    return doFindCurrentItem(
      {
        latestLedgerDataRef,
      },
      itemId,
      itemKind,
    );
  }

  function reviewRemoval(item: LedgerActivityItem): string | null {
    return doReviewRemoval(
      {
        findCurrentItem,
        latestLedgerDataRef,
        t,
      },
      item,
    );
  }

  function projectRemoval(item: LedgerActivityItem) {
    return doProjectRemoval(
      {
        latestLedgerDataRef,
        todayKeyRef,
      },
      item,
    );
  }

  function applyReviewedDelete(item: LedgerActivityItem) {
    return doApplyReviewedDelete(
      {
        clearPendingDelete,
        mutationVersionRef,
        onDeleteCashEventRef,
        onDeleteTradeRef,
        pendingDeleteRef,
        setFeedback,
        setPendingDelete,
        setPendingNegativeDelete,
        setRemainingMs,
        t,
      },
      item,
    );
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
    return runIntentEffect(
      {
        active,
        clearLocationRequest,
        clearPendingDelete,
        intent,
        locationRequestRef,
        locationSequenceRef,
        onIntentConsumed,
        resetFilters,
        setArmedItemId,
        setExactDate,
        setExpandedItemId,
        setFeedback,
        setLocationRequest,
      },
    );
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
    return runHiddenCancelEffect(
      {
        active,
        clearPendingDelete,
        setArmedItemId,
        setFeedback,
        setPendingNegativeDelete,
        t,
      },
    );
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
    return runDeletionPersistenceEffect(
      {
        clearPendingDelete,
        pendingDelete,
        persistedVersion,
        persistenceStatus,
        setFeedback,
        t,
      },
    );
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
    return doArmDelete(
      {
        clearPendingDelete,
        isWritable,
        pendingDelete,
        pendingNegativeDelete,
        setArmedItemId,
        setExpandedItemId,
        setFeedback,
      },
      item,
    );
  }

  function confirmDelete(item: LedgerActivityItem) {
    return doConfirmDelete(
      {
        armedItemId,
        finalizeDeleteRef,
        findCurrentItem,
        intervalRef,
        isWritable,
        negativeDeleteTriggerRef,
        pendingDeleteRef,
        reviewRemoval,
        setArmedItemId,
        setFeedback,
        setPendingDelete,
        setRemainingMs,
        t,
        timeoutRef,
      },
      item,
    );
  }

  function confirmNegativeDelete() {
    return doConfirmNegativeDelete(
      {
        applyReviewedDelete,
        findCurrentItem,
        isWritableRef,
        ledgerEpochRef,
        mutationVersionRef,
        pendingNegativeDelete,
        persistedVersionRef,
        projectRemoval,
        reviewRemoval,
        setFeedback,
        setPendingNegativeDelete,
        t,
        todayKeyRef,
      },
    );
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

      <TransactionsWorkspaceFilterCard
        assetFilter={assetFilter}
        assetOptions={assetOptions}
        exactDate={exactDate}
        hasFilters={hasFilters}
        resetFilters={resetFilters}
        setAssetFilter={setAssetFilter}
        setCurrentPage={setCurrentPage}
        setExactDate={setExactDate}
        setTimeFilter={setTimeFilter}
        setTypeFilter={setTypeFilter}
        t={t}
        timeFilter={timeFilter}
        timeLabel={timeLabel}
        typeFilter={typeFilter}
        typeLabel={typeLabel}
      />

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

      <TransactionsWorkspaceActivityCard
        armDelete={armDelete}
        armedItemId={armedItemId}
        clearPendingDelete={clearPendingDelete}
        confirmDelete={confirmDelete}
        currentPage={currentPage}
        currentPageItems={currentPageItems}
        expandedItemId={expandedItemId}
        filteredItems={filteredItems}
        handleLocateComplete={handleLocateComplete}
        isWritable={isWritable}
        locateRequestForCurrentPage={locateRequestForCurrentPage}
        pendingDelete={pendingDelete}
        remainingMs={remainingMs}
        sequenceByItemKey={sequenceByItemKey}
        setArmedItemId={setArmedItemId}
        setCurrentPage={setCurrentPage}
        setExpandedItemId={setExpandedItemId}
        setFeedback={setFeedback}
        t={t}
        todayKey={todayKey}
        totalPages={totalPages}
      />

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
