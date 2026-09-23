"use client";

import { LedgerNumber } from "@/ui";
import { Detail } from "./TradeTableDetail";
import type { useLanguage } from "@/ui";
import type { Trade } from "@/core/models";
import type { calculateTradeCashImpact } from "@/core/calculations";

export function WorkspaceTradeDetailRow({
  cashImpact,
  t,
  trade,
}: Readonly<{
  cashImpact: ReturnType<typeof calculateTradeCashImpact>;
  t: ReturnType<typeof useLanguage>["t"];
  trade: Trade;
}>) {
  return (
                    <tr className="bg-[#fbfaf7]">
                      <td className="px-4 py-4" colSpan={6}>
                        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                          <Detail
                            label={t("trades.table.quantity")}
                            value={<LedgerNumber kind="quantity" value={trade.quantity} />}
                          />
                          <Detail
                            label={t("trades.table.averagePrice")}
                            value={
                              <>
                                <LedgerNumber kind="money" value={trade.price} />{" "}
                                {trade.currency}
                              </>
                            }
                          />
                          <Detail label={t("trades.table.platform")} value={trade.platform ?? t("trades.table.notFilled")} />
                          <Detail
                            label={t("trades.table.feeSource")}
                            value={trade.feeRuleId ? `FeeRule ${trade.feeRuleId}` : t("trades.table.manual")}
                          />
                          <Detail
                            label={t("trades.table.cashImpact")}
                            value={cashImpact.ok ? (
                              <>
                                <LedgerNumber kind="money" value={cashImpact.amount} />{" "}
                                {cashImpact.currency} · {cashImpact.kind === "buy-outflow"
                                  ? t("trades.table.buyOutflow")
                                  : t("trades.table.sellProceeds")}
                              </>
                            ) : `${t("trades.table.unreliablePrefix")}${t("trades.table.unreliableSeparator")}${cashImpact.feeCurrency} ${t("trades.table.unconvertedFee")}`}
                          />
                          <Detail label={t("trades.table.note")} value={trade.note ?? t("trades.table.notFilled")} />
                        </div>
                      </td>
                    </tr>
  );
}
