import type { Position, PriceSnapshot, Trade } from "@/models/ledger";
import type { TradeDraft } from "@/models/tradeDraft";

export interface LedgerService {
  createTrade(draft: TradeDraft): Promise<Trade>;
  recordManualPrice(snapshot: PriceSnapshot): Promise<PriceSnapshot>;
  listRecentTrades(): Promise<Trade[]>;
  getPositions(): Promise<Position[]>;
}
