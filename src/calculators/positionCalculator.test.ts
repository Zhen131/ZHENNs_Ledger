import { expect, test } from "vitest";

import type { Position } from "../models";
import { sampleTrades } from "../test/fixtures";
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
