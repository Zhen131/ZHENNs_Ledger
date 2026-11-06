/**
 * 这个文件放账本外框用的两个小帮手。
 * 一个缩短账本编号，一个算文件状态那行字。
 * 外框本身在同目录 `DashboardShell.tsx`。
 * 没有特别的决定。
 */
import type { FileStatusTone, Translate } from "@/ui";


/**
 * 这个函数把很长的账本编号缩短，好放进页面角落。
 * 12 个字符以内原样返回；更长的留头 6 个和尾 4 个，中间用省略号。
 * 举例：`abcdef1234567890` → 答 `abcdef…7890`。不会出错。
 */
export function shortLedgerId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/**
 * 这个函数回答：页面顶上的文件状态该写什么、用什么颜色？
 * 按先后看：换账本被挡住，正在读，出错，只读。
 * 再看：正在存，存好了，有没存的改动。
 * 举例：读好了、刚存完 → 答「已保存」，绿色。
 * 都不是就答「已连接」。不会出错。
 */
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
