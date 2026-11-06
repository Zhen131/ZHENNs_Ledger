/**
 * 这个文件放交易表单几处共用的类型。
 * 表单的值本身在 `tradeWorkspaceDraft.ts` 定义，这里只是起别名和加两个类型。
 * 没有特别的决定。
 */
import { type TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type { Trade } from "@/core/models";
import { type LedgerTimeSnapshot } from "@/core/shared";
import { type CashMutationProjection } from "@/features/cash";

/**
 * 等人确认的一笔买卖：存了以后余额会变负。
 * 还记着当时是哪本账本、第几版，版本一变确认就作废。
 */
export type PendingTradeRisk = Readonly<{
  trade: Trade;
  projection: CashMutationProjection;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  timeSnapshot: LedgerTimeSnapshot;
}>;

/** 交易表单的值，和记账页草稿是同一个形状。 */
export type TradeFormState = TradeWorkspaceDraft;

/** 错误提示能挂在哪一栏：表单的某一栏，或整个表单。 */
export type TradeFormField = keyof TradeFormState | "form";
