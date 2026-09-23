import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type { LedgerData } from "@/core/models";
import type {
  ActivityKind,
  PendingDelete,
  PendingNegativeDelete,
} from "./transactionsWorkspaceTypes";
import type { LedgerActivityItem } from "@/features/activity";
import type { useLanguage } from "@/ui";
import { validateTradeRemoval } from "@/features/trades";
import { projectLedgerCashMutation } from "@/features/cash";
import type { ApplyLedgerActionResult } from "@/app/persistence";
import { DELETE_DELAY_MS } from "./transactionsWorkspaceHelpers";

type FindCurrentItemDeps = {
  latestLedgerDataRef: RefObject<LedgerData>;
};

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
  t: ReturnType<typeof useLanguage>["t"];
};

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
  t: ReturnType<typeof useLanguage>["t"];
};

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
  t: ReturnType<typeof useLanguage>["t"];
  timeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
};

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
