import {
  inspectLedgerBackupImportEvidence,
  type LedgerBackupImportEvidence,
} from "@/features/backup";
import type { LedgerData } from "@/core/models";
import {
  readyLedgerClearExecutionContextBrand,
  readyLedgerImportExecutionContextBrand,
} from "./ledgerRepositoryBrands";
import type {
  ReadyLedgerClearAuthorization,
  ReadyLedgerClearAuthorizationContext,
  ReadyLedgerClearExecutionContext,
  ReadyLedgerImportAuthorization,
  ReadyLedgerImportAuthorizationContext,
  ReadyLedgerImportExecutionContext,
  LedgerReadyClearDriver,
  LedgerReadyImportDriver,
  LedgerSession,
} from "./ledgerRepositoryContract";
import { LedgerSessionLifecycleError } from "./ledgerRepositoryContract";
import type { SessionRuntime } from "./ledgerRepositorySessionRuntime";

export const readyClearAuthorizationRuntimes = new WeakMap<
  ReadyLedgerClearAuthorization,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyClearDriver;
  }
>();
export const readyClearAuthorizationContextRuntimes = new WeakMap<
  ReadyLedgerClearAuthorizationContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyClearDriver;
  }
>();
export const readyClearExecutionContextRuntimes = new WeakMap<
  ReadyLedgerClearExecutionContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyClearDriver;
    readonly authorization: ReadyLedgerClearAuthorization;
    claimed: boolean;
  }
>();
export const readyImportAuthorizationRuntimes = new WeakMap<
  ReadyLedgerImportAuthorization,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyImportDriver;
    readonly evidence: LedgerBackupImportEvidence;
  }
>();
export const readyImportAuthorizationContextRuntimes = new WeakMap<
  ReadyLedgerImportAuthorizationContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyImportDriver;
    readonly evidence: LedgerBackupImportEvidence;
  }
>();
export const readyImportExecutionContextRuntimes = new WeakMap<
  ReadyLedgerImportExecutionContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyImportDriver;
    readonly authorization: ReadyLedgerImportAuthorization;
    claimed: boolean;
  }
>();

export function requireActiveReadyClearDriver(
  runtime: SessionRuntime,
): LedgerReadyClearDriver {
  if (runtime.phase !== "active" || !runtime.readyClearDriver) {
    throw new LedgerSessionLifecycleError(
      "Ready ledger clear is unavailable for this session",
    );
  }
  return runtime.readyClearDriver;
}

export function requireActiveReadyImportDriver(
  runtime: SessionRuntime,
): LedgerReadyImportDriver {
  if (runtime.phase !== "active" || !runtime.readyImportDriver) {
    throw new LedgerSessionLifecycleError(
      "Ready ledger import is unavailable for this session",
    );
  }
  return runtime.readyImportDriver;
}

export function clearReadyLedgerForSession(
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

export function importReadyLedgerForSession(
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

export function isValidReadyImportEvidence(
  evidence: LedgerBackupImportEvidence,
  hookGeneration: number,
  candidateIdentity: string,
): boolean {
  const attestation =
    inspectLedgerBackupImportEvidence(evidence);
  if (
    !attestation ||
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
    evidence.suspiciousGroupIdentity.length === 0 ||
    evidence.requireHistoricalRawText !==
      attestation.requireHistoricalRawText
  ) {
    return false;
  }

  return evidence.suspiciousGroupCount === 0
    ? evidence.confirmedSuspiciousGroupIdentity === null
    : evidence.confirmedSuspiciousGroupIdentity ===
        evidence.suspiciousGroupIdentity;
}
