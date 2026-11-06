/**
 * 这个文件放账本外框里几个按钮背后的动作。
 * 删一笔，删未来记录，清空，上锁，都在这里。
 * 外框本身在 `DashboardShell.tsx`；改账、存盘在 `app/persistence`。
 * 没有特别的决定。
 */
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";

import type { LedgerData } from "@/core/models";
import type {
  LedgerSessionFatalSignal,
  PersistentLedgerState,
} from "@/app/persistence";
import { validateTradeRemoval } from "@/features/trades";
import {
  SUCCESS_FEEDBACK_MS,
  type ConfirmDeleteOutcome,
  type Translate,
} from "@/ui";
import { validateAssetTransferRemoval } from "@/features/asset-transfers";
import type {
  LedgerRepository,
  LedgerSession,
  SessionQuiesceReason,
} from "@/platform/persistence";
import type { useLedgerWorkspaceSession } from "@/app/workspaces";

type RemoveValidatedTradeDeps = {
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  ledgerData: LedgerData;
  t: Translate;
};

/**
 * 这个函数回答：这笔买卖能不能删，删成没有？
 * 先查删了会不会让后面的卖出没东西可卖，会就拒绝并说明。
 * 举例：买 0.1 BTC 后卖 0.04 BTC，删那笔买入 → 答 `rejected`。
 * 能删就交给账本去删，答 `applied` 或别的结果。不抛错。
 */
export function doRemoveValidatedTrade(
  deps: RemoveValidatedTradeDeps,
  tradeId: string,
  setError: (message: string) => void,
): ConfirmDeleteOutcome {
  const {
    applyLedgerAction,
    ledgerData,
    t,
  } = deps;
    const result = validateTradeRemoval(tradeId, ledgerData);

    if (!result.ok) {
      setError(
        result.error.code === "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE"
          ? t("dashboard.delete.tradeHasDependents")
          : t("dashboard.delete.tradeMissing"),
      );
      return "rejected";
    }

    const outcome = applyLedgerAction({
      type: "trade/delete",
      tradeId: result.tradeId,
    });
    setError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
}

type HandleDeleteFuturePriceDeps = {
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  canCorrectFutureFacts: boolean;
  setFutureCorrectionError: Dispatch<SetStateAction<string>>;
  t: Translate;
};

/**
 * 这个函数删一条未来日期的价格，只在修正未来记录时可用。
 * 举例：今天 2026-11-06，删 2026-11-08 那条 BTC 价格 → 答 `applied`。
 * 不在修正状态时答 `rejected`。不抛错。
 */
export function doHandleDeleteFuturePrice(
  deps: HandleDeleteFuturePriceDeps,
  priceSnapshotId: string,
): ConfirmDeleteOutcome {
  const {
    applyLedgerAction,
    canCorrectFutureFacts,
    setFutureCorrectionError,
    t,
  } = deps;
    if (!canCorrectFutureFacts) {
      return "rejected";
    }
    const outcome = applyLedgerAction({
      type: "priceSnapshot/delete",
      priceSnapshotId,
    });
    setFutureCorrectionError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
}

type HandleDeleteFutureAssetTransferDeps = {
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  canCorrectFutureFacts: boolean;
  ledgerData: PersistentLedgerState["ledgerData"];
  setFutureCorrectionError: Dispatch<SetStateAction<string>>;
  t: Translate;
};

/**
 * 这个函数删一笔未来日期的资产转移，只在修正时可用。
 * 删前先查会不会弄坏后面的记录，会就拒绝并说原因。
 * 举例：今天 2026-11-06，删一笔 11-07 的转出、后面没依赖 → 答 `applied`。
 * 不抛错。
 */
