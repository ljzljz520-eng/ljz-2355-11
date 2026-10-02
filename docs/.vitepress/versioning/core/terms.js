// 术语索引：每个产品版本有独立词典；悬浮解释只能取“被查看文档版本”的定义，
// 不能把当前最新词典的解释拼到历史文档上。
//
// 重名术语：同版本内 slug 相同但 scope 不同 => 合法，但必须以限定引用
// (slug@scope) 消除歧义；未限定 => ambiguous，由编辑器修正而不是替读者猜。

import { buildEdgeIndex, pairKey } from './graph.js'

/**
 * 构建单版本术语索引。
 * @param {{slug:string, scope?:string|null, title:string, body:string}[]} terms
 */
export function buildTermIndex(terms) {
  const bySlug = new Map()
  const byQualified = new Map()
  const duplicateQualified = []
  const seen = new Set()

  for (const t of terms) {
    if (!t || typeof t.slug !== 'string' || !t.slug) {
      throw new Error('术语缺少 slug')
    }
    const scope = t.scope || null
    const qualified = scope ? `${t.slug}@${scope}` : t.slug
    if (seen.has(qualified)) duplicateQualified.push(qualified)
    seen.add(qualified)
    byQualified.set(qualified, t)

    if (!bySlug.has(t.slug)) bySlug.set(t.slug, [])
    bySlug.get(t.slug).push(t)
  }

  return { bySlug, byQualified, duplicateQualified }
}

/**
 * 解析文档中的术语引用。
 *
 * @param {string} ref 形如 "token" 或 "token@css"
 * @param {ReturnType<buildTermIndex>} index 必须是“当前被查看版本”的索引
 * @returns {{status:'unique', term:object}
 *          |{status:'ambiguous', slug:string, scopes:string[]}
 *          |{status:'unknown', slug:string, qualified:string}}
 */
export function resolveTermRef(ref, index) {
  const [rawSlug, scopePart] = String(ref).split('@')
  const slug = rawSlug.trim()
  if (scopePart) {
    const qualified = `${slug}@${scopePart.trim()}`
    const t = index.byQualified.get(qualified)
    if (t) return { status: 'unique', term: t }
    return { status: 'unknown', slug, qualified }
  }
  const list = index.bySlug.get(slug)
  if (!list || list.length === 0) return { status: 'unknown', slug, qualified: slug }
  if (list.length === 1) return { status: 'unique', term: list[0] }
  // 同版本存在多个 scope 变体 => 必须显式 slug@scope，绝不替读者猜测
  return { status: 'ambiguous', slug, scopes: list.map((t) => t.scope) }
}

/**
 * 术语跨版本追踪：用于在切换版本后重新解析同一个术语引用。
 * 沿术语迁移边（term kind，可为 rename/split/merge/removed）逐跳合成，
 * 章节图的循环诊断、链长上限、缺失目标语义在这里同样适用（复用索引）。
 *
 * @param {object} p
 * @param {object[]} p.termEdges {id,fromVersion,toVersion,fromTermId,toTermId,kind,note?,anchorMap?}
 * @param {string[]} p.order
 * @param {string} p.from
 * @param {string} p.to
 * @param {string} p.termId 稳定术语 ID
 * @param {number} [p.maxChain]
 * @returns {{status:'unique'|'removed'|'unmapped'|'choose'|'error', termId?:string,
 *            reason?:string, candidates?:{termId:string}[], trail:string[], hops:number}}
 */
