import { type LedgerActivityItem } from "@/features/activity";
import type { projectLedgerCashMutation } from "@/features/cash";

export type TimeFilter = "all" | "today" | "7d" | "1y";
export type ActivityKind = LedgerActivityItem["kind"];

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

export type PendingNegativeDelete = Readonly<{
  itemId: string;
  itemKind: ActivityKind;
  projection: ReturnType<typeof projectLedgerCashMutation>;
  expectedLedgerEpoch: number;
  expectedMutationVersion: number;
  expectedPersistedVersion: number;
  expectedTodayKey: string;
}>;

export type ActivityLocationRequest = Readonly<{
  date: string;
  requestId: number;
}>;
