import type { CashEvent, CashEventType } from "@/core/models";
import { type LedgerTimeSnapshot } from "@/core/shared";
import { type CashMutationProjection } from "./cashProjection";
import type { Translate } from "@/ui";

export type PendingRisk = Readonly<{
  operation: "add" | "delete";
  cashEvent: CashEvent;
  projection: CashMutationProjection;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  timeSnapshot: LedgerTimeSnapshot;
}>;

export type ArmedDelete = Readonly<{
  cashEventId: string;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
}>;


export function cashTypeLabel(type: CashEventType, t: Translate): string {
  return {
    deposit: t("cash.type.deposit"),
    withdrawal: t("cash.type.withdrawal"),
    "external-expense": t("cash.type.externalExpense"),
    "balance-adjustment": t("cash.type.balanceAdjustment"),
  }[type];
}
