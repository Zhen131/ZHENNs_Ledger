// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LEDGER_ACCESS_ERROR_CODES,
  type LedgerAccessController,
} from "../../composition/ledgerAccessController";
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
} from "../../composition/ledgerFileAccessController";
import {
  LEDGER_FILE_CAPABILITIES,
  type LedgerRepository,
} from "../../repositories/ledgerRepository";
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
    inspect: vi.fn(async () => ({ status: "setup-required" as const })),
    setup: vi.fn(async () => ({ ok: true as const, repository })),
    unlock: vi.fn(async () => ({ ok: true as const, repository })),
    resetEncryptedLedger: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

function createFileController(
  overrides: Partial<LedgerFileAccessController> = {},
): LedgerFileAccessController {
  return {
    create: vi.fn(async () => ({
      ok: true as const,
      session: {
        storageKind: "ledger-file" as const,
        repository,
        capabilities: LEDGER_FILE_CAPABILITIES,
      },
    })),
    selectExisting: vi.fn(async () => ({ ok: true as const })),
    unlockSelected: vi.fn(async () => ({
      ok: true as const,
      session: {
        storageKind: "ledger-file" as const,
        repository,
        capabilities: LEDGER_FILE_CAPABILITIES,
      },
    })),
    cancelPendingSelection: vi.fn(),
    ...overrides,
  };
}

async function chooseBrowserLedger() {
  await screen.findByRole("heading", { name: "选择账本存储" });
  fireEvent.click(
    screen.getByRole("button", { name: "继续浏览器账本" }),
  );
}

