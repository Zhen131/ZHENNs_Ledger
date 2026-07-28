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
  LEDGER_ACCESS_ERROR_CODES,
  type LedgerAccessController,
  type LedgerAccessErrorCode,
} from "../../composition/ledgerAccessController";
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
  type LedgerFileAccessErrorCode,
} from "../../composition/ledgerFileAccessController";
import {
  createIndexedDbLedgerSession,
  type LedgerSession,
} from "../../repositories/ledgerRepository";
import { DashboardShell } from "../dashboard/DashboardShell";

const RESET_CONFIRMATION_TEXT = "清空本地加密账本";

type AccessState =
  | { status: "checking" }
  | { status: "setup-required" }
  | { status: "unlock-required"; notice?: string }
  | { status: "unlocked"; session: LedgerSession }
  | { status: "error"; code: LedgerAccessErrorCode };

type AccessPath =
  | "choice"
  | "indexeddb"
  | "file-create"
  | "file-open-unlock";

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
  const [showReset, setShowReset] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [accessPath, setAccessPath] = useState<AccessPath>("choice");
  const mountedRef = useRef(true);
  const operationRef = useRef(false);

  const inspect = useCallback(async () => {
    setAccessState({ status: "checking" });
    setFormError("");
    const result = await accessController.inspect();

    if (!mountedRef.current) {
      return;
    }

    setAccessState(result);
  }, [accessController]);

  useEffect(() => {
    mountedRef.current = true;
    void inspect();

    return () => {
      mountedRef.current = false;
    };
  }, [inspect]);

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
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

    operationRef.current = true;
    setIsSubmitting(true);
    setFormError("");
    const result = await accessController.setup(passphrase);
    setPassphrase("");
    setConfirmation("");

    if (mountedRef.current) {
      if (result.ok) {
        setAccessState({
          status: "unlocked",
          session:
            result.session ??
            createIndexedDbLedgerSession(result.repository),
        });
      } else if (
        result.code ===
        LEDGER_ACCESS_ERROR_CODES.SETUP_RECOVERY_REQUIRED
      ) {
        setAccessState({
          status: "unlock-required",
          notice:
            "加密账本已写入，但本次验证未完成。请重新输入密码解锁。",
        });
      } else if (
        result.code === LEDGER_ACCESS_ERROR_CODES.READ_FAILED ||
        result.code === LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT ||
        result.code === LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE
      ) {
        setAccessState({ status: "error", code: result.code });
      } else {
        setFormError("加密账本创建失败，请重试");
      }

      setIsSubmitting(false);
    }

    operationRef.current = false;
  }

  async function submitUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (operationRef.current) {
      return;
    }

    operationRef.current = true;
    setIsSubmitting(true);
    setFormError("");
    const result = await accessController.unlock(passphrase);
    setPassphrase("");

    if (mountedRef.current) {
      if (result.ok) {
        setAccessState({
          status: "unlocked",
          session:
            result.session ??
            createIndexedDbLedgerSession(result.repository),
        });
      } else if (
        result.code === LEDGER_ACCESS_ERROR_CODES.READ_FAILED ||
        result.code === LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT ||
        result.code === LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE
      ) {
        setAccessState({ status: "error", code: result.code });
      } else {
        setFormError("密码错误或本地加密数据已损坏");
      }

      setIsSubmitting(false);
    }

    operationRef.current = false;
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (operationRef.current) {
      return;
    }

    if (resetConfirmation !== RESET_CONFIRMATION_TEXT) {
      setFormError(`请输入完整确认文本“${RESET_CONFIRMATION_TEXT}”`);
      return;
    }

    operationRef.current = true;
    setIsSubmitting(true);
    setFormError("");
    const result = await accessController.resetEncryptedLedger();

    if (mountedRef.current) {
      if (result.ok) {
        setPassphrase("");
        setConfirmation("");
        setResetConfirmation("");
        setShowReset(false);
        setAccessState({ status: "setup-required" });
      } else {
        setFormError("清空本地加密账本失败，原数据未被替换");
      }

      setIsSubmitting(false);
    }

    operationRef.current = false;
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

    operationRef.current = true;
    setIsSubmitting(true);
    setFormError("");
    const result = await fileAccessController.create(passphrase);
    setPassphrase("");
    setConfirmation("");

    if (mountedRef.current) {
      if (result.ok) {
        setAccessState({ status: "unlocked", session: result.session });
      } else if (
        result.code === LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED
      ) {
        setAccessPath("choice");
      } else {
        setFormError(getFileAccessErrorMessage(result.code));
      }
      setIsSubmitting(false);
    }
    operationRef.current = false;
  }

  async function selectFileToOpen() {
    if (operationRef.current) {
      return;
    }
    operationRef.current = true;
    setIsSubmitting(true);
    setFormError("");
    const result = await fileAccessController.selectExisting();

    if (mountedRef.current) {
      if (result.ok) {
        setAccessPath("file-open-unlock");
      } else if (
        result.code !== LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED
      ) {
        setFormError(getFileAccessErrorMessage(result.code));
      }
      setIsSubmitting(false);
    }
    operationRef.current = false;
  }

  async function submitFileUnlock(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (operationRef.current) {
      return;
    }

    operationRef.current = true;
    setIsSubmitting(true);
    setFormError("");
    const result =
      await fileAccessController.unlockSelected(passphrase);
    setPassphrase("");

    if (mountedRef.current) {
      if (result.ok) {
        setAccessState({ status: "unlocked", session: result.session });
      } else {
        setFormError(getFileAccessErrorMessage(result.code));
      }
      setIsSubmitting(false);
    }
    operationRef.current = false;
  }

  function returnToChoice() {
    fileAccessController.cancelPendingSelection();
    setPassphrase("");
    setConfirmation("");
    setFormError("");
    setAccessPath("choice");
  }

  if (accessState.status === "unlocked") {
    return (
      <DashboardShell
        capabilities={accessState.session.capabilities}
        repository={accessState.session.repository}
        storageKind={accessState.session.storageKind}
      />
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

  if (accessPath === "choice") {
    return (
      <AccessPanel
        description="IndexedDB 仍是现有正式浏览器账本；C 文件入口用于本批实验验证，不代表已经完成全局迁移。"
        title="选择账本存储"
      >
        <div className="grid gap-3">
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            onClick={() => {
              setFormError("");
              setAccessPath("indexeddb");
            }}
            type="button"
          >
            继续浏览器账本
          </button>
          <button
            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
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

  if (accessState.status === "error") {
    const resetAllowed =
      accessState.code === LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT ||
      accessState.code === LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE;

    return (
      <AccessPanel
        description={getAccessErrorMessage(accessState.code)}
        title="无法打开本地账本"
      >
        <div className="space-y-3">
          {accessState.code === LEDGER_ACCESS_ERROR_CODES.READ_FAILED ? (
            <button
              className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
              onClick={() => void inspect()}
              type="button"
            >
              重新检查
            </button>
          ) : null}
          {resetAllowed ? (
            <ResetLedgerForm
              confirmation={resetConfirmation}
              error={formError}
              isSubmitting={isSubmitting}
              onCancel={() => {
                setShowReset(false);
                setResetConfirmation("");
                setFormError("");
              }}
              onChange={setResetConfirmation}
              onOpen={() => {
                setShowReset(true);
                setFormError("");
              }}
              onSubmit={submitReset}
              visible={showReset}
            />
          ) : null}
        </div>
      </AccessPanel>
    );
  }

  if (accessState.status === "setup-required") {
    return (
      <AccessPanel
        description="密码只用于本机派生加密密钥。忘记密码后无法恢复本地密文，请保留明文备份。"
        title="创建本地加密账本"
      >
        <form className="space-y-4" onSubmit={submitSetup}>
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label="设置密码"
            onChange={setPassphrase}
            value={passphrase}
          />
          <PasswordField
            autoComplete="new-password"
            disabled={isSubmitting}
            label="再次输入密码"
            onChange={setConfirmation}
            value={confirmation}
          />
          <FormError message={formError} />
          <button
            className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "正在创建…" : "创建加密账本"}
          </button>
        </form>
      </AccessPanel>
    );
  }

  return (
    <AccessPanel
      description="刷新或关闭页面后需要重新输入密码。密码不会保存到浏览器。"
      title="解锁本地账本"
    >
      <form className="space-y-4" onSubmit={submitUnlock}>
        {accessState.notice ? (
          <p
            aria-live="polite"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            role="status"
          >
            {accessState.notice}
          </p>
        ) : null}
        <PasswordField
          autoComplete="current-password"
          disabled={isSubmitting}
          label="账本密码"
          onChange={setPassphrase}
          value={passphrase}
        />
        <FormError message={showReset ? "" : formError} />
        <button
          className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "正在解锁…" : "解锁账本"}
        </button>
      </form>
      <div className="mt-5 border-t border-slate-200 pt-4">
        <ResetLedgerForm
          confirmation={resetConfirmation}
          error={showReset ? formError : ""}
          isSubmitting={isSubmitting}
          onCancel={() => {
            setShowReset(false);
            setResetConfirmation("");
            setFormError("");
          }}
          onChange={setResetConfirmation}
          onOpen={() => {
            setShowReset(true);
            setFormError("");
          }}
          onSubmit={submitReset}
          visible={showReset}
        />
      </div>
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

function ResetLedgerForm({
  visible,
  confirmation,
  error,
  isSubmitting,
  onOpen,
  onCancel,
  onChange,
  onSubmit,
}: Readonly<{
  visible: boolean;
  confirmation: string;
  error: string;
  isSubmitting: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  if (!visible) {
    return (
      <button
        className="text-sm font-medium text-red-700 hover:text-red-900"
        onClick={onOpen}
        type="button"
      >
        忘记密码？清空本地加密账本并重新开始
      </button>
    );
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <p className="text-sm leading-6 text-red-800">
        此操作不可撤销。请输入“{RESET_CONFIRMATION_TEXT}”确认。
      </p>
      <input
        aria-label="清空确认文本"
        className="w-full rounded-md border border-red-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-100 disabled:bg-slate-100"
        disabled={isSubmitting}
        onChange={(event) => onChange(event.target.value)}
        value={confirmation}
      />
      <FormError message={error} />
      <div className="flex gap-3">
        <button
          className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "正在清空…" : "确认清空"}
        </button>
        <button
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          disabled={isSubmitting}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
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
    case LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE:
      return "所选文件不是合法 C，或文件结构已经损坏；未写入任何内容。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED:
      return "密码错误或文件认证失败；未写入所选 C。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION:
      return "请重新选择要打开的 C。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED:
      return "C 创建、关闭或复读验证失败，不能进入账本。";
    case LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED:
      return "";
    default:
      return "C 文件操作失败，未报告保存成功。";
  }
}
