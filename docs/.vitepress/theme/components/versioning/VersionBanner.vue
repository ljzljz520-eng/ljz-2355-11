<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vitepress'
import { loadManifest, loadPageVersionMap, detectPageContext } from '../../versioning/runtime.js'

const route = useRoute()
const manifest = ref(null)
const pageMap = ref([])
const ctx = ref({ version: null, nodeId: null })

onMounted(async () => {
  manifest.value = (await loadManifest()).manifest
  pageMap.value = await loadPageVersionMap()
  ctx.value = detectPageContext(route.path, pageMap.value)
})
watch(() => route.path, async () => {
  if (!pageMap.value.length) pageMap.value = await loadPageVersionMap()
  ctx.value = detectPageContext(route.path, pageMap.value)
})

const info = computed(() => {
  if (!manifest.value || !ctx.value.version) return null
  const v = manifest.value.versions.find((x) => x.version === ctx.value.version)
  if (!v) return null
  const pub = manifest.value.versions.filter((x) => x.status === 'public')
  const latest = pub[pub.length - 1]
  const section = (manifest.value.sections[v.version] || []).find((s) => s.path === route.path)
  if (v.status === 'private') {
    return {
      kind: 'private',
      text: `你正在查看私有预览版 ${v.label}。内容可能随时变化；正式发布前不构成承诺。`
    }
  }
  if (latest && v.version !== latest.version) {
    // 该历史页面是否有更新版对应入口
    let alt = null
    if (section) {
      const m = manifest.value.materialized?.[v.version]?.[section.id]?.[latest.version]
      if (m?.status === 'unique') alt = m.target.path
      else if (m?.status === 'choose') alt = null // 拆分：交给版本切换器的选择对话框
    }
    return {
      kind: 'old',
      text: `本文档适用于 ${v.label}，并非最新版（${latest.label}）。`,
      alt,
      latest: latest.version
    }
  }
  return null
})
</script>

<template>
  <div v-if="info" class="vp-version-banner" :class="`banner-${info.kind}`">
    <template v-if="info.kind === 'old'">
      <span>⏱ {{ info.text }}</span>
      <a v-if="info.alt" :href="info.alt" class="vp-banner-action">查看最新版对应内容 →</a>
      <span v-else class="vp-banner-hint">（点右上角版本切换器选择拆分后的具体章节）</span>
    </template>
    <template v-else>
      <span>🔒 {{ info.text }}</span>
    </template>
  </div>
</template>

<style scoped>
.vp-version-banner {
  display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center;
  padding: 10px 16px; font-size: 13px; border-radius: 10px; margin: 16px 0 20px;
}
.banner-old {
  background: rgba(230, 162, 60, .08);
  border: 1px solid #e6a23c55;
  color: #8a6116;
}
.banner-private {
  background: rgba(144, 147, 153, .1);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
}
.vp-banner-action { font-weight: 600; color: inherit; text-decoration: underline; }
.vp-banner-hint { opacity: .8; }
</style>
