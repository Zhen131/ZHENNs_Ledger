# calculators

This directory contains pure ledger calculations.

`positionCalculator` derives quantity, cost basis, weighted average cost, and realized P&L from `Trade[]`. Optional `PriceSnapshot[]` values add latest price, market value, and unrealized P&L. Price-derived fields remain absent when no matching asset and currency snapshot exists.

Calculators accept structured data and return calculation results. They do not read page state, persist data, or format user-facing copy.
