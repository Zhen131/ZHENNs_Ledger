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
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
} from "@/app/file-access";
import { type SessionQuiesceToken } from "@/platform/persistence";
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
  it("selects C before password entry, clears failed passwords, and never mounts before full unlock", async () => {
    const user = userEvent.setup();
    const unlockSelected = vi
      .fn()
      .mockResolvedValueOnce({
        status: "error" as const,
        ok: false as const,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      })
      .mockResolvedValueOnce({
        status: "unlocked" as const,
        ok: true as const,
        session: createFileSession(),
      });
    const fileController = createFileController({ unlockSelected });
    render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "选择账本" }),
    );
    expect(
      await screen.findByRole("heading", { name: "解锁所选账本" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    const password = screen.getByLabelText("账本核心密码");
    await user.type(password, "wrong but valid password");
    await user.click(screen.getByRole("button", { name: "解锁所选账本" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "密码错误或文件认证失败",
    );
    expect((password as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.type(password, "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "解锁所选账本" }));
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    expect(unlockSelected).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed C password out of browser storage, rendered errors, and console output", async () => {
    const user = userEvent.setup();
    const secret = "unique failed password 2026";
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ];
    const unlockSelected = vi.fn(async () => ({
      status: "error" as const,
      ok: false as const,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
    }));
    const fileController = createFileController({ unlockSelected });

    try {
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
      const password = await screen.findByLabelText("账本核心密码");
      await user.type(password, secret);
      await user.click(
        screen.getByRole("button", { name: "解锁所选账本" }),
      );
      await screen.findByRole("alert");

      expect((password as HTMLInputElement).value).toBe("");
      expect(document.body.textContent).not.toContain(secret);
      expect(JSON.stringify(storageWrite.mock.calls)).not.toContain(
        secret,
      );
      expect(
        JSON.stringify(
          consoleSpies.flatMap((spy) => spy.mock.calls),
        ),
      ).not.toContain(secret);
      const failedResult =
        await unlockSelected.mock.results[0]?.value;
      expect(JSON.stringify(failedResult)).not.toContain(secret);
    } finally {
      storageWrite.mockRestore();
      for (const spy of consoleSpies) {
        spy.mockRestore();
      }
    }
  });

  it("ignores a slow unlock from an old file controller after the controller changes", async () => {
    const user = userEvent.setup();
    const accessController = createController();
    const slowUnlock =
      createDeferred<
        Awaited<
          ReturnType<LedgerFileAccessController["unlockSelected"]>
        >
      >();
    const oldFileController = createFileController({
      unlockSelected: vi.fn(() => slowUnlock.promise),
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
    expect(oldFileController.unlockSelected).toHaveBeenCalledOnce();

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
      slowUnlock.resolve({
        status: "unlocked",
        ok: true,
        session: createFileSession(),
      });
      await slowUnlock.promise;
    });

    expect(
      screen.getByRole("heading", { name: "选择账本" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });
});
