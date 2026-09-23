import { describe, expect, it } from "vitest";

import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createSimpleTrade } from "@/test-support";
import { buildTradeHeatmap } from "./chartDataServiceHeatmap";
import { TODAY } from "./chartDataService.testHelpers";

describe("trade heatmap", () => {
  function addTrades(
    ledgerData: LedgerData,
    date: string,
    count: number,
    type: "buy" | "sell" = "buy",
    assetSymbol = "BTC",
  ) {
    for (let index = 0; index < count; index += 1) {
      ledgerData.trades.push(
        createSimpleTrade(
          `${date}-${assetSymbol}-${type}-${index}`,
          type,
          assetSymbol,
          "1",
          date,
        ),
      );
    }
  }

  it("always emits 365 days across leap/year boundaries and counts offset dates by source key", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      createSimpleTrade(
        "offset",
        "buy",
        "BTC",
        "1",
        "2026-07-25T23:30:00-10:00",
      ),
      createSimpleTrade("future", "buy", "BTC", "1", "2026-07-26"),
    ];
    const heatmap = buildTradeHeatmap(ledgerData, TODAY);
    expect(heatmap).toHaveLength(365);
    expect(heatmap[0].date).toBe("2025-07-26");
    expect(heatmap.at(-1)).toEqual({
      date: TODAY,
      total: 1,
      buys: 1,
      sells: 0,
      level: 4,
      activityGroups: [
        { assetSymbol: "BTC", type: "buy", count: 1 },
      ],
    });
  });

  it("groups activity by asset and direction with stable count-first ordering", () => {
    const ledgerData = createInitialLedgerData();
    addTrades(ledgerData, TODAY, 2, "sell", "ETH");
    addTrades(ledgerData, TODAY, 2, "buy", "BTC");
    addTrades(ledgerData, TODAY, 2, "sell", "BTC");
    addTrades(ledgerData, TODAY, 1, "buy", "ADA");

    expect(buildTradeHeatmap(ledgerData, TODAY).at(-1)?.activityGroups).toEqual([
      { assetSymbol: "BTC", type: "buy", count: 2 },
      { assetSymbol: "BTC", type: "sell", count: 2 },
      { assetSymbol: "ETH", type: "sell", count: 2 },
      { assetSymbol: "ADA", type: "buy", count: 1 },
    ]);
  });

  it("uses max-ratio boundaries, equal counts, single nonzero and extreme skew", () => {
    const ledgerData = createInitialLedgerData();
    addTrades(ledgerData, "2026-07-21", 1);
    addTrades(ledgerData, "2026-07-22", 2);
    addTrades(ledgerData, "2026-07-23", 3);
    addTrades(ledgerData, "2026-07-24", 4);
    addTrades(ledgerData, TODAY, 1, "sell");
    const heatmap = buildTradeHeatmap(ledgerData, TODAY);
    const byDate = new Map(heatmap.map((day) => [day.date, day]));
    expect(byDate.get("2026-07-21")?.level).toBe(1);
    expect(byDate.get("2026-07-22")?.level).toBe(2);
    expect(byDate.get("2026-07-23")?.level).toBe(3);
    expect(byDate.get("2026-07-24")?.level).toBe(4);
    expect(byDate.get(TODAY)).toEqual(
      expect.objectContaining({
        total: 1,
        buys: 0,
        sells: 1,
        level: 1,
      }),
    );

    const skewed = createInitialLedgerData();
    addTrades(skewed, "2026-07-22", 1);
    addTrades(skewed, "2026-07-23", 1);
    addTrades(skewed, "2026-07-24", 1);
    addTrades(skewed, TODAY, 30);
    const skewedByDate = new Map(
      buildTradeHeatmap(skewed, TODAY).map((day) => [day.date, day.level]),
    );
    expect(skewedByDate.get("2026-07-22")).toBe(1);
    expect(skewedByDate.get("2026-07-23")).toBe(1);
    expect(skewedByDate.get("2026-07-24")).toBe(1);
    expect(skewedByDate.get(TODAY)).toBe(4);
  });

  it("returns level 0 for an all-zero ledger", () => {
    const heatmap = buildTradeHeatmap(createInitialLedgerData(), TODAY);
    expect(heatmap).toHaveLength(365);
    expect(heatmap.every((day) => day.level === 0)).toBe(true);
  });
});
