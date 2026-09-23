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
    requireHistoricalRawText: context.requireHistoricalRawText,
    [readyLedgerImportAuthorizationBrand]: true as const,
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
        contextRuntime.evidence.suspiciousGroupIdentity &&
      context.requireHistoricalRawText ===
        contextRuntime.evidence.requireHistoricalRawText,
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
      authorizationRuntime.evidence.suspiciousGroupIdentity ||
    authorization.requireHistoricalRawText !==
      authorizationRuntime.evidence.requireHistoricalRawText
  ) {
    return false;
  }
  executionRuntime.claimed = true;
  return true;
}
