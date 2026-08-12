// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFilePickerProvider,
  type LedgerFileWritable,
} from "@/platform/files";
import type { LedgerFileSessionLease } from "@/platform/coordination";
import {
  type LedgerAccessController,
} from "@/platform/legacy";
import {
  DefaultLedgerFileAccessController,
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
} from "./ledgerFileAccessController";
import {
  claimLedgerSessionPersistencePort,
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  LedgerSessionLifecycleError,
  type LedgerRepository,
  type LedgerSession,
  type LedgerSessionPersistencePort,
  type SessionQuiesceToken,
} from "@/platform/persistence";
import { LedgerFileRepository } from "@/platform/files";
import { createInitialLedgerData } from "@/core/state";
import { LedgerAccessGate } from "./LedgerAccessGate";

const PASSPHRASE = "correct horse battery staple";
const mockPersistencePorts = new WeakMap<
  LedgerSession,
  LedgerSessionPersistencePort
>();

function getMockPersistencePort(
  session: LedgerSession,
): LedgerSessionPersistencePort {
  const existing = mockPersistencePorts.get(session);
  if (existing) {
    return existing;
  }
  const port = claimLedgerSessionPersistencePort(session, {});
  mockPersistencePorts.set(session, port);
  return port;
}

vi.mock("./DashboardShell", () => ({
  DashboardShell: ({
    session,
    onFinalLock,
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
      </div>
    );
  },
}));

const repository: LedgerRepository = {
  load: async () => null,
  save: async () => undefined,
  clear: async () => undefined,
};

function createFileSession(
  sessionRepository: LedgerRepository = repository,
) {
  return createLedgerSession({
    storageKind: "ledger-file",
    repository: sessionRepository,
    capabilities: LEDGER_FILE_CAPABILITIES,
  });
}

afterEach(() => {
  cleanup();
});

function createController(
  overrides: Partial<LedgerAccessController> = {},
): LedgerAccessController {
  return {
    inspect: vi.fn(async () => ({ status: "setup-required" as const })),
    ...overrides,
  };
}

function createFileController(
  overrides: Partial<LedgerFileAccessController> = {},
): LedgerFileAccessController {
  return {
    inspectRememberedConnection: vi.fn(async () => ({
      status: "none" as const,
      ok: true as const,
    })),
    requestRememberedPermission: vi.fn(async () => ({
      status: "permission-prompt" as const,
      ok: false as const,
    })),
    reselectRememberedConnection: vi.fn(async () => ({
      ok: false as const,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
    })),
    forgetRememberedConnection: vi.fn(async () => undefined),
    create: vi.fn(async () => ({
      status: "unlocked" as const,
      ok: true as const,
      session: createFileSession(),
    })),
    selectExisting: vi.fn(async () => ({ ok: true as const })),
    unlockSelected: vi.fn(async () => ({
      status: "unlocked" as const,
      ok: true as const,
      session: createFileSession(),
    })),
    confirmRecovery: vi.fn(async () => ({
      status: "error" as const,
      ok: false as const,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND,
    })),
    cancelRecovery: vi.fn(async () => undefined),
    cancelPendingSelection: vi.fn(),
    ...overrides,
  };
}

