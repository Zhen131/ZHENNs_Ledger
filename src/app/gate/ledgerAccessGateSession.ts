/**
 * 这个文件管进账本前那道检查的开场和收场。
 * 开场：查上次的文件和浏览器旧账本，决定先给哪个面板。
 * 收场：上锁或出致命错时，让会话停工、放掉文件，再回到检查。
 * 各个按钮背后的动作在同目录 `ledgerAccessGateActions.ts`。
 * 不显然的决定：浏览器里还有旧账本时，先给退役提示。
 * 查旧账本出错不当作有旧账本。2026-11-06 定（W24 06 第二节第 1 条）。
 */
import type { LedgerAccessController } from "@/platform/legacy";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  LedgerSession,
  SessionQuiesceReason,
} from "@/platform/persistence";
import type {
  LedgerFileAccessController,
  LedgerFileAccessErrorCode,
} from "@/app/file-access";
import type {
  AccessPath,
  AccessState,
} from "./LedgerAccessGateTypes";
import { pendingSessionCompletions } from "./LedgerAccessGateHelpers";
import type {
  LedgerSessionFatalSignal,
  PersistentLedgerState,
} from "@/app/persistence";

/** 开场时查「上次那个文件」得到的结果。 */
export type RememberedConnectionInspection = Awaited<
  ReturnType<LedgerFileAccessController["inspectRememberedConnection"]>
>;

/**
 * 这个函数按开场时查到的上次文件，决定停在哪个面板。
 * 能直接用就去输密码；要再问权限就去重连；出错就显示重连错误；没有就去选择面板。
 * 不会出错。
 *
 * 为什么退役提示走开后也用它：用户看到的和没提示时一样。
 * 2026-11-06 提交 20b53b8 写下这个理由。
 */
export function routeRememberedConnection(
  reconnect: RememberedConnectionInspection,
  setAccessPath: Dispatch<SetStateAction<AccessPath>>,
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>,
): void {
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
}

type InitializeDeps = {
  accessController: LedgerAccessController;
  activeSessionRef: RefObject<LedgerSession | null>;
  fileAccessController: LedgerFileAccessController;
  legacyReconnectRef: RefObject<RememberedConnectionInspection | null>;
  mountedRef: RefObject<boolean>;
  operationGenerationRef: RefObject<number>;
  retryReleaseRef: RefObject<(() => Promise<void>) | null>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setAccessState: Dispatch<SetStateAction<AccessState>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
};

/**
 * 这个函数做开场检查，决定先给用户看哪个面板。
 * 上一次的会话还没收完尾，就先等它收完。
 * 再查上次的文件，再查浏览器里有没有旧账本。
 * 有旧账本就先给退役提示；查旧账本出错就照常往下走。
 * 不抛错。
 */
export async function doInitialize(
  deps: InitializeDeps,
) {
  const {
    accessController,
    activeSessionRef,
    fileAccessController,
    legacyReconnectRef,
    mountedRef,
    operationGenerationRef,
    retryReleaseRef,
    setAccessPath,
    setAccessState,
    setFormError,
    setReconnectError,
  } = deps;
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
          setAccessState({
            status: "lock-error",
            fatal: interruptedCompletion.fatal,
          });
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
      if (interruptedCompletion.fatal) {
        setAccessPath("choice");
        setAccessState({ status: "fatal-closed" });
        return;
      }
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

    legacyReconnectRef.current = null;
    setAccessState({ status: "setup-required" });
    if (legacy.status === "unlock-required") {
      // 为什么先说退役：只有这页告诉老用户旧数据去哪了。
      // 2026-11-06 定（W24 06 第二节第 1 条）。
      // 上次文件的结果留着，提示里点「选已有」时要用。
      // 2026-11-06 提交 20b53b8 写下。
      legacyReconnectRef.current = reconnect;
      setAccessPath("legacy-retired");
      return;
    }
    if (legacy.status === "error") {
      // 为什么出错照常走：查不出来不能当作有旧账本。
      // 2026-11-06 定（W24 06 第二节第 1 条）。
      // 控制台只记错误码，不记内容和抛出的值（2026-11-06 提交 20b53b8）。
      console.warn(
        `Legacy browser-ledger presence check failed (${legacy.code}); continuing with the normal ledger choice.`,
      );
    }
    routeRememberedConnection(reconnect, setAccessPath, setReconnectError);
}

type GateLifecycleEffectDeps = {
  activeSessionRef: RefObject<LedgerSession | null>;
  fileAccessController: LedgerFileAccessController;
  finalLockRef: RefObject<{
    session: LedgerSession;
    promise: Promise<void>;
  } | null>;
  initialize: () => Promise<void>;
  mountedRef: RefObject<boolean>;
  operationGenerationRef: RefObject<number>;
  operationRef: RefObject<boolean>;
  sessionDrainRef: RefObject<{
    session: LedgerSession;
    drain: PersistentLedgerState["drainForSessionQuiesce"];
  } | null>;
  sessionLifecycleStarterRef: RefObject<(args: {
      session: LedgerSession;
      drain: PersistentLedgerState["drainForSessionQuiesce"];
      reason: SessionQuiesceReason;
      fatal?: boolean;
    }) => Promise<void>>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
};

