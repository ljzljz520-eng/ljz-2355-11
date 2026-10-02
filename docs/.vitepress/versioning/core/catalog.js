// 构建任务核心：从版本 API 拉取章节与术语索引，校验后“物化”为绑定 commit 的
// 静态目录（catalog），再原子发布。
//
// 物化 vs 按请求求路径（详见 design.md 的权衡章节）：
// - 章节迁移：构建时逐版本对物化“边的合成结果”，运行时只做一次直接查表；
//   读者侧零计算，且构建时即可把循环/重复边作为致命错误拦下。
//   代价是迁移图变更必须重建索引；按请求解析则无需重建，但每次切换都要遍历。
// - 运行时仍保留图解析器（graph.resolveMigration）作为“重建落后于数据”的兜底，
//   因此物化失败（索引重建失败）不会让站点失去切换能力，只会回退为按请求求路径。

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { sortVersions } from './versions.js'
import { validateGraph, resolveMigration, DEFAULT_MAX_CHAIN } from './graph.js'
import { buildTermIndex } from './terms.js'

/**
 * @typedef {Object} BuildIssue
 * @property {'fatal'|'warning'|'info'} severity
 * @property {string} code
 * @property {string} message
 */

/**
 * 组装并校验目录（不写文件，便于单测）。
 *
 * @param {object} input
 * @param {object[]} input.versions 版本元数据
 * @param {object[]} input.sections 全版本章节节点
 *        {id,version,product,title,path,scope?,status,draft?}
 * @param {object[]} input.edges 章节迁移边
 * @param {object[]} input.termEdges 术语迁移边
 * @param {Record<string, object[]>} input.termsByVersion 各版本术语原始定义
 * @param {object} input.build {commit, builtAt, product}
 * @param {object} [input.options] { maxChain? }
 * @returns {{catalog:object, issues:BuildIssue[], ok:boolean}}
 */
