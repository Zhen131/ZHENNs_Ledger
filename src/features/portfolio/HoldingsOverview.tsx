/**
 * 这个文件管首页的持仓概览表。
 * 完整的持仓明细不在这里，在 `HoldingsDetails.tsx`。
 * 不显然的决定：概览只放市值前 5 的币；为什么是 5，这是猜的，要核。
 */
import type { DecimalString, Position } from "@/core/models";
import { compare, divide, isZero, subtract } from "@/core/shared";
import { LedgerNumber, useLanguage } from "@/ui";
import type { Ref } from "react";

/**
 * 这个函数回答：有价格的持仓里，市值最大的是哪几个？
 * 市值一样时按币的代码字母顺序排。
 * 举例：BTC 市值 4200，ETH 3000，ADA 没价格 → 答 BTC、ETH。
 * 数量为 0 或缺价格的币不进结果。
 * 默认最多给 5 个。
 * 不会出错。
 */
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
        ? left.assetSymbol < right.assetSymbol
          ? -1
          : left.assetSymbol > right.assetSymbol
            ? 1
            : 0
        : valueOrder;
    })
    .slice(0, limit);
}

/**
 * 这个函数回答：最新价格比平均成本涨跌了多少？
 * 举例：平均成本 65050，最新价格 70000 → 答约 0.0761，即涨约 7.6%。
 * 三种情况返回空，表格显示「不可用」。
 * 它们是：没有最新价格、平均成本是 0、手续费算不准。
 * 不会出错。
 */
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

/**
 * 这个组件画首页的持仓概览表。
 * 第一行是现金余额，下面是市值最大的几种币。
 * 每行有价格、成本、涨跌、盈亏、数量和市值。
 * 点「查看全部」会叫 `onShowAll`，打开完整明细。
 * 缺价格的币不进表，表下面会列出它们的名字。
 */
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
  const { t } = useLanguage();
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
          <h3 className="font-semibold">{t("portfolio.overview.heading")}</h3>
          <p className="mt-1 text-xs text-[var(--ledger-muted)]">
            {t("portfolio.overview.description")}
          </p>
        </div>
        <button
          className="shrink-0 text-sm font-semibold text-[var(--ledger-accent-strong)]"
          onClick={onShowAll}
          ref={triggerRef}
          type="button"
        >
          {t("portfolio.overview.showAll")}
        </button>
      </div>
      {topPositions.length === 0 && cashBalance === "0" ? (
        <p className="mt-3 text-sm text-[var(--ledger-muted)]">
          {t("portfolio.overview.empty")}
        </p>
      ) : null}
      <div
        className="mt-3 max-w-full overflow-x-auto"
        data-holdings-scroll="true"
      >
        <table
          aria-label={t("portfolio.overview.tableAriaLabel")}
          className="w-full min-w-[1120px] border-separate border-spacing-0 text-left text-sm"
        >
          <thead className="text-xs text-[var(--ledger-muted)]">
            <tr>
              {[
                t("portfolio.overview.column.asset"),
                t("portfolio.overview.column.latestPrice"),
                t("portfolio.overview.column.averageCost"),
                t("portfolio.overview.column.priceChange"),
                t("portfolio.overview.column.unrealizedPnl"),
                t("portfolio.overview.column.quantity"),
                t("portfolio.overview.column.costBasis"),
                t("portfolio.overview.column.marketValue"),
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
                {t("portfolio.overview.cash")}
              </th>
              <td
                className="rounded-r-xl px-3 py-3 font-semibold"
                colSpan={7}
              >
                {t("portfolio.overview.balance")} <LedgerNumber kind="money" value={cashBalance} /> USDT
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
                      t("portfolio.overview.missingPrice")
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
                      t("portfolio.overview.unreliable")
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
                      t("portfolio.overview.unreliable")
                    ) : changeRatio === undefined ? (
                      t("portfolio.overview.unavailable")
                    ) : (
                      <LedgerNumber kind="percent" value={changeRatio} />
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 font-semibold ${toneClass}`}
                  >
                    {hasUnreliableCost ? (
                      t("portfolio.overview.unreliable")
                    ) : position.unrealizedPnl === undefined ? (
                      t("portfolio.overview.incomplete")
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
                      t("portfolio.overview.unreliable")
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
                      t("portfolio.overview.missingPrice")
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
          {t("portfolio.overview.excludedPrefix")}{missingPriceAssets.join(t("portfolio.overview.joinSeparator"))}{t("portfolio.overview.excludedSuffix")}
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
