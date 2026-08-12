import type { StorageAdapter } from "@/platform/legacy";
import {
  inspectLedgerBackupImportEvidence,
  type LedgerBackupImportEvidence,
} from "@/features/backup";
import { validateStoredLedgerEnvelopeV2 } from "@/platform/legacy";
import type { EncryptionService } from "@/platform/legacy";
import type { LedgerData } from "@/core/models";
import { validateLedgerData } from "@/core/validation";

export const LEDGER_REPOSITORY_ERROR_CODES = {
  READ_FAILED: "LEDGER_REPOSITORY_READ_FAILED",
  WRITE_FAILED: "LEDGER_REPOSITORY_WRITE_FAILED",
  CLEAR_FAILED: "LEDGER_REPOSITORY_CLEAR_FAILED",
  INVALID_LEDGER_DATA: "LEDGER_REPOSITORY_INVALID_LEDGER_DATA",
  INVALID_STORED_DATA: "LEDGER_REPOSITORY_INVALID_STORED_DATA",
} as const;

export type LedgerRepositoryErrorCode =
  (typeof LEDGER_REPOSITORY_ERROR_CODES)[keyof typeof LEDGER_REPOSITORY_ERROR_CODES];

export class LedgerRepositoryError extends Error {
  readonly code: LedgerRepositoryErrorCode;
  readonly cause?: unknown;

