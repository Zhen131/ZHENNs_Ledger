/**
 * 这个文件管金额和数量的精确计算。
 * 加减乘除、比大小、保留小数都在这里。
 * 它不管一个数代表什么钱，那是 calculations 区的事；也不管界面怎么排版数字。
 * 不显然的决定：一律用 40 位精度的十进制小数算，不用 JavaScript 的 number，2026-08-10 定（W12 02A 第 5.1 节）。
 */

import Decimal from "decimal.js";

import type { DecimalString } from "@/core/models";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

type DecimalInput = DecimalString | number | Decimal;

type DecimalFormatOptions = {
  decimalPlaces?: number;
  trimTrailingZeros?: boolean;
  rounding?: Decimal.Rounding;
};

/**
 * 这个函数把一个数（文字、number 或 Decimal）变成能精确计算的 Decimal。
 * 举例：传 "6500.5" → 答 Decimal 6500.5。
 * 传 "abc" 或无穷大时会抛错，说明这个值不是一个有限的数。
 */
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

/**
 * 这个函数把一个数变成账本里存的那种数字文字。
 * 举例：6500.50 → 答 "6500.5"；-0 → 答 "0"。
 * 不是有限的数时抛错，和 toDecimal 一样。
 */
export function toDecimalString(value: DecimalInput): DecimalString {
  const decimal = toDecimal(value);

  if (decimal.isZero()) {
    return "0";
  }

  return decimal.toString();
}

/**
 * 这个函数回答两个数相加等于几，结果是数字文字。
 * 举例：6500 加手续费 5 → 答 "6505"。
 */
export function add(left: DecimalInput, right: DecimalInput): DecimalString {
  return toDecimalString(toDecimal(left).plus(toDecimal(right)));
}

/**
 * 这个函数回答左边减右边等于几，结果是数字文字。
 * 举例：成交金额 2800 减手续费 3 → 答 "2797"。
 */
export function subtract(left: DecimalInput, right: DecimalInput): DecimalString {
  return toDecimalString(toDecimal(left).minus(toDecimal(right)));
}

/**
 * 这个函数回答两个数相乘等于几，结果是数字文字。
 * 举例：0.1 BTC 乘单价 65000 → 答 "6500"。
 */
export function multiply(left: DecimalInput, right: DecimalInput): DecimalString {
  return toDecimalString(toDecimal(left).times(toDecimal(right)));
}

/**
 * 这个函数回答左边除以右边等于几，结果是数字文字。
 * 举例：成本 6505 除以 0.1 BTC → 答 "65050"。
 * 除数是 0 时抛错，不返回无穷大。
 */
export function divide(left: DecimalInput, right: DecimalInput): DecimalString {
  const divisor = toDecimal(right);

  if (divisor.isZero()) {
    throw new Error("Cannot divide by zero");
  }

  return toDecimalString(toDecimal(left).div(divisor));
}

/**
 * 这个函数比两个数谁大：左边大答 1，一样大答 0，左边小答 -1。
 * 举例：比 "0.04" 和 "0.1" → 答 -1。
 */
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

/** 这个函数回答一个数是不是 0。举例："0.000" → 答是。 */
export function isZero(value: DecimalInput): boolean {
  return toDecimal(value).isZero();
}

/** 这个函数回答一个数是不是大于 0。举例："0.01" → 答是。 */
export function isPositive(value: DecimalInput): boolean {
  return toDecimal(value).gt(0);
}

/** 这个函数回答一个数是不是小于 0。举例："-3" → 答是。 */
export function isNegative(value: DecimalInput): boolean {
  return toDecimal(value).lt(0);
}

/** 这个函数回答左边是不是比右边大。举例：0.1 比 0.04 → 答是。 */
export function isGreaterThan(left: DecimalInput, right: DecimalInput): boolean {
  return compare(left, right) === 1;
}

/** 这个函数回答左边是不是比右边小。举例：0.04 比 0.1 → 答是。 */
export function isLessThan(left: DecimalInput, right: DecimalInput): boolean {
  return compare(left, right) === -1;
}

/** 这个函数回答两个数是不是一样大。举例："1.50" 和 "1.5" → 答是。 */
export function isEqual(left: DecimalInput, right: DecimalInput): boolean {
  return compare(left, right) === 0;
}

/** 这个函数回答一个数去掉正负号以后是几。举例："-2797" → 答 "2797"。 */
export function absolute(value: DecimalInput): DecimalString {
  return toDecimalString(toDecimal(value).abs());
}

/**
 * 这个函数回答两个数相差有没有超过允许差多少。
 * 举例：918.879 和 918.88，允许差 0.01 → 答没超过。
 * 允许差多少是负数时抛错。
 */
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

/**
 * 这个函数把一个数按指定位数四舍五入，变成给人看的文字。
 * 默认保留 2 位；可以选择去掉末尾多余的 0。
 * 举例：6505.456 → 答 "6505.46"；去掉末尾 0 时 2797.10 → 答 "2797.1"。
 * 不是有限的数时抛错。
 */
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
