---
title: Modal 模态框
docVersion: 2.0.0
---

# Modal 模态框 <VersionBadge />

Modal 由 1.x 的 Dialog 拆分而来，负责居中弹层。

## 基础用法 {#basic}

```html
<MyModal v-model:open="open" title="标题">内容</MyModal>
```

## 层叠管理 {#stacking}

<details data-block-id="b-nested">
<summary>多层 Modal（点击展开）</summary>

2.0 通过 stacking 队列管理层叠，不再有 1.x 的两层上限。

</details>

## API {#api}

| 属性 | 说明 |
| ---- | ---- |
| open | 是否打开 |

更多概念见 {{t:modal}}。侧滑场景请使用 [Drawer](/components/drawer)（{{t:drawer}}）。
