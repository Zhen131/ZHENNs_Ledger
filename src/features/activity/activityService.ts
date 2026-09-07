import type { CashEvent, LedgerData, Trade } from "@/core/models";
import {
  compareLedgerFactOrder,
  getLedgerDateKey,
} from "@/core/shared";

export type LedgerActivityItem =
  | Readonly<{
      kind: "trade";
      id: string;
      occurredAt: string;
      trade: Trade;
    }>
  | Readonly<{
      kind: "cash-event";
      id: string;
      occurredAt: string;
      cashEvent: CashEvent;
    }>;

export type LedgerActivityTypeFilter =
  | "all"
  | "buy"
  | "sell"
  | "deposit"
  | "withdrawal"
  | "external-expense"
  | "balance-adjustment";

export type LedgerActivityFilter = Readonly<{
  type?: LedgerActivityTypeFilter;
  asset?: "all" | "USDT" | string;
  exactDate?: string;
  earliestDate?: string;
  latestDate?: string;
}>;

export function buildLedgerActivityItems(
  ledgerData: Pick<LedgerData, "trades" | "cashEvents">,
): LedgerActivityItem[] {
  return [
    ...ledgerData.trades.map(projectTrade),
    ...ledgerData.cashEvents.map(projectCashEvent),
  ].sort(compareLedgerActivityItemsDescending);
}

export function filterLedgerActivityItems(
  items: readonly LedgerActivityItem[],
  filter: LedgerActivityFilter,
): LedgerActivityItem[] {
  const type = filter.type ?? "all";
  const asset = filter.asset ?? "all";
  return items.filter((item) => {
    const date = getLedgerDateKey(item.occurredAt);
    if (filter.exactDate && date !== filter.exactDate) return false;
    if (filter.earliestDate && date < filter.earliestDate) return false;
    if (filter.latestDate && date > filter.latestDate) return false;
    if (type !== "all" && getActivityType(item) !== type) return false;
    if (asset === "all") return true;
    if (asset === "USDT") return item.kind === "cash-event";
    return item.kind === "trade" && item.trade.assetSymbol === asset;
  });
}

export function getActivityType(
  item: LedgerActivityItem,
): Exclude<LedgerActivityTypeFilter, "all"> {
  return item.kind === "trade" ? item.trade.type : item.cashEvent.type;
}

export function compareLedgerActivityItemsDescending(
  left: LedgerActivityItem,
  right: LedgerActivityItem,
): number {
  return -compareLedgerFactOrder(
    toLedgerFactOrderInput(left),
    toLedgerFactOrderInput(right),
  );
}

function toLedgerFactOrderInput(item: LedgerActivityItem) {
  return {
    occurredAt: item.occurredAt,
    createdAt: getActivityCreatedAt(item),
    kind: item.kind,
    id: item.id,
  } as const;
}

function getActivityCreatedAt(item: LedgerActivityItem): string {
  return item.kind === "trade"
    ? item.trade.createdAt
    : item.cashEvent.createdAt;
}

function projectTrade(trade: Trade): LedgerActivityItem {
  return {
    kind: "trade",
    id: trade.id,
    occurredAt: trade.occurredAt,
    trade,
  };
}

function projectCashEvent(cashEvent: CashEvent): LedgerActivityItem {
  return {
    kind: "cash-event",
    id: cashEvent.id,
    occurredAt: cashEvent.occurredAt,
    cashEvent,
  };
}
