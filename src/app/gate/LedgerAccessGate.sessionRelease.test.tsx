// @vitest-environment jsdom

import {
  act,
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
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  LedgerSessionLifecycleError,
  type SessionQuiesceToken,
} from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import { LedgerAccessGate } from "./LedgerAccessGate";
import type {
  LedgerSessionFatalSignal,
  PersistentLedgerState,
} from "@/app/persistence";
import {
  PASSPHRASE,
  createController,
  createDeferred,
  createFileController,
  createFileSession,
  getMockPersistencePort,
  repository,
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
  it("releases the active C session when the Gate unmounts", async () => {
    const user = userEvent.setup();
    const release = vi.fn(async () => undefined);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      release,
    });
    const fileController = createFileController({
      create: vi.fn(async () => ({
        status: "unlocked" as const,
        ok: true as const,
        session,
      })),
    });
    const rendered = render(
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
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();

    rendered.unmount();

    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledOnce();
    });
  });

  it("retains a failed route-release proof so the next Gate can retry the same lease", async () => {
    const user = userEvent.setup();
    const release = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("release failed"))
      .mockResolvedValueOnce(undefined);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      release,
    });
    const fileController = createFileController({
      create: vi.fn(async () => ({
        status: "unlocked" as const,
        ok: true as const,
        session,
      })),
    });
    const rendered = render(
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
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();

    rendered.unmount();
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledOnce();
    });

    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );
    expect(
      await screen.findByRole("heading", {
        name: "安全释放尚未完成",
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "重试安全释放" }),
    );
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByRole("heading", {
        name: "选择账本",
      }),
    ).toBeTruthy();
  });

  it("begins quiesce synchronously, revokes the old repository, and returns to the safe entry only after release", async () => {
    const user = userEvent.setup();
    const releaseDeferred = createDeferred<void>();
    const onBeginQuiesce = vi.fn();
    const release = vi.fn(() => releaseDeferred.promise);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "gate-final-lock",
      onBeginQuiesce,
      release,
    });
    const fileController = createFileController({
      create: vi.fn(async () => ({
        status: "unlocked" as const,
        ok: true as const,
        session,
      })),
    });
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
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );
    await screen.findByText("dashboard-mounted");

    await user.click(
      screen.getByRole("button", { name: "mock-final-lock" }),
    );

    expect(onBeginQuiesce).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("heading", { name: "正在安全锁定" }),
    ).toBeTruthy();
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledOnce();
    });
    expect(() => session.repository.load()).toThrow(
      LedgerSessionLifecycleError,
    );
    expect(
      screen.queryByRole("heading", { name: "选择账本" }),
    ).toBeNull();

    releaseDeferred.resolve();
    expect(
      await screen.findByRole("heading", {
        name: "选择账本",
      }),
    ).toBeTruthy();
  });

  it("keeps a recovery-blocked session closed through release retry and requires a fresh selection and unlock", async () => {
    const user = userEvent.setup();
    const onBeginQuiesce = vi.fn();
    let rejectFirstRelease!: (error: Error) => void;
    const firstRelease = new Promise<void>((_resolve, reject) => {
      rejectFirstRelease = reject;
    });
    const release = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstRelease)
      .mockResolvedValueOnce(undefined);
    const oldSession = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "gate-fatal-old-session",
      onBeginQuiesce,
      release,
    });
    const newSession = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      createSessionId: () => "gate-fatal-new-session",
    });
    const forgetRememberedConnection = vi.fn(async () => undefined);
    const inspectRememberedConnection = vi.fn(async () => ({
      status: "none" as const,
      ok: true as const,
    }));
    const selectExisting = vi.fn(async () => ({ ok: true as const }));
    const unlockSelected = vi.fn(async () => ({
      status: "unlocked" as const,
      ok: true as const,
      session: newSession,
    }));
    const fileController = createFileController({
      create: vi.fn(async () => ({
        status: "unlocked" as const,
        ok: true as const,
        session: oldSession,
      })),
      forgetRememberedConnection,
      inspectRememberedConnection,
      selectExisting,
      unlockSelected,
    });
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
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );
    await screen.findByText("dashboard-mounted");

    await user.click(
      screen.getByRole("button", {
        name: "mock-stale-session-fatal",
      }),
    );
    expect(screen.getByText("dashboard-mounted")).toBeTruthy();
    expect(onBeginQuiesce).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "mock-session-fatal" }),
    );
    expect(onBeginQuiesce).toHaveBeenCalledOnce();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "正在安全关闭账本" }),
    ).toBeTruthy();
    expect(() => oldSession.repository.load()).toThrow(
      LedgerSessionLifecycleError,
    );

    await act(async () => {
      rejectFirstRelease(new Error("release failed"));
      await firstRelease.catch(() => undefined);
    });

    expect(
      await screen.findByRole("heading", {
        name: "恢复阻断后的安全关闭尚未完成",
      }),
    ).toBeTruthy();
    expect(release).toHaveBeenCalledOnce();
    expect(forgetRememberedConnection).not.toHaveBeenCalled();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "重试安全关闭" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "账本已因恢复阻断自动关闭",
      }),
    ).toBeTruthy();
    expect(release).toHaveBeenCalledTimes(2);
    expect(forgetRememberedConnection).toHaveBeenCalledOnce();
    expect(inspectRememberedConnection).toHaveBeenCalledOnce();
    expect(() => oldSession.repository.save(createInitialLedgerData())).toThrow(
      LedgerSessionLifecycleError,
    );

    await user.click(
      screen.getByRole("button", { name: "重新选择账本" }),
    );
    expect(selectExisting).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", { name: "解锁所选账本" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    await user.type(
      screen.getByLabelText("账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选账本" }),
    );
    expect(unlockSelected).toHaveBeenCalledWith(PASSPHRASE);
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    await expect(newSession.repository.load()).resolves.toBeNull();
  });

  it("does not restart connection inspection when an in-flight immediate lock finishes after Gate unmount", async () => {
    const user = userEvent.setup();
    const releaseDeferred = createDeferred<void>();
    const release = vi.fn(() => releaseDeferred.promise);
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      release,
    });
    const accessController = createController();
    const fileController = createFileController({
      create: vi.fn(async () => ({
        status: "unlocked" as const,
        ok: true as const,
        session,
      })),
    });
    const rendered = render(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={fileController}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "新建账本" }),
    );
    await user.type(
      screen.getByLabelText("设置账本核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入账本核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );
    await screen.findByText("dashboard-mounted");
    await user.click(
      screen.getByRole("button", { name: "mock-final-lock" }),
    );
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledOnce();
    });

    rendered.unmount();
    await act(async () => {
      releaseDeferred.resolve();
      await releaseDeferred.promise;
    });

    expect(
      fileController.inspectRememberedConnection,
    ).toHaveBeenCalledOnce();
    expect(accessController.inspect).toHaveBeenCalledOnce();
  });
});
