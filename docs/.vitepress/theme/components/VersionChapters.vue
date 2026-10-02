<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vitepress'
import { useVersionApi } from '../../versioning/version-api'
import { parseRoute } from '../../versioning/graph'

const route = useRoute()
const { state, loadRoot, loadCatalog } = useVersionApi()

const parsed = computed(() => state.root ? parseRoute(route.path, state.root.releases) : null)
const catalog = computed(() => parsed.value?.releaseId ? state.catalogs[parsed.value.releaseId] : null)
const groups = computed(() => {
  if (!catalog.value || !parsed.value) return []
  return catalog.value.chapters.find((item) => item.locale === parsed.value.locale)?.groups ?? []
})
const release = computed(() => state.root?.releases?.find((item) => item.id === parsed.value?.releaseId))

function href(item) {
  const localePrefix =
    release.value.routeBase?.[parsed.value.locale] ??
    `${release.value.basePath ?? ''}${release.value.localeBase?.[parsed.value.locale] ?? ''}`
  return `${localePrefix}${item.path}`
}

function isActive(item) {
  return route.path.split('#')[0] === href(item)
}

onMounted(async () => {
  try {
    await loadRoot()
    if (parsed.value?.releaseId) await loadCatalog(parsed.value.releaseId)
  } catch {
    // VersionChapters falls back to the static VitePress sidebar via empty rendering.
  }
})

watch(() => parsed.value?.releaseId, async (releaseId) => {
  if (releaseId && !state.catalogs[releaseId]) {
    try {
      await loadCatalog(releaseId)
    } catch {
      // Keep the last known sidebar; the version switcher renders the API error.
    }
  }
})
</script>

<template>
  <nav v-if="groups.length" class="version-chapters" :data-ready="true" aria-label="版本章节索引">
    <section v-for="group in groups" :key="group.chapter" class="version-chapters__group">
      <h2>{{ group.chapter }}</h2>
      <ul>
        <li v-for="item in group.items" :key="item.id">
          <RouterLink :class="{ active: isActive(item) }" :to="href(item)">
            {{ item.title }}
          </RouterLink>
          <ul v-if="item.anchors?.length" class="version-chapters__anchors">
            <li v-for="anchor in item.anchors" :key="anchor.id">
              <RouterLink :to="`${href(item)}#${anchor.id}`">{{ anchor.text }}</RouterLink>
            </li>
          </ul>
        </li>
      </ul>
    </section>
    <p v-if="state.loadingVersion" class="version-chapters__hint">正在加载章节索引…</p>
  </nav>
</template>
