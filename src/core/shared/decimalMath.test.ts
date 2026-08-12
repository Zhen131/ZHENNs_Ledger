import { expect, test } from "vitest";

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

test("normalizes decimal strings for storage without losing precision", () => {
  expect(toDecimalString("001.2300")).toBe("1.23");
});

test("rejects invalid decimal input", () => {
  expect(() => toDecimalString("not-a-number")).toThrow(
    /Invalid decimal value/,
  );
});

test("adds decimal strings without JavaScript floating-point drift", () => {
  expect(add("0.1", "0.2")).toBe("0.3");
});

test("subtracts decimal strings exactly", () => {
  expect(subtract("1", "0.9")).toBe("0.1");
});

test("multiplies trade quantity and price with decimal arithmetic", () => {
  expect(multiply("0.00016388", "67121.7")).toBe("10.999904196");
});

test("divides cost basis by quantity for average cost", () => {
  expect(
    formatDecimal(divide("42", "168.2625"), { decimalPlaces: 4 }),
  ).toBe("0.2496");
});

test("compares numeric meaning instead of string ordering", () => {
  expect(compare("10", "2")).toBe(1);
  expect(compare("2.00", "2")).toBe(0);
  expect(compare("0.5", "1")).toBe(-1);
});

test("checks total-value tolerance using absolute decimal difference", () => {
  expect(isWithinTolerance("10.999904196", "11", "0.01")).toBe(true);
  expect(isWithinTolerance("10.75", "11", "0.01")).toBe(false);
});
