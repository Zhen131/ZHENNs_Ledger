# repositories

This directory owns whole-ledger persistence boundaries.

`LedgerRepository` exposes whole-ledger load, save, and clear operations. `DefaultLedgerRepository` calls the encryption service, serializes JSON, and runs the full `LedgerData` runtime validator before save and after recovery. A `null` result means no stored record and is different from a deliberately saved empty ledger.

Repositories do not know IndexedDB database, store, or transaction details. Those details belong to adapters.
