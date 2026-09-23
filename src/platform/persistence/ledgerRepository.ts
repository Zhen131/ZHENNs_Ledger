import { type LedgerBackupImportEvidence } from "@/features/backup";
import type { LedgerData } from "@/core/models";
import {
  sessionQuiesceRequestBrand,
  sessionQuiesceTokenBrand,
} from "./ledgerRepositoryBrands";
import type {
  LedgerRepository,
  SessionQuiesceReason,
  SessionQuiesceRequest,
  SessionQuiesceToken,
  ReadyLedgerClearAuthorization,
  ReadyLedgerClearAuthorizationContext,
  ReadyLedgerImportAuthorization,
  ReadyLedgerImportAuthorizationContext,
  LedgerReadyClearPort,
  LedgerReadyImportPort,
  LedgerSession,
  LedgerSessionPersistencePort,
  CreateLedgerSessionOptions,
} from "./ledgerRepositoryContract";
import {
  LedgerSessionLifecycleError,
  INDEXED_DB_LEDGER_CAPABILITIES,
} from "./ledgerRepositoryContract";
import {
  readyClearAuthorizationRuntimes,
  readyClearAuthorizationContextRuntimes,
  readyImportAuthorizationRuntimes,
  readyImportAuthorizationContextRuntimes,
  requireActiveReadyClearDriver,
  requireActiveReadyImportDriver,
  clearReadyLedgerForSession,
  importReadyLedgerForSession,
  isValidReadyImportEvidence,
} from "./ledgerRepositoryReadyRuntime";
import type { SessionRuntime } from "./ledgerRepositorySessionRuntime";

export const READY_LEDGER_CLEAR_CONFIRMATION_TEXT =
  "清空当前账本";

export type { LedgerBackupImportEvidence } from "@/features/backup";

type QuiesceRequestRuntime = {
  readonly session: LedgerSession;
  readonly runtime: SessionRuntime;
  readonly request: SessionQuiesceRequest;
  readonly reason: SessionQuiesceReason;
  drainPromise: Promise<SessionQuiesceToken> | null;
  token: SessionQuiesceToken | null;
};

type QuiesceTokenRuntime = {
  readonly session: LedgerSession;
  readonly runtime: SessionRuntime;
  readonly requestRuntime: QuiesceRequestRuntime;
  readonly token: SessionQuiesceToken;
};

const sessionRuntimes = new WeakMap<LedgerSession, SessionRuntime>();
const quiesceRequestRuntimes = new WeakMap<
  SessionQuiesceRequest,
  QuiesceRequestRuntime
>();
const quiesceTokenRuntimes = new WeakMap<
  SessionQuiesceToken,
  QuiesceTokenRuntime
>();
let fallbackSessionSequence = 0;