const GATE_TEST_LEASE: LedgerFileSessionLease = {
  sessionId: "gate-fixture",
  runExclusiveWrite: (operation) => operation(),
  release: async () => undefined,
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class MemoryLedgerFileHandle implements LedgerFileHandle {
  bytes = new Uint8Array();

  constructor(readonly name = "gate-a.lftl") {}

  async getFile() {
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  async createWritable(): Promise<LedgerFileWritable> {
    let pending = this.bytes;
    return {
      write: async (serialized) => {
        pending = new TextEncoder().encode(serialized);
      },
      close: async () => {
        this.bytes = pending;
      },
      abort: async () => undefined,
    };
  }

  async isSameEntry(other: LedgerFileHandle): Promise<boolean> {
    return other === this;
  }
}

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
        name: "解锁所选 C",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "选择或新建 C" }),
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
        name: "重新连接上次的 C",
      }),
    ).toBeTruthy();
    expect(requestRememberedPermission).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "重新连接" }),
    );
    expect(requestRememberedPermission).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", {
        name: "解锁所选 C",
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
        name: "上次的 C 暂时不可用",
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
        name: "选择或新建 C",
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
      await screen.findByRole("heading", { name: "选择或新建 C" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "继续浏览器账本" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "新建 C（.lftl）" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "选择 C（.lftl）" }),
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
      screen.queryByRole("heading", { name: "解锁所选 C" }),
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
      await screen.findByRole("button", { name: "新建 C（.lftl）" }),
    );
    await user.type(
      screen.getByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
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
      await screen.findByRole("button", { name: "新建 C（.lftl）" }),
    );
    const password = screen.getByLabelText("设置 C 核心密码");
    const confirmation = screen.getByLabelText(
      "再次输入 C 核心密码",
    );

    fireEvent.change(password, { target: { value: "a".repeat(11) } });
    fireEvent.change(confirmation, {
      target: { value: "a".repeat(11) },
    });
    await user.click(
      screen.getByRole("button", { name: "选择位置并创建" }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "12 至 128",
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
      await screen.findByRole("button", { name: "新建 C（.lftl）" }),
    );
    await user.type(
      screen.getByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
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
      await screen.findByRole("button", { name: "新建 C（.lftl）" }),
    );
    await user.type(
      screen.getByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
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
        name: "选择或新建 C",
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
      await screen.findByRole("button", { name: "新建 C（.lftl）" }),
    );
    await user.type(
      screen.getByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
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
      screen.queryByRole("heading", { name: "选择或新建 C" }),
    ).toBeNull();

    releaseDeferred.resolve();
    expect(
      await screen.findByRole("heading", {
        name: "选择或新建 C",
      }),
    ).toBeTruthy();
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
      await screen.findByRole("button", { name: "新建 C（.lftl）" }),
    );
    await user.type(
      screen.getByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
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
      screen.getByRole("heading", { name: "选择或新建 C" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("explains that retired or unknown .lftl versions require a new V2 ledger", async () => {
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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );

    expect(
      screen.getByText(/版本 2 不支持解锁或迁移/),
    ).toBeTruthy();
    expect(screen.getByText(/请新建版本 2 账本/)).toBeTruthy();
    expect(screen.queryByLabelText("C 核心密码")).toBeNull();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );
    expect(oldFileController.selectExisting).toHaveBeenCalledOnce();

    rendered.rerender(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={newFileController}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "选择或新建 C" }),
    ).toBeTruthy();

    await act(async () => {
      slowSelection.resolve({ ok: true });
      await slowSelection.promise;
    });

    expect(
      screen.getByRole("heading", { name: "选择或新建 C" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "解锁所选 C" }),
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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
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
          name: "选择 C（.lftl）",
        }),
      );
      const password = await screen.findByLabelText("C 核心密码");
      await user.type(password, secret);
      await user.click(
        screen.getByRole("button", { name: "解锁所选 C" }),
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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );
    await user.type(
      await screen.findByLabelText("C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选 C" }),
    );
    expect(oldFileController.unlockSelected).toHaveBeenCalledOnce();

    rendered.rerender(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={newFileController}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "选择或新建 C" }),
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
      screen.getByRole("heading", { name: "选择或新建 C" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );
    await user.type(
      await screen.findByLabelText("C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选 C" }),
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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );
    await user.type(
      await screen.findByLabelText("C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选 C" }),
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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );
    await user.type(
      await screen.findByLabelText("C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选 C" }),
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
      await screen.findByRole("heading", { name: "选择或新建 C" }),
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
      screen.getByRole("heading", { name: "选择或新建 C" }),
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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );
    await user.type(
      await screen.findByLabelText("C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选 C" }),
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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );
    await user.type(
      await screen.findByLabelText("C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选 C" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "取消恢复" }),
    );

    expect(
      await screen.findByRole("heading", { name: "选择或新建 C" }),
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
      await screen.findByRole("button", { name: "选择 C（.lftl）" }),
    );
    await user.type(
      await screen.findByLabelText("C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "解锁所选 C" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "取消恢复" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "C 仍保持关闭，请重试取消恢复",
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
      await screen.findByRole("heading", { name: "选择或新建 C" }),
    ).toBeTruthy();
    expect(cancelRecovery).toHaveBeenCalledTimes(2);
  });

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
      "无法确认这个 C 是否已被其他页面使用",
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
          name: "选择 C（.lftl）",
        }),
      );
      await user.type(
        await screen.findByLabelText("C 核心密码"),
        PASSPHRASE,
      );
      await user.click(
        screen.getByRole("button", { name: "解锁所选 C" }),
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
        name: "新建 C（.lftl）",
      }),
    );

    const password = (await screen.findByLabelText(
      "设置 C 核心密码",
    )) as HTMLInputElement;
    const confirmation = screen.getByLabelText(
      "再次输入 C 核心密码",
    ) as HTMLInputElement;
    const revealPassword = screen.getByRole("button", {
      name: "按住查看设置 C 核心密码",
    });
    const revealConfirmation = screen.getByRole("button", {
      name: "按住查看再次输入 C 核心密码",
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
      screen.getByLabelText("设置 C 核心密码"),
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
        name: "新建 C（.lftl）",
      }),
    );

    const password = (await screen.findByLabelText(
      "设置 C 核心密码",
    )) as HTMLInputElement;
    const reveal = screen.getByRole("button", {
      name: "按住查看设置 C 核心密码",
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
