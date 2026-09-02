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
import { createInitialLedgerData } from "@/core/state";
import {
  createCompleteLedger,
  createDeferred,
  createMemoryRepository,
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

describe("DashboardShell data management", () => {
  it("does not clear when confirmation is cancelled or the fixed text is wrong", async () => {
    const repository = createMemoryRepository(createCompleteLedger());
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "清空本地账本" }),
    );
    expect(
      screen.getByText(
        "这会永久删除自定义资产、交易、价格和手续费规则。请先导出完整账本备份。",
      ),
    ).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );
    expect(
      screen.getByText("请输入完整确认文本“清空本地账本”"),
    ).not.toBeNull();
    expect(repository.clear).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("输入清空确认文本"), "错误文本");
    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );
    expect(repository.clear).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByLabelText("输入清空确认文本")).toBeNull();
    expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("disables every write path while clear runs and shows success only afterward", async () => {
    const clearDeferred = createDeferred<void>();
    const repository = createMemoryRepository(createCompleteLedger());
    repository.clear = vi.fn(() => clearDeferred.promise);
    await renderDashboard(repository);
    const user = userEvent.setup();

    expect(screen.getAllByRole("option", { name: "SOL · Solana" })).toHaveLength(2);
    await user.click(
      screen.getByRole("img", {
        name: "最近 365 天交易活跃热力图",
      }),
    );
    expect(getSection("交易列表 · 2026-07-14")).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "清空本地账本" }),
    );
    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空本地账本",
    );
    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );

    await waitFor(() => {
      expect(repository.clear).toHaveBeenCalledOnce();
      expect(
        screen.getByText("正在清空本地账本，请勿关闭页面。"),
      ).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("当前价格").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "删除 买入 BTC 2026-07-14",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "确认永久清空",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    clearDeferred.resolve();
    await waitFor(() => {
      expect(screen.getByText("账本已清空")).not.toBeNull();
    });

    expect(screen.queryAllByRole("option", { name: "SOL · Solana" })).toEqual([]);
    expect(
      within(getSection("交易列表")).getByText(
        "暂无交易。添加交易后，这里会自动显示。",
      ),
    ).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("offers controlled recovery after load failure and returns to writable state", async () => {
    const repository = createMemoryRepository();
    repository.load = vi.fn(async () => {
      throw new Error("read failed");
    });
    await renderDashboard(repository);
    const user = userEvent.setup();

    expect(
      screen.getByText(
        "本地账本读取失败，已停止自动保存以避免覆盖原数据",
      ),
    ).not.toBeNull();
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "清空本地账本" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: "清除损坏或无法读取的本地数据",
      }),
    );
    expect(
      screen.getByText(
        "读取失败可能只是暂时性错误；继续将删除仍可能可恢复的自定义资产、交易、价格和手续费规则。请先使用有效备份恢复，或确认永久删除。",
      ),
    ).not.toBeNull();
    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空本地账本",
    );
    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );

    await waitFor(() => {
      expect(screen.getByText("账本已清空")).not.toBeNull();
      expect(
        screen.getByRole("button", { name: "清空本地账本" }),
      ).not.toBeNull();
    });
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(false);
    expect(repository.clear).toHaveBeenCalledOnce();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("keeps old UI data and shows only an error when clear fails", async () => {
    const repository = createMemoryRepository(createCompleteLedger());
    repository.clear = vi.fn(async () => {
      throw new Error("clear failed");
    });
    await renderDashboard(repository);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "清空本地账本" }),
    );
    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空本地账本",
    );
    await user.click(
      screen.getByRole("button", { name: "确认永久清空" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("清空本地账本失败，原页面与本地数据均未更改"),
      ).not.toBeNull();
    });
    expect(screen.queryByText("账本已清空")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "重试保存" }),
    ).toBeNull();
    expect(within(getSection("交易列表")).getByText("BTC")).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("loads an oversized saved ledger as read-only without offering clear", async () => {
    const oversizedLedger = {
      ...createInitialLedgerData(),
      trades: [
        {
          ...createSimpleTrade(
            "trade-ui-resource-limit",
            "buy",
            "BTC",
            "1",
          ),
          note: "n".repeat(4_097),
        },
      ],
    };
    const repository = createMemoryRepository(oversizedLedger);
    await renderDashboard(repository);

    expect(
      screen.getByText(/当前账本超过资源上限，已只读加载/),
    ).not.toBeNull();
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "清空本地账本",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
  });
});
