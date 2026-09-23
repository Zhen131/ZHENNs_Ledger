import { describe, expect, it } from "vitest";
import { add } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { buildHoldingAllocation } from "./chartDataServiceAllocation";
import { getPositionsFromLedger } from "@/features/portfolio";
import {
  TODAY,
  apiPrice,
  buy,
  manualPrice,
  allocationProjection,
} from "./chartDataService.testHelpers";

describe("holding allocation", () => {
  it("draws positive cash as a slice and never draws a negative-cash pseudo asset", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [
      {
        id: "deposit",
        occurredAt: "2026-07-19",
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "1000",
        createdAt: "2026-07-19T00:00:00Z",
        updatedAt: "2026-07-19T00:00:00Z",
      },
    ];
    ledgerData.trades = [
      buy("btc", "BTC", "1", "900", "2026-07-20"),
    ];
    ledgerData.priceSnapshots = [
      manualPrice("btc-price", "BTC", "900", TODAY),
    ];

    const positive = buildHoldingAllocation(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
    });
    expect(positive.totalMarketValue).toBe("1000");
    expect(positive.slices).toEqual([
      expect.objectContaining({ assetSymbol: "BTC", ratio: "0.9" }),
      expect.objectContaining({
        assetSymbol: "现金 USDT",
        marketValue: "100",
        ratio: "0.1",
        source: "cash",
      }),
    ]);

    ledgerData.cashEvents = [];
    const negative = buildHoldingAllocation(ledgerData, {
      todayKey: TODAY,
      mode: "auto",
    });
    expect(negative.totalMarketValue).toBe("0");
    expect(negative.cashDeficit).toBe("900");
    expect(
      negative.slices.some((slice) => slice.assetSymbol === "现金 USDT"),
    ).toBe(false);
    expect(negative.slices[0]?.ratio).toBe("1");
  });

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
    expect(allocation.totalMarketValue).toBe("-100");
    expect(allocation.cashBalance).toBe("-300");
    expect(allocation.cashDeficit).toBe("300");
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
      quoteCurrency: "EUR" as never,
    };
    ledgerData.trades = [
      buy("btc", "BTC", "1", "100", "2026-07-20"),
      {
        ...buy("ada", "ADA", "1", "10", "2026-07-20"),
        currency: "EUR" as never,
      },
    ];

    expect(
      buildHoldingAllocation(ledgerData, {
        todayKey: TODAY,
        mode: "auto",
      }),
    ).toEqual({
      slices: [],
      assetMarketValue: "0",
      cashBalance: "-110",
      cashDeficit: "110",
      totalMarketValue: "-110",
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

  it("T3-05 groups ratios strictly below 2%, keeps exactly 2%, and preserves market value", () => {
    const projection = allocationProjection(
      [
        { assetSymbol: "BTC", marketValue: "800" },
        { assetSymbol: "ETH", marketValue: "160" },
        { assetSymbol: "ADA", marketValue: "11" },
        { assetSymbol: "SOL", marketValue: "9" },
      ],
      "20",
    );
    const originalPositions = structuredClone(projection.positions);

    const allocation = buildHoldingAllocation(createInitialLedgerData(), {
      todayKey: TODAY,
      mode: "auto",
      projection,
    });

    expect(allocation.slices.map(({ assetSymbol }) => assetSymbol)).toEqual([
      "BTC",
      "ETH",
      "现金 USDT",
      "其他",
    ]);
    expect(allocation.slices[2]).toEqual(
      expect.objectContaining({
        assetSymbol: "现金 USDT",
        marketValue: "20",
        ratio: "0.02",
        source: "cash",
      }),
    );
    expect(allocation.slices[3]).toEqual({
      assetSymbol: "其他",
      marketValue: "20",
      ratio: "0.02",
      source: "grouped",
      asOf: TODAY,
      groupedMembers: [
        { assetSymbol: "ADA", marketValue: "11" },
        { assetSymbol: "SOL", marketValue: "9" },
      ],
    });
    expect(
      allocation.slices.reduce(
        (sum, slice) => add(sum, slice.marketValue),
        "0",
      ),
    ).toBe("1000");
    expect(allocation.totalMarketValue).toBe("1000");
    expect(projection.positions).toEqual(originalPositions);
  });

  it("T3-05 lets positive cash participate in the below-2% group", () => {
    const projection = allocationProjection(
      [{ assetSymbol: "BTC", marketValue: "99" }],
      "1",
    );

    const allocation = buildHoldingAllocation(createInitialLedgerData(), {
      todayKey: TODAY,
      mode: "auto",
      projection,
    });

    expect(allocation.slices).toEqual([
      expect.objectContaining({ assetSymbol: "BTC", ratio: "0.99" }),
      {
        assetSymbol: "其他",
        marketValue: "1",
        ratio: "0.01",
        source: "grouped",
        asOf: TODAY,
        groupedMembers: [
          { assetSymbol: "现金 USDT", marketValue: "1" },
        ],
      },
    ]);
  });

  it("T3-06 caps allocation at eight slices and folds every item after the top seven into Other", () => {
    const projection = allocationProjection([
      { assetSymbol: "A", marketValue: "30" },
      { assetSymbol: "B", marketValue: "20" },
      { assetSymbol: "C", marketValue: "15" },
      { assetSymbol: "D", marketValue: "10" },
      { assetSymbol: "E", marketValue: "8" },
      { assetSymbol: "F", marketValue: "6" },
      { assetSymbol: "G", marketValue: "5" },
      { assetSymbol: "H", marketValue: "4" },
      { assetSymbol: "I", marketValue: "2" },
    ]);

    const allocation = buildHoldingAllocation(createInitialLedgerData(), {
      todayKey: TODAY,
      mode: "auto",
      projection,
    });

    expect(allocation.slices).toHaveLength(8);
    expect(allocation.slices.map(({ assetSymbol }) => assetSymbol)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "其他",
    ]);
    expect(allocation.slices[7]).toEqual({
      assetSymbol: "其他",
      marketValue: "6",
      ratio: "0.06",
      source: "grouped",
      asOf: TODAY,
      groupedMembers: [
        { assetSymbol: "H", marketValue: "4" },
        { assetSymbol: "I", marketValue: "2" },
      ],
    });
    expect(
      allocation.slices.reduce(
        (sum, slice) => add(sum, slice.marketValue),
        "0",
      ),
    ).toBe("100");
    expect(allocation.totalMarketValue).toBe("100");
  });
});
