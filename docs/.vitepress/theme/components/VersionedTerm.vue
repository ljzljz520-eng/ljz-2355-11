<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vitepress'
import { useVersionApi } from '../../versioning/version-api'

const props = defineProps({
  id: { type: String, required: true }
})
const route = useRoute()
const { state, loadRoot, resolveTerm } = useVersionApi()
const term = ref(null)
const loading = ref(false)
const error = ref('')

async function load() {
  if (typeof window === 'undefined') return
  loading.value = true
  error.value = ''
  try {
    await loadRoot()
    term.value = await resolveTerm(props.id)
    if (term.value.error) error.value = term.value.error
  } catch (caught) {
    error.value = caught.message || '术语索引加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => route.path, load)
</script>

<template>
  <span class="versioned-term" tabindex="0" :data-term-id="id">
    <slot>{{ term?.name ?? id }}</slot>
    <span class="versioned-term__tip" role="tooltip">
      <template v-if="loading">正在读取当前产品版词典…</template>
      <template v-else-if="error">{{ error }}</template>
      <template v-else-if="term">
        <strong>{{ term.name }}</strong>
        <small>稳定术语 ID：{{ term.id }}</small>
        {{ term.definition }}
      </template>
    </span>
  </span>
</template>
