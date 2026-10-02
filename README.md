# VitePress 文档系统 (Element Plus 风格)

本项目是一个基于 VitePress 搭建的高质量组件库文档模板，深度参考了 Element Plus 的交互体验与视觉风格。

## ✨ 特性

- 🚀 **自动化 Demo 提取**：使用 `::: demo` 语法自动读取 `.vue` 文件并生成预览与源码。
- 🌍 **内置国际化**：完善的中英文多语言切换支持。
- 🔍 **全文搜索**：集成 VitePress 本地搜索功能。
- 📊 **API 自动展示**：美观的组件属性（Attributes）表格。
- 🎨 **主题定制**：深度还原 Element Plus 的 UI 风格。
- 🧭 **版本导航**：章节和术语索引来自版本 API；拆分/合并章节通过稳定节点和迁移边求解。
- 🔒 **发布范围控制**：公开构建物化公开版目录；私有/撤权版本不会进入读者 API。
- 🧪 **迁移诊断**：构建时检查循环、重复边、缺失目标、锚点错误和迁移链上限。

## 🚀 快速启动

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务器

```bash
npm run docs:dev
```

### 3. 构建静态站点

```bash
npm run docs:build
```

生产发布建议使用严格构建：它要求 Git 工作区干净，并从 `HEAD` 物化目录，避免未发布编辑影响读者：

```bash
npm run docs:build:strict
```

### 4. 预览构建效果

```bash
npm run docs:preview
```

## 📂 项目结构

- `docs/`：文档根目录
  - `.vitepress/`：配置与主题
  - `components/`：组件说明文档
  - `examples/`：存放所有的组件 Demo 示例代码
  - `guide/`：入门指南
  - `v1/`、`v3/`：归档/最新版中文页面；英文版位于 `en/v1/`、`en/v3/`
  - `public/version-api/`：构建生成的版本、章节和术语 API
- `catalog/catalog.source.json`：稳定节点、迁移边、术语和公开范围的目录源
- `database/schema.sql`：PostgreSQL 持久化模型
- `scripts/build-catalog.mjs`：提交绑定目录物化、循环/缺失/撤权诊断
- `docs/architecture/version-navigation.md`：构建时物化与按请求求路径的设计决策

## 🛠 语法说明

### 组件示例

使用 `::: demo [描述文本]` 块，并在其中写入示例文件的路径：

```markdown
::: demo 基础按钮用法
examples/button/basic.vue
:::
```

### 版本术语

术语悬浮解释必须携带稳定术语 ID，不能按显示名称查询，因为不同概念可能同名：

```markdown
<VersionedTerm id="button-action">按钮动作</VersionedTerm>
<VersionedTerm id="button-control">按钮控件实例</VersionedTerm>
```

### 过时示例

历史示例要标明适用产品版和替代入口：

```markdown
<OutdatedNotice
  scope="产品版 v1.0.x；同步 click 回调"
  replacementLink="/v3/components/button"
  replacement="v3 Button 文档"
/>
```
