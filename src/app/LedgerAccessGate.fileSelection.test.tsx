// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFilePickerProvider,
} from "@/platform/files";
import {
  DefaultLedgerFileAccessController,
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
} from "@/app/file-access";
import { type SessionQuiesceToken } from "@/platform/persistence";
import {
  LedgerFileRepository,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
} from "@/platform/files";
import { createInitialLedgerData } from "@/core/state";
import { LedgerAccessGate } from "./LedgerAccessGate";
import type {
  LedgerSessionFatalSignal,
  PersistentLedgerState,
} from "@/app/persistence";
import {
  GATE_TEST_LEASE,
  MemoryLedgerFileHandle,
  PASSPHRASE,
  createController,
  createDeferred,
  createFileController,
  createFileSession,
  createInspectableLedgerFile,
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
      await screen.findByRole("button", { name: "选择账本" }),
    );

    expect(
      screen.getByRole("heading", { name: "选择账本" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("explains that retired or unknown .lftl container versions are not migrated", async () => {
    const user = userEvent.setup();
    const fileController = createFileController({
      selectExisting: vi.fn(async () => ({
        ok: false as const,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_FILE_VERSION,
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

    expect(
      screen.getByText(/当前版本不支持解锁或迁移/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("账本核心密码")).toBeNull();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("rejects a V3 ledger without touching it, then creates V4 with ready import reachable in the same flow", async () => {
    const user = userEvent.setup();
    const retiredSource = new MemoryLedgerFileHandle(
      "retired-v3.lftl",
      createInspectableLedgerFile(3),
    );
    const sourceBefore = retiredSource.bytes.slice();
    const v4Target = new MemoryLedgerFileHandle("created-v4.lftl");
    const pickerProvider: LedgerFilePickerProvider = {
      showOpenFilePicker: vi.fn(async () => [retiredSource]),
      showSaveFilePicker: vi.fn(async () => v4Target),
    };
    const connectionAdapter = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const realController = new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(pickerProvider),
      {
        generateId: vi
          .fn()
          .mockReturnValueOnce("created-v4-file")
          .mockReturnValueOnce("created-v4-revision"),
        now: () => new Date("2026-08-18T08:00:00.000Z"),
      },
      {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease: GATE_TEST_LEASE,
        })),
      },
      () => "unused-recovery",
      connectionAdapter,
    );
    const fileController = createFileController({
      create: vi.fn((passphrase) => realController.create(passphrase)),
      selectExisting: vi.fn(() => realController.selectExisting()),
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

    expect(
      screen.getByText(
        new RegExp(
          `该文件承载 V3、其他旧版或未知 schema 的账本；当前 V${SUPPORTED_LEDGER_SCHEMA_VERSION} 不兼容且不提供迁移`,
        ),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/原文件未被写入、删除或覆盖/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("账本核心密码")).toBeNull();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    expect(retiredSource.bytes).toEqual(sourceBefore);
    expect(retiredSource.writes).toBe(0);
    expect(retiredSource.remove).not.toHaveBeenCalled();
    expect(connectionAdapter.write).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "新建账本" }));
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

    expect(fileController.create).toHaveBeenCalledWith(PASSPHRASE);
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "导入与导出" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("选择账本备份文件")).toBeTruthy();
    expect(v4Target.writes).toBeGreaterThan(0);
  });

  it("ignores a slow file selection from an old controller after the controller changes", async () => {
    const accessController = createController();
    const slowSelection =
      createDeferred<
        Awaited<
          ReturnType<LedgerFileAccessController["selectExisting"]>
        >
      >();
    const oldFileController = createFileController({
      selectExisting: vi.fn(() => slowSelection.promise),
    });
    const newFileController = createFileController();
    const rendered = render(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={oldFileController}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "选择账本" }),
    );
    expect(oldFileController.selectExisting).toHaveBeenCalledOnce();

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
      slowSelection.resolve({ ok: true });
      await slowSelection.promise;
    });

    expect(
      screen.getByRole("heading", { name: "选择账本" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "解锁所选账本" }),
    ).toBeNull();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("invalidates the real controller selection on unmount before slow A resolves", async () => {
    const handleA = new MemoryLedgerFileHandle();
    await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handleA,
      PASSPHRASE,
      createInitialLedgerData(),
      {
        generateId: vi
          .fn()
          .mockReturnValueOnce("file-gate-a")
          .mockReturnValueOnce("revision-gate-a"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
        sessionLease: GATE_TEST_LEASE,
      },
    );
    const deferredPicker = createDeferred<LedgerFileHandle[]>();
    const provider: LedgerFilePickerProvider = {
      showSaveFilePicker: vi.fn(async () => new MemoryLedgerFileHandle()),
      showOpenFilePicker: vi.fn(() => deferredPicker.promise),
    };
    const realController = new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(provider),
    );
    let selectionPromise: Promise<
      Awaited<ReturnType<typeof realController.selectExisting>>
    > | null = null;
    const cancelPendingSelection = vi.fn(() => {
      realController.cancelPendingSelection();
    });
    const fileController: LedgerFileAccessController = {
      inspectRememberedConnection: () =>
        realController.inspectRememberedConnection(),
      requestRememberedPermission: () =>
        realController.requestRememberedPermission(),
      reselectRememberedConnection: () =>
        realController.reselectRememberedConnection(),
      forgetRememberedConnection: () =>
        realController.forgetRememberedConnection(),
      create: (passphrase) => realController.create(passphrase),
      selectExisting: () => {
        selectionPromise = realController.selectExisting();
        return selectionPromise;
      },
      unlockSelected: (passphrase) =>
        realController.unlockSelected(passphrase),
      confirmRecovery: (recoveryId) =>
        realController.confirmRecovery(recoveryId),
      cancelRecovery: (recoveryId) =>
        realController.cancelRecovery(recoveryId),
      cancelPendingSelection,
    };
    const rendered = render(
      <LedgerAccessGate
        accessController={createController()}
        fileAccessController={fileController}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "选择账本" }),
    );
    await waitFor(() => {
      expect(provider.showOpenFilePicker).toHaveBeenCalledOnce();
    });
    rendered.unmount();
    expect(cancelPendingSelection).toHaveBeenCalledOnce();
    deferredPicker.resolve([handleA]);
    await selectionPromise;

    await expect(
      realController.unlockSelected(PASSPHRASE),
    ).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
  });
});
