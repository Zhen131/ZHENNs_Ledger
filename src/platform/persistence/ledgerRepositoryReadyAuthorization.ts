/**
 * 这个文件管清空和导入这两件大事的授权。
 * 怎么做授权，怎么认它是真的。
 * 它不管真正清空和导入，那在 ledgerRepositoryReadyRuntime.ts 和 files 区。
 * 不显然的决定：执行凭证只能用一次，用过再用就不认。这是猜的，日志里没写，要核。
 */

import { READY_LEDGER_CLEAR_CONFIRMATION_TEXT } from "./ledgerRepository";
import {
  readyLedgerClearAuthorizationBrand,
  readyLedgerImportAuthorizationBrand,
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
} from "./ledgerRepositoryContract";
import {
  readyClearAuthorizationRuntimes,
  readyClearAuthorizationContextRuntimes,
  readyClearExecutionContextRuntimes,
  readyImportAuthorizationRuntimes,
  readyImportAuthorizationContextRuntimes,
  readyImportExecutionContextRuntimes,
  isValidReadyImportEvidence,
} from "./ledgerRepositoryReadyRuntime";

/**
 * 这个函数给清空做一张授权，写上当时看到的文件和版本。
 * 举例：文件 "f1"、版本 "r7" → 答一张写着 f1、r7 的授权。
 * 不会出错。
 */
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

/**
 * 这个函数给导入做一张授权。
 * 写上当时看到的文件、版本和导入内容的指纹。
 * 举例：文件 "f1"、版本 "r7" → 答一张写着 f1、r7 的授权。
 * 不会出错。
 */
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
    requireHistoricalRawText: context.requireHistoricalRawText,
    [readyLedgerImportAuthorizationBrand]: true as const,
  });
}

/**
 * 这个函数回答：清空申请是不是本层发出、仍然有效？
 * 举例：确认句打错了 → 答不是；账本已经开始停止接新活 → 答不是。
 */
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

/**
 * 这个函数认领一张清空执行凭证；认领成功答 true，以后再认领就答 false。
 * 举例：同一张凭证认领两次 → 第一次答 true，第二次答 false。
 */
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

/**
 * 这个函数回答：导入申请是不是本层发出、仍然有效？
 * 举例：备份里有可疑分组、用户还没确认 → 答不是。
 */
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
        contextRuntime.evidence.suspiciousGroupIdentity &&
      context.requireHistoricalRawText ===
        contextRuntime.evidence.requireHistoricalRawText,
  );
}

/**
 * 这个函数认领一张导入执行凭证；认领成功答 true，以后再认领就答 false。
 * 举例：取消信号已经触发 → 答 false。
 */
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
      authorizationRuntime.evidence.suspiciousGroupIdentity ||
    authorization.requireHistoricalRawText !==
      authorizationRuntime.evidence.requireHistoricalRawText
  ) {
    return false;
  }
  executionRuntime.claimed = true;
  return true;
}
