# validators

运行时信任边界放在这里。入口使用 `unknown`，成功后才返回可进入 Service、
Reducer 或 Repository 的结构化数据。

当前实现：

- `tradeValidator`：交易类型、资产、Decimal、金额容差、严格 ISO 日期、币种和完整持仓时间线。
- `priceSnapshotValidator`：资产、正价格、币种、来源和严格 ISO 日期。
- `ledgerDataValidator`：schema、四个集合、实体结构、ID 与资产 symbol 唯一性、引用、Decimal、日期和全账本交易时间线。
- `isoDateValidator`：拒绝非 ISO 文本及 `2026-02-30` 这类会被 `Date.parse` 自动纠正的坏日期。

稳定规则：

- 普通校验失败返回结构化错误，不使用异常控制流程。
- Validator 不保存数据、不生成持仓、不操作 React 或 IndexedDB。
- Calculator 仍保留超卖异常作为最后防线，但不能替代入口校验。
- Repository 保存前和恢复后都必须调用完整 `LedgerData` Validator。
