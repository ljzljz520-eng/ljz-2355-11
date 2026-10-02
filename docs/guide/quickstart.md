---
title: 快速开始
docVersion: 2.0.0
---

# 快速开始 <VersionBadge />

## 初始化 {#init}

通过 {{t:sdk}} 初始化（取代了 1.x 的 {{t:app}}）：

```js
import { createSdk } from 'my-lib'

const sdk = createSdk({ baseURL: '/api' })
```

## 第一次请求 {#first-request}

<details data-block-id="b-request-interceptors">
<summary>拦截器（点击展开）</summary>

```js
sdk.interceptors.request.use((req) => req)
```

</details>

## 主题令牌 {#theme}

2.0 的 {{t:token}} 是运行时可变的语义化令牌；CSS 层面见 {{t:token@css}}。

> 查看 1.x 旧示例时，悬浮的术语解释来自 1.1 词典，不会把 2.0 的新定义拼到旧文档上。
