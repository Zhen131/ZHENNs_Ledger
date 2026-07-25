import { calculatePositions } from "../calculators/positionCalculator";
import type { LedgerData, Position } from "../models";
import { partitionLedgerFactsForToday } from "../policies/ledgerFactPolicy";
import { createSystemLedgerClock } from "../utils/ledgerDate";

export function getPositionsFromLedger(
  ledgerData: LedgerData,
  options: { todayKey?: string } = {},
): Position[] {
  const partition = partitionLedgerFactsForToday(
    ledgerData,
    options.todayKey ?? createSystemLedgerClock().todayKey(),
  );
  return calculatePositions(
    partition.activeTrades,
    partition.activePriceSnapshots,
  );
}
