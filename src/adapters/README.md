# adapters

This directory isolates external storage details.

`IndexedDbStorageAdapter` uses native IndexedDB, stores one whole-blob `StoredLedgerEnvelopeV2` under a fixed key, supports read, write, and clear, and returns `null` for an empty store. IndexedDB transaction failure preserves the previous successful record.

Adapters do not parse `LedgerData`, encrypt payloads, or calculate business data. They must not leak IndexedDB APIs into UI, services, reducers, or calculators. `read()` returns `unknown | null`; the access layer and repository independently validate the encrypted envelope.
