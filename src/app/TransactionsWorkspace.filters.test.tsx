// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TransactionsWorkspace } from "./TransactionsWorkspace";
import { createLedger, renderWorkspace } from "./TransactionsWorkspace.testHelpers";

describe("TransactionsWorkspace filters and intent", () => {
  it("combines session filters, sorts newest first stably, and clears without mutating the ledger", async () => {
    const ledgerData = createLedger();
    const original = structuredClone(ledgerData.trades);
    renderWorkspace({ ledgerData });
    const table = screen.getByRole("table");

    const initialRows = within(table).getAllByRole("row").slice(1);
    expect(initialRows[0]?.textContent).toContain("BTC");
    expect(initialRows[1]?.textContent).toContain("ADA");

    fireEvent.change(screen.getByLabelText("时间范围"), {
      target: { value: "7d" },
    });
    fireEvent.change(screen.getByLabelText("资产筛选"), {
      target: { value: "BTC" },
    });
    fireEvent.change(screen.getByLabelText("类型筛选"), {
      target: { value: "sell" },
    });
    expect(within(table).getByTitle("0.5").textContent).toBe("0.50");
    expect(within(table).queryByText("ETH")).toBeNull();
    expect(
      screen.getByText(
        "时间：最近 7 天｜日期：全部｜资产：BTC｜类型：卖出",
      ),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(ledgerData.trades).toEqual(original);
  });

  it("consumes accurate date and trade intents, then resets after leaving", async () => {
    const ledgerData = createLedger();
    const onIntentConsumed = vi.fn();
    const view = render(
      <TransactionsWorkspace
        active
        intent={{
          page: "transactions",
          filterDate: "2026-07-22",
          expandTradeId: "eth-recent",
        }}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );

    expect(screen.getByText(/日期：2026-07-22/)).not.toBeNull();
    expect(within(screen.getByRole("table")).getByText("事实 ID")).not.toBeNull();
    expect(within(screen.getByRole("table")).queryByText("ADA")).toBeNull();
    expect(onIntentConsumed).toHaveBeenCalledOnce();

    view.rerender(
      <TransactionsWorkspace
        active={false}
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );
    view.rerender(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );
    expect(screen.getByText(/日期：全部/)).not.toBeNull();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(5);
  });

  it("clears every filter, keeps the full list, and highlights every row on a located date", () => {
    const ledgerData = createLedger();
    const onIntentConsumed = vi.fn();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const view = render(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );

    fireEvent.change(screen.getByLabelText("时间范围"), {
      target: { value: "7d" },
    });
    fireEvent.change(screen.getByLabelText("资产筛选"), {
      target: { value: "ETH" },
    });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);

    view.rerender(
      <TransactionsWorkspace
        active
        intent={{ page: "transactions", locateDate: "2026-07-25" }}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );

    expect(screen.getByText(/时间：全部｜日期：全部｜资产：全部｜类型：全部/)).not.toBeNull();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(5);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });

    act(() => document.dispatchEvent(new Event("scrollend")));
    const locatedRows = document.querySelectorAll(
      '[data-locate-highlight="flashing"]',
    );
    expect(locatedRows).toHaveLength(2);
    expect(
      Array.from(locatedRows).every(
        (row) => row.getAttribute("data-trade-date") === "2026-07-25",
      ),
    ).toBe(true);

    act(() => vi.advanceTimersByTime(800));
    expect(document.querySelector("[data-locate-highlight]")).toBeNull();
    expect(onIntentConsumed).toHaveBeenCalledOnce();
  });

  it("keeps the full list and reports a visible message when a located date disappears", () => {
    const ledgerData = createLedger();
    renderWorkspace({
      ledgerData,
      intent: {
        page: "transactions",
        locateDate: "2026-07-21",
      },
    });

    expect(
      screen.getByText("该日期的交易已发生变化，已显示完整交易列表"),
    ).not.toBeNull();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(5);
    expect(screen.getByText(/日期：全部/)).not.toBeNull();
  });
});
