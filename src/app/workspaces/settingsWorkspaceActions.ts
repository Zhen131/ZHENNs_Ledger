/**
 * 这个文件管设置页「清空账本」按下确认之后那一步。
 * 清空本身交给账本存取 hook 去做，这里只核对口令、显示结果。
 * 不显然的决定：只认当前界面语言的那句口令。
 * 2026-09-08 定（W16 04A 修订 C 第二节 D-16a）。
 */
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { Translate } from "@/ui";

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
  t: Translate;
};

/**
 * 这个函数在用户敲完口令、点确认后决定清不清。
 * 口令对上了才去清，清完收起危险区、显示成功。
 * 举例：中文界面敲了英文那句 → 不清，提示要敲的那句中文。
 * 清空失败时显示失败提示，不抛错。
 */
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
    t,
  } = deps;
    if (!clearMode || clearDisabled) return;
    // 为什么只认一种：另一种语言的口令和敲错字一样算错。
    // 界面显示哪种口令就只收哪种，不许两种都收。
    // 2026-09-08 定（W16 04A 修订 C 第二节 D-16a、D-16c）。
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
    setSuccess(t("settings.clear.success.file"));
}
