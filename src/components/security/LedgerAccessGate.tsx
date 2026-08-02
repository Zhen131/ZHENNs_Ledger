"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  getDefaultLedgerAccessController,
  getDefaultLedgerFileAccessController,
} from "../../composition/ledgerAccessComposition";
import {
  LEGACY_MIGRATION_DELETE_CONFIRMATION_TEXT,
  LEDGER_ACCESS_ERROR_CODES,
  type LedgerAccessController,
  type LedgerAccessErrorCode,
  type LegacyMigrationCandidate,
  type LegacyMigrationDeletionAuthorization,
} from "../../composition/ledgerAccessController";
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
  type LedgerFileAccessErrorCode,
  type LedgerFileMigrationReceipt,
} from "../../composition/ledgerFileAccessController";
import {
  type LedgerSession,
  type SessionQuiesceReason,
} from "../../repositories/ledgerRepository";
import type { PersistentLedgerState } from "../../hooks/usePersistentLedger";
import { DashboardShell } from "../dashboard/DashboardShell";

type AccessState =
  | { status: "checking" }
  | { status: "setup-required" }
  | { status: "unlock-required"; notice?: string }
  | { status: "unlocked"; session: LedgerSession }
  | { status: "locking" }
  | { status: "lock-error" }
  | { status: "error"; code: LedgerAccessErrorCode };

type AccessPath =
  | "choice"
  | "legacy-migration-unlock"
  | "legacy-migration-target"
  | "legacy-migration-delete"
  | "file-create"
  | "file-reconnect-prompt"
  | "file-reconnect-error"
  | "file-open-unlock"
  | "file-recovery";

type PendingSessionCompletion = {
  session: LedgerSession;
  retry: () => Promise<void>;
  completion: Promise<void>;
};

const pendingSessionCompletions = new WeakMap<
  LedgerFileAccessController,
  PendingSessionCompletion
>();

