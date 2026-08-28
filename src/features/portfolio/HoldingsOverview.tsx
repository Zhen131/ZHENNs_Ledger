import type { DecimalString, Position } from "@/core/models";
import { compare, divide, isZero, subtract } from "@/core/shared";
import { LedgerNumber } from "@/ui";
import type { Ref } from "react";

export function getTopMarketValuePositions(
  positions: readonly Position[],
  limit = 5,
): Position[] {
  return positions
    .filter(
      (position) =>
        !isZero(position.quantity) && position.marketValue !== undefined,
    )
    .map((position) => ({ ...position }))
    .sort((left, right) => {
      const valueOrder = compare(
        right.marketValue ?? "0",
        left.marketValue ?? "0",
      );
      return valueOrder === 0
        ? left.assetSymbol.localeCompare(right.assetSymbol)
        : valueOrder;
    })
    .slice(0, limit);
}

export function calculatePriceChangeRatio(
  position: Pick<
    Position,
    "averageCost" | "feeAccountingIssues" | "latestPrice"
  >,
): DecimalString | undefined {
  if (
    position.feeAccountingIssues !== undefined ||
    position.latestPrice === undefined ||
    isZero(position.averageCost)
  ) {
    return undefined;
  }
  return divide(
    subtract(position.latestPrice, position.averageCost),
    position.averageCost,
  );
}

export function HoldingsOverview({
  positions,
  cashBalance,
  onShowAll,
  triggerRef,
}: Readonly<{
  positions: readonly Position[];
  cashBalance: string;
  onShowAll: () => void;
  triggerRef?: Ref<HTMLButtonElement>;
}>) {
  const topPositions = getTopMarketValuePositions(positions);
  const missingPriceAssets = positions
    .filter(
      (position) =>
        !isZero(position.quantity) && position.marketValue === undefined,
    )
    .map((position) => position.assetSymbol)
    .sort();

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">当前持仓</h3>
          <p className="mt-1 text-xs text-[var(--ledger-muted)]">
            按当前市值展示前五。本表所有数字都只描述现在还持有的部分；持仓均价与剩余持仓成本均已包含手续费。
          </p>
        </div>
        <button
          className="shrink-0 text-sm font-semibold text-[var(--ledger-accent-strong)]"
          onClick={onShowAll}
          ref={triggerRef}
          type="button"
        >
          查看全部持仓
        </button>
      </div>
      {topPositions.length === 0 && cashBalance === "0" ? (
        <p className="mt-3 text-sm text-[var(--ledger-muted)]">
          暂无非零资产；现金 USDT 仍显示为 0。
        </p>
      ) : null}
      <div
        className="mt-3 max-w-full overflow-x-auto"
        data-holdings-scroll="true"
      >
        <table
          aria-label="前五持仓"
          className="w-full min-w-[1120px] border-separate border-spacing-0 text-left text-sm"
        >
          <thead className="text-xs text-[var(--ledger-muted)]">
            <tr>
              {[
                "币种",
                "当前价格",
                "持仓均价",
                "相对均价涨跌",
                "未实现盈亏",
                "持仓量",
                "剩余持仓成本",
                "当前市值",
              ].map((label) => (
                <th
                  className="whitespace-nowrap border-b border-[var(--ledger-border)] px-3 py-2 font-medium first:pl-0 last:pr-0"
                  key={label}
                  scope="col"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-[var(--ledger-surface-muted)]">
              <th
                className="whitespace-nowrap rounded-l-xl px-3 py-3 font-semibold first:pl-3"
                scope="row"
              >
                现金 USDT
              </th>
              <td
                className="rounded-r-xl px-3 py-3 font-semibold"
                colSpan={7}
              >
                余额 <LedgerNumber kind="money" value={cashBalance} /> USDT
              </td>
            </tr>
            {topPositions.map((position) => {
              const hasUnreliableCost =
                position.feeAccountingIssues !== undefined;
              const changeRatio = calculatePriceChangeRatio(position);
              const toneClass = priceChangeTone(changeRatio);
              return (
                <tr
                  className="border-b border-[var(--ledger-border)] last:border-b-0"
                  key={`${position.assetSymbol}-${position.currency}`}
                >
                  <th
                    className="whitespace-nowrap px-3 py-3 font-semibold first:pl-0"
                    scope="row"
                  >
                    {position.assetSymbol}
                  </th>
                  <td className="whitespace-nowrap px-3 py-3">
                    {position.latestPrice === undefined ? (
                      "缺少合法价格"
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
                  <td className="whitespace-nowrap px-3 py-3">
                    {hasUnreliableCost ? (
                      "不可可靠计算"
                    ) : (
                      <>
                        <LedgerNumber
                          kind="money"
                          value={position.averageCost}
                        />{" "}
                        {position.currency}
                      </>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 font-semibold ${toneClass}`}
                  >
                    {hasUnreliableCost ? (
                      "不可可靠计算"
                    ) : changeRatio === undefined ? (
                      "不可计算"
                    ) : (
                      <LedgerNumber kind="percent" value={changeRatio} />
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 font-semibold ${toneClass}`}
                  >
                    {hasUnreliableCost ? (
                      "不可可靠计算"
                    ) : position.unrealizedPnl === undefined ? (
                      "不可完整计算"
                    ) : (
                      <>
                        <LedgerNumber
                          kind="money"
                          value={position.unrealizedPnl}
                        />{" "}
                        {position.currency}
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <LedgerNumber kind="quantity" value={position.quantity} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {hasUnreliableCost ? (
                      "不可可靠计算"
                    ) : (
                      <>
                        <LedgerNumber
                          kind="money"
                          value={position.costBasis}
                        />{" "}
                        {position.currency}
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 last:pr-0">
                    {position.marketValue === undefined ? (
                      "缺少合法价格"
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missingPriceAssets.length > 0 ? (
        <p className="mt-2 text-xs font-medium text-amber-800">
          未参与排名：{missingPriceAssets.join("、")} 缺少合法当前价格。
        </p>
      ) : null}
    </div>
  );
}

function priceChangeTone(ratio: DecimalString | undefined): string {
  if (ratio === undefined) return "text-[var(--ledger-muted)]";
  const direction = compare(ratio, "0");
  if (direction > 0) return "text-emerald-700";
  if (direction < 0) return "text-red-700";
  return "text-[var(--ledger-muted)]";
}
