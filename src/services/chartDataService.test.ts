import { describe, expect, it } from "vitest";

import type {
  LedgerData,
  PriceSnapshot,
  Trade,
} from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  createPriceSnapshot,
  createSimpleTrade,
} from "../test/fixtures";
import {
  buildHoldingAllocation,
  buildHoldingHistory,
  buildTradeHeatmap,
} from "./chartDataService";
import { getPositionsFromLedger } from "./positionService";

const TODAY = "2026-07-25";

function apiPrice(
  id: string,
  assetSymbol: string,
  price: string,
  recordedAt: string,
): PriceSnapshot {
  return {
    ...createPriceSnapshot(id, assetSymbol, price, recordedAt),
    currency: "USDT",
    source: "api",
    binanceProvenance: {
      provider: "binance",
      symbol: `${assetSymbol}USDT`,
      sourceQuoteCurrency: "USDT",
      fetchedAt: `${recordedAt}T12:00:00Z`,
    },
  };
}

function buy(
  id: string,
  assetSymbol: string,
  quantity: string,
  totalValue: string,
  occurredAt: string,
): Trade {
  return {
    ...createSimpleTrade(id, "buy", assetSymbol, quantity, occurredAt),
    price: totalValue,
    totalValue,
    currency: "USDT",
    feeCurrency: "USDT",
  };
}

function manualPrice(
  id: string,
  assetSymbol: string,
  price: string,
  recordedAt: string,
): PriceSnapshot {
  return {
    ...createPriceSnapshot(id, assetSymbol, price, recordedAt),
    currency: "USDT",
  };
}

describe("holding allocation", () => {
  it("uses the shared selector, excludes zero holdings, and reports partial missing prices", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      buy("btc", "BTC", "1", "100", "2026-07-20"),
      buy("eth", "ETH", "2", "100", "2026-07-20"),
      buy("ada", "ADA", "10", "100", "2026-07-20"),
    ];
    ledgerData.priceSnapshots = [
      manualPrice("btc-manual", "BTC", "100", "2026-07-24"),
      apiPrice("btc-api", "BTC", "120", TODAY),
      manualPrice("eth-manual", "ETH", "40", TODAY),
    ];

    const allocation = buildHoldingAllocation(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
    });
    expect(allocation.totalMarketValue).toBe("200");
    expect(allocation.valuation.label).toBe("USDT");
    expect(allocation.missingPriceAssets).toEqual(["ADA"]);
    expect(allocation.slices).toEqual([
      {
        assetSymbol: "BTC",
        marketValue: "120",
        ratio: "0.6",
        source: "binance",
        asOf: `${TODAY}T12:00:00Z`,
      },
      {
        assetSymbol: "ETH",
        marketValue: "80",
        ratio: "0.4",
        source: "manual",
        asOf: TODAY,
      },
    ]);

    const currentPositions = getPositionsFromLedger(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
    });
    expect(
      currentPositions.find((position) => position.assetSymbol === "BTC")
        ?.marketValue,
    ).toBe(allocation.slices[0].marketValue);
  });

  it("handles all-missing, single-asset 100%, explicit mode, and unsupported legacy currency", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets[2] = {
      ...ledgerData.assets[2],
      quoteCurrency: "EUR",
    };
    ledgerData.trades = [
      buy("btc", "BTC", "1", "100", "2026-07-20"),
      {
        ...buy("ada", "ADA", "1", "10", "2026-07-20"),
        currency: "EUR",
      },
    ];

    expect(
      buildHoldingAllocation(ledgerData, {
        todayKey: TODAY,
        mode: "auto",
      }),
    ).toEqual({
      slices: [],
      missingPriceAssets: ["BTC"],
      excludedCurrencyAssets: ["ADA"],
      valuation: { label: "USDT", usesApproximation: false },
    });

    ledgerData.priceSnapshots = [
      manualPrice("manual", "BTC", "90", "2026-07-20"),
      apiPrice("api", "BTC", "100", TODAY),
    ];
    const manual = buildHoldingAllocation(ledgerData, {
      todayKey: TODAY,
      mode: "manual",
    });
    expect(manual.slices).toEqual([
      expect.objectContaining({
        assetSymbol: "BTC",
        marketValue: "90",
        ratio: "1",
        source: "manual",
      }),
    ]);
  });
});

