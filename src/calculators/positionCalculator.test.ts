import assert from "node:assert/strict";

import type { Position } from "../models";
import { sampleTrades } from "../test/fixtures";
import { isWithinTolerance } from "../utils/decimalMath";
import { calculatePositions } from "./positionCalculator";

function test(name: string, run: () => void) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function positionFor(positions: Position[], assetSymbol: string): Position {
  const position = positions.find((item) => item.assetSymbol === assetSymbol);

  assert.ok(position, `Expected ${assetSymbol} position to exist`);

  return position;
}

test("calculates positions, average cost, and realized PnL from buy and sell trades", () => {
  const positions = calculatePositions(sampleTrades);

  const btc = positionFor(positions, "BTC");
  assert.equal(btc.quantity, "0.00016388");
  assert.equal(btc.costBasis, "11");
  assertDecimalClose(btc.averageCost, "67122.28459848669");
  assert.equal(btc.realizedPnl, "0");
  assert.equal(btc.currency, "USD");

  const eth = positionFor(positions, "ETH");
  assert.equal(eth.quantity, "0.004854");
  assert.equal(eth.costBasis, "10");
  assertDecimalClose(eth.averageCost, "2060.1565718994643");
  assert.equal(eth.realizedPnl, "0");
  assert.equal(eth.currency, "USD");

  const ada = positionFor(positions, "ADA");
  assert.equal(ada.quantity, "85.3244");
  assertDecimalClose(ada.costBasis, "21.297822152886115445");
  assertDecimalClose(ada.averageCost, "0.24960998439937597504");
  assertDecimalClose(ada.realizedPnl, "-0.702177847113884555");
  assert.equal(ada.currency, "USD");
});

test("rejects selling more than the current position", () => {
  assert.throws(
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
    /Cannot sell more BTC than current position/,
  );
});

function assertDecimalClose(actual: string, expected: string) {
  assert.equal(isWithinTolerance(actual, expected, "0.0000000001"), true);
}
