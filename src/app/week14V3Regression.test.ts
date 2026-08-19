import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLedgerActivityItems,
  filterLedgerActivityItems,
} from "@/features/activity";
import {
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
} from "@/features/backup";
import {
  buildHoldingAllocation,
  buildHoldingHistory,
  buildTradeHeatmap,
} from "@/features/charts";
import {
  buildLedgerPnlSummary,
  buildLedgerProjection,
} from "@/features/portfolio";
import {
  createUsdtPriceSnapshot,
  createUsdtSimpleTrade,
  createWeek14V3Scenario,
  WEEK14_V3_TODAY,
} from "@/test-support";

afterEach(() => {
  vi.unstubAllGlobals();
});

const valuationOptions = {
  todayKey: WEEK14_V3_TODAY,
  mode: "manual" as const,
};

describe("Week 14 V3 cross-module regression", () => {
  it("keeps one cash truth across projection, allocation, activity, P&L, and heatmap", () => {
    const ledger = createWeek14V3Scenario();
    const projection = buildLedgerProjection(ledger, {
      asOf: WEEK14_V3_TODAY,
      mode: "manual",
    });

    expect(projection.cash).toEqual(
      expect.objectContaining({ balance: "93", deficit: "0" }),
    );
    expect(projection.positions.find(({ assetSymbol }) => assetSymbol === "SOL"))
      .toEqual(
        expect.objectContaining({
          quantity: "8",
          costBasis: "724",
          realizedPnl: "17",
          marketValue: "600",
          unrealizedPnl: "-124",
        }),
      );
    expect(projection.valuation).toEqual(
      expect.objectContaining({
        pricedAssetMarketValue: "600",
        totalAssetValue: "693",
        complete: true,
      }),
    );

    const allocation = buildHoldingAllocation(ledger, {
      ...valuationOptions,
      projection,
    });
    expect(allocation.totalMarketValue).toBe("693");
    expect(allocation.slices.map(({ assetSymbol, marketValue }) => [
      assetSymbol,
      marketValue,
    ])).toEqual([
      ["SOL", "600"],
      ["现金 USDT", "93"],
    ]);

    const activity = buildLedgerActivityItems(ledger);
    expect(activity).toHaveLength(6);
    expect(activity.map(({ id }) => id)).toEqual([
      "trade-stage8-sol-sell",
      "trade-stage8-sol-buy",
      "cash-stage8-adjustment",
      "cash-stage8-expense",
      "cash-stage8-withdrawal",
      "cash-stage8-deposit",
    ]);
    expect(filterLedgerActivityItems(activity, { asset: "USDT" })).toHaveLength(4);
    expect(filterLedgerActivityItems(activity, { asset: "SOL" })).toHaveLength(2);

    const withoutCash = structuredClone(ledger);
    withoutCash.cashEvents = [];
    expect(buildLedgerPnlSummary(ledger, valuationOptions)).toEqual(
      buildLedgerPnlSummary(withoutCash, valuationOptions),
    );
    expect(
      buildTradeHeatmap(ledger, WEEK14_V3_TODAY).reduce(
        (total, day) => total + day.total,
        0,
      ),
    ).toBe(2);
  });

  it("replays historical cash per day without backfilling a later deposit", () => {
    const ledger = createWeek14V3Scenario();
    ledger.cashEvents.push({
      id: "cash-stage8-today-deposit",
      occurredAt: WEEK14_V3_TODAY,
      timePrecision: "day",
      type: "deposit",
      currency: "USDT",
      amount: "7",
      createdAt: `${WEEK14_V3_TODAY}T08:00:00.000Z`,
      updatedAt: `${WEEK14_V3_TODAY}T08:00:00.000Z`,
    });

    const history = buildHoldingHistory(ledger, {
      ...valuationOptions,
      range: "all",
    });
    expect(history.find(({ date }) => date === "2026-08-13")).toEqual(
      expect.objectContaining({ cashBalance: "800" }),
    );
    expect(history.find(({ date }) => date === "2026-08-15")).toEqual(
      expect.objectContaining({
        cashBalance: "93",
        assetMarketValue: "600",
        totalMarketValue: "693",
      }),
    );
    expect(history.at(-1)).toEqual(
      expect.objectContaining({
        date: WEEK14_V3_TODAY,
        cashBalance: "100",
        totalMarketValue: "700",
      }),
    );
  });

  it("round-trips the canonical scenario through the exact V3 backup envelope", () => {
    const ledger = createWeek14V3Scenario();
    const envelope = createBackupEnvelope(
      ledger,
      {
        appVersion: "0.1.0-stage8-test",
        exportedAt: "2026-08-19T12:00:00.000Z",
      },
      WEEK14_V3_TODAY,
    );
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;

    expect(Object.keys(envelope.value)).toEqual([
      "backupFormatVersion",
      "appVersion",
      "exportedAt",
      "ledgerSchemaVersion",
      "ledgerData",
    ]);
    const serialized = serializeBackupEnvelope(envelope.value);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized).not.toContain('"balance":');
    expect(parseBackupJson(serialized, WEEK14_V3_TODAY)).toEqual({
      ok: true,
      value: envelope.value,
    });
  });

  it("keeps a mapping-null fictional holding on multi-day manual as-of prices with zero fetch through B round-trip", () => {
    const fetchMock = vi.fn(() => {
      throw new Error("manual valuation must not fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const ledger = createWeek14V3Scenario();
    ledger.trades.push(
      createUsdtSimpleTrade(
        "trade-stage8-knight-buy",
        "buy",
        "KNIGHT",
        "2",
        "2026-08-14",
      ),
    );
    ledger.priceSnapshots.push(
      createUsdtPriceSnapshot(
        "price-stage8-knight-day-1",
        "KNIGHT",
        "10",
        "2026-08-15",
      ),
      createUsdtPriceSnapshot(
        "price-stage8-knight-day-2",
        "KNIGHT",
        "20",
        "2026-08-18",
      ),
    );

    const history = buildHoldingHistory(ledger, {
      ...valuationOptions,
      range: "all",
    });
    expect(
      ledger.assets.find(({ symbol }) => symbol === "KNIGHT")?.binanceMapping,
    ).toBeNull();
    expect(history.find(({ date }) => date === "2026-08-15")).toEqual(
      expect.objectContaining({
        assetMarketValue: "620",
        priceAsOfByAsset: expect.objectContaining({ KNIGHT: "2026-08-15" }),
      }),
    );
    expect(history.find(({ date }) => date === "2026-08-18")).toEqual(
      expect.objectContaining({
        assetMarketValue: "640",
        priceAsOfByAsset: expect.objectContaining({ KNIGHT: "2026-08-18" }),
      }),
    );

    const envelope = createBackupEnvelope(
      ledger,
      {
        appVersion: "0.1.0-stage8-manual-price-test",
        exportedAt: "2026-08-19T13:00:00.000Z",
      },
      WEEK14_V3_TODAY,
    );
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const parsed = parseBackupJson(
      serializeBackupEnvelope(envelope.value),
      WEEK14_V3_TODAY,
    );
    expect(parsed).toEqual({ ok: true, value: envelope.value });
    if (parsed.ok) {
      expect(
        parsed.value.ledgerData.priceSnapshots.filter(
          ({ assetSymbol }) => assetSymbol === "KNIGHT",
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ recordedAt: "2026-08-15", price: "10" }),
          expect.objectContaining({ recordedAt: "2026-08-18", price: "20" }),
        ]),
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
