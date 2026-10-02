<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vitepress'
import {
  loadManifest, loadPageVersionMap, detectPageContext, visibleVersions,
  canSeeSection, getGrantedScopes
} from '../../versioning/runtime.js'
import { capturePendingState } from '../../versioning/state-migration.js'
import { resolveMigrationClient } from '../../versioning/resolve-client.js'

const route = useRoute()
const manifest = ref(null)
const degraded = ref(false)
const degradedNote = ref('')
const pageMap = ref([])
const scopes = ref([])
const open = ref(false)
const chooser = ref(null) // { targetVersion, result, fromVersion, nodeId }
const notice = ref(null)

const current = computed(() =>
  manifest.value ? detectPageContext(route.path, pageMap.value) : { version: null, nodeId: null })

const currentVersion = computed(() =>
  manifest.value?.versions.find((v) => v.version === current.value.version) || null)

const options = computed(() => manifest.value ? visibleVersions(manifest.value, scopes.value) : [])

onMounted(async () => {
  scopes.value = getGrantedScopes()
  const m = await loadManifest()
  manifest.value = m.manifest
  degraded.value = m.degraded
  degradedNote.value = m.error || ''
  pageMap.value = await loadPageVersionMap()
  window.addEventListener('vp-scopes-changed', () => { scopes.value = getGrantedScopes() })
})

watch(() => route.path, () => { chooser.value = null; notice.value = null })

function statusTag(v) {
  if (v.status === 'private') return { text: '私有', cls: 'tag-private' }
  if (manifest.value?.versions.filter((x) => x.status === 'public').every((x) =>
      compareLoose(x.version, v.version) <= 0)) return { text: '最新', cls: 'tag-latest' }
  if (isOlder(v)) return { text: '旧版', cls: 'tag-old' }
  return null
}

function isOlder(v) {
  const pub = manifest.value.versions.filter((x) => x.status === 'public')
  const latest = pub[pub.length - 1]
  return latest && compareLoose(v.version, latest.version) < 0
}

