import Decimal from "decimal.js";

import type { DecimalString } from "../models";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

export type DecimalInput = DecimalString | number | Decimal;

export type DecimalFormatOptions = {
  decimalPlaces?: number;
  trimTrailingZeros?: boolean;
  rounding?: Decimal.Rounding;
};

export function toDecimal(value: DecimalInput): Decimal {
  try {
    const decimal = value instanceof Decimal ? value : new Decimal(value);

    if (!decimal.isFinite()) {
      throw new Error("Decimal value must be finite");
    }

    return decimal;
  } catch {
    throw new Error(`Invalid decimal value: ${String(value)}`);
  }
}

export function toDecimalString(value: DecimalInput): DecimalString {
  const decimal = toDecimal(value);

  if (decimal.isZero()) {
    return "0";
  }

  return decimal.toString();
}

export function add(left: DecimalInput, right: DecimalInput): DecimalString {
  return toDecimalString(toDecimal(left).plus(toDecimal(right)));
}

export function subtract(left: DecimalInput, right: DecimalInput): DecimalString {
  return toDecimalString(toDecimal(left).minus(toDecimal(right)));
}

export function multiply(left: DecimalInput, right: DecimalInput): DecimalString {
  return toDecimalString(toDecimal(left).times(toDecimal(right)));
}

export function divide(left: DecimalInput, right: DecimalInput): DecimalString {
  const divisor = toDecimal(right);

  if (divisor.isZero()) {
    throw new Error("Cannot divide by zero");
  }

  return toDecimalString(toDecimal(left).div(divisor));
}

export function compare(left: DecimalInput, right: DecimalInput): -1 | 0 | 1 {
  const result = toDecimal(left).cmp(toDecimal(right));

  if (result === null) {
    throw new Error("Invalid decimal comparison");
  }

  if (result > 0) {
    return 1;
  }

  if (result < 0) {
    return -1;
  }

  return 0;
}

export function isZero(value: DecimalInput): boolean {
  return toDecimal(value).isZero();
}

export function isPositive(value: DecimalInput): boolean {
  return toDecimal(value).gt(0);
}

export function isNegative(value: DecimalInput): boolean {
  return toDecimal(value).lt(0);
}

export function isGreaterThan(left: DecimalInput, right: DecimalInput): boolean {
  return compare(left, right) === 1;
}

export function isLessThan(left: DecimalInput, right: DecimalInput): boolean {
  return compare(left, right) === -1;
}

export function isEqual(left: DecimalInput, right: DecimalInput): boolean {
  return compare(left, right) === 0;
}

export function absolute(value: DecimalInput): DecimalString {
  return toDecimalString(toDecimal(value).abs());
}

export function isWithinTolerance(
  actual: DecimalInput,
  expected: DecimalInput,
  tolerance: DecimalInput,
): boolean {
  const toleranceDecimal = toDecimal(tolerance);

  if (toleranceDecimal.isNegative()) {
    throw new Error("Tolerance must be non-negative");
  }

  const difference = toDecimal(actual).minus(toDecimal(expected)).abs();
  return difference.lte(toleranceDecimal);
}

export function formatDecimal(
  value: DecimalInput,
  options: DecimalFormatOptions = {},
): string {
  const decimalPlaces = options.decimalPlaces ?? 2;
  const rounding = options.rounding ?? Decimal.ROUND_HALF_UP;
  const fixed = toDecimal(value)
    .toDecimalPlaces(decimalPlaces, rounding)
    .toFixed(decimalPlaces);

  if (!options.trimTrailingZeros) {
    return fixed;
  }

  return fixed.replace(/(?:\.0+|(\.\d*?)0+)$/, "$1");
}
