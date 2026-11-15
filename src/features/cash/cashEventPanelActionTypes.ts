/**
 * 这个文件只放现金面板动作要用的类型，不放会运行的代码。
 * 动作本身在 `cashEventPanelActions.ts`；那个文件行数到顶，类型挪到这里。
 * 不显然的决定：只挪纯类型，内容逐字不变；2026-11-15 定（W26 04B 追加更正第 1 条）。
 */
import type { LedgerClock } from "@/core/shared";
import type { Dispatch, SetStateAction } from "react";
import type { ArmedDelete, PendingRisk } from "./cashEventPanelHelpers";
import type { CashEventType } from "@/core/models";

/** 换账本时清空现金表单要用的那些设置函数和时钟。 */
export type CashFormEpochResetEffectDeps = {
  clock: LedgerClock;
  setAmountOrTarget: Dispatch<SetStateAction<string>>;
  setArmedDelete: Dispatch<SetStateAction<ArmedDelete | null>>;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setNote: Dispatch<SetStateAction<string>>;
  setOccurredAt: Dispatch<SetStateAction<string>>;
  setOccurredTime: Dispatch<SetStateAction<string>>;
  setOccurredTimeZone: Dispatch<SetStateAction<string>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingOperation: Dispatch<SetStateAction<"add" | "delete" | null>>;
  setPendingRisk: Dispatch<SetStateAction<PendingRisk | null>>;
  setType: Dispatch<SetStateAction<CashEventType>>;
};
