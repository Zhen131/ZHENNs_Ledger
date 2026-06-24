# tradeValidator v1 接口设计

状态：Step 2 设计完成，规则实现待 Step 3–5。

## 结论

Validator 接收不可信的 `unknown`，校验成功后输出标准化的
`ValidatedTradeDraft`，校验失败返回结构化错误：

```ts
type TradeDraftValidator = (
  input: unknown,
  context: TradeValidationContext,
) => TradeValidationResult;
```

本步骤只锁定公开契约，不提供半成品运行时函数。后续
`validateTradeDraft` 实现必须满足 `TradeDraftValidator`。

## 为什么校验 TradeDraft

- `TradeDraft` 是表单和导入数据进入保存流程前的业务对象。
- `Trade` 已包含 `id`、`createdAt`、`updatedAt`，属于校验后生成并保存的事实。
- 入口使用 `unknown`，因为 TypeScript 类型不能保证表单或 JSON 的运行时数据合法。
- 成功结果才收窄为 `ValidatedTradeDraft`，避免调用方把未经校验的数据当成可信对象。

## 上下文

```ts
type TradeValidationContext = {
  assets: readonly Asset[];
  priorTrades: readonly Trade[];
  totalValueTolerance?: DecimalString;
};
```

| 字段 | 作用 |
| --- | --- |
| `assets` | 判断 `assetSymbol` 是否存在 |
| `priorTrades` | 计算待校验卖出之前的可用持仓 |
| `totalValueTolerance` | 覆盖默认成交金额绝对误差 |

`priorTrades` 必须只包含当前交易之前已经接受的交易。Validator 不读取 repository，
也不自行查找全局状态。

## 成功与失败

```ts
type TradeValidationResult =
  | { ok: true; value: ValidatedTradeDraft }
  | { ok: false; errors: TradeValidationError[] };
```

- 普通输入错误通过 `{ ok: false }` 返回，不使用异常控制流程。
- 成功结果中的 `fee` 一定存在；输入缺省时标准化为 `"0"`。
- 返回错误数组，允许一次展示多个字段问题。

## 稳定错误码

| code | 含义 |
| --- | --- |
| `INVALID_INPUT` | 输入不是可检查的对象或缺少必要结构 |
| `INVALID_TRADE_TYPE` | 交易类型不是 `buy` / `sell` |
| `ASSET_NOT_FOUND` | 资产不在合法 `Asset[]` 中 |
| `INVALID_DECIMAL` | 数量、价格、总额、手续费或容差不是合法有限小数 |
| `VALUE_MUST_BE_POSITIVE` | 数量、价格或总额不大于 0 |
| `FEE_MUST_BE_NON_NEGATIVE` | 手续费小于 0 |
| `TOTAL_VALUE_MISMATCH` | 成交金额超过允许误差 |
| `INSUFFICIENT_HOLDINGS` | 卖出数量超过当前持仓 |

错误对象同时包含 `field` 和 `message`。程序与测试判断 `code`，不依赖可变文案。

## 成交金额容差

第一版只支持 USD，默认使用绝对误差：

```text
abs(quantity × price − totalValue) <= 0.01
```

理由：样例中的 `totalValue` 是记录事实，允许成交数量与均价乘积存在分级别的
四舍五入误差。调用方可通过 `totalValueTolerance` 覆盖默认值；Validator 不做
多币种换算。

## 非法小数

`quantity`、`price`、`totalValue`、`fee` 或容差无法解析为有限 Decimal 时，统一返回
`INVALID_DECIMAL`，再通过 `field` 区分具体字段。合法但不满足正负规则的数字使用
对应业务错误码。

## 职责边界

Validator：

- 检查并标准化不可信输入。
- 判断资产、金额误差和卖出持仓是否合法。
- 返回结构化错误。
- 不保存数据、不生成 ID、不计算正式 `Position[]`。

Calculator：

- 接收已经结构化、已经校验的 `Trade[]`。
- 计算持仓、成本和盈亏。
- 保留超卖异常作为防御性保护，不能替代 Validator。

## 本步骤不包含

- 不实现具体校验规则。
- 不写测试。
- 不安装 Vitest。
- 不修改 `positionCalculator`。
