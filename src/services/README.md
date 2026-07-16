# services

业务流程编排放在这里。

当前已实现：

- `positionService`：读取当前账本并调用 Calculator 派生持仓。
- `tradeService`：校验交易草稿并生成正式 `Trade`。
- `tradeRemovalService`：删除前验证候选账本时间线。
- `priceSnapshotService`：校验价格草稿并生成正式 `PriceSnapshot`。

Service 负责业务动作顺序，不直接操作 IndexedDB，不复制 Calculator 公式，也不
修改调用方传入的 `LedgerData`。
