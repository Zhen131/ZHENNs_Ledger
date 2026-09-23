"use client";

import { calculateTradeCashImpact } from "@/core/calculations";
import { isLedgerFactInFuture } from "@/core/shared";
import { ConfirmDeleteButton, LedgerNumber, useLanguage } from "@/ui";
import type { TradeTableProps } from "./tradeTableTypes";

export function LegacyTradeTable({
  trades,
  onDelete,
  deleteDisabled = false,
  todayKey,
}: Omit<TradeTableProps, "variant">) {
  const { t } = useLanguage();
  const columnCount = onDelete ? 10 : 9;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="py-2 font-medium">{t("trades.table.date")}</th>
            <th className="py-2 font-medium">{t("trades.table.type")}</th>
            <th className="py-2 font-medium">{t("trades.table.asset")}</th>
            <th className="py-2 font-medium">{t("trades.table.quantity")}</th>
            <th className="py-2 font-medium">{t("trades.table.averagePriceShort")}</th>
            <th className="py-2 font-medium">{t("trades.table.totalValueExcludingFee")}</th>
            <th className="py-2 font-medium">{t("trades.table.actualFee")}</th>
            <th className="py-2 font-medium">{t("trades.table.platformFeeSource")}</th>
            <th className="py-2 font-medium">{t("trades.table.cashImpact")}</th>
            {onDelete ? <th className="py-2 font-medium">{t("trades.table.actions")}</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {trades.length === 0 ? (
            <tr>
              <td className="py-8 text-center text-slate-500" colSpan={columnCount}>
                {t("trades.table.empty")}
              </td>
            </tr>
          ) : (
            trades.map((trade) => {
              const cashImpact = calculateTradeCashImpact(trade);
              return (
                <tr key={trade.id}>
                  <td className="py-3 text-slate-600">
                    {trade.occurredAt}
                    {todayKey && isLedgerFactInFuture(trade.occurredAt, todayKey) ? (
                      <span className="ml-2 font-medium text-red-700">{t("trades.table.invalidFutureFact")}</span>
                    ) : null}
                  </td>
                  <td className="py-3 text-slate-600">
                    {trade.type === "buy" ? t("trades.type.buy") : t("trades.type.sell")}
                  </td>
                  <td className="py-3 font-medium">{trade.assetSymbol}</td>
                  <td className="py-3 text-slate-600">
                    <LedgerNumber kind="quantity" value={trade.quantity} />
                  </td>
                  <td className="py-3 text-slate-600">
                    <LedgerNumber kind="money" value={trade.price} />
                  </td>
                  <td className="py-3 text-slate-600">
                    <LedgerNumber kind="money" value={trade.totalValue} />{" "}
                    {trade.currency}
                  </td>
                  <td className="py-3 text-slate-600">
                    <LedgerNumber
                      kind={trade.feeCurrency === "USDT" ? "money" : "quantity"}
                      value={trade.fee}
                    />{" "}
                    {trade.feeCurrency}
                  </td>
                  <td className="py-3 text-slate-600">
                    {trade.platform ?? t("trades.table.notFilled")}
                    <span className="block text-xs text-slate-500">
                      {trade.feeRuleId ? `FeeRule ${trade.feeRuleId}` : t("trades.table.manual")}
                    </span>
                  </td>
                  <td className="py-3 text-slate-600">
                    {cashImpact.ok ? (
                      <>
                        <LedgerNumber kind="money" value={cashImpact.amount} />{" "}
                        {cashImpact.currency}
                        <span className="block text-xs text-slate-500">
                          {cashImpact.kind === "buy-outflow"
                            ? t("trades.table.buyOutflow")
                            : t("trades.table.sellProceeds")}
                        </span>
                      </>
                    ) : (
                      <span className="text-amber-800">
                        {t("trades.table.unreliablePrefix")}{t("trades.table.unreliableSeparator")}{cashImpact.feeCurrency} {t("trades.table.unconvertedFee")}
                      </span>
                    )}
                  </td>
                  {onDelete ? (
                    <td className="py-3">
                      <ConfirmDeleteButton
                        ariaLabel={`${t("trades.table.deletePrefix")} ${
                          trade.type === "buy" ? t("trades.type.buy") : t("trades.type.sell")
                        } ${trade.assetSymbol} ${trade.occurredAt}`}
                        disabled={deleteDisabled}
                        label={t("trades.table.delete")}
                        onConfirm={() => onDelete(trade.id)}
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
