// 浏览器运行时：加载构建任务产出的、绑定 commit 的静态目录。
//
// - 页面的章节与术语索引全部来自版本 API 的构建产物（/version-data/manifest.json），
//   而非当前文档源码硬编码。
// - 读者授权范围来自登录态（演示用 localStorage：vp_demo_scopes，逗号分隔）。
// - manifest 拉取失败时标记 indexDegraded：UI 提示“索引重建失败/不可用”，
//   但 last-good 快照通常仍在；构建端原子发布保证不会发布半成品。

let manifestPromise = null
let pageVersionPromise = null

export function getGrantedScopes() {
  try {
    return (localStorage.getItem('vp_demo_scopes') || '').split(',').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export function setGrantedScopes(scopes) {
  try {
    localStorage.setItem('vp_demo_scopes', (scopes || []).join(','))
    window.dispatchEvent(new CustomEvent('vp-scopes-changed'))
  } catch { /* ignore */ }
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return await res.json()
}

/** @returns {Promise<{manifest:object|null, degraded:boolean, error?:string}>} */
export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetchJson('/version-data/manifest.json')
      .then((manifest) => ({ manifest, degraded: false }))
      .catch(async (err) => {
        // 尝试 last-good 指针（正常构建时两者一致；重建失败时它指向旧快照）
        try {
          const lastGood = await fetchJson('/version-data/last-good.json')
          const manifest = await fetchJson('/version-data/manifest.json')
          return { manifest, degraded: true, error: `索引不可用，已回退到 ${lastGood.commit.slice(0, 7)} 快照` }
        } catch {
          return { manifest: null, degraded: true, error: `版本索引暂不可用：${err.message}` }
        }
      })
  }
  return manifestPromise
}

export function loadPageVersionMap() {
  if (!pageVersionPromise) {
    pageVersionPromise = fetchJson('/version-data/page-version.json').catch(() => [])
  }
  return pageVersionPromise
}

/** 根据当前 URL 推断所在版本与稳定节点 ID */
export function detectPageContext(routePath, pageMap) {
  // 精确路径优先（旧链接的 legacyPaths 由 404 救治组件 resolveLegacyPath 处理）
  const clean = routePath.replace(/\.(html|md)$/, '').replace(/\/$/, '') || '/'
  const hit = pageMap.find((p) => stripExt(p.path) === clean)
  if (hit) return { version: hit.version, nodeId: hit.nodeId }

  // 前缀兜底（页面可能存在但尚未登记 API，例如演示页）
  const prefixes = [...new Set(pageMap.map((p) => p.pathPrefix))].sort((a, b) => b.length - a.length)
  for (const prefix of prefixes) {
    if (routePath.startsWith(prefix) && prefix !== '/') {
      const any = pageMap.find((p) => p.pathPrefix === prefix)
      return { version: any?.version || null, nodeId: null }
    }
  }
  // 根路径默认最新发布版（由 manifest 中 basePath==='/' 决定）
  return { version: null, nodeId: null }
}

function stripExt(p) {
  return p.replace(/\.(html|md)$/, '').replace(/\/$/, '') || '/'
}

/** 在 manifest 中通过 legacyPaths/当前 path 反查节点（旧链接深开场景） */
export function resolveLegacyPath(manifest, routePath, grantedScopes) {
  const clean = stripExt(routePath)
  for (const v of manifest.order) {
    for (const s of manifest.sections[v] || []) {
      const paths = [s.path, ...(s.legacyPaths || [])].map(stripExt)
      if (paths.includes(clean)) {
        return { version: v, section: s }
      }
    }
  }
  return null
}

export function visibleVersions(manifest, grantedScopes) {
  return manifest.versions.filter((v) => {
    if (v.status === 'draft') return false
    if (v.status === 'public') return true
    if (v.status === 'private') {
      return (v.scopes || []).every((s) => grantedScopes.includes(s))
    }
    return false
  })
}

export function canSeeSection(section, grantedScopes) {
  if (!section) return false
  if (section.status === 'draft') return false
  if (section.scope) {
    const need = Array.isArray(section.scope) ? section.scope : [section.scope]
    if (!need.every((s) => grantedScopes.includes(s))) return false
  }
  return true
}
