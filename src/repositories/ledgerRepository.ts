import type { LedgerData, PriceSnapshot, Trade } from "@/models/ledger";

export interface LedgerRepository {
  getLedgerData(): Promise<LedgerData>;
  saveTrade(trade: Trade): Promise<void>;
  listTrades(): Promise<Trade[]>;
  savePriceSnapshot(snapshot: PriceSnapshot): Promise<void>;
  listPriceSnapshots(): Promise<PriceSnapshot[]>;
}
