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
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IndexedDbStorageAdapter } from "../../adapters/indexedDbStorageAdapter";
import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFilePickerProvider,
  type LedgerFileWritable,
} from "../../adapters/ledgerFileHandleAdapter";
import type { LedgerFileSessionLease } from "../../coordination/ledgerFileSessionCoordinator";
import { createNoopStoredLedgerEnvelope } from "../../encryption/noopEncryptionService";
import {
  LEDGER_ACCESS_ERROR_CODES,
  type LedgerAccessController,
  type LegacyMigrationCandidate,
  type LegacyMigrationDeletionAuthorization,
} from "../../composition/ledgerAccessController";
import {
  DefaultLedgerFileAccessController,
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
  type LedgerFileMigrationReceipt,
} from "../../composition/ledgerFileAccessController";
import {
  claimLedgerSessionPersistencePort,
  createLedgerSession,
  LEDGER_FILE_CAPABILITIES,
  LedgerSessionLifecycleError,
  type LedgerRepository,
  type LedgerSession,
  type LedgerSessionPersistencePort,
  type SessionQuiesceToken,
} from "../../repositories/ledgerRepository";
import { LedgerFileRepository } from "../../repositories/ledgerFileRepository";
import { createInitialLedgerData } from "../../state/initialLedgerData";
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

