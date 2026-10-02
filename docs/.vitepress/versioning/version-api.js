import { reactive } from 'vue'
import { withBase } from 'vitepress'
import {
  buildIndexes,
  findNodeByPath,
  parseRoute,
  releaseById,
  resolveMigration as resolveGraphMigration,
  fullNodePath
} from './graph'

const STATE_KEY = 'vp-version-navigation-state'
const STORAGE_KEY = 'vp-version-navigation-notice'
const apiBase = withBase('/version-api')

const cache = new Map()
const state = reactive({
  root: null,
  catalogs: {},
  glossaries: {},
  loadingRoot: false,
  rootError: '',
  loadingVersion: '',
  versionError: '',
  loadingTerms: '',
  termsError: '',
  modal: null,
  notice: ''
})

function currentPath() {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`版本 API 返回 ${response.status}`)
  return response.json()
}

async function loadRoot(force = false) {
  if (state.root && !force) return state.root
  if (state.loadingRoot) return state.root
  state.loadingRoot = true
  state.rootError = ''
  try {
    const root = await fetchJson(`${apiBase}/index.json`)
    state.root = root
    cache.set('root', root)
    return root
  } catch (error) {
    state.rootError = '无法加载版本索引，请稍后重试'
    throw error
  } finally {
    state.loadingRoot = false
  }
}

async function loadCatalog(releaseId) {
  if (state.catalogs[releaseId]) return state.catalogs[releaseId]
  const root = await loadRoot()
  const url = root.catalogs?.[releaseId]
  if (!url) {
    const release = releaseById(root.releases ?? [], releaseId)
    if (release?.visibility === 'private') {
      throw new Error(release.disabledReason || '该版本为私有版本')
    }
    throw new Error(`版本 ${releaseId} 没有公开索引`)
  }
  state.loadingVersion = releaseId
  state.versionError = ''
  try {
    const catalog = await fetchJson(url)
    state.catalogs[releaseId] = catalog
    return catalog
  } finally {
    state.loadingVersion = ''
  }
}

async function loadGlossary(releaseId) {
  if (state.glossaries[releaseId]) return state.glossaries[releaseId]
  const root = await loadRoot()
  const url = root.glossary?.[releaseId]
  if (!url) throw new Error(`版本 ${releaseId} 没有公开术语索引`)
  state.loadingTerms = releaseId
  state.termsError = ''
  try {
    const glossary = await fetchJson(url)
    state.glossaries[releaseId] = glossary
    return glossary
  } finally {
    state.loadingTerms = ''
  }
}

function describeCurrentRoute() {
  const routePath = currentPath()
  const parsed = parseRoute(routePath, state.root.releases)
  const release = releaseById(state.root.releases, parsed.releaseId)
  const currentCatalog = state.catalogs[parsed.releaseId]
  if (!release || !currentCatalog) {
    return { parsed, release: null, currentCatalog: null, node: null }
  }
  const nodes = flattenCatalogNodes(currentCatalog)
  const indexes = buildIndexes({ nodes })
  const node = findNodeByPath({ nodes }, indexes, parsed.releaseId, parsed.locale, parsed.path)
  return { parsed, release, currentCatalog, node }
}

async function resolveTarget(targetReleaseId, options = {}) {
  const root = await loadRoot()
  const targetRelease = releaseById(root.releases, targetReleaseId)
  if (!targetRelease) return { status: 'missing-target', candidates: [], message: '目标版本不存在' }
  if (targetRelease.visibility !== 'public') {
    return {
      status: 'access-denied',
      candidates: [],
      message: targetRelease.disabledReason || '目标版本需要访问授权'
    }
  }

  const parsedNow = parseRoute(currentPath(), root.releases)
  if (parsedNow.releaseId && root.releases.some((release) => release.id === parsedNow.releaseId && release.selectable)) {
    await loadCatalog(parsedNow.releaseId)
  }
  const { parsed, node } = options.current ?? describeCurrentRoute()
  if (!node) {
    const targetCatalog = await loadCatalog(targetReleaseId)
    const locale = parseRoute(currentPath(), root.releases).locale
    const fallback = targetCatalog.chapters
      .find((item) => item.locale === locale)
      ?.groups[0]?.items[0]
    if (!fallback) {
      return {
        status: 'missing-source',
        candidates: [],
        message: '当前页面不在版本章节索引中，且目标版本目录为空；无法自动迁移。'
      }
    }
    const targetReleaseNow = releaseById(root.releases, targetReleaseId)
    return {
      status: 'unique',
      candidates: [{
        target: { releaseId: targetReleaseId, locale, ...fallback },
        href: fullNodePath(targetReleaseNow, { locale, ...fallback }),
        hops: 0,
        relation: 'fallback',
        anchor: '',
        anchorStatus: 'no-anchor',
        anchorReason: '当前页没有稳定文档节点，已打开目标版本第一章。'
      }],
      message: '当前页面不在版本章节索引中，已打开目标版本第一章。'
    }
  }

  const publicIds = root.releases.filter((release) => release.selectable).map((release) => release.id)
  const catalogs = await Promise.all(publicIds.map((id) => loadCatalog(id)))
  const combined = {
    maxMigrationHops: root.maxMigrationHops,
    releases: root.releases,
    nodes: catalogs.flatMap((catalog) => flattenCatalogNodes(catalog)),
    edges: dedupeEdges(catalogs.flatMap((catalog) => catalog.edges ?? []))
  }

  const indexes = buildIndexes(combined)
  return resolveGraphMigration(
    combined,
    { releaseId: parsed.releaseId, locale: parsed.locale, id: node.id },
    targetReleaseId,
    { anchor: parsed.anchor, maxHops: root.maxMigrationHops, indexes }
  )
}

