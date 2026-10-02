<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { loadManifest } from '../../versioning/runtime.js'
import { resolveTermRef, buildTermIndex } from '../../../versioning/core/terms.js'

const props = defineProps({
  slug: { type: String, required: true },
  scope: { type: String, default: '' },
  version: { type: String, required: true }, // 被查看文档的版本
  label: { type: String, default: '' }
})

const state = ref({ status: 'loading' })
const show = ref(false)
const el = ref(null)

onMounted(async () => {
  const { manifest } = await loadManifest()
  if (!manifest) {
    state.value = { status: 'error', message: '术语索引暂不可用' }
    return
  }
  // 关键：只用“当前文档版本”的词典，绝不拿最新词典解释历史文档
  const rawTerms = manifest.termsByVersion?.[props.version]
  let index
  if (rawTerms) {
    index = buildTermIndex(rawTerms)
  } else {
    // 物化模式下 terms[v] 是限定名 -> term 的对象
    const terms = Object.entries(manifest.terms?.[props.version] || {}).map(([qualified, t]) => ({
      ...t,
      slug: qualified.split('@')[0],
      scope: qualified.includes('@') ? qualified.split('@')[1] : null
    }))
    index = buildTermIndex(terms)
  }
  const ref2 = props.scope ? `${props.slug}@${props.scope}` : props.slug
  const r = resolveTermRef(ref2, index)
  if (r.status === 'unique') state.value = { status: 'ok', term: r.term }
  else if (r.status === 'ambiguous') state.value = {
    status: 'ambiguous',
    message: `术语「${props.slug}」在版本 ${props.version} 有多个含义：${r.scopes.map((s) => s || '全局').join(' / ')}，请用 ${props.slug}@scope 限定引用`
  }
  else state.value = { status: 'unknown', message: `术语「${props.slug}」在版本 ${props.version} 的词典中不存在（不会用其它版本的定义代替）` }
})

function onEnter() { show.value = true }
function onLeave() { show.value = false }
</script>

<template>
  <span
    ref="el"
    class="vp-term"
    :class="{ 'is-ambiguous': state.status === 'ambiguous', 'is-unknown': state.status !== 'ok' }"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focusin="onEnter"
    @focusout="onLeave"
    tabindex="0"
  >
    <slot>{{ label || slug }}</slot>
    <sup v-if="state.status !== 'ok'" class="vp-term-warn">!</sup>
    <span v-if="show" class="vp-term-pop" role="tooltip">
      <template v-if="state.status === 'ok'">
        <span class="vp-term-title">{{ state.term.title }}</span>
        <span class="vp-term-version">{{ version }}</span>
        <span class="vp-term-body">{{ state.term.body }}</span>
      </template>
      <template v-else>
        <span class="vp-term-title">术语解析提示</span>
        <span class="vp-term-body">{{ state.message }}</span>
      </template>
    </span>
  </span>
</template>

<style scoped>
.vp-term {
  position: relative; cursor: help; color: var(--vp-c-brand);
  border-bottom: 1px dashed var(--vp-c-brand-light);
  outline: none;
}
.vp-term.is-ambiguous, .vp-term.is-unknown { color: var(--vp-c-warning, #b8841f); border-color: currentColor; }
.vp-term-warn { font-size: 10px; margin-left: 2px; }
.vp-term-pop {
  position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%);
  z-index: 60; width: 280px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
  background: var(--vp-c-bg-elevated, var(--vp-c-bg)); border: 1px solid var(--vp-c-divider);
  border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.15);
  font-size: 12.5px; line-height: 1.55; color: var(--vp-c-text-1); cursor: default;
}
.vp-term-title { font-weight: 700; }
.vp-term-version {
  position: absolute; top: 8px; right: 10px; font-size: 10px; color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider); padding: 0 6px; border-radius: 999px;
}
.vp-term-body { color: var(--vp-c-text-2); }
</style>
