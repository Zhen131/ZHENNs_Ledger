// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LedgerWorkspaceFrame } from "./LedgerWorkspaceFrame";

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
});