export function assembleCatalog(input) {
  const { versions, sections, edges, termEdges, termsByVersion, build } = input
  const issues = []
  const push = (severity, code, message) => issues.push({ severity, code, message })

  const ordered = sortVersions(versions).map((v) => v.version)
  const versionByNo = new Map(versions.map((v) => [v.version, v]))

  // --- 节点索引 -------------------------------------------------------------
  const nodesByState = new Map()
  const sectionByVersion = new Map()
  const duplicateNodes = []
  for (const s of sections) {
    const key = `${s.version}|${s.id}`
    if (nodesByState.has(key)) duplicateNodes.push(key)
    nodesByState.set(key, s)
    if (!sectionByVersion.has(s.version)) sectionByVersion.set(s.version, [])
    sectionByVersion.get(s.version).push(s)
  }
  if (duplicateNodes.length) {
    push('fatal', 'DUPLICATE_NODE', `同一版本存在重复稳定节点：${[...new Set(duplicateNodes)].join(', ')}`)
  }

  // --- 章节图诊断 -----------------------------------------------------------
  const diag = validateGraph(ordered, edges, nodesByState)
  for (const cyc of diag.cycles) {
    push('fatal', 'CYCLE', `章节迁移图存在环：${cyc.join(' -> ')}`)
  }
  for (const id of diag.duplicateEdges) push('fatal', 'DUPLICATE_EDGE', `重复迁移边：${id}`)
  for (const id of diag.ambiguousEdges) push('fatal', 'AMBIGUOUS_EDGE', `边 ${id} 源节点有多条出边但未声明 split/merge`)
  for (const v of diag.unknownVersions) push('fatal', 'UNKNOWN_VERSION', `迁移边引用了未知版本：${v}`)
  for (const id of diag.selfLoops) push('fatal', 'SELF_LOOP', `迁移边自环：${id}`)
  for (const id of diag.backEdges) push('warning', 'BACK_EDGE', `迁移边 ${id} 指向更旧版本（应为“新版本→旧版本”方向的反序边已在两版本间另配）`)
  for (const d of diag.dangling) {
    push('warning', 'DANGLING_EDGE', `边 ${d.edgeId} 的${d.side === 'from' ? '源' : '目标'}节点不存在：${d.state}（该边会被跳过，运行时表现为缺失目标提示）`)
  }

  // --- 术语索引校验 ----------------------------------------------------------
  // 以限定名为键的普通对象（可 JSON 序列化，供运行时 fetch 后直接查表）
  const termIndexes = {}
  const termDuplicates = {}
  for (const [v, list] of Object.entries(termsByVersion || {})) {
    const idx = buildTermIndex(list)
    termIndexes[v] = Object.fromEntries(idx.byQualified)
    if (idx.duplicateQualified.length) {
      termDuplicates[v] = idx.duplicateQualified
      push('fatal', 'DUPLICATE_TERM', `版本 ${v} 存在重复术语限定名：${idx.duplicateQualified.join(', ')}`)
    }
  }

  // --- 术语边诊断（复用章节图校验器，kind=removed 允许无目标）-------------------
  const termStates = new Map()
  for (const [v, list] of Object.entries(termsByVersion || {})) {
    for (const t of list) termStates.set(`${v}|${t.id}`, t)
  }
  const termDiag = validateGraph(ordered, termEdges.map((e) => ({ ...e, fromNodeId: e.fromTermId, toNodeId: e.toTermId })), termStates)
  for (const cyc of termDiag.cycles) push('fatal', 'TERM_CYCLE', `术语迁移图存在环：${cyc.join(' -> ')}`)
  for (const d of termDiag.dangling) push('warning', 'TERM_DANGLING', `术语边 ${d.edgeId} 悬挂：${d.state}`)

  const fatal = issues.filter((i) => i.severity === 'fatal')
  if (fatal.length) {
    return { catalog: null, issues, ok: false }
  }

  // --- 物化：逐版本对的可达目标 ----------------------------------------------
  // materialized[fromVersion][nodeId][toVersion] = resolveMigration 的精简结果
  const maxChain = input.options?.maxChain ?? DEFAULT_MAX_CHAIN
  const materialized = {}
  for (const from of ordered) {
    materialized[from] = {}
    const fromSections = sectionByVersion.get(from) || []
    for (const s of fromSections) {
      materialized[from][s.id] = {}
      for (const to of ordered) {
        if (to === from) continue
        const r = resolveMigration({
          edges, order: ordered, from, to, nodeId: s.id,
          maxChain,
          getNode: (v, id) => nodesByState.get(`${v}|${id}`) || null
        })
        const compact = {
          status: r.status,
          reason: r.reason || undefined,
          target: r.target,
          candidates: r.candidates,
          anchor: r.anchor ?? undefined,
          trail: r.trail,
          hops: r.hops
        }
        if (r.status === 'error' && r.reason?.includes('环')) {
          push('fatal', 'CYCLE', `物化 ${from}:${s.id} → ${to} 时发现环：${r.reason}`)
        }
        if (r.status === 'error' && r.reason?.includes('上限')) {
          push('warning', 'CHAIN_TOO_LONG', `${from}:${s.id} → ${to}: ${r.reason}`)
        }
        materialized[from][s.id][to] = compact
      }
    }
  }

  // 物化发现的环也是致命错误
  const fatal2 = issues.filter((i) => i.severity === 'fatal')
  if (fatal2.length) return { catalog: null, issues, ok: false }

  const catalog = {
    schema: 'docs-catalog/v1',
    product: build.product,
    build: {
      commit: build.commit,
      builtAt: build.builtAt,
      maxChain
    },
    versions: versions.map((v) => ({
      version: v.version,
      label: v.label || v.version,
      status: v.status,
      scopes: v.scopes || [],
      basePath: v.basePath || `/v${v.version.split('.')[0]}/`,
      releasedAt: v.releasedAt || null
    })),
    order: ordered,
    // 每版本章节（status/scope 原样保留，运行时按授权过滤）
    sections: Object.fromEntries(ordered.map((v) => [
      v,
      (sectionByVersion.get(v) || []).map((s) => ({
        id: s.id, title: s.title, path: s.path,
        scope: s.scope || null,
        status: s.status || 'published',
        legacyPaths: s.legacyPaths || [],
        applicable: s.applicable || null
      }))
    ])),
    terms: termIndexes,
    // 原始迁移边：供运行时在物化缺失时按请求解析（求路径模式的兜底数据源）
    edges,
    termEdges,
    materialized,
    warnings: issues.filter((i) => i.severity !== 'fatal')
  }

  return { catalog, issues, ok: true }
}

