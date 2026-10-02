# 快速上手（合并版）

v3 将 v2 的安装与快速开始合并。选择旧版章节时，系统会按迁移边而不是相同标题跳转。

术语使用 v3 词典：<VersionedTerm id="button-action">按钮（动作）</VersionedTerm> 与同名的 <VersionedTerm id="button-control">按钮（控件实例）</VersionedTerm> 通过稳定术语 ID 区分。

## 安装命令 {#install}

```bash
npm install my-component-lib@3
```

<details data-doc-state="v3-install-commands">
<summary>查看包管理器命令</summary>

npm、pnpm 与 Yarn 均支持锁定 v3 主版本。
</details>

## 引入组件 {#import}

```javascript
import { createApp } from 'vue'
import MyComponentLib from 'my-component-lib'

createApp(App).use(MyComponentLib).mount('#app')
```

::: demo v3 异步按钮基础示例
examples/button/basic.vue
:::