function compareLoose(a, b) {
  const pa = String(a).replace(/[^\d.]/g, '').split('.').map(Number)
  const pb = String(b).replace(/[^\d.]/g, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

function chooseTarget(targetVersion) {
  open.value = false
  const { version: fromVersion, nodeId } = current.value
  if (!manifest.value) return
  if (!nodeId) {
    // 当前页面未登记到版本 API：去该版本的入口
    const v = manifest.value.versions.find((x) => x.version === targetVersion)
    location.href = v?.basePath || '/'
    return
  }
  const anchor = (location.hash || '').replace(/^#/, '') || null
  const blocks = [...document.querySelectorAll('details[data-block-id][open]')].map((el) => el.dataset.blockId)
  const result = resolveMigrationClient(manifest.value, fromVersion, targetVersion, nodeId, {
    anchor, blockIds: blocks, grantedScopes: scopes.value
  })
  capturePendingState(fromVersion, nodeId, { anchor, blocks })

  if (result.status === 'unique') {
    const t = result.target
    const targetSection = (manifest.value.sections[targetVersion] || []).find((s) => s.id === t.nodeId)
    if (targetSection && !canSeeSection(targetSection, scopes.value)) {
      notice.value = { kind: 'no-access', text: `无法打开：${targetSection.title} 在 ${targetVersion} 中不可见（权限不足或未发布）。` }
      return
    }
    const hash = result.anchor ? `#${result.anchor}` : ''
    saveBlocksForTarget(result.blocks)
    location.href = `${t.path}${hash}`
    return
  }
  if (result.status === 'choose') {
    chooser.value = { targetVersion, result, fromVersion, nodeId, blocks }
    return
  }
  // removed / unmapped / no-access / error：明确理由，不做猜测式跳转
  notice.value = { kind: result.status, text: result.reason || '无法在目标版本找到对应内容' }
}

function saveBlocksForTarget(blocks) {
  try {
    sessionStorage.setItem('vp-pending-blocks', JSON.stringify(blocks || []))
  } catch { /* ignore */ }
}

function pickCandidate(c) {
  const targetSection = (manifest.value.sections[chooser.value.targetVersion] || []).find((s) => s.id === c.nodeId)
  if (targetSection && !canSeeSection(targetSection, scopes.value)) {
    notice.value = { kind: 'no-access', text: `无法打开：${targetSection.title} 需要额外权限。` }
    chooser.value = null
    return
  }
  const hash = c.anchor ? `#${c.anchor}` : ''
  location.href = `${c.path}${hash}`
}

function candidateVisible(c) {
  const targetSection = (manifest.value.sections[chooser.value.targetVersion] || []).find((s) => s.id === c.nodeId)
  return canSeeSection(targetSection, scopes.value)
}
</script>

<template>
  <div class="vp-version-switcher">
    <button class="vp-version-trigger" :class="{ open }" @click="open = !open">
      <span class="vp-version-icon">⌖</span>
      <span class="vp-version-label">{{ currentVersion?.label || '文档版本' }}</span>
      <span v-if="currentVersion" class="vp-version-tag" :class="statusTag(currentVersion)?.cls">{{ statusTag(currentVersion)?.text }}</span>
      <span class="vp-version-caret">▾</span>
    </button>

    <div v-if="open" class="vp-version-menu" @mouseleave="open = false">
      <div class="vp-version-menu-title">切换文档版本</div>
      <div v-if="degraded" class="vp-version-degraded">⚠ {{ degradedNote || '版本索引正在重建，当前结果可能不是最新' }}</div>
      <button
        v-for="v in options"
        :key="v.version"
        class="vp-version-item"
        :class="{ active: v.version === current.version }"
        @click="chooseTarget(v.version)"
      >
        <span class="vp-version-item-label">{{ v.label }}</span>
        <span v-if="statusTag(v)" class="vp-version-tag" :class="statusTag(v).cls">{{ statusTag(v).text }}</span>
      </button>
      <div class="vp-version-menu-foot">
        目录构建：{{ manifest?.build?.commit?.slice(0, 7) || '—' }}
      </div>
    </div>

    <div v-if="notice" class="vp-version-notice" :class="`notice-${notice.kind}`">
      <span>{{ notice.text }}</span>
      <button @click="notice = null">×</button>
    </div>

    <!-- 一对多：读者选择对应内容 -->
    <div v-if="chooser" class="vp-chooser-mask" @click.self="chooser = null">
      <div class="vp-chooser">
        <h4>该章节在 {{ chooser.targetVersion }} 中已拆分</h4>
        <p class="vp-chooser-reason">{{ chooser.result.reason }}</p>
        <p class="vp-chooser-hint">系统不会仅按标题相同自动跳转，请选择你要查看的内容：</p>
        <div class="vp-chooser-list">
          <button v-for="c in chooser.result.candidates" :key="c.nodeId"
                  class="vp-chooser-option" :disabled="!candidateVisible(c)"
                  @click="pickCandidate(c)">
            <span class="vp-chooser-title">{{ c.title }}</span>
            <span class="vp-chooser-path">{{ c.path }}</span>
            <span v-if="!candidateVisible(c)" class="vp-chooser-locked">🔒 无权限 / 未发布</span>
          </button>
        </div>
        <button class="vp-chooser-cancel" @click="chooser = null">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vp-version-switcher { position: relative; }
.vp-version-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border: 1px solid var(--vp-c-divider);
  border-radius: 8px; background: transparent; color: var(--vp-c-text-1);
  font-size: 13px; cursor: pointer;
}
.vp-version-trigger:hover, .vp-version-trigger.open { border-color: var(--vp-c-brand); }
.vp-version-icon { opacity: .7; }
.vp-version-caret { font-size: 10px; opacity: .6; }
.vp-version-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 999px; line-height: 1.5;
}
.tag-latest { background: rgba(64,158,255,.12); color: var(--vp-c-brand); }
.tag-old { background: rgba(144,147,153,.16); color: var(--vp-c-text-2); }
.tag-private { background: rgba(230,162,60,.16); color: #b8841f; }
.vp-version-menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 30;
  min-width: 240px; padding: 8px; border: 1px solid var(--vp-c-divider);
  border-radius: 12px; background: var(--vp-c-bg);
  box-shadow: 0 8px 30px rgba(0,0,0,.12);
}
.vp-version-menu-title { font-size: 12px; color: var(--vp-c-text-2); padding: 4px 8px; }
.vp-version-degraded { font-size: 12px; color: #b8841f; padding: 6px 8px; }
.vp-version-item {
  display: flex; width: 100%; align-items: center; justify-content: space-between;
  gap: 8px; padding: 8px 10px; border: none; background: transparent;
  border-radius: 8px; color: var(--vp-c-text-1); cursor: pointer; text-align: left;
}
.vp-version-item:hover { background: var(--vp-c-bg-soft); }
.vp-version-item.active { color: var(--vp-c-brand); font-weight: 600; }
.vp-version-menu-foot { margin-top: 6px; padding: 6px 8px 2px; border-top: 1px solid var(--vp-c-divider);
  font-size: 11px; color: var(--vp-c-text-2); }
.vp-version-notice {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40; width: 300px;
  padding: 10px 12px; border-radius: 10px; font-size: 12.5px;
  background: var(--vp-c-bg); border: 1px solid var(--vp-c-divider);
  box-shadow: 0 8px 30px rgba(0,0,0,.12); display: flex; gap: 8px; justify-content: space-between;
}
.vp-version-notice button { border: none; background: transparent; cursor: pointer; color: inherit; }
.notice-removed, .notice-unmapped { border-left: 3px solid #e6a23c; }
.notice-no-access { border-left: 3px solid #f56c6c; }
.notice-error { border-left: 3px solid #f56c6c; }
.vp-chooser-mask {
  position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,.35);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.vp-chooser {
  width: min(520px, 100%); background: var(--vp-c-bg); border-radius: 14px;
  padding: 20px 22px; box-shadow: 0 20px 60px rgba(0,0,0,.25);
}
.vp-chooser h4 { margin: 0 0 8px; }
.vp-chooser-reason { color: var(--vp-c-text-2); font-size: 13px; margin: 4px 0; }
.vp-chooser-hint { font-size: 12.5px; color: var(--vp-c-text-2); }
.vp-chooser-list { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.vp-chooser-option {
  display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; text-align: left;
  padding: 10px 12px; border: 1px solid var(--vp-c-divider); border-radius: 10px;
  background: transparent; cursor: pointer; color: inherit;
}
.vp-chooser-option:not(:disabled):hover { border-color: var(--vp-c-brand); background: var(--vp-c-bg-soft); }
.vp-chooser-option:disabled { opacity: .55; cursor: not-allowed; }
.vp-chooser-title { font-weight: 600; }
.vp-chooser-path { grid-column: 1; font-size: 12px; color: var(--vp-c-text-2); }
.vp-chooser-locked { grid-row: 1 / span 2; grid-column: 2; align-self: center; font-size: 12px; color: #f56c6c; }
.vp-chooser-cancel { border: none; background: transparent; color: var(--vp-c-text-2); cursor: pointer; }
</style>
