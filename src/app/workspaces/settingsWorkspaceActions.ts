import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";

type ConfirmClearDeps = {
  clearConfirmationPhrase: string;
  clearDisabled: boolean;
  clearMode: "normal" | "recovery" | null;
  confirmationValue: string;
  onClear: (mode: "normal" | "recovery") => Promise<boolean>;
  setConfirmationValue: Dispatch<SetStateAction<string>>;
  setDangerExpanded: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setSuccess: Dispatch<SetStateAction<string>>;
  storageKind: "indexeddb" | "ledger-file";
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doConfirmClear(
  deps: ConfirmClearDeps,
) {
  const {
    clearConfirmationPhrase,
    clearDisabled,
    clearMode,
    confirmationValue,
    onClear,
    setConfirmationValue,
    setDangerExpanded,
    setError,
    setSuccess,
    storageKind,
    t,
  } = deps;
    if (!clearMode || clearDisabled) return;
    // Only the phrase for the language on screen is accepted; the other
    // language's phrase is as wrong as any other typo (04A D-16a, D-16c).
    if (confirmationValue !== clearConfirmationPhrase) {
      setError(
        `${t("settings.clear.error.confirmationPrefix")}“${clearConfirmationPhrase}”`,
      );
      return;
    }
    setError("");
    setSuccess("");
    const cleared = await onClear(clearMode);
    if (!cleared) {
      setError(t("settings.clear.error.failed"));
      return;
    }
    setDangerExpanded(false);
    setConfirmationValue("");
    setSuccess(
      storageKind === "ledger-file"
        ? t("settings.clear.success.file")
        : t("settings.clear.success.browser"),
    );
}
