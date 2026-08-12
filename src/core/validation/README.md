# validators

This directory owns runtime trust boundaries. Inputs begin as `unknown`; structured data is returned only after validation succeeds.

Current validators cover:

- `tradeValidator`: trade type, asset, decimals, amount tolerance, strict ISO dates, currency, and the complete holdings timeline.
- `priceSnapshotValidator`: asset, positive price, currency, provenance, and strict ISO dates.
- `ledgerDataValidator`: schema, collections, entity shapes, unique IDs and symbols, references, decimals, dates, and the full trade timeline.
- `isoDateValidator`: rejects non-ISO text and impossible dates that `Date.parse` would otherwise normalize.

Validation failures return structured errors instead of using exceptions for normal control flow. Validators do not persist data, derive positions, or operate React and IndexedDB. The calculator keeps oversell checks as a last defense, but those checks do not replace validation at input boundaries.
