# 快速上手

<OutdatedNotice
  scope="产品版 v1.0.x；同步表单提交模型"
  replacementLink="/v3/guide/start"
  replacement="v3《快速上手（合并版）》"
  reason="v2 起安装与组件引入已拆分，v3 又合并为新的异步命令模型。"
/>

本文档来自 v1.0 存档版。历史页面只使用 v1 词典解释概念：<VersionedTerm id="button-action">按钮</VersionedTerm>。

## 安装命令 {#install-command}

```bash
npm install my-component-lib@1
```

<details data-doc-state="v1-install-options">
<summary>查看旧版安装选项</summary>

v1 仅支持 UMD 与 CommonJS 两种产物。
</details>

## 引入组件 {#import-component}

```javascript
import MyComponentLib from 'my-component-lib'
```

::: demo v1 同步按钮示例
examples/button/basic.vue
:::
