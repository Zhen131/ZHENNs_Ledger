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
