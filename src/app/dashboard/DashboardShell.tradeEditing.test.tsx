// @vitest-environment jsdom

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LedgerRepository } from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import {
  DashboardShell,
  confirmNegativeCashIfNeeded,
  createDeferred,
  createMemoryRepository,
  createSimpleTrade,
  createTrade,
  fillBuyTrade,
  getSection,
  renderDashboard,
} from "./DashboardShell.testHelpers";

vi.mock("echarts/core", () => ({
  init: vi.fn((container: HTMLElement) => {
    const handlers = new Map<string, (params: unknown) => void>();
    const dispatchClick = () =>
      handlers.get("click")?.({
        data: ["2026-07-14", 1, 1, 1, 0],
      });
    container.addEventListener("click", dispatchClick);

    return {
      dispose: vi.fn(() =>
        container.removeEventListener("click", dispatchClick),
      ),
      off: vi.fn((eventName: string) => handlers.delete(eventName)),
      on: vi.fn(
        (eventName: string, handler: (params: unknown) => void) =>
          handlers.set(eventName, handler),
      ),
      resize: vi.fn(),
      setOption: vi.fn(),
    };
  }),
  use: vi.fn(),
}));

describe("DashboardShell trade interactions", () => {
  it("separates an accepted trade from pending and completed local persistence", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createMemoryRepository();
    repository.save = vi.fn(() => saveDeferred.promise);
    await renderDashboard(repository);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await confirmNegativeCashIfNeeded(user);

    expect(
      screen.getByRole("button", { name: "正在保存…" }),
    ).toHaveProperty("disabled", true);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
      expect(screen.getByText("正在保存到本地")).not.toBeNull();
    });
    expect(screen.queryByText("已保存到本地")).toBeNull();

    const feedbackTimeouts: Array<() => void> = [];
    const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
    const timeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback, delay, ...args) => {
        if (delay === 4_000 && typeof callback === "function") {
          feedbackTimeouts.push(() => callback(...args));
          return 1 as unknown as ReturnType<typeof setTimeout>;
        }
        return nativeSetTimeout(callback, delay, ...args);
      });

    try {
      saveDeferred.resolve();
      await waitFor(() => {
        expect(screen.getByText("已保存到本地")).not.toBeNull();
        expect(screen.getByText("交易已认证保存")).not.toBeNull();
      });
      expect(feedbackTimeouts.length).toBeGreaterThan(0);

      act(() => feedbackTimeouts.forEach((dismiss) => dismiss()));
      expect(screen.queryByText("已保存到本地")).toBeNull();
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("lets the user retry the latest failed local save", async () => {
    const repository = createMemoryRepository();
    repository.save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce();
    await renderDashboard(repository);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await confirmNegativeCashIfNeeded(user);
    await waitFor(() => {
      expect(
        screen.getByText(
          "本地保存失败，页面数据尚未保存；刷新后将恢复上次成功保存的版本",
        ),
      ).not.toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => {
      expect(screen.getByText("已保存到本地")).not.toBeNull();
    });
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it("requires explicit confirmation before abandoning dirty state for a repository switch", async () => {
    const oldRepository = createMemoryRepository();
    oldRepository.save = vi.fn(async () => {
      throw new Error("write failed");
    });
    const newLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "trade-ui-repository-switch",
          "buy",
          "ETH",
          "2",
          "2026-07-15",
        ),
      ],
    };
    const newRepository = createMemoryRepository(newLedger);
    const view = await renderDashboard(oldRepository);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await confirmNegativeCashIfNeeded(user);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试保存" })).not.toBeNull();
    });

    view.rerender(<DashboardShell repository={newRepository} />);
    expect(
      screen.getByText(
        "当前账本尚未保存，已阻止切换本地账本存储。请先重试保存，或明确放弃未保存更改。",
      ),
    ).not.toBeNull();
    expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    expect(newRepository.load).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", {
        name: "放弃未保存更改并切换",
      }),
    );
    await waitFor(() => {
      expect(newRepository.load).toHaveBeenCalledOnce();
      expect(within(getSection("交易列表")).getByText("ETH")).not.toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "放弃未保存更改并切换",
        }),
      ).toBeNull();
    });
  });

  it("creates a validated buy and updates both the trade list and positions", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await confirmNegativeCashIfNeeded(user);

    await waitFor(() => {
      expect(screen.getByText("交易已认证保存")).not.toBeNull();
    });

    const tradeSection = getSection("交易列表");
    expect(within(tradeSection).getByText("BTC")).not.toBeNull();
    expect(within(tradeSection).getByText("买入")).not.toBeNull();
    expect(within(tradeSection).getAllByTitle("70")).not.toHaveLength(0);

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByText("BTC")).not.toBeNull();
    expect(within(positionSection).getByText("0.001")).not.toBeNull();
    expect(within(positionSection).getByTitle("70000")).not.toBeNull();
  });

  it("creates, versions, and deactivates fee rules only after authenticated persistence", async () => {
    const repository = createMemoryRepository();
    await renderDashboard(repository);
    const user = userEvent.setup();
    const section = getSection("手续费规则");

    await user.type(within(section).getByLabelText("规则名"), "OKX BTC fee");
    await user.type(
      within(section).getByLabelText("平台（精确匹配）"),
      "OKX",
    );
    await user.type(within(section).getByLabelText("金额（USDT）"), "5");
    await user.click(
      within(section).getByRole("button", { name: "新增手续费规则" }),
    );
    await waitFor(() => {
      expect(
        within(section).getByText("手续费规则已认证保存"),
      ).not.toBeNull();
    });

    await user.type(
      within(section).getByLabelText("OKX BTC fee 新版本金额"),
      "6",
    );
    await user.click(
      within(section).getByRole("button", {
        name: "创建新版本并停用旧版",
      }),
    );
    await waitFor(async () => {
      const stored = await repository.load();
      expect(stored?.feeRules).toHaveLength(2);
      expect(stored?.feeRules[0]).toMatchObject({
        status: "inactive",
        type: "fixed",
        amount: "5",
      });
      expect(stored?.feeRules[1]).toMatchObject({
        status: "active",
        type: "fixed",
        amount: "6",
        replacesFeeRuleId: stored?.feeRules[0].id,
      });
    });

    const activeRule = (await repository.load())!.feeRules[1];
    await user.click(
      within(section).getAllByRole("button", { name: "停用规则" })[0],
    );
    await waitFor(async () => {
      const stored = await repository.load();
      expect(
        stored?.feeRules.find(({ id }) => id === activeRule.id),
      ).toMatchObject({ status: "inactive" });
      expect(stored?.feeRules).toHaveLength(2);
    });
  });

  it("requires explicit fee candidate adoption and persists a user override as history", async () => {
    const ledger = createInitialLedgerData();
    ledger.feeRules = [
      {
        id: "fee-binance-btc",
        name: "Binance BTC percentage",
        platform: "Binance",
        assetSymbol: "BTC",
        status: "active",
        type: "percentage",
        rate: "0.001",
        currency: "USDT",
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    ];
    const repository = createMemoryRepository(ledger);
    await renderDashboard(repository);
    const user = userEvent.setup();
    const tradeSection = getSection("新增交易");

    await user.clear(within(tradeSection).getByLabelText("数量"));
    await user.type(within(tradeSection).getByLabelText("数量"), "1");
    await user.clear(within(tradeSection).getByLabelText("成交均价"));
    await user.type(within(tradeSection).getByLabelText("成交均价"), "6500");
    await user.clear(within(tradeSection).getByLabelText("成交金额（不含手续费）"));
    await user.type(
      within(tradeSection).getByLabelText("成交金额（不含手续费）"),
      "6500",
    );
    await user.clear(within(tradeSection).getByLabelText("日期"));
    await user.type(within(tradeSection).getByLabelText("日期"), "2026-07-14");
    await user.type(
      within(tradeSection).getByLabelText("平台（可选，精确匹配）"),
      "Binance",
    );

    expect(within(tradeSection).getByTitle("6.5")).not.toBeNull();
    expect(
      (within(tradeSection).getByLabelText("实际手续费") as HTMLInputElement)
        .value,
    ).toBe("0");
    await user.click(
      within(tradeSection).getByRole("button", { name: "采用此规则候选" }),
    );
    expect(
      (within(tradeSection).getByLabelText("实际手续费") as HTMLInputElement)
        .value,
    ).toBe("6.5");
    await user.clear(within(tradeSection).getByLabelText("实际手续费"));
    await user.type(within(tradeSection).getByLabelText("实际手续费"), "7");
    expect(
      within(tradeSection).getByText(/实际手续费已由用户修改/),
    ).not.toBeNull();
    await user.click(
      within(tradeSection).getByRole("button", { name: "保存交易" }),
    );
    await confirmNegativeCashIfNeeded(user);
    await waitFor(() => {
      expect(within(tradeSection).getByText("交易已认证保存")).not.toBeNull();
    });

    const stored = await repository.load();
    expect(stored?.trades[0]).toMatchObject({
      platform: "Binance",
      fee: "7",
      feeCurrency: "USDT",
      feeRuleId: "fee-binance-btc",
    });

    const ruleSection = getSection("手续费规则");
    await user.click(
      within(ruleSection).getByRole("button", { name: "停用规则" }),
    );
    await waitFor(async () => {
      const afterDeactivation = await repository.load();
      expect(afterDeactivation?.feeRules[0]).toMatchObject({
        status: "inactive",
      });
      expect(afterDeactivation?.trades[0]).toMatchObject({
        fee: "7",
        feeRuleId: "fee-binance-btc",
      });
    });
  });

  it("shows exact-match conflicts and never auto-selects the first active rule", async () => {
    const ledger = createInitialLedgerData();
    const common = {
      name: "OKX BTC fee",
      platform: "OKX",
      assetSymbol: "BTC",
      status: "active" as const,
      type: "fixed" as const,
      currency: "USDT" as const,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    };
    ledger.feeRules = [
      { ...common, id: "fee-okx-a", amount: "5" },
      { ...common, id: "fee-okx-b", amount: "7" },
    ];
    await renderDashboard(createMemoryRepository(ledger));
    const user = await fillBuyTrade();
    const tradeSection = getSection("新增交易");
    await user.type(
      within(tradeSection).getByLabelText("平台（可选，精确匹配）"),
      "OKX",
    );

    expect(
      within(tradeSection).getByText(/多条 active 规则冲突/),
    ).not.toBeNull();
    expect(
      (within(tradeSection).getByLabelText("实际手续费") as HTMLInputElement)
        .value,
    ).toBe("0");
    expect(
      within(tradeSection).queryByRole("button", { name: "采用此规则候选" }),
    ).toBeNull();
  });

  it("shows validator feedback and keeps the ledger unchanged for invalid input", async () => {
    await renderDashboard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("数量"), "0.001");
    await user.type(screen.getByLabelText("成交均价"), "70000");
    await user.type(screen.getByLabelText("成交金额（不含手续费）"), "10");
    await user.clear(screen.getByLabelText("日期"));
    await user.type(screen.getByLabelText("日期"), "2026-07-14");
    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await confirmNegativeCashIfNeeded(user);

    expect(
      screen.getByText("成交金额与数量 × 成交均价不一致"),
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

  it("blocks deletion when removing a buy would invalidate a later sell", async () => {
    await renderDashboard();

    await createTrade({
      type: "buy",
      quantity: "10",
      price: "1",
      totalValue: "10",
      occurredAt: "2026-07-14",
    });
    const user = await createTrade({
      type: "sell",
      quantity: "5",
      price: "1",
      totalValue: "5",
      occurredAt: "2026-07-15",
    });

    const tradeSection = getSection("交易列表");
    const rowsBefore = within(tradeSection).getAllByRole("row");
    expect(rowsBefore).toHaveLength(3);

    const unsafeDelete = within(tradeSection).getByRole("button", {
      name: "删除 买入 BTC 2026-07-14",
    });
    await user.click(unsafeDelete);
    await user.click(unsafeDelete);

    expect(
      within(tradeSection).getByText(
        "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出",
      ),
    ).not.toBeNull();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(3);
    expect(within(getSection("资产汇总")).getByText("5")).not.toBeNull();
  });

  it("deletes a safe trade and updates both empty states", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();
    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await confirmNegativeCashIfNeeded(user);

    const tradeSection = getSection("交易列表");
    const safeDelete = within(tradeSection).getByRole("button", {
      name: "删除 买入 BTC 2026-07-14",
    });
    await user.click(safeDelete);
    await user.click(safeDelete);

    expect(
      within(tradeSection).getByText(
        "暂无交易。添加交易后，这里会自动显示。",
      ),
    ).not.toBeNull();
    expect(
      within(getSection("资产汇总")).getByText(
        "暂无持仓。添加交易后，这里会自动汇总。",
      ),
    ).not.toBeNull();
  });

  it("saves a manual price and updates market value and unrealized PnL", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();
    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await confirmNegativeCashIfNeeded(user);
    await screen.findByText("交易已认证保存");

    await user.type(screen.getByLabelText("当前价格"), "80000");
    await user.clear(screen.getByLabelText("价格日期"));
    await user.type(screen.getByLabelText("价格日期"), "2026-07-16");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    expect(await screen.findByText("价格已认证保存")).not.toBeNull();

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByTitle("80000")).not.toBeNull();
    expect(within(positionSection).getByTitle("80")).not.toBeNull();
    expect(within(positionSection).getByTitle("10")).not.toBeNull();
  });
});