function beginUnpublishedMigrationRelease(
  controller: LedgerFileAccessController,
  session: LedgerSession,
): PendingSessionCompletion | null {
  const existing = pendingSessionCompletions.get(controller);
  if (existing) {
    return existing.session === session ? existing : null;
  }
  const release = controller.releaseUnpublishedMigrationSession;
  if (!release) {
    return null;
  }
  const retry = () => {
    try {
      return release.call(controller, session);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const completion = Promise.resolve().then(retry);
  const pending = { session, retry, completion };
  pendingSessionCompletions.set(controller, pending);
  void completion.then(
    () => {
      if (pendingSessionCompletions.get(controller) === pending) {
        pendingSessionCompletions.delete(controller);
      }
    },
    () => undefined,
  );
  return pending;
}

export function LedgerAccessGate({
  accessController = getDefaultLedgerAccessController(),
  fileAccessController = getDefaultLedgerFileAccessController(),
}: Readonly<{
  accessController?: LedgerAccessController;
  fileAccessController?: LedgerFileAccessController;
}> = {}) {
  const [accessState, setAccessState] = useState<AccessState>({
    status: "checking",
  });
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accessPath, setAccessPath] = useState<AccessPath>("choice");
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [reconnectError, setReconnectError] =
    useState<LedgerFileAccessErrorCode | null>(null);
  const [migrationCandidate, setMigrationCandidate] =
    useState<LegacyMigrationCandidate | null>(null);
  const [migrationReceipt, setMigrationReceipt] =
    useState<LedgerFileMigrationReceipt | null>(null);
  const [migrationSession, setMigrationSession] =
    useState<LedgerSession | null>(null);
  const [migrationDeleteConfirmation, setMigrationDeleteConfirmation] =
    useState("");
  const mountedRef = useRef(true);
  const operationRef = useRef(false);
  const operationGenerationRef = useRef(0);
  const activeSessionRef = useRef<LedgerSession | null>(null);
  const unpublishedMigrationSessionRef =
    useRef<LedgerSession | null>(null);
  const migrationDeletionAuthorizationRef =
    useRef<LegacyMigrationDeletionAuthorization | null>(null);
  const sessionDrainRef = useRef<{
    session: LedgerSession;
    drain: PersistentLedgerState["drainForSessionQuiesce"];
  } | null>(null);
  const finalLockRef = useRef<{
    session: LedgerSession;
    promise: Promise<void>;
  } | null>(null);
  const retryReleaseRef = useRef<(() => Promise<void>) | null>(null);
  const sessionLifecycleStarterRef = useRef<
    (args: {
      session: LedgerSession;
      drain: PersistentLedgerState["drainForSessionQuiesce"];
      reason: SessionQuiesceReason;
    }) => Promise<void>
  >(() => Promise.resolve());

  const initialize = useCallback(async () => {
    const operation = operationGenerationRef.current + 1;
    operationGenerationRef.current = operation;
    setAccessState({ status: "checking" });
    setFormError("");
    setReconnectError(null);

    const interruptedCompletion =
      pendingSessionCompletions.get(fileAccessController);
    if (interruptedCompletion) {
      activeSessionRef.current = interruptedCompletion.session;
      retryReleaseRef.current = interruptedCompletion.retry;
      try {
        await interruptedCompletion.completion;
      } catch {
        if (
          mountedRef.current &&
          operationGenerationRef.current === operation
        ) {
          setAccessState({ status: "lock-error" });
        }
        return;
      }
      if (
        !mountedRef.current ||
        operationGenerationRef.current !== operation
      ) {
        return;
      }
      if (
        pendingSessionCompletions.get(fileAccessController) ===
        interruptedCompletion
      ) {
        pendingSessionCompletions.delete(fileAccessController);
      }
      activeSessionRef.current = null;
      retryReleaseRef.current = null;
    }

    const reconnect =
      await fileAccessController.inspectRememberedConnection();
    if (
      !mountedRef.current ||
      operationGenerationRef.current !== operation
    ) {
      return;
    }

    const legacy = await accessController.inspect();
    if (
      !mountedRef.current ||
      operationGenerationRef.current !== operation
    ) {
      return;
    }

    setAccessState(legacy);
    if (legacy.status === "unlock-required") {
      setAccessPath("legacy-migration-unlock");
      return;
    }
    if (legacy.status === "error") {
      setAccessPath("legacy-migration-unlock");
      return;
    }
    if (reconnect.status === "ready") {
      setAccessPath("file-open-unlock");
    } else if (reconnect.status === "permission-prompt") {
      setAccessPath("file-reconnect-prompt");
    } else if (reconnect.status === "error") {
      setReconnectError(reconnect.code);
      setAccessPath("file-reconnect-error");
    } else {
      setAccessPath("choice");
    }
  }, [accessController, fileAccessController]);

  useEffect(() => {
    mountedRef.current = true;
    operationRef.current = false;
    setIsSubmitting(false);
    setPassphrase("");
    setConfirmation("");
    setRecoveryId(null);
    setReconnectError(null);
    setMigrationCandidate(null);
    setMigrationReceipt(null);
    setMigrationSession(null);
    setMigrationDeleteConfirmation("");
    unpublishedMigrationSessionRef.current = null;
    migrationDeletionAuthorizationRef.current = null;
    setAccessPath("choice");
    void initialize();

    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      operationRef.current = false;
      const activeSession = activeSessionRef.current;
      const unpublishedMigrationSession =
        unpublishedMigrationSessionRef.current;
      const registeredDrain = sessionDrainRef.current;
      const finalLock = finalLockRef.current;
      if (
        unpublishedMigrationSession &&
        activeSession === unpublishedMigrationSession
      ) {
        beginUnpublishedMigrationRelease(
          fileAccessController,
          unpublishedMigrationSession,
        );
        unpublishedMigrationSessionRef.current = null;
        activeSessionRef.current = null;
      } else if (
        activeSession &&
        registeredDrain?.session === activeSession &&
        finalLock?.session !== activeSession
      ) {
        void sessionLifecycleStarterRef.current({
          session: activeSession,
          drain: registeredDrain.drain,
          reason: "route-leave",
        });
      } else if (!activeSession) {
        try {
          fileAccessController.cancelPendingSelection();
        } catch {
          // Cleanup remains fail-closed if a custom controller reports failure.
        }
      }
    };
  }, [fileAccessController, initialize]);

  function beginOperation(): number {
    operationGenerationRef.current += 1;
    operationRef.current = true;
    return operationGenerationRef.current;
  }

  function isCurrentOperation(operation: number): boolean {
    return (
      mountedRef.current &&
      operationGenerationRef.current === operation
    );
  }

  function finishOperation(operation: number): void {
    if (!isCurrentOperation(operation)) {
      return;
    }
    operationRef.current = false;
    setIsSubmitting(false);
  }

  function invalidateOperations(): void {
    operationGenerationRef.current += 1;
    operationRef.current = false;
    setIsSubmitting(false);
  }

  function enterUnlockedSession(session: LedgerSession): void {
    activeSessionRef.current = session;
    sessionDrainRef.current = null;
    finalLockRef.current = null;
    retryReleaseRef.current = null;
    setAccessState({ status: "unlocked", session });
  }

  async function submitLegacyMigrationUnlock(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (operationRef.current) {
      return;
    }
    const unlockLegacy =
      accessController.unlockLegacyForMigration;
    if (!unlockLegacy) {
      setFormError(
        "This version lacks safe migration capability. The legacy ledger remains unchanged, and no empty ledger will be created.",
      );
      return;
    }

    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result = await unlockLegacy.call(
      accessController,
      passphrase,
    );
    if (isCurrentOperation(operation)) {
      setPassphrase("");
      if (result.ok) {
        migrationDeletionAuthorizationRef.current = null;
        setMigrationCandidate(result.candidate);
        setAccessPath("legacy-migration-target");
      } else {
        setFormError(
          result.code === LEDGER_ACCESS_ERROR_CODES.READ_FAILED
            ? "The legacy browser ledger could not be read; legacy data remains unchanged."
            : "The legacy ledger password is wrong, data is damaged, or safe migration requirements are not met; legacy data remains unchanged.",
        );
      }
    }
    finishOperation(operation);
  }

  async function submitLegacyMigrationTarget(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (operationRef.current || !migrationCandidate) {
      return;
    }
    if (passphrase !== confirmation) {
      setFormError("The passwords do not match");
      return;
    }
    const codePointLength = Array.from(passphrase).length;
    if (codePointLength < 12 || codePointLength > 128) {
      setFormError("Password must contain 12 to 128 characters");
      return;
    }
    const createFromLegacy =
      fileAccessController.createFromLegacy;
    const verifyMigrationTarget =
      fileAccessController.verifyMigrationTarget;
    if (!createFromLegacy || !verifyMigrationTarget) {
      setFormError(
        "This browser or version lacks safe migration capability; the legacy ledger remains unchanged.",
      );
      return;
    }

    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const ledgerData = migrationCandidate.readLedgerData();
    const result = await createFromLegacy.call(
      fileAccessController,
      passphrase,
      ledgerData,
    );
    setPassphrase("");
    setConfirmation("");
    if (!isCurrentOperation(operation)) {
      if (result.status === "unlocked") {
        beginUnpublishedMigrationRelease(
          fileAccessController,
          result.session,
        );
      }
      finishOperation(operation);
      return;
    }
    if (result.status === "unlocked") {
      activeSessionRef.current = result.session;
      unpublishedMigrationSessionRef.current = result.session;
      setMigrationSession(result.session);
      setAccessPath("legacy-migration-delete");
      try {
        const receipt = await verifyMigrationTarget.call(
          fileAccessController,
          result.session,
          ledgerData,
        );
        if (isCurrentOperation(operation) && receipt) {
          migrationDeletionAuthorizationRef.current = null;
          setMigrationReceipt(receipt);
        } else if (isCurrentOperation(operation)) {
          setFormError(
            "The new C was created, but migration verification did not pass. The legacy browser ledger is retained and cannot be deleted.",
          );
        }
      } catch {
        if (isCurrentOperation(operation)) {
          setFormError(
            "The new C was created, but migration verification failed. The legacy browser ledger is retained and cannot be deleted.",
          );
        }
      }
    } else if (
      result.status === "error" &&
      result.code !== LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED
    ) {
      setFormError(getFileAccessErrorMessage(result.code));
    }
    finishOperation(operation);
  }

  async function retryMigrationTargetVerification() {
    if (
      operationRef.current ||
      !migrationCandidate ||
      !migrationSession ||
      !fileAccessController.verifyMigrationTarget
    ) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    try {
      const receipt =
        await fileAccessController.verifyMigrationTarget(
          migrationSession,
          migrationCandidate.readLedgerData(),
        );
      if (isCurrentOperation(operation)) {
        if (receipt) {
          migrationDeletionAuthorizationRef.current = null;
          setMigrationReceipt(receipt);
        } else {
          setFormError(
            "The new C still has not passed complete verification; the legacy browser ledger remains retained.",
          );
        }
      }
    } catch {
      if (isCurrentOperation(operation)) {
        setFormError(
          "Verification of the new C failed; the legacy browser ledger remains retained.",
        );
      }
    }
    finishOperation(operation);
  }

  async function confirmLegacyMigrationDeletion() {
    if (
      operationRef.current ||
      !migrationCandidate ||
      !migrationReceipt ||
      !migrationSession
    ) {
      return;
    }
    if (
      migrationDeleteConfirmation !==
      LEGACY_MIGRATION_DELETE_CONFIRMATION_TEXT
    ) {
      setFormError(
        `Enter the full confirmation text "${LEGACY_MIGRATION_DELETE_CONFIRMATION_TEXT}".`,
      );
      return;
    }
    const authorize =
      accessController.authorizeLegacyMigrationDeletion;
    const removeLegacy =
      accessController.deleteLegacyAfterMigration;
    if (!authorize || !removeLegacy) {
      setFormError(
        "This version lacks safe deletion capability; the legacy browser ledger remains retained.",
      );
      return;
    }

    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    let authorization =
      migrationDeletionAuthorizationRef.current;
    if (!authorization) {
      authorization = await authorize.call(
        accessController,
        migrationCandidate,
        migrationReceipt,
        migrationDeleteConfirmation,
      );
      if (authorization && isCurrentOperation(operation)) {
        migrationDeletionAuthorizationRef.current =
          authorization;
      }
    }
    if (!isCurrentOperation(operation)) {
      return;
    }
    if (!authorization) {
      setFormError(
        "The new C or legacy ledger changed, so the safety check did not pass; the legacy browser ledger remains retained.",
      );
      finishOperation(operation);
      return;
    }
    const result = await removeLegacy.call(
      accessController,
      authorization,
    );
    if (isCurrentOperation(operation)) {
      if (result.ok) {
        migrationDeletionAuthorizationRef.current = null;
        unpublishedMigrationSessionRef.current = null;
        setMigrationDeleteConfirmation("");
        setMigrationCandidate(null);
        setMigrationReceipt(null);
        setMigrationSession(null);
        enterUnlockedSession(migrationSession);
      } else {
        setFormError(
          result.code ===
            LEDGER_ACCESS_ERROR_CODES.MIGRATION_SOURCE_CHANGED
            ? "The legacy browser ledger changed during migration and was not deleted. Retain both copies and verify them again."
            : "The legacy browser ledger was not safely deleted. The new C remains unchanged, but formal takeover is incomplete and can be retried.",
        );
      }
    }
    finishOperation(operation);
  }

  async function cancelLegacyMigrationAfterCreate() {
    if (operationRef.current || !migrationSession) {
      return;
    }
    const release =
      fileAccessController.releaseUnpublishedMigrationSession;
    if (!release) {
      setFormError(
        "Safe release of the new C cannot be proven. The legacy ledger remains retained; close the page and retry.",
      );
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    try {
      await release.call(fileAccessController, migrationSession);
      if (isCurrentOperation(operation)) {
        activeSessionRef.current = null;
        unpublishedMigrationSessionRef.current = null;
        setMigrationSession(null);
        setMigrationReceipt(null);
        setMigrationCandidate(null);
        migrationDeletionAuthorizationRef.current = null;
        setMigrationDeleteConfirmation("");
        void initialize();
      }
    } catch {
      if (isCurrentOperation(operation)) {
        setFormError(
          "The new C session has not been safely released. The legacy browser ledger remains retained; retry.",
        );
      }
    }
    finishOperation(operation);
  }

  async function submitFileCreate(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (operationRef.current) {
      return;
    }
    if (passphrase !== confirmation) {
      setFormError("The passwords do not match");
      return;
    }
    const codePointLength = Array.from(passphrase).length;
    if (codePointLength < 12 || codePointLength > 128) {
      setFormError("Password must contain 12 to 128 characters");
      return;
    }

    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result = await fileAccessController.create(passphrase);

    if (isCurrentOperation(operation)) {
      setPassphrase("");
      setConfirmation("");
      if (result.status === "unlocked") {
        enterUnlockedSession(result.session);
      } else if (
        result.status === "error" &&
        result.code === LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED
      ) {
        setAccessPath("choice");
      } else if (result.status === "error") {
        setFormError(getFileAccessErrorMessage(result.code));
      }
    }
    finishOperation(operation);
  }

  async function selectFileToOpen() {
    if (operationRef.current) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result = await fileAccessController.selectExisting();

    if (isCurrentOperation(operation)) {
      if (result.ok) {
        setAccessPath("file-open-unlock");
      } else if (
        result.code !== LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED
      ) {
        setFormError(getFileAccessErrorMessage(result.code));
      }
    }
    finishOperation(operation);
  }

  async function requestRememberedConnection() {
    if (operationRef.current) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result =
      await fileAccessController.requestRememberedPermission();

    if (isCurrentOperation(operation)) {
      if (result.status === "ready") {
        setReconnectError(null);
        setAccessPath("file-open-unlock");
      } else if (result.status === "permission-prompt") {
        setAccessPath("file-reconnect-prompt");
      } else if (result.status === "error") {
        setReconnectError(result.code);
        setAccessPath("file-reconnect-error");
      }
    }
    finishOperation(operation);
  }

  async function reselectRememberedConnection() {
    if (operationRef.current) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result =
      await fileAccessController.reselectRememberedConnection();

    if (isCurrentOperation(operation)) {
      if (result.ok) {
        setReconnectError(null);
        setAccessPath("file-open-unlock");
      } else if (
        result.code !== LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED
      ) {
        setReconnectError(result.code);
        setAccessPath("file-reconnect-error");
      }
    }
    finishOperation(operation);
  }

  async function forgetRememberedConnection() {
    if (operationRef.current) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    try {
      await fileAccessController.forgetRememberedConnection();
      if (isCurrentOperation(operation)) {
        setPassphrase("");
        setConfirmation("");
        setRecoveryId(null);
        setReconnectError(null);
        setAccessPath("choice");
      }
    } catch {
      if (isCurrentOperation(operation)) {
        setFormError(
          "This invalid connection could not be forgotten. No ledger was created or rebound; retry.",
        );
      }
    }
    finishOperation(operation);
  }

  async function submitFileUnlock(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (operationRef.current) {
      return;
    }

    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result =
      await fileAccessController.unlockSelected(passphrase);

    if (isCurrentOperation(operation)) {
      setPassphrase("");
      if (result.status === "unlocked") {
        enterUnlockedSession(result.session);
      } else if (result.status === "recovery-required") {
        setRecoveryId(result.recoveryId);
        setAccessPath("file-recovery");
      } else {
        setFormError(getFileAccessErrorMessage(result.code));
      }
    }
    finishOperation(operation);
  }

  async function confirmFileRecovery() {
    if (operationRef.current || recoveryId === null) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    try {
      const result =
        await fileAccessController.confirmRecovery(recoveryId);

      if (isCurrentOperation(operation)) {
        if (result.status === "unlocked") {
          setRecoveryId(null);
          enterUnlockedSession(result.session);
        } else if (result.status === "error") {
          setFormError(getFileAccessErrorMessage(result.code));
        }
      }
    } catch {
      if (isCurrentOperation(operation)) {
        setFormError(
          getFileAccessErrorMessage(
            LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_FAILED,
          ),
        );
      }
    } finally {
      finishOperation(operation);
    }
  }

  async function cancelFileRecovery() {
    if (operationRef.current || recoveryId === null) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    try {
      await fileAccessController.cancelRecovery(recoveryId);
      if (isCurrentOperation(operation)) {
        setRecoveryId(null);
        setAccessPath("choice");
      }
    } catch {
      if (isCurrentOperation(operation)) {
        setFormError(
          "Release of the recovery candidate file lock cannot be confirmed. C remains closed; retry canceling recovery.",
        );
      }
    } finally {
      finishOperation(operation);
    }
  }

  function returnToChoice() {
    invalidateOperations();
    fileAccessController.cancelPendingSelection();
    setPassphrase("");
    setConfirmation("");
    setRecoveryId(null);
    setReconnectError(null);
    setFormError("");
    setAccessPath("choice");
  }

  function registerSessionDrain(
    session: LedgerSession,
    drain: PersistentLedgerState["drainForSessionQuiesce"],
  ): void {
    if (activeSessionRef.current === session) {
      sessionDrainRef.current = { session, drain };
    }
  }

  function finishSessionLifecycle(
    drain: PersistentLedgerState["drainForSessionQuiesce"],
    reason: SessionQuiesceReason,
  ): Promise<void> {
    const session = activeSessionRef.current;
    if (!session) {
      return Promise.resolve();
    }
    const existing = finalLockRef.current;
    if (existing?.session === session) {
      return existing.promise;
    }

    invalidateOperations();
    setPassphrase("");
    setConfirmation("");
    setRecoveryId(null);
    setFormError("");

    setAccessState({ status: "locking" });
    return startSessionLifecycle({
      session,
      drain,
      reason,
    });
  }

  function startSessionLifecycle({
    session,
    drain,
    reason,
  }: {
    session: LedgerSession;
    drain: PersistentLedgerState["drainForSessionQuiesce"];
    reason: SessionQuiesceReason;
  }): Promise<void> {
    const existing = finalLockRef.current;
    if (existing?.session === session) {
      return existing.promise;
    }

    let tokenPromise: ReturnType<typeof drain>;
    try {
      const request = session.beginQuiesce(reason);
      tokenPromise = drain(request);
    } catch {
      if (mountedRef.current) {
        setAccessState({ status: "lock-error" });
      }
      return Promise.resolve();
    }

    const retry = async () => {
      const token = await tokenPromise;
      await (reason === "immediate-lock"
        ? session.lockAfterQuiesce(token)
        : session.releaseAfterQuiesce(token));
    };
    retryReleaseRef.current = retry;
    const rawCompletion = retry();
    const pending: PendingSessionCompletion = {
      session,
      retry,
      completion: rawCompletion,
    };
    pendingSessionCompletions.set(fileAccessController, pending);
    void rawCompletion.catch(() => undefined);

    const completion = rawCompletion
      .then(() => {
        if (
          pendingSessionCompletions.get(fileAccessController) ===
          pending
        ) {
          pendingSessionCompletions.delete(fileAccessController);
        }
        if (activeSessionRef.current === session) {
          activeSessionRef.current = null;
          sessionDrainRef.current = null;
          retryReleaseRef.current = null;
          if (mountedRef.current) {
            void initialize();
          }
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setAccessState({ status: "lock-error" });
        }
      })
      .finally(() => {
        if (finalLockRef.current?.promise === completion) {
          finalLockRef.current = null;
        }
      });
    finalLockRef.current = { session, promise: completion };
    return completion;
  }
  sessionLifecycleStarterRef.current = startSessionLifecycle;

  async function retryFailedSessionRelease() {
    const release = retryReleaseRef.current;
    const session = activeSessionRef.current;
    if (!release || !session) {
      return;
    }
    setAccessState({ status: "locking" });
    try {
      await release();
      const pending =
        pendingSessionCompletions.get(fileAccessController);
      if (pending?.session === session) {
        pendingSessionCompletions.delete(fileAccessController);
      }
      if (activeSessionRef.current === session) {
        activeSessionRef.current = null;
        sessionDrainRef.current = null;
        retryReleaseRef.current = null;
        if (mountedRef.current) {
          void initialize();
        }
      }
    } catch {
      if (mountedRef.current) {
        setAccessState({ status: "lock-error" });
      }
    }
  }

  if (accessState.status === "unlocked") {
    return (
      <DashboardShell
        onFinalLock={finishSessionLifecycle}
        onSessionDrainReady={registerSessionDrain}
        session={accessState.session}
      />
    );
  }

  if (accessState.status === "locking") {
    return (
      <AccessPanel
        description="New operations are stopped while accepted saves or clears finish safely."
        title="Locking Safely"
      >
        <p aria-live="polite" className="text-sm text-slate-600">
          The current file will be released and the password entry will return when this finishes…
        </p>
      </AccessPanel>
    );
  }

  if (accessState.status === "lock-error") {
    return (
      <AccessPanel
        description="The ledger session is closed and cannot read or write, but the browser has not confirmed release of the file lock."
        title="Safe Release Incomplete"
      >
        <button
          className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
          onClick={() => void retryFailedSessionRelease()}
          type="button"
        >
          Retry safe release
        </button>
      </AccessPanel>
    );
  }

  if (accessState.status === "checking") {
    return (
      <AccessPanel
        description="Checking the local ledger in this browser."
        title="Checking Local Ledger"
      >
        <p aria-live="polite" className="text-sm text-slate-600">
          Please wait…
        </p>
      </AccessPanel>
    );
  }

  if (accessPath === "legacy-migration-unlock") {
    if (accessState.status === "error") {
      return (
        <AccessPanel
          description={`${getAccessErrorMessage(
            accessState.code,
          )} The legacy record will not be deleted automatically or replaced by an empty ledger.`}
          title="Legacy Browser Ledger Cannot Yet Be Migrated Safely"
        >
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
            onClick={() => void initialize()}
            type="button"
          >
            Check again
          </button>
        </AccessPanel>
      );
    }
    return (
      <AccessPanel
        description="A complete legacy browser ledger was detected. First verify it read-only with the original password. Only then can you create a new .lftl file. The legacy ledger is not written or deleted during verification."
        title="Move the Legacy Ledger to C"
      >
        <form
          className="space-y-4"
          onSubmit={submitLegacyMigrationUnlock}
        >
          <PasswordField
            autoComplete="current-password"
            disabled={isSubmitting}
            label="Legacy browser ledger password"
            onChange={setPassphrase}
            value={passphrase}
          />
          <FormError message={formError} />
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Verifying read-only…" : "Verify legacy ledger"}
          </button>
          <p className="text-sm leading-6 text-slate-600">
            If the password is wrong, data is damaged, or the page closes, the legacy IndexedDB record remains unchanged.
          </p>
        </form>
      </AccessPanel>
    );
  }

  if (
    accessPath === "legacy-migration-target" &&
    migrationCandidate
  ) {
    return (
      <AccessPanel
        description="The legacy ledger passed read-only verification. Select a new empty file location and set a master password for the new C. Existing files will not be overwritten."
        title="Create Migration Target C"
      >
        <form
          className="space-y-4"
          onSubmit={submitLegacyMigrationTarget}
        >
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label="Set C master password"
            onChange={setPassphrase}
            value={passphrase}
          />
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label="Re-enter C master password"
            onChange={setConfirmation}
            value={confirmation}
          />
          <FormError message={formError} />
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting
              ? "Writing, closing, and rereading…"
              : "Select a new file and move the legacy ledger"}
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => {
              setMigrationCandidate(null);
              setPassphrase("");
              setConfirmation("");
              setFormError("");
              setAccessPath("legacy-migration-unlock");
            }}
            type="button"
          >
            Cancel and retain the legacy ledger
          </button>
        </form>
      </AccessPanel>
    );
  }

  if (
    accessPath === "legacy-migration-delete" &&
    migrationCandidate &&
    migrationSession
  ) {
    return (
      <AccessPanel
        description={
          migrationReceipt
            ? "The legacy ledger was fully written to the new C and passed close, reread, file identity, and content verification. Only after another confirmation will the system verify and delete the one legacy IndexedDB record."
            : "The new C was created, but the complete migration receipt has not passed. The legacy IndexedDB record remains unchanged."
        }
        title={
          migrationReceipt
            ? "Migration Verified: Confirm Legacy Ledger Exit"
            : "Migration Verification Incomplete"
        }
      >
        <div className="space-y-4">
          {migrationReceipt ? (
            <>
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                Enter &quot;{LEGACY_MIGRATION_DELETE_CONFIRMATION_TEXT}&quot; to confirm
                <input
                  aria-label="Enter legacy ledger deletion confirmation text"
                  className="rounded-md border border-red-300 px-3 py-2 text-slate-950 outline-none focus:ring-2 focus:ring-red-100"
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setMigrationDeleteConfirmation(
                      event.target.value,
                    );
                    setFormError("");
                  }}
                  value={migrationDeleteConfirmation}
                />
              </label>
              <p className="text-sm leading-6 text-slate-600">
                Deletion targets only the legacy record verified during migration and unchanged since then. The file-handle registration for the new C is retained.
              </p>
              <button
                className="w-full rounded-md bg-red-800 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                disabled={isSubmitting}
                onClick={() =>
                  void confirmLegacyMigrationDeletion()
                }
                type="button"
              >
                {isSubmitting
                  ? "Re-verifying and deleting the legacy record…"
                  : "Confirm deletion and enter C"}
              </button>
            </>
          ) : (
            <button
              className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              disabled={isSubmitting}
              onClick={() =>
                void retryMigrationTargetVerification()
              }
              type="button"
            >
              {isSubmitting ? "Re-verifying…" : "Re-verify the new C"}
            </button>
          )}
          <FormError message={formError} />
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() =>
              void cancelLegacyMigrationAfterCreate()
            }
            type="button"
          >
            Retain the legacy record and safely exit the new C
          </button>
        </div>
      </AccessPanel>
    );
  }

  if (accessPath === "file-reconnect-prompt") {
    return (
      <AccessPanel
        description="The browser remembers the last C, but explicit authorization is required again. No permission is requested and no empty ledger is created before you click."
        title="Reconnect the Last C"
      >
        <div className="grid gap-3">
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void requestRememberedConnection()}
            type="button"
          >
            {isSubmitting ? "Reconnecting…" : "Reconnect"}
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void reselectRememberedConnection()}
            type="button"
          >
            Reselect the original C
          </button>
          <button
            className="w-full text-sm font-medium text-red-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void forgetRememberedConnection()}
            type="button"
          >
            Forget this connection and select another ledger
          </button>
          <FormError message={formError} />
        </div>
      </AccessPanel>
    );
  }

  if (accessPath === "file-reconnect-error") {
    return (
      <AccessPanel
        description={
          reconnectError
            ? getFileAccessErrorMessage(reconnectError)
            : "The last C could not be safely reconnected."
        }
        title="The Last C Is Temporarily Unavailable"
      >
        <div className="grid gap-3">
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void reselectRememberedConnection()}
            type="button"
          >
            {isSubmitting ? "Verifying…" : "Reselect the original C"}
          </button>
          <p className="text-sm leading-6 text-slate-600">
            Continue only if the browser confirms the same physical file and the ledger identity inside also matches. A copy with the same name or fileId does not qualify.
          </p>
          <button
            className="w-full text-sm font-medium text-red-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void forgetRememberedConnection()}
            type="button"
          >
            Forget this connection and select another ledger
          </button>
          <FormError message={formError} />
        </div>
      </AccessPanel>
    );
  }

  if (accessPath === "choice") {
    return (
      <AccessPanel
        description="The complete ledger exists only in the encrypted .lftl file you select. The browser remembers only the last file and minimal connection metadata; it does not store another complete ledger."
        title="Select or Create C"
      >
        <div className="grid gap-3">
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            onClick={() => {
              setFormError("");
              setAccessPath("file-create");
            }}
            type="button"
          >
            Create C (.lftl)
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void selectFileToOpen()}
            type="button"
          >
            {isSubmitting ? "Selecting…" : "Select C (.lftl)"}
          </button>
          <FormError message={formError} />
        </div>
      </AccessPanel>
    );
  }

  if (accessPath === "file-create") {
    return (
      <AccessPanel
        description="C is encrypted with one master password. There is no recovery code or backdoor; forgetting the password permanently loses access to this C."
        title="Create Encrypted Working File C"
      >
        <form className="space-y-4" onSubmit={submitFileCreate}>
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label="Set C master password"
            onChange={setPassphrase}
            value={passphrase}
          />
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label="Re-enter C master password"
            onChange={setConfirmation}
            value={confirmation}
          />
          <FormError message={formError} />
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Creating and rereading…" : "Choose location and create"}
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
            disabled={isSubmitting}
            onClick={returnToChoice}
            type="button"
          >
            Back
          </button>
        </form>
      </AccessPanel>
    );
  }

  if (accessPath === "file-open-unlock") {
    return (
      <AccessPanel
        description="Only the explicitly selected C will open. A wrong password or failed file authentication will not write to it."
        title="Unlock Selected C"
      >
        <form className="space-y-4" onSubmit={submitFileUnlock}>
          <PasswordField
            autoComplete="current-password"
            disabled={isSubmitting}
            label="C master password"
            onChange={setPassphrase}
            value={passphrase}
          />
          <FormError message={formError} />
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Authenticating…" : "Unlock selected C"}
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
            disabled={isSubmitting}
            onClick={returnToChoice}
            type="button"
          >
            Back
          </button>
        </form>
      </AccessPanel>
    );
  }

  if (accessPath === "file-recovery" && recoveryId !== null) {
    return (
      <AccessPanel
        description="The latest save was not recovered; the previous version will be restored."
        title="Confirm Previous-Version Recovery"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-700">
            The current version failed complete authentication and ledger validation; the previous version was independently verified. Confirmation creates a new current version using only the previous content and never presents new content from the damaged version as recovered.
          </p>
          <FormError message={formError} />
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void confirmFileRecovery()}
            type="button"
          >
            {isSubmitting ? "Recovering and rereading…" : "Confirm previous-version recovery"}
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void cancelFileRecovery()}
            type="button"
          >
            Cancel recovery
          </button>
        </div>
      </AccessPanel>
    );
  }

  if (accessState.status === "error") {
    return (
      <AccessPanel
        description={`${getAccessErrorMessage(
          accessState.code,
        )} The system will not blindly delete the old record or create an empty ledger to replace it.`}
        title="Unable to Open Local Ledger"
      >
        <button
          className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          onClick={() => void initialize()}
          type="button"
        >
          Check again
        </button>
      </AccessPanel>
    );
  }

  return (
    <AccessPanel
      description="No complete-ledger write chain was entered. Recheck the C connection state."
      title="Ledger Entry Stopped Safely"
    >
      <button
        className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
        onClick={() => void initialize()}
        type="button"
      >
        Check again
      </button>
    </AccessPanel>
  );
}

