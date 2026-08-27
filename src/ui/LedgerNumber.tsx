import type { DecimalString } from "@/core/models";
import {
  formatMoney,
  formatPercent,
  formatQuantity,
} from "./formatLedgerNumber";

export type LedgerNumberKind = "money" | "quantity" | "percent";

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
