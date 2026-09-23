import type { RefObject } from "react";
import type { LedgerData } from "@/core/models";
import type { ActivityKind } from "./transactionsWorkspaceTypes";
import type { LedgerActivityItem } from "@/features/activity";

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
