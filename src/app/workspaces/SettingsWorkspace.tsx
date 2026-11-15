/**
 * 这个文件管设置页：行情、手续费规则、清空账本三个分页。
 * 行情和手续费面板由外层传进来；清空确认那一步在 `settingsWorkspaceActions.ts`。
 * 不显然的决定：清空口令跟着界面语言走，只收当前语言那句。
 * 2026-09-08 定（W16 04A 修订 C 第二节 D-16a）。
 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  SUCCESS_FEEDBACK_MS,
  SurfaceCard,
  translateDefault,
  useLanguage,
} from "@/ui";
import type { HydrationStatus } from "@/app/persistence";
import type { PersistenceOperation } from "@/app/persistence";
import { doConfirmClear } from "./settingsWorkspaceActions";
import { SettingsWorkspaceDangerPanel } from "./SettingsWorkspaceDangerPanel";
import { SettingsWorkspaceTabBar } from "./SettingsWorkspaceTabBar";

/**
 * 清空账本要敲的那句口令的中文版，也就是「清空账本」。
 * 页面自己按当前语言比对（英文是 clear ledger）。
 * 这个常量给想要中文那句的地方用，现在只有测试在用。
 * 它从翻译表里取，不另抄一份，两边就不会对不上。
 */
export const PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT = translateDefault(
  "settings.clear.confirmation.phrase",
);

type SettingsTab = "market" | "fees" | "danger";

/**
 * 这个组件画设置页，上面一排分页：行情、手续费、危险操作。
 * 危险操作里能清空账本：先展开，再敲口令，再点确认。
 * 页面也能在这里切换界面语言。
 * 不许清，只读，正在换账本或清空导入时，点不了并说明原因。
 */