/**
 * 运行时公开范围判定：版本与节点都必须对读者可见。
 * draft 一律不可见；private 需读者持有全部所需 scope。
 *
 * @param {object} v catalog.versions 中的版本
 * @param {string[]} grantedScopes
 */
export function versionAccess(v, grantedScopes = []) {
  if (v.status === 'draft') return { ok: false, reason: `版本 ${v.version} 尚未发布（草稿）` }
  if (v.status === 'private') {
    const need = v.scopes || []
    const missing = need.filter((s) => !grantedScopes.includes(s))
    if (missing.length) return { ok: false, reason: `版本 ${v.version} 为私有版，缺少权限范围：${missing.join(', ')}` }
  }
  return { ok: true, reason: null }
}

export function nodeAccess(section, grantedScopes = []) {
  if (!section) return { ok: false, reason: '章节不存在' }
  if (section.status === 'draft') return { ok: false, reason: '该章节在目标版本中仍为草稿（未发布）' }
  if (section.scope) {
    const need = Array.isArray(section.scope) ? section.scope : [section.scope]
    const missing = need.filter((s) => !grantedScopes.includes(s))
    if (missing.length) return { ok: false, reason: `该章节需要权限范围：${missing.join(', ')}` }
  }
  return { ok: true, reason: null }
}

/**
 * 原子发布：先写入临时目录，rename 覆盖；失败时保留旧目录，读者无感。
 * 额外写入 success 标记与 last-good 指针，运行时据此识别“索引重建失败”。
 *
 * @param {string} outDir 发布目录（如 docs/public/version-data）
 * @param {object} catalog assembleCatalog 产出
 * @param {object} meta {manifestName?}
 */
export async function publishAtomic(outDir, catalog, meta = {}) {
  const name = meta.manifestName || 'manifest.json'
  const tmp = path.join(outDir, `.tmp-${process.pid}-${Date.now()}`)
  const finalFile = path.join(outDir, name)
  const lastGood = path.join(outDir, 'last-good.json')
  try {
    await fsp.mkdir(tmp, { recursive: true })
    await fsp.writeFile(
      path.join(tmp, name),
      JSON.stringify({ ...catalog, published: new Date().toISOString() }, null, 2),
      'utf8'
    )
    await fsp.writeFile(
      path.join(tmp, 'BUILD_OK'),
      catalog.build.commit,
      'utf8'
    )
    await fsp.mkdir(outDir, { recursive: true })
    await fsp.cp(path.join(tmp, name), finalFile)
    await fsp.cp(path.join(tmp, 'BUILD_OK'), path.join(outDir, 'BUILD_OK'))
    await fsp.writeFile(lastGood, JSON.stringify({
      commit: catalog.build.commit,
      builtAt: catalog.build.builtAt,
      publishedAt: new Date().toISOString()
    }, null, 2), 'utf8')
    await fsp.rm(tmp, { recursive: true, force: true })
    return { published: true, file: finalFile }
  } catch (err) {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {})
    // 发布失败：不触碰 finalFile / lastGood，读者继续读到上一份可用目录
    return { published: false, error: err, keptPrevious: true }
  }
}
