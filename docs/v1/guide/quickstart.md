---
title: 快速开始（v1.x）
docVersion: 1.1.0
---

# 快速开始 <VersionBadge />

::: legacy < 2.0.0 | /guide/quickstart
以下初始化示例仅适用于 **1.x**。2.0 起入口改为 `createSdk`，见最新版 [快速开始](/guide/quickstart)。
:::

## 初始化应用 {#init}

通过 {{t:app}} 挂载：

```js
import { createApp } from 'my-lib'

const app = createApp(MyComponent)
app.mount('#app')
```

## 第一次调用 {#first-call}

<details data-block-id="b-old-options">
<summary>1.x 的 options 配置（点击展开）</summary>

```js
app.use(plugin, { legacy: true })
```

该配置块在 2.0 已删除。

</details>

更多组件示例见 {{t:dialog}}（2.0 起拆成了 Modal 与 Drawer 两个组件）。
