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
import { type SessionQuiesceToken } from "@/platform/persistence";
import { LedgerAccessGate } from "./LedgerAccessGate";
import type {
  LedgerSessionFatalSignal,
  PersistentLedgerState,
} from "@/app/persistence";
import {
  createController,
  createFileController,
  createFileSession,
  getMockPersistencePort,
} from "./LedgerAccessGate.testHelpers";

vi.mock("@/app/dashboard", () => ({
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
      await screen.findByRole("button", { name: "新建账本" }),
    );
    expect(
      screen.getByText(/忘记密码将永久失去对此账本的访问/),
    ).toBeTruthy();
    await user.type(
      screen.getByLabelText("设置账本核心密码"),
      "correct horse battery staple",
    );
    await user.type(
      screen.getByLabelText("再次输入账本核心密码"),
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

  it("accepts an 8-code-point Unicode password through the shared create policy", async () => {
    const user = userEvent.setup();
    const fileController = createFileController();
    const eightCodePoints = "账本🔐safe8";
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "新建账本" }),
    );
    await user.type(
      screen.getByLabelText("设置账本核心密码"),
      eightCodePoints,
    );
    await user.type(
      screen.getByLabelText("再次输入账本核心密码"),
      eightCodePoints,
    );
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );

    expect(fileController.create).toHaveBeenCalledWith(eightCodePoints);
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
  });

  it("rejects an invalid or mismatched C setup password before calling the file controller", async () => {
    const user = userEvent.setup();
    const fileController = createFileController();
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "新建账本" }),
    );
    const password = screen.getByLabelText("设置账本核心密码");
    const confirmation = screen.getByLabelText(
      "再次输入账本核心密码",
    );

    fireEvent.change(password, { target: { value: "a".repeat(7) } });
    fireEvent.change(confirmation, {
      target: { value: "a".repeat(7) },
    });
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "8 至 128",
    );
    expect(fileController.create).not.toHaveBeenCalled();

    fireEvent.change(password, {
      target: { value: "🔐".repeat(12) },
    });
    fireEvent.change(confirmation, {
      target: { value: `${"🔐".repeat(11)}x` },
    });
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "两次输入的密码不一致",
    );
    expect(fileController.create).not.toHaveBeenCalled();
  });
});