export function SettingsWorkspace({
  active,
  ledgerEpoch,
  marketPanel,
  feePanel,
  hydrationStatus,
  persistenceOperation,
  repositorySwitchBlocked,
  isReadOnly,
  canClearReadyLedger,
  onClear,
}: Readonly<{
  active: boolean;
  ledgerEpoch: number;
  marketPanel: ReactNode;
  feePanel: ReactNode;
  hydrationStatus: HydrationStatus;
  persistenceOperation: PersistenceOperation;
  repositorySwitchBlocked: boolean;
  isReadOnly: boolean;
  canClearReadyLedger: boolean;
  onClear: () => Promise<boolean>;
}>) {
  const { language, setLanguage, t } = useLanguage();
  const clearConfirmationPhrase = t("settings.clear.confirmation.phrase");
  const [tab, setTab] = useState<SettingsTab>("market");
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [confirmationValue, setConfirmationValue] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dangerTriggerRef = useRef<HTMLButtonElement>(null);
  const dangerConfirmationRef = useRef<HTMLDivElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const confirmClearRef = useRef<HTMLButtonElement>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const restoreFocusFrameRef = useRef<number | null>(null);

  const canClear = hydrationStatus === "ready" && canClearReadyLedger;
  const clearDisabled =
    persistenceOperation !== "idle" ||
    repositorySwitchBlocked ||
    isReadOnly;

  const closeDanger = useCallback(
    ({ restoreFocus = false }: { restoreFocus?: boolean } = {}) => {
      if (persistenceOperation !== "idle") return;
      setDangerExpanded(false);
      setConfirmationValue("");
      setError("");
      if (restoreFocus) {
        if (restoreFocusFrameRef.current !== null) {
          cancelAnimationFrame(restoreFocusFrameRef.current);
        }
        restoreFocusFrameRef.current = requestAnimationFrame(() => {
          restoreFocusFrameRef.current = null;
          dangerTriggerRef.current?.focus();
        });
      }
    },
    [persistenceOperation],
  );

  useEffect(
    () => () => {
      if (restoreFocusFrameRef.current !== null) {
        cancelAnimationFrame(restoreFocusFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setTab("market");
    setDangerExpanded(false);
    setConfirmationValue("");
    setError("");
  }, [ledgerEpoch]);

  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(""), SUCCESS_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [success]);

  useEffect(() => {
    if (!dangerExpanded) return;
    const input = confirmationInputRef.current;
    if (
      input &&
      !input.disabled &&
      dangerConfirmationRef.current?.contains(input)
    ) {
      input.focus();
    }
  }, [dangerExpanded]);

  useEffect(() => {
    if (!dangerExpanded) return;
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDanger({ restoreFocus: true });
      }
    };
    document.addEventListener("keydown", closeFromEscape);
    return () => document.removeEventListener("keydown", closeFromEscape);
  }, [closeDanger, dangerExpanded]);

  async function confirmClear() {
    return doConfirmClear(
      {
        clearConfirmationPhrase,
        clearDisabled,
        canClear,
        confirmationValue,
        onClear,
        setConfirmationValue,
        setDangerExpanded,
        setError,
        setSuccess,
        t,
      },
    );
  }

  const clearDisabledReason = !canClear
    ? t("settings.clear.disabled.notAllowed")
    : isReadOnly
      ? t("settings.clear.disabled.readOnly")
      : repositorySwitchBlocked
        ? t("settings.clear.disabled.switching")
        : persistenceOperation !== "idle"
          ? t("settings.clear.disabled.operating")
          : "";

  return (
    <section
      aria-label={t("settings.workspace.ariaLabel")}
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="settings"
    >
      <SurfaceCard className="p-5">
        <h2 className="text-lg font-semibold">{t("settings.heading")}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          {t("settings.description")}
        </p>
      </SurfaceCard>

      <SurfaceCard className="p-5">
        <h2 className="text-lg font-semibold">
          {t("settings.language.heading")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          {t("settings.language.description")}
        </p>
        <label className="mt-4 grid max-w-sm gap-2 text-sm font-medium">
          {t("settings.language.label")}
          <select
            aria-label={t("settings.language.label")}
            className="rounded-lg border border-[var(--ledger-border)] bg-white px-3 py-2 text-[var(--ledger-ink)]"
            onChange={(event) =>
              setLanguage(event.target.value as typeof language)
            }
            value={language}
          >
            <option value="zh-CN">
              {t("settings.language.optionChinese")}
            </option>
            <option value="en">{t("settings.language.optionEnglish")}</option>
          </select>
        </label>
      </SurfaceCard>

      <SettingsWorkspaceTabBar
        closeDanger={closeDanger}
        setTab={setTab}
        t={t}
        tab={tab}
      />

      {tab === "market" ? (
        <SurfaceCard
          className="min-w-0 p-5"
          id="settings-panel-market"
          role="tabpanel"
        >
          {marketPanel}
        </SurfaceCard>
      ) : null}
      {tab === "fees" ? (
        <SurfaceCard
          className="min-w-0 p-5"
          id="settings-panel-fees"
          role="tabpanel"
        >
          {feePanel}
        </SurfaceCard>
      ) : null}
      {tab === "danger" ? (
        <SettingsWorkspaceDangerPanel
          cancelClearRef={cancelClearRef}
          clearConfirmationPhrase={clearConfirmationPhrase}
          clearDisabled={clearDisabled}
          clearDisabledReason={clearDisabledReason}
          canClear={canClear}
          closeDanger={closeDanger}
          confirmClear={confirmClear}
          confirmClearRef={confirmClearRef}
          confirmationInputRef={confirmationInputRef}
          confirmationValue={confirmationValue}
          dangerConfirmationRef={dangerConfirmationRef}
          dangerExpanded={dangerExpanded}
          dangerTriggerRef={dangerTriggerRef}
          error={error}
          persistenceOperation={persistenceOperation}
          setConfirmationValue={setConfirmationValue}
          setDangerExpanded={setDangerExpanded}
          setError={setError}
          setSuccess={setSuccess}
          t={t}
        />
      ) : null}

      {success ? (
        <p
          aria-live="polite"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 motion-safe:animate-[ledger-feedback-fade_4s_ease-in_forwards]"
        >
          {success}
        </p>
      ) : null}
    </section>
  );
}
