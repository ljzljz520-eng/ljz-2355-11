# 多版本文档导航 · 设计说明

## 1. 需求拆解

| 需求 | 落地位置 |
| --- | --- |
| 页面从版本 API 获取章节与术语索引 | `api/client.js`（HTTP/夹具两种源）、`build.js` 拉取 |
| PG 保存稳定文档节点、迁移边、公开范围 | `schema/postgres.sql` |
| 构建任务产出绑定提交的目录 | `core/catalog.js` + `build.js`（`build.commit`） |
| 章节拆分一对多，读者选择而非按标题跳 | `core/graph.js` 的 `split` 分支 + `VersionSwitcher` 选择对话框 |
| 术语定义随版本变化，悬浮不跨版本拼词典 | `core/terms.js` + `VersionTerm.vue`（按页版本取词） |
| 循环诊断、缺失目标、迁移链上限 | `validateGraph` / `resolveMigration` / `traceTerm`（默认 8 跳） |
| 过时示例标注范围与替代入口 | `::: legacy` 容器 + `VersionLegacy.vue` |
| 编辑变更未发布不影响读者 | `status=draft` 全链路不可见；原子发布保留 last-good |
| 重名术语、章节合并、旧链接深开、重建失败、私有撤权 | 见“验收矩阵” |
| 锚点/滚动/展开状态尽可能迁移，无法映射给理由 | `state-migration.js` + `anchorMap`/`blocksMap` |

## 2. 数据模型要点

- **稳定节点 ID**：`doc_nodes.stable_node_id` 是跨版本身份。标题是可任意修改的展示字段，
  解析器**只按 ID 与迁移边**跳转，因此“v1/v2 恰好同名但内容已分叉”不会误跳。
- **边只连相邻版本**：数据库 trigger 约束；跨版本映射由沿版本链逐跳合成得到。
- **边类型**：`identity`（保留）、`rename`（改名/改 API）、`split`（一对多）、
  `merge`（多对一）、`removed`（有意下线）。无边 ≠ removed：前者是数据缺口，必须提示。
- **公开范围两级**：版本级（private 版本需 scope 集合）与节点级（章节 scope）。
  `grants.revoked_at` 置位即撤权，`visible_versions(subject)` 视图即时反映。
- **草稿**：`draft` 状态不进版本链的读者视图，编辑中的内容对读者完全不可见。

## 3. 构建时物化 vs 按请求求路径

两种实现都做了，互为兜底：

### 3.1 构建时物化（默认）

构建任务对每个 `(fromVersion, nodeId, toVersion)` 三元组运行一次图解析，
把结论（`unique` / `choose` / `removed` / `unmapped` / `no-access` / `error`、
候选、trail、hops）写进 `manifest.materialized`。

- 优点：读者侧 O(1) 查表；**环、重复边、二义边在构建时即致命失败**，错误数据无法发布；
  可静态托管，无后端计算压力。
- 代价：迁移图变更必须重建；物化结果不含读者授权（授权必须运行时判定）。
- 锚点/折叠块是“源状态”，不能完全预计算：物化只存边级映射表，运行时仍按当前
  anchor/blocks 走一次解析（数据已在 manifest 内，成本极低）。

### 3.2 按请求求路径（兜底）

`resolveMigration` 沿版本链逐跳 BFS：

- 优点：数据更新后无需重建即可生效；天然携带当前 anchor/blocks/授权上下文。
- 代价：每次切换都要遍历（受 `maxChain=8` 保护）；环只能在运行时发现。

manifest 同时携带原始 `edges`，运行时 `resolve-client.js` 始终运行实时解析，
因此即使“物化结果落后于 API”（重建失败、快照陈旧），切换仍可工作；
`e2e-manifest.test.js` 全量断言两种实现对所有版本对/节点结论一致。

### 3.3 发布安全：原子提交

