// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as calculations from "@/core/calculations";
import type { LedgerClock } from "@/core/shared";
import * as portfolio from "@/features/portfolio";
import {
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  type LedgerRepository,
} from "@/platform/persistence";
import { DashboardShell } from "./DashboardShell";

const fixedClock: LedgerClock = {
  now: () => new Date("2026-08-31T10:00:00.000Z"),
};

vi.mock("echarts/core", () => ({
  init: vi.fn(() => ({
    dispose: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn(),
  })),
  use: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DashboardShell visible workspace mounting", () => {
  it("mounts exactly the active workspace and discards settings confirmation state", async () => {
    const cashReplaySpy = vi.spyOn(calculations, "replayUsdtCash");
    const positionReplaySpy = vi.spyOn(portfolio, "getPositionsFromLedger");
    const repository: LedgerRepository = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "visible-workspace-contract",
    });
    const user = userEvent.setup();

    render(
      <DashboardShell
        capabilities={LEDGER_FILE_CAPABILITIES}
        clock={fixedClock}
        repository={repository}
        session={session}
        storageKind="ledger-file"
      />,
    );
    await waitFor(() =>
      expect(
        screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
      ).toBeNull(),
    );

    expectVisibleWorkspace("home");
    cashReplaySpy.mockClear();
    positionReplaySpy.mockClear();
    await user.click(screen.getByRole("button", { name: "记账" }));
    expectVisibleWorkspace("record");
    expect(cashReplaySpy).not.toHaveBeenCalled();
    expect(positionReplaySpy).not.toHaveBeenCalled();

    for (const [pageLabel, workspacePage] of [
      ["交易", "transactions"],
      ["导入与导出", "transfer"],
      ["设置", "settings"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: pageLabel }));
      expectVisibleWorkspace(workspacePage);
    }

    await user.click(screen.getByRole("tab", { name: "危险操作" }));
    await user.click(
      screen.getByRole("button", { name: "打开清空账本操作" }),
    );
    await user.type(screen.getByLabelText("输入清空确认文本"), "未完成确认");

    await user.click(screen.getByRole("button", { name: "首页" }));
    expectVisibleWorkspace("home");
    await user.click(screen.getByRole("button", { name: "设置" }));
    expectVisibleWorkspace("settings");
    expect(
      screen
        .getByRole("tab", { name: "本地资产与行情" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByLabelText("输入清空确认文本")).toBeNull();
  });
});

function expectVisibleWorkspace(expectedPage: string) {
  const workspaces = document.querySelectorAll("[data-workspace-page]");
  expect(workspaces).toHaveLength(1);
  expect(workspaces[0]?.getAttribute("data-workspace-page")).toBe(expectedPage);
}
