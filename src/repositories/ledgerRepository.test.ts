import { describe, expect, it, vi } from "vitest";

import type { StorageAdapter } from "../adapters/storageAdapter";
import type { StoredLedgerEnvelopeV2 } from "../encryption/cryptoEnvelope";
import type { EncryptionService } from "../encryption/encryptionService";
import {
  createNoopStoredLedgerEnvelope,
  NoopEncryptionService,
} from "../encryption/noopEncryptionService";
import type { LedgerData } from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { sampleTrades } from "../test/fixtures";
import {
  claimLedgerSessionPersistencePort,
  claimReadyLedgerClearExecutionContextForDriver,
  createReadyLedgerClearAuthorizationForDriver,
  createLedgerSession,
  DefaultLedgerRepository,
  LEDGER_FILE_CAPABILITIES,
  LEDGER_REPOSITORY_ERROR_CODES,
  LedgerSessionLifecycleError,
  type LedgerRepository,
  type LedgerReadyClearDriver,
  type SessionQuiesceRequest,
  type SessionQuiesceToken,
} from "./ledgerRepository";

class MemoryStorageAdapter implements StorageAdapter {
  envelope: unknown | null = null;

  async read() {
    return this.envelope;
  }

  async write(envelope: StoredLedgerEnvelopeV2) {
    this.envelope = structuredClone(envelope);
  }

  async clear() {
    this.envelope = null;
  }
}

function createLedger(): LedgerData {
  return {
    ...createInitialLedgerData(),
    trades: structuredClone(sampleTrades),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("DefaultLedgerRepository", () => {
  it("returns null for an empty adapter without invoking decryption", async () => {
    const storage = new MemoryStorageAdapter();
    const encryption: EncryptionService = {
      encrypt: vi.fn(async (value) =>
        createNoopStoredLedgerEnvelope(value),
      ),
      decrypt: vi.fn(async () => ""),
    };
    const repository = new DefaultLedgerRepository(storage, encryption);

    await expect(repository.load()).resolves.toBeNull();
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it("round-trips a validated ledger through serialization and Noop encryption", async () => {
    const storage = new MemoryStorageAdapter();
    const repository = new DefaultLedgerRepository(
      storage,
      new NoopEncryptionService(),
    );
    const ledgerData = createLedger();

    await repository.save(ledgerData);

    expect(storage.envelope).toEqual(
      createNoopStoredLedgerEnvelope(JSON.stringify(ledgerData)),
    );
    await expect(repository.load()).resolves.toEqual(ledgerData);
  });

  it("invokes encryption at the single repository boundary", async () => {
    const storage = new MemoryStorageAdapter();
    const noop = new NoopEncryptionService();
    const encryption: EncryptionService = {
      encrypt: vi.fn(async (value) =>
        createNoopStoredLedgerEnvelope(value),
      ),
      decrypt: vi.fn(async (envelope) => noop.decrypt(envelope)),
    };
    const repository = new DefaultLedgerRepository(storage, encryption);
    const ledgerData = createLedger();

    await repository.save(ledgerData);
    await repository.load();

    expect(encryption.encrypt).toHaveBeenCalledOnce();
    expect(encryption.decrypt).toHaveBeenCalledOnce();
    expect(encryption.encrypt).toHaveBeenCalledWith(
      JSON.stringify(ledgerData),
    );
    expect(encryption.decrypt).toHaveBeenCalledWith(storage.envelope);
  });

  it("rejects invalid ledger data before encryption or storage writes", async () => {
    const storage = new MemoryStorageAdapter();
    const encryption: EncryptionService = {
      encrypt: vi.fn(async (value) =>
        createNoopStoredLedgerEnvelope(value),
      ),
      decrypt: vi.fn(async () => ""),
    };
    const repository = new DefaultLedgerRepository(storage, encryption);
    const invalidLedger = {
      ...createInitialLedgerData(),
      schemaVersion: 2,
    } as unknown as LedgerData;

    await expect(repository.save(invalidLedger)).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.INVALID_LEDGER_DATA,
    });
    expect(encryption.encrypt).not.toHaveBeenCalled();
    expect(storage.envelope).toBeNull();
  });

  it.each([
    {
      name: "invalid envelope",
      envelope: {
        formatVersion: 2,
        encryptedPayload: "{}",
      },
    },
    {
      name: "invalid JSON",
      envelope: createNoopStoredLedgerEnvelope("{invalid"),
    },
    {
      name: "invalid LedgerData",
      envelope: createNoopStoredLedgerEnvelope(
        JSON.stringify({
          ...createInitialLedgerData(),
          trades: "not-an-array",
        }),
      ),
    },
  ])("rejects $name as invalid stored data", async ({ envelope }) => {
    const storage = new MemoryStorageAdapter();
    storage.envelope = envelope;
    const repository = new DefaultLedgerRepository(
      storage,
      new NoopEncryptionService(),
    );

    await expect(repository.load()).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
    });
  });

  it("maps adapter read, write, and clear failures to repository errors", async () => {
    const failure = new Error("low-level storage details");
    const storage: StorageAdapter = {
      read: vi.fn(async () => {
        throw failure;
      }),
      write: vi.fn(async () => {
        throw failure;
      }),
      clear: vi.fn(async () => {
        throw failure;
      }),
    };
    const repository = new DefaultLedgerRepository(
      storage,
      new NoopEncryptionService(),
    );

    await expect(repository.load()).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.READ_FAILED,
      message: "Could not read saved ledger data",
    });
    await expect(repository.save(createLedger())).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
      message: "Could not save ledger data",
    });
    await expect(repository.clear()).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
      message: "Could not clear saved ledger data",
    });
  });

  it("clears the saved ledger through the adapter contract", async () => {
    const storage = new MemoryStorageAdapter();
    const repository = new DefaultLedgerRepository(
      storage,
      new NoopEncryptionService(),
    );
    await repository.save(createLedger());

    await repository.clear();

    await expect(repository.load()).resolves.toBeNull();
  });
});

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
        "清空当前C账本",
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
        "清空当前C账本",
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
        "清空当前C账本",
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