  constructor(
    code: LedgerRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "LedgerRepositoryError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * 上层唯一的整账持久化入口。
 *
 * load 的 null 明确表示“没有保存数据”；它与已保存的空账本不同。
 */
export interface LedgerRepository {
  load(): Promise<LedgerData | null>;
  save(ledgerData: LedgerData): Promise<void>;
  clear(): Promise<void>;
}

export type LedgerStorageKind = "indexeddb" | "ledger-file";

export type LedgerSessionCapabilities = {
  canClearReadyLedger: boolean;
  canClearHydrationError: boolean;
  canImportBackup: boolean;
};

export const READY_LEDGER_CLEAR_CONFIRMATION_TEXT =
  "清空当前C账本";

const readyLedgerClearAuthorizationBrand = Symbol(
  "ready-ledger-clear-authorization",
);
const readyLedgerClearExecutionContextBrand = Symbol(
  "ready-ledger-clear-execution-context",
);
const readyLedgerImportAuthorizationBrand = Symbol(
  "ready-ledger-import-authorization",
);
const readyLedgerImportExecutionContextBrand = Symbol(
  "ready-ledger-import-execution-context",
);
const sessionQuiesceRequestBrand = Symbol(
  "ledger-session-quiesce-request",
);
const sessionQuiesceTokenBrand = Symbol(
  "ledger-session-quiesce-token",
);

export type SessionQuiesceReason =
  | "immediate-lock"
  | "route-leave";

export type SessionQuiesceRequest = Readonly<{
  sessionId: string;
  generation: number;
  [sessionQuiesceRequestBrand]: true;
}>;

export type SessionQuiesceToken = Readonly<{
  sessionId: string;
  generation: number;
  [sessionQuiesceTokenBrand]: true;
}>;

export type ReadyLedgerClearAuthorization = Readonly<{
  sessionId: string;
  generation: number;
  fileId: string;
  verifiedRevisionId: string;
  confirmationNonce: string;
  [readyLedgerClearAuthorizationBrand]: true;
}>;

export type ReadyLedgerClearAuthorizationContext = Readonly<{
  sessionId: string;
  generation: number;
  confirmationNonce: string;
}>;

export type ReadyLedgerClearExecutionContext = Readonly<{
  sessionId: string;
  generation: number;
  [readyLedgerClearExecutionContextBrand]: true;
}>;

export type { LedgerBackupImportEvidence } from "@/features/backup";

export type ReadyLedgerImportAuthorization = Readonly<{
  sessionId: string;
  generation: number;
  hookGeneration: number;
  fileId: string;
  verifiedRevisionId: string;
  contentIdentity: string;
  candidateIdentity: string;
  selectionGeneration: number;
  suspiciousGroupIdentity: string;
  [readyLedgerImportAuthorizationBrand]: true;
}>;

export type ReadyLedgerImportAuthorizationContext =
  LedgerBackupImportEvidence &
    Readonly<{
      sessionId: string;
      generation: number;
      hookGeneration: number;
      candidateIdentity: string;
    }>;

export type ReadyLedgerImportExecutionContext = Readonly<{
  sessionId: string;
  generation: number;
  signal: AbortSignal;
  [readyLedgerImportExecutionContextBrand]: true;
}>;

export type LedgerReadyClearDriver = Readonly<{
  authorizeReadyClear(
    context: ReadyLedgerClearAuthorizationContext,
  ): ReadyLedgerClearAuthorization | null;
  clearReadyLedger(
    authorization: ReadyLedgerClearAuthorization,
    executionContext: ReadyLedgerClearExecutionContext,
  ): Promise<void>;
}>;

export type LedgerReadyClearPort = Readonly<{
  authorizeReadyClear(
    confirmationNonce: string,
  ): ReadyLedgerClearAuthorization | null;
  clearReadyLedger(
    authorization: ReadyLedgerClearAuthorization,
  ): Promise<void>;
}>;

export type LedgerReadyImportDriver = Readonly<{
  authorizeReadyImport(
    context: ReadyLedgerImportAuthorizationContext,
  ): ReadyLedgerImportAuthorization | null;
  importReadyLedger(
    authorization: ReadyLedgerImportAuthorization,
    candidate: LedgerData,
    executionContext: ReadyLedgerImportExecutionContext,
  ): Promise<LedgerData>;
}>;

export type LedgerReadyImportPort = Readonly<{
  authorizeReadyImport(
    evidence: LedgerBackupImportEvidence,
    hookGeneration: number,
    candidateIdentity: string,
  ): ReadyLedgerImportAuthorization | null;
  importReadyLedger(
    authorization: ReadyLedgerImportAuthorization,
    candidate: LedgerData,
    signal: AbortSignal,
  ): Promise<LedgerData>;
}>;

export function createReadyLedgerClearAuthorizationForDriver(
  context: ReadyLedgerClearAuthorizationContext,
  evidence: Readonly<{
    fileId: string;
    verifiedRevisionId: string;
  }>,
): ReadyLedgerClearAuthorization {
  return Object.freeze({
    sessionId: context.sessionId,
    generation: context.generation,
    fileId: evidence.fileId,
    verifiedRevisionId: evidence.verifiedRevisionId,
    confirmationNonce: context.confirmationNonce,
    [readyLedgerClearAuthorizationBrand]: true as const,
  });
}

export function createReadyLedgerImportAuthorizationForDriver(
  context: ReadyLedgerImportAuthorizationContext,
  evidence: Readonly<{
    fileId: string;
    verifiedRevisionId: string;
  }>,
): ReadyLedgerImportAuthorization {
  return Object.freeze({
    sessionId: context.sessionId,
    generation: context.generation,
    hookGeneration: context.hookGeneration,
    fileId: evidence.fileId,
    verifiedRevisionId: evidence.verifiedRevisionId,
    contentIdentity: context.contentIdentity,
    candidateIdentity: context.candidateIdentity,
    selectionGeneration: context.selectionGeneration,
    suspiciousGroupIdentity: context.suspiciousGroupIdentity,
    [readyLedgerImportAuthorizationBrand]: true as const,
  });
}

export type LedgerSession = Readonly<{
  sessionId: string;
  generation: number;
  storageKind: LedgerStorageKind;
  repository: LedgerRepository;
  capabilities: LedgerSessionCapabilities;
  readyClearPort: LedgerReadyClearPort | null;
  readyImportPort: LedgerReadyImportPort | null;
  beginQuiesce(reason: SessionQuiesceReason): SessionQuiesceRequest;
  lockAfterQuiesce(token: SessionQuiesceToken): Promise<void>;
  releaseAfterQuiesce(token: SessionQuiesceToken): Promise<void>;
}>;

/**
 * Hook-owned capability for work that was admitted before quiesce began.
 *
 * This port is deliberately absent from LedgerSession. The public repository
 * façade stops accepting calls synchronously at beginQuiesce(), while the
 * single registered Hook owner can finish its already accepted queue and is
 * the only boundary able to issue the corresponding drain token.
 */
export type LedgerSessionPersistencePort = Readonly<{
  repository: LedgerRepository;
  completeQuiesce(
    request: SessionQuiesceRequest,
    settledWork: PromiseLike<unknown>,
  ): Promise<SessionQuiesceToken>;
}>;

export class LedgerSessionLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerSessionLifecycleError";
  }
}

