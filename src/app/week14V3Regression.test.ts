import { describe, expect, it } from "vitest";

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
  createWeek14V3Scenario,
  WEEK14_V3_TODAY,
} from "@/test-support";

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
});
