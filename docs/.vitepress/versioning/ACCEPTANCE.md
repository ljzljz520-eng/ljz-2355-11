# 验收报告

测试：`npm run test:versioning`（node:test，共 40 个用例，全部通过）
构建：`npm run version:build` → `npm run docs:build`

## 验收矩阵

| # | 验收项 | 场景 / 数据 | 预期与实际 |
| --- | --- | --- | --- |
| 1 | **重名术语** | `token` 全局 + `token@css` 两个 scope | 未限定引用 → `ambiguous` 并列出 scopes；`token@css` → 唯一定义；`terms.test.js` ✓ |
| 2 | **术语版本隔离** | 1.1 token=SCSS 变量；2.0 token=运行时语义令牌 | 悬浮组件按页版本取词典，断言两版 body 不同；1.1 查 `sdk` 为 unknown（不跨版本取词）✓ |
| 3 | **章节拆分（一对多）** | 1.1 Dialog → 2.0 Modal + Drawer | 解析 `choose`，两个候选带 path/title，UI 弹选择框，不自动跳 ✓ |
| 4 | **章节合并** | 2.0 Modal、Drawer → 1.1 Dialog | 两分支去重后 `unique` 到同一节点 ✓ |
| 5 | **不只按标题跳** | 同名但无迁移边 | `unmapped`：`标题相同但没有迁移边时不跳转` 用例 ✓ |
| 6 | **旧链接深开** | `/v1/install.html`、`/zh/install`、`/v1/components/modal` | legacyPaths 精确命中；404 槽组件给最新落点/拆分候选；死链检查按预期豁免 ✓ |
| 7 | **索引重建失败** | 删除夹具文件 / `--fail-index` | 拉取失败退出码 2；`last-good.json` 与已发布 manifest 不被覆盖，站点继续服务旧快照 ✓ |
| 8 | **私有版撤权** | 3.0-beta 需 `beta-preview`；节点 modal/drawer 同 scope | 取消授权：版本从导航消失、切换返回 `no-access`；恢复授权后可见；`grants.revoked_at` 即时生效 ✓ |
| 9 | **循环诊断** | 构造跨层环 / 语义环 / 同层损坏边 | `validateGraph` 报 CYCLE（构建致命，不产出目录）；解析器运行时返回 `error`；成对反向边不误报 ✓ |
| 10 | **缺失目标** | 悬挂边 `e-dangling-demo`；2.0 changelog 无 1.1 边 | 构建 WARNING；运行时 `unmapped` 并说明“没有迁移边” ✓ |
| 11 | **迁移链上限** | maxChain=1/2 的长链；默认 8 跳 | 超限返回 error 并提示上限值，物化时产生 CHAIN_TOO_LONG 警告 ✓ |
| 12 | **锚点迁移** | first-call→first-request；options 删除；peer-deps 删除 | 逐跳映射；删除/无映射 → null + ANCHOR_LOST 原因，落页顶 ✓ |
| 13 | **滚动迁移** | 无锚点切换 | 记录滚动比例，落地页按文档高度恢复（`state-migration.js`）✓ |
| 14 | **展开状态迁移** | b-cdn-mirror 保留；b-legacy-npm 删除；b-nested drawer 分支删除 | 存活块自动展开；删除块逐条给 lostReason ✓ |
| 15 | **过时示例** | v1 快速开始 createApp | `::: legacy < 2.0.0 | /guide/quickstart` 标注范围与替代入口 ✓ |
| 16 | **草稿不影响读者** | v2.1 整体 draft；guide-migration-21 为 draft | 导航不出现；`isVersionVisible/nodeAccess` 拒绝；断言状态为 draft ✓ |
| 17 | **目录绑定提交** | `build.commit` | manifest 含短 SHA 与 maxChain；切换器底部显示；测试断言非空 ✓ |
| 18 | **物化 ≡ 按请求** | 全版本对 × 全节点 | e2e 测试逐个三元组比较两种实现 status 完全一致 ✓ |

## 手工冒烟（preview）

- `/guide/quickstart`、`/v1/guide/quickstart`、`/next/guide/quickstart`、`/versioning-demo` 均 200；
- `/v1/install.html` 返回 404 状态码但挂载救治组件（客户端解析 legacyPaths）；
- `/version-data/manifest.json`、`last-good.json` 随站发布；
- 构建无死链错误（旧链已在 `ignoreDeadLinks` 声明，因为它们本就应走 404 救治）。

## 已知边界与取舍

1. 演示中 `/next/` 目录静态托管 3.0-beta；真实多版本部署通常是“每版本独立构建、
   独立 base”，本仓库把版本 API/迁移机制做成可复用内核，部署形态替换 manifest 即可。
2. 真实后端接入点为 `api/client.js` 的 `httpApiSource`（带超时/状态码检查），
   PG 表结构与可见性视图见 `schema/postgres.sql`。
3. 环检测在节点×版本规模很小的图上逐根 DFS；若未来节点量巨大，可加增量校验缓存。
