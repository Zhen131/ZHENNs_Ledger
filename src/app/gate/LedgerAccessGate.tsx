"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  getDefaultLedgerAccessController,
  getDefaultLedgerFileAccessController,
} from "./ledgerAccessComposition";
import {
  type LedgerAccessController,
} from "@/platform/legacy";
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
  type LedgerFileAccessErrorCode,
} from "@/app/file-access";
import {
  type LedgerSession,
  type SessionQuiesceReason,
} from "@/platform/persistence";
import type {
  LedgerSessionFatalSignal,
  PersistentLedgerState,
} from "@/app/persistence";
import { DashboardShell } from "@/app/dashboard";
import { useLanguage } from "@/ui";
import { PasswordField } from "./PasswordField";
import type {
  AccessState,
  AccessPath,
  PendingSessionCompletion,
} from "./LedgerAccessGateTypes";
import {
  pendingSessionCompletions,
  getAccessErrorMessage,
  getFileAccessErrorMessage,
} from "./LedgerAccessGateHelpers";
import { AccessPanel } from "./AccessPanel";
import { LegacyRetiredPanel } from "./LegacyRetiredPanel";
import { AccessCheckingPanel } from "./AccessCheckingPanel";
import { SessionLockingPanel } from "./SessionLockingPanel";
import { FormError } from "./FormError";
import {
  doFinishFatalSessionLifecycle,
  doFinishSessionLifecycle,
  doInitialize,
  doRetryFailedSessionRelease,
  runGateLifecycleEffect,
} from "./ledgerAccessGateSession";
import {
  doForgetRememberedConnection,
  doRequestRememberedConnection,
  doReselectRememberedConnection,
  doSelectFileToOpen,
  doSubmitFileCreate,
} from "./ledgerAccessGateActions";

