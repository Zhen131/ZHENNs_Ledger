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
  createMemoryRepository,
  createSimpleTrade,
  goToPage,
  goToTradeForm,
  openActivityTable,
  renderDashboard,
} from "./DashboardShell.testHelpers";
import { createDeferred } from "@/test-support";

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

async function openSettingsDanger() {
  await goToPage("设置");
  await userEvent.setup().click(
    await screen.findByRole("tab", { name: "危险操作" }),
  );
}

async function openSettingsClear() {
  await openSettingsDanger();
  await userEvent.setup().click(
    screen.getByRole("button", { name: "打开清空账本操作" }),
  );
}

describe("DashboardShell data management", () => {
  it("does not clear when confirmation is cancelled or the fixed text is wrong", async () => {
    const repository = createMemoryRepository(createCompleteLedger());
    await renderDashboard(repository);
    const user = userEvent.setup();

    await openSettingsClear();
    expect(
      screen.getByText(
        "自定义资产、交易、价格和手续费规则都会清空；不会删除浏览器或应用本身，也不会增加“删除账本文件”能力。",
      ),
    ).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "确认清空账本内容" }),
    );
    expect(
      screen.getByText("请输入完整确认文本“清空账本”"),
    ).not.toBeNull();
    expect(repository.clear).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("输入清空确认文本"), "错误文本");
    await user.click(
      screen.getByRole("button", { name: "确认清空账本内容" }),
    );
    expect(repository.clear).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByLabelText("输入清空确认文本")).toBeNull();
    expect(within(await openActivityTable()).getByText("BTC")).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("disables every write path while clear runs and shows success only afterward", async () => {
    const clearDeferred = createDeferred<void>();
    const repository = createMemoryRepository(createCompleteLedger());
    repository.clear = vi.fn(() => clearDeferred.promise);
    await renderDashboard(repository);
    const user = userEvent.setup();

    await goToPage("记账");
    expect(screen.getAllByRole("option", { name: "SOL · Solana" })).toHaveLength(2);
    await goToTradeForm();

    await openSettingsClear();
    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空账本",
    );
    await user.click(
      screen.getByRole("button", { name: "确认清空账本内容" }),
    );

    await waitFor(() => {
      expect(repository.clear).toHaveBeenCalledOnce();
      expect(
        screen.getByText("正在清空并复读验证，请勿关闭页面。"),
      ).not.toBeNull();
    });
    expect(
      (screen.getByRole("button", {
        name: "确认清空账本内容",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // The other write paths live on other pages; leaving the settings page
    // unmounts its clear panel, so the success line is not read afterward.
    await goToPage("记账");
    expect(
      (screen.getByLabelText("数量").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("当前价格").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    await goToPage("交易");
    expect(
      (screen.getByRole("button", {
        name: "删除 买入 BTC 2026-07-14",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    clearDeferred.resolve();
    await waitFor(() => {
      expect(
        screen.getByText("没有符合当前筛选的流水。"),
      ).not.toBeNull();
    });
    await goToPage("记账");
    expect(screen.queryAllByRole("option", { name: "SOL · Solana" })).toEqual([]);
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
    // A failed load locks the record-target picker on the cash form, so the
    // write path is read from that form's amount field.
    await goToPage("记账");
    expect(
      (screen.getByLabelText("金额") as HTMLInputElement).disabled,
    ).toBe(true);

    await openSettingsClear();
    expect(
      screen.getByText(
        "自定义资产、交易、价格和手续费规则都会清空；不会删除浏览器或应用本身，也不会增加“删除账本文件”能力。",
      ),
    ).not.toBeNull();
    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空账本",
    );
    await user.click(
      screen.getByRole("button", { name: "确认清空账本内容" }),
    );

    await waitFor(() => {
      expect(screen.getByText("当前浏览器账本已清空")).not.toBeNull();
    });
    // The recovered ledger is a new ledger epoch, so the settings page
    // reopens on its first tab.
    await user.click(screen.getByRole("tab", { name: "危险操作" }));
    await waitFor(() => {
      expect(
        (screen.getByRole("button", {
          name: "打开清空账本操作",
        }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    await goToTradeForm();
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

    await openSettingsClear();
    await user.type(
      screen.getByLabelText("输入清空确认文本"),
      "清空账本",
    );
    await user.click(
      screen.getByRole("button", { name: "确认清空账本内容" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("清空本地账本失败，原页面与本地数据均未更改"),
      ).not.toBeNull();
    });
    expect(screen.queryByText("当前浏览器账本已清空")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "重试保存" }),
    ).toBeNull();
    expect(within(await openActivityTable()).getByText("BTC")).not.toBeNull();
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
    // Read-only locks the record-target picker on the cash form, so the
    // write path is located through that form's amount field, which the cash
    // form disables directly instead of through a fieldset.
    await goToPage("记账");
    expect(
      (screen.getByLabelText("金额") as HTMLInputElement).disabled,
    ).toBe(true);
    await openSettingsDanger();
    expect(
      (screen.getByRole("button", {
        name: "打开清空账本操作",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
  });
});
