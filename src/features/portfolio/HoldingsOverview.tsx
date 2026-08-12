import type { Position } from "@/core/models";
import { compare, isZero } from "@/core/shared";
import type { Ref } from "react";

export function getTopMarketValuePositions(
  positions: readonly Position[],
  limit = 3,
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

export function HoldingsOverview({
  positions,
  onShowAll,
  triggerRef,
}: Readonly<{
  positions: readonly Position[];
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
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">主要持仓</h3>
        <button
          className="text-sm font-semibold text-[var(--ledger-accent-strong)]"
          onClick={onShowAll}
          ref={triggerRef}
          type="button"
        >
          查看全部持仓
        </button>
      </div>
      {topPositions.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--ledger-muted)]">
          暂无可按当前市值排序的非零持仓。
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 min-[1100px]:mt-2 min-[1100px]:gap-1">
          {topPositions.map((position) => (
            <li
              className="flex min-w-0 flex-col items-start justify-between gap-1 rounded-xl bg-[var(--ledger-surface-muted)] px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3 min-[1100px]:py-1.5"
              key={`${position.assetSymbol}-${position.currency}`}
            >
              <span>
                <strong>{position.assetSymbol}</strong>
                <span className="ml-2 text-xs text-[var(--ledger-muted)]">
                  {position.quantity}
                </span>
              </span>
              <span className="ledger-numeric max-w-full break-all text-sm font-semibold">
                {position.marketValue} {position.currency}
              </span>
            </li>
          ))}
        </ul>
      )}
      {missingPriceAssets.length > 0 ? (
        <p className="mt-2 text-xs font-medium text-amber-800">
          未参与排名：{missingPriceAssets.join("、")} 缺少合法当前价格。
        </p>
      ) : null}
    </div>
  );
}
