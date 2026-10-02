// 浏览器端版本切换解析。
//
// 两种实现（design.md 中有完整权衡）：
// 1) 物化优先：直接查 catalog.materialized[from][nodeId][to]，O(1)，
//    这是构建任务预算好的结果，包含拆分/合并/删除/缺失/链上限/环的结论。
// 2) 按请求求路径：物化缺失时（如索引落后于 API），用原始 edges 实时运行
//    core/graph.resolveMigration，同时做公开范围过滤。
//
// 物化结果里没有运行时授权信息，因此 no-access 在组件层基于 sections 再判定；
// 锚点与折叠块映射是“源相关”的，必须按请求用当前 anchor/blocks 实时计算。

import { resolveMigration } from '../../versioning/core/graph.js'
import { canSeeSection } from './runtime.js'

/**
 * @param {object} manifest
 * @param {string} from
 * @param {string} to
 * @param {string} nodeId
 * @param {{anchor?:string|null, blockIds?:string[], grantedScopes?:string[]}} [opts]
 */
export function resolveMigrationClient(manifest, from, to, nodeId, opts = {}) {
  const { anchor = null, blockIds = [], grantedScopes = [] } = opts

  const getNode = (v, id) => {
    const s = (manifest.sections[v] || []).find((x) => x.id === id)
    return s || null
  }
  const visible = (v, id) => {
    const s = getNode(v, id)
    if (!s) return `目标章节 ${id} 在版本 ${v} 不存在（缺失目标）`
    if (s.status === 'draft') return `「${s.title}」在版本 ${v} 仍是草稿，尚未发布`
    if (s.scope) {
      const need = Array.isArray(s.scope) ? s.scope : [s.scope]
      const missing = need.filter((x) => !grantedScopes.includes(x))
      if (missing.length) return `「${s.title}」需要权限范围：${missing.join(', ')}（私有版撤权）`
    }
    return null
  }

  // 始终“按请求”运行一次以获得 anchor/blocks 的精确迁移；这也天然兼容物化缺失。
  // 若 manifest 没有原始边（生产裁剪场景），退回物化摘要。
  if (manifest.edges && manifest.edges.length) {
    const r = resolveMigration({
      edges: manifest.edges,
      order: manifest.order,
      from, to, nodeId,
      anchor, blockIds,
      maxChain: manifest.build?.maxChain,
      getNode, visible
    })
    return r
  }

  const m = manifest.materialized?.[from]?.[nodeId]?.[to]
  if (!m) {
    return { status: 'unmapped', reason: `版本索引中没有 ${from} → ${to} 关于节点 ${nodeId} 的记录`, candidates: [], blocks: [] }
  }
  // 物化模式：补做授权判定与锚点/块透传
  if (m.status === 'unique') {
    const reason = visible(to, m.target.nodeId)
    if (reason) return { status: 'no-access', reason, candidates: [], blocks: [] }
  }
  if (m.status === 'choose') {
    m.candidates = (m.candidates || []).map((c) => {
      const r = visible(to, c.nodeId)
      return r ? { ...c, locked: true, lockReason: r } : c
    })
  }
  return { ...m, blocks: blockIds.map((id) => ({ source: id, current: id, lostReason: null })) }
}
