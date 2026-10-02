<script setup>
// 页面挂载后消费 sessionStorage 中的跨版本状态，迁移锚点/滚动/展开块。
import { onMounted, watch, ref } from 'vue'
import { useRoute } from 'vitepress'
import { readPendingState, clearPendingState, applyMigratedState } from '../../versioning/state-migration.js'
import { loadManifest, loadPageVersionMap, detectPageContext } from '../../versioning/runtime.js'
import { resolveMigrationClient } from '../../versioning/resolve-client.js'
import { getGrantedScopes } from '../../versioning/runtime.js'

const notes = ref([])
const route = useRoute()

async function restore() {
  const pending = readPendingState()
  if (!pending) return
  const { manifest } = await loadManifest()
  const pageMap = await loadPageVersionMap()
  if (!manifest) return
  const { version: toVersion, nodeId: toNodeId } = detectPageContext(route.path, pageMap)
  if (!toVersion) return

  // 按请求求路径：用来源 anchor/blocks 拿到逐跳映射结果
  const r = resolveMigrationClient(
    manifest, pending.fromVersion, toVersion, pending.nodeId,
    { anchor: pending.anchor, blockIds: pending.blocks, grantedScopes: getGrantedScopes() }
  )

  // 只在真正落到唯一目标且就是当前页面时恢复
  if (r.status === 'unique' && r.target?.path &&
      route.path.replace(/\/$/, '') === r.target.path.replace(/\/$/, '')) {
    const ns = await applyMigratedState({
      anchor: r.anchor,
      anchorNote: r.anchor == null && pending.anchor
        ? `锚点 #${pending.anchor} 无法迁移到 ${toVersion}（迁移表无映射或已删除）`
        : null,
      blockMap: r.blocks,
      fallbackRatio: pending.ratio,
      onNote: (n) => { notes.value = n }
    })
    notes.value = ns
  }
  clearPendingState()
}

onMounted(restore)
watch(() => route.path, () => { /* 初次导航即可；SPA 跳转由组件内处理 */ })
</script>

<template>
  <div v-if="notes.length" class="vp-state-notes">
    <div class="vp-state-notes-title">阅读状态迁移提示</div>
    <ul>
      <li v-for="(n, i) in notes" :key="i">{{ n }}</li>
    </ul>
    <button @click="notes = []">知道了</button>
  </div>
</template>

<style scoped>
.vp-state-notes {
  position: fixed; right: 16px; bottom: 16px; z-index: 80; max-width: 340px;
  background: var(--vp-c-bg); border: 1px solid var(--vp-c-divider);
  border-left: 4px solid var(--vp-c-brand); border-radius: 10px;
  padding: 12px 14px; font-size: 12.5px; box-shadow: 0 10px 30px rgba(0,0,0,.15);
}
.vp-state-notes-title { font-weight: 700; margin-bottom: 6px; }
.vp-state-notes ul { margin: 0; padding-left: 18px; color: var(--vp-c-text-2); }
.vp-state-notes button { margin-top: 8px; border: none; background: transparent; color: var(--vp-c-brand); cursor: pointer; }
</style>