describe("LedgerAccessGate", () => {
  it("starts with three mutually exclusive storage entries", async () => {
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={createFileController()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "选择账本存储" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "继续浏览器账本" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "新建 C（.lftl）" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "选择 C（.lftl）" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("creates C only after the password warning and direct create action", async () => {
    const user = userEvent.setup();
    const fileController = createFileController();
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "新建 C（.lftl）" }),
    );
    expect(
      screen.getByText(/忘记密码将永久失去对此 C 的访问/),
    ).toBeTruthy();
    await user.type(
      screen.getByLabelText("设置 C 核心密码"),
      "correct horse battery staple",
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
      "correct horse battery staple",
    );
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );

    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    expect(fileController.create).toHaveBeenCalledWith(
      "correct horse battery staple",
    );
  });

  it("keeps file-picker cancellation on the choice page without mounting Dashboard", async () => {
    const user = userEvent.setup();
    const fileController = createFileController({
      selectExisting: vi.fn(async () => ({
        ok: false as const,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      })),
    });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );

    expect(
      screen.getByRole("heading", { name: "选择账本存储" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("selects C before password entry, clears failed passwords, and never mounts before full unlock", async () => {
    const user = userEvent.setup();
    const unlockSelected = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        session: {
          storageKind: "ledger-file" as const,
          repository,
          capabilities: LEDGER_FILE_CAPABILITIES,
        },
      });
    const fileController = createFileController({ unlockSelected });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );
    expect(
      await screen.findByRole("heading", { name: "解锁所选 C" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    const password = screen.getByLabelText("C 核心密码");
    await user.type(password, "wrong but valid password");
    await user.click(screen.getByRole("button", { name: "解锁所选 C" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "密码错误或文件认证失败",
    );
    expect((password as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.type(password, "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "解锁所选 C" }));
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    expect(unlockSelected).toHaveBeenCalledTimes(2);
  });

  it("keeps all setup fields masked and reveals only the held field without replacing it", async () => {
    const user = userEvent.setup();
    render(<LedgerAccessGate accessController={createController()} />);
    await chooseBrowserLedger();

    const password = (await screen.findByLabelText(
      "设置密码",
    )) as HTMLInputElement;
    const confirmation = screen.getByLabelText(
      "再次输入密码",
    ) as HTMLInputElement;
    const revealPassword = screen.getByRole("button", {
      name: "按住查看设置密码",
    });
    const revealConfirmation = screen.getByRole("button", {
      name: "按住查看再次输入密码",
    });
    const testValue = "a".repeat(12);

    expect(password.type).toBe("password");
    expect(confirmation.type).toBe("password");
    expect(revealPassword.getAttribute("type")).toBe("button");
    expect(revealConfirmation.getAttribute("type")).toBe("button");

    await user.type(password, testValue);
    password.focus();
    const originalPasswordNode = password;
    const originalAutoComplete = password.autocomplete;

    fireEvent.pointerDown(revealPassword);
    expect(screen.getByLabelText("设置密码")).toBe(originalPasswordNode);
    expect(password.type).toBe("text");
    expect(confirmation.type).toBe("password");
    expect(password.value).toBe(testValue);
    expect(password.autocomplete).toBe(originalAutoComplete);
    expect(document.activeElement).toBe(password);

    fireEvent.pointerUp(revealPassword);
    expect(password.type).toBe("password");
    fireEvent.pointerDown(revealPassword);
    fireEvent.pointerLeave(revealPassword);
    expect(password.type).toBe("password");
    fireEvent.pointerDown(revealPassword);
    fireEvent.pointerCancel(revealPassword);
    expect(password.type).toBe("password");
    fireEvent.pointerDown(revealPassword);
    fireEvent.blur(revealPassword);
    expect(password.type).toBe("password");
    fireEvent.pointerDown(revealPassword);
    fireEvent.click(revealPassword);
    expect(password.type).toBe("password");
  });

  it("hides a revealed password on keyboard release, blur, and hidden visibility", async () => {
    render(<LedgerAccessGate accessController={createController()} />);
    await chooseBrowserLedger();

    const password = (await screen.findByLabelText(
      "设置密码",
    )) as HTMLInputElement;
    const reveal = screen.getByRole("button", {
      name: "按住查看设置密码",
    });

    fireEvent.keyDown(reveal, { key: "Enter" });
    expect(password.type).toBe("text");
    fireEvent.keyUp(reveal, { key: "Enter" });
    expect(password.type).toBe("password");

    fireEvent.keyDown(reveal, { key: " " });
    expect(password.type).toBe("text");
    fireEvent.keyUp(reveal, { key: " " });
    expect(password.type).toBe("password");

    fireEvent.pointerDown(reveal);
    fireEvent(window, new Event("blur"));
    expect(password.type).toBe("password");

    const originalVisibilityState = document.visibilityState;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent.pointerDown(reveal);
    fireEvent(document, new Event("visibilitychange"));
    expect(password.type).toBe("password");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: originalVisibilityState,
    });
  });

  it("masks the unlock field immediately when submission disables it", async () => {
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
      inspect: vi.fn(async () => ({ status: "unlock-required" as const })),
      unlock,
    });
    const user = userEvent.setup();
    render(<LedgerAccessGate accessController={controller} />);
    await chooseBrowserLedger();

    const password = (await screen.findByLabelText(
      "账本密码",
    )) as HTMLInputElement;
    const reveal = screen.getByRole("button", {
      name: "按住查看账本密码",
    });
    await user.type(password, "a".repeat(12));
    expect(password.type).toBe("password");

    fireEvent.pointerDown(reveal);
    expect(password.type).toBe("text");
    fireEvent.submit(password.closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(password.type).toBe("password");
      expect(password.disabled).toBe(true);
      expect((reveal as HTMLButtonElement).disabled).toBe(true);
    });
    expect(unlock).toHaveBeenCalledOnce();

    resolveUnlock?.({ ok: true, repository });
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
  });

  it("shows setup only for an empty ledger and mounts Dashboard after verified setup", async () => {
    const user = userEvent.setup();
    const controller = createController();
    render(<LedgerAccessGate accessController={controller} />);
    await chooseBrowserLedger();

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

  it("moves a recoverable setup result to unlock without mounting Dashboard", async () => {
    const user = userEvent.setup();
    const setup = vi.fn(async () => ({
      ok: false as const,
      code: LEDGER_ACCESS_ERROR_CODES.SETUP_RECOVERY_REQUIRED,
    }));
    const unlock = vi.fn(async () => ({ ok: true as const, repository }));
    const controller = createController({ setup, unlock });
    render(<LedgerAccessGate accessController={controller} />);
    await chooseBrowserLedger();

    await user.type(
      await screen.findByLabelText("设置密码"),
      "correct horse battery staple",
    );
    await user.type(
      screen.getByLabelText("再次输入密码"),
      "correct horse battery staple",
    );
    await user.click(
      screen.getByRole("button", { name: "创建加密账本" }),
    );

    expect(
      await screen.findByRole("heading", { name: "解锁本地账本" }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "加密账本已写入",
    );
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    expect(setup).toHaveBeenCalledOnce();

    const password = screen.getByLabelText("账本密码");
    expect((password as HTMLInputElement).value).toBe("");
    await user.type(password, "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "解锁账本" }));

    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    expect(unlock).toHaveBeenCalledWith("correct horse battery staple");
  });

  it("uses one generic message for an unlock failure and clears the password field", async () => {
    const user = userEvent.setup();
    const controller = createController({
      inspect: vi.fn(async () => ({ status: "unlock-required" as const })),
      unlock: vi.fn(async () => ({
        ok: false as const,
        code: LEDGER_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      })),
    });
    render(<LedgerAccessGate accessController={controller} />);
    await chooseBrowserLedger();

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
      inspect: vi.fn(async () => ({ status: "unlock-required" as const })),
      unlock,
    });
    render(<LedgerAccessGate accessController={controller} />);
    await chooseBrowserLedger();

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
      inspect: vi.fn(async () => ({ status: "unlock-required" as const })),
      resetEncryptedLedger,
    });
    render(<LedgerAccessGate accessController={controller} />);
    await chooseBrowserLedger();

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
    await chooseBrowserLedger();

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
