/**
 * 这个文件管页面顶上那个小小的文件状态提示。
 * 状态文字由调用方给，这里只管图标、颜色和读屏怎么播。
 * 不显然的决定：出错时读屏马上插播；别的状态等空了再播。
 */
import { LedgerIcon } from "./LedgerIcon";

/** 文件状态的六种样子：空闲，正在存，存好，提醒，出错，只读。 */
export type FileStatusTone =
  | "idle"
  | "saving"
  | "saved"
  | "warning"
  | "error"
  | "read-only";

const TONE_CLASS: Record<FileStatusTone, string> = {
  idle: "text-[var(--ledger-muted)]",
  saving: "text-[var(--ledger-warning)]",
  saved: "text-[var(--ledger-success)]",
  warning: "text-[var(--ledger-warning)]",
  error: "text-[var(--ledger-danger)]",
  "read-only": "text-[var(--ledger-warning)]",
};

/**
 * 这个组件画一行带图标的文件状态，比如「已保存」。
 * 存好了配对勾，空闲配文件图标，别的都配感叹号。
 * 用户只看，不能点。
 */
export function FileStatusIndicator({
  label,
  tone = "idle",
}: Readonly<{
  label: string;
  tone?: FileStatusTone;
}>) {
  const icon = tone === "saved" ? "check" : tone === "idle" ? "file" : "warning";
  return (
    <span
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs font-medium ${TONE_CLASS[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <LedgerIcon className="h-3.5 w-3.5 shrink-0" name={icon} />
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}
