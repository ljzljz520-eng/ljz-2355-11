<script setup>
import { nextTick, onMounted, watch } from 'vue'
import { useRoute } from 'vitepress'
import { useVersionApi } from '../../versioning/version-api'

const route = useRoute()
const { state, loadRoot, consumeNavigationState, restoreUiState } = useVersionApi()

async function restore() {
  await nextTick()
  await loadRoot().catch(() => null)
  const saved = consumeNavigationState(route.path)
  if (saved) {
    state.notice = describeMigration(saved)
    restoreUiState(saved)
  }
}

function describeMigration(saved) {
  const labels = {
    'stable-node': '已切换到对应稳定文档节点。',
    split: '该章节已拆分，请确认打开的内容是否符合预期。',
    merge: '多个旧章节已合并到当前页面。',
    renamed: '页面已更名或迁移。',
    private: '目标内容属于私有范围。',
    fallback: '当前页没有稳定节点，已打开目标版本第一章。'
  }
  return labels[saved.relation] ?? '已完成版本迁移。'
}

onMounted(restore)
watch(() => route.path, restore)
</script>

<template>
  <Teleport to="body">
    <Transition name="version-notice">
      <div v-if="state.notice" class="version-notice" role="status">
        <span>{{ state.notice }}</span>
        <button type="button" aria-label="关闭提示" @click="state.notice = ''">×</button>
      </div>
    </Transition>
  </Teleport>
</template>
