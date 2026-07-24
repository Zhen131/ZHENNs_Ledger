// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LEDGER_ACCESS_ERROR_CODES,
  type LedgerAccessController,
} from "../../composition/ledgerAccessController";
import type { LedgerRepository } from "../../repositories/ledgerRepository";
import { LedgerAccessGate } from "./LedgerAccessGate";

vi.mock("../dashboard/DashboardShell", () => ({
  DashboardShell: () => <div>dashboard-mounted</div>,
}));

const repository: LedgerRepository = {
  load: async () => null,
  save: async () => undefined,
  clear: async () => undefined,
};

afterEach(() => {
  cleanup();
});

function createController(
  overrides: Partial<LedgerAccessController> = {},
): LedgerAccessController {
  return {
    inspect: vi.fn(async () => ({ status: "setup-required" })),
    setup: vi.fn(async () => ({ ok: true, repository })),
    unlock: vi.fn(async () => ({ ok: true, repository })),
    resetEncryptedLedger: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("LedgerAccessGate", () => {
  it("shows setup only for an empty ledger and mounts Dashboard after verified setup", async () => {
    const user = userEvent.setup();
    const controller = createController();
    render(<LedgerAccessGate accessController={controller} />);

    expect(
      await screen.findByRole("heading", {
        name: "创建本地加密账本",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.type(screen.getByLabelText("设置密码"), "long password");
    await user.type(
      screen.getByLabelText("再次输入密码"),
      "different password",
    );
    await user.click(
      screen.getByRole("button", { name: "创建加密账本" }),
    );
    expect(controller.setup).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "两次输入的密码不一致",
    );

    await user.clear(screen.getByLabelText("设置密码"));
    await user.clear(screen.getByLabelText("再次输入密码"));
    await user.type(
      screen.getByLabelText("设置密码"),
      "correct horse battery staple",
    );
    await user.type(
      screen.getByLabelText("再次输入密码"),
      "correct horse battery staple",
    );
    await user.click(
      screen.getByRole("button", { name: "创建加密账本" }),
    );

    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    expect(controller.setup).toHaveBeenCalledWith(
      "correct horse battery staple",
    );
  });

  it("uses one generic message for an unlock failure and clears the password field", async () => {
    const user = userEvent.setup();
    const controller = createController({
      inspect: vi.fn(async () => ({ status: "unlock-required" })),
      unlock: vi.fn(async () => ({
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      })),
    });
    render(<LedgerAccessGate accessController={controller} />);

    const password = await screen.findByLabelText("账本密码");
    await user.type(password, "wrong but long password");
    await user.click(screen.getByRole("button", { name: "解锁账本" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "密码错误或本地加密数据已损坏",
    );
    expect((password as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("does not submit unlock twice while one operation is pending", async () => {
    const user = userEvent.setup();
    let resolveUnlock:
      | ((value: { ok: true; repository: LedgerRepository }) => void)
      | undefined;
    const unlock = vi.fn(
      () =>
        new Promise<{ ok: true; repository: LedgerRepository }>(
          (resolve) => {
            resolveUnlock = resolve;
          },
        ),
    );
    const controller = createController({
      inspect: vi.fn(async () => ({ status: "unlock-required" })),
      unlock,
    });
    render(<LedgerAccessGate accessController={controller} />);

    await user.type(
      await screen.findByLabelText("账本密码"),
      "correct horse battery staple",
    );
    const submit = screen.getByRole("button", { name: "解锁账本" });
    await user.dblClick(submit);

    expect(unlock).toHaveBeenCalledOnce();
    resolveUnlock?.({ ok: true, repository });
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
  });

  it("requires the exact reset text and stays on the current page if clear fails", async () => {
    const user = userEvent.setup();
    const resetEncryptedLedger = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.RESET_FAILED,
      })
      .mockResolvedValueOnce({ ok: true });
    const controller = createController({
      inspect: vi.fn(async () => ({ status: "unlock-required" })),
      resetEncryptedLedger,
    });
    render(<LedgerAccessGate accessController={controller} />);

    await user.click(
      await screen.findByRole("button", {
        name: "忘记密码？清空本地加密账本并重新开始",
      }),
    );
    const confirmation = screen.getByLabelText("清空确认文本");
    await user.type(confirmation, "清空");
    await user.click(screen.getByRole("button", { name: "确认清空" }));
    expect(resetEncryptedLedger).not.toHaveBeenCalled();

    await user.clear(confirmation);
    await user.type(confirmation, "清空本地加密账本");
    await user.click(screen.getByRole("button", { name: "确认清空" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "原数据未被替换",
    );
    expect(
      screen.getByRole("heading", { name: "解锁本地账本" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "确认清空" }));
    expect(
      await screen.findByRole("heading", {
        name: "创建本地加密账本",
      }),
    ).toBeTruthy();
  });

  it("offers retry for read failure but explicit reset for unsupported data", async () => {
    const controller = createController({
      inspect: vi
        .fn()
        .mockResolvedValueOnce({
          status: "error",
          code: LEDGER_ACCESS_ERROR_CODES.READ_FAILED,
        })
        .mockResolvedValueOnce({
          status: "error",
          code: LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT,
        }),
    });
    const user = userEvent.setup();
    render(<LedgerAccessGate accessController={controller} />);

    await screen.findByRole("button", { name: "重新检查" });
    expect(
      screen.queryByText(/清空本地加密账本并重新开始/),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "重新检查" }));

    await waitFor(() => {
      expect(
        screen.getByText(/清空本地加密账本并重新开始/),
      ).toBeTruthy();
    });
  });
});
