# Getting Started (merged)

v3 merges the v2 Installation and Quick Start pages. Switching from an older chapter follows migration edges instead of matching titles.

Terms come from the v3 glossary: <VersionedTerm id="button-action">Button action</VersionedTerm> and the homonymous <VersionedTerm id="button-control">Button control</VersionedTerm> are resolved by stable term ID.

## Install command {#install}

```bash
npm install my-component-lib@3
```

<details data-doc-state="v3-en-install-commands">
<summary>Show package manager commands</summary>

npm, pnpm, and Yarn can pin the v3 major version.
</details>

## Import components {#import}

```javascript
import { createApp } from 'vue'
import MyComponentLib from 'my-component-lib'

createApp(App).use(MyComponentLib).mount('#app')
```

::: demo v3 async button
examples/button/basic-en.vue
:::
