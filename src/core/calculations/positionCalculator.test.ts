import { expect, test } from "vitest";

import type { Position } from "@/core/models";
import { createPriceSnapshot, sampleTrades } from "@/test-support";
import { isWithinTolerance } from "@/core/shared";
import { calculatePositions } from "./positionCalculator";

function positionFor(positions: Position[], assetSymbol: string): Position {
  const position = positions.find((item) => item.assetSymbol === assetSymbol);

  expect(position, `Expected ${assetSymbol} position to exist`).toBeDefined();

  return position as Position;
}

test("calculates positions, average cost, and realized PnL from buy and sell trades", () => {
  const positions = calculatePositions(sampleTrades);

  const btc = positionFor(positions, "BTC");
  expect(btc.quantity).toBe("2");
  expect(btc.costBasis).toBe("20");
  assertDecimalClose(btc.averageCost, "10");
  expect(btc.realizedPnl).toBe("0");
  expect(btc.currency).toBe("USDT");
  expect(btc.latestPrice).toBeUndefined();
  expect(btc.marketValue).toBeUndefined();
  expect(btc.unrealizedPnl).toBeUndefined();

  const eth = positionFor(positions, "ETH");
  expect(eth.quantity).toBe("3");
  expect(eth.costBasis).toBe("24");
  assertDecimalClose(eth.averageCost, "8");
  expect(eth.realizedPnl).toBe("0");
  expect(eth.currency).toBe("USDT");

  const ada = positionFor(positions, "ADA");
  expect(ada.quantity).toBe("15");
  assertDecimalClose(ada.costBasis, "30");
  assertDecimalClose(ada.averageCost, "2");
  assertDecimalClose(ada.realizedPnl, "30");
  expect(ada.currency).toBe("USDT");
});

test("calculates market value and unrealized PnL from a price snapshot", () => {
  const positions = calculatePositions(sampleTrades, [
    createPriceSnapshot(
      "price-btc-001",
      "BTC",
      "15",
      "2026-06-26T10:00:00Z",
    ),
  ]);

  const btc = positionFor(positions, "BTC");
  expect(btc.latestPrice).toBe("15");
  expect(btc.marketValue).toBe("30");
  expect(btc.unrealizedPnl).toBe("10");
  expect(btc.realizedPnl).toBe("0");
});

test("uses the latest recordedAt snapshot for each asset", () => {
  const positions = calculatePositions(sampleTrades, [
    createPriceSnapshot(
      "price-btc-newer",
      "BTC",
      "70000",
      "2026-06-26T10:00:00Z",
    ),
    createPriceSnapshot(
      "price-btc-older",
      "BTC",
      "68000",
      "2026-06-25T10:00:00Z",
    ),
    createPriceSnapshot(
      "price-ada-latest",
      "ADA",
      "0.3",
      "2026-06-26T11:00:00Z",
    ),
  ]);

  expect(positionFor(positions, "BTC").latestPrice).toBe("70000");
  expect(positionFor(positions, "ADA").latestPrice).toBe("0.3");
  expect(positionFor(positions, "ETH").latestPrice).toBeUndefined();
});

test("uses the later input snapshot when recordedAt values are equal", () => {
  const positions = calculatePositions(sampleTrades, [
    createPriceSnapshot(
      "price-btc-first",
      "BTC",
      "69000",
      "2026-06-26T10:00:00Z",
    ),
    createPriceSnapshot(
      "price-btc-correction",
      "BTC",
      "70000",
      "2026-06-26T10:00:00Z",
    ),
  ]);

  expect(positionFor(positions, "BTC").latestPrice).toBe("70000");
});

test("uses the latest matching-currency snapshot and ignores newer mismatches", () => {
  const positions = calculatePositions(sampleTrades, [
    createPriceSnapshot(
      "price-btc-usd",
      "BTC",
      "15",
      "2026-06-25T10:00:00Z",
    ),
    createPriceSnapshot(
      "price-btc-cny",
      "BTC",
      "99",
      "2026-06-26T10:00:00Z",
      "CNY" as never,
    ),
  ]);

  const btc = positionFor(positions, "BTC");
  expect(btc.latestPrice).toBe("15");
  expect(btc.marketValue).toBe("30");
  expect(btc.unrealizedPnl).toBe("10");
});

test("rejects selling more than the current position", () => {
  expect(
    () =>
      calculatePositions([
        {
          ...sampleTrades[0],
          id: "trade-oversell",
          type: "sell",
          quantity: "1",
          totalValue: "1",
        },
      ]),
  ).toThrow(/Cannot sell more BTC than current position/);
});

function assertDecimalClose(actual: string, expected: string) {
  expect(isWithinTolerance(actual, expected, "0.0000000001")).toBe(true);
}
