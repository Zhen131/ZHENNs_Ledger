/**
 * 这个文件放交易页用的几个类型。
 * 交易页的逻辑在同目录 `TransactionsWorkspace.tsx` 和 `transactionsWorkspace*.ts`。
 * 没有特别的决定。
 */
import { type LedgerActivityItem } from "@/features/activity";
import type { projectLedgerCashMutation } from "@/features/cash";

/** 时间筛选：全部、今天、近 7 天、近一年。 */
export type TimeFilter = "all" | "today" | "7d" | "1y";
/** 流水里一条的种类：买卖或现金记录。 */
export type ActivityKind = LedgerActivityItem["kind"];

/**
 * 正在删的那一条：要么在可撤回的倒数里，要么删了在等存盘。
 * 倒数时记着截止时刻，等存盘时记着要等到第几次改动存好。
 */
export type PendingDelete =
  | {
      itemId: string;
      itemKind: ActivityKind;
      phase: "countdown";
      deadline: number;
    }
  | {
      itemId: string;
      itemKind: ActivityKind;
      phase: "persisting";
      expectedMutationVersion: number;
    };

/**
 * 等用户确认「删了会让现金变负」的那一条。
 * 记下当时的现金变化和账本状态；确认时账本变过就作废。
 */
export type PendingNegativeDelete = Readonly<{
  itemId: string;
  itemKind: ActivityKind;
  projection: ReturnType<typeof projectLedgerCashMutation>;
  expectedLedgerEpoch: number;
  expectedMutationVersion: number;
  expectedPersistedVersion: number;
  expectedTodayKey: string;
}>;

/** 一次「滚到某天」的请求：哪一天，第几次请求。 */
export type ActivityLocationRequest = Readonly<{
  date: string;
  requestId: number;
}>;
