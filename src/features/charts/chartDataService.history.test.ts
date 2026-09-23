import { describe, expect, it } from "vitest";
import { createInitialLedgerData } from "@/core/state";
import { createSimpleTrade } from "@/test-support";
import { buildHoldingAllocation } from "./chartDataServiceAllocation";
import { buildTradeHeatmap } from "./chartDataServiceHeatmap";
import { buildHoldingHistory } from "./chartDataServiceHistory";
import {
  TODAY,
  apiPrice,
  buy,
  manualPrice,
} from "./chartDataService.testHelpers";

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

  it("adds cash dates to all-range history and replays each date without backfilling today's cash", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [
      {
        id: "deposit",
        occurredAt: "2026-07-20",
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "100",
        createdAt: "2026-07-20T00:00:00Z",
        updatedAt: "2026-07-20T00:00:00Z",
      },
      {
        id: "expense",
        occurredAt: "2026-07-22",
        timePrecision: "day",
        type: "external-expense",
        currency: "USDT",
        amount: "10",
        createdAt: "2026-07-22T00:00:00Z",
        updatedAt: "2026-07-22T00:00:00Z",
      },
    ];
    ledgerData.trades = [
      buy("btc", "BTC", "1", "60", "2026-07-21"),
    ];
    ledgerData.priceSnapshots = [
      manualPrice("btc-price", "BTC", "60", "2026-07-21"),
    ];

    const points = buildHoldingHistory(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
      range: "all",
    });
    expect(points[0]).toEqual(
      expect.objectContaining({
        date: "2026-07-20",
        cashBalance: "100",
        totalMarketValue: "100",
      }),
    );
    expect(points[1]).toEqual(
      expect.objectContaining({
        date: "2026-07-21",
        cashBalance: "40",
        assetMarketValue: "60",
        totalMarketValue: "100",
      }),
    );
    expect(points[2]).toEqual(
      expect.objectContaining({
        date: "2026-07-22",
        cashBalance: "30",
        totalMarketValue: "90",
      }),
    );
  });

  it("starts all-range history at an asset transfer without changing cash", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assetTransfers = [
      {
        id: "fictional-external-in",
        occurredAt: "2026-07-18",
        timePrecision: "day",
        assetSymbol: "BTC",
        quantity: "2",
        category: "external-in",
        reason: "deposit",
        toLocation: "cold-wallet",
        unitPrice: "40",
        createdAt: "2026-07-18T00:00:00Z",
        updatedAt: "2026-07-18T00:00:00Z",
      },
    ];
    ledgerData.priceSnapshots = [
      manualPrice("btc-price", "BTC", "50", "2026-07-18"),
    ];

    const points = buildHoldingHistory(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
      range: "all",
    });

    expect(points[0]).toEqual(
      expect.objectContaining({
        date: "2026-07-18",
        cashBalance: "0",
        totalCostBasis: "80",
        assetMarketValue: "100",
        totalMarketValue: "100",
      }),
    );
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
        totalMarketValue: "20",
        cashBalance: "-100",
      }),
    );
    expect(points[3]).toEqual(
      expect.objectContaining({
        date: "2026-07-22",
        totalCostBasis: "50",
        totalMarketValue: "40",
        cashBalance: "-20",
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
    expect(points.at(-1)?.totalMarketValue).toBe("20");
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
    expect(all[0].totalMarketValue).toBe("20");
    expect(all.at(-1)).toEqual(
      expect.objectContaining({
        totalCostBasis: "0",
        totalMarketValue: "10",
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
        totalMarketValue: "10",
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
    expect(point.totalMarketValue).toBe("20");
    expect(point.unreliableFeeAssets).toEqual(["BTC"]);
    expect(buildTradeHeatmap(ledgerData, TODAY).at(-6)?.total).toBe(1);
  });
});
