// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Position } from "@/core/models";
import { HoldingsDetails } from "./HoldingsDetails";
import {
  getTopMarketValuePositions,
  HoldingsOverview,
} from "./HoldingsOverview";

afterEach(cleanup);

function position(
  assetSymbol: string,
  marketValue?: string,
): Position {
  return {
    assetSymbol,
    quantity: "1",
    averageCost: "1",
    costBasis: "1",
    ...(marketValue === undefined ? {} : { marketValue }),
    realizedPnl: "0",
    currency: "USDT",
  };
}

describe("holdings workspace views", () => {
  it("sorts top holdings with decimal comparison and does not mutate input", () => {
    const input = [
      position("BTC", "9"),
      position("ETH", "100000000000000000000"),
      position("ADA"),
      position("SOL", "10"),
    ];
    expect(getTopMarketValuePositions(input).map((item) => item.assetSymbol)).toEqual([
      "ETH",
      "SOL",
      "BTC",
    ]);
    expect(input.map((item) => item.assetSymbol)).toEqual([
      "BTC",
      "ETH",
      "ADA",
      "SOL",
    ]);
  });

  it("reports missing prices and exposes a named view-all action", async () => {
    const onShowAll = vi.fn();
    render(
      <HoldingsOverview
        onShowAll={onShowAll}
        positions={[position("BTC", "9"), position("ADA")]}
      />,
    );
    expect(screen.getByText(/ADA 缺少合法当前价格/)).toBeTruthy();
    await userEvent.setup().click(
      screen.getByRole("button", { name: "查看全部持仓" }),
    );
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("closes details with Escape and its named close control", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <HoldingsDetails
        onClose={onClose}
        open
        positions={[position("BTC", "9")]}
      />,
    );
    expect(screen.getByRole("complementary", { name: "完整持仓详情" })).toBeTruthy();
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <HoldingsDetails
        onClose={onClose}
        open
        positions={[position("BTC", "9")]}
      />,
    );
    await userEvent.setup().click(
      screen.getByRole("button", { name: "关闭完整持仓详情" }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes details when the backdrop is pressed", () => {
    const onClose = vi.fn();
    const view = render(
      <HoldingsDetails onClose={onClose} open positions={[]} />,
    );

    const backdrop = view.container.firstElementChild;
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop as Element);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