export function createLedgerSession(
  options: CreateLedgerSessionOptions,
): LedgerSession {
  const runtime: SessionRuntime = {
    sessionId:
      options.createSessionId?.() ?? createRuntimeSessionId(),
    generation: 0,
    phase: "active",
    repository: options.repository,
    release: options.release ?? (async () => undefined),
    onBeginQuiesce: options.onBeginQuiesce ?? (() => undefined),
    request: null,
    completionKind: null,
    completionPromise: null,
    persistencePortOwner: null,
    persistencePort: null,
    readyClearDriver: options.readyClearDriver ?? null,
    readyImportDriver: options.readyImportDriver ?? null,
    activeImportControllers: new Set(),
  };

  const repositoryFacade: LedgerRepository = {
    load: () => requireActiveRepository(runtime).load(),
    save: (ledgerData) =>
      requireActiveRepository(runtime).save(ledgerData),
    saveAfterAction: (action, ledgerData) => {
      const repository = requireActiveRepository(runtime);
      return repository.saveAfterAction
        ? repository.saveAfterAction(action, ledgerData)
        : repository.save(ledgerData);
    },
    clear: () => requireActiveRepository(runtime).clear(),
  };

  const readyClearPort: LedgerReadyClearPort | null =
    runtime.readyClearDriver
      ? Object.freeze({
          authorizeReadyClear: (confirmationNonce: string) => {
            const driver = requireActiveReadyClearDriver(runtime);
            if (
              confirmationNonce !==
              READY_LEDGER_CLEAR_CONFIRMATION_TEXT
            ) {
              return null;
            }
            const context: ReadyLedgerClearAuthorizationContext =
              Object.freeze({
              sessionId: runtime.sessionId,
              generation: runtime.generation,
              confirmationNonce,
              });
            readyClearAuthorizationContextRuntimes.set(context, {
              session,
              runtime,
              driver,
            });
            const authorization =
              driver.authorizeReadyClear(context);
            if (authorization) {
              readyClearAuthorizationRuntimes.set(authorization, {
                session,
                runtime,
                driver,
              });
            }
            return authorization;
          },
          clearReadyLedger: (
            authorization: ReadyLedgerClearAuthorization,
          ) =>
            clearReadyLedgerForSession(
              session,
              runtime,
              authorization,
            ),
        })
      : null;
  const readyImportPort: LedgerReadyImportPort | null =
    runtime.readyImportDriver
      ? Object.freeze({
          authorizeReadyImport: (
            evidence: LedgerBackupImportEvidence,
            hookGeneration: number,
            candidateIdentity: string,
          ) => {
            const driver = requireActiveReadyImportDriver(runtime);
            if (
              !isValidReadyImportEvidence(
                evidence,
                hookGeneration,
                candidateIdentity,
              )
            ) {
              return null;
            }
            const context: ReadyLedgerImportAuthorizationContext =
              Object.freeze({
                ...evidence,
                sessionId: runtime.sessionId,
                generation: runtime.generation,
                hookGeneration,
                candidateIdentity,
              });
            readyImportAuthorizationContextRuntimes.set(context, {
              session,
              runtime,
              driver,
              evidence,
            });
            const authorization =
              driver.authorizeReadyImport(context);
            if (authorization) {
              readyImportAuthorizationRuntimes.set(authorization, {
                session,
                runtime,
                driver,
                evidence,
              });
            }
            return authorization;
          },
          importReadyLedger: (
            authorization: ReadyLedgerImportAuthorization,
            candidate: LedgerData,
            signal: AbortSignal,
          ) =>
            importReadyLedgerForSession(
              session,
              runtime,
              authorization,
              candidate,
              signal,
            ),
        })
      : null;

  const session: LedgerSession = Object.freeze({
    get sessionId() {
      return runtime.sessionId;
    },
    get generation() {
      return runtime.generation;
    },
    storageKind: options.storageKind,
    repository: repositoryFacade,
    capabilities: options.capabilities,
    readyClearPort,
    readyImportPort,
    beginQuiesce: (reason) =>
      beginSessionQuiesce(session, runtime, reason),
    lockAfterQuiesce: (token) =>
      finishSessionQuiesce(session, runtime, token, "lock"),
    releaseAfterQuiesce: (token) =>
      finishSessionQuiesce(session, runtime, token, "release"),
  });
  sessionRuntimes.set(session, runtime);
  return session;
}

export function claimLedgerSessionPersistencePort(
  session: LedgerSession,
  owner: object,
): LedgerSessionPersistencePort {
  const runtime = requireSessionRuntime(session);
  if (
    runtime.persistencePortOwner !== null &&
    runtime.persistencePortOwner !== owner
  ) {
    throw new LedgerSessionLifecycleError(
      "Ledger session persistence port already belongs to another owner",
    );
  }
  if (runtime.persistencePort) {
    return runtime.persistencePort;
  }
  if (runtime.phase !== "active") {
    throw new LedgerSessionLifecycleError(
      "Ledger session persistence port must be claimed while active",
    );
  }

  const repository: LedgerRepository = {
    load: () => requirePersistenceRepository(runtime).load(),
    save: (ledgerData) =>
      requirePersistenceRepository(runtime).save(ledgerData),
    saveAfterAction: (action, ledgerData) => {
      const repository = requirePersistenceRepository(runtime);
      return repository.saveAfterAction
        ? repository.saveAfterAction(action, ledgerData)
        : repository.save(ledgerData);
    },
    clear: () => requirePersistenceRepository(runtime).clear(),
  };
  const port: LedgerSessionPersistencePort = Object.freeze({
    repository,
    completeQuiesce: (request, settledWork) =>
      completeSessionQuiesce(
        session,
        runtime,
        port,
        request,
        settledWork,
      ),
  });
  runtime.persistencePortOwner = owner;
  runtime.persistencePort = port;
  return port;
}

