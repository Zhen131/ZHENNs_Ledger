# adapters

This directory isolates external storage details for legacy IndexedDB, C connection records, and user-selected file handles.

Adapters do not parse `LedgerData`, encrypt payloads, or calculate business data. They must not leak storage APIs into UI, services, reducers, or calculators. Untrusted reads remain `unknown` until validated by the owning boundary.
