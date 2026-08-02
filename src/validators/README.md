# validators

This directory owns runtime trust boundaries. Inputs begin as `unknown`; structured data is returned only after validation succeeds.

Current validators cover trade drafts, price snapshots, strict ISO dates, resources, encrypted envelopes, and the complete `LedgerData` structure and trade timeline.

Validation failures return structured errors instead of using exceptions for normal control flow. Validators do not persist data, derive positions, or operate React and IndexedDB.
