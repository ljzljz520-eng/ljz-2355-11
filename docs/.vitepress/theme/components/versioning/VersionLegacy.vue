<script setup>
// 过时示例容器：明确标注适用版本范围与替代入口，避免历史示例误导。
defineProps({
  range: { type: String, default: '' },
  alt: { type: String, default: '' }
})
</script>

<template>
  <div class="vp-legacy">
    <div class="vp-legacy-head">
      <span class="vp-legacy-badge">仅适用于 {{ range }}</span>
      <span v-if="alt" class="vp-legacy-alt">替代入口：<a :href="alt">{{ alt }}</a></span>
    </div>
    <div class="vp-legacy-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.vp-legacy {
  border: 1px solid #e6a23c55;
  border-left-width: 4px;
  border-radius: 10px;
  margin: 16px 0;
  background: rgba(230, 162, 60, .06);
  overflow: hidden;
}
.vp-legacy-head {
  display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
  padding: 8px 14px; font-size: 12.5px;
  border-bottom: 1px dashed #e6a23c55;
}
.vp-legacy-badge {
  font-weight: 700; color: #b8841f;
}
.vp-legacy-alt { color: var(--vp-c-text-2); }
.vp-legacy-body { padding: 12px 14px; }
.vp-legacy-body :deep(> :first-child) { margin-top: 0; }
.vp-legacy-body :deep(> :last-child) { margin-bottom: 0; }
</style>
