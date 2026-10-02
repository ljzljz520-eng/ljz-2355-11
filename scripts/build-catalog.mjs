import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { buildIndexes, detectCycle, edgeKey, fullNodePath, nodeKey, resolveMigration } from '../docs/.vitepress/versioning/graph.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flags = new Set(args)
const strict = flags.has('--strict')
function flagValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const sourceArg = flagValue('--source')
const outArg = flagValue('--out')
const sourcePath = sourceArg ? path.resolve(root, sourceArg) : path.join(root, 'catalog/catalog.source.json')
const outDir = path.resolve(root, outArg ?? 'docs/public/version-api')
const docsDir = path.join(root, 'docs')

function pushDiagnostic(diagnostics, severity, code, message, details = {}) {
  diagnostics.push({ severity, code, message, ...details })
}

function git(args, allowFail = false) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    if (allowFail) return ''
    throw error
  }
}

async function readCatalog() {
  if (strict) {
    const dirty = git(['status', '--porcelain'], true)
    if (dirty) {
      const error = new Error(`严格构建要求干净工作区，避免未发布编辑进入读者目录。未提交文件：\n${dirty}`)
      error.code = 'DIRTY_WORKTREE'
      throw error
    }
  }

  let raw
  if (strict) {
    const committed = git(['show', `HEAD:${path.relative(root, sourcePath).replaceAll(path.sep, '/')}`], true)
    raw = committed || await readFile(sourcePath, 'utf8')
  } else {
    raw = await readFile(sourcePath, 'utf8')
  }

  try {
    return JSON.parse(raw)
  } catch (error) {
    const wrapped = new Error(`索引源不是有效 JSON：${error.message}`)
    wrapped.code = 'INVALID_CATALOG_JSON'
    throw wrapped
  }
}