export function LedgerAccessGate({
  accessController = getDefaultLedgerAccessController(),
  fileAccessController = getDefaultLedgerFileAccessController(),
}: Readonly<{
  accessController?: LedgerAccessController;
  fileAccessController?: LedgerFileAccessController;
}> = {}) {
  const { t } = useLanguage();
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
  const mountedRef = useRef(true);
  const operationRef = useRef(false);
  const operationGenerationRef = useRef(0);
  const activeSessionRef = useRef<LedgerSession | null>(null);
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
      fatal?: boolean;
    }) => Promise<void>
  >(() => Promise.resolve());

  const initialize = useCallback(async () => {
    return doInitialize(
      {
        accessController,
        activeSessionRef,
        fileAccessController,
        mountedRef,
        operationGenerationRef,
        retryReleaseRef,
        setAccessPath,
        setAccessState,
        setFormError,
        setReconnectError,
      },
    );
  }, [accessController, fileAccessController]);

  useEffect(() => {
    return runGateLifecycleEffect(
      {
        activeSessionRef,
        fileAccessController,
        finalLockRef,
        initialize,
        mountedRef,
        operationGenerationRef,
        operationRef,
        sessionDrainRef,
        sessionLifecycleStarterRef,
        setAccessPath,
        setConfirmation,
        setIsSubmitting,
        setPassphrase,
        setReconnectError,
        setRecoveryId,
      },
    );
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

  async function submitFileCreate(
    event: FormEvent<HTMLFormElement>,
  ) {
    return doSubmitFileCreate(
      {
        beginOperation,
        confirmation,
        enterUnlockedSession,
        fileAccessController,
        finishOperation,
        isCurrentOperation,
        operationRef,
        passphrase,
        setAccessPath,
        setConfirmation,
        setFormError,
        setIsSubmitting,
        setPassphrase,
        t,
      },
      event,
    );
  }

  async function selectFileToOpen() {
    return doSelectFileToOpen(
      {
        beginOperation,
        fileAccessController,
        finishOperation,
        isCurrentOperation,
        operationRef,
        setAccessPath,
        setFormError,
        setIsSubmitting,
        t,
      },
    );
  }

  async function requestRememberedConnection() {
    return doRequestRememberedConnection(
      {
        beginOperation,
        fileAccessController,
        finishOperation,
        isCurrentOperation,
        operationRef,
        setAccessPath,
        setFormError,
        setIsSubmitting,
        setReconnectError,
      },
    );
  }

  async function reselectRememberedConnection() {
    return doReselectRememberedConnection(
      {
        beginOperation,
        fileAccessController,
        finishOperation,
        isCurrentOperation,
        operationRef,
        setAccessPath,
        setFormError,
        setIsSubmitting,
        setReconnectError,
      },
    );
  }

  async function forgetRememberedConnection() {
    return doForgetRememberedConnection(
      {
        beginOperation,
        fileAccessController,
        finishOperation,
        isCurrentOperation,
        operationRef,
        setAccessPath,
        setConfirmation,
        setFormError,
        setIsSubmitting,
        setPassphrase,
        setReconnectError,
        setRecoveryId,
        t,
      },
    );
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
        setFormError(getFileAccessErrorMessage(result.code, t));
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
          setFormError(getFileAccessErrorMessage(result.code, t));
        }
      }
    } catch {
      if (isCurrentOperation(operation)) {
        setFormError(
          getFileAccessErrorMessage(
            LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_FAILED,
            t,
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
          t("access.error.recoveryRelease"),
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
    return doFinishSessionLifecycle(
      {
        activeSessionRef,
        finalLockRef,
        invalidateOperations,
        setAccessState,
        setConfirmation,
        setFormError,
        setPassphrase,
        setRecoveryId,
        startSessionLifecycle,
      },
      drain,
      reason,
    );
  }

  function finishFatalSessionLifecycle(
    drain: PersistentLedgerState["drainForSessionQuiesce"],
    signal: LedgerSessionFatalSignal,
  ): Promise<void> {
    return doFinishFatalSessionLifecycle(
      {
        activeSessionRef,
        finalLockRef,
        invalidateOperations,
        setAccessState,
        setConfirmation,
        setFormError,
        setPassphrase,
        setReconnectError,
        setRecoveryId,
        startSessionLifecycle,
      },
      drain,
      signal,
    );
  }

  function startSessionLifecycle({
    session,
    drain,
    reason,
    fatal = false,
  }: {
    session: LedgerSession;
    drain: PersistentLedgerState["drainForSessionQuiesce"];
    reason: SessionQuiesceReason;
    fatal?: boolean;
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
        setAccessState({ status: "lock-error", fatal });
      }
      return Promise.resolve();
    }

    const retry = async () => {
      const token = await tokenPromise;
      await (reason === "immediate-lock"
        ? session.lockAfterQuiesce(token)
        : session.releaseAfterQuiesce(token));
      if (fatal) {
        await fileAccessController.forgetRememberedConnection();
      }
    };
    retryReleaseRef.current = retry;
    const rawCompletion = retry();
    const pending: PendingSessionCompletion = {
      session,
      fatal,
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
            if (fatal) {
              setAccessPath("choice");
              setAccessState({ status: "fatal-closed" });
            } else {
              void initialize();
            }
          }
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setAccessState({ status: "lock-error", fatal });
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
    return doRetryFailedSessionRelease(
      {
        accessState,
        activeSessionRef,
        fileAccessController,
        initialize,
        mountedRef,
        retryReleaseRef,
        sessionDrainRef,
        setAccessPath,
        setAccessState,
      },
    );
  }

  if (accessState.status === "unlocked") {
    return (
      <DashboardShell
        onFinalLock={finishSessionLifecycle}
        onSessionFatal={finishFatalSessionLifecycle}
        onSessionDrainReady={registerSessionDrain}
        session={accessState.session}
      />
    );
  }

  if (accessState.status === "locking") {
    return (
      <SessionLockingPanel accessState={accessState} t={t} />
    );
  }

  if (accessState.status === "lock-error") {
    return (
      <AccessPanel
        description={
          accessState.fatal
            ? t("access.lockError.fatalDescription")
            : t("access.lockError.description")
        }
        title={
          accessState.fatal
            ? t("access.lockError.fatalTitle")
            : t("access.lockError.title")
        }
      >
        <button
          className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)]"
          onClick={() => void retryFailedSessionRelease()}
          type="button"
        >
          {accessState.fatal ? t("access.lockError.retryFatal") : t("access.lockError.retry")}
        </button>
      </AccessPanel>
    );
  }

  if (accessState.status === "fatal-closed") {
    return (
      <AccessPanel
        description={t("access.fatalClosed.description")}
        title={t("access.fatalClosed.title")}
      >
        <button
          className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)]"
          onClick={() => {
            setAccessState({ status: "setup-required" });
            setAccessPath("choice");
            void selectFileToOpen();
          }}
          type="button"
        >
          {t("access.action.reselectLedger")}
        </button>
        <p className="mt-3 text-sm leading-6 text-[var(--ledger-muted)]">
          {t("access.fatalClosed.hint")}
        </p>
      </AccessPanel>
    );
  }

  if (accessState.status === "checking") {
    return (
      <AccessCheckingPanel t={t} />
    );
  }

  if (accessPath === "legacy-retired") {
    return (
      <LegacyRetiredPanel t={t} />
    );
  }

  if (accessPath === "file-reconnect-prompt") {
    return (
      <AccessPanel
        description={t("access.reconnectPrompt.description")}
        title={t("access.reconnectPrompt.title")}
      >
        <div className="grid gap-3">
          <button
            className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)] disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void requestRememberedConnection()}
            type="button"
          >
            {isSubmitting ? t("access.reconnectPrompt.connecting") : t("access.reconnectPrompt.connect")}
          </button>
          <button
            className="w-full rounded-xl border border-[var(--ledger-border-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--ledger-ink)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void reselectRememberedConnection()}
            type="button"
          >
            {t("access.reconnectPrompt.reselect")}
          </button>
          <button
            className="w-full text-sm font-medium text-red-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void forgetRememberedConnection()}
            type="button"
          >
            {t("access.reconnectPrompt.forget")}
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
            ? getFileAccessErrorMessage(reconnectError, t)
            : t("access.reconnectError.defaultDescription")
        }
        title={t("access.reconnectError.title")}
      >
        <div className="grid gap-3">
          <button
            className="w-full rounded-xl border border-[var(--ledger-border-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--ledger-ink)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void reselectRememberedConnection()}
            type="button"
          >
            {isSubmitting ? t("access.reconnectError.checking") : t("access.reconnectPrompt.reselect")}
          </button>
          <p className="text-sm leading-6 text-[var(--ledger-muted)]">
            {t("access.reconnectError.hint")}
          </p>
          <button
            className="w-full text-sm font-medium text-red-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void forgetRememberedConnection()}
            type="button"
          >
            {t("access.reconnectPrompt.forget")}
          </button>
          <FormError message={formError} />
        </div>
      </AccessPanel>
    );
  }

  if (accessPath === "choice") {
    return (
      <AccessPanel
        description={t("access.choice.description")}
        title={t("access.choice.title")}
      >
        <div className="grid gap-3">
          <button
            className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)] disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void selectFileToOpen()}
            type="button"
          >
            {isSubmitting ? t("access.choice.selecting") : t("access.choice.select")}
          </button>
          <button
            className="w-full rounded-xl border border-[var(--ledger-border-strong)] px-4 py-3 text-sm font-semibold text-[var(--ledger-ink)] hover:bg-[var(--ledger-surface-muted)]"
            onClick={() => {
              setFormError("");
              setAccessPath("file-create");
            }}
            type="button"
          >
            {t("access.choice.create")}
          </button>
          <FormError message={formError} />
        </div>
      </AccessPanel>
    );
  }

  if (accessPath === "file-create") {
    return (
      <AccessPanel
        description={t("access.create.description")}
        title={t("access.create.title")}
      >
        <form className="space-y-4" onSubmit={submitFileCreate}>
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label={t("access.create.password")}
            onChange={setPassphrase}
            value={passphrase}
          />
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label={t("access.create.confirmPassword")}
            onChange={setConfirmation}
            value={confirmation}
          />
          <FormError message={formError} />
          <button
            className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)] disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? t("access.create.creating") : t("access.create.action")}
          </button>
          <button
            className="w-full rounded-xl border border-[var(--ledger-border-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--ledger-ink)] hover:bg-[var(--ledger-surface-muted)]"
            disabled={isSubmitting}
            onClick={returnToChoice}
            type="button"
          >
            {t("access.action.back")}
          </button>
        </form>
      </AccessPanel>
    );
  }

  if (accessPath === "file-open-unlock") {
    return (
      <AccessPanel
        description={t("access.unlock.description")}
        title={t("access.unlock.title")}
      >
        <form className="space-y-4" onSubmit={submitFileUnlock}>
          <PasswordField
            autoComplete="current-password"
            disabled={isSubmitting}
            label={t("access.unlock.password")}
            onChange={setPassphrase}
            value={passphrase}
          />
          <FormError message={formError} />
          <button
            className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)] disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? t("access.unlock.authenticating") : t("access.unlock.action")}
          </button>
          <button
            className="w-full rounded-xl border border-[var(--ledger-border-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--ledger-ink)] hover:bg-[var(--ledger-surface-muted)]"
            disabled={isSubmitting}
            onClick={returnToChoice}
            type="button"
          >
            {t("access.action.back")}
          </button>
        </form>
      </AccessPanel>
    );
  }

  if (accessPath === "file-recovery" && recoveryId !== null) {
    return (
      <AccessPanel
        description={t("access.recovery.description")}
        title={t("access.recovery.title")}
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-[var(--ledger-muted)]">
            {t("access.recovery.hint")}
          </p>
          <FormError message={formError} />
          <button
            className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)] disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void confirmFileRecovery()}
            type="button"
          >
            {isSubmitting ? t("access.recovery.restoring") : t("access.recovery.confirm")}
          </button>
          <button
            className="w-full rounded-xl border border-[var(--ledger-border-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--ledger-ink)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void cancelFileRecovery()}
            type="button"
          >
            {t("access.recovery.cancel")}
          </button>
        </div>
      </AccessPanel>
    );
  }

  if (accessState.status === "error") {
    return (
      <AccessPanel
        description={`${getAccessErrorMessage(accessState.code, t)} ${t("access.error.legacySuffix")}`}
        title={t("access.error.legacyTitle")}
      >
        <button
          className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)]"
          onClick={() => void initialize()}
          type="button"
        >
          {t("access.action.recheck")}
        </button>
      </AccessPanel>
    );
  }

  return (
    <AccessPanel
      description={t("access.stopped.description")}
      title={t("access.stopped.title")}
    >
      <button
        className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)]"
        onClick={() => void initialize()}
        type="button"
      >
        {t("access.action.recheck")}
      </button>
    </AccessPanel>
  );
}
