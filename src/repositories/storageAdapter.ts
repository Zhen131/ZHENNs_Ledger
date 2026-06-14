import type { LedgerData } from "@/models/ledger";

export interface StorageAdapter {
  read(): Promise<LedgerData>;
  write(data: LedgerData): Promise<void>;
  remove(): Promise<void>;
}
