// @vitest-environment jsdom

import {
  act,
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
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
} from "./ledgerFileAccessController";
import { type SessionQuiesceToken } from "@/platform/persistence";
import { LedgerAccessGate } from "./LedgerAccessGate";
import type {
  LedgerSessionFatalSignal,
  PersistentLedgerState,
} from "./usePersistentLedger";
import {
  PASSPHRASE,
  createController,
  createDeferred,
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
  it("shows the explicit previous-version recovery page without mounting Dashboard and enters only after confirmed readback", async () => {
    const user = userEvent.setup();
    const unlockSelected = vi.fn(async () => ({
      status: "recovery-required" as const,
      ok: false as const,
      recoveryId: "gate-recovery",
    }));
    const confirmRecovery = vi.fn(async () => ({
      status: "unlocked" as const,
      ok: true as const,
      session: createFileSession(),
    }));
    const fileController = createFileController({
      unlockSelected,
      confirmRecovery,
    });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "选择账本" }),
    );
    await user.type(
      await screen.findByLabelText("账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选账本" }),
    );

    expect(
      await screen.findByRole("heading", { name: "确认恢复上一版" }),
    ).toBeTruthy();
    expect(
      screen.getByText("最新一次保存没有恢复，现在恢复的是上一版"),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "确认恢复上一版" }),
    );
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    expect(confirmRecovery).toHaveBeenCalledOnce();
    expect(confirmRecovery).toHaveBeenCalledWith("gate-recovery");
  });

  it("submits one recovery confirmation while the first confirmation is pending", async () => {
    const user = userEvent.setup();
    const confirmation =
      createDeferred<
        Awaited<
          ReturnType<LedgerFileAccessController["confirmRecovery"]>
        >
      >();
    const confirmRecovery = vi.fn(() => confirmation.promise);
    const fileController = createFileController({
      unlockSelected: vi.fn(async () => ({
        status: "recovery-required" as const,
        ok: false as const,
        recoveryId: "gate-deduplicated-recovery",
      })),
      confirmRecovery,
    });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "选择账本" }),
    );
    await user.type(
      await screen.findByLabelText("账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选账本" }),
    );

    const confirmButton = await screen.findByRole("button", {
      name: "确认恢复上一版",
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(confirmRecovery).toHaveBeenCalledOnce();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await act(async () => {
      confirmation.resolve({
        status: "unlocked",
        ok: true,
        session: createFileSession(),
      });
      await confirmation.promise;
    });
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
  });

  it("ignores a slow recovery confirmation after the file controller changes", async () => {
    const user = userEvent.setup();
    const accessController = createController();
    const confirmation =
      createDeferred<
        Awaited<
          ReturnType<LedgerFileAccessController["confirmRecovery"]>
        >
      >();
    const oldFileController = createFileController({
      unlockSelected: vi.fn(async () => ({
        status: "recovery-required" as const,
        ok: false as const,
        recoveryId: "gate-stale-recovery",
      })),
      confirmRecovery: vi.fn(() => confirmation.promise),
    });
    const newFileController = createFileController();
    const rendered = render(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={oldFileController}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "选择账本" }),
    );
    await user.type(
      await screen.findByLabelText("账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选账本" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "确认恢复上一版" }),
    );

    rendered.rerender(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={newFileController}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "选择账本" }),
    ).toBeTruthy();

    await act(async () => {
      confirmation.resolve({
        status: "unlocked",
        ok: true,
        session: createFileSession(),
      });
      await confirmation.promise;
    });

    expect(
      screen.getByRole("heading", { name: "选择账本" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("keeps the recovery page closed when confirmation fails", async () => {
    const user = userEvent.setup();
    const fileController = createFileController({
      unlockSelected: vi.fn(async () => ({
        status: "recovery-required" as const,
        ok: false as const,
        recoveryId: "gate-failed-recovery",
      })),
      confirmRecovery: vi.fn(async () => ({
        status: "error" as const,
        ok: false as const,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_FAILED,
      })),
    });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "选择账本" }),
    );
    await user.type(
      await screen.findByLabelText("账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选账本" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "确认恢复上一版" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "上一版恢复写入、关闭或复读验证失败",
    );
    expect(
      screen.getByRole("heading", { name: "确认恢复上一版" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("cancels recovery with no Dashboard and returns to the safe C entry", async () => {
    const user = userEvent.setup();
    const cancelRecovery = vi.fn(async () => undefined);
    const fileController = createFileController({
      unlockSelected: vi.fn(async () => ({
        status: "recovery-required" as const,
        ok: false as const,
        recoveryId: "gate-cancel-recovery",
      })),
      cancelRecovery,
    });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "选择账本" }),
    );
    await user.type(
      await screen.findByLabelText("账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选账本" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "取消恢复" }),
    );

    expect(
      await screen.findByRole("heading", { name: "选择账本" }),
    ).toBeTruthy();
    expect(cancelRecovery).toHaveBeenCalledWith(
      "gate-cancel-recovery",
    );
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("keeps C closed and makes recovery cancellation retryable when lease release rejects", async () => {
    const user = userEvent.setup();
    const cancelRecovery = vi
      .fn()
      .mockRejectedValueOnce(new Error("release failed"))
      .mockResolvedValueOnce(undefined);
    const fileController = createFileController({
      unlockSelected: vi.fn(async () => ({
        status: "recovery-required" as const,
        ok: false as const,
        recoveryId: "gate-retry-cancel-recovery",
      })),
      cancelRecovery,
    });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "选择账本" }),
    );
    await user.type(
      await screen.findByLabelText("账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选账本" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "取消恢复" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "账本仍保持关闭，请重试取消恢复",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "取消恢复",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "取消恢复" }),
    );
    expect(
      await screen.findByRole("heading", { name: "选择账本" }),
    ).toBeTruthy();
    expect(cancelRecovery).toHaveBeenCalledTimes(2);
  });
});
