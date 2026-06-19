# adapters

外部系统适配放在这里。

后续可以加入 IndexedDB、JSON 导入导出、文件、加密、行情数据等适配器。

Adapter 可以知道外部 API 怎么用，但不能把浏览器或文件系统细节泄露到
services、repositories、calculators、validators 或 UI 组件里。