vi.mock("../dashboard/DashboardShell", () => ({
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

function createMigrationCandidate(): LegacyMigrationCandidate {
  return {
    candidateId: "gate-migration-candidate",
    readLedgerData: () => createInitialLedgerData(),
  } as unknown as LegacyMigrationCandidate;
}

function createMigrationReceipt(
  session: LedgerSession,
): LedgerFileMigrationReceipt {
  return {
    sessionId: session.sessionId,
    generation: session.generation,
    fileId: "gate-migration-file",
    verifiedRevisionId: "gate-migration-revision",
    serializedLedgerData: JSON.stringify(
      createInitialLedgerData(),
    ),
  } as unknown as LedgerFileMigrationReceipt;
}

function createMigrationDeletionAuthorization():
  LegacyMigrationDeletionAuthorization {
  return {
    candidateId: "gate-migration-candidate",
    targetSessionId: "gate-migration-session",
    targetGeneration: 0,
    targetFileId: "gate-migration-file",
    targetRevisionId: "gate-migration-revision",
    confirmationNonce: "删除旧浏览器账本",
  } as unknown as LegacyMigrationDeletionAuthorization;
}

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
    unlockLegacyForMigration: vi.fn(async () => ({
      ok: true as const,
      candidate: createMigrationCandidate(),
    })),
    authorizeLegacyMigrationDeletion: vi.fn(async () =>
      createMigrationDeletionAuthorization(),
    ),
    deleteLegacyAfterMigration: vi.fn(async () => ({
      ok: true as const,
    })),
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
    createFromLegacy: vi.fn(async () => ({
      status: "unlocked" as const,
      ok: true as const,
      session: createFileSession(),
    })),
    verifyMigrationTarget: vi.fn(async (session) =>
      createMigrationReceipt(session),
    ),
    revalidateMigrationReceipt: vi.fn(async () => true),
    releaseUnpublishedMigrationSession: vi.fn(async () => undefined),
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

async function createLegacyRecordHarness(name: string) {
  const storage = new IndexedDbStorageAdapter({
    databaseName: `gate-legacy-cancel-${name}`,
    indexedDBFactory: new IDBFactory(),
  });
  const envelope = createNoopStoredLedgerEnvelope(
    `legacy-record-${name}`,
  );
  await storage.write(envelope);
  const serializedBefore = JSON.stringify(await storage.read());
  return {
    storage,
    envelope,
    serializedBefore,
  };
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
    expect(controller.unlockLegacyForMigration).not.toHaveBeenCalled();
    expect(controller.authorizeLegacyMigrationDeletion).not.toHaveBeenCalled();
    expect(controller.deleteLegacyAfterMigration).not.toHaveBeenCalled();
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

  describe.skip("retired legacy migration behavior", () => {
  it("masks the legacy migration password immediately when submission disables it", async () => {
    let resolveUnlock:
      | ((value: {
          ok: true;
          candidate: LegacyMigrationCandidate;
        }) => void)
      | undefined;
    const unlock = vi.fn(
      () =>
        new Promise<{
          ok: true;
          candidate: LegacyMigrationCandidate;
        }>(
          (resolve) => {
            resolveUnlock = resolve;
          },
        ),
    );
    const controller = createController({
      inspect: vi.fn(async () => ({ status: "unlock-required" as const })),
      unlockLegacyForMigration: unlock,
    });
    const user = userEvent.setup();
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={createFileController()}
      />,
    );
    const password = (await screen.findByLabelText(
      "旧浏览器账本密码",
    )) as HTMLInputElement;
    const reveal = screen.getByRole("button", {
      name: "按住查看旧浏览器账本密码",
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

    resolveUnlock?.({
      ok: true,
      candidate: createMigrationCandidate(),
    });
    expect(
      await screen.findByRole("heading", {
        name: "创建迁移目标 C",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("enters Dashboard only after legacy verification, C readback receipt, and explicit legacy deletion", async () => {
    const user = userEvent.setup();
    const controller = createController({
      inspect: vi.fn(async () => ({
        status: "unlock-required" as const,
      })),
    });
    const fileController = createFileController();
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={fileController}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "把旧账本搬到 C",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.type(
      screen.getByLabelText("旧浏览器账本密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "验证旧账本" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "创建迁移目标 C",
      }),
    ).toBeTruthy();
    expect(
      controller.unlockLegacyForMigration,
    ).toHaveBeenCalledWith(PASSPHRASE);

    await user.type(
      screen.getByLabelText("设置 C 核心密码"),
      "long password",
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
      "different password",
    );
    await user.click(
      screen.getByRole("button", {
        name: "选择新文件并搬入旧账本",
      }),
    );
    expect(fileController.createFromLegacy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "两次输入的密码不一致",
    );

    await user.clear(
      screen.getByLabelText("设置 C 核心密码"),
    );
    await user.clear(
      screen.getByLabelText("再次输入 C 核心密码"),
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
      screen.getByRole("button", {
        name: "选择新文件并搬入旧账本",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "迁移已验证，确认退出旧账本",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    expect(fileController.createFromLegacy).toHaveBeenCalledWith(
      PASSPHRASE,
      createInitialLedgerData(),
    );
    await user.type(
      screen.getByLabelText("输入删除旧账本确认文本"),
      "删除旧浏览器账本",
    );
    await user.click(
      screen.getByRole("button", {
        name: "确认删除旧记录并进入 C",
      }),
    );

    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    expect(
      controller.authorizeLegacyMigrationDeletion,
    ).toHaveBeenCalledOnce();
    expect(
      controller.deleteLegacyAfterMigration,
    ).toHaveBeenCalledOnce();
  });

  it("keeps legacy untouched and Dashboard closed when target C creation fails", async () => {
    const user = userEvent.setup();
    const controller = createController({
      inspect: vi.fn(async () => ({
        status: "unlock-required" as const,
      })),
    });
    const fileController = createFileController({
      createFromLegacy: vi.fn(async () => ({
        status: "error" as const,
        ok: false as const,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED,
      })),
    });
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={fileController}
      />,
    );

    await user.type(
      await screen.findByLabelText("旧浏览器账本密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "验证旧账本" }),
    );
    await user.type(
      await screen.findByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "选择新文件并搬入旧账本",
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "创建、关闭或复读验证失败",
    );
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    expect(
      controller.authorizeLegacyMigrationDeletion,
    ).not.toHaveBeenCalled();
    expect(
      controller.deleteLegacyAfterMigration,
    ).not.toHaveBeenCalled();
  });

  it("uses one generic message for a legacy migration unlock failure and clears the password field", async () => {
    const user = userEvent.setup();
    const controller = createController({
      inspect: vi.fn(async () => ({ status: "unlock-required" as const })),
      unlockLegacyForMigration: vi.fn(async () => ({
        ok: false as const,
        code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_UNLOCK_FAILED,
      })),
    });
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={createFileController()}
      />,
    );
    const password = await screen.findByLabelText(
      "旧浏览器账本密码",
    );
    await user.type(password, "wrong but long password");
    await user.click(
      screen.getByRole("button", { name: "验证旧账本" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "旧账本密码错误、数据损坏或不符合安全迁移条件",
    );
    expect((password as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("does not submit legacy migration unlock twice while one operation is pending", async () => {
    const user = userEvent.setup();
    let resolveUnlock:
      | ((value: {
          ok: true;
          candidate: LegacyMigrationCandidate;
        }) => void)
      | undefined;
    const unlock = vi.fn(
      () =>
        new Promise<{
          ok: true;
          candidate: LegacyMigrationCandidate;
        }>(
          (resolve) => {
            resolveUnlock = resolve;
          },
        ),
    );
    const controller = createController({
      inspect: vi.fn(async () => ({ status: "unlock-required" as const })),
      unlockLegacyForMigration: unlock,
    });
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={createFileController()}
      />,
    );
    await user.type(
      await screen.findByLabelText("旧浏览器账本密码"),
      PASSPHRASE,
    );
    const submit = screen.getByRole("button", {
      name: "验证旧账本",
    });
    await user.dblClick(submit);

    expect(unlock).toHaveBeenCalledOnce();
    resolveUnlock?.({
      ok: true,
      candidate: createMigrationCandidate(),
    });
    expect(
      await screen.findByRole("heading", {
        name: "创建迁移目标 C",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("retains and retries cleanup when a migration C returns after unmount and its first release fails", async () => {
    const user = userEvent.setup();
    const migrationSession = createFileSession();
    let resolveCreate!: (value: {
      status: "unlocked";
      ok: true;
      session: LedgerSession;
    }) => void;
    const createFromLegacy = vi.fn(
      () =>
        new Promise<{
          status: "unlocked";
          ok: true;
          session: LedgerSession;
        }>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const releaseUnpublishedMigrationSession = vi
      .fn<(session: LedgerSession) => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("first migration release failed"),
      )
      .mockResolvedValueOnce(undefined);
    const accessController = createController({
      inspect: vi.fn(async () => ({
        status: "unlock-required" as const,
      })),
    });
    const fileAccessController = createFileController({
      createFromLegacy,
      releaseUnpublishedMigrationSession,
    });
    const first = render(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={fileAccessController}
      />,
    );
    await user.type(
      await screen.findByLabelText("旧浏览器账本密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "验证旧账本" }),
    );
    await user.type(
      await screen.findByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "选择新文件并搬入旧账本",
      }),
    );
    expect(createFromLegacy).toHaveBeenCalledOnce();
    first.unmount();

    await act(async () => {
      resolveCreate({
        status: "unlocked",
        ok: true,
        session: migrationSession,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        releaseUnpublishedMigrationSession,
      ).toHaveBeenCalledOnce();
    });

    render(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={fileAccessController}
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
    expect(
      await screen.findByLabelText("旧浏览器账本密码"),
    ).toBeTruthy();
    expect(
      releaseUnpublishedMigrationSession,
    ).toHaveBeenCalledTimes(2);
    expect(
      releaseUnpublishedMigrationSession.mock.calls[1]?.[0],
    ).toBe(migrationSession);
  });

  it("retains and retries cleanup when unmounted during migration target verification", async () => {
    const user = userEvent.setup();
    const migrationSession = createFileSession();
    const verification =
      createDeferred<LedgerFileMigrationReceipt | null>();
    const releaseUnpublishedMigrationSession = vi
      .fn<(session: LedgerSession) => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("verification cleanup failed"),
      )
      .mockResolvedValueOnce(undefined);
    const accessController = createController({
      inspect: vi.fn(async () => ({
        status: "unlock-required" as const,
      })),
    });
    const verifyMigrationTarget = vi.fn(
      () => verification.promise,
    );
    const fileAccessController = createFileController({
      createFromLegacy: vi.fn(async () => ({
        status: "unlocked" as const,
        ok: true as const,
        session: migrationSession,
      })),
      verifyMigrationTarget,
      releaseUnpublishedMigrationSession,
    });
    const first = render(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={fileAccessController}
      />,
    );
    await user.type(
      await screen.findByLabelText("旧浏览器账本密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "验证旧账本" }),
    );
    await user.type(
      await screen.findByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "选择新文件并搬入旧账本",
      }),
    );
    await waitFor(() => {
      expect(verifyMigrationTarget).toHaveBeenCalledOnce();
    });
    first.unmount();
    await waitFor(() => {
      expect(
        releaseUnpublishedMigrationSession,
      ).toHaveBeenCalledOnce();
    });
    await act(async () => {
      verification.resolve(
        createMigrationReceipt(migrationSession),
      );
      await verification.promise;
    });

    render(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={fileAccessController}
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
    expect(
      await screen.findByLabelText("旧浏览器账本密码"),
    ).toBeTruthy();
    expect(
      releaseUnpublishedMigrationSession,
    ).toHaveBeenCalledTimes(2);
  });

  it("keeps the exact legacy record when migration is cancelled before creating C", async () => {
    const legacy = await createLegacyRecordHarness(
      "before-create",
    );
    const user = userEvent.setup();
    const controller = createController({
      inspect: vi.fn(async () => ({
        status: "unlock-required" as const,
      })),
    });
    const fileController = createFileController();
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={fileController}
      />,
    );

    await user.type(
      await screen.findByLabelText("旧浏览器账本密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "验证旧账本" }),
    );
    await screen.findByRole("heading", {
      name: "创建迁移目标 C",
    });
    await user.click(
      screen.getByRole("button", {
        name: "取消，保留旧账本",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "把旧账本搬到 C",
      }),
    ).toBeTruthy();
    expect(fileController.createFromLegacy).not.toHaveBeenCalled();
    expect(
      fileController.releaseUnpublishedMigrationSession,
    ).not.toHaveBeenCalled();
    expect(
      controller.authorizeLegacyMigrationDeletion,
    ).not.toHaveBeenCalled();
    expect(
      controller.deleteLegacyAfterMigration,
    ).not.toHaveBeenCalled();
    expect(JSON.stringify(await legacy.storage.read())).toBe(
      legacy.serializedBefore,
    );
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    await legacy.storage.close();
  });

  it("keeps legacy and releases the unpublished C when migration is cancelled after verification", async () => {
    const legacy = await createLegacyRecordHarness(
      "after-verification",
    );
    const user = userEvent.setup();
    const migrationSession = createFileSession();
    const releaseUnpublishedMigrationSession = vi.fn(
      async () => undefined,
    );
    const controller = createController({
      inspect: vi.fn(async () => ({
        status: "unlock-required" as const,
      })),
    });
    const fileController = createFileController({
      createFromLegacy: vi.fn(async () => ({
        status: "unlocked" as const,
        ok: true as const,
        session: migrationSession,
      })),
      verifyMigrationTarget: vi.fn(async () =>
        createMigrationReceipt(migrationSession),
      ),
      releaseUnpublishedMigrationSession,
    });
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={fileController}
      />,
    );

    await user.type(
      await screen.findByLabelText("旧浏览器账本密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "验证旧账本" }),
    );
    await user.type(
      await screen.findByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "选择新文件并搬入旧账本",
      }),
    );
    await screen.findByRole("heading", {
      name: "迁移已验证，确认退出旧账本",
    });
    await user.click(
      screen.getByRole("button", {
        name: "保留旧记录并安全退出新 C",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "把旧账本搬到 C",
      }),
    ).toBeTruthy();
    expect(
      releaseUnpublishedMigrationSession,
    ).toHaveBeenCalledOnce();
    expect(
      releaseUnpublishedMigrationSession,
    ).toHaveBeenCalledWith(migrationSession);
    expect(
      controller.authorizeLegacyMigrationDeletion,
    ).not.toHaveBeenCalled();
    expect(
      controller.deleteLegacyAfterMigration,
    ).not.toHaveBeenCalled();
    expect(JSON.stringify(await legacy.storage.read())).toBe(
      legacy.serializedBefore,
    );
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    await legacy.storage.close();
  });

  it("does not delete legacy when migration deletion authorization resolves after unmount", async () => {
    const legacy = await createLegacyRecordHarness(
      "late-delete-authorization",
    );
    const user = userEvent.setup();
    const migrationSession = createFileSession();
    const authorization =
      createDeferred<LegacyMigrationDeletionAuthorization | null>();
    const authorizeLegacyMigrationDeletion = vi.fn(
      () => authorization.promise,
    );
    const deleteLegacyAfterMigration = vi.fn(async () => {
      const result = await legacy.storage.deleteIfUnchanged(
        legacy.envelope,
      );
      return result === "deleted"
        ? ({ ok: true } as const)
        : ({
            ok: false,
            code:
              LEDGER_ACCESS_ERROR_CODES.MIGRATION_SOURCE_CHANGED,
          } as const);
    });
    const controller = createController({
      inspect: vi.fn(async () => ({
        status: "unlock-required" as const,
      })),
      authorizeLegacyMigrationDeletion,
      deleteLegacyAfterMigration,
    });
    const releaseUnpublishedMigrationSession = vi.fn(
      async () => undefined,
    );
    const fileController = createFileController({
      createFromLegacy: vi.fn(async () => ({
        status: "unlocked" as const,
        ok: true as const,
        session: migrationSession,
      })),
      verifyMigrationTarget: vi.fn(async () =>
        createMigrationReceipt(migrationSession),
      ),
      releaseUnpublishedMigrationSession,
    });
    const rendered = render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={fileController}
      />,
    );

    await user.type(
      await screen.findByLabelText("旧浏览器账本密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "验证旧账本" }),
    );
    await user.type(
      await screen.findByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "选择新文件并搬入旧账本",
      }),
    );
    await user.type(
      await screen.findByLabelText(
        "输入删除旧账本确认文本",
      ),
      "删除旧浏览器账本",
    );
    await user.click(
      screen.getByRole("button", {
        name: "确认删除旧记录并进入 C",
      }),
    );
    await waitFor(() => {
      expect(
        authorizeLegacyMigrationDeletion,
      ).toHaveBeenCalledOnce();
    });

    rendered.unmount();
    await waitFor(() => {
      expect(
        releaseUnpublishedMigrationSession,
      ).toHaveBeenCalledWith(migrationSession);
    });
    await act(async () => {
      authorization.resolve(
        createMigrationDeletionAuthorization(),
      );
      await authorization.promise;
      await Promise.resolve();
    });

    expect(deleteLegacyAfterMigration).not.toHaveBeenCalled();
    expect(JSON.stringify(await legacy.storage.read())).toBe(
      legacy.serializedBefore,
    );
    await legacy.storage.close();
  });

  it("requires exact post-verification deletion text and keeps legacy when deletion fails", async () => {
    const user = userEvent.setup();
    const deleteLegacyAfterMigration = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_DELETE_FAILED,
      })
      .mockResolvedValueOnce({ ok: true });
    const controller = createController({
      inspect: vi.fn(async () => ({ status: "unlock-required" as const })),
      deleteLegacyAfterMigration,
    });
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={createFileController()}
      />,
    );
    await user.type(
      await screen.findByLabelText("旧浏览器账本密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "验证旧账本" }),
    );
    await user.type(
      await screen.findByLabelText("设置 C 核心密码"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("再次输入 C 核心密码"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "选择新文件并搬入旧账本",
      }),
    );
    const confirmation = await screen.findByLabelText(
      "输入删除旧账本确认文本",
    );
    await user.type(confirmation, "删除");
    await user.click(
      screen.getByRole("button", {
        name: "确认删除旧记录并进入 C",
      }),
    );
    expect(
      controller.authorizeLegacyMigrationDeletion,
    ).not.toHaveBeenCalled();
    expect(deleteLegacyAfterMigration).not.toHaveBeenCalled();

    await user.clear(confirmation);
    await user.type(confirmation, "删除旧浏览器账本");
    await user.click(
      screen.getByRole("button", {
        name: "确认删除旧记录并进入 C",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "旧浏览器账本没有被安全删除",
    );
    expect(
      screen.getByRole("heading", {
        name: "迁移已验证，确认退出旧账本",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: "确认删除旧记录并进入 C",
      }),
    );
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();
    expect(
      controller.authorizeLegacyMigrationDeletion,
    ).toHaveBeenCalledOnce();
    expect(deleteLegacyAfterMigration).toHaveBeenCalledTimes(2);
    expect(deleteLegacyAfterMigration.mock.calls[1]?.[0]).toBe(
      deleteLegacyAfterMigration.mock.calls[0]?.[0],
    );
  });

  it("offers retry but never blind reset for unreadable or unsupported legacy data", async () => {
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
    render(
      <LedgerAccessGate
        accessController={controller}
        fileAccessController={createFileController()}
      />,
    );
    await screen.findByRole("button", { name: "重新检查" });
    expect(
      screen.queryByText(/清空本地加密账本并重新开始/),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "重新检查" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "旧浏览器账本暂时不能安全迁移",
        }),
      ).toBeTruthy();
    });
    expect(
      screen.queryByText(/清空本地加密账本并重新开始/),
    ).toBeNull();
    expect(controller.resetEncryptedLedger).not.toHaveBeenCalled();
  });
  });
});
