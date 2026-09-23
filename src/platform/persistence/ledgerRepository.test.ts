import { describe, expect, it, vi } from "vitest";
import { revokeBackupImportPreflightReceipt } from "@/features/backup";
import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import {
  claimLedgerSessionPersistencePort,
  createLedgerSession,
} from "./ledgerRepository";
import {
  LEDGER_FILE_CAPABILITIES,
  LEDGER_FILE_READY_IMPORT_CAPABILITIES,
  LedgerSessionLifecycleError,
  type LedgerRepository,
  type LedgerReadyClearDriver,
  type LedgerReadyImportDriver,
  type SessionQuiesceRequest,
  type SessionQuiesceToken,
} from "./ledgerRepositoryContract";
import {
  claimReadyLedgerImportExecutionContextForDriver,
  claimReadyLedgerClearExecutionContextForDriver,
  createReadyLedgerImportAuthorizationForDriver,
  createReadyLedgerClearAuthorizationForDriver,
} from "./ledgerRepositoryReadyAuthorization";
import {
  createLedger,
  createDeferred,
  createReadyImportEvidence,
} from "./ledgerRepository.testHelpers";

describe("LedgerSession lifecycle", () => {
  function createRuntimeSession(options: {
    id: string;
    repository?: LedgerRepository;
    release?: () => Promise<void>;
    onBegin?: () => void;
  }) {
    const repository: LedgerRepository =
      options.repository ?? {
        load: vi.fn(async () => createLedger()),
        save: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      };
    const session = createLedgerSession({
        storageKind: "ledger-file",
        repository,
        capabilities: LEDGER_FILE_CAPABILITIES,
        createSessionId: () => options.id,
        release: options.release,
        onBeginQuiesce: options.onBegin,
      });
    return {
      repository,
      session,
      persistencePort: claimLedgerSessionPersistencePort(
        session,
        {},
      ),
    };
  }

  it("synchronously invalidates once, drains once, then revokes before idempotent release", async () => {
    const events: string[] = [];
    const release = vi.fn(async () => {
      events.push("release");
    });
    const { repository, session, persistencePort } = createRuntimeSession({
      id: "session-a",
      release,
      onBegin: () => events.push("begin"),
    });
    const settled = createDeferred<void>();

    const request = session.beginQuiesce("immediate-lock");
    expect(events).toEqual(["begin"]);
    expect(session.generation).toBe(1);
    expect(session.beginQuiesce("immediate-lock")).toBe(request);

    expect(() => session.repository.save(createLedger())).toThrow(
      LedgerSessionLifecycleError,
    );
    await persistencePort.repository.save(createLedger());
    expect(repository.save).toHaveBeenCalledOnce();

    const tokenPromise = persistencePort.completeQuiesce(
      request,
      settled.promise,
    );
    expect(
      persistencePort.completeQuiesce(request, Promise.resolve()),
    ).toBe(tokenPromise);
    expect(release).not.toHaveBeenCalled();

    settled.resolve();
    const token = await tokenPromise;
    const firstRelease = session.lockAfterQuiesce(token);
    const duplicateRelease = session.lockAfterQuiesce(token);
    expect(duplicateRelease).toBe(firstRelease);
    expect(() => session.repository.load()).toThrow(
      LedgerSessionLifecycleError,
    );
    expect(() => session.repository.save(createLedger())).toThrow(
      LedgerSessionLifecycleError,
    );
    expect(() => session.repository.clear()).toThrow(
      LedgerSessionLifecycleError,
    );

    await firstRelease;
    await expect(
      session.lockAfterQuiesce(token),
    ).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledOnce();
    expect(events).toEqual(["begin", "release"]);
  });

  it("binds ready clear authorization to the active session and rejects cross-session or quiesced use", async () => {
    const clearA = vi.fn(async () => undefined);
    const clearB = vi.fn(async () => undefined);
    const createDriver = (
      fileId: string,
      clearReadyLedger: () => Promise<void>,
    ): LedgerReadyClearDriver => {
      const driver: LedgerReadyClearDriver = {
        authorizeReadyClear: (context) =>
          createReadyLedgerClearAuthorizationForDriver(context, {
            fileId,
            verifiedRevisionId: `${fileId}-revision`,
          }),
        clearReadyLedger: vi.fn(
          (authorization, executionContext) => {
            if (
              !claimReadyLedgerClearExecutionContextForDriver(
                executionContext,
                authorization,
                driver,
              )
            ) {
              return Promise.reject(
                new Error("invalid ready clear execution"),
              );
            }
            return clearReadyLedger();
          },
        ),
      };
      return driver;
    };
    const driverA = createDriver("file-a", clearA);
    const driverB = createDriver("file-b", clearB);
    const repository: LedgerRepository = {
      load: vi.fn(async () => createLedger()),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const sessionA = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver: driverA,
      createSessionId: () => "ready-clear-a",
    });
    const sessionB = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver: driverB,
      createSessionId: () => "ready-clear-b",
    });
    const authorization =
      sessionA.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization) return;

    expect(() =>
      sessionB.readyClearPort?.clearReadyLedger(authorization),
    ).toThrow(LedgerSessionLifecycleError);
    expect(clearA).not.toHaveBeenCalled();
    expect(clearB).not.toHaveBeenCalled();

    await sessionA.readyClearPort?.clearReadyLedger(authorization);
    expect(clearA).toHaveBeenCalledOnce();
    sessionA.beginQuiesce("immediate-lock");
    expect(() =>
      sessionA.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      ),
    ).toThrow(LedgerSessionLifecycleError);
    expect(() =>
      sessionA.readyClearPort?.clearReadyLedger(authorization),
    ).toThrow(LedgerSessionLifecycleError);
    expect(clearA).toHaveBeenCalledOnce();
  });

  it("revokes a ready clear execution context when the driver does not claim it synchronously", async () => {
    let lateClaimed: boolean | undefined;
    let sideEffect = false;
    const driver: LedgerReadyClearDriver = {
      authorizeReadyClear: (context) =>
        createReadyLedgerClearAuthorizationForDriver(context, {
          fileId: "late-claim-file",
          verifiedRevisionId: "late-claim-revision",
        }),
      clearReadyLedger: (authorization, executionContext) =>
        Promise.resolve().then(() => {
          lateClaimed =
            claimReadyLedgerClearExecutionContextForDriver(
              executionContext,
              authorization,
              driver,
            );
          if (lateClaimed) {
            sideEffect = true;
          }
        }),
    };
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository: {
        load: vi.fn(async () => createLedger()),
        save: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      },
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver: driver,
      createSessionId: () => "late-claim-session",
    });
    const authorization =
      session.readyClearPort?.authorizeReadyClear(
        "清空当前账本",
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyClearPort) return;

    expect(() =>
      session.readyClearPort?.clearReadyLedger(authorization),
    ).toThrow(LedgerSessionLifecycleError);
    await Promise.resolve();
    await Promise.resolve();

    expect(lateClaimed).toBe(false);
    expect(sideEffect).toBe(false);
  });

  it("revokes a delayed import claim when quiesce wins after registration but before claim", async () => {
    const claimGate = createDeferred<void>();
    let claimResult: boolean | undefined;
    let sideEffects = 0;
    const driver: LedgerReadyImportDriver = {
      authorizeReadyImport: (context) =>
        createReadyLedgerImportAuthorizationForDriver(context, {
          fileId: "delayed-import-file",
          verifiedRevisionId: "delayed-import-revision",
        }),
      importReadyLedger: async (
        authorization,
        candidate,
        executionContext,
      ) => {
        await claimGate.promise;
        claimResult =
          claimReadyLedgerImportExecutionContextForDriver(
            executionContext,
            authorization,
            driver,
          );
        if (!claimResult) {
          throw new Error("delayed import claim was revoked");
        }
        sideEffects += 1;
        return candidate;
      },
    };
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository: {
        load: vi.fn(async () => createInitialLedgerData()),
        save: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      },
      capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
      readyImportDriver: driver,
      createSessionId: () => "delayed-import-session",
    });
    const candidate = createLedger();
    const { evidence } = await createReadyImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    session.beginQuiesce("immediate-lock");
    claimGate.resolve();

    await expect(importPromise).rejects.toThrow(
      "delayed import claim was revoked",
    );
    expect(claimResult).toBe(false);
    expect(sideEffects).toBe(0);
  });

  it("revokes a delayed import claim when its preflight receipt is cancelled", async () => {
    const claimGate = createDeferred<void>();
    let claimResult: boolean | undefined;
    let sideEffects = 0;
    const driver: LedgerReadyImportDriver = {
      authorizeReadyImport: (context) =>
        createReadyLedgerImportAuthorizationForDriver(context, {
          fileId: "revoked-receipt-file",
          verifiedRevisionId: "revoked-receipt-revision",
        }),
      importReadyLedger: async (
        authorization,
        candidate,
        executionContext,
      ) => {
        await claimGate.promise;
        claimResult =
          claimReadyLedgerImportExecutionContextForDriver(
            executionContext,
            authorization,
            driver,
          );
        if (!claimResult) {
          throw new Error("revoked receipt claim was rejected");
        }
        sideEffects += 1;
        return candidate;
      },
    };
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository: {
        load: vi.fn(async () => createInitialLedgerData()),
        save: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      },
      capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
      readyImportDriver: driver,
      createSessionId: () => "revoked-receipt-session",
    });
    const candidate = createLedger();
    const { evidence, preflight } =
      await createReadyImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    revokeBackupImportPreflightReceipt(preflight);
    claimGate.resolve();

    await expect(importPromise).rejects.toThrow(
      "revoked receipt claim was rejected",
    );
    expect(claimResult).toBe(false);
    expect(sideEffects).toBe(0);
  });

  it("aborts an already-claimed import synchronously when its session begins quiescing", async () => {
    const claimed = createDeferred<void>();
    let observedAbort = false;
    const driver: LedgerReadyImportDriver = {
      authorizeReadyImport: (context) =>
        createReadyLedgerImportAuthorizationForDriver(context, {
          fileId: "active-import-file",
          verifiedRevisionId: "active-import-revision",
        }),
      importReadyLedger: async (
        authorization,
        candidate,
        executionContext,
      ) => {
        if (
          !claimReadyLedgerImportExecutionContextForDriver(
            executionContext,
            authorization,
            driver,
          )
        ) {
          throw new Error("active import claim failed");
        }
        claimed.resolve();
        if (!executionContext.signal.aborted) {
          await new Promise<void>((resolve) => {
            executionContext.signal.addEventListener(
              "abort",
              () => resolve(),
              { once: true },
            );
          });
        }
        observedAbort = executionContext.signal.aborted;
        throw new Error("active import was cancelled");
      },
    };
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository: {
        load: vi.fn(async () => createInitialLedgerData()),
        save: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      },
      capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
      readyImportDriver: driver,
      createSessionId: () => "active-import-session",
    });
    const candidate = createLedger();
    const { evidence } = await createReadyImportEvidence(
      candidate,
      2,
    );
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        7,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    await claimed.promise;
    session.beginQuiesce("route-leave");

    await expect(importPromise).rejects.toThrow(
      "active import was cancelled",
    );
    expect(observedAbort).toBe(true);
  });

  it("captures the ready-import candidate before yielding to its driver", async () => {
    const resumeImport = createDeferred<void>();
    const candidate = createLedger();
    const expectedSnapshot = structuredClone(candidate);
    let receivedCandidate: LedgerData | undefined;
    const driver: LedgerReadyImportDriver = {
      authorizeReadyImport: (context) =>
        createReadyLedgerImportAuthorizationForDriver(context, {
          fileId: "snapshot-import-file",
          verifiedRevisionId: "snapshot-import-revision",
        }),
      importReadyLedger: async (
        authorization,
        capturedCandidate,
        executionContext,
      ) => {
        if (
          !claimReadyLedgerImportExecutionContextForDriver(
            executionContext,
            authorization,
            driver,
          )
        ) {
          throw new Error("snapshot import claim failed");
        }
        await resumeImport.promise;
        receivedCandidate = capturedCandidate;
        return capturedCandidate;
      },
    };
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository: {
        load: vi.fn(async () => createInitialLedgerData()),
        save: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      },
      capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
      readyImportDriver: driver,
      createSessionId: () => "snapshot-import-session",
    });
    const { evidence } = await createReadyImportEvidence(candidate);
    const authorization =
      session.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (!authorization || !session.readyImportPort) return;

    const importPromise =
      session.readyImportPort.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      );
    candidate.trades.splice(0);
    resumeImport.resolve();

    await expect(importPromise).resolves.toEqual(expectedSnapshot);
    expect(receivedCandidate).toEqual(expectedSnapshot);
    expect(receivedCandidate).not.toBe(candidate);
  });

  it("rejects forged and cross-session ready-import authorizations before invoking either driver", async () => {
    const createDriver = (
      fileId: string,
    ): LedgerReadyImportDriver => {
      const driver: LedgerReadyImportDriver = {
        authorizeReadyImport: (context) =>
          createReadyLedgerImportAuthorizationForDriver(context, {
            fileId,
            verifiedRevisionId: `${fileId}-revision`,
          }),
        importReadyLedger: vi.fn(
          async (authorization, candidate, executionContext) => {
            if (
              !claimReadyLedgerImportExecutionContextForDriver(
                executionContext,
                authorization,
                driver,
              )
            ) {
              throw new Error("invalid import execution");
            }
            return candidate;
          },
        ),
      };
      return driver;
    };
    const repository: LedgerRepository = {
      load: vi.fn(async () => createInitialLedgerData()),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const driverA = createDriver("file-a");
    const driverB = createDriver("file-b");
    const sessionA = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
      readyImportDriver: driverA,
      createSessionId: () => "import-session-a",
    });
    const sessionB = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
      readyImportDriver: driverB,
      createSessionId: () => "import-session-b",
    });
    const candidate = createLedger();
    const { evidence } = await createReadyImportEvidence(candidate);
    expect(
      sessionA.readyImportPort?.authorizeReadyImport(
        { ...evidence },
        0,
        evidence.candidateIdentity,
      ),
    ).toBeNull();
    const authorization =
      sessionA.readyImportPort?.authorizeReadyImport(
        evidence,
        0,
        evidence.candidateIdentity,
      );
    expect(authorization).not.toBeNull();
    if (
      !authorization ||
      !sessionA.readyImportPort ||
      !sessionB.readyImportPort
    ) {
      return;
    }
    const forged = { ...authorization };

    expect(() =>
      sessionA.readyImportPort?.importReadyLedger(
        forged,
        candidate,
        new AbortController().signal,
      ),
    ).toThrow(LedgerSessionLifecycleError);
    expect(() =>
      sessionB.readyImportPort?.importReadyLedger(
        authorization,
        candidate,
        new AbortController().signal,
      ),
    ).toThrow(LedgerSessionLifecycleError);
    expect(driverA.importReadyLedger).not.toHaveBeenCalled();
    expect(driverB.importReadyLedger).not.toHaveBeenCalled();
  });

  it("rejects forged, cross-session, stale, and mixed-mode proof without releasing either session", async () => {
    const releaseA = vi.fn(async () => undefined);
    const releaseB = vi.fn(async () => undefined);
    const {
      session: sessionA,
      persistencePort: persistencePortA,
    } = createRuntimeSession({
      id: "session-a",
      release: releaseA,
    });
    const {
      session: sessionB,
      persistencePort: persistencePortB,
    } = createRuntimeSession({
      id: "session-b",
      release: releaseB,
    });
    const requestA = sessionA.beginQuiesce("immediate-lock");
    const requestB = sessionB.beginQuiesce("route-leave");
    const forgedRequest = {
      sessionId: requestA.sessionId,
      generation: requestA.generation,
    } as SessionQuiesceRequest;

    expect(() =>
      persistencePortA.completeQuiesce(
        forgedRequest,
        Promise.resolve(),
      ),
    ).toThrow(LedgerSessionLifecycleError);
    expect(() =>
      persistencePortB.completeQuiesce(
        requestA,
        Promise.resolve(),
      ),
    ).toThrow(LedgerSessionLifecycleError);

    const tokenA = await persistencePortA.completeQuiesce(
      requestA,
      Promise.resolve(),
    );
    const tokenB = await persistencePortB.completeQuiesce(
      requestB,
      Promise.resolve(),
    );
    const forgedToken = {
      sessionId: tokenA.sessionId,
      generation: tokenA.generation,
    } as SessionQuiesceToken;

    await expect(
      sessionA.lockAfterQuiesce(forgedToken),
    ).rejects.toBeInstanceOf(LedgerSessionLifecycleError);
    await expect(
      sessionB.lockAfterQuiesce(tokenA),
    ).rejects.toBeInstanceOf(LedgerSessionLifecycleError);
    expect(releaseA).not.toHaveBeenCalled();
    expect(releaseB).not.toHaveBeenCalled();

    await sessionA.lockAfterQuiesce(tokenA);
    await expect(
      sessionA.releaseAfterQuiesce(tokenA),
    ).rejects.toBeInstanceOf(LedgerSessionLifecycleError);
    await sessionB.releaseAfterQuiesce(tokenB);
    expect(releaseA).toHaveBeenCalledOnce();
    expect(releaseB).toHaveBeenCalledOnce();
  });

  it("keeps the repository revoked when lease release fails and retries only the same release", async () => {
    const release = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("release failed"))
      .mockResolvedValueOnce(undefined);
    const { session, persistencePort } = createRuntimeSession({
      id: "session-release-retry",
      release,
    });
    const request = session.beginQuiesce("immediate-lock");
    const token = await persistencePort.completeQuiesce(
      request,
      Promise.resolve(),
    );

    await expect(
      session.lockAfterQuiesce(token),
    ).rejects.toThrow("release failed");
    expect(() => session.repository.load()).toThrow(
      LedgerSessionLifecycleError,
    );
    await expect(
      session.lockAfterQuiesce(token),
    ).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("gives the admitted-work port to only one owner", () => {
    const { session } = createRuntimeSession({
      id: "session-owned-port",
    });

    expect(() =>
      claimLedgerSessionPersistencePort(session, {}),
    ).toThrow(LedgerSessionLifecycleError);
  });
});
