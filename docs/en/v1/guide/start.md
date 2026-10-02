# Getting Started

<OutdatedNotice
  scope="Product v1.0.x; synchronous form submission"
  replacementLink="/en/v3/guide/start"
  replacement="v3 Getting Started (merged)"
  reason="Installation and imports split in v2 and merged again under the v3 async command model."
/>

This archived v1 page uses only the v1 glossary: <VersionedTerm id="button-action">Button</VersionedTerm>.

## Install command {#install-command}

```bash
npm install my-component-lib@1
```

<details data-doc-state="v1-en-install-options">
<summary>Show legacy installation options</summary>

v1 shipped only UMD and CommonJS builds.
</details>

## Import component {#import-component}

```javascript
import MyComponentLib from 'my-component-lib'
```

::: demo v1 synchronous button
examples/button/basic-en.vue
:::
