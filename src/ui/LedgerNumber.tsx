/**
 * 这个文件管界面上显示一个数字的那个小组件。
 * 数字怎么写（几位小数、千位空格）在同目录 `formatLedgerNumber.ts`。
 * 不显然的决定：鼠标悬停和读屏给的是没截短的原数。
 */
import type { DecimalString } from "@/core/models";
import {
  formatMoney,
  formatPercent,
  formatQuantity,
} from "./formatLedgerNumber";

/** 数字的种类：金额、数量、百分比。 */
export type LedgerNumberKind = "money" | "quantity" | "percent";

/**
 * 这个组件按种类把一个数字写成界面上的样子。
 * 比如金额 6505 显示成 "6 505.00"。
 * 鼠标放上去会看到原来的数字文字。
 */
export function LedgerNumber({
  value,
  kind,
  className = "",
}: Readonly<{
  value: DecimalString;
  kind: LedgerNumberKind;
  className?: string;
}>) {
  const formatted = {
    money: formatMoney,
    quantity: formatQuantity,
    percent: formatPercent,
  }[kind](value);

  return (
    <span
      aria-label={value}
      className={`ledger-numeric ${className}`.trim()}
      title={value}
    >
      {formatted}
    </span>
  );
}
