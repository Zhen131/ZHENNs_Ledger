// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DashboardShell } from "./DashboardShell";

afterEach(() => {
  cleanup();
});

function getSection(title: string): HTMLElement {
  const section = screen.getByRole("heading", { name: title }).closest("section");

  if (!section) {
    throw new Error(`Section not found: ${title}`);
  }

  return section;
}

async function fillBuyTrade() {
  const user = userEvent.setup();

  await user.selectOptions(
    screen.getByLabelText("类型", { selector: "select" }),
    "buy",
  );
  await user.selectOptions(
    screen.getByLabelText("资产", { selector: "select" }),
    "BTC",
  );
  await user.type(screen.getByLabelText("数量"), "0.001");
  await user.type(screen.getByLabelText("成交均价"), "70000");
  await user.type(screen.getByLabelText("总金额"), "70");
  await user.type(screen.getByLabelText("日期"), "2026-07-14");

  return user;
}

describe("DashboardShell trade interactions", () => {
  it("creates a validated buy and updates both the trade list and positions", async () => {
    render(<DashboardShell />);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(screen.getByText("交易已保存")).not.toBeNull();

    const tradeSection = getSection("交易列表");
    expect(within(tradeSection).getByText("BTC")).not.toBeNull();
    expect(within(tradeSection).getByText("买入")).not.toBeNull();
    expect(within(tradeSection).getByText("70 USD")).not.toBeNull();

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByText("BTC")).not.toBeNull();
    expect(within(positionSection).getByText("0.001")).not.toBeNull();
    expect(within(positionSection).getByText("70000 USD")).not.toBeNull();
  });

  it("shows validator feedback and keeps the ledger unchanged for invalid input", async () => {
    render(<DashboardShell />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("数量"), "0.001");
    await user.type(screen.getByLabelText("成交均价"), "70000");
    await user.type(screen.getByLabelText("总金额"), "10");
    await user.type(screen.getByLabelText("日期"), "2026-07-14");
    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(
      screen.getByText("总金额与数量 × 成交均价不一致"),
    ).not.toBeNull();
    expect(
      within(getSection("交易列表")).getByText(
        "暂无交易。添加交易后，这里会自动显示。",
      ),
    ).not.toBeNull();
    expect(
      within(getSection("资产汇总")).getByText(
        "暂无持仓。添加交易后，这里会自动汇总。",
      ),
    ).not.toBeNull();
  });
});
