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

Adapters do not parse `LedgerData`, encrypt payloads, or calculate business
data. They must not leak IndexedDB APIs into UI, services, reducers, or
calculators. The active connection adapter validates its exact three-field
record before returning it. The retired adapter returns `unknown | null`; V2
production code treats that value only as legacy presence, while negative tests
validate historical envelopes at their explicit boundary.
