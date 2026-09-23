import type { RefObject } from "react";
import type { LedgerData } from "@/core/models";
import type { ActivityKind } from "./transactionsWorkspaceTypes";
import type { LedgerActivityItem } from "@/features/activity";
import type { useLanguage } from "@/ui";
import { validateTradeRemoval } from "@/features/trades";
import { projectLedgerCashMutation } from "@/features/cash";

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
