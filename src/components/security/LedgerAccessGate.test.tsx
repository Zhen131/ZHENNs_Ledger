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
    confirmationNonce: "DELETE LEGACY BROWSER LEDGER",
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
        name: "Unlock Selected C",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Select or Create C" }),
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
        name: "Reconnect the Last C",
      }),
    ).toBeTruthy();
    expect(requestRememberedPermission).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Reconnect" }),
    );
    expect(requestRememberedPermission).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", {
        name: "Unlock Selected C",
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
        name: "The Last C Is Temporarily Unavailable",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/will not create an empty ledger or substitute another ledger/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Continue with browser ledger" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: "Forget this connection and select another ledger",
      }),
    );
    expect(forgetRememberedConnection).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", {
        name: "Select or Create C",
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
      await screen.findByRole("heading", { name: "Select or Create C" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Continue with browser ledger" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create C (.lftl)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Select C (.lftl)" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
  });

  it("prioritizes verified legacy migration even when a remembered C is ready", async () => {
    render(
      <LedgerAccessGate
        accessController={createController({
          inspect: vi.fn(async () => ({
            status: "unlock-required" as const,
          })),
        })}
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
        name: "Move the Legacy Ledger to C",
      }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Legacy browser ledger password"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Unlock Selected C" }),
    ).toBeNull();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
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
      await screen.findByRole("button", { name: "Create C (.lftl)" }),
    );
    await user.type(
      screen.getByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Choose location and create" }),
    );
    expect(await screen.findByText("dashboard-mounted")).toBeTruthy();

    await act(async () => {
      oldInspect.resolve({ status: "unlock-required" });
      await oldInspect.promise;
    });

    expect(screen.getByText("dashboard-mounted")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Unlock Local Ledger" }),
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
      await screen.findByRole("button", { name: "Create C (.lftl)" }),
    );
    expect(
      screen.getByText(/forgetting the password permanently loses access to this C/),
    ).toBeTruthy();
    await user.type(
      screen.getByLabelText("Set C master password"),
      "correct horse battery staple",
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      "correct horse battery staple",
    );
    await user.click(
      screen.getByRole("button", { name: "Choose location and create" }),
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
      await screen.findByRole("button", { name: "Create C (.lftl)" }),
    );
    const password = screen.getByLabelText("Set C master password");
    const confirmation = screen.getByLabelText(
      "Re-enter C master password",
    );

    fireEvent.change(password, { target: { value: "a".repeat(11) } });
    fireEvent.change(confirmation, {
      target: { value: "a".repeat(11) },
    });
    await user.click(
      screen.getByRole("button", { name: "Choose location and create" }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "12 to 128",
    );
    expect(fileController.create).not.toHaveBeenCalled();

    fireEvent.change(password, {
      target: { value: "🔐".repeat(12) },
    });
    fireEvent.change(confirmation, {
      target: { value: `${"🔐".repeat(11)}x` },
    });
    await user.click(
      screen.getByRole("button", { name: "Choose location and create" }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "The passwords do not match",
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
      await screen.findByRole("button", { name: "Create C (.lftl)" }),
    );
    await user.type(
      screen.getByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Choose location and create" }),
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
      await screen.findByRole("button", { name: "Create C (.lftl)" }),
    );
    await user.type(
      screen.getByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Choose location and create" }),
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
        name: "Safe Release Incomplete",
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Retry safe release" }),
    );
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByRole("heading", {
        name: "Select or Create C",
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
      await screen.findByRole("button", { name: "Create C (.lftl)" }),
    );
    await user.type(
      screen.getByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Choose location and create" }),
    );
    await screen.findByText("dashboard-mounted");

    await user.click(
      screen.getByRole("button", { name: "mock-final-lock" }),
    );

    expect(onBeginQuiesce).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("heading", { name: "Locking Safely" }),
    ).toBeTruthy();
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledOnce();
    });
    expect(() => session.repository.load()).toThrow(
      LedgerSessionLifecycleError,
    );
    expect(
      screen.queryByRole("heading", { name: "Select or Create C" }),
    ).toBeNull();

    releaseDeferred.resolve();
    expect(
      await screen.findByRole("heading", {
        name: "Select or Create C",
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
      await screen.findByRole("button", { name: "Create C (.lftl)" }),
    );
    await user.type(
      screen.getByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Choose location and create" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );

    expect(
      screen.getByRole("heading", { name: "Select or Create C" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );
    expect(oldFileController.selectExisting).toHaveBeenCalledOnce();

    rendered.rerender(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={newFileController}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Select or Create C" }),
    ).toBeTruthy();

    await act(async () => {
      slowSelection.resolve({ ok: true });
      await slowSelection.promise;
    });

    expect(
      screen.getByRole("heading", { name: "Select or Create C" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Unlock Selected C" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Unlock Selected C" }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    const password = screen.getByLabelText("C master password");
    await user.type(password, "wrong but valid password");
    await user.click(screen.getByRole("button", { name: "Unlock selected C" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The password is wrong or file authentication failed",
    );
    expect((password as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.type(password, "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Unlock selected C" }));
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
          name: "Select C (.lftl)",
        }),
      );
      const password = await screen.findByLabelText("C master password");
      await user.type(password, secret);
      await user.click(
        screen.getByRole("button", { name: "Unlock selected C" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );
    await user.type(
      await screen.findByLabelText("C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Unlock selected C" }),
    );
    expect(oldFileController.unlockSelected).toHaveBeenCalledOnce();

    rendered.rerender(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={newFileController}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Select or Create C" }),
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
      screen.getByRole("heading", { name: "Select or Create C" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );
    await user.type(
      await screen.findByLabelText("C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Unlock selected C" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Confirm Previous-Version Recovery" }),
    ).toBeTruthy();
    expect(
      screen.getByText("The latest save was not recovered; the previous version will be restored."),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Confirm previous-version recovery" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );
    await user.type(
      await screen.findByLabelText("C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Unlock selected C" }),
    );

    const confirmButton = await screen.findByRole("button", {
      name: "Confirm previous-version recovery",
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );
    await user.type(
      await screen.findByLabelText("C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Unlock selected C" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm previous-version recovery" }),
    );

    rendered.rerender(
      <LedgerAccessGate
        accessController={accessController}
        fileAccessController={newFileController}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Select or Create C" }),
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
      screen.getByRole("heading", { name: "Select or Create C" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );
    await user.type(
      await screen.findByLabelText("C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Unlock selected C" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm previous-version recovery" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Previous-version recovery writing, closing, or reread verification failed",
    );
    expect(
      screen.getByRole("heading", { name: "Confirm Previous-Version Recovery" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );
    await user.type(
      await screen.findByLabelText("C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Unlock selected C" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Cancel recovery" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Select or Create C" }),
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
      await screen.findByRole("button", { name: "Select C (.lftl)" }),
    );
    await user.type(
      await screen.findByLabelText("C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Unlock selected C" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Cancel recovery" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "C remains closed; retry canceling recovery",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Cancel recovery",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Cancel recovery" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Select or Create C" }),
    ).toBeTruthy();
    expect(cancelRecovery).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      "another page or a session that has not finished releasing it",
    ],
    [
      LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED,
      "browser lacks safe multi-page file coordination",
    ],
    [
      LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_FAILED,
      "Use by another page cannot be ruled out",
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
          name: "Select C (.lftl)",
        }),
      );
      await user.type(
        await screen.findByLabelText("C master password"),
        PASSPHRASE,
      );
      await user.click(
        screen.getByRole("button", { name: "Unlock selected C" }),
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
        name: "Create C (.lftl)",
      }),
    );

    const password = (await screen.findByLabelText(
      "Set C master password",
    )) as HTMLInputElement;
    const confirmation = screen.getByLabelText(
      "Re-enter C master password",
    ) as HTMLInputElement;
    const revealPassword = screen.getByRole("button", {
      name: "Hold to view Set C master password",
    });
    const revealConfirmation = screen.getByRole("button", {
      name: "Hold to view Re-enter C master password",
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
      screen.getByLabelText("Set C master password"),
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
        name: "Create C (.lftl)",
      }),
    );

    const password = (await screen.findByLabelText(
      "Set C master password",
    )) as HTMLInputElement;
    const reveal = screen.getByRole("button", {
      name: "Hold to view Set C master password",
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
      "Legacy browser ledger password",
    )) as HTMLInputElement;
    const reveal = screen.getByRole("button", {
      name: "Hold to view Legacy browser ledger password",
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
        name: "Create Migration Target C",
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
        name: "Move the Legacy Ledger to C",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.type(
      screen.getByLabelText("Legacy browser ledger password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Verify legacy ledger" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Create Migration Target C",
      }),
    ).toBeTruthy();
    expect(
      controller.unlockLegacyForMigration,
    ).toHaveBeenCalledWith(PASSPHRASE);

    await user.type(
      screen.getByLabelText("Set C master password"),
      "long password",
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      "different password",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select a new file and move the legacy ledger",
      }),
    );
    expect(fileController.createFromLegacy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "The passwords do not match",
    );

    await user.clear(
      screen.getByLabelText("Set C master password"),
    );
    await user.clear(
      screen.getByLabelText("Re-enter C master password"),
    );
    await user.type(
      screen.getByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select a new file and move the legacy ledger",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Migration Verified: Confirm Legacy Ledger Exit",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();
    expect(fileController.createFromLegacy).toHaveBeenCalledWith(
      PASSPHRASE,
      createInitialLedgerData(),
    );
    await user.type(
      screen.getByLabelText("Enter legacy ledger deletion confirmation text"),
      "DELETE LEGACY BROWSER LEDGER",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm deletion and enter C",
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
      await screen.findByLabelText("Legacy browser ledger password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Verify legacy ledger" }),
    );
    await user.type(
      await screen.findByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select a new file and move the legacy ledger",
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "creation, close, or reread verification failed",
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
      "Legacy browser ledger password",
    );
    await user.type(password, "wrong but long password");
    await user.click(
      screen.getByRole("button", { name: "Verify legacy ledger" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "legacy ledger password is wrong, data is damaged, or safe migration requirements are not met",
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
      await screen.findByLabelText("Legacy browser ledger password"),
      PASSPHRASE,
    );
    const submit = screen.getByRole("button", {
      name: "Verify legacy ledger",
    });
    await user.dblClick(submit);

    expect(unlock).toHaveBeenCalledOnce();
    resolveUnlock?.({
      ok: true,
      candidate: createMigrationCandidate(),
    });
    expect(
      await screen.findByRole("heading", {
        name: "Create Migration Target C",
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
      await screen.findByLabelText("Legacy browser ledger password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Verify legacy ledger" }),
    );
    await user.type(
      await screen.findByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select a new file and move the legacy ledger",
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
        name: "Safe Release Incomplete",
      }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Retry safe release" }),
    );
    expect(
      await screen.findByLabelText("Legacy browser ledger password"),
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
      await screen.findByLabelText("Legacy browser ledger password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Verify legacy ledger" }),
    );
    await user.type(
      await screen.findByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select a new file and move the legacy ledger",
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
        name: "Safe Release Incomplete",
      }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Retry safe release" }),
    );
    expect(
      await screen.findByLabelText("Legacy browser ledger password"),
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
      await screen.findByLabelText("Legacy browser ledger password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Verify legacy ledger" }),
    );
    await screen.findByRole("heading", {
      name: "Create Migration Target C",
    });
    await user.click(
      screen.getByRole("button", {
        name: "Cancel and retain the legacy ledger",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Move the Legacy Ledger to C",
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
      await screen.findByLabelText("Legacy browser ledger password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Verify legacy ledger" }),
    );
    await user.type(
      await screen.findByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select a new file and move the legacy ledger",
      }),
    );
    await screen.findByRole("heading", {
      name: "Migration Verified: Confirm Legacy Ledger Exit",
    });
    await user.click(
      screen.getByRole("button", {
        name: "Retain the legacy record and safely exit the new C",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Move the Legacy Ledger to C",
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
      await screen.findByLabelText("Legacy browser ledger password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Verify legacy ledger" }),
    );
    await user.type(
      await screen.findByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select a new file and move the legacy ledger",
      }),
    );
    await user.type(
      await screen.findByLabelText(
        "Enter legacy ledger deletion confirmation text",
      ),
      "DELETE LEGACY BROWSER LEDGER",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Confirm deletion and enter C",
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
      await screen.findByLabelText("Legacy browser ledger password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", { name: "Verify legacy ledger" }),
    );
    await user.type(
      await screen.findByLabelText("Set C master password"),
      PASSPHRASE,
    );
    await user.type(
      screen.getByLabelText("Re-enter C master password"),
      PASSPHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select a new file and move the legacy ledger",
      }),
    );
    const confirmation = await screen.findByLabelText(
      "Enter legacy ledger deletion confirmation text",
    );
    await user.type(confirmation, "Delete");
    await user.click(
      screen.getByRole("button", {
        name: "Confirm deletion and enter C",
      }),
    );
    expect(
      controller.authorizeLegacyMigrationDeletion,
    ).not.toHaveBeenCalled();
    expect(deleteLegacyAfterMigration).not.toHaveBeenCalled();

    await user.clear(confirmation);
    await user.type(confirmation, "DELETE LEGACY BROWSER LEDGER");
    await user.click(
      screen.getByRole("button", {
        name: "Confirm deletion and enter C",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "legacy browser ledger was not safely deleted",
    );
    expect(
      screen.getByRole("heading", {
        name: "Migration Verified: Confirm Legacy Ledger Exit",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dashboard-mounted")).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: "Confirm deletion and enter C",
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
    await screen.findByRole("button", { name: "Check again" });
    expect(
      screen.queryByText(/Clear local encrypted ledger and start over/),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "Legacy Browser Ledger Cannot Yet Be Migrated Safely",
        }),
      ).toBeTruthy();
    });
    expect(
      screen.queryByText(/Clear local encrypted ledger and start over/),
    ).toBeNull();
    expect(controller.resetEncryptedLedger).not.toHaveBeenCalled();
  });
});
