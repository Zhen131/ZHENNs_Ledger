// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
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
import { createTestLedgerRepository } from "@/test-support";
import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import {
  confirmNegativeCashIfNeeded,
  createMemoryRepository,
  createSimpleTrade,
  fillBuyTrade,
  closeHoldingsDetails,
  deleteTradeAfterReview,
  getSection,
  goToPage,
  openActivityTable,
  openHoldingsDetails,
  renderDashboard,
  renderSessionDashboard,
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
  it("hydrates saved LedgerData without overwriting it with initial state", async () => {
    const savedLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "trade-hydrated",
          "buy",
          "ETH",
          "2",
          "2026-07-10",
        ),
      ],
    };
    const repository = createMemoryRepository(savedLedger);

    await renderSessionDashboard(repository);

    const tradeSection = await openActivityTable();
    expect(within(tradeSection).getByText("ETH")).not.toBeNull();
    expect(within(tradeSection).getByText("2")).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("synchronizes both forms to assets restored from the saved ledger", async () => {
    const baseLedger = createInitialLedgerData();
    const savedLedger: LedgerData = {
      ...baseLedger,
      assets: [
        {
          ...baseLedger.assets[0],
          id: "asset-doge",
          symbol: "DOGE",
          name: "Dogecoin",
        },
      ],
    };

    await renderSessionDashboard(createMemoryRepository(savedLedger));
    await goToPage("记账");

    // The record page opens on the cash form; the trade form appears only
    // once an asset is picked, so the trade half checks that the picker
    // offers the restored asset and not the default one.
    await waitFor(() => {
      const recordTargets = Array.from(
        (screen.getByLabelText("记账对象", {
          selector: "select",
        }) as HTMLSelectElement).options,
        (option) => option.value,
      );
      expect(recordTargets).toContain("trade:DOGE");
      expect(recordTargets).not.toContain("trade:BTC");
      expect(
        (screen.getByLabelText("价格资产", {
          selector: "select",
        }) as HTMLSelectElement).value,
      ).toBe("DOGE");
    });
  });

  it("restores add, price, and delete across remounts, then keeps clear empty", async () => {
    const indexedDBFactory = new IDBFactory();
    const storageOptions = {
      indexedDBFactory,
      databaseName: "dashboard-persistence-round-trip",
    };
    const firstRepository =
      createTestLedgerRepository(storageOptions);
    const firstView = await renderSessionDashboard(firstRepository);
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));
    await confirmNegativeCashIfNeeded(user);
    await user.type(screen.getByLabelText("当前价格"), "80000");
    await user.clear(screen.getByLabelText("价格日期"));
    await user.type(screen.getByLabelText("价格日期"), "2026-07-16");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    await waitFor(async () => {
      const savedLedger = await firstRepository.load();
      expect(savedLedger?.trades).toHaveLength(1);
      expect(savedLedger?.priceSnapshots).toHaveLength(1);
    });

    firstView.unmount();

    const secondRepository =
      createTestLedgerRepository(storageOptions);
    const secondView = await renderSessionDashboard(secondRepository);

    const tradeSection = await openActivityTable();
    expect(within(tradeSection).getByText("BTC")).not.toBeNull();
    expect(within(tradeSection).getAllByTitle("70")).not.toHaveLength(0);

    const positionSection = await openHoldingsDetails();
    expect(within(positionSection).getByTitle("80000")).not.toBeNull();
    expect(within(positionSection).getByTitle("80")).not.toBeNull();
    expect(within(positionSection).getByTitle("10")).not.toBeNull();
    await closeHoldingsDetails();

    await openActivityTable();
    deleteTradeAfterReview("删除 买入 BTC 2026-07-14");
    await waitFor(async () => {
      const savedLedger = await secondRepository.load();
      expect(savedLedger?.trades).toEqual([]);
      expect(savedLedger?.priceSnapshots).toHaveLength(1);
    });
    secondView.unmount();

    const thirdRepository =
      createTestLedgerRepository(storageOptions);
    const thirdView = await renderSessionDashboard(thirdRepository);
    expect(
      within(await openActivityTable()).getByText(
        "没有符合当前筛选的流水。",
      ),
    ).not.toBeNull();

    const thirdUser = userEvent.setup();
    await goToPage("设置");
    await thirdUser.click(
      await screen.findByRole("tab", { name: "危险操作" }),
    );
    await thirdUser.click(
      screen.getByRole("button", { name: "打开清空账本操作" }),
    );
    await thirdUser.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空账本",
    );
    await thirdUser.click(
      screen.getByRole("button", { name: "确认清空账本内容" }),
    );
    await waitFor(() => {
      expect(screen.getByText("当前浏览器账本已清空")).not.toBeNull();
    });
    await expect(thirdRepository.load()).resolves.toBeNull();
    thirdView.unmount();

    const fourthRepository =
      createTestLedgerRepository(storageOptions);
    await renderSessionDashboard(fourthRepository);
    expect(screen.getByText("还没有交易记录")).not.toBeNull();
    expect(
      within(await openActivityTable()).getByText(
        "没有符合当前筛选的流水。",
      ),
    ).not.toBeNull();
    await expect(fourthRepository.load()).resolves.toBeNull();
  });

  it("filters the trade table from a heatmap day and toggles the same day off", async () => {
    const initialLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "trade-filter-btc",
          "buy",
          "BTC",
          "1",
          "2026-07-14",
        ),
        createSimpleTrade(
          "trade-filter-eth",
          "buy",
          "ETH",
          "1",
          "2026-07-15",
        ),
      ],
    };
    await renderDashboard(createMemoryRepository(initialLedger));
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("img", {
        name: "最近 365 天交易活跃热力图",
      }),
    );

    const filteredSection = getSection("交易列表 · 2026-07-14");
    expect(within(filteredSection).getByText("BTC")).not.toBeNull();
    expect(within(filteredSection).queryByText("ETH")).toBeNull();

    await user.click(
      screen.getByRole("img", {
        name: "最近 365 天交易活跃热力图",
      }),
    );
    const restoredSection = getSection("交易列表");
    expect(within(restoredSection).getByText("BTC")).not.toBeNull();
    expect(within(restoredSection).getByText("ETH")).not.toBeNull();
  });
});