export function createIndexedDbLedgerSession(
  repository: LedgerRepository,
): LedgerSession {
  return createLedgerSession({
    storageKind: "indexeddb",
    repository,
    capabilities: INDEXED_DB_LEDGER_CAPABILITIES,
  });
}

export function assertSessionQuiesceRequest(
  session: LedgerSession,
  request: SessionQuiesceRequest,
): void {
  const runtime = requireSessionRuntime(session);
  const requestRuntime = quiesceRequestRuntimes.get(request);
  if (
    !requestRuntime ||
    requestRuntime.session !== session ||
    requestRuntime.runtime !== runtime ||
    requestRuntime.request !== request ||
    runtime.request !== request ||
    (runtime.phase !== "quiescing" &&
      runtime.phase !== "drained") ||
    request.sessionId !== runtime.sessionId ||
    request.generation !== runtime.generation
  ) {
    throw new LedgerSessionLifecycleError(
      "Session quiesce request is invalid, stale, or belongs to another session",
    );
  }
}

function completeSessionQuiesce(
  session: LedgerSession,
  runtime: SessionRuntime,
  port: LedgerSessionPersistencePort,
  request: SessionQuiesceRequest,
  settledWork: PromiseLike<unknown>,
): Promise<SessionQuiesceToken> {
  const sessionRuntime = requireSessionRuntime(session);
  if (
    sessionRuntime !== runtime ||
    runtime.persistencePort !== port ||
    runtime.persistencePortOwner === null
  ) {
    throw new LedgerSessionLifecycleError(
      "Ledger session persistence port is invalid or stale",
    );
  }
  assertSessionQuiesceRequest(session, request);
  const requestRuntime = quiesceRequestRuntimes.get(request)!;
  if (requestRuntime.drainPromise) {
    return requestRuntime.drainPromise;
  }

  const drainPromise = Promise.resolve(settledWork).then(
    () => issueQuiesceToken(requestRuntime),
    () => issueQuiesceToken(requestRuntime),
  );
  requestRuntime.drainPromise = drainPromise;
  return drainPromise;
}

function beginSessionQuiesce(
  session: LedgerSession,
  runtime: SessionRuntime,
  reason: SessionQuiesceReason,
): SessionQuiesceRequest {
  if (
    runtime.phase === "quiescing" ||
    runtime.phase === "drained"
  ) {
    if (!runtime.request) {
      throw new LedgerSessionLifecycleError(
        "Quiescing session lost its request",
      );
    }
    return runtime.request;
  }
  if (runtime.phase !== "active") {
    throw new LedgerSessionLifecycleError(
      "Locked or released session cannot begin quiescing",
    );
  }

  for (const controller of runtime.activeImportControllers) {
    controller.abort(
      new LedgerSessionLifecycleError(
        "Ready ledger import was cancelled because its session began quiescing",
      ),
    );
  }
  runtime.onBeginQuiesce();
  runtime.generation += 1;
  runtime.phase = "quiescing";
  const request: SessionQuiesceRequest = Object.freeze({
    sessionId: runtime.sessionId,
    generation: runtime.generation,
    [sessionQuiesceRequestBrand]: true as const,
  });
  runtime.request = request;
  quiesceRequestRuntimes.set(request, {
    session,
    runtime,
    request,
    reason,
    drainPromise: null,
    token: null,
  });
  return request;
}

function issueQuiesceToken(
  requestRuntime: QuiesceRequestRuntime,
): SessionQuiesceToken {
  const { runtime } = requestRuntime;
  if (
    runtime.phase !== "quiescing" ||
    runtime.request !== requestRuntime.request
  ) {
    throw new LedgerSessionLifecycleError(
      "Session changed before quiesce drain completed",
    );
  }
  if (requestRuntime.token) {
    return requestRuntime.token;
  }
  const token: SessionQuiesceToken = Object.freeze({
    sessionId: runtime.sessionId,
    generation: runtime.generation,
    [sessionQuiesceTokenBrand]: true as const,
  });
  requestRuntime.token = token;
  runtime.phase = "drained";
  quiesceTokenRuntimes.set(token, {
    session: requestRuntime.session,
    runtime,
    requestRuntime,
    token,
  });
  return token;
}

