<script setup>
defineProps({
  scope: { type: String, required: true },
  replacement: { type: String, default: '' },
  replacementLink: { type: String, default: '' },
  reason: { type: String, default: '示例依赖旧版 API，不再适合作为当前产品版的复制入口。' }
})
</script>

<template>
  <aside class="outdated-notice" aria-label="过时示例提示">
    <strong>示例适用范围有限</strong>
    <p>本示例仅适用于：<code>{{ scope }}</code>。{{ reason }}</p>
    <p v-if="replacement">
      替代入口：
      <a v-if="replacementLink" :href="replacementLink">{{ replacement }}</a>
      <span v-else>{{ replacement }}</span>
    </p>
  </aside>
</template>
