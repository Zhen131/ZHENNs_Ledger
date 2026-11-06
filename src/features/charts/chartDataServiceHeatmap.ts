/**
 * 这个文件管一件事：算出热力图最近 365 天每天的笔数和颜色。
 * 它只数买卖，不看现金记录；格子怎么画在 `TradeHeatmapChart.tsx`。
 * 不显然的决定：只按笔数上色，手续费不影响；2026-08-09 定（W12 01A 第 7.5 节）。
 */
import type { LedgerData } from "@/core/models";
import { partitionLedgerFactsForToday } from "@/core/policies";
import {
  addLedgerDays,
  enumerateLedgerDays,
  getLedgerDateKey,
} from "@/core/shared";
import type {
  TradeHeatmapDay,
  TradeHeatmapActivityGroup,
} from "./chartDataService";

/**
 * 这个函数回答：最近 365 天（含今天）每天买卖了几笔，颜色多深？
 * 颜色按当天笔数和最多那天比，分 0～4 五级。
 * 举例：最多那天 8 笔，某天 2 笔 → 答 1 级；某天 8 笔 → 答 4 级。
 * 今天以后的交易不算。
 * 不会出错。
 */
export function buildTradeHeatmap(
  ledgerData: LedgerData,
  todayKey: string,
): TradeHeatmapDay[] {
  const startDate = addLedgerDays(todayKey, -364);
  const counts = new Map<
    string,
    {
      total: number;
      buys: number;
      sells: number;
      activityGroups: Map<string, TradeHeatmapActivityGroup>;
    }
  >();
  const partition = partitionLedgerFactsForToday(ledgerData, todayKey);

  for (const trade of partition.activeTrades) {
    const date = getLedgerDateKey(trade.occurredAt);
    if (date < startDate || date > todayKey) {
      continue;
    }
    const current = counts.get(date) ?? {
      total: 0,
      buys: 0,
      sells: 0,
      activityGroups: new Map<string, TradeHeatmapActivityGroup>(),
    };
    current.total += 1;
    if (trade.type === "buy") {
      current.buys += 1;
    } else {
      current.sells += 1;
    }
    const activityKey = `${trade.assetSymbol}\u0000${trade.type}`;
    const activityGroup = current.activityGroups.get(activityKey);
    if (activityGroup) {
      activityGroup.count += 1;
    } else {
      current.activityGroups.set(activityKey, {
        assetSymbol: trade.assetSymbol,
        type: trade.type,
        count: 1,
      });
    }
    counts.set(date, current);
  }

  const maxCount = Math.max(
    0,
    ...Array.from(counts.values()).map((item) => item.total),
  );
  return enumerateLedgerDays(startDate, todayKey).map((date) => {
    const count = counts.get(date);
    const total = count?.total ?? 0;
    return {
      date,
      total,
      buys: count?.buys ?? 0,
      sells: count?.sells ?? 0,
      level: getHeatLevel(total, maxCount),
      activityGroups: Array.from(count?.activityGroups.values() ?? []).sort(
        compareHeatmapActivityGroups,
      ),
    };
  });
}

/**
 * 这个函数回答：只加了一笔交易，热力图怎么跟着变？
 * 那天笔数加一，然后全部重新分级。
 * 举例：某天原来 2 笔，再加一笔买入 → 那天变成 3 笔、买入多 1。
 * 日期不在最近 365 天里，原样返回。
 * 不会出错。
 */
export function updateTradeHeatmapForAppendedTrade(
  previous: readonly TradeHeatmapDay[],
  trade: LedgerData["trades"][number],
  todayKey: string,
): TradeHeatmapDay[] {
  const date = getLedgerDateKey(trade.occurredAt);
  const startDate = addLedgerDays(todayKey, -364);
  if (date < startDate || date > todayKey) return [...previous];
  const updated = previous.map((day) => {
    if (day.date !== date) return day;
    const activityGroups = day.activityGroups.map((group) => ({ ...group }));
    const group = activityGroups.find(
      (candidate) =>
        candidate.assetSymbol === trade.assetSymbol &&
        candidate.type === trade.type,
    );
    if (group) {
      group.count += 1;
    } else {
      activityGroups.push({
        assetSymbol: trade.assetSymbol,
        type: trade.type,
        count: 1,
      });
    }
    activityGroups.sort(compareHeatmapActivityGroups);
    return {
      ...day,
      total: day.total + 1,
      buys: day.buys + (trade.type === "buy" ? 1 : 0),
      sells: day.sells + (trade.type === "sell" ? 1 : 0),
      activityGroups,
    };
  });
  const maxCount = Math.max(0, ...updated.map((day) => day.total));
  return updated.map((day) => ({
    ...day,
    level: getHeatLevel(day.total, maxCount),
  }));
}

function compareHeatmapActivityGroups(
  left: TradeHeatmapActivityGroup,
  right: TradeHeatmapActivityGroup,
): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }
  const assetOrder =
    left.assetSymbol < right.assetSymbol
      ? -1
      : left.assetSymbol > right.assetSymbol
        ? 1
        : 0;
  if (assetOrder !== 0) {
    return assetOrder;
  }
  if (left.type === right.type) {
    return 0;
  }
  return left.type === "buy" ? -1 : 1;
}

function getHeatLevel(
  count: number,
  maxCount: number,
): 0 | 1 | 2 | 3 | 4 {
  if (count === 0 || maxCount === 0) {
    return 0;
  }
  if (count * 4 <= maxCount) {
    return 1;
  }
  if (count * 2 <= maxCount) {
    return 2;
  }
  if (count * 4 <= maxCount * 3) {
    return 3;
  }
  return 4;
}
