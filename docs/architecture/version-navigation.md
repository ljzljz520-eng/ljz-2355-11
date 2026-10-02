# 版本导航设计

## 1. 数据身份

- `doc_node(node_id, locale)` 保存跨版本稳定身份，标题和路径都不能作为身份。
- `doc_node_release` 保存章节在某个产品版的标题、路径、章节目录和锚点。
- `doc_migration_edge` 是有向迁移边，类型包括 `same`、`split`、`merge`、`renamed`、`private`。
- `term` 与 `term_release` 分离：同名术语允许存在，但悬浮解释必须按 `(release, locale, term_id)` 获取。
- `release_scope` 控制公开/私有范围；撤权后私有版不进入公开索引、构建目录或术语 API。
- `doc_revision` 保存编辑草稿。读者构建只消费已发布内容；严格 CI 从干净工作区的 `HEAD` 读取，未发布修改不会影响线上目录。

## 2. 构建时物化与按请求求路径

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 构建时物化所有迁移路径 | 切换快；可在发布前发现循环、重复边、缺失节点、错误锚点和超长链；产物可绑定提交并回滚 | 每次版本拓扑变化都要重建；对一对多只能物化候选集合，不能替读者选择；私有权限需要二次过滤 | 用于公开版目录、边、术语和诊断 |
| 按请求计算路径 | 适合实时权限和高频拓扑变化；能按读者返回不同候选 | 每次切换都要跑图，循环和链上限容易成为运行时问题；历史词典与页面版本可能被错误混用；缓存复杂 | 仅用于私有版鉴权、灰度发布和在线诊断 |
| 混合方案 | 公开内容在构建时校验并物化；运行时使用同一套纯函数结合权限结果求目标；限制同时存在于构建和运行时 | 需要保持图算法同构 | **采用** |

构建输出写入：

```text
docs/public/version-api/index.json
docs/public/version-api/releases/<release>/index.json
docs/public/version-api/releases/<release>/glossary.json
catalog/build-manifest.json
```

根索引带 `commit` 与 `source`（`HEAD` 或 `working-tree`）。严格构建使用：

```bash
npm run catalog:build:strict
```

## 3. 路径求解规则

1. 从 URL 解析 `(release, locale, contentPath, anchor)`。
2. 通过版本目录找到当前稳定节点，而不是比较标题。
3. 正向、反向边都允许，因为存档版和最新版之间可以来回切换。
4. BFS 最多走 `maxMigrationHops`（当前为 5）；节点不可重复，避免无限重定向。
5. 目标版本有多个节点时返回 `ambiguous`，UI 必须展示候选、迁移理由、跳数和锚点状态。
6. 目标唯一时自动跳转；缺失目标、链上限、撤权和无公开索引时不静默跳到同名页。
7. 锚点沿 `anchorMap` 逐跳投影；无法映射时打开页面顶部并说明原因。
8. 切换前保存滚动位置和 `details[data-doc-state]` 展开状态；目标页尽力恢复，缺项给明确提示。

## 4. 循环、缺失和链上限诊断

构建器在发布前检查：

- `MIGRATION_CYCLE`：迁移边形成环；
- `MISSING_EDGE_SOURCE` / `MISSING_EDGE_TARGET`：边端点不存在；
- `DUPLICATE_EDGE`：同一对节点重复定义；
- `UNKNOWN_SOURCE_ANCHOR` / `UNKNOWN_TARGET_ANCHOR`：锚点映射引用不存在的标题；
- `INVALID_CHAIN_LIMIT`：迁移上限非法；
- `PRIVATE_TARGET_REVOKED`：私有目标撤权，公开产物不会输出该边；
- `MISSING_DOC_FILE`：公开目录节点没有对应 Markdown 页面；
- `HOMONYM_TERM`：同名术语提示，必须靠稳定 ID 区分。

任何 error 都会让索引重建失败并阻止 VitePress 发布。

## 5. 旧链接和页面状态

- 深链接 `/v1/guide/start#install-command` 切到 v2 时投影到 `/guide/installation#install`。
- v1 一页切到 v2 有两个候选，读者选择“安装”或“快速开始”。
- v2 的两篇切到 v3 都到合并页；v3 反向到 v2 仍是一对多，不能只按标题返回。
- 章节合并可自动落到唯一页面，并在提示中说明合并关系。
- 滚动位置使用保存的像素值恢复；有映射锚点时优先滚动到锚点。
- 展开状态只迁移带稳定 `data-doc-state` 的折叠区；目标没有同标记时明确列出。

## 6. 过时示例与替代入口

历史页面中的 `<OutdatedNotice>` 必须说明：

1. 适用产品版或 API 模型；
2. 为什么不再适用于当前版；
3. 替代文档或示例入口。

提示是历史页内容的一部分，构建时随版本快照固定；编辑新示例草稿不会修改已发布存档页。
