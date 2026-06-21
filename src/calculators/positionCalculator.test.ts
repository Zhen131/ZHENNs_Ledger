import assert from "node:assert/strict";

import type { Position, Trade } from "../models";
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

const sampleTrades: Trade[] = [
  {
    id: "trade-001",
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "BTC",
    quantity: "0.00016388",
    price: "67121.7",
    totalValue: "11",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "以均价 67121.7 买入 BTC 0.00016388 个，价值 11 USD，26/04/02",
    createdAt: "2026-06-22T00:00:00Z",
    updatedAt: "2026-06-22T00:00:00Z",
  },
  {
    id: "trade-002",
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ETH",
    quantity: "0.004854",
    price: "2059.99",
    totalValue: "10",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "以均价 2059.99 买入 ETH 0.004854 个，价值 10 USD，26/04/02",
    createdAt: "2026-06-22T00:00:00Z",
    updatedAt: "2026-06-22T00:00:00Z",
  },
  {
    id: "trade-003",
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "41.58",
    price: "0.2405",
    totalValue: "10",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "以均价 0.2405 买入 ADA 41.58 个，价值 10 USD，26/04/02",
    createdAt: "2026-06-22T00:00:00Z",
    updatedAt: "2026-06-22T00:00:00Z",
  },
  {
    id: "trade-004",
    occurredAt: "2026-04-09",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "126.6825",
    price: "0.2526",
    totalValue: "32",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "以均价 0.2526 买入 ADA 126.6825 个，价值 32 USD，26/04/09",
    createdAt: "2026-06-22T00:00:00Z",
    updatedAt: "2026-06-22T00:00:00Z",
  },
  {
    id: "trade-005",
    occurredAt: "2026-04-14",
    timePrecision: "day",
    type: "sell",
    assetSymbol: "ADA",
    quantity: "82.9381",
    price: "0.2412",
    totalValue: "20",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "以均价 0.2412 卖出 ADA 82.9381 个，价值 20 USD，26/04/14",
    createdAt: "2026-06-22T00:00:00Z",
    updatedAt: "2026-06-22T00:00:00Z",
  },
];

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
