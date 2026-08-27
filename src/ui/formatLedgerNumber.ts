import Decimal from "decimal.js";

import type { DecimalString } from "@/core/models";
import { formatDecimal, toDecimal } from "@/core/shared";

export type LedgerNumberFormat = {
  significantDigits: number;
  fixedDecimalsWhenAtLeastOne: number | null;
  maxDecimals: number;
};

export const MONEY_FORMAT = {
  significantDigits: 6,
  fixedDecimalsWhenAtLeastOne: 2,
  maxDecimals: 12,
} as const satisfies LedgerNumberFormat;

export const QUANTITY_FORMAT = {
  significantDigits: 8,
  fixedDecimalsWhenAtLeastOne: null,
  maxDecimals: 12,
} as const satisfies LedgerNumberFormat;

export function formatMoney(value: DecimalString): string {
  return formatWithRules(value, MONEY_FORMAT);
}

export function formatQuantity(value: DecimalString): string {
  return formatWithRules(value, QUANTITY_FORMAT);
}

export function formatPercent(ratio: DecimalString): string {
  const decimal = toDecimal(ratio);
  const fixed = formatDecimal(decimal.times(100), {
    decimalPlaces: 2,
    rounding: Decimal.ROUND_HALF_UP,
  });
  const formatted = insertThousandsSeparators(fixed);

  if (decimal.gt(0)) {
    return `+${formatted}%`;
  }
  return `${formatted}%`;
}

function formatWithRules(
  value: DecimalString,
  format: LedgerNumberFormat,
): string {
  const decimal = toDecimal(value);
  const minimumDecimals = format.fixedDecimalsWhenAtLeastOne ?? 0;
  let places: number;
  let trim: boolean;

  if (decimal.isZero()) {
    places = minimumDecimals;
    trim = false;
  } else if (
    decimal.abs().gte(1) &&
    format.fixedDecimalsWhenAtLeastOne !== null
  ) {
    places = format.fixedDecimalsWhenAtLeastOne;
    trim = false;
  } else {
    const exponent = decimal.abs().e;
    places = format.significantDigits - 1 - exponent;
    places = Math.min(places, format.maxDecimals);
    places = Math.max(places, minimumDecimals, 0);
    trim = true;
  }

  const fixed = formatDecimal(decimal, {
    decimalPlaces: places,
    rounding: Decimal.ROUND_HALF_UP,
  });
  const display = trim
    ? trimTrailingZeros(fixed, minimumDecimals)
    : fixed;
  return insertThousandsSeparators(display);
}

function trimTrailingZeros(value: string, minimumDecimals: number): string {
  const pointIndex = value.indexOf(".");
  if (pointIndex === -1) return value;

  const integer = value.slice(0, pointIndex);
  let fraction = value.slice(pointIndex + 1);
  while (fraction.length > minimumDecimals && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }

  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

function insertThousandsSeparators(value: string): string {
  const [signedInteger, fraction] = value.split(".");
  const isNegative = signedInteger.startsWith("-");
  const integer = isNegative ? signedInteger.slice(1) : signedInteger;
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const signedGroupedInteger = isNegative
    ? `-${groupedInteger}`
    : groupedInteger;

  return fraction === undefined
    ? signedGroupedInteger
    : `${signedGroupedInteger}.${fraction}`;
}
