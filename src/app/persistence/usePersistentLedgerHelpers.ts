import type { LedgerData } from "@/core/models";
import {
  type LedgerSession,
  type LedgerRepository,
} from "@/platform/persistence";
import { LedgerFileRepository } from "@/platform/files";
import { type LedgerAction } from "@/core/state";
import { isLedgerFactInFuture } from "@/core/shared";
import type { PersistenceVersionState } from "./usePersistentLedgerTypes";

export const INITIAL_PERSISTENCE_VERSION_STATE: PersistenceVersionState = {
  mutationVersion: 0,
  persistedVersion: 0,
  persistenceStatus: "idle",
};
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

export function isLedgerFileBackedRepository(
  repository: LedgerRepository,
  session: LedgerSession | undefined,
): boolean {
  return (
    session?.storageKind === "ledger-file" ||
    repository instanceof LedgerFileRepository
  );
}

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