export function doHandleDeleteFutureAssetTransfer(
  deps: HandleDeleteFutureAssetTransferDeps,
  assetTransferId: string,
): ConfirmDeleteOutcome {
  const {
    applyLedgerAction,
    canCorrectFutureFacts,
    ledgerData,
    setFutureCorrectionError,
    t,
  } = deps;
    if (!canCorrectFutureFacts) {
      return "rejected";
    }

    const result = validateAssetTransferRemoval(assetTransferId, ledgerData);
    if (!result.ok) {
      setFutureCorrectionError(result.error.message);
      return "rejected";
    }

    const outcome = applyLedgerAction({
      type: "assetTransfer/delete",
      assetTransferId: result.assetTransferId,
    });
    setFutureCorrectionError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
}

type HandleDeleteAllFutureFactsDeps = {
  applyLedgerAction: PersistentLedgerState["applyLedgerAction"];
  canCorrectFutureFacts: boolean;
  setFutureCorrectionError: Dispatch<SetStateAction<string>>;
  t: Translate;
  todayKey: PersistentLedgerState["todayKey"];
};

/**
 * 这个函数一次删掉全部未来日期的记录，只在修正时可用。
 * 举例：今天 2026-11-06，账里有 3 条 11-07 以后的记录 → 答 `applied`，3 条都删。
 * 不在修正状态时答 `rejected`。不抛错。
 */
export function doHandleDeleteAllFutureFacts(
  deps: HandleDeleteAllFutureFactsDeps,
): ConfirmDeleteOutcome {
  const {
    applyLedgerAction,
    canCorrectFutureFacts,
    setFutureCorrectionError,
    t,
    todayKey,
  } = deps;
    if (!canCorrectFutureFacts) {
      return "rejected";
    }
    const outcome = applyLedgerAction({
      type: "futureFacts/deleteAll",
      todayKey,
    });
    setFutureCorrectionError(
      outcome === "rejected" ? t("dashboard.delete.ledgerNotWritable") : "",
    );
    return outcome;
}

type HandleSettingsClearDeps = {
  clearConfirmationNonce: string;
  clearLedger: PersistentLedgerState["clearLedger"];
  currentRepositoryRef: RefObject<LedgerRepository>;
  hydrationStatus: PersistentLedgerState["hydrationStatus"];
  mountedRef: RefObject<boolean>;
  repository: LedgerRepository | undefined;
};

/**
 * 这个函数回答：设置页点了清空，清成没有？
 * 普通清空要账本读好；读坏后的清空要账本读失败。
 * 清完时如果已经换了账本或页面关了，也算没清成。
 * 举例：账本读好、口令对、清空成功 → 答 true。
 * 不抛错，失败答 false。
 */
export async function doHandleSettingsClear(
  deps: HandleSettingsClearDeps,
  mode: "normal" | "recovery",
): Promise<boolean> {
  const {
    clearConfirmationNonce,
    clearLedger,
    currentRepositoryRef,
    hydrationStatus,
    mountedRef,
    repository,
  } = deps;
    if (
      (mode === "normal" && hydrationStatus !== "ready") ||
      (mode === "recovery" && hydrationStatus !== "error")
    ) {
      return false;
    }
    const operationRepository = repository;
    const result = await clearLedger(clearConfirmationNonce);
    if (
      !mountedRef.current ||
      currentRepositoryRef.current !== operationRepository ||
      !result.ok
    ) {
      return false;
    }
    return true;
}

type RequestImmediateLockDeps = {
  drainForSessionQuiesce: PersistentLedgerState["drainForSessionQuiesce"];
  isDirty: PersistentLedgerState["isDirty"];
  lifecycleStatus: PersistentLedgerState["lifecycleStatus"];
  onFinalLock: ((drain: PersistentLedgerState["drainForSessionQuiesce"], reason: SessionQuiesceReason) => Promise<void>) | undefined;
  persistenceStatus: PersistentLedgerState["persistenceStatus"];
  session: LedgerSession | undefined;
  setLockConfirmationHasDrafts: Dispatch<SetStateAction<boolean>>;
  setShowLockConfirmation: Dispatch<SetStateAction<boolean>>;
  workspace: ReturnType<typeof useLedgerWorkspaceSession>;
  workspaceDraftsPresentRef: RefObject<boolean>;
};