/**
 * 这个函数在检查画面挂上时做开场，在它卸下时收场。
 * 卸下时还开着账本，就让会话停工；没开账本，就取消选了一半的文件。
 * 返回一个收拾的函数。不抛错。
 */
export function runGateLifecycleEffect(
  deps: GateLifecycleEffectDeps,
) {
  const {
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
  } = deps;
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
          // 为什么吞掉：凭证还留着，出错就停下，不乱动文件。2026-07-31 提交 40c7fa4。
        }
      }
    };
}

type FinishSessionLifecycleDeps = {
  activeSessionRef: RefObject<LedgerSession | null>;
  finalLockRef: RefObject<{
    session: LedgerSession;
    promise: Promise<void>;
  } | null>;
  invalidateOperations: () => void;
  setAccessState: Dispatch<SetStateAction<AccessState>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  startSessionLifecycle: ({ session, drain, reason, fatal, }: { session: LedgerSession; drain: PersistentLedgerState["drainForSessionQuiesce"]; reason: SessionQuiesceReason; fatal?: boolean; }) => Promise<void>;
};

/**
 * 这个函数处理正常上锁：清掉输入，让会话停工。
 * 同一个会话已经在上锁，交回那一次的结果。
 * 没有打开的账本时什么都不做。不抛错。
 */
export function doFinishSessionLifecycle(
  deps: FinishSessionLifecycleDeps,
  drain: PersistentLedgerState["drainForSessionQuiesce"],
  reason: SessionQuiesceReason,
): Promise<void> {
  const {
    activeSessionRef,
    finalLockRef,
    invalidateOperations,
    setAccessState,
    setConfirmation,
    setFormError,
    setPassphrase,
    setRecoveryId,
    startSessionLifecycle,
  } = deps;
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

    setAccessState({ status: "locking", fatal: false });
    return startSessionLifecycle({
      session,
      drain,
      reason,
    });
}

type FinishFatalSessionLifecycleDeps = {
  activeSessionRef: RefObject<LedgerSession | null>;
  finalLockRef: RefObject<{
    session: LedgerSession;
    promise: Promise<void>;
  } | null>;
  invalidateOperations: () => void;
  setAccessState: Dispatch<SetStateAction<AccessState>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  startSessionLifecycle: ({ session, drain, reason, fatal, }: { session: LedgerSession; drain: PersistentLedgerState["drainForSessionQuiesce"]; reason: SessionQuiesceReason; fatal?: boolean; }) => Promise<void>;
};

/**
 * 这个函数处理导入后没法恢复的致命错：立刻上锁。
 * 信号不是当前会话的就不理。
 * 锁完后不重新检查，直接停在「已关」画面。不抛错。
 */
export function doFinishFatalSessionLifecycle(
  deps: FinishFatalSessionLifecycleDeps,
  drain: PersistentLedgerState["drainForSessionQuiesce"],
  signal: LedgerSessionFatalSignal,
): Promise<void> {
  const {
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
  } = deps;
    const session = activeSessionRef.current;
    if (
      !session ||
      signal.code !== "IMPORT_RECOVERY_BLOCKED" ||
      signal.sessionId !== session.sessionId ||
      signal.sessionGeneration !== session.generation
    ) {
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
    setReconnectError(null);
    setFormError("");
    setAccessState({ status: "locking", fatal: true });
    return startSessionLifecycle({
      session,
      drain,
      reason: "immediate-lock",
      fatal: true,
    });
}

type RetryFailedSessionReleaseDeps = {
  accessState: AccessState;
  activeSessionRef: RefObject<LedgerSession | null>;
  fileAccessController: LedgerFileAccessController;
  initialize: () => Promise<void>;
  mountedRef: RefObject<boolean>;
  retryReleaseRef: RefObject<(() => Promise<void>) | null>;
  sessionDrainRef: RefObject<{
    session: LedgerSession;
    drain: PersistentLedgerState["drainForSessionQuiesce"];
  } | null>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setAccessState: Dispatch<SetStateAction<AccessState>>;
};

/**
 * 这个函数处理用户点「重试释放」：再试一次放掉文件。
 * 放掉了：致命错就停在「已关」，正常上锁就重新开场。
 * 还是放不掉就回到「上锁出错」画面。不抛错。
 */
export async function doRetryFailedSessionRelease(
  deps: RetryFailedSessionReleaseDeps,
) {
  const {
    accessState,
    activeSessionRef,
    fileAccessController,
    initialize,
    mountedRef,
    retryReleaseRef,
    sessionDrainRef,
    setAccessPath,
    setAccessState,
  } = deps;
    const release = retryReleaseRef.current;
    const session = activeSessionRef.current;
    const fatal =
      accessState.status === "lock-error" && accessState.fatal;
    if (!release || !session) {
      return;
    }
    setAccessState({ status: "locking", fatal });
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
          if (fatal) {
            setAccessPath("choice");
            setAccessState({ status: "fatal-closed" });
          } else {
            void initialize();
          }
        }
      }
    } catch {
      if (mountedRef.current) {
        setAccessState({ status: "lock-error", fatal });
      }
    }
}