type SessionPhase =
  | "active"
  | "quiescing"
  | "drained"
  | "revoked"
  | "released";

type SessionRuntime = {
  readonly sessionId: string;
  generation: number;
  phase: SessionPhase;
  repository: LedgerRepository | null;
  readonly release: () => Promise<void>;
  readonly onBeginQuiesce: () => void;
  request: SessionQuiesceRequest | null;
  completionKind: "lock" | "release" | null;
  completionPromise: Promise<void> | null;
  persistencePortOwner: object | null;
  persistencePort: LedgerSessionPersistencePort | null;
  readonly readyClearDriver: LedgerReadyClearDriver | null;
  readonly readyImportDriver: LedgerReadyImportDriver | null;
  readonly activeImportControllers: Set<AbortController>;
};

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

export type CreateLedgerSessionOptions = {
  storageKind: LedgerStorageKind;
  repository: LedgerRepository;
  capabilities: LedgerSessionCapabilities;
  readyClearDriver?: LedgerReadyClearDriver;
  readyImportDriver?: LedgerReadyImportDriver;
  onBeginQuiesce?: () => void;
  release?: () => Promise<void>;
  createSessionId?: () => string;
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
const readyClearAuthorizationRuntimes = new WeakMap<
  ReadyLedgerClearAuthorization,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyClearDriver;
  }
>();
const readyClearAuthorizationContextRuntimes = new WeakMap<
  ReadyLedgerClearAuthorizationContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyClearDriver;
  }
>();
const readyClearExecutionContextRuntimes = new WeakMap<
  ReadyLedgerClearExecutionContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyClearDriver;
    readonly authorization: ReadyLedgerClearAuthorization;
    claimed: boolean;
  }
>();
const readyImportAuthorizationRuntimes = new WeakMap<
  ReadyLedgerImportAuthorization,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyImportDriver;
    readonly evidence: LedgerBackupImportEvidence;
  }
>();
const readyImportAuthorizationContextRuntimes = new WeakMap<
  ReadyLedgerImportAuthorizationContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyImportDriver;
    readonly evidence: LedgerBackupImportEvidence;
  }
>();
const readyImportExecutionContextRuntimes = new WeakMap<
  ReadyLedgerImportExecutionContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyImportDriver;
    readonly authorization: ReadyLedgerImportAuthorization;
    claimed: boolean;
  }
>();
let fallbackSessionSequence = 0;

export const INDEXED_DB_LEDGER_CAPABILITIES: LedgerSessionCapabilities = {
  canClearReadyLedger: true,
  canClearHydrationError: true,
  canImportBackup: true,
};

export const LEDGER_FILE_CAPABILITIES: LedgerSessionCapabilities = {
  canClearReadyLedger: true,
  canClearHydrationError: false,
  canImportBackup: false,
};

export const LEDGER_FILE_READY_IMPORT_CAPABILITIES:
  LedgerSessionCapabilities = {
    ...LEDGER_FILE_CAPABILITIES,
    canImportBackup: true,
  };

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

function requireActiveReadyClearDriver(
  runtime: SessionRuntime,
): LedgerReadyClearDriver {
  if (runtime.phase !== "active" || !runtime.readyClearDriver) {
    throw new LedgerSessionLifecycleError(
      "Ready ledger clear is unavailable for this session",
    );
  }
  return runtime.readyClearDriver;
}

function requireActiveReadyImportDriver(
  runtime: SessionRuntime,
): LedgerReadyImportDriver {
  if (runtime.phase !== "active" || !runtime.readyImportDriver) {
    throw new LedgerSessionLifecycleError(
      "Ready ledger import is unavailable for this session",
    );
  }
  return runtime.readyImportDriver;
}