export function traceTerm({ termEdges, order, from, to, termId, maxChain = 8 }) {
  const fail = (reason, hops = 0) =>
    ({ status: 'unmapped', reason, trail: [], hops, candidates: [] })

  const i = order.indexOf(from)
  const j = order.indexOf(to)
  if (i === -1) return fail(`源版本 ${from} 不在版本链`)
  if (j === -1) return fail(`目标版本 ${to} 不在版本链（缺失目标版本）`)
  const path = i < j ? order.slice(i, j + 1) : order.slice(j, i + 1).reverse()

  const index = buildEdgeIndex(
    termEdges.map((e) => ({
      ...e,
      fromNodeId: e.fromTermId,
      toNodeId: e.toTermId
    }))
  )

  let branches = [{ ids: [{ v: from, id: termId }], alive: true, trail: [], hops: 0, note: null }]
  const diagnostics = []

  for (let h = 0; h < path.length - 1; h++) {
    const cur = path[h]
    const next = path[h + 1]
    const nextBranches = []
    for (const br of branches) {
      if (!br.alive) { nextBranches.push(br); continue }
      const head = br.ids[br.ids.length - 1]
      const es = index.get(`${pairKey(cur, next)}|${head.id}`) || []
      if (!es.length) {
        nextBranches.push({ ...br, alive: false, note: `${cur}→${next} 术语 ${head.id} 无迁移边` })
        continue
      }
      for (const e of es) {
        if (br.hops + 1 > maxChain) {
          nextBranches.push({ ...br, alive: false, outcome: 'too-long', note: `术语迁移链超过上限 ${maxChain}` })
          continue
        }
        if (e.kind === 'removed') {
          nextBranches.push({ ...br, alive: false, trail: [...br.trail, e.id], hops: br.hops + 1, removed: true, note: e.note || '该术语已下线' })
          continue
        }
        const key = `${next}|${e.toTermId}`
        const exactRepeat = br.ids.some((x) => `${x.v}|${x.id}` === key)
        // 语义环：termId 真正变过之后又回到更早版本出现过的旧 ID
        const seenIds = new Set(br.ids.map((x) => x.id))
        const changed = seenIds.size > 1
        const semanticLoop = changed && br.ids.some((x) => x.id === e.toTermId && x.v !== next)
        if (exactRepeat || semanticLoop) {
          diagnostics.push({ severity: 'fatal', code: 'TERM_CYCLE', edgeId: e.id })
          nextBranches.push({
            ...br, alive: false,
            note: exactRepeat
              ? `术语迁移环：${key}（边 ${e.id}）`
              : `术语迁移环：概念 ${e.toTermId} 在更名后又回到自身（边 ${e.id}）`
          })
          continue
        }
        nextBranches.push({
          ...br,
          ids: [...br.ids, { v: next, id: e.toTermId }],
          trail: [...br.trail, e.id],
          hops: br.hops + 1,
          note: e.note || br.note
        })
      }
    }
    branches = nextBranches
  }

  const alive = branches.filter((b) => b.alive)
  const ids = new Map()
  for (const b of alive) {
    const head = b.ids[b.ids.length - 1]
    if (head.v === to) ids.set(head.id, b)
  }
  const removed = branches.filter((b) => b.removed)

  if (ids.size === 1) {
    const [termId2, b] = [...ids.entries()][0]
    return { status: 'unique', termId: termId2, trail: b.trail, hops: b.hops }
  }
  if (ids.size > 1) {
    return {
      status: 'choose',
      reason: '该术语在目标版本拆分为多个概念，请选择',
      candidates: [...ids.keys()].map((id) => ({ termId: id })),
      trail: [], hops: alive[0]?.hops ?? 0
    }
  }
  if (removed.length) {
    return { status: 'removed', reason: removed[0].note, trail: removed[0].trail, hops: removed[0].hops }
  }
  const tooLong = branches.find((b) => b.outcome === 'too-long')
  if (tooLong) {
    return { status: 'error', reason: tooLong.note, trail: tooLong.trail || [], hops: tooLong.hops }
  }
  const dead = branches[0]
  if (diagnostics.some((d) => d.code === 'TERM_CYCLE')) {
    return { status: 'error', reason: dead?.note || '检测到术语迁移环', trail: [], hops: 0 }
  }
  return fail(dead?.note || `术语在版本 ${to} 中没有对应条目`, dead?.hops ?? 0)
}
