"use client";

import { LedgerNumber, type useLanguage } from "@/ui";
import { Section } from "./Section";
import type { DashboardDerivations } from "./dashboardDerivations";

export function DashboardShellAssetsSection({
  positions,
  t,
}: Readonly<{
  positions: DashboardDerivations["projection"]["positions"];
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
              <Section title={t("dashboard.section.assets")}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 font-medium">{t("dashboard.assets.asset")}</th>
                        <th className="py-2 font-medium">{t("dashboard.assets.quantity")}</th>
                        <th className="py-2 font-medium">{t("dashboard.assets.averagePrice")}</th>
                        <th className="py-2 font-medium">{t("dashboard.pnl.remainingCostBasis")}</th>
                        <th className="py-2 font-medium">{t("dashboard.pnl.realized")}</th>
                        <th className="py-2 font-medium">{t("dashboard.assets.currentPrice")}</th>
                        <th className="py-2 font-medium">{t("dashboard.assets.marketValue")}</th>
                        <th className="py-2 font-medium">{t("dashboard.pnl.unrealized")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {positions.length === 0 ? (
                        <tr>
                          <td
                            className="py-8 text-center text-slate-500"
                            colSpan={8}
                          >
                            {t("dashboard.assets.empty")}
                          </td>
                        </tr>
                      ) : (
                        positions.map((position) => {
                          const feeAccountingReliable =
                            !position.feeAccountingIssues;
                          return (
                          <tr
                            key={`${position.assetSymbol}-${position.currency}`}
                          >
                            <td className="py-3 font-medium">
                              <span>{position.assetSymbol}</span>
                              {!feeAccountingReliable ? (
                                <span className="mt-1 block text-xs font-normal text-amber-800">
                                  {t("dashboard.assets.unconvertedFee")}
                                </span>
                              ) : null}
                            </td>
                            <td className="py-3 text-slate-600">
                              <LedgerNumber
                                kind="quantity"
                                value={position.quantity}
                              />
                            </td>
                            <td className="py-3 text-slate-600">
                              {feeAccountingReliable ? (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.averageCost}
                                  />{" "}
                                  {position.currency}
                                </>
                              ) : (
                                t("dashboard.assets.unreliable")
                              )}
                            </td>
                            <td className="py-3 text-slate-600">
                              {feeAccountingReliable ? (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.costBasis}
                                  />{" "}
                                  {position.currency}
                                </>
                              ) : (
                                t("dashboard.assets.unreliable")
                              )}
                            </td>
                            <td className="py-3 text-slate-600">
                              {feeAccountingReliable ? (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.realizedPnl}
                                  />{" "}
                                  {position.currency}
                                </>
                              ) : (
                                t("dashboard.assets.unreliable")
                              )}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.latestPrice === undefined ? (
                                t("dashboard.assets.noEnteredPrice")
                              ) : (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.latestPrice}
                                  />{" "}
                                  {position.currency}
                                </>
                              )}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.marketValue === undefined ? (
                                "--"
                              ) : (
                                <>
                                  <LedgerNumber
                                    kind="money"
                                    value={position.marketValue}
                                  />{" "}
                                  {position.currency}
                                </>
                              )}
                            </td>
                            <td className="py-3 text-slate-500">
                              {!feeAccountingReliable
                                ? t("dashboard.assets.unreliable")
                                : position.unrealizedPnl === undefined
                                  ? t("dashboard.assets.missingValidPrice")
                                  : (
                                      <>
                                        <LedgerNumber
                                          kind="money"
                                          value={position.unrealizedPnl}
                                        />{" "}
                                        {position.currency}
                                      </>
                                    )}
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>
  );
}