function clearReadyLedgerForSession(
  session: LedgerSession,
  runtime: SessionRuntime,
  authorization: ReadyLedgerClearAuthorization,
): Promise<void> {
  const authorizationRuntime =
    readyClearAuthorizationRuntimes.get(authorization);
  const driver = requireActiveReadyClearDriver(runtime);
  if (
    !authorizationRuntime ||
    authorizationRuntime.session !== session ||
    authorizationRuntime.runtime !== runtime ||
    authorizationRuntime.driver !== driver ||
    authorization.sessionId !== runtime.sessionId ||
    authorization.generation !== runtime.generation
  ) {
    throw new LedgerSessionLifecycleError(
      "Ready ledger clear authorization is invalid, stale, or belongs to another session",
    );
  }
  const executionContext: ReadyLedgerClearExecutionContext =
    Object.freeze({
      sessionId: runtime.sessionId,
      generation: runtime.generation,
      [readyLedgerClearExecutionContextBrand]: true as const,
    });
  readyClearExecutionContextRuntimes.set(executionContext, {
    session,
    runtime,
    driver,
    authorization,
    claimed: false,
  });
  let clearPromise: Promise<void>;
  try {
    clearPromise = driver.clearReadyLedger(
      authorization,
      executionContext,
    );
  } catch (error) {
    readyClearExecutionContextRuntimes.delete(executionContext);
    throw error;
  }
  if (
    !readyClearExecutionContextRuntimes.get(executionContext)
      ?.claimed
  ) {
    readyClearExecutionContextRuntimes.delete(executionContext);
    void Promise.resolve(clearPromise).catch(() => undefined);
    throw new LedgerSessionLifecycleError(
      "Ready ledger clear driver did not claim its execution context synchronously",
    );
  }
  return clearPromise.finally(() => {
    readyClearExecutionContextRuntimes.delete(executionContext);
  });
}

function importReadyLedgerForSession(
  session: LedgerSession,
  runtime: SessionRuntime,
  authorization: ReadyLedgerImportAuthorization,
  candidate: LedgerData,
  signal: AbortSignal,
): Promise<LedgerData> {
  const authorizationRuntime =
    readyImportAuthorizationRuntimes.get(authorization);
  const driver = requireActiveReadyImportDriver(runtime);
  if (
    signal.aborted ||
    !authorizationRuntime ||
    authorizationRuntime.session !== session ||
    authorizationRuntime.runtime !== runtime ||
    authorizationRuntime.driver !== driver ||
    authorization.sessionId !== runtime.sessionId ||
    authorization.generation !== runtime.generation
  ) {
    throw new LedgerSessionLifecycleError(
      "Ready ledger import authorization is invalid, stale, cancelled, or belongs to another session",
    );
  }
  let candidateSnapshot: LedgerData;
  try {
    candidateSnapshot = structuredClone(candidate);
  } catch {
    throw new LedgerSessionLifecycleError(
      "Ready ledger import candidate could not be captured",
    );
  }
  const lifecycleController = new AbortController();
  const abortFromCaller = () => lifecycleController.abort(signal.reason);
  signal.addEventListener("abort", abortFromCaller, { once: true });
  runtime.activeImportControllers.add(lifecycleController);
  const executionContext: ReadyLedgerImportExecutionContext =
    Object.freeze({
      sessionId: runtime.sessionId,
      generation: runtime.generation,
      signal: lifecycleController.signal,
      [readyLedgerImportExecutionContextBrand]: true as const,
    });
  readyImportExecutionContextRuntimes.set(executionContext, {
    session,
    runtime,
    driver,
    authorization,
    claimed: false,
  });
  let importPromise: Promise<LedgerData>;
  try {
    importPromise = driver.importReadyLedger(
      authorization,
      candidateSnapshot,
      executionContext,
    );
  } catch (error) {
    signal.removeEventListener("abort", abortFromCaller);
    runtime.activeImportControllers.delete(lifecycleController);
    readyImportExecutionContextRuntimes.delete(executionContext);
    throw error;
  }
  return importPromise
    .then((ledgerData) => {
      if (
        !readyImportExecutionContextRuntimes.get(executionContext)
          ?.claimed
      ) {
        throw new LedgerSessionLifecycleError(
          "Ready ledger import driver completed without a valid execution claim",
        );
      }
      return ledgerData;
    })
    .finally(() => {
      signal.removeEventListener("abort", abortFromCaller);
      runtime.activeImportControllers.delete(lifecycleController);
      readyImportExecutionContextRuntimes.delete(executionContext);
    });
}

