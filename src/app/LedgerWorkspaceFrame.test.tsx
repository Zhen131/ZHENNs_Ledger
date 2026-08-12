// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LedgerWorkspaceFrame } from "./LedgerWorkspaceFrame";

afterEach(cleanup);

describe("LedgerWorkspaceFrame", () => {
  it("renders five named destinations, persistent file status and bottom lock", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onLock = vi.fn();
    render(
      <LedgerWorkspaceFrame
        currentPage="home"
        fileStatusLabel="已保存到加密文件"
        fileStatusTone="saved"
        onLock={onLock}
        onNavigate={onNavigate}
      >
        <p>真实页面内容</p>
      </LedgerWorkspaceFrame>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "账本主导航",
    });
    expect(navigation.querySelectorAll("button")).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: "首页" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("status").textContent).toContain(
      "已保存到加密文件",
    );

    await user.click(screen.getByRole("button", { name: "交易" }));
    await user.click(screen.getByRole("button", { name: "锁定账本" }));
    expect(onNavigate).toHaveBeenCalledWith("transactions");
    expect(onLock).toHaveBeenCalledOnce();
  });

  it("keeps Chinese navigation readable while the shell reflows before 1100px", () => {
    render(
      <LedgerWorkspaceFrame
        currentPage="transfer"
        fileStatusLabel="文件操作正常"
        fileStatusTone="saved"
        onNavigate={vi.fn()}
      >
        <p>内容</p>
      </LedgerWorkspaceFrame>,
    );

    const main = screen.getByRole("main");
    const shell = main.firstElementChild as HTMLElement;
    const navigation = screen.getByRole("navigation", { name: "账本主导航" });
    expect(main.className).toContain("overflow-x-hidden");
    expect(shell.className).toContain("flex-col");
    expect(shell.className).toContain("min-[1100px]:flex-row");
    expect(navigation.className).toContain("grid-cols-2");
    expect(navigation.className).toContain("min-[1100px]:grid-cols-1");
    expect(screen.getByRole("button", { name: "导入与导出" })).toBeTruthy();
  });
});