function validate(catalog) {
  const diagnostics = []
  const indexes = buildIndexes(catalog)
  const maxHops = catalog.maxMigrationHops ?? 5

  if (!Array.isArray(catalog.releases) || catalog.releases.length === 0) {
    pushDiagnostic(diagnostics, 'error', 'EMPTY_RELEASES', '至少需要一个产品版本')
  }
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 10) {
    pushDiagnostic(diagnostics, 'error', 'INVALID_CHAIN_LIMIT', '迁移链上限必须是 1 到 10 之间的整数', { maxHops })
  }

  const releaseKeys = new Set()
  for (const release of catalog.releases ?? []) {
    if (releaseKeys.has(release.id)) pushDiagnostic(diagnostics, 'error', 'DUPLICATE_RELEASE', `版本 ${release.id} 重复`)
    releaseKeys.add(release.id)
    const routeBases = release.routeBase
      ? Object.values(release.routeBase)
      : Object.entries(release.localeBase ?? { 'zh-CN': '' }).map(([locale, prefix]) => `${release.basePath ?? ''}${prefix}`)
    for (const routeBase of routeBases) {
      if (routeBase !== '' && !routeBase.startsWith('/')) {
        pushDiagnostic(diagnostics, 'error', 'INVALID_BASE_PATH', `版本 ${release.id} 的 routeBase 必须为空或以 / 开头`)
      }
    }
  }

  const nodeKeys = new Set()
  for (const node of catalog.nodes ?? []) {
    const key = nodeKey(node.releaseId, node.locale, node.id)
    if (nodeKeys.has(key)) pushDiagnostic(diagnostics, 'error', 'DUPLICATE_NODE', `节点 ${key} 重复`)
    nodeKeys.add(key)
    if (!releaseKeys.has(node.releaseId)) {
      pushDiagnostic(diagnostics, 'error', 'UNKNOWN_NODE_RELEASE', `节点 ${key} 指向不存在的版本`)
    }
  }

  const edgeKeys = new Set()
  for (const [index, edge] of (catalog.edges ?? []).entries()) {
    const key = edgeKey(edge)
    if (edgeKeys.has(key)) pushDiagnostic(diagnostics, 'error', 'DUPLICATE_EDGE', `迁移边 ${key} 重复`, { edge: index })
    edgeKeys.add(key)

    const fromKey = nodeKey(edge.from.releaseId, edge.from.locale, edge.from.nodeId)
    const toKey = nodeKey(edge.to.releaseId, edge.to.locale, edge.to.nodeId)
    if (!indexes.nodes.has(fromKey)) {
      pushDiagnostic(diagnostics, 'error', 'MISSING_EDGE_SOURCE', `迁移边缺失源节点 ${fromKey}`, { edge: index })
    }
    if (!indexes.nodes.has(toKey)) {
      pushDiagnostic(diagnostics, 'error', 'MISSING_EDGE_TARGET', `迁移边缺失目标节点 ${toKey}`, { edge: index })
    }
    if (edge.from.releaseId === edge.to.releaseId) {
      pushDiagnostic(diagnostics, 'error', 'SAME_RELEASE_EDGE', `迁移边 ${key} 不能连接同一版本`, { edge: index })
    }
    if (fromKey === toKey) {
      pushDiagnostic(diagnostics, 'error', 'SELF_EDGE', `迁移边 ${key} 不能指向自身`, { edge: index })
    }

    const source = indexes.nodes.get(fromKey)
    for (const fromAnchor of Object.keys(edge.anchorMap ?? {})) {
      if (source && !source.anchors?.some((anchor) => anchor.id === fromAnchor)) {
        pushDiagnostic(diagnostics, 'error', 'UNKNOWN_SOURCE_ANCHOR', `迁移边 ${key} 的源锚点 ${fromAnchor} 不存在`, { edge: index })
      }
    }
    const target = indexes.nodes.get(toKey)
    for (const toAnchor of Object.values(edge.anchorMap ?? {})) {
      if (target && !target.anchors?.some((anchor) => anchor.id === toAnchor)) {
        pushDiagnostic(diagnostics, 'error', 'UNKNOWN_TARGET_ANCHOR', `迁移边 ${key} 的目标锚点 ${toAnchor} 不存在`, { edge: index })
      }
    }

    const targetRelease = indexes.releases.get(edge.to.releaseId)
    if (targetRelease?.visibility === 'private') {
      if (targetRelease.access === 'revoked') {
        pushDiagnostic(diagnostics, 'warning', 'PRIVATE_TARGET_REVOKED', `迁移边 ${key} 指向已撤权私有版；公开索引不会发布该边`, { edge: index })
      } else {
        pushDiagnostic(diagnostics, 'warning', 'PRIVATE_TARGET', `迁移边 ${key} 指向私有版，运行时必须二次鉴权`, { edge: index })
      }
    }
  }

  const cycle = detectCycle(catalog, indexes)
  if (cycle.cyclic) {
    pushDiagnostic(diagnostics, 'error', 'MIGRATION_CYCLE', '迁移图存在循环：' + cycle.cycle.join(' → '), { cycle: cycle.cycle })
  }

  const termKeys = new Set()
  for (const term of catalog.terms ?? []) {
    const key = `${term.releaseId}/${term.locale}/${term.id}`
    if (termKeys.has(key)) pushDiagnostic(diagnostics, 'error', 'DUPLICATE_TERM_ID', `术语 ${key} 重复`)
    termKeys.add(key)
    if (!releaseKeys.has(term.releaseId)) {
      pushDiagnostic(diagnostics, 'error', 'UNKNOWN_TERM_RELEASE', `术语 ${term.name} 指向不存在版本`)
    }
  }

  // Same display names are intentional; stable IDs must distinguish them.
  for (const release of catalog.releases ?? []) {
    for (const locale of ['zh-CN', 'en-US']) {
      const names = new Map()
      for (const term of (catalog.terms ?? []).filter((item) => item.releaseId === release.id && item.locale === locale)) {
        if (!names.has(term.name)) names.set(term.name, [])
        names.get(term.name).push(term.id)
      }
      for (const [name, ids] of names) {
        if (ids.length > 1) {
          pushDiagnostic(diagnostics, 'info', 'HOMONYM_TERM', `${release.id}/${locale} 的术语“${name}”存在重名，必须通过稳定 ID 选择`, { termIds: ids })
        }
      }
    }
  }

  for (const node of catalog.nodes ?? []) {
    const release = indexes.releases.get(node.releaseId)
    if (!release || release.visibility !== 'public') continue
    const relative = `${fullNodePath(release, node)}.md`.replace(/^\//, '')
    const file = path.join(docsDir, relative)
    if (!existsSync(file)) {
      pushDiagnostic(diagnostics, 'error', 'MISSING_DOC_FILE', `公开节点缺少 Markdown 文件：${relative}`, { file: relative })
    }
  }

  const latestPublicRelease = catalog.releases.find(
    (release) => release.status === 'latest' && release.visibility === 'public' && release.access === 'granted'
  )
  if (latestPublicRelease) {
    for (const node of catalog.nodes ?? []) {
      const release = indexes.releases.get(node.releaseId)
      if (!release || release.visibility !== 'public' || release.access !== 'granted' || node.releaseId === latestPublicRelease.id) continue
      const result = resolveMigration(catalog, node, latestPublicRelease.id, { maxHops: catalog.maxMigrationHops, indexes })
      if (result.status === 'missing-target') {
        pushDiagnostic(
          diagnostics,
          'warning',
          'NO_PATH_TO_LATEST',
          `${node.releaseId}/${node.locale}/${node.id} 没有通往 ${latestPublicRelease.id} 的迁移路径；切换时将提示读者手动选择。`
        )
      }
      if (result.chainLimitReached) {
        pushDiagnostic(
          diagnostics,
          'warning',
          'PATH_CHAIN_LIMIT_REACHED',
          `${node.releaseId}/${node.locale}/${node.id} 到 ${latestPublicRelease.id} 的部分路径超过迁移链上限。`
        )
      }
    }
  }

  return diagnostics
}