function flattenCatalogNodes(catalog) {
  return catalog.chapters.flatMap((group) =>
    group.groups.flatMap((section) =>
      section.items.map((item) => ({
        releaseId: catalog.release.id,
        locale: group.locale,
        chapter: section.chapter,
        ...item
      }))
    )
  )
}

function dedupeEdges(edges) {
  const map = new Map()
  for (const edge of edges) {
    const key = JSON.stringify([edge.from, edge.to])
    if (!map.has(key)) map.set(key, edge)
  }
  return [...map.values()]
}

function collectUiState() {
  const details = [...document.querySelectorAll('details[data-doc-state]')]
    .filter((element) => element.open)
    .map((element) => element.dataset.docState)
  return {
    scrollY: window.scrollY,
    openDetails: details,
    savedAt: Date.now()
  }
}

async function switchVersion(targetReleaseId, router, chosenCandidate = null) {
  try {
    const result = await resolveTarget(targetReleaseId)
    if (result.status === 'ambiguous' && !chosenCandidate) {
      state.modal = { targetReleaseId, result }
      return
    }
    if (result.status !== 'unique' && result.status !== 'ambiguous') {
      state.notice = result.message || explainStatus(result.status)
      return
    }

    const candidate = chosenCandidate ?? result.candidates[0]
    const { parsed, node } = describeCurrentRoute()
    sessionStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        source: {
          releaseId: parsed.releaseId,
          nodeId: node?.id,
          path: currentPath()
        },
        target: candidate.href,
        anchor: candidate.anchor,
        anchorStatus: candidate.anchorStatus,
        anchorReason: candidate.anchorReason,
        relation: candidate.relation,
        hops: candidate.hops,
        ...collectUiState()
      })
    )
    await router.go(candidate.href)
  } catch (error) {
    state.notice = error.message || '版本切换失败'
  }
}

function explainStatus(status) {
  return {
    'missing-target': '迁移边没有指向目标版本：请从目标版本目录重新选择。',
    'chain-limit': '迁移链超过上限，已停止自动追踪，避免无限重定向。',
    'access-denied': '目标版本未授权或权限已撤销。'
  }[status]
}

function consumeNavigationState(targetPath) {
  const raw = sessionStorage.getItem(STATE_KEY)
  if (!raw) return null
  try {
    const saved = JSON.parse(raw)
    const savedPath = saved.target.split('#')[0]
    if (targetPath.split('#')[0] !== savedPath) return null
    sessionStorage.removeItem(STATE_KEY)
    return saved
  } catch {
    sessionStorage.removeItem(STATE_KEY)
    return null
  }
}

function restoreUiState(saved) {
  requestAnimationFrame(() => {
    if (saved.anchorStatus === 'mapped') {
      const anchorElement = document.getElementById(saved.anchor)
      if (anchorElement) anchorElement.scrollIntoView({ block: 'start' })
      else window.scrollTo(0, saved.scrollY ?? 0)
    } else if (saved.anchorStatus === 'unmapped-anchor') {
      window.scrollTo(0, 0)
      state.notice = saved.anchorReason || '原锚点无法映射，已打开最接近的页面顶部'
    } else {
      window.scrollTo(0, saved.scrollY ?? 0)
    }

    for (const marker of saved.openDetails ?? []) {
      const element = document.querySelector(`details[data-doc-state="${CSS.escape(marker)}"]`)
      if (element) element.open = true
    }

    const missingDetails = (saved.openDetails ?? []).filter(
      (marker) => !document.querySelector(`details[data-doc-state="${CSS.escape(marker)}"]`)
    )
    if (missingDetails.length) {
      state.notice = `${state.notice ? `${state.notice}；` : ''}折叠区 ${missingDetails.join('、')} 在目标版本不存在，无法迁移展开状态`
    }
  })
}

async function resolveTerm(termId) {
  const root = await loadRoot()
  const parsed = parseRoute(currentPath(), root.releases)
  const releaseId = parsed.releaseId ?? root.releases.find((item) => item.basePath === '')?.id
  if (!releaseId) return { name: termId, definition: '', error: '无法识别当前文档版本' }
  const glossary = await loadGlossary(releaseId)
  const term = glossary.terms.find((item) => item.id === termId)
  if (!term) {
    return {
      name: termId,
      definition: '',
      error: `术语 ${termId} 不属于 ${releaseId} 的词典；不会使用当前版本解释历史文档`
    }
  }
  return term
}

function releaseHomePath(release) {
  const locale = typeof window !== 'undefined' && window.location.pathname.includes('/en/') ? 'en-US' : 'zh-CN'
  const prefix = release.routeBase?.[locale] ?? `${release.basePath ?? ''}${release.localeBase?.[locale] ?? ''}`
  return `${prefix}/`
}

export function useVersionApi() {
  return {
    state,
    apiBase,
    loadRoot,
    loadCatalog,
    loadGlossary,
    describeCurrentRoute,
    switchVersion,
    resolveTarget,
    consumeNavigationState,
    restoreUiState,
    resolveTerm,
    releaseHomePath,
    fullNodePath
  }
}
