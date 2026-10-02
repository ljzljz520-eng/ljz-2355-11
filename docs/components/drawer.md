---
title: Drawer 抽屉
docVersion: 2.0.0
---

# Drawer 抽屉 <VersionBadge />

Drawer 由 1.x 的 Dialog 拆分而来，负责侧滑容器。

## 基础用法 {#basic}

```html
<MyDrawer v-model:open="open" placement="right">内容</MyDrawer>
```

## 方向 {#placement}

支持 `left` / `right` / `top` / `bottom` 四个方向。