function publicView(catalog, commitSha, sourceType) {
  const publicReleases = catalog.releases.filter(
    (release) => release.visibility === 'public' && release.access === 'granted'
  )
  const publicIds = new Set(publicReleases.map((release) => release.id))
  const releaseDescriptors = publicReleases.map((release) => ({
    id: release.id,
    name: release.name,
    status: release.status,
    visibility: release.visibility,
    access: release.access,
    basePath: release.basePath ?? '',
    localeBase: release.localeBase,
    routeBase: release.routeBase,
    selectable: true,
    disabledReason: ''
  }))

  return {
    schemaVersion: catalog.schemaVersion,
    generatedAt: new Date().toISOString(),
    commit: commitSha,
    source: sourceType,
    maxMigrationHops: catalog.maxMigrationHops,
    releases: releaseDescriptors,
    catalogs: Object.fromEntries(
      publicReleases.map((release) => [
        release.id,
        `/version-api/releases/${release.id}/index.json?v=${commitSha}`
      ])
    ),
    glossary: Object.fromEntries(
      publicReleases.map((release) => [
        release.id,
        `/version-api/releases/${release.id}/glossary.json?v=${commitSha}`
      ])
    )
  }
}

async function writeOutputs(catalog, diagnostics, commitSha, sourceType) {
  await mkdir(outDir, { recursive: true })
  const rootIndex = publicView(catalog, commitSha, sourceType)
  await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify(rootIndex, null, 2)}\n`)

  for (const release of catalog.releases) {
    if (release.visibility !== 'public') continue
    const releaseDir = path.join(outDir, 'releases', release.id)
    await mkdir(releaseDir, { recursive: true })
    const nodes = catalog.nodes.filter((node) => node.releaseId === release.id)
    const edges = catalog.edges.filter(
      (edge) => edge.from.releaseId === release.id && catalog.releases.some(
        (candidate) => candidate.id === edge.to.releaseId && candidate.visibility === 'public'
      )
    )
    const payload = {
      commit: commitSha,
      source: sourceType,
      release: {
        id: release.id,
        name: release.name,
        status: release.status,
        basePath: release.basePath ?? '',
        localeBase: release.localeBase,
        routeBase: release.routeBase
      },
      chapters: chaptersFromNodes(nodes),
      edges
    }
    await writeFile(path.join(releaseDir, 'index.json'), `${JSON.stringify(payload, null, 2)}\n`)

    const glossary = {
      commit: commitSha,
      source: sourceType,
      releaseId: release.id,
      terms: catalog.terms.filter((term) => term.releaseId === release.id)
    }
    await writeFile(path.join(releaseDir, 'glossary.json'), `${JSON.stringify(glossary, null, 2)}\n`)
  }

  await mkdir(path.join(root, 'catalog'), { recursive: true })
  const manifest = {
    generatedAt: rootIndex.generatedAt,
    commit: commitSha,
    source: sourceType,
    outDir: path.relative(root, outDir),
    diagnostics
  }
  await writeFile(path.join(root, 'catalog/build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

function chaptersFromNodes(nodes) {
  const map = new Map()
  for (const node of nodes) {
    if (!map.has(node.locale)) map.set(node.locale, new Map())
    const localeMap = map.get(node.locale)
    if (!localeMap.has(node.chapter)) localeMap.set(node.chapter, [])
    localeMap.get(node.chapter).push({
      id: node.id,
      title: node.title,
      path: node.path,
      anchors: node.anchors
    })
  }
  return [...map.entries()].map(([locale, chapterMap]) => ({
    locale,
    groups: [...chapterMap.entries()].map(([chapter, items]) => ({
      chapter,
      items: items.sort((a, b) => a.path.localeCompare(b.path))
    }))
  }))
}

async function main() {
  const commitSha = git(['rev-parse', 'HEAD'], true) || 'no-git'
  const catalog = await readCatalog()
  const diagnostics = validate(catalog)
  const errors = diagnostics.filter((item) => item.severity === 'error')
  if (errors.length) {
    console.error(JSON.stringify(diagnostics, null, 2))
    const error = new Error(`索引重建失败：${errors.length} 个错误`)
    error.code = 'CATALOG_VALIDATION_FAILED'
    error.diagnostics = diagnostics
    throw error
  }
  await writeOutputs(catalog, diagnostics, commitSha, strict ? 'HEAD' : 'working-tree')
  for (const diagnostic of diagnostics) {
    const logger = diagnostic.severity === 'warning' ? console.warn : console.info
    logger(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`)
  }
  console.log(`版本目录已生成：${path.relative(root, outDir)} @ ${commitSha}`)
}

main().catch((error) => {
  console.error(error.message)
  if (error.diagnostics) process.exitCode = 2
  else process.exitCode = 1
})