export function isReadyLedgerClearAuthorizationContextForDriver(
  context: ReadyLedgerClearAuthorizationContext,
  driver: LedgerReadyClearDriver,
): boolean {
  const contextRuntime =
    readyClearAuthorizationContextRuntimes.get(context);
  return Boolean(
    contextRuntime &&
      contextRuntime.driver === driver &&
      contextRuntime.runtime.readyClearDriver === driver &&
      contextRuntime.runtime.phase === "active" &&
      contextRuntime.session.sessionId === context.sessionId &&
      contextRuntime.session.generation === context.generation &&
      context.confirmationNonce ===
        READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
  );
}

export function claimReadyLedgerClearExecutionContextForDriver(
  executionContext: ReadyLedgerClearExecutionContext,
  authorization: ReadyLedgerClearAuthorization,
  driver: LedgerReadyClearDriver,
): boolean {
  const executionRuntime =
    readyClearExecutionContextRuntimes.get(executionContext);
  const authorizationRuntime =
    readyClearAuthorizationRuntimes.get(authorization);
  if (
    !executionRuntime ||
    executionRuntime.claimed ||
    executionRuntime.authorization !== authorization ||
    executionRuntime.driver !== driver ||
    executionRuntime.runtime.readyClearDriver !== driver ||
    executionRuntime.runtime.phase !== "active" ||
    executionRuntime.session.sessionId !==
      executionContext.sessionId ||
    executionRuntime.session.generation !==
      executionContext.generation ||
    authorization.sessionId !== executionContext.sessionId ||
    authorization.generation !== executionContext.generation ||
    !authorizationRuntime ||
    authorizationRuntime.session !== executionRuntime.session ||
    authorizationRuntime.runtime !== executionRuntime.runtime ||
    authorizationRuntime.driver !== driver
  ) {
    return false;
  }
  executionRuntime.claimed = true;
  return true;
}

export function isReadyLedgerImportAuthorizationContextForDriver(
  context: ReadyLedgerImportAuthorizationContext,
  driver: LedgerReadyImportDriver,
): boolean {
  const contextRuntime =
    readyImportAuthorizationContextRuntimes.get(context);
  return Boolean(
    contextRuntime &&
      contextRuntime.driver === driver &&
      contextRuntime.runtime.readyImportDriver === driver &&
      contextRuntime.runtime.phase === "active" &&
      contextRuntime.session.sessionId === context.sessionId &&
      contextRuntime.session.generation === context.generation &&
      isValidReadyImportEvidence(
        contextRuntime.evidence,
        context.hookGeneration,
        context.candidateIdentity,
      ) &&
      context.contentIdentity ===
        contextRuntime.evidence.contentIdentity &&
      context.selectionGeneration ===
        contextRuntime.evidence.selectionGeneration &&
      context.suspiciousGroupIdentity ===
        contextRuntime.evidence.suspiciousGroupIdentity,
  );
}

