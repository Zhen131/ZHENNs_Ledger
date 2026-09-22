// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { LEDGER_FILE_ACCESS_ERROR_CODES } from "@/app/file-access";
import { type SessionQuiesceToken } from "@/platform/persistence";
import { LedgerAccessGate } from "./LedgerAccessGate";
import type {
  LedgerSessionFatalSignal,
  PersistentLedgerState,
} from "@/app/persistence";
import {
  PASSPHRASE,
  createController,
  createFileController,
  createFileSession,
  getMockPersistencePort,
} from "./LedgerAccessGate.testHelpers";

vi.mock("./DashboardShell", () => ({
  DashboardShell: ({
    session,
    onFinalLock,
    onSessionFatal,
    onSessionDrainReady,
  }: {
    session?: ReturnType<typeof createFileSession>;
    onFinalLock?: (
      drain: (
        request: ReturnType<
          ReturnType<typeof createFileSession>["beginQuiesce"]
        >,
      ) => Promise<SessionQuiesceToken>,
      reason: "immediate-lock",
    ) => Promise<void>;
    onSessionDrainReady?: (
      session: ReturnType<typeof createFileSession>,
      drain: (
        request: ReturnType<
          ReturnType<typeof createFileSession>["beginQuiesce"]
        >,
      ) => Promise<SessionQuiesceToken>,
    ) => void;
    onSessionFatal?: (
      drain: PersistentLedgerState["drainForSessionQuiesce"],
      signal: LedgerSessionFatalSignal,
    ) => Promise<void>;
  }) => {
    const persistencePort = session
      ? getMockPersistencePort(session)
      : null;
    const drain = session && persistencePort
      ? (
          request: ReturnType<
            ReturnType<typeof createFileSession>["beginQuiesce"]
          >,
        ) =>
          persistencePort.completeQuiesce(
            request,
            Promise.resolve(),
          )
      : null;
    if (session) {
      onSessionDrainReady?.(
        session,
        drain!,
      );
    }
    return (
      <div>
        dashboard-mounted
        {session?.capabilities.canImportBackup && session.readyImportPort ? (
          <section aria-label="导入与导出">
            <input aria-label="选择账本备份文件" type="file" />
          </section>
        ) : null}
        {drain && onFinalLock ? (
          <button
            onClick={() =>
              void onFinalLock(drain, "immediate-lock")
            }
            type="button"
          >
            mock-final-lock
          </button>
        ) : null}
        {drain && onSessionFatal && session ? (
          <>
            <button
              onClick={() =>
                void onSessionFatal(drain, {
                  code: "IMPORT_RECOVERY_BLOCKED",
                  occurrence: 1,
                  sessionId: session.sessionId,
                  sessionGeneration: session.generation,
                })
              }
              type="button"
            >
              mock-session-fatal
            </button>
            <button
              onClick={() =>
                void onSessionFatal(drain, {
                  code: "IMPORT_RECOVERY_BLOCKED",
                  occurrence: 1,
                  sessionId: "stale-session",
                  sessionGeneration: 0,
                })
              }
              type="button"
            >
              mock-stale-session-fatal
            </button>
          </>
        ) : null}
      </div>
    );
  },
}));

describe("LedgerAccessGate", () => {
  it.each([
    [
      LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      "另一个页面或尚未完成释放的会话占用",
    ],
    [
      LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED,
      "当前浏览器缺少安全的多页面文件协调能力",
    ],
    [
      LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_FAILED,
      "无法确认这个账本是否已被其他页面使用",
    ],
  ] as const)(
    "keeps C closed and explains coordination error %s",
    async (code, message) => {
      const user = userEvent.setup();
      const fileController = createFileController({
        unlockSelected: vi.fn(async () => ({
          status: "error" as const,
          ok: false as const,
          code,
        })),
      });
      render(
        <LedgerAccessGate
          accessController={createController()}
          fileAccessController={fileController}
        />,
      );
      await user.click(
        await screen.findByRole("button", {
          name: "选择账本",
        }),
      );
      await user.type(
        await screen.findByLabelText("账本核心密码"),
        PASSPHRASE,
      );
      await user.click(
        screen.getByRole("button", { name: "解锁所选账本" }),
      );

      expect((await screen.findByRole("alert")).textContent).toContain(
        message,
      );
      expect(screen.queryByText("dashboard-mounted")).toBeNull();
    },
  );

  it("keeps all C setup fields masked and reveals only the held field without replacing it", async () => {
    const user = userEvent.setup();
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={createFileController()}
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "新建账本",
      }),
    );

    const password = (await screen.findByLabelText(
      "设置账本核心密码",
    )) as HTMLInputElement;
    const confirmation = screen.getByLabelText(
      "再次输入账本核心密码",
    ) as HTMLInputElement;
    const revealPassword = screen.getByRole("button", {
      name: "按住查看设置账本核心密码",
    });
    const revealConfirmation = screen.getByRole("button", {
      name: "按住查看再次输入账本核心密码",
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
    expect(
      screen.getByLabelText("设置账本核心密码"),
    ).toBe(originalPasswordNode);
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
    const user = userEvent.setup();
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={createFileController()}
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "新建账本",
      }),
    );

    const password = (await screen.findByLabelText(
      "设置账本核心密码",
    )) as HTMLInputElement;
    const reveal = screen.getByRole("button", {
      name: "按住查看设置账本核心密码",
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

});
