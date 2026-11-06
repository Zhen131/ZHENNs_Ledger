// @vitest-environment jsdom

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
} from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import {
  DashboardShell,
  createMemoryRepository,
  createSimpleTrade,
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

describe("DashboardShell persistent workspace navigation", () => {
  it("switches all five pages without rehydrating and preserves mounted form input", async () => {
    const repository = createMemoryRepository();
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-navigation",
    });
    const user = userEvent.setup();
    render(<DashboardShell session={session} />);
    await waitFor(() => {
      expect(
        screen.queryByText(
          "正在读取本地账本，完成前不会写入任何数据。",
        ),
      ).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "记账" }));
    await user.selectOptions(
      screen.getByLabelText("记账对象", { selector: "select" }),
      "trade:BTC",
    );
    await user.type(screen.getByLabelText("数量"), "0.25");
    await user.type(screen.getByLabelText("当前价格"), "75000");
    for (const page of ["交易", "导入与导出", "设置", "首页", "记账"]) {
      await user.click(screen.getByRole("button", { name: page }));
      expect(
        screen.getByRole("heading", { level: 1, name: page }),
      ).toBeTruthy();
    }

    expect(repository.load).toHaveBeenCalledOnce();
    expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe(
      "0.25",
    );
    expect(
      (screen.getByLabelText("当前价格") as HTMLInputElement).value,
    ).toBe("75000");
  });

  it("locates a home activity date in the complete transaction list without creating a filter", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      createSimpleTrade(
        "home-locate-buy",
        "buy",
        "BTC",
        "1",
        "2026-07-14",
      ),
      createSimpleTrade(
        "home-locate-sell",
        "sell",
        "BTC",
        "0.5",
        "2026-07-14",
      ),
      createSimpleTrade(
        "home-locate-other",
        "buy",
        "ETH",
        "1",
        "2026-07-15",
      ),
    ];
    const repository = createMemoryRepository(ledgerData);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-home-locate",
    });
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    try {
      render(<DashboardShell session={session} />);
      await waitFor(() => {
        expect(
          screen.queryByText(
            "正在读取本地账本，完成前不会写入任何数据。",
          ),
        ).toBeNull();
      });
      const user = userEvent.setup();

      await user.click(
        screen.getByRole("gridcell", {
          name: "2026-07-14，共 2 笔，买入 1 笔，卖出 1 笔",
        }),
      );

      expect(
        screen.getByRole("heading", { level: 1, name: "交易" }),
      ).toBeTruthy();
      expect(screen.getByText("当前显示 3 笔")).toBeTruthy();
      expect(
        (screen.getByLabelText("准确日期") as HTMLInputElement).value,
      ).toBe("");
      expect(
        document.querySelectorAll(
          '[data-trade-date="2026-07-14"][data-locate-highlight="static"]',
        ),
      ).toHaveLength(2);
      expect(
        document.querySelector('[data-trade-id="home-locate-other"]'),
      ).not.toBeNull();
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "auto",
        block: "center",
      });
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          originalScrollIntoView,
        );
      } else {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown })
          .scrollIntoView;
      }
      vi.unstubAllGlobals();
    }
  });
});
