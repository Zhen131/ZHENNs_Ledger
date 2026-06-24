import assert from "node:assert/strict";

import {
  add,
  compare,
  divide,
  formatDecimal,
  isWithinTolerance,
  multiply,
  subtract,
  toDecimalString,
} from "./decimalMath";

function test(name: string, run: () => void) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("normalizes decimal strings for storage without losing precision", () => {
  assert.equal(toDecimalString("001.2300"), "1.23");
});

test("rejects invalid decimal input", () => {
  assert.throws(() => toDecimalString("not-a-number"), /Invalid decimal value/);
});

test("adds decimal strings without JavaScript floating-point drift", () => {
  assert.equal(add("0.1", "0.2"), "0.3");
});

test("subtracts decimal strings exactly", () => {
  assert.equal(subtract("1", "0.9"), "0.1");
});

test("multiplies trade quantity and price with decimal arithmetic", () => {
  assert.equal(multiply("0.00016388", "67121.7"), "10.999904196");
});

test("divides cost basis by quantity for average cost", () => {
  assert.equal(formatDecimal(divide("42", "168.2625"), { decimalPlaces: 4 }), "0.2496");
});

test("compares numeric meaning instead of string ordering", () => {
  assert.equal(compare("10", "2"), 1);
  assert.equal(compare("2.00", "2"), 0);
  assert.equal(compare("0.5", "1"), -1);
});

test("checks total-value tolerance using absolute decimal difference", () => {
  assert.equal(isWithinTolerance("10.999904196", "11", "0.01"), true);
  assert.equal(isWithinTolerance("10.75", "11", "0.01"), false);
});
