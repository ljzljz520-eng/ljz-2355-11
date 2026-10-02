<script setup>
// 旧链接深开：读者可能收藏了 /v1/install.html、/zh/install、/components/modal 等旧路径。
// 404 时不直接“按标题猜”，而是：
//   1) 在所有版本的 legacyPaths 精确命中；
//   2) 命中后沿迁移边找“当前推荐版本”的落点；
//   3) 拆分 => 列出候选让读者选；缺失/下线/无权限 => 给明确理由。
import { ref, onMounted } from 'vue'
import {
  loadManifest, resolveLegacyPath, visibleVersions, getGrantedScopes
} from '../../versioning/runtime.js'
import { resolveMigrationClient } from '../../versioning/resolve-client.js'

const result = ref({ status: 'loading' })
const scopes = ref([])

onMounted(async () => {
  scopes.value = getGrantedScopes()
  const { manifest } = await loadManifest()
  if (!manifest) {
    result.value = { status: 'error', text: '版本索引暂不可用，无法解析旧链接' }
    return
  }
  const path = location.pathname
  const hit = resolveLegacyPath(manifest, path, scopes.value)
  if (!hit) {
    result.value = { status: 'none', text: path }
    return
  }
  const visible = visibleVersions(manifest, scopes.value)
  // 推荐落点：最新公开版
  const latest = visible.filter((v) => v.status === 'public').pop()
  if (!latest) {
    result.value = { status: 'error', text: '没有可访问的已发布版本' }
    return
  }
  const r = resolveMigrationClient(manifest, hit.version, latest.version, hit.section.id, {
    grantedScopes: scopes.value,
    anchor: (location.hash || '').replace(/^#/, '') || null
  })
  result.value = {
    status: r.status,
    reason: r.reason,
    fromVersion: hit.version,
    fromTitle: hit.section.title,
    toVersion: latest.version,
    target: r.target,
    candidates: r.candidates || [],
    anchorNote: r.diagnostics?.find((d) => d.code === 'ANCHOR_LOST')?.note || null,
    text: path
  }
})
</script>

<template>
  <div class="vp-legacy-resolver">
    <div v-if="result.status === 'loading'" class="vp-lr-card">正在版本索引中查找该旧链接…</div>

    <div v-else-if="result.status === 'unique'" class="vp-lr-card">
      <h4>找到了该页面的新版本位置</h4>
      <p>旧链接属于 {{ result.fromVersion }} 的「{{ result.fromTitle }}」，最新版对应页面：</p>
      <a class="vp-lr-go" :href="result.target.path + (result.anchor ? '#' + result.anchor : '')">
        {{ result.target.title || result.target.nodeId }} · {{ result.toVersion }} →
      </a>
      <p v-if="result.anchorNote" class="vp-lr-note">⚠ {{ result.anchorNote }}</p>
    </div>

    <div v-else-if="result.status === 'choose'" class="vp-lr-card">
      <h4>该页面在新版中已拆分</h4>
      <p>「{{ result.fromTitle }}」在 {{ result.toVersion }} 中有多个对应章节，请选择：</p>
      <ul class="vp-lr-list">
        <li v-for="c in result.candidates" :key="c.nodeId">
          <a :href="c.path + (c.anchor ? '#' + c.anchor : '')">{{ c.title }} <code>{{ c.path }}</code></a>
        </li>
      </ul>
    </div>

    <div v-else-if="result.status === 'removed'" class="vp-lr-card vp-lr-warn">
      <h4>该内容已下线</h4>
      <p>{{ result.reason || '对应章节在目标版本被移除。' }}</p>
    </div>

    <div v-else-if="result.status === 'no-access'" class="vp-lr-card vp-lr-warn">
      <h4>对应内容存在，但你无权访问</h4>
      <p>{{ result.reason }}</p>
    </div>

    <div v-else-if="result.status === 'unmapped'" class="vp-lr-card vp-lr-warn">
      <h4>无法映射到现有文档</h4>
      <p>{{ result.reason || '该旧链接没有对应的迁移记录。' }}</p>
      <a href="/">返回文档首页</a>
    </div>

    <div v-else-if="result.status === 'error'" class="vp-lr-card vp-lr-warn">
      <h4>解析失败</h4>
      <p>{{ result.text }}</p>
    </div>
  </div>
</template>

<style scoped>
.vp-legacy-resolver { margin: 24px 0; }
.vp-lr-card {
  border: 1px solid var(--vp-c-divider); border-radius: 12px; padding: 18px 20px;
  background: var(--vp-c-bg-soft);
}
.vp-lr-card h4 { margin: 0 0 8px; }
.vp-lr-card p { color: var(--vp-c-text-2); font-size: 14px; }
.vp-lr-go {
  display: inline-block; margin-top: 6px; font-weight: 700; font-size: 15px;
  color: var(--vp-c-brand);
}
.vp-lr-list { padding-left: 18px; display: flex; flex-direction: column; gap: 8px; }
.vp-lr-list code { font-size: 12px; color: var(--vp-c-text-2); }
.vp-lr-warn { border-left: 4px solid #e6a23c; }
.vp-lr-note { font-size: 12.5px; color: #b8841f; }
</style>
