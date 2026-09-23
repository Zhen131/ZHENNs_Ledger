import type { Trade } from "@/core/models";
import { type ConfirmDeleteOutcome } from "@/ui";

type WorkspaceDeleteState = Readonly<{
  armedTradeId: string | null;
  pendingTradeId: string | null;
  pendingPhase: "countdown" | "persisting" | null;
  remainingMs: number;
}>;

export type TradeTableProps = Readonly<{
  trades: readonly Trade[];
  onDelete?: (
    tradeId: string,
  ) => ConfirmDeleteOutcome | Promise<ConfirmDeleteOutcome>;
  deleteDisabled?: boolean;
  todayKey?: string;
  variant?: "legacy" | "workspace";
  expandedTradeId?: string | null;
  onExpandedTradeIdChange?: (tradeId: string | null) => void;
  deleteState?: WorkspaceDeleteState;
  onArmDelete?: (tradeId: string) => void;
  onConfirmDelete?: (tradeId: string) => void;
  onCancelDelete?: () => void;
  onUndoDelete?: () => void;
  locateRequest?: Readonly<{ date: string; requestId: number }> | null;
  onLocateComplete?: (
    requestId: number,
    result: "found" | "missing",
  ) => void;
}>;
