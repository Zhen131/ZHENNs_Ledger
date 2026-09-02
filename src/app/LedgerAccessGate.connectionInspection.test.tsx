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
  type LedgerAccessController,
} from "@/platform/legacy";
import { LEDGER_FILE_ACCESS_ERROR_CODES } from "./ledgerFileAccessController";
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
  it("opens a granted remembered C directly at its password gate", async () => {
    const fileController = createFileController({
      inspectRememberedConnection: vi.fn(async () => ({
        status: "ready" as const,
        ok: true as const,
      })),
    });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "解锁所选账本",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "选择账本" }),
    ).toBeNull();
  });

  it("does not request prompt permission until the user clicks reconnect", async () => {
    const user = userEvent.setup();
    const requestRememberedPermission = vi.fn(async () => ({
      status: "ready" as const,
      ok: true as const,
    }));
    const fileController = createFileController({
      inspectRememberedConnection: vi.fn(async () => ({
        status: "permission-prompt" as const,
        ok: false as const,
      })),
      requestRememberedPermission,
    });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "重新连接上次的账本",
      }),
    ).toBeTruthy();
    expect(requestRememberedPermission).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "重新连接" }),
    );
    expect(requestRememberedPermission).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", {
        name: "解锁所选账本",
      }),
    ).toBeTruthy();
  });

  it("keeps denied remembered C fail-closed until explicit forget", async () => {
    const user = userEvent.setup();
    const forgetRememberedConnection = vi.fn(async () => undefined);
    const fileController = createFileController({
      inspectRememberedConnection: vi.fn(async () => ({
        status: "error" as const,
        ok: false as const,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_DENIED,
      })),
      forgetRememberedConnection,
    });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "上次的账本暂时不可用",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/不会创建空账本或退回另一份账本/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "继续浏览器账本" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: "忘记这条连接并选择另一本账",
      }),
    );
    expect(forgetRememberedConnection).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", {
        name: "选择账本",
      }),
    ).toBeTruthy();
  });

  it("starts C-only without a parallel browser-ledger entry", async () => {
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={createFileController()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "选择账本" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "继续浏览器账本" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "新建账本" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "选择账本" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("retires a detected legacy record without exposing unlock, migration, or deletion", async () => {
    const controller = createController({
      inspect: vi.fn(async () => ({
        status: "unlock-required" as const,
      })),
    });
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={createFileController({
          inspectRememberedConnection: vi.fn(async () => ({
            status: "ready" as const,
            ok: true as const,
          })),
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "旧版账本已退役",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/不支持解锁、迁移或删除/)).toBeTruthy();
    expect(screen.queryByLabelText("旧浏览器账本密码")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "解锁所选账本" }),
    ).toBeNull();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    expect("unlockLegacyForMigration" in controller).toBe(false);
    expect("authorizeLegacyMigrationDeletion" in controller).toBe(false);
    expect("deleteLegacyAfterMigration" in controller).toBe(false);
  });

  it("ignores an old inspect result after the controllers change and a new C session is published", async () => {
    const user = userEvent.setup();
    const oldInspect =
      createDeferred<
        Awaited<ReturnType<LedgerAccessController["inspect"]>>
      >();
    const oldController = createController({
      inspect: vi.fn(() => oldInspect.promise),
    });
    const newController = createController();
    const fileController = createFileController();
    const rendered = render(
      <LedgerAccessGate
        accessController={oldController}
        fileAccessController={fileController}
      />,
    );

    rendered.rerender(
      <LedgerAccessGate
        accessController={newController}
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

    await act(async () => {
      oldInspect.resolve({ status: "unlock-required" });
      await oldInspect.promise;
    });

    expect(screen.getByText("dashboard-mounted")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "解锁本地账本" }),
    ).toBeNull();
  });
});
