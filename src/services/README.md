# services

This directory orchestrates business operations, including trade creation and removal, price creation, holdings derivation, market refresh, price selection, and chart derivation.

Services control business-operation order. They do not directly operate IndexedDB, duplicate calculator formulas, or mutate caller-owned `LedgerData`.
