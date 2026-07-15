"use client";

import { useReducer, type ReactNode } from "react";

import type { Trade } from "../../models";
import { getPositionsFromLedger } from "../../services/positionService";
import { initialLedgerData } from "../../state/initialLedgerData";
import { ledgerReducer } from "../../state/ledgerReducer";

const navItems = ["总览", "买入", "卖出", "交易记录", "价格", "报告", "设置"];

function Section({
  title,
  eyebrow,
  children,
}: Readonly<{
  title: string;
  eyebrow?: string;
  children: ReactNode;
}>) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 text-lg font-semibold text-slate-950">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

export function TradeTable({
  trades,
}: Readonly<{
  trades: readonly Trade[];
}>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="py-2 font-medium">日期</th>
            <th className="py-2 font-medium">类型</th>
            <th className="py-2 font-medium">资产</th>
            <th className="py-2 font-medium">数量</th>
            <th className="py-2 font-medium">均价</th>
            <th className="py-2 font-medium">总金额</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {trades.length === 0 ? (
            <tr>
              <td className="py-8 text-center text-slate-500" colSpan={6}>
                暂无交易。添加交易后，这里会自动显示。
              </td>
            </tr>
          ) : (
            trades.map((trade) => (
              <tr key={trade.id}>
                <td className="py-3 text-slate-600">{trade.occurredAt}</td>
                <td className="py-3 text-slate-600">
                  {trade.type === "buy" ? "买入" : "卖出"}
                </td>
                <td className="py-3 font-medium">{trade.assetSymbol}</td>
                <td className="py-3 text-slate-600">{trade.quantity}</td>
                <td className="py-3 text-slate-600">{trade.price}</td>
                <td className="py-3 text-slate-600">
                  {trade.totalValue} {trade.currency}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardShell() {
  const [ledgerData] = useReducer(ledgerReducer, initialLedgerData);
  const positions = getPositionsFromLedger(ledgerData);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
        <aside className="border-b border-slate-200 bg-white px-5 py-4 lg:w-60 lg:border-b-0 lg:border-r">
          <div className="mb-6">
            <p className="text-sm font-semibold text-slate-950">Local Ledger</p>
            <p className="mt-1 text-xs text-slate-500">Browser-only MVP shell</p>
          </div>
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {navItems.map((item) => (
              <a
                className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                href="#"
                key={item}
              >
                {item}
              </a>
            ))}
          </nav>
          <div className="mt-8 hidden border-t border-slate-200 pt-4 text-sm text-slate-500 lg:block">
            <p>帮助</p>
            <p className="mt-2">快捷键</p>
            <p className="mt-2">切换账本</p>
          </div>
        </aside>

        <div className="flex-1 px-5 py-6 sm:px-8 lg:px-10">
          <header className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">
                Day 4 project shell
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                Local-First Trading Ledger
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                A quiet local-first trading ledger workspace. Today this page is
                only the runnable shell for assets, trades, prices, and future
                calculations.
              </p>
            </div>
            <div className="flex w-full rounded-md border border-slate-200 bg-white p-1 text-sm md:w-auto">
              {["Today", "This Month", "All"].map((item) => (
                <button
                  className="flex-1 rounded px-3 py-2 text-slate-600 first:bg-slate-950 first:text-white md:flex-none"
                  key={item}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </header>

          <div className="grid gap-5">
            <Section eyebrow="Future chart area" title="资产走势">
              <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <div>
                  <p className="font-medium text-slate-700">
                    未来这里显示资产净值曲线和 K 线。
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    Day 4 only reserves the space. No API, no live market data,
                    no chart logic yet.
                  </p>
                </div>
              </div>
            </Section>

            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Section eyebrow="Calculated later" title="资产汇总">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 font-medium">资产</th>
                        <th className="py-2 font-medium">持仓数量</th>
                        <th className="py-2 font-medium">平均成本</th>
                        <th className="py-2 font-medium">当前价格</th>
                        <th className="py-2 font-medium">当前市值</th>
                        <th className="py-2 font-medium">未实现盈亏</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {positions.length === 0 ? (
                        <tr>
                          <td
                            className="py-8 text-center text-slate-500"
                            colSpan={6}
                          >
                            暂无持仓。添加交易后，这里会自动汇总。
                          </td>
                        </tr>
                      ) : (
                        positions.map((position) => (
                          <tr
                            key={`${position.assetSymbol}-${position.currency}`}
                          >
                            <td className="py-3 font-medium">
                              {position.assetSymbol}
                            </td>
                            <td className="py-3 text-slate-600">
                              {position.quantity}
                            </td>
                            <td className="py-3 text-slate-600">
                              {position.averageCost} {position.currency}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.latestPrice === undefined
                                ? "未输入价格"
                                : `${position.latestPrice} ${position.currency}`}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.marketValue === undefined
                                ? "--"
                                : `${position.marketValue} ${position.currency}`}
                            </td>
                            <td className="py-3 text-slate-500">
                              {position.unrealizedPnl === undefined
                                ? "--"
                                : `${position.unrealizedPnl} ${position.currency}`}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section eyebrow="Manual source" title="价格输入">
                <form className="grid gap-4">
                  <label className="grid gap-2 text-sm font-medium">
                    资产代码
                    <input
                      className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
                      placeholder="BTC"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium">
                    当前价格
                    <input
                      className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
                      placeholder="70000"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium">
                    计价货币
                    <input
                      className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
                      defaultValue="USD"
                    />
                  </label>
                  <button
                    className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white"
                    type="button"
                  >
                    保存价格
                  </button>
                </form>
              </Section>
            </div>

            <Section eyebrow="Trade draft" title="新增交易">
              <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ["类型", "买入 / 卖出"],
                  ["资产", "BTC"],
                  ["数量", "0.00016388"],
                  ["成交均价", "67121.7"],
                  ["总金额", "11"],
                  ["日期", "2026-04-02"],
                  ["手续费", "0"],
                  ["备注", "可选"],
                ].map(([label, placeholder]) => (
                  <label className="grid gap-2 text-sm font-medium" key={label}>
                    {label}
                    <input
                      className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
                      placeholder={placeholder}
                    />
                  </label>
                ))}
                <div className="md:col-span-2 xl:col-span-4">
                  <button
                    className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white"
                    type="button"
                  >
                    保存交易
                  </button>
                </div>
              </form>
            </Section>

            <Section eyebrow="LedgerData source" title="交易列表">
              <TradeTable trades={ledgerData.trades} />
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}