`publishAtomic` 写临时目录 → 拷贝覆盖 manifest → 写 `BUILD_OK` 与 `last-good.json`。
拉取失败、校验致命错误（`--fail-index` 可强制演练）、写盘异常都**不触碰**已发布文件，
读者继续读到上一份可用快照；UI 顶部显示“索引已回退”提示。

## 4. 关键算法说明

### 4.1 跨版本合成

版本链按 semver 排序（预发布 < 正式）。BFS 每跳在
`out[(fromVersion,toVersion)|nodeId]` 取出边并扩展分支：

- 多条非 removed 边 → 多分支（split）；
- 不同分支收敛到同一 `(toVersion,nodeId)` → 去重（merge）；
- 分支终点为 removed → 下线；无边 → `unmapped`（缺失目标，附边诊断说明）。

### 4.2 环诊断

- 构建期 `validateGraph`：逐根彩色 DFS，回边到灰色节点即候选环。
  相邻版本**成对的反向边**（版本双向切换必需）通过“回环上每一跳是否都存在反向边”豁免；
  真正的跨层环（如 A→B→C→A）无法逐跳互逆，必然被捕获。
- 解析期沿链前进（版本严格递增），另检测“ID 变更后又回到旧 ID”的语义环，
  防止错误数据让读者在概念间打转。

### 4.3 锚点与折叠块

- `anchorMap`：每跳一张 `源锚点 → 目标锚点` 表，`""` 表示随变更删除；
  表中无记录即“不掌握去向”，报告 `ANCHOR_LOST` 而不是猜测。
- `blocksMap`：折叠块 ID 同理；成功则在新页面自动展开，删除/无映射逐条给理由。
- 滚动：有锚点走原生定位；无锚点记录滚动比例，落地页按文档高度恢复。

### 4.4 术语

- 每版本独立词典；重名（同 slug 多 scope）**必须** `slug@scope` 限定，
  未限定一律 `ambiguous`，由作者修正，绝不替读者选一个。
- 悬浮组件只接收“当前文档版本”，fetch 后仅查该版本词典；旧文档读到的是旧定义。
- 跨版本概念沿用术语迁移边（`traceTerm`），环与链上限语义同章节图。

## 5. 运行时交互

- 版本切换器（导航栏）：当前版本标签 + 最新/旧版/私有标记；
  `unique` 直接跳并携带状态，`choose` 弹候选对话框，其余状态就地显示理由。
- 旧版横幅：历史页提示版本与替代入口；私有预览页提示保密性质。
- 404 救治：`not-found` 槽中的 `LegacyLinkResolver` 用 `legacyPaths` 精确命中旧深链，
  再沿迁移图找最新落点；拆分给候选、下线/无权限/无映射各有明确文案。
- 演示授权：`ScopeSwitcher` 写 `localStorage(vp_demo_scopes)`，
  撤销 `beta-preview` 后私有版本与章节立即消失/被拒。

## 6. 目录结构

```
docs/.vitepress/
├─ config.ts                     # Markdown 扩展与侧栏装配
├─ markdown-version.mjs          # {{t:slug}}、::: legacy / removed
├─ theme/
│  ├─ index.ts
│  └─ components/versioning/     # VersionSwitcher / VersionTerm / VersionLegacy /
│                               # VersionBanner / LegacyLinkResolver / ...
└─ versioning/
   ├─ build.js                   # 构建任务入口（绑定 commit、原子发布）
   ├─ api/client.js              # 版本 API（HTTP / 夹具）
   ├─ core/
   │  ├─ versions.js             # semver、版本链、可见性
   │  ├─ graph.js                # 迁移边校验 + 解析（环/拆分/合并/上限/锚点/块）
   │  ├─ terms.js                # 术语索引与跨版本追踪
   │  └─ catalog.js              # 物化、诊断分级、原子发布、授权
   ├─ fixtures/                  # 模拟版本 API 返回
   ├─ tests/                     # node:test（40 个用例）
   └─ schema/postgres.sql        # PG 存储模型
```