describe("holding history", () => {
  it.each([
    ["7d", 7],
    ["30d", 30],
    ["365d", 365],
  ] as const)("builds %s as continuous calendar days", (range, count) => {
    const points = buildHoldingHistory(createInitialLedgerData(), {
      todayKey: TODAY,
      mode: "auto",
      range,
    });
    expect(points).toHaveLength(count);
    expect(points.at(-1)?.date).toBe(TODAY);
  });

  it("replays pre-range facts once and carries the last real price forward", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      buy("btc", "BTC", "2", "100", "2026-07-10"),
      {
        ...createSimpleTrade(
          "btc-sell",
          "sell",
          "BTC",
          "1",
          "2026-07-22",
        ),
        price: "80",
        totalValue: "80",
        currency: "USDT",
        feeCurrency: "USDT",
      },
    ];
    ledgerData.priceSnapshots = [
      manualPrice("old-price", "BTC", "60", "2026-07-18"),
    ];

    const points = buildHoldingHistory(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
      range: "7d",
    });
    expect(points[0]).toEqual(
      expect.objectContaining({
        date: "2026-07-19",
        totalCostBasis: "100",
        totalMarketValue: "120",
      }),
    );
    expect(points[3]).toEqual(
      expect.objectContaining({
        date: "2026-07-22",
        totalCostBasis: "50",
        totalMarketValue: "60",
      }),
    );
    expect(points.at(-1)?.priceAsOfByAsset.BTC).toBe("2026-07-18");
  });

  it("breaks total market value for any missing nonzero asset while cost stays continuous", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      buy("btc", "BTC", "1", "100", "2026-07-24"),
      buy("eth", "ETH", "1", "50", "2026-07-24"),
    ];
    ledgerData.priceSnapshots = [
      manualPrice("btc", "BTC", "120", "2026-07-24"),
    ];
    const points = buildHoldingHistory(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
      range: "7d",
    });
    const today = points.at(-1)!;
    expect(today.totalCostBasis).toBe("150");
    expect(today.totalMarketValue).toBeUndefined();
    expect(today.missingPriceAssets).toEqual(["ETH"]);
  });

  it("never backfills a real Binance price into earlier history and ignores future facts", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      buy("btc", "BTC", "1", "100", "2026-07-23"),
      buy("future", "ETH", "1", "10", "2026-07-26"),
    ];
    ledgerData.priceSnapshots = [
      apiPrice("api", "BTC", "120", TODAY),
      manualPrice("future-price", "ETH", "20", "2026-07-26"),
    ];
    const points = buildHoldingHistory(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
      range: "7d",
    });
    expect(
      points.find((point) => point.date === "2026-07-24")
        ?.totalMarketValue,
    ).toBeUndefined();
    expect(points.at(-1)?.totalMarketValue).toBe("120");
    expect(points.at(-1)?.totalCostBasis).toBe("100");
  });

  it("keeps all-range cleared history and renders 1d as equal display boundaries", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      buy("btc", "BTC", "1", "100", "2026-07-20"),
      {
        ...createSimpleTrade(
          "sell",
          "sell",
          "BTC",
          "1",
          "2026-07-21",
        ),
        totalValue: "110",
        currency: "USDT",
        feeCurrency: "USDT",
      },
    ];
    ledgerData.priceSnapshots = [
      manualPrice("price", "BTC", "120", "2026-07-20"),
    ];
    const all = buildHoldingHistory(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
      range: "all",
    });
    expect(all[0].totalMarketValue).toBe("120");
    expect(all.at(-1)).toEqual(
      expect.objectContaining({
        totalCostBasis: "0",
        totalMarketValue: "0",
      }),
    );

    const oneDay = buildHoldingHistory(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
      range: "1d",
    });
    expect(oneDay).toHaveLength(2);
    expect(oneDay[0]).toEqual(
      expect.objectContaining({
        displayBoundary: "start",
        totalCostBasis: "0",
        totalMarketValue: "0",
      }),
    );
    expect(oneDay[1]).toEqual(
      expect.objectContaining({
        displayBoundary: "end",
        totalCostBasis: oneDay[0].totalCostBasis,
        totalMarketValue: oneDay[0].totalMarketValue,
      }),
    );
  });

  it("does not mutate the ledger while deriving all three datasets", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [buy("btc", "BTC", "1", "100", "2026-07-20")];
    const before = structuredClone(ledgerData);
    buildHoldingAllocation(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
    });
    buildHoldingHistory(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
      range: "all",
    });
    buildTradeHeatmap(ledgerData, TODAY);
    expect(ledgerData).toEqual(before);
  });

  it("keeps market value and heat counts but breaks cost after a foreign fee", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      {
        ...buy("btc", "BTC", "1", "100", "2026-07-20"),
        fee: "1",
        feeCurrency: "BNB",
      },
    ];
    ledgerData.priceSnapshots = [
      manualPrice("btc-price", "BTC", "120", "2026-07-20"),
    ];

    const point = buildHoldingHistory(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
      range: "all",
    }).at(-1)!;
    expect(point.totalCostBasis).toBeUndefined();
    expect(point.totalMarketValue).toBe("120");
    expect(point.unreliableFeeAssets).toEqual(["BTC"]);
    expect(buildTradeHeatmap(ledgerData, TODAY).at(-6)?.total).toBe(1);
  });
});

describe("trade heatmap", () => {
  function addTrades(
    ledgerData: LedgerData,
    date: string,
    count: number,
    type: "buy" | "sell" = "buy",
  ) {
    for (let index = 0; index < count; index += 1) {
      ledgerData.trades.push(
        createSimpleTrade(`${date}-${type}-${index}`, type, "BTC", "1", date),
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
    });
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
