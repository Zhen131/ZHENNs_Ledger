/**
 * 这个文件管一件事：把买卖和现金记录合成一张列表。
 * 这张列表还能筛选。
 * 列表只在显示时算出来，不存进账本；画表格在 `ActivityTable.tsx`。
 * 不显然的决定：排序和现金按顺序过账用同一把尺子；2026-08-19 定（W14 01B 第 6.3 节）。
 */
import type { CashEvent, LedgerData, Trade } from "@/core/models";
import {
  compareLedgerFactOrder,
  getLedgerDateKey,
} from "@/core/shared";

/**
 * 交易页上的一行：一笔买卖，或一笔现金记录。
 * 带着编号和发生时刻，方便排序和筛选。
 */
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

/**
 * 交易页按类型筛选的选项：全部、买入、卖出。
 * 还有入金、出金、外部支出、余额校准。
 */
export type LedgerActivityTypeFilter =
  | "all"
  | "buy"
  | "sell"
  | "deposit"
  | "withdrawal"
  | "external-expense"
  | "balance-adjustment";

type LedgerActivityFilter = Readonly<{
  type?: LedgerActivityTypeFilter;
  asset?: "all" | "USDT" | string;
  exactDate?: string;
  earliestDate?: string;
  latestDate?: string;
}>;

/**
 * 这个函数回答：交易页上的全部行是什么、按什么顺序？
 * 买卖和现金记录放在一起，最新发生的排最前。
 * 同一时刻的，按记下的先后和编号排，每次结果都一样。
 * 举例：8 月 20 日买 BTC、8 月 21 日入金 → 答入金在前、买 BTC 在后。
 * 不会出错。
 */
export function buildLedgerActivityItems(
  ledgerData: Pick<LedgerData, "trades" | "cashEvents">,
): LedgerActivityItem[] {
  return [
    ...ledgerData.trades.map(projectTrade),
    ...ledgerData.cashEvents.map(projectCashEvent),
  ].sort(compareLedgerActivityItemsDescending);
}

/**
 * 这个函数回答：按日期、类型、币筛完还剩哪几行？
 * 几个条件同时满足才留下。
 * 选「现金 USDT」只留现金记录，不留用 USDT 计价的买卖。
 * 举例：筛 BTC → 只留 BTC 的买卖，现金记录全去掉。
 * 为什么 USDT 只留现金：2026-08-19 定（W14 01B 第 6.3 节）。
 * 不会出错。
 */
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

function getActivityType(
  item: LedgerActivityItem,
): Exclude<LedgerActivityTypeFilter, "all"> {
  return item.kind === "trade" ? item.trade.type : item.cashEvent.type;
}

function compareLedgerActivityItemsDescending(
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
