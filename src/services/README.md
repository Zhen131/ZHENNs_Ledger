# services

This directory orchestrates business operations.

Current services include:

- `positionService`: reads ledger facts and asks calculators to derive positions.
- `tradeService`: validates a trade draft and creates a formal `Trade`.
- `tradeRemovalService`: validates the candidate full timeline before deletion.
- `priceSnapshotService`: validates a price draft and creates a formal `PriceSnapshot`.

Services control business-operation order. They do not directly operate IndexedDB, duplicate calculator formulas, or mutate caller-owned `LedgerData`.
