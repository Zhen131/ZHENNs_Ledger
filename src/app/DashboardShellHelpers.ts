import type { FileStatusTone } from "@/ui";

export const LEGACY_CLEAR_LEDGER_CONFIRMATION_TEXT = "清空本地账本";
export const FILE_SAVED_FEEDBACK_MS = 4_000;

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
}: Readonly<{
  hydrationStatus: "loading" | "ready" | "error";
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  hasError: boolean;
  isDirty: boolean;
  isReadOnly: boolean;
  repositorySwitchBlocked: boolean;
}>): { label: string; tone: FileStatusTone } {
  if (repositorySwitchBlocked) {
    return { label: "切换已阻止", tone: "error" };
  }
  if (hydrationStatus === "loading") {
    return { label: "正在读取账本", tone: "idle" };
  }
  if (hydrationStatus === "error" || hasError) {
    return { label: "文件需要处理", tone: "error" };
  }
  if (isReadOnly) {
    return { label: "只读账本", tone: "read-only" };
  }
  if (persistenceStatus === "saving") {
    return { label: "正在保存到加密文件", tone: "saving" };
  }
  if (persistenceStatus === "saved") {
    return { label: "已保存到加密文件", tone: "saved" };
  }
  if (isDirty) {
    return { label: "有修改等待保存", tone: "warning" };
  }
  return { label: "加密文件已连接", tone: "idle" };
}
