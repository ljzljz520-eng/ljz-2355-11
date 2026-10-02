---
title: 版本导航 · 功能演示与验收
layout: doc
---

# 版本导航 · 功能演示与验收

<ScopeSwitcher />

本页串联版本导航的全部能力。数据来自**构建任务产出的、绑定 commit 的版本目录**
（`/version-data/manifest.json`，由版本 API 夹具物化生成）。

## 1. 章节拆分：一对多必须由读者选择

打开 [v1.1 Dialog（旧版）](/v1/components/dialog)，用右上角版本切换器切到 **v2.0**：

- 系统不会因为 v2 里也有标题相近的页面就自动跳转；
- Dialog 在 2.0 被拆成 **Modal** 与 **Drawer**，会弹出选择对话框，列出候选路径与章节 ID。

反过来，从 [Modal](/components/modal) 或 [Drawer](/components/drawer) 切回 v1.1，
两个分支合并收敛到同一个 Dialog，去重后直接跳转（章节**合并**）。

## 2. 锚点、滚动与展开状态迁移

在 [v1.1 安装](/v1/guide/installation#peer-deps) 展开“CDN 镜像配置”，滚动后切到 v2.0：

- `#cdn` 锚点保留；`#peer-deps` 在 2.0 被删除，会给出明确提示并落到页顶；
- 展开块 `b-cdn-mirror` 迁移到新版同名块并自动展开；`b-legacy-npm` 被删除会说明原因；
- 无锚点时按滚动比例恢复位置。

[快速开始](/v1/guide/quickstart#first-call) 中 `#first-call` 会重命名映射为 `#first-request`。

## 3. 术语随产品版变化

同一术语在各版本有独立词典，悬浮解释只取**被查看版本**的定义：

- v1.1 页面的 <span v-pre>{{t:token}}</span>：编译期 SCSS 变量；
- v2.0 页面的 <span v-pre>{{t:token}}</span>：运行时语义化令牌，定义完全不同。

**重名术语**：`token` 在词典里同时有全局定义和 `css` 作用域定义。未限定的引用会提示歧义
（本文的 {{t:token}} 即会提示），必须写成 <code v-pre>{{t:token@css}}</code> 才能精确解释：{{t:token@css}}。

## 4. 过时示例标注范围与替代入口

[v1.1 快速开始](/v1/guide/quickstart) 顶部的 `::: legacy` 容器标注了“仅适用于 < 2.0.0”
并给出替代入口链接；编辑中的草稿（v2.1）不会出现在导航中。

## 5. 旧链接深开

依次访问以下旧地址，404 页会调用版本索引进行救治：

- [/v1/install.html](/v1/install.html) — legacyPaths 命中，跳到新版安装页
- [/zh/install](/zh/install) — 另一条 legacy 路径
- [/v1/components/modal](/v1/components/modal) — 旧版 Dialog 的历史别名

拆分章节的旧链接会列出 Modal / Drawer 两个候选；无映射的链接给出理由并提供首页入口。

## 6. 索引重建失败

构建任务校验失败时**不会覆盖**已发布目录：

```bash
# 模拟重建失败（保留 last-good，读者无感）
node docs/.vitepress/versioning/build.js --fail-index
```

此时站点继续使用上一份快照；版本菜单顶部会显示“索引正在重建/已回退”的提示。
故意制造的悬挂边（`e-dangling-demo`）只产生构建警告，运行时表现为“缺失目标”提示。

## 7. 私有版撤权

- 取消顶部“持有 beta-preview”勾选 → 版本切换器中的 **v3.0 预览**立即消失；
- 直接打开 [/next/guide/installation](/next/guide/installation) 受保护内容时，
  从其它版本切换过去会收到 `no-access` 提示，而不是 404 或错误跳转；
- 重新勾选即可恢复访问。

## 8. 缺失目标与迁移链上限

- v3.0 预览新增的 AI Assistant 在 2.x 无迁移边，切换时提示“没有迁移边（缺失目标）”；
- 迁移链默认上限 **8 跳**，超长链（重命名回环等）会终止并报错，循环由构建期
  `validateGraph` 与解析器双重诊断，环会作为致命错误阻止目录发布。

## 9. 目录与构建提交

当前目录构建提交：见版本切换器底部的短 SHA。每次构建产物都带 `build.commit`，
发布采用临时目录 + rename 的原子方式，失败保留旧快照（`last-good.json`）。
