# Local-First 个人交易账本

这是一个使用 Next.js、React 和 TypeScript 开发的浏览器端个人交易账本。长期产品线为 `main`，服务本人真实、长期使用，因此产品界面和本 README 以中文为主；源码模块说明、Release Notes 和新的 Git 提交标题继续使用英文。

毕业论文专用版本位于独立的 [`CS2026` 分支](https://github.com/Zhen131/ZHENNs_Ledger/tree/CS2026)。两条长期分支共享 `CS2026-baseline-2026-08-02` 基线，但以后独立演进，不自动 merge、rebase、cherry-pick 或复制修复。

## 分支定位

| 分支 | 用途 | 语言规则 |
| --- | --- | --- |
| `main` | 长期个人账本产品 | 产品界面和根 README 使用中文；模块说明与 Git 提交标题使用英文 |
| `CS2026` | 2026 毕业论文实现与证据 | 当前受 Git 管理工作树和未来提交标题全部使用英文 |

## 当前状态

截至 2026-08-13，源码 `main` 位于 `1a7ecb8`，已包含 Week 12 含费 P&L、V2 `.lftl`、FeeRule，以及 Week 13 源码目录重构。`main` 与 `origin/main` 同步。

第一轮 UI 重构当前保留在本地候选分支 `zhennn/w13-main-ui-refactor`：9 个实现提交基于 `main@1a7ecb8`，实现结果截至 `0ad68e1`。本 README 固定候选的真实能力与证据，但不表示 UI 已经合入或推送到 `main`，也不表示已经通过独立验收。

当前技术基线：Next `15.5.22`、React / React DOM `19.2.8`、ESLint `9.39.5`、`eslint-config-next` `15.5.22`，正式新写数据使用 `LedgerData.schemaVersion = 2`。

## Week 13 第一轮 UI 重构候选

本轮把解锁后的单页长列表改为五个稳定工作区：

- **首页**：四项摘要、趋势、资产分配、前三持仓、365 日热力和最近交易，在 1280 × 800 正常有数据状态下一屏完成。
- **记账**：交易与价格并列录入；草稿跨页面保留，只有认证保存成功后才清理字段并显示反馈。
- **交易**：支持组合筛选、详情、依赖拒绝、两次删除预检、5 秒倒计时、撤回和最终删除。
- **导入与导出**：保留明文备份警告、零写预检和整本替换，不增加合并或自动去重。
- **设置**：集中管理 Binance mapping、FeeRule、账本文件状态和清空授权。

五个工作区始终共用同一账本实例，切页不会重新 hydrate。UI 只消费既有 portfolio、P&L、price selector、chart、repository 和 import 服务，没有改写 `LedgerData`、`.lftl V2`、BackupEnvelopeV2、加密、revision 或整本导入合同。

开发执行证据：

- 9 个可独立回滚的实现提交，源码变更 63 个文件。
- 72 个测试文件、785 项测试全部通过。
- typecheck、lint、production build 和两类 `git diff --check` 通过。
- 真实 Google Chrome 与 macOS 原生 picker 覆盖两份虚构 V2 `.lftl`、保存、锁定、重开、五页导航、草稿保留、交易筛选和安全删除、明文备份整本恢复、FeeRule、清空以及 1280 / 1100 / 390 视口。
- 键盘焦点、reduced-motion、局部宽表横滚通过；production reload 捕获 0 个 application error、0 个 exception。

这些结果构成开发执行 `PASS`，不是独立第三方验收。源码 `main` 在用户明确决定合入前仍停在 UI 重构之前。

## 已实现能力

- 交易买卖录入、运行期校验、确定性业务排序、全时间线超卖保护和安全删除。
- 可选交易平台事实，以及 fixed USDT / percentage FeeRule；多个精确匹配时 fail closed，历史交易只读取用户最终确认的实际手续费。
- 手续费规则新增、版本替换和停用，不原地改写历史经济事实。
- 定投数量、含费平均成本与剩余成本、净已实现盈亏、最新价格、市值和净未实现盈亏。
- 手工价格快照与按需 Binance 最新价刷新；8 秒超时，不重试、不轮询、不使用 WebSocket。
- 持仓表、资产分配和历史价值曲线共用同一价格选择规则。
- 三类事实派生图表：资产分配、含费成本／市值历史、365 日交易热力。
- 新未来事实拒绝；既有未来事实进入受限纠错模式。
- 表单、账本、备份、日期、引用、DecimalString、唯一性和完整交易时间线的运行期校验。
- PBKDF2-SHA-256 600,000 次迭代和不可导出的 AES-256-GCM 会话密钥。
- 密码与 `CryptoKey` 只存在当前会话；刷新或关闭后必须重新解锁。
- 用户选择的 `.lftl V2` 文件、current / previous 双代、revision lineage、close 后复读、重连与权限 fail closed。
- Web Locks、真实文件身份、页面 lease、短时写锁和写前 revision 复读，降低浏览器多标签冲突风险。
- 明文 `BackupEnvelopeV2` 导出、零写预检、SHA-256 内容身份和校验后的整本恢复。
- dirty / pending / retry / 离开警告、repository generation 和过期异步结果保护。
- 文件字节数、实体数量和关键字符串长度的 `ResourcePolicy` 限制。

## 数据与安全边界

- `Trade`、`PriceSnapshot`、资产、FeeRule 和 Binance mapping 是事实；`Position[]`、图表切片、估值模式和选中日期是派生或会话状态，不写入账本文件或备份。
- 缺失的 Binance mapping 在保存和导出中继续缺失；运行期 fallback 不改写 `LedgerData`。显式 `null` 和显式 mapping 对象保持不同语义。
- `Trade.totalValue` 不含手续费。会计币种内的买入手续费增加成本，卖出手续费减少净收入和已实现盈亏。
- FeeRule 只按精确 `platform + assetSymbol` 匹配，不折叠大小写、不猜别名、不在冲突时选择第一条，也不因规则变化重算历史交易。
- 异币非零手续费不会被当成零，也不会猜成 USDT；在缺少换算合同时，相关成本和盈亏会明确标记为不可靠。
- 金额与数量计算使用 `DecimalString -> decimal.js`，不依赖 JavaScript 浮点数。
- 不可信的表单、IndexedDB、文件和 JSON 输入必须先经过运行期 Validator。
- 缺失行情保持缺失，不以成交价、成本、未来价格或零替代。
- Binance 是可选、可能失败的外部输入；网络失败不阻塞本地账本。
- UI 组件、服务和 reducer 不直接操作 IndexedDB 或 File System Access API。
- 正常路径的完整账本只存在用户选择的 `.lftl`；IndexedDB 仅保存最小连接记录，不保存密码或密钥。
- 备份是敏感明文文件，不属于加密静态存储保证。
- 导入成功后整本必须等于冻结并校验过的候选；不合并、不部分导入、不跳错、不自动去重。
- 浏览器无法证明补偿后的磁盘状态时，repository 必须 fail closed，不能猜测新旧版本谁获胜。
- 浏览器标签协调不是操作系统文件锁，无法约束不参与协议的原生应用。

## 文件版本边界

正式新写路径只接受 `.lftl V2`、LedgerData V2 和 BackupEnvelopeV2。

```text
V1 .lftl / BackupEnvelopeV1 / 旧完整 IndexedDB 账本
-> 识别旧格式
-> 显示需要 V2 的明确提示
-> 不读取密码、不解密、不迁移、不写回、不发布连接、不自动删除
```

## 源码结构

```text
src/
  app/           Next.js 入口、访问控制、工作区组合与持久化流程
  core/          账本事实、计算、策略、状态、共享基础和校验
  features/      备份、图表、手续费、行情、持仓、价格和交易
  platform/      文件、持久化、加密、协调、外部集成和旧格式边界
  ui/            跨功能复用的界面原语
  test-support/  共享夹具、测试替身和永久结构守卫
```

跨区域使用登记后的稳定入口，同一区域使用精确相对引用。TypeScript AST 结构守卫和 ESLint 会拒绝自身稳定入口、未登记深层 alias、跨边界 `../` 和静态依赖环。详细放置与 import 合同见 [`src/README.md`](src/README.md)。

## 本地运行

使用 Node.js 20、22 或 24+：

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:3000`。

完整本地质量门：

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

## 证据边界与已知限制

- Week 11 第一批 `.lftl` 核心合同已取得最终独立 PASS；Week 11 `02D` 和 `03B` 保留历史 `BLOCKED`，不能由后续开发绿灯覆盖。
- Week 12 含费 P&L 已由 `01R1D` 独立 PASS；V2 与 FeeRule 已完成开发并进入 `main`，但独立 `02C` 延期，未生成 `02D`。
- Week 13 源码目录重构已进入 `main`，`01D` 是 R1 开发执行 PASS，尚无合并后独立复审。
- Week 13 UI 是本地开发候选，开发执行 PASS；尚未 merge、push 或进入独立验收。
- 仅会计币种内实际手续费进入成本和盈亏；阶梯费率、最低手续费、交易所专属舍入和异币换算尚未实现。
- 持仓调整类交易和原方案中的交易标记叠加层尚未实现。
- Binance 只提供最新公开价格；历史 Kline / OHLC、轮询和 WebSocket 尚未实现。
- 浏览器补偿流程不是操作系统原子事务；重要 V2 数据仍应保留独立备份。
- Mac 桌面端仍是产品讨论方向，不是已经实现的代码。
- 分页、虚拟列表和大账本性能预算尚未建立，不能在无测量证据时声称 25,000 笔交易流畅。
- 论文分支的确定性生成器、Playwright、四项性能指标、重复统计、七理想评估和论文级证据仍未实现。

## 关键版本

- Week 10 功能基线：`5a21529c10d4a27048e4d26d07c7a1641e4c7b87`
- 双分支共同基线：`084ae7da96770721e9e805658928a7884eed779c`
- Week 12 含费 P&L R1：`605c7a3c2860b7c4783a8234037882ceca1613c8`
- Week 12 V2 与 FeeRule：`083b9f7cc3244f8bb96ba81635f4d619ed0a4008`
- Week 13 源码目录重构 R1：`beef4c897f29b55d4d111c97c765d439cf4f1fe3`
- 当前源码 `main`：`1a7ecb81012594bb36b5fd22693f6fe45df844c7`
- Week 13 UI 实现候选：`0ad68e1d62c6ff0e84105b9afa8f48537711962e`

分支、远端与发布状态以 Git 实时结果为准；本 README 不把本地候选提前写成主干发布。
