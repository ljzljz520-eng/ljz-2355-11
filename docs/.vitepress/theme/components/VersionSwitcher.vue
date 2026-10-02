<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vitepress'
import { useVersionApi } from '../../versioning/version-api'
import { parseRoute } from '../../versioning/graph'

const route = useRoute()
const router = useRouter()
const { state, loadRoot, switchVersion } = useVersionApi()
const open = ref(false)

const currentReleaseId = computed(() => {
  if (!state.root) return ''
  return parseRoute(route.path, state.root.releases).releaseId
})
const currentRelease = computed(() => state.root?.releases?.find((item) => item.id === currentReleaseId.value))

onMounted(async () => {
  try {
    await loadRoot()
  } catch {
    // rootError is rendered in the switcher for readers.
  }
})

async function choose(releaseId) {
  open.value = false
  if (releaseId === currentReleaseId.value) return
  await switchVersion(releaseId, router)
}

async function chooseCandidate(candidate) {
  const releaseId = state.modal.targetReleaseId
  state.modal = null
  await switchVersion(releaseId, router, candidate)
}
</script>

<template>
  <div class="version-switcher" v-if="state.root || state.rootError">
    <button
      class="version-switcher__button"
      type="button"
      :disabled="state.loadingRoot"
      @click="open = !open"
      @blur="setTimeout(() => open = false, 120)"
    >
      <span>{{ currentRelease?.name ?? '版本' }}</span>
      <span class="version-switcher__chevron">▾</span>
    </button>
    <div v-if="state.rootError" class="version-switcher__error">{{ state.rootError }}</div>
    <div v-if="open && state.root" class="version-switcher__menu" role="menu">
      <button
        v-for="release in state.root.releases"
        :key="release.id"
        type="button"
        role="menuitem"
        class="version-switcher__item"
        :class="{ 'is-active': release.id === currentReleaseId, 'is-disabled': !release.selectable }"
        :disabled="!release.selectable"
        :title="release.disabledReason"
        @click="choose(release.id)"
      >
        <span>
          <strong>{{ release.name }}</strong>
          <small>{{ release.status }}</small>
        </span>
        <em v-if="release.id === currentReleaseId">当前</em>
        <em v-else-if="!release.selectable">无权限</em>
      </button>
    </div>

    <Teleport to="body">
      <div v-if="state.modal" class="version-modal__backdrop" @click.self="state.modal = null">
        <section class="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-modal-title">
          <header>
            <h2 id="version-modal-title">选择要打开的对应内容</h2>
            <button type="button" @click="state.modal = null" aria-label="关闭">×</button>
          </header>
          <p>原章节在目标版本拆成多个页面。标题相同不足以确定语义，请按你想阅读的内容选择：</p>
          <div class="version-modal__options">
            <button
              v-for="candidate in state.modal.result.candidates"
              :key="candidate.href"
              type="button"
              class="version-modal__option"
              @click="chooseCandidate(candidate)"
            >
              <strong>{{ candidate.target.title }}</strong>
              <span>{{ candidate.reason }}</span>
              <small>{{ candidate.href }} · {{ candidate.hops }} 跳迁移</small>
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>