export function claimReadyLedgerImportExecutionContextForDriver(
  executionContext: ReadyLedgerImportExecutionContext,
  authorization: ReadyLedgerImportAuthorization,
  driver: LedgerReadyImportDriver,
): boolean {
  const executionRuntime =
    readyImportExecutionContextRuntimes.get(executionContext);
  const authorizationRuntime =
    readyImportAuthorizationRuntimes.get(authorization);
  if (
    executionContext.signal.aborted ||
    !executionRuntime ||
    executionRuntime.claimed ||
    executionRuntime.authorization !== authorization ||
    executionRuntime.driver !== driver ||
    executionRuntime.runtime.readyImportDriver !== driver ||
    executionRuntime.runtime.phase !== "active" ||
    executionRuntime.session.sessionId !==
      executionContext.sessionId ||
    executionRuntime.session.generation !==
      executionContext.generation ||
    authorization.sessionId !== executionContext.sessionId ||
    authorization.generation !== executionContext.generation ||
    !authorizationRuntime ||
    authorizationRuntime.session !== executionRuntime.session ||
    authorizationRuntime.runtime !== executionRuntime.runtime ||
    authorizationRuntime.driver !== driver ||
    !isValidReadyImportEvidence(
      authorizationRuntime.evidence,
      authorization.hookGeneration,
      authorization.candidateIdentity,
    ) ||
    authorization.contentIdentity !==
      authorizationRuntime.evidence.contentIdentity ||
    authorization.selectionGeneration !==
      authorizationRuntime.evidence.selectionGeneration ||
    authorization.suspiciousGroupIdentity !==
      authorizationRuntime.evidence.suspiciousGroupIdentity
  ) {
    return false;
  }
  executionRuntime.claimed = true;
  return true;
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

function isValidReadyImportEvidence(
  evidence: LedgerBackupImportEvidence,
  hookGeneration: number,
  candidateIdentity: string,
): boolean {
  const attestation =
    inspectLedgerBackupImportEvidence(evidence);
  if (
    !attestation ||
    !attestation.requireHistoricalRawText ||
    evidence.hardErrorCount !== 0 ||
    !Number.isSafeInteger(evidence.selectionGeneration) ||
    evidence.selectionGeneration < 1 ||
    !Number.isSafeInteger(evidence.suspiciousGroupCount) ||
    evidence.suspiciousGroupCount < 0 ||
    !Number.isSafeInteger(hookGeneration) ||
    hookGeneration < 0 ||
    evidence.contentIdentity.length === 0 ||
    evidence.candidateIdentity !== candidateIdentity ||
    candidateIdentity.length === 0 ||
    evidence.suspiciousGroupIdentity.length === 0
  ) {
    return false;
  }

  return evidence.suspiciousGroupCount === 0
    ? evidence.confirmedSuspiciousGroupIdentity === null
    : evidence.confirmedSuspiciousGroupIdentity ===
        evidence.suspiciousGroupIdentity;
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

export class DefaultLedgerRepository implements LedgerRepository {
  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly encryptionService: EncryptionService,
  ) {}

  async load(): Promise<LedgerData | null> {
    let storedValue: unknown | null;

    try {
      storedValue = await this.storageAdapter.read();
    } catch (error) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.READ_FAILED,
        "Could not read saved ledger data",
        error,
      );
    }

    if (storedValue === null) {
      return null;
    }

    const envelopeValidation =
      validateStoredLedgerEnvelopeV2(storedValue);

    if (!envelopeValidation.ok) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
        "Saved ledger envelope is invalid",
      );
    }

    let parsedData: unknown;

    try {
      const plaintext = await this.encryptionService.decrypt(
        envelopeValidation.value,
      );
      parsedData = JSON.parse(plaintext);
    } catch (error) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
        "Saved ledger payload could not be decrypted or parsed",
        error,
      );
    }

    const validationResult = validateLedgerData(parsedData);

    if (!validationResult.ok) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
        "Saved ledger payload failed runtime validation",
        validationResult.errors,
      );
    }

    return validationResult.value;
  }

  async save(ledgerData: LedgerData): Promise<void> {
    const validationResult = validateLedgerData(ledgerData);

    if (!validationResult.ok) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.INVALID_LEDGER_DATA,
        "Ledger data failed runtime validation before save",
        validationResult.errors,
      );
    }

    try {
      const plaintext = JSON.stringify(validationResult.value);
      const envelope = await this.encryptionService.encrypt(plaintext);
      const envelopeValidation =
        validateStoredLedgerEnvelopeV2(envelope);

      if (!envelopeValidation.ok) {
        throw new Error("Encryption service returned an invalid envelope");
      }

      await this.storageAdapter.write(envelopeValidation.value);
    } catch (error) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
        "Could not save ledger data",
        error,
      );
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storageAdapter.clear();
    } catch (error) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
        "Could not clear saved ledger data",
        error,
      );
    }
  }
}
