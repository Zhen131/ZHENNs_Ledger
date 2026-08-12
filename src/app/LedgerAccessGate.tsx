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
} from "./ledgerAccessComposition";
import {
  LEDGER_ACCESS_ERROR_CODES,
  type LedgerAccessController,
  type LedgerAccessErrorCode,
} from "@/platform/legacy";
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
  type LedgerFileAccessErrorCode,
} from "./ledgerFileAccessController";
import {
  type LedgerSession,
  type SessionQuiesceReason,
} from "@/platform/persistence";
import type { PersistentLedgerState } from "./usePersistentLedger";
import { DashboardShell } from "./DashboardShell";

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
  | "legacy-retired"
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

    if (
      legacy.status === "unlock-required" ||
      legacy.status === "error"
    ) {
      setAccessState({
        status: "error",
        code:
          legacy.status === "error"
            ? legacy.code
            : LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT,
      });
      setAccessPath("legacy-retired");
      return;
    }
    setAccessState(legacy);
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
    setAccessPath("choice");
    void initialize();

    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      operationRef.current = false;
      const activeSession = activeSessionRef.current;
      const registeredDrain = sessionDrainRef.current;
      const finalLock = finalLockRef.current;
      if (
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

  async function submitFileCreate(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (operationRef.current) {
      return;
    }
    if (passphrase !== confirmation) {
      setFormError("两次输入的密码不一致");
      return;
    }
    const codePointLength = Array.from(passphrase).length;
    if (codePointLength < 12 || codePointLength > 128) {
      setFormError("密码必须为 12 至 128 个字符");
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
          "无法忘记这条失效连接；没有创建或改绑任何账本，请重试。",
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
          "无法确认恢复候选的文件锁已经释放。C 仍保持关闭，请重试取消恢复。",
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
        description="已停止接收新操作，正在等待已经接受的保存或清空安全收尾。"
        title="正在安全锁定"
      >
        <p aria-live="polite" className="text-sm text-slate-600">
          完成后会释放当前文件并回到密码入口，请稍候…
        </p>
      </AccessPanel>
    );
  }

  if (accessState.status === "lock-error") {
    return (
      <AccessPanel
        description="账本会话已经关闭且不能继续读取或写入，但浏览器尚未确认文件占用已释放。"
        title="安全释放尚未完成"
      >
        <button
          className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
          onClick={() => void retryFailedSessionRelease()}
          type="button"
        >
          重试安全释放
        </button>
      </AccessPanel>
    );
  }

  if (accessState.status === "checking") {
    return (
      <AccessPanel
        description="正在检查此浏览器中的本地账本。"
        title="正在检查本地账本"
      >
        <p aria-live="polite" className="text-sm text-slate-600">
          请稍候…
        </p>
      </AccessPanel>
    );
  }

  if (accessPath === "legacy-retired") {
    return (
      <AccessPanel
        description="检测到旧版浏览器整账。版本 2 不支持解锁、迁移或删除这条旧记录；它会原样保留。请新建版本 2 账本。"
        title="旧版账本已退役"
      >
        <p className="text-sm leading-6 text-slate-600">
          系统没有读取旧账本业务数据，也不会用空账本覆盖它。
        </p>
      </AccessPanel>
    );
  }

  if (accessPath === "file-reconnect-prompt") {
    return (
      <AccessPanel
        description="浏览器记得上次使用的 C，但需要你明确重新授权。点击前不会请求权限，也不会创建空账本。"
        title="重新连接上次的 C"
      >
        <div className="grid gap-3">
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void requestRememberedConnection()}
            type="button"
          >
            {isSubmitting ? "正在重新连接…" : "重新连接"}
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void reselectRememberedConnection()}
            type="button"
          >
            重新选择原来的 C
          </button>
          <button
            className="w-full text-sm font-medium text-red-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void forgetRememberedConnection()}
            type="button"
          >
            忘记这条连接并选择另一本账
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
            : "无法安全重新连接上次的 C。"
        }
        title="上次的 C 暂时不可用"
      >
        <div className="grid gap-3">
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void reselectRememberedConnection()}
            type="button"
          >
            {isSubmitting ? "正在核对…" : "重新选择原来的 C"}
          </button>
          <p className="text-sm leading-6 text-slate-600">
            只有浏览器确认是同一个实际文件，并且文件内的账本身份也一致，才会继续。名字相同或 fileId 相同的复制件都不算。
          </p>
          <button
            className="w-full text-sm font-medium text-red-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void forgetRememberedConnection()}
            type="button"
          >
            忘记这条连接并选择另一本账
          </button>
          <FormError message={formError} />
        </div>
      </AccessPanel>
    );
  }

  if (accessPath === "choice") {
    return (
      <AccessPanel
        description="完整账本只保存在你选择的加密 .lftl 文件中。浏览器只记住上次选择的文件和少量连接信息，不会另存一份完整账本。"
        title="选择或新建 C"
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
            新建 C（.lftl）
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void selectFileToOpen()}
            type="button"
          >
            {isSubmitting ? "正在选择…" : "选择 C（.lftl）"}
          </button>
          <FormError message={formError} />
        </div>
      </AccessPanel>
    );
  }

  if (accessPath === "file-create") {
    return (
      <AccessPanel
        description="C 使用一个核心密码加密。没有恢复码或后门；忘记密码将永久失去对此 C 的访问。"
        title="新建加密工作文件 C"
      >
        <form className="space-y-4" onSubmit={submitFileCreate}>
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label="设置 C 核心密码"
            onChange={setPassphrase}
            value={passphrase}
          />
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label="再次输入 C 核心密码"
            onChange={setConfirmation}
            value={confirmation}
          />
          <FormError message={formError} />
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "正在创建并复读…" : "选择位置并创建"}
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
            disabled={isSubmitting}
            onClick={returnToChoice}
            type="button"
          >
            返回
          </button>
        </form>
      </AccessPanel>
    );
  }

  if (accessPath === "file-open-unlock") {
    return (
      <AccessPanel
        description="只会打开刚才明确选择的一个 C。密码错误或文件认证失败不会写入该文件。"
        title="解锁所选 C"
      >
        <form className="space-y-4" onSubmit={submitFileUnlock}>
          <PasswordField
            autoComplete="current-password"
            disabled={isSubmitting}
            label="C 核心密码"
            onChange={setPassphrase}
            value={passphrase}
          />
          <FormError message={formError} />
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "正在认证…" : "解锁所选 C"}
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
            disabled={isSubmitting}
            onClick={returnToChoice}
            type="button"
          >
            返回
          </button>
        </form>
      </AccessPanel>
    );
  }

  if (accessPath === "file-recovery" && recoveryId !== null) {
    return (
      <AccessPanel
        description="最新一次保存没有恢复，现在恢复的是上一版"
        title="确认恢复上一版"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-700">
            当前版本没有通过完整认证与账本校验；上一版已独立验证。确认后只会用上一版内容生成一个新的当前版本，不会把损坏版本中的新增内容伪装成已恢复。
          </p>
          <FormError message={formError} />
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void confirmFileRecovery()}
            type="button"
          >
            {isSubmitting ? "正在恢复并复读…" : "确认恢复上一版"}
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => void cancelFileRecovery()}
            type="button"
          >
            取消恢复
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
        )} 系统不会盲删旧记录，也不会创建空账本来代替它。`}
        title="无法打开本地账本"
      >
        <button
          className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          onClick={() => void initialize()}
          type="button"
        >
          重新检查
        </button>
      </AccessPanel>
    );
  }

  return (
    <AccessPanel
      description="没有进入任何完整账本写入链。请重新检查 C 连接状态。"
      title="账本入口已安全停止"
    >
      <button
        className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
        onClick={() => void initialize()}
        type="button"
      >
        重新检查
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
          aria-label={`按住查看${label}`}
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
      return "无法读取此浏览器中的 IndexedDB。未写入或覆盖任何数据。";
    case LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT:
      return "检测到不受支持的旧版或未知格式。系统不会自动迁移或覆盖。";
    case LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE:
      return "本地加密记录结构无效或已损坏。系统不会尝试覆盖。";
    default:
      return "本地加密账本暂时无法打开。";
  }
}

function getFileAccessErrorMessage(
  code: LedgerFileAccessErrorCode,
): string {
  switch (code) {
    case LEDGER_FILE_ACCESS_ERROR_CODES.PICKER_UNAVAILABLE:
      return "当前浏览器不支持 C 文件选择，请使用受支持的 Chrome。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION:
      return "请选择扩展名为 .lftl 的 C 文件。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.NON_EMPTY_CREATE_TARGET:
      return "为防止覆盖已有文件，本次未创建；请选择新文件名，或使用“选择 C”打开已有文件。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_FILE_VERSION:
      return "检测到旧版或未知 .lftl 格式。版本 2 不支持解锁或迁移；未写入所选文件。请新建版本 2 账本。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE:
      return "所选文件不是合法 C，或文件结构已经损坏；未写入任何内容。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED:
      return "密码错误或文件认证失败；未写入所选 C。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION:
      return "请重新选择要打开的 C。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE:
      return "这个实际 C 已被另一个页面或尚未完成释放的会话占用。请先安全退出或完成释放，再主动重试。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED:
      return "当前浏览器缺少安全的多页面文件协调能力，已关闭 C 写入入口。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_FAILED:
      return "无法确认这个 C 是否已被其他页面使用，已按安全规则停止打开。请关闭其他页面后主动重试。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND:
      return "恢复请求已经失效，请重新选择并解锁 C。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_FAILED:
      return "上一版恢复写入、关闭或复读验证失败，尚未进入账本；可以重试或取消。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.EXTERNAL_CHANGE:
      return "C 在本页面之外发生了变化。为避免覆盖新版本，请取消并重新打开该 C。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_INVALID:
      return "保存的 C 连接记录已损坏或版本不受支持。系统没有清空、覆盖或改绑任何账本。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_SAVE_FAILED:
      return "C 已完成文件验证，但浏览器没能保存下次重连所需的最小连接记录，因此没有进入账本，也没有伪装成功。请保留该 C 并重试当前操作。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_DENIED:
      return "浏览器没有获得这个 C 的读写权限。系统不会创建空账本或退回另一份账本冒充它。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_REQUIRED:
      return "这个 C 仍需要明确授权；只有点击“重新连接”后才会请求权限。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED:
      return "上次的 C 可能已移动、删除或不可读取。系统没有创建空账本，也没有静默切换到浏览器账本。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.WRONG_RECONNECT_FILE:
      return "所选文件不是上次连接的同一个实际 C；即使名字或 fileId 相同也不会改绑或写入。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED:
      return "C 创建、关闭或复读验证失败，不能进入账本。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED:
      return "";
    default:
      return "C 文件操作失败，未报告保存成功。";
  }
}
