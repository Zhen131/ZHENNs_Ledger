# Golden fixture index

Golden fixtures are immutable after their first commit. Every fixture contains fictional data only.

| File | Version combination | Added | Coverage | Passphrase |
| --- | --- | --- | --- | --- |
| `golden-backup-format-v3-ledger-schema-v3.json` | backup format 3; ledger schema 3 | 2026-08-28 | Legacy schema 3 backup with 3 assets, 300 fictional buy trades, one manual price, and one fee rule. Retained as an unsupported-version rejection input while the product remains in Alpha. | — |
| `golden-backup-format-v3-ledger-schema-v4.json` | backup format 3; ledger schema 4 | 2026-08-28 | Minimal schema 4 envelope with one asset, no trades, and one cash event, asset transfer, manual price, and fee rule. | — |
| `golden-backup-format-v3-ledger-schema-v4-rich.json` | backup format 3; ledger schema 4 | 2026-08-31 | Rich schema 4 relationships: two buy cost lots, one sale consuming both lots, one asset retained across exchange and cold-wallet locations, one internal transfer with a network fee, one cash event, and one manual price. | — |
| `golden-ledger-file-format-v2-crypto-v1-ledger-schema-v4.lftl` | file format 2; crypto 1; ledger schema 4 | 2026-08-31 | Frozen evidence retained for a future migration project. It contains adjacent `current` and `previous` generations, is currently referenced only by the product-path rejection test, and will regain decoding coverage when migration is implemented. | `W15-Golden-V2-Fictional-Ledger` |
| `golden-ledger-file-format-v3-crypto-v1-ledger-schema-v4.lftl` | file format 3; crypto 1; ledger schema 4; backup format 3 | 2026-09-01 | Current chunked C-file format created through the real repository create-and-save path. It contains a rich fictional current generation and an empty previous generation. | `W15-Golden-V3-Fictional-Ledger` |
| `golden-backup-format-v3-ledger-schema-v5-time-zone.json` | backup format 3; ledger schema 5 | 2026-09-06 | Fictional schema 5 envelope covering all four fact types. Trade, asset transfer, and price snapshot record IANA time zones; the cash event omits the optional field. | — |
| `golden-ledger-file-format-v3-crypto-v1-ledger-schema-v5-time-zone.lftl` | file format 3; crypto 1; ledger schema 5; backup format 3 | 2026-09-06 | Fictional chunked C-file generated through the real repository create path. It covers all four fact types, with the same optional time-zone presence and absence as the V5 B fixture. | `W16-Golden-V5-Fictional-Ledger` |

## Known gaps

Golden fixtures for `backupFormatVersion` 1 and 2 do not exist. This is intentional during Alpha, when lower backup versions are rejected without migration. Add immutable samples before implementing a Beta migration path for either version.
