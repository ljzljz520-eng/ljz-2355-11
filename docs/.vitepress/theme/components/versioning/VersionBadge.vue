<script setup>
import { computed } from 'vue'
import { useRoute } from 'vitepress'
import { loadManifest, detectPageContext, loadPageVersionMap } from '../../versioning/runtime.js'
import { ref, onMounted } from 'vue'
const route = useRoute()
const version = ref('')
onMounted(async () => {
  const { manifest } = await loadManifest()
  const pm = await loadPageVersionMap()
  const ctx = detectPageContext(route.path, pm)
  version.value = manifest?.versions.find((v) => v.version === ctx.version)?.label || ctx.version || ''
})
</script>
<template>
  <span v-if="version" class="vp-doc-version-badge">{{ version }}</span>
</template>
<style scoped>
.vp-doc-version-badge {
  display: inline-block; vertical-align: middle; margin-left: 8px;
  font-size: 12px; font-weight: 500; padding: 2px 10px;
  border-radius: 999px; border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2); background: var(--vp-c-bg-soft);
}
</style>
