import { describe, expect, it } from "vitest";

import type { Trade } from "@/core/models";
import {
  groupSuspiciousBackupTrades,
  type IndexedBackupTrade,
} from "./backupDuplicateGrouping";

const BASE_TRADE: Trade = {
  id: "trade-base",
  occurredAt: "2026-07-20",
  timePrecision: "day",
  type: "buy",
  assetSymbol: "BTC",
  quantity: "1",
  price: "10",
  totalValue: "10",
  currency: "USDT",
  fee: "0.1",
  feeCurrency: "USDT",
  createdAt: "2026-07-20T00:00:00Z",
  updatedAt: "2026-07-20T00:00:00Z",
};

describe("groupSuspiciousBackupTrades", () => {
  it("uses decimal meaning and ignores timestamps, note, rawText, and feeRuleId", () => {
    const groups = groupSuspiciousBackupTrades([
      indexed(8, {
        ...BASE_TRADE,
        id: "decimal-a",
        quantity: "0.10",
        price: "100.0",
        totalValue: "10.00",
        fee: "0.10",
        note: "first",
        rawText: "first raw text",
        feeRuleId: "fee-a",
      }),
      indexed(3, {
        ...BASE_TRADE,
        id: "decimal-b",
        quantity: "0.1",
        price: "100",
        totalValue: "10",
        fee: "0.1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2026-07-21T00:00:00Z",
        note: "second",
        rawText: "second raw text",
        feeRuleId: "fee-b",
      }),
    ]);

    expect(groups).toEqual([
      {
        level: "high",
        tradeIndices: [3, 8],
        tradePaths: ["trades[3]", "trades[8]"],
        tradeIds: ["decimal-b", "decimal-a"],
        triggerEdges: [
          {
            leftIndex: 3,
            rightIndex: 8,
            relation: "same-day-with-day-precision",
          },
        ],
      },
    ]);
  });

  it("groups equal exact instants but not two different precise times", () => {
    const groups = groupSuspiciousBackupTrades([
      indexed(0, {
        ...BASE_TRADE,
        id: "exact-a",
        occurredAt: "2026-07-20T23:30:00-10:00",
        timePrecision: "minute",
      }),
      indexed(1, {
        ...BASE_TRADE,
        id: "exact-b",
        occurredAt: "2026-07-21T09:30:00Z",
        timePrecision: "second",
      }),
      indexed(2, {
        ...BASE_TRADE,
        id: "exact-c",
        occurredAt: "2026-07-20T23:31:00-10:00",
        timePrecision: "second",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].tradeIndices).toEqual([0, 1]);
    expect(groups[0].triggerEdges).toEqual([
      {
        leftIndex: 0,
        rightIndex: 1,
        relation: "same-exact-time",
      },
    ]);
  });

  it("keeps only real edges in an exact-day-exact bridge", () => {
    const groups = groupSuspiciousBackupTrades([
      indexed(8, {
        ...BASE_TRADE,
        id: "bridge-1000",
        occurredAt: "2026-07-20T10:00:00Z",
        timePrecision: "second",
      }),
      indexed(2, {
        ...BASE_TRADE,
        id: "bridge-day",
      }),
      indexed(5, {
        ...BASE_TRADE,
        id: "bridge-1100",
        occurredAt: "2026-07-20T11:00:00Z",
        timePrecision: "second",
      }),
    ]);

    expect(groups).toEqual([
      {
        level: "high",
        tradeIndices: [2, 5, 8],
        tradePaths: ["trades[2]", "trades[5]", "trades[8]"],
        tradeIds: ["bridge-day", "bridge-1100", "bridge-1000"],
        triggerEdges: [
          {
            leftIndex: 2,
            rightIndex: 5,
            relation: "same-day-with-day-precision",
          },
          {
            leftIndex: 2,
            rightIndex: 8,
            relation: "same-day-with-day-precision",
          },
        ],
      },
    ]);
    expect(groups[0].triggerEdges).not.toContainEqual(
      expect.objectContaining({ leftIndex: 5, rightIndex: 8 }),
    );
  });

  it("grades a whole group as general when any fee amount or currency differs", () => {
    const groups = groupSuspiciousBackupTrades([
      indexed(0, { ...BASE_TRADE, id: "high-a", assetSymbol: "BTC" }),
      indexed(1, {
        ...BASE_TRADE,
        id: "high-b",
        assetSymbol: "BTC",
        fee: "0.10",
      }),
      indexed(2, { ...BASE_TRADE, id: "amount-a", assetSymbol: "ETH" }),
      indexed(3, {
        ...BASE_TRADE,
        id: "amount-b",
        assetSymbol: "ETH",
        fee: "0.2",
      }),
      indexed(4, { ...BASE_TRADE, id: "currency-a", assetSymbol: "ADA" }),
      indexed(5, {
        ...BASE_TRADE,
        id: "currency-b",
        assetSymbol: "ADA",
        feeCurrency: "ADA",
      }),
    ]);

    expect(groups.map(({ level, tradeIndices }) => ({ level, tradeIndices }))).toEqual([
      { level: "high", tradeIndices: [0, 1] },
      { level: "general", tradeIndices: [2, 3] },
      { level: "general", tradeIndices: [4, 5] },
    ]);
  });

  it("forms one group with N - 1 real witness edges instead of all pairs", () => {
    const trades = Array.from({ length: 100 }, (_, index) =>
      indexed(index, {
        ...BASE_TRADE,
        id: `same-${index}`,
        occurredAt: "2026-07-20T10:00:00Z",
        timePrecision: "second",
      }),
    );

    const groups = groupSuspiciousBackupTrades(trades);

    expect(groups).toHaveLength(1);
    expect(groups[0].tradeIndices).toHaveLength(100);
    expect(groups[0].triggerEdges).toHaveLength(99);
    expect(groups[0].triggerEdges).toEqual(
      Array.from({ length: 99 }, (_, index) => ({
        leftIndex: 0,
        rightIndex: index + 1,
        relation: "same-exact-time",
      })),
    );
  });

  it("excludes every occurrence of a duplicate ID from warning groups", () => {
    const groups = groupSuspiciousBackupTrades([
      indexed(0, { ...BASE_TRADE, id: "hard-error-id" }),
      indexed(1, { ...BASE_TRADE, id: "hard-error-id" }),
      indexed(2, { ...BASE_TRADE, id: "otherwise-similar" }),
      indexed(3, {
        ...BASE_TRADE,
        id: "valid-a",
        assetSymbol: "ETH",
      }),
      indexed(4, {
        ...BASE_TRADE,
        id: "valid-b",
        assetSymbol: "ETH",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].tradeIds).toEqual(["valid-a", "valid-b"]);
    expect(groups[0].tradeIds).not.toContain("hard-error-id");
    expect(groups[0].tradeIds).not.toContain("otherwise-similar");
  });

  it("does not flag legitimate same-day split orders with different quantities", () => {
    const groups = groupSuspiciousBackupTrades([
      indexed(0, {
        ...BASE_TRADE,
        id: "split-a",
        assetSymbol: "ADA",
        quantity: "10",
        price: "0.25",
        totalValue: "2.5",
      }),
      indexed(1, {
        ...BASE_TRADE,
        id: "split-b",
        assetSymbol: "ADA",
        quantity: "20",
        price: "0.25",
        totalValue: "5",
      }),
    ]);

    expect(groups).toEqual([]);
  });

  it("is stable when callers provide entries in a different order", () => {
    const trades = [
      indexed(9, { ...BASE_TRADE, id: "stable-c" }),
      indexed(1, { ...BASE_TRADE, id: "stable-a" }),
      indexed(4, { ...BASE_TRADE, id: "stable-b" }),
    ];

    expect(groupSuspiciousBackupTrades(trades)).toEqual(
      groupSuspiciousBackupTrades([...trades].reverse()),
    );
  });
});

function indexed(
  originalIndex: number,
  trade: Trade,
): IndexedBackupTrade {
  return { originalIndex, trade };
}
