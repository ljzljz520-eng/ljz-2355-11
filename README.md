# VitePress 文档系统 (Element Plus 风格)

本项目是一个基于 VitePress 搭建的高质量组件库文档模板，深度参考了 Element Plus 的交互体验与视觉风格。

## ✨ 特性

- 🚀 **自动化 Demo 提取**：使用 `::: demo` 语法自动读取 `.vue` 文件并生成预览与源码。
- 🌍 **内置国际化**：完善的中英文多语言切换支持。
- 🔍 **全文搜索**：集成 VitePress 本地搜索功能。
- 📊 **API 自动展示**：美观的组件属性（Attributes）表格。
- 🎨 **主题定制**：深度还原 Element Plus 的 UI 风格。

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

## 🛠 语法说明

### 组件示例

使用 `::: demo [描述文本]` 块，并在其中写入示例文件的路径：

```markdown
::: demo 基础按钮用法
examples/button/basic.vue
:::
```

## 🧭 多版本导航（版本 API / 迁移边 / 术语版本隔离）

- 构建版本目录：`npm run version:build`（拉取版本 API → 校验物化 → 原子发布绑定 commit 的目录）
- 运行测试：`npm run test:versioning`
- 功能演示：启动后访问 `/versioning-demo`
- 设计与权衡（构建时物化 vs 按请求求路径）：`docs/.vitepress/versioning/DESIGN.md`
- 验收矩阵：`docs/.vitepress/versioning/ACCEPTANCE.md`
- PG 存储模型：`docs/.vitepress/versioning/schema/postgres.sql`