function AccessPanel({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
}>) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Local-First Trading Ledger
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">{title}</h1>
        <p className="mb-6 mt-2 text-sm leading-6 text-slate-600">
          {description}
        </p>
        {children}
      </section>
    </main>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  disabled,
  autoComplete,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoComplete: "new-password" | "current-password";
}>) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isRevealed, setIsRevealed] = useState(false);

  useEffect(() => {
    if (disabled) {
      setIsRevealed(false);
    }
  }, [disabled]);

  useEffect(() => {
    const hide = () => setIsRevealed(false);
    const hideWhenDocumentIsHidden = () => {
      if (document.visibilityState === "hidden") {
        hide();
      }
    };
    const form = inputRef.current?.closest("form");

    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hideWhenDocumentIsHidden);
    form?.addEventListener("submit", hide);

    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener(
        "visibilitychange",
        hideWhenDocumentIsHidden,
      );
      form?.removeEventListener("submit", hide);
    };
  }, []);

  const reveal = () => {
    if (!disabled) {
      setIsRevealed(true);
    }
  };
  const hide = () => setIsRevealed(false);
  const handleRevealKeyDown = (key: string) => {
    if (key === " " || key === "Enter") {
      reveal();
    }
  };
  const handleRevealKeyUp = (key: string) => {
    if (key === " " || key === "Enter") {
      hide();
    }
  };

  return (
    <div>
      <label
        className="block text-sm font-medium text-slate-800"
        htmlFor={inputId}
      >
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          autoComplete={autoComplete}
          className="w-full rounded-md border border-slate-300 px-3 py-2.5 pr-11 text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100"
          disabled={disabled}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          ref={inputRef}
          type={isRevealed ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={`Hold to view ${label}`}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:text-slate-300"
          disabled={disabled}
          onBlur={hide}
          onClick={hide}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
            }
            handleRevealKeyDown(event.key);
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
            }
            handleRevealKeyUp(event.key);
          }}
          onPointerCancel={hide}
          onPointerDown={(event) => {
            event.preventDefault();
            reveal();
          }}
          onPointerLeave={hide}
          onPointerUp={hide}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
            />
            <circle
              cx="12"
              cy="12"
              r="2.75"
              stroke="currentColor"
              strokeWidth="1.75"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function FormError({ message }: Readonly<{ message: string }>) {
  return message ? (
    <p aria-live="polite" className="text-sm text-red-700" role="alert">
      {message}
    </p>
  ) : null;
}

