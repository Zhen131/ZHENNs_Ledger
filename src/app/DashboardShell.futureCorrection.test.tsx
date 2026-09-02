// @vitest-environment jsdom

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LedgerRepository } from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import {
  createFutureCorrectionLedger,
  createMemoryRepository,
  createPriceSnapshot,
  createSimpleTrade,
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

describe("DashboardShell future fact correction", () => {
  it("deletes only the named future trade, price, or asset transfer after two activations and persists across remount", async () => {
    const repository = createMemoryRepository(createFutureCorrectionLedger());
    const view = await renderDashboard(repository);
    const user = userEvent.setup();

    expect(screen.getByText("未来事实纠正模式")).not.toBeNull();
    expect(within(getSection("资产汇总")).queryByText("ETH")).toBeNull();
    const tradeDelete = screen.getByRole("button", {
      name: "删除未来交易 ETH 2026-07-26 future-eth-a",
    });
    const priceDelete = screen.getByRole("button", {
      name: "删除未来价格 BTC 2026-07-26 future-price-btc-a",
    });
    const transferDelete = screen.getByRole("button", {
      name: "删除未来资产转移 BTC 2026-07-26 future-transfer-btc-a",
    });

    await user.click(tradeDelete);
    expect(repository.save).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: "删除未来交易 ETH 2026-07-26 future-eth-a",
      }),
    ).not.toBeNull();
    await user.click(tradeDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole("button", {
          name: "删除未来交易 ETH 2026-07-26 future-eth-a",
        }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", {
        name: "删除未来交易 ETH 2026-07-26 future-eth-b",
      }),
    ).not.toBeNull();

    await user.click(priceDelete);
    expect(repository.save).toHaveBeenCalledTimes(1);
    await user.click(priceDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(2);
    });
    await user.click(transferDelete);
    expect(repository.save).toHaveBeenCalledTimes(2);
    await user.click(transferDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(3);
    });
    const stored = await repository.load();
    expect(stored?.trades.map((trade) => trade.id)).toEqual([
      "normal-btc",
      "future-eth-b",
    ]);
    expect(stored?.priceSnapshots.map((snapshot) => snapshot.id)).toEqual([
      "future-price-btc-b",
    ]);
    expect(stored?.assetTransfers.map((transfer) => transfer.id)).toEqual([
      "future-transfer-btc-b",
    ]);

    view.unmount();
    await renderDashboard(repository);
    expect(
      screen.queryByRole("button", {
        name: "删除未来交易 ETH 2026-07-26 future-eth-a",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "删除未来交易 ETH 2026-07-26 future-eth-b",
      }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "删除未来资产转移 BTC 2026-07-26 future-transfer-btc-a",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "删除未来资产转移 BTC 2026-07-26 future-transfer-btc-b",
      }),
    ).not.toBeNull();
  });

  it("keeps delete-all two-stage and restores ordinary writes after the final future fact", async () => {
    const repository = createMemoryRepository(createFutureCorrectionLedger());
    await renderDashboard(repository);
    const user = userEvent.setup();
    const deleteAll = screen.getByRole("button", {
      name: "删除全部无效未来事实",
    });

    await user.click(deleteAll);
    expect(repository.save).not.toHaveBeenCalled();
    expect(screen.getByText("未来事实纠正模式")).not.toBeNull();
    await user.click(deleteAll);

    await waitFor(() => {
      expect(screen.queryByText("未来事实纠正模式")).toBeNull();
      expect(repository.save).toHaveBeenCalledOnce();
      expect(screen.getByText("已保存到本地")).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("当前价格").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(false);
    expect((await repository.load())?.trades.map((trade) => trade.id)).toEqual([
      "normal-btc",
    ]);
    expect((await repository.load())?.priceSnapshots).toEqual([]);
    expect((await repository.load())?.assetTransfers).toEqual([]);
  });

  it("rejects deleting a future buy until its dependent future sell is removed", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets = ledgerData.assets.map((asset) => ({
      ...asset,
      binanceMapping: null,
    }));
    ledgerData.trades = [
      createSimpleTrade("future-buy", "buy", "BTC", "1", "2026-07-26"),
      createSimpleTrade("future-sell", "sell", "BTC", "1", "2026-07-27"),
    ];
    const repository = createMemoryRepository(ledgerData);
    await renderDashboard(repository);
    const user = userEvent.setup();

    const buyDelete = screen.getByRole("button", {
      name: "删除未来交易 BTC 2026-07-26 future-buy",
    });
    await user.click(buyDelete);
    await user.click(buyDelete);
    expect(
      screen.getByText(
        "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出",
      ),
    ).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();

    const sellDelete = screen.getByRole("button", {
      name: "删除未来交易 BTC 2026-07-27 future-sell",
    });
    await user.click(sellDelete);
    await user.click(sellDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(1);
    });

    const remainingBuyDelete = screen.getByRole("button", {
      name: "删除未来交易 BTC 2026-07-26 future-buy",
    });
    await user.click(remainingBuyDelete);
    await user.click(remainingBuyDelete);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("未来事实纠正模式")).toBeNull();
    });
  });

  it.each(["sell", "external-out"] as const)(
    "rejects deleting a future external-in that supports a later future %s",
    async (dependentKind) => {
      const ledgerData = createInitialLedgerData();
      ledgerData.assets = ledgerData.assets.map((asset) => ({
        ...asset,
        binanceMapping: null,
      }));
      ledgerData.assetTransfers = [
        {
          id: "future-supporting-in",
          occurredAt: "2026-07-26",
          timePrecision: "day",
          assetSymbol: "BTC",
          quantity: "1",
          category: "external-in",
          reason: "deposit",
          unitPrice: "10",
          toLocation: "exchange",
          createdAt: "2026-07-26T08:00:00.000Z",
          updatedAt: "2026-07-26T08:00:00.000Z",
        },
      ];
      if (dependentKind === "sell") {
        ledgerData.trades = [
          createSimpleTrade(
            "future-dependent-sell",
            "sell",
            "BTC",
            "1",
            "2026-07-27",
          ),
        ];
      } else {
        ledgerData.assetTransfers.push({
          id: "future-dependent-out",
          occurredAt: "2026-07-27",
          timePrecision: "day",
          assetSymbol: "BTC",
          quantity: "1",
          category: "external-out",
          reason: "withdrawal",
          fromLocation: "exchange",
          createdAt: "2026-07-27T08:00:00.000Z",
          updatedAt: "2026-07-27T08:00:00.000Z",
        });
      }
      const repository = createMemoryRepository(ledgerData);
      await renderDashboard(repository);
      const user = userEvent.setup();

      const supportingTransferDelete = screen.getByRole("button", {
        name: "删除未来资产转移 BTC 2026-07-26 future-supporting-in",
      });
      await user.click(supportingTransferDelete);
      await user.click(supportingTransferDelete);

      expect(
        screen.getByText(
          "无法删除：该转移支撑了后续交易或转移，请先删除依赖它的后续事实",
        ),
      ).not.toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", {
          name: "删除未来资产转移 BTC 2026-07-26 future-supporting-in",
        }),
      ).not.toBeNull();
    },
  );

  it("keeps the final single-delete dirty after save failure and confirms persistence only after retry", async () => {
    const initialLedger = createInitialLedgerData();
    initialLedger.assets = initialLedger.assets.map((asset) => ({
      ...asset,
      binanceMapping: null,
    }));
    initialLedger.priceSnapshots = [
      createPriceSnapshot(
        "future-final-price",
        "BTC",
        "70000",
        "2026-07-26",
      ),
    ];
    let storedLedger = structuredClone(initialLedger);
    let saveAttempts = 0;
    const repository: LedgerRepository = {
      load: vi.fn(async () => structuredClone(storedLedger)),
      save: vi.fn(async (ledgerData) => {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          throw new Error("first save fails");
        }
        storedLedger = structuredClone(ledgerData);
      }),
      clear: vi.fn(async () => undefined),
    };
    const view = await renderDashboard(repository);
    const user = userEvent.setup();
    const remove = screen.getByRole("button", {
      name: "删除未来价格 BTC 2026-07-26 future-final-price",
    });

    await user.click(remove);
    await user.click(remove);
    expect(screen.queryByText("未来事实纠正模式")).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试保存" })).not.toBeNull();
    });
    expect(screen.queryByText("已保存到本地")).toBeNull();
    expect(storedLedger.priceSnapshots).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => {
      expect(screen.getByText("已保存到本地")).not.toBeNull();
    });
    expect(storedLedger.priceSnapshots).toEqual([]);

    view.unmount();
    await renderDashboard(repository);
    expect(screen.queryByText("未来事实纠正模式")).toBeNull();
  });
});
