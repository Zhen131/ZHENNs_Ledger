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
import type {
  LedgerRepository,
  SessionQuiesceReason,
} from "@/platform/persistence";
import {
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
} from "@/platform/persistence";
import type { PersistentLedgerState } from "@/app/persistence";
import {
  DashboardShell,
  confirmNegativeCashIfNeeded,
  createDeferred,
  createMemoryRepository,
  fillBuyTrade,
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

describe("DashboardShell immediate lock decision B", () => {
  it("keeps a local form draft in the discard decision", async () => {
    const repository = createMemoryRepository();
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-draft-lock",
    });
    const onFinalLock = vi.fn<
      (
        drain: PersistentLedgerState["drainForSessionQuiesce"],
        reason: SessionQuiesceReason,
      ) => Promise<void>
    >(async () => undefined);
    render(<DashboardShell onFinalLock={onFinalLock} session={session} />);
    await waitFor(() => {
      expect(
        screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
      ).toBeNull();
    });
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "锁定账本" }));

    expect(
      screen.getByRole("region", { name: "未保存修改锁定确认" }),
    ).toBeTruthy();
    expect(screen.getByText(/还有未提交的表单草稿/)).toBeTruthy();
    expect(onFinalLock).not.toHaveBeenCalled();
  });

  it("does not begin locking on the first dirty click and uses the same final action only after explicit discard", async () => {
    const saveDeferred = createDeferred<void>();
    const repository = createMemoryRepository();
    repository.save = vi.fn(() => saveDeferred.promise);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-dirty-lock",
    });
    const onFinalLock = vi.fn<
      (
        drain: PersistentLedgerState["drainForSessionQuiesce"],
        reason: SessionQuiesceReason,
      ) => Promise<void>
    >(async () => undefined);
    render(
      <DashboardShell
        onFinalLock={onFinalLock}
        session={session}
      />,
    );
    await waitFor(() => {
      expect(
        screen.queryByText(
          "正在读取本地账本，完成前不会写入任何数据。",
        ),
      ).toBeNull();
    });
    const user = await fillBuyTrade();
    await user.click(
      screen.getByRole("button", { name: "保存交易" }),
    );
    await confirmNegativeCashIfNeeded(user);
    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledOnce();
    });

    await user.click(
      screen.getByRole("button", { name: "锁定账本" }),
    );
    expect(
      screen.getByRole("region", {
        name: "未保存修改锁定确认",
      }),
    ).toBeTruthy();
    expect(onFinalLock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("region", {
        name: "未保存修改锁定确认",
      }),
    ).toBeNull();
    expect(onFinalLock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "锁定账本" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "我确定不要了，继续锁定",
      }),
    );
    expect(onFinalLock).toHaveBeenCalledOnce();
    expect(onFinalLock.mock.calls[0]?.[1]).toBe("immediate-lock");
    expect(onFinalLock.mock.calls[0]?.[0]).toEqual(
      expect.any(Function),
    );
  });

  it("lets a dirty user retry saving without beginning the final lock", async () => {
    const repository = createMemoryRepository();
    repository.save = vi
      .fn<LedgerRepository["save"]>()
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce(undefined);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-retry-lock",
    });
    const onFinalLock = vi.fn<
      (
        drain: PersistentLedgerState["drainForSessionQuiesce"],
        reason: SessionQuiesceReason,
      ) => Promise<void>
    >(async () => undefined);
    render(
      <DashboardShell
        onFinalLock={onFinalLock}
        session={session}
      />,
    );
    await waitFor(() => {
      expect(
        screen.queryByText(
          "正在读取本地账本，完成前不会写入任何数据。",
        ),
      ).toBeNull();
    });
    const user = await fillBuyTrade();
    await user.click(
      screen.getByRole("button", { name: "保存交易" }),
    );
    await confirmNegativeCashIfNeeded(user);
    await screen.findByText(
      "本地保存失败，页面数据尚未保存；刷新后将恢复上次成功保存的版本",
    );

    await user.click(
      screen.getByRole("button", { name: "锁定账本" }),
    );
    await user.click(
      screen.getByRole("button", { name: "重新保存" }),
    );

    await waitFor(() => {
      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("region", {
          name: "未保存修改锁定确认",
        }),
      ).toBeNull();
    });
    expect(onFinalLock).not.toHaveBeenCalled();
  });

  it("locks a clean file session directly without a discard confirmation", async () => {
    const repository = createMemoryRepository();
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "dashboard-clean-lock",
    });
    const onFinalLock = vi.fn<
      (
        drain: PersistentLedgerState["drainForSessionQuiesce"],
        reason: SessionQuiesceReason,
      ) => Promise<void>
    >(async () => undefined);
    render(
      <DashboardShell
        onFinalLock={onFinalLock}
        session={session}
      />,
    );
    await waitFor(() => {
      expect(
        screen.queryByText(
          "正在读取本地账本，完成前不会写入任何数据。",
        ),
      ).toBeNull();
    });

    await userEvent.setup().click(
      screen.getByRole("button", { name: "锁定账本" }),
    );

    expect(onFinalLock).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("region", {
        name: "未保存修改锁定确认",
      }),
    ).toBeNull();
  });
});