function finishSessionQuiesce(
  session: LedgerSession,
  runtime: SessionRuntime,
  token: SessionQuiesceToken,
  kind: "lock" | "release",
): Promise<void> {
  const sessionRuntime = requireSessionRuntime(session);
  const tokenRuntime = quiesceTokenRuntimes.get(token);
  if (
    sessionRuntime !== runtime ||
    !tokenRuntime ||
    tokenRuntime.session !== session ||
    tokenRuntime.runtime !== runtime ||
    tokenRuntime.token !== token ||
    tokenRuntime.requestRuntime.token !== token ||
    token.sessionId !== runtime.sessionId ||
    token.generation !== runtime.generation
  ) {
    return Promise.reject(
      new LedgerSessionLifecycleError(
        "Session quiesce token is invalid, stale, or belongs to another session",
      ),
    );
  }
  if (
    runtime.completionKind !== null &&
    runtime.completionKind !== kind
  ) {
    return Promise.reject(
      new LedgerSessionLifecycleError(
        "Session quiesce token cannot be consumed by two completion modes",
      ),
    );
  }
  if (
    (tokenRuntime.requestRuntime.reason === "immediate-lock" &&
      kind !== "lock") ||
    (tokenRuntime.requestRuntime.reason === "route-leave" &&
      kind !== "release")
  ) {
    return Promise.reject(
      new LedgerSessionLifecycleError(
        "Session quiesce token completion does not match its reason",
      ),
    );
  }
  if (runtime.completionPromise) {
    return runtime.completionPromise;
  }
  if (runtime.phase === "released") {
    return Promise.resolve();
  }
  if (runtime.phase !== "drained" && runtime.phase !== "revoked") {
    return Promise.reject(
      new LedgerSessionLifecycleError(
        "Session must be fully drained before release",
      ),
    );
  }

  runtime.completionKind = kind;
  runtime.repository = null;
  runtime.phase = "revoked";
  const completion = invokeLifecyclePromise(runtime.release).then(
    () => {
      runtime.phase = "released";
    },
    (error: unknown) => {
      if (runtime.completionPromise === completion) {
        runtime.completionPromise = null;
      }
      throw error;
    },
  );
  runtime.completionPromise = completion;
  return completion;
}

function requireSessionRuntime(session: LedgerSession): SessionRuntime {
  const runtime = sessionRuntimes.get(session);
  if (!runtime) {
    throw new LedgerSessionLifecycleError(
      "Ledger session was not created by the lifecycle boundary",
    );
  }
  return runtime;
}

function requireReachableRepository(
  runtime: SessionRuntime,
): LedgerRepository {
  if (
    runtime.repository === null ||
    runtime.phase === "revoked" ||
    runtime.phase === "released"
  ) {
    throw new LedgerSessionLifecycleError(
      "Ledger session repository is no longer reachable",
    );
  }
  return runtime.repository;
}

function requireActiveRepository(
  runtime: SessionRuntime,
): LedgerRepository {
  if (runtime.phase !== "active") {
    throw new LedgerSessionLifecycleError(
      "Ledger session no longer accepts new repository operations",
    );
  }
  return requireReachableRepository(runtime);
}

function requirePersistenceRepository(
  runtime: SessionRuntime,
): LedgerRepository {
  if (
    runtime.phase !== "active" &&
    runtime.phase !== "quiescing"
  ) {
    throw new LedgerSessionLifecycleError(
      "Ledger session persistence queue is no longer reachable",
    );
  }
  return requireReachableRepository(runtime);
}

function invokeLifecyclePromise(
  operation: () => Promise<void>,
): Promise<void> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error);
  }
}

function createRuntimeSessionId(): string {
  if (
    typeof globalThis.crypto?.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  fallbackSessionSequence += 1;
  return `ledger-session-${fallbackSessionSequence}`;
}
