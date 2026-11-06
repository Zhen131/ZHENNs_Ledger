/**
 * 这个文件管交易页删一条流水的全过程。
 * 先点两下，再倒数可撤回，最后存盘。
 * 删一笔买卖会不会弄坏后面的账，由 `features/trades` 判断；现金怎么变由 `features/cash` 算。
 * 不显然的决定：删了会让现金变负的，要再确认一次。
 * 确认时账本变过，这次确认就作废。
 * 2026-08-19 定（W14 01A 第二节；W14 01B 第 6.2 节）。
 */
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  DecimalString,
  LedgerData,
} from "@/core/models";
import type {
  ActivityKind,
  PendingDelete,
  PendingNegativeDelete,
} from "./transactionsWorkspaceTypes";
import type { LedgerActivityItem } from "@/features/activity";
import type { Translate } from "@/ui";
import { DELETE_DELAY_MS, validateTradeRemoval } from "@/features/trades";
import { projectLedgerCashMutation } from "@/features/cash";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app/persistence";

type FindCurrentItemDeps = {
  latestLedgerDataRef: RefObject<LedgerData>;
};

/**
 * 这个函数回答：这条流水现在还在不在账本里？
 * 在就交回最新的那条；已经没了答 null。不会出错。
 */
export function doFindCurrentItem(
  deps: FindCurrentItemDeps,
  itemId: string,
  itemKind: ActivityKind,
): LedgerActivityItem | null {
  const {
    latestLedgerDataRef,
  } = deps;
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

type ReviewRemovalDeps = {
  findCurrentItem: (itemId: string, itemKind: ActivityKind) => LedgerActivityItem | null;
  latestLedgerDataRef: RefObject<LedgerData>;
  t: Translate;
};

/**
 * 这个函数回答：这条流水现在能不能删？能删答 null，不能删答一句提示。
 * 买卖要看删了会不会让后面的卖出没东西可卖。
 * 举例：买 0.1 BTC 后卖 0.04 BTC，删那笔买入 → 答不能删。
 * 提示是「这笔交易支撑了后续卖出」那句。
 * 现金记录只看它还在不在。不会出错。
 */
export function doReviewRemoval(
  deps: ReviewRemovalDeps,
  item: LedgerActivityItem,
): string | null {
  const {
    findCurrentItem,
    latestLedgerDataRef,
    t,
  } = deps;
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

type ProjectRemovalDeps = {
  latestLedgerDataRef: RefObject<LedgerData>;
  todayKeyRef: RefObject<string>;
};

/**
 * 这个函数回答：删掉这条之后，USDT 现金会变成多少？
 * 举例：现金 1000 USDT，删一笔 2000 USDT 的入金 → 答变成 -1000，要额外确认。
 * 不会出错。
 */
export function doProjectRemoval(
  deps: ProjectRemovalDeps,
  item: LedgerActivityItem,
) {
  const {
    latestLedgerDataRef,
    todayKeyRef,
  } = deps;
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

type ApplyReviewedDeleteDeps = {
  clearPendingDelete: () => void;
  mutationVersionRef: RefObject<number>;
  onDeleteCashEventRef: RefObject<(cashEventId: string) => ApplyLedgerActionResult>;
  onDeleteTradeRef: RefObject<(tradeId: string) => ApplyLedgerActionResult>;
  pendingDeleteRef: RefObject<PendingDelete | null>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingDelete: Dispatch<SetStateAction<PendingDelete | null>>;
  setPendingNegativeDelete: Dispatch<SetStateAction<PendingNegativeDelete | null>>;
  setRemainingMs: Dispatch<SetStateAction<number>>;
  t: Translate;
};

/**
 * 这个函数真正发出删除，然后进入「等存盘」那一步。
 * 账本拒绝或没变化时，取消这次删除并说明原因。
 * 不会出错。
 */
export function doApplyReviewedDelete(
  deps: ApplyReviewedDeleteDeps,
  item: LedgerActivityItem,
) {
  const {
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
  } = deps;
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

type ArmDeleteDeps = {
  clearPendingDelete: () => void;
  isWritable: boolean;
  pendingDelete: PendingDelete | null;
  pendingNegativeDelete: PendingNegativeDelete | null;
  setArmedItemId: Dispatch<SetStateAction<string | null>>;
  setExpandedItemId: Dispatch<SetStateAction<string | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
};

/**
 * 这个函数处理第一次点删除：标成「再点一次就删」。
 * 账本不能写，或别的删除还没完，就什么都不做。
 * 不会出错。
 */
export function doArmDelete(
  deps: ArmDeleteDeps,
  item: LedgerActivityItem,
) {
  const {
    clearPendingDelete,
    isWritable,
    pendingDelete,
    pendingNegativeDelete,
    setArmedItemId,
    setExpandedItemId,
    setFeedback,
  } = deps;
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

type ConfirmDeleteDeps = {
  armedItemId: string | null;
  finalizeDeleteRef: RefObject<(itemId: string, itemKind: ActivityKind) => void>;
  findCurrentItem: (itemId: string, itemKind: ActivityKind) => LedgerActivityItem | null;
  intervalRef: RefObject<ReturnType<typeof setInterval> | null>;
  isWritable: boolean;
  negativeDeleteTriggerRef: RefObject<HTMLElement | null>;
  pendingDeleteRef: RefObject<PendingDelete | null>;
  reviewRemoval: (item: LedgerActivityItem) => string | null;
  setArmedItemId: Dispatch<SetStateAction<string | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingDelete: Dispatch<SetStateAction<PendingDelete | null>>;
  setRemainingMs: Dispatch<SetStateAction<number>>;
  t: Translate;
  timeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
};

/**
 * 这个函数处理第二次点删除：先查能不能删，再开始倒数。
 * 倒数时长是 `DELETE_DELAY_MS`（5 秒），期间可以撤回。
 * 举例：12:00:00 点第二下 → 12:00:05 才真删，之前点撤回就不删。
 * 倒数结束才真的删。不能删时显示原因，不开始倒数。
 * 不会出错。
 */
export function doConfirmDelete(
  deps: ConfirmDeleteDeps,
  item: LedgerActivityItem,
) {
  const {
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
  } = deps;
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

type ConfirmNegativeDeleteDeps = {
  applyReviewedDelete: (item: LedgerActivityItem) => void;
  findCurrentItem: (itemId: string, itemKind: ActivityKind) => LedgerActivityItem | null;
  isWritableRef: RefObject<boolean>;
  ledgerEpochRef: RefObject<number>;
  mutationVersionRef: RefObject<number>;
  pendingNegativeDelete: PendingNegativeDelete | null;
  persistedVersionRef: RefObject<number>;
  projectRemoval: (item: LedgerActivityItem) => Readonly<{ currentBalance: DecimalString; delta: DecimalString; nextBalance: DecimalString; deficit: DecimalString; requiresNegativeBalanceConfirmation: boolean; }>;
  reviewRemoval: (item: LedgerActivityItem) => string | null;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingNegativeDelete: Dispatch<SetStateAction<PendingNegativeDelete | null>>;
  t: Translate;
  todayKeyRef: RefObject<string>;
};

/**
 * 这个函数处理用户确认「删了现金会变负也要删」。
 * 确认前再对一遍：账本、存盘进度、日期都没变。
 * 当时算的现金变化也要没变。
 * 举例：确认框开着时又记了一笔 → 作废这次确认，提示重新来。
 * 都对上才真的删。不会出错。
 */
export function doConfirmNegativeDelete(
  deps: ConfirmNegativeDeleteDeps,
) {
  const {
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
  } = deps;
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

type HiddenCancelEffectDeps = {
  active: boolean;
  clearPendingDelete: () => void;
  setArmedItemId: Dispatch<SetStateAction<string | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingNegativeDelete: Dispatch<SetStateAction<PendingNegativeDelete | null>>;
  t: Translate;
};

/**
 * 这个函数在页面切到后台时，取消正在进行的删除。
 * 用户看不见倒数，就不该让它悄悄删掉。
 * 返回一个收拾的函数。不会出错。
 */
export function runHiddenCancelEffect(
  deps: HiddenCancelEffectDeps,
) {
  const {
    active,
    clearPendingDelete,
    setArmedItemId,
    setFeedback,
    setPendingNegativeDelete,
    t,
  } = deps;
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
}

type DeletionPersistenceEffectDeps = {
  clearPendingDelete: () => void;
  pendingDelete: PendingDelete | null;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  setFeedback: Dispatch<SetStateAction<string>>;
  t: Translate;
};

/**
 * 这个函数在删除进入「等存盘」后，盯着存盘结果。
 * 存好了显示「已删除」，存失败显示「没存进去」。
 * 不会出错。
 */
export function runDeletionPersistenceEffect(
  deps: DeletionPersistenceEffectDeps,
) {
  const {
    clearPendingDelete,
    pendingDelete,
    persistedVersion,
    persistenceStatus,
    setFeedback,
    t,
  } = deps;
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
}