function getAccessErrorMessage(code: LedgerAccessErrorCode): string {
  switch (code) {
    case LEDGER_ACCESS_ERROR_CODES.READ_FAILED:
      return "IndexedDB could not be read in this browser. No data was written or overwritten.";
    case LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT:
      return "An unsupported legacy or unknown format was detected. The system will not migrate or overwrite it automatically.";
    case LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE:
      return "The local encrypted record structure is invalid or damaged. The system will not attempt to overwrite it.";
    default:
      return "The local encrypted ledger cannot be opened right now.";
  }
}

function getFileAccessErrorMessage(
  code: LedgerFileAccessErrorCode,
): string {
  switch (code) {
    case LEDGER_FILE_ACCESS_ERROR_CODES.PICKER_UNAVAILABLE:
      return "This browser does not support C file selection. Use a supported Chrome browser.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION:
      return "Select a C file with the .lftl extension.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.NON_EMPTY_CREATE_TARGET:
      return "Nothing was created to avoid overwriting an existing file. Choose a new filename or use Select C to open an existing file.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE:
      return "The selected file is not a valid C or its structure is damaged; nothing was written.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED:
      return "The password is wrong or file authentication failed; the selected C was not written.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION:
      return "Reselect the C to open.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE:
      return "This physical C is in use by another page or a session that has not finished releasing it. Exit safely or complete release, then retry.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED:
      return "This browser lacks safe multi-page file coordination, so the C write entry is disabled.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_FAILED:
      return "Use by another page cannot be ruled out, so opening stopped under safety rules. Close other pages and retry.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND:
      return "The recovery request expired. Reselect and unlock C.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_FAILED:
      return "Previous-version recovery writing, closing, or reread verification failed, so the ledger was not entered. Retry or cancel.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.EXTERNAL_CHANGE:
      return "C changed outside this page. Cancel and reopen it to avoid overwriting the newer version.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_INVALID:
      return "The saved C connection record is damaged or unsupported. No ledger was cleared, overwritten, or rebound.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_SAVE_FAILED:
      return "C passed file verification, but the browser could not save the minimal record required for the next reconnect. The ledger was not entered and success was not reported. Retain C and retry.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_DENIED:
      return "The browser did not receive read/write permission for this C. The system will not create an empty ledger or substitute another ledger.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_REQUIRED:
      return "This C still requires explicit authorization. Permission is requested only after you click Reconnect.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED:
      return "The last C may have moved, been deleted, or become unreadable. No empty ledger was created and no silent switch to a browser ledger occurred.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.WRONG_RECONNECT_FILE:
      return "The selected file is not the same physical C as the last connection. Matching names or fileIds do not permit rebinding or writing.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED:
      return "C creation, close, or reread verification failed, so the ledger cannot be entered.";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED:
      return "";
    default:
      return "The C file operation failed, and save success was not reported.";
  }
}
