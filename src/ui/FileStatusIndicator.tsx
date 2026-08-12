import { LedgerIcon } from "./LedgerIcon";

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
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${TONE_CLASS[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <LedgerIcon className="h-3.5 w-3.5 shrink-0" name={icon} />
      <span>{label}</span>
    </span>
  );
}
