import { calculatePositions } from "../calculators/positionCalculator";
import type { LedgerData, Position } from "../models";

export function getPositionsFromLedger(
  ledgerData: LedgerData,
): Position[] {
  return calculatePositions(
    ledgerData.trades,
    ledgerData.priceSnapshots,
  );
}
