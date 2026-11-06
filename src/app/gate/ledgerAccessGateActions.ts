/**
 * 这个文件放进账本前那道检查里各个按钮背后的动作。
 * 新建，选已有文件，重连上次的，忘掉它，解锁，恢复。
 * 真正开文件的活交给 `app/file-access`；画面在 `LedgerAccessGate.tsx`。
 * 一次只做一个动作。
 * 做到一半换了动作，旧结果作废。
 * 没有特别的决定。
 */
import type { LedgerSession } from "@/platform/persistence";
import type {
  LedgerFileAccessController,
  LedgerFileAccessErrorCode,
} from "@/app/file-access";
import type {
  Dispatch,
  FormEvent,
  RefObject,
  SetStateAction,
} from "react";
import type { AccessPath } from "./LedgerAccessGateTypes";
import type { Translate } from "@/ui";
import { validatePassphrase } from "@/platform/encryption";
import { LEDGER_FILE_ACCESS_ERROR_CODES } from "@/app/file-access";
import { getFileAccessErrorMessage } from "./LedgerAccessGateHelpers";

type SubmitFileCreateDeps = {
  beginOperation: () => number;
  confirmation: string;
  enterUnlockedSession: (session: LedgerSession) => void;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  passphrase: string;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  t: Translate;
};

/**
 * 这个函数处理新建账本表单的提交。
 * 两次密码不一样、长度不在 8 到 128 个字之间，就不建并提示。
 * 举例：密码 7 个字 → 不建，提示「密码必须为 8 至 128 个 Unicode 字符」。
 * 建好就进入账本；用户取消选位置就回到选择面板；别的错显示原因。
 * 不抛错。
 */
export async function doSubmitFileCreate(
  deps: SubmitFileCreateDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
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
  } = deps;
    event.preventDefault();
    if (operationRef.current) {
      return;
    }
    if (passphrase !== confirmation) {
      setFormError(t("access.error.passphraseMismatch"));
      return;
    }
    if (!validatePassphrase(passphrase).ok) {
      setFormError(t("access.error.passphraseLength"));
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
        setFormError(getFileAccessErrorMessage(result.code, t));
      }
    }
    finishOperation(operation);
}

type SelectFileToOpenDeps = {
  beginOperation: () => number;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  t: Translate;
};

/**
 * 这个函数处理打开已有账本：弹出选文件，选好就去输密码。
 * 举例：选了一个 .lftl 文件 → 停到输密码面板；选了 .txt → 显示扩展名不对。
 * 用户取消不提示；别的错显示原因。不抛错。
 */
export async function doSelectFileToOpen(
  deps: SelectFileToOpenDeps,
) {
  const {
    beginOperation,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    setAccessPath,
    setFormError,
    setIsSubmitting,
    t,
  } = deps;
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
        setFormError(getFileAccessErrorMessage(result.code, t));
      }
    }
    finishOperation(operation);
}

type RequestRememberedConnectionDeps = {
  beginOperation: () => number;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
};

/**
 * 这个函数处理重连上次的文件：请浏览器再问一次权限。
 * 给了权限就去输密码；还要再问就留在原面板；出错就显示重连错误。
 * 不抛错。
 */
export async function doRequestRememberedConnection(
  deps: RequestRememberedConnectionDeps,
) {
  const {
    beginOperation,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    setAccessPath,
    setFormError,
    setIsSubmitting,
    setReconnectError,
  } = deps;
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

type ReselectRememberedConnectionDeps = {
  beginOperation: () => number;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
};

/**
 * 这个函数处理重选上次那个文件：让用户自己再选一次。
 * 举例：选回同一个文件 → 去输密码；选了别的文件 → 显示选错了文件。
 * 选对了就去输密码；取消不提示；选错文件或出错就显示重连错误。
 * 不抛错。
 */
export async function doReselectRememberedConnection(
  deps: ReselectRememberedConnectionDeps,
) {
  const {
    beginOperation,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    setAccessPath,
    setFormError,
    setIsSubmitting,
    setReconnectError,
  } = deps;
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

type ForgetRememberedConnectionDeps = {
  beginOperation: () => number;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  t: Translate;
};

/**
 * 这个函数处理忘掉上次的文件：删掉记住的连接。
 * 删掉后回到选择面板。
 * 删不掉时显示一句提示。不抛错。
 */
export async function doForgetRememberedConnection(
  deps: ForgetRememberedConnectionDeps,
) {
  const {
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
  } = deps;
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
          t("access.error.forgetConnection"),
        );
      }
    }
    finishOperation(operation);
}

type SubmitFileUnlockDeps = {
  beginOperation: () => number;
  enterUnlockedSession: (session: LedgerSession) => void;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  passphrase: string;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  t: Translate;
};

/**
 * 这个函数处理解锁表单的提交：用输的密码打开选好的文件。
 * 打开了就进入账本；文件上次没存完就去恢复面板；别的错显示原因。
 * 举例：密码错 → 提示解锁失败，密码框清空。
 * 不抛错。
 */
export async function doSubmitFileUnlock(
  deps: SubmitFileUnlockDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
    beginOperation,
    enterUnlockedSession,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    passphrase,
    setAccessPath,
    setFormError,
    setIsSubmitting,
    setPassphrase,
    setRecoveryId,
    t,
  } = deps;
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

type ConfirmFileRecoveryDeps = {
  beginOperation: () => number;
  enterUnlockedSession: (session: LedgerSession) => void;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  recoveryId: string | null;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  t: Translate;
};

/**
 * 这个函数处理确认恢复：按文件里留着的恢复版本打开账本。
 * 成功就进入账本；失败显示原因。不抛错。
 */
export async function doConfirmFileRecovery(
  deps: ConfirmFileRecoveryDeps,
) {
  const {
    beginOperation,
    enterUnlockedSession,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    recoveryId,
    setFormError,
    setIsSubmitting,
    setRecoveryId,
    t,
  } = deps;
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

type CancelFileRecoveryDeps = {
  beginOperation: () => number;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  recoveryId: string | null;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  t: Translate;
};

/**
 * 这个函数处理取消恢复：放掉这份恢复，回到选择面板。
 * 放不掉时显示一句提示。不抛错。
 */
export async function doCancelFileRecovery(
  deps: CancelFileRecoveryDeps,
) {
  const {
    beginOperation,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    recoveryId,
    setAccessPath,
    setFormError,
    setIsSubmitting,
    setRecoveryId,
    t,
  } = deps;
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
