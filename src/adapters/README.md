# adapters

This directory isolates external storage details.

`IndexedDbLedgerFileConnectionAdapter` is the active IndexedDB boundary. It
stores exactly one minimal connection record containing
`connectionFormatVersion`, the browser file `handle`, and `expectedFileId`.
The encrypted ledger, revisions, fee rules, passwords, and cryptographic keys
remain outside that database.

`IndexedDbStorageAdapter` is the retired whole-ledger adapter. It remains for
negative tests and read-only legacy-presence detection. The production
composition exposes only a null/non-null inspection result from its `read()`;
legacy decrypt, migration, write, clear, and conditional-delete operations are
not reachable through the V2 application controller.

Adapters do not parse `LedgerData`, encrypt payloads, or calculate business data. They must not leak IndexedDB APIs into UI, services, reducers, or calculators. `read()` returns `unknown | null`; the access layer and repository independently validate the encrypted envelope.
