# Button 按钮

常用的操作按钮。v2 中存在两个同名术语：<VersionedTerm id="button-action">按钮动作</VersionedTerm> 与 <VersionedTerm id="button-control">按钮控件实例</VersionedTerm>，悬浮解释通过稳定 ID 获取。

## 基础用法 {#basic-usage}

基础的按钮用法。

<details data-doc-state="v2-button-source">
<summary>查看展开状态迁移说明</summary>

切换版本后，这个折叠区会尽量按稳定标记恢复；若目标版本没有对应标记，会显示明确原因。
</details>

::: demo 基础按钮示例
examples/button/basic.vue
:::

## API

### Attributes

<VpApi :props="[{ name: 'type', description: '类型', type: 'string', default: 'default' }]" />