/**
 * 这个函数处理「马上上锁」按钮。
 * 有没存的改动或草稿，正在存或存失败，就先弹确认框。
 * 都没有就清掉界面状态，交给外层去锁。
 * 账本不在用或没有上锁的入口时什么都不做。不抛错。
 */
export function doRequestImmediateLock(
  deps: RequestImmediateLockDeps,
) {
  const {
    drainForSessionQuiesce,
    isDirty,
    lifecycleStatus,
    onFinalLock,
    persistenceStatus,
    session,
    setLockConfirmationHasDrafts,
    setShowLockConfirmation,
    workspace,
    workspaceDraftsPresentRef,
  } = deps;
    if (!session || !onFinalLock || lifecycleStatus !== "active") {
      return;
    }
    const hasDrafts = workspaceDraftsPresentRef.current;
    if (
      isDirty ||
      hasDrafts ||
      persistenceStatus === "saving" ||
      persistenceStatus === "error"
    ) {
      setLockConfirmationHasDrafts(hasDrafts);
      setShowLockConfirmation(true);
      return;
    }
    workspace.resetSessionUi();
    void onFinalLock(
      drainForSessionQuiesce,
      "immediate-lock",
    );
}

type SavedFeedbackEffectDeps = {
  persistenceStatus: PersistentLedgerState["persistenceStatus"];
  setShowSavedFeedback: Dispatch<SetStateAction<boolean>>;
};

/**
 * 这个函数在存盘变成「存好了」时，显示一会儿提示。
 * 显示多久是 `SUCCESS_FEEDBACK_MS`（4 秒）。
 * 返回一个收拾的函数。不会出错。
 */
export function runSavedFeedbackEffect(
  deps: SavedFeedbackEffectDeps,
) {
  const {
    persistenceStatus,
    setShowSavedFeedback,
  } = deps;
    if (persistenceStatus !== "saved") {
      setShowSavedFeedback(false);
      return;
    }

    setShowSavedFeedback(true);
    const timeout = setTimeout(
      () => setShowSavedFeedback(false),
      SUCCESS_FEEDBACK_MS,
    );
    return () => clearTimeout(timeout);
}

type SessionFatalDeliveryEffectDeps = {
  deliveredFatalSignalRef: RefObject<LedgerSessionFatalSignal | null>;
  drainForSessionQuiesce: PersistentLedgerState["drainForSessionQuiesce"];
  onSessionFatal: ((drain: PersistentLedgerState["drainForSessionQuiesce"], signal: LedgerSessionFatalSignal) => Promise<void>) | undefined;
  session: LedgerSession | undefined;
  sessionFatalSignal: PersistentLedgerState["sessionFatalSignal"];
};

/**
 * 这个函数把「导入后没法恢复」的信号交给外层，只交一次。
 * 信号不是这个会话的、或已经交过，就不交。
 * 外层拿到后让会话停工。不抛错。
 */
export function runSessionFatalDeliveryEffect(
  deps: SessionFatalDeliveryEffectDeps,
) {
  const {
    deliveredFatalSignalRef,
    drainForSessionQuiesce,
    onSessionFatal,
    session,
    sessionFatalSignal,
  } = deps;
    if (
      !session ||
      !sessionFatalSignal ||
      !onSessionFatal ||
      sessionFatalSignal.sessionId !== session.sessionId ||
      sessionFatalSignal.sessionGeneration !== session.generation ||
      deliveredFatalSignalRef.current === sessionFatalSignal
    ) {
      return;
    }
    deliveredFatalSignalRef.current = sessionFatalSignal;
    void onSessionFatal(
      drainForSessionQuiesce,
      sessionFatalSignal,
    );
}
