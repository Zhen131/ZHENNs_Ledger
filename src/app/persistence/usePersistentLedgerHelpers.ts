/**
 * 这个文件放账本存取 hook 用的几个小判断和小动作。
 * 存盘排队、开机读账本这些大流程在同目录别的文件里。
 * 不显然的决定：账本里有未来日期的记录时，只许删它们。
 * 因为新记录不许晚于今天，2026-08-19 定（W14 01B 第 3.5 节）。
 */
import type { LedgerData } from "@/core/models";
import {
  type LedgerSession,
  type LedgerRepository,
} from "@/platform/persistence";
import { LedgerFileRepository } from "@/platform/files";
import { type LedgerAction } from "@/core/state";
import { isLedgerFactInFuture } from "@/core/shared";
import type { PersistenceVersionState } from "./usePersistentLedgerTypes";

/** 一开始的存盘状态：改了 0 次，存了 0 次，什么都没动。 */
export const INITIAL_PERSISTENCE_VERSION_STATE: PersistenceVersionState = {
  mutationVersion: 0,
  persistedVersion: 0,
  persistenceStatus: "idle",
};
/**
 * 这个函数调仓库去存整本账，同步抛的错也变成失败的 Promise。
 * 这样调用方只用处理一种失败。
 */
export function invokeRepositorySave(
  repository: LedgerRepository,
  ledgerData: LedgerData,
): Promise<void> {
  try {
    return repository.save(ledgerData);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * 这个函数调仓库去存「改了一笔之后」的账。
 * 仓库会按那一笔只写变了的部分；不会的就存整本。
 * 同步抛的错也变成失败的 Promise。
 */
export function invokeRepositoryActionSave(
  repository: LedgerRepository,
  action: LedgerAction,
  ledgerData: LedgerData,
): Promise<void> {
  try {
    return repository.saveAfterAction
      ? repository.saveAfterAction(action, ledgerData)
      : repository.save(ledgerData);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * 这个函数回答：两处存盘目标是不是同一个？
 * 有会话就比会话，没有会话才比仓库。
 * 举例：同一个会话、仓库对象不同 → 答是。不会出错。
 */
export function isSamePersistenceTarget(
  firstRepository: LedgerRepository | null,
  firstSession: LedgerSession | undefined,
  secondRepository: LedgerRepository | null,
  secondSession: LedgerSession | undefined,
): boolean {
  if (firstSession || secondSession) {
    return firstSession === secondSession;
  }
  return firstRepository === secondRepository;
}

/**
 * 这个函数回答：这次是不是存在账本文件里？
 * 会话说是账本文件，或者仓库本身就是账本文件仓库，都算。
 * 不会出错。
 */
export function isLedgerFileBackedRepository(
  repository: LedgerRepository,
  session: LedgerSession | undefined,
): boolean {
  return (
    session?.storageKind === "ledger-file" ||
    repository instanceof LedgerFileRepository
  );
}

/**
 * 这个函数回答：账本里有没有日期在今天之后的记录？
 * 买卖、入金出金、转账、价格都查。
 * 举例：今天 2026-11-06，有一笔 2026-11-07 的买入 → 答有。
 *
 * 为什么要查：新记录不许晚于今天。
 * 2026-08-19 定（W14 01B 第 3.5 节）。
 * 不会出错。
 */
export function hasFutureFacts(ledgerData: LedgerData, todayKey: string): boolean {
  return (
    ledgerData.trades.some((trade) =>
      isLedgerFactInFuture(trade.occurredAt, todayKey),
    ) ||
    ledgerData.cashEvents.some((cashEvent) =>
      isLedgerFactInFuture(cashEvent.occurredAt, todayKey),
    ) ||
    ledgerData.assetTransfers.some((assetTransfer) =>
      isLedgerFactInFuture(assetTransfer.occurredAt, todayKey),
    ) ||
    ledgerData.priceSnapshots.some((snapshot) =>
      isLedgerFactInFuture(snapshot.recordedAt, todayKey),
    )
  );
}

/**
 * 这个函数回答：这一步改动算不算「删掉未来记录」的修正？
 * 只有删掉一条未来记录，或者「删掉全部未来记录」，才算。
 * 举例：今天 2026-11-06，删 2026-11-07 那笔买入 → 答算；删昨天那笔 → 答不算。
 * 不会出错。
 */
export function isCorrectionAction(
  action: LedgerAction,
  ledgerData: LedgerData,
  todayKey: string,
): boolean {
  if (action.type === "futureFacts/deleteAll") {
    return action.todayKey === todayKey;
  }

  if (action.type === "trade/delete") {
    const trade = ledgerData.trades.find((item) => item.id === action.tradeId);
    return trade !== undefined && isLedgerFactInFuture(trade.occurredAt, todayKey);
  }

  if (action.type === "cashEvent/delete") {
    const cashEvent = ledgerData.cashEvents.find(
      (item) => item.id === action.cashEventId,
    );
    return (
      cashEvent !== undefined &&
      isLedgerFactInFuture(cashEvent.occurredAt, todayKey)
    );
  }

  if (action.type === "assetTransfer/delete") {
    const assetTransfer = ledgerData.assetTransfers.find(
      (item) => item.id === action.assetTransferId,
    );
    return (
      assetTransfer !== undefined &&
      isLedgerFactInFuture(assetTransfer.occurredAt, todayKey)
    );
  }

  if (action.type === "priceSnapshot/delete") {
    const snapshot = ledgerData.priceSnapshots.find(
      (item) => item.id === action.priceSnapshotId,
    );
    return (
      snapshot !== undefined &&
      isLedgerFactInFuture(snapshot.recordedAt, todayKey)
    );
  }

  return false;
}
