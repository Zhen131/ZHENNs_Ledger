import { type TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type { Trade } from "@/core/models";
import { type LedgerTimeSnapshot } from "@/core/shared";
import { type CashMutationProjection } from "@/features/cash";

export type PendingTradeRisk = Readonly<{
  trade: Trade;
  projection: CashMutationProjection;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  timeSnapshot: LedgerTimeSnapshot;
}>;

export type TradeFormState = TradeWorkspaceDraft;

export type TradeFormField = keyof TradeFormState | "form";
