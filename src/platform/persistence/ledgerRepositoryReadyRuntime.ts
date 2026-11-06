/**
 * 这个文件管清空和导入执行时。
 * 内部记的账和真正去做的那几步。
 * 它不管授权怎么做，那在 ledgerRepositoryReadyAuthorization.ts。
 * 不显然的决定。
 * 开始停止接新活时，正在进行的导入会被取消。这是猜的，日志里没写，要核。
 */

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

/** 内部记的账：每张清空授权属于哪次打开、哪个执行方。 */
export const readyClearAuthorizationRuntimes = new WeakMap<
  ReadyLedgerClearAuthorization,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyClearDriver;
  }
>();
/** 内部记的账：每份清空申请属于哪次打开、哪个执行方。 */
export const readyClearAuthorizationContextRuntimes = new WeakMap<
  ReadyLedgerClearAuthorizationContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyClearDriver;
  }
>();
/** 内部记的账：每张清空执行凭证属于谁、用没用过。 */
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
/** 内部记的账：每张导入授权属于哪次打开、哪个执行方。 */
export const readyImportAuthorizationRuntimes = new WeakMap<
  ReadyLedgerImportAuthorization,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyImportDriver;
    readonly evidence: LedgerBackupImportEvidence;
  }
>();
/** 内部记的账：每份导入申请属于哪次打开、哪个执行方。 */
export const readyImportAuthorizationContextRuntimes = new WeakMap<
  ReadyLedgerImportAuthorizationContext,
  {
    readonly session: LedgerSession;
    readonly runtime: SessionRuntime;
    readonly driver: LedgerReadyImportDriver;
    readonly evidence: LedgerBackupImportEvidence;
  }
>();
/** 内部记的账：每张导入执行凭证属于谁、用没用过。 */
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

/**
 * 这个函数拿出这次打开的清空执行方。
 * 账本不在使用中或没有清空执行方时，抛 `LedgerSessionLifecycleError`。
 */
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

/**
 * 这个函数拿出这次打开的导入执行方。
 * 账本不在使用中或没有导入执行方时，抛 `LedgerSessionLifecycleError`。
 */
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

/**
 * 这个函数按授权清空当前账本。
 * 授权不是这次打开的、或已经过期时，抛 `LedgerSessionLifecycleError`。
 * 举例：拿上一次打开的授权来清空 → 抛错，账本不动。
 */
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

/**
 * 这个函数按授权用备份内容替换当前账本。
 * 返回替换后的账本。
 * 举例：授权过期，或取消信号已经触发 → 抛错，账本不动。
 * 中途开始停止接新活时，导入会被取消。
 */
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

/**
 * 这个函数回答：备份的检查结果能不能拿来申请导入？
 * 举例：硬错误 0 个、可疑分组 2 个且都已确认 → 答能。
 * 举例：有 1 个硬错误 → 答不能。
 */
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
