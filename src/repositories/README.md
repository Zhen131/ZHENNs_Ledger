# repositories

This directory owns whole-ledger persistence boundaries for legacy IndexedDB and selected `.lftl` files.

Repositories validate the complete ledger before save and after recovery, coordinate encryption and serialization, preserve the difference between no stored record and an intentionally empty ledger, and fail closed when storage state cannot be proven.

Database, transaction, and file-handle details belong to adapters.
