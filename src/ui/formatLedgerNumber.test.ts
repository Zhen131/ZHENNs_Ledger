import { describe, expect, it } from "vitest";

import {
  formatMoney,
  formatPercent,
  formatQuantity,
} from "./formatLedgerNumber";

describe("formatLedgerNumber", () => {
  it.each([
    ["594.862375883946480045", "594.86"],
    ["6492.3391", "6 492.34"],
    ["0.0003", "0.0003"],
    ["0.5", "0.50"],
    ["0", "0.00"],
    ["94288.5", "94 288.50"],
    ["0.6134", "0.6134"],
    ["0.000000134", "0.000000134"],
    ["-1234.5678", "-1 234.57"],
  ] as const)("formats money %s as %s", (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });

  it.each([
    ["0.03619818", "0.03619818"],
    ["0.6177", "0.6177"],
    ["4818.72", "4 818.72"],
    ["6638.73487823", "6 638.7349"],
    ["300", "300"],
    ["0", "0"],
  ] as const)("formats quantity %s as %s", (input, expected) => {
    expect(formatQuantity(input)).toBe(expected);
  });

  it.each([
    ["-0.1814", "-18.14%"],
    ["0.0679", "+6.79%"],
    ["0", "0.00%"],
  ] as const)("formats ratio %s as %s", (input, expected) => {
    expect(formatPercent(input)).toBe(expected);
  });

  it("uses decimal exponent boundaries and caps display precision at twelve decimals", () => {
    expect(formatMoney("0.9999994")).toBe("0.999999");
    expect(formatMoney("0.9999995")).toBe("1.00");
    expect(formatQuantity("0.000000000000499999999999")).toBe("0");
    expect(formatQuantity("0.0000000000005")).toBe("0.000000000001");
  });

  it("rounds half up without converting through JavaScript floating point", () => {
    expect(formatMoney("1.005")).toBe("1.01");
    expect(formatMoney("-1.005")).toBe("-1.01");
    expect(formatPercent("12.34565")).toBe("+1 234.57%");
  });
});
