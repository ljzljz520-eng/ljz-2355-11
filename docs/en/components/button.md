# Button

Common action controls. In v2, the same display name belongs to two concepts: <VersionedTerm id="button-action">Button action</VersionedTerm> and <VersionedTerm id="button-control">Button control instance</VersionedTerm>. Tooltips resolve them by stable ID.

## Basic usage {#basic-usage}

Basic button usage.

<details data-doc-state="v2-en-button-source">
<summary>Show expansion-state migration note</summary>

After switching versions, this section is restored by a stable marker where possible.
</details>

::: demo Basic Button Example
examples/button/basic-en.vue
:::

## API

### Attributes

<VpApi :props="[
  { name: 'type', description: 'type of button', type: 'string', default: 'default' }
]" />
