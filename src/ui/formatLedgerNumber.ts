/**
 * 这个文件管界面上金额、数量、百分比怎么显示。
 * 它只管显示，不参与任何计算；算钱在 `core` 里。
 * 不显然的决定：千位之间用空格分开，不用逗号，也不随语言变。
 * 不随语言变，2026-09-07 定（W16 04A 修订 B 第五节 D-15）。
 */
import Decimal from "decimal.js";

import type { DecimalString } from "@/core/models";
import { formatDecimal, toDecimal } from "@/core/shared";

type LedgerNumberFormat = {
  significantDigits: number;
  fixedDecimalsWhenAtLeastOne: number | null;
  maxDecimals: number;
};

// 金额：保留 6 位有效数字；大于等于 1 时固定 2 位小数；最多 12 位小数。
// 为什么是这几个数：原来金额会显示二十位小数，没法读。
// 2026-08-27 定（W15 01A 第二部分第十一、十二节）。
const MONEY_FORMAT = {
  significantDigits: 6,
  fixedDecimalsWhenAtLeastOne: 2,
  maxDecimals: 12,
} as const satisfies LedgerNumberFormat;

// 数量：保留 8 位有效数字，不固定小数位，最多 12 位小数。理由和出处同上。
const QUANTITY_FORMAT = {
  significantDigits: 8,
  fixedDecimalsWhenAtLeastOne: null,
  maxDecimals: 12,
} as const satisfies LedgerNumberFormat;

/**
 * 这个函数回答：一个金额在界面上写成什么样？
 * 大于等于 1 的固定两位小数；小于 1 的留 6 位有效数字。
 * 举例：6505 → 答 "6 505.00"；0.000123456789 → 答 "0.000123457"。
 * 四舍五入到最近的一位。不是合法数字文字时会抛错。
 */
export function formatMoney(value: DecimalString): string {
  return formatWithRules(value, MONEY_FORMAT);
}

/**
 * 这个函数回答：一个数量在界面上写成什么样？
 * 留 8 位有效数字，末尾多余的 0 去掉。
 * 举例：0.1 BTC → 答 "0.1"；1234.5678 → 答 "1 234.5678"。
 * 不是合法数字文字时会抛错。
 */
export function formatQuantity(value: DecimalString): string {
  return formatWithRules(value, QUANTITY_FORMAT);
}

/**
 * 这个函数回答：一个比例写成百分比是什么样？
 * 乘 100，留两位小数；正数前面加加号。
 * 举例：0.0523 → 答 "+5.23%"；-0.1 → 答 "-10.00%"；0 → 答 "0.00%"。
 * 不是合法数字文字时会抛错。
 */
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
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const signedGroupedInteger = isNegative
    ? `-${groupedInteger}`
    : groupedInteger;

  return fraction === undefined
    ? signedGroupedInteger
    : `${signedGroupedInteger}.${fraction}`;
}
