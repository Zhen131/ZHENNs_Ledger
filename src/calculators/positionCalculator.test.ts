import { expect, test } from "vitest";

import type { Position } from "../models";
import { createPriceSnapshot, sampleTrades } from "../test/fixtures";
import { isWithinTolerance } from "../utils/decimalMath";
import { calculatePositions } from "./positionCalculator";

function positionFor(positions: Position[], assetSymbol: string): Position {
  const position = positions.find((item) => item.assetSymbol === assetSymbol);

  expect(position, `Expected ${assetSymbol} position to exist`).toBeDefined();

  return position as Position;
}

test("calculates positions, average cost, and realized PnL from buy and sell trades", () => {
  const positions = calculatePositions(sampleTrades);

  const btc = positionFor(positions, "BTC");
  expect(btc.quantity).toBe("0.00016388");
  expect(btc.costBasis).toBe("11");
  assertDecimalClose(btc.averageCost, "67122.28459848669");
  expect(btc.realizedPnl).toBe("0");
  expect(btc.currency).toBe("USD");
  expect(btc.latestPrice).toBeUndefined();
  expect(btc.marketValue).toBeUndefined();
  expect(btc.unrealizedPnl).toBeUndefined();

  const eth = positionFor(positions, "ETH");
  expect(eth.quantity).toBe("0.004854");
  expect(eth.costBasis).toBe("10");
  assertDecimalClose(eth.averageCost, "2060.1565718994643");
  expect(eth.realizedPnl).toBe("0");
  expect(eth.currency).toBe("USD");

  const ada = positionFor(positions, "ADA");
  expect(ada.quantity).toBe("85.3244");
  assertDecimalClose(ada.costBasis, "21.297822152886115445");
  assertDecimalClose(ada.averageCost, "0.24960998439937597504");
  assertDecimalClose(ada.realizedPnl, "-0.702177847113884555");
  expect(ada.currency).toBe("USD");
});

test("calculates market value and unrealized PnL from a price snapshot", () => {
  const positions = calculatePositions(sampleTrades, [
    createPriceSnapshot(
      "price-btc-001",
      "BTC",
      "70000",
      "2026-06-26T10:00:00Z",
    ),
  ]);

  const btc = positionFor(positions, "BTC");
  expect(btc.latestPrice).toBe("70000");
  expect(btc.marketValue).toBe("11.4716");
  expect(btc.unrealizedPnl).toBe("0.4716");
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
      "70000",
      "2026-06-25T10:00:00Z",
    ),
    createPriceSnapshot(
      "price-btc-cny",
      "BTC",
      "500000",
      "2026-06-26T10:00:00Z",
      "CNY",
    ),
  ]);

  const btc = positionFor(positions, "BTC");
  expect(btc.latestPrice).toBe("70000");
  expect(btc.marketValue).toBe("11.4716");
  expect(btc.unrealizedPnl).toBe("0.4716");
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
