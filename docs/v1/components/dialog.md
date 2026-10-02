---
title: Dialog 对话框（v1.x）
docVersion: 1.1.0
---

# Dialog 对话框 <VersionBadge />

::: legacy < 2.0.0
1.x 用同一个 **Dialog** 组件承担“居中弹窗”和“侧滑抽屉”两种形态，通过 `type` 切换。
2.0 起二者拆分为独立组件：见 [Modal](/components/modal) 与 [Drawer](/components/drawer)。
:::

## 基础用法 {#basic}

```html
<my-dialog type="modal" title="标题">内容</my-dialog>
<my-dialog type="drawer" title="标题">内容</my-dialog>
```

## 抽屉模式 {#drawer-mode}

<details data-block-id="b-nested">
<summary>嵌套对话框的已知限制（点击展开）</summary>

1.x 中嵌套层数最多 2 层。2.0 的 Modal 通过 stacking 管理，无此限制。

</details>

## API {#api}

| 属性 | 说明 |
| ---- | ---- |
| type | `modal` / `drawer` |

> 切换到 2.0 时，本页会提示你在 **Modal** 与 **Drawer** 两个章节中选择，
> 系统不会只因为标题相似就自动跳转。
