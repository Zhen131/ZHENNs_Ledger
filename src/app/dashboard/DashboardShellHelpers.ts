import type { FileStatusTone, TranslationKey } from "@/ui";

export const FILE_SAVED_FEEDBACK_MS = 4_000;
type Translate = (key: TranslationKey) => string;

export function shortLedgerId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function getWorkspaceFileStatus({
  hydrationStatus,
  persistenceStatus,
  hasError,
  isDirty,
  isReadOnly,
  repositorySwitchBlocked,
  t,
}: Readonly<{
  hydrationStatus: "loading" | "ready" | "error";
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  hasError: boolean;
  isDirty: boolean;
  isReadOnly: boolean;
  repositorySwitchBlocked: boolean;
  t: Translate;
}>): { label: string; tone: FileStatusTone } {
  if (repositorySwitchBlocked) {
    return { label: t("dashboard.fileStatus.switchBlocked"), tone: "error" };
  }
  if (hydrationStatus === "loading") {
    return { label: t("dashboard.fileStatus.loading"), tone: "idle" };
  }
  if (hydrationStatus === "error" || hasError) {
    return { label: t("dashboard.fileStatus.needsAttention"), tone: "error" };
  }
  if (isReadOnly) {
    return { label: t("dashboard.fileStatus.readOnly"), tone: "read-only" };
  }
  if (persistenceStatus === "saving") {
    return { label: t("dashboard.fileStatus.saving"), tone: "saving" };
  }
  if (persistenceStatus === "saved") {
    return { label: t("dashboard.fileStatus.saved"), tone: "saved" };
  }
  if (isDirty) {
    return { label: t("dashboard.fileStatus.dirty"), tone: "warning" };
  }
  return { label: t("dashboard.fileStatus.connected"), tone: "idle" };
}
