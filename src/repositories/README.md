# repositories

账本读写入口放在这里。

后续可以加入 `getLedgerData`、`listTrades`、`saveTrade`、`savePriceSnapshot`、
`clearAll`、`exportData`、`importData` 等账本动作。

Repository 懂账本业务动作，但底层存储 API 细节留在 adapters。
