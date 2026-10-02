// 迁移图：章节（以及术语）在版本之间的映射解析
//
// 关键原则（对应需求）：
// 1. 只按“稳定节点 ID + 迁移边”跳转，绝不按标题相同跳转——标题在不同版本可能恰好
//    相同但内容已分叉（章节拆分场景）。
// 2. 一条边只连接相邻版本；跨版本 = 沿版本链逐跳合成（compose）。
// 3. 拆分(split)产生多个分支 => 读者必须选择目标，不能替读者决定。
// 4. 合并(merge)使多个分支收敛到同一节点 => 去重后唯一。
// 5. removed=有意下线；无边/目标不存在=缺失目标，给出明确理由。
// 6. 锚点与折叠块随每跳的映射表迁移；表中没有就如实报告丢失，不臆造。

export const DEFAULT_MAX_CHAIN = 8

export function pairKey(fromVersion, toVersion) {
  return `${fromVersion}=>${toVersion}`
}

/**
 * 建立索引：out[(version,nodeId)] -> 指向下一版本的边数组
 */
export function buildEdgeIndex(edges) {
  const out = new Map()
  for (const e of edges) {
    const k = `${pairKey(e.fromVersion, e.toVersion)}|${e.fromNodeId}`
    if (!out.has(k)) out.set(k, [])
    out.get(k).push(e)
  }
  return out
}

/**
 * 构建时全量诊断（物化迁移前执行）。
 *
 * @param {string[]} order semver 升序版本号
 * @param {object[]} edges
 * @param {Map<string,{id:string,title?:string}>} nodesByState "version|nodeId" -> node
 * @returns {{
 *   cycles: string[][], duplicateEdges: string[], ambiguousEdges: string[],
 *   dangling: {edgeId:string, side:'from'|'to', state:string}[],
 *   backEdges: string[], unknownVersions: string[], selfLoops: string[]
 * }}
 */
export function validateGraph(order, edges, nodesByState) {
  const cycles = []
  const duplicateEdges = new Set()
  const ambiguousEdges = new Set()
  const dangling = []
  const backEdges = []
  const unknownVersions = new Set()
  const selfLoops = []

  for (const v of new Set(edges.flatMap((e) => [e.fromVersion, e.toVersion]))) {
    if (!order.includes(v)) unknownVersions.add(v)
  }

  // 重复边 / 同类型冲突边 / 悬挂端点 / 自环 / 回退边
  const seenExact = new Map()
  const outByState = new Map()
  for (const e of edges) {
    const exact = `${pairKey(e.fromVersion, e.toVersion)}|${e.fromNodeId}|${e.toNodeId}|${e.kind}`
    if (seenExact.has(exact)) duplicateEdges.add(e.id)
    seenExact.set(exact, e.id)

    if (e.fromVersion === e.toVersion && e.fromNodeId === e.toNodeId) selfLoops.push(e.id)
    // 非相邻版本之间直接连边会跳过中间版本的校验，只作提示；相邻版本的反向边
    // （如 2.0.0 -> 1.1.0）是双向切换所需的合法边，不警告。
    if (order.includes(e.fromVersion) && order.includes(e.toVersion)) {
      const gap = Math.abs(order.indexOf(e.toVersion) - order.indexOf(e.fromVersion))
      const dir = order.indexOf(e.toVersion) < order.indexOf(e.fromVersion)
      if (dir && gap > 1) backEdges.push(e.id)
    }

    const fromState = `${e.fromVersion}|${e.fromNodeId}`
    if (!nodesByState.has(fromState)) dangling.push({ edgeId: e.id, side: 'from', state: fromState })
    if (e.kind !== 'removed') {
      const toState = `${e.toVersion}|${e.toNodeId}`
      if (!nodesByState.has(toState)) dangling.push({ edgeId: e.id, side: 'to', state: toState })
    }

    if (!outByState.has(fromState)) outByState.set(fromState, [])
    outByState.get(fromState).push(e)
  }
  // 同一源在同一目标版本上有多条边却未声明 split/merge => 二义性数据错误
  for (const [state, list] of outByState) {
    const byTarget = new Map()
    for (const e of list) {
      if (!byTarget.has(e.toVersion)) byTarget.set(e.toVersion, [])
      byTarget.get(e.toVersion).push(e)
    }
    for (const es of byTarget.values()) {
      const kinds = new Set(es.map((e) => e.kind))
      if (es.length > 1 && !kinds.has('split') && !kinds.has('merge')) {
        es.forEach((e) => ambiguousEdges.add(e.id))
      }
    }
  }

  // 全图 DFS 检测有向环。
  // 注意：相邻版本间的“成对反向边”（如 1.1->2.0 rename 与 2.0->1.1 rename）
  // 是版本双向切换所必需的，不算环；真正的环是沿路径回到“非直接父节点”的状态。
  const adj = new Map()
  for (const e of edges) {
    if (e.kind === 'removed') continue
    const a = `${e.fromVersion}|${e.fromNodeId}`
    const b = `${e.toVersion}|${e.toNodeId}`
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a).push({ to: b, edgeId: e.id })
  }
  // 每个根独立做一次彩色 DFS（白/灰/黑）。不能用跨根的全局 finished 剪枝：
  // 环的闭合边可能从“另一个根先遍历完成”的节点出发，剪枝会漏报。
  // 图规模为版本数 × 节点数，通常很小；重复报告用签名去重。
  const reportedCycleSig = new Set()
  const GREY = 1, BLACK = 2

  // 非 removed 边签名，O(1) 判断“反向边是否存在”
  const edgeSig = new Set(
    edges
      .filter((e) => e.kind !== 'removed')
      .map((e) => `${e.fromVersion}|${e.fromNodeId}->${e.toVersion}|${e.toNodeId}`)
  )

  // 回到路径旧节点时，若回环上每一跳都成对存在反向边，则只是版本双向切换的
  // 成对边（合法），不是数据环。
  const isPairedBacktrack = (pathStack, fromIdx, backEdge) => {
    const hops = []
    for (let k = fromIdx + 1; k < pathStack.length; k++) {
      hops.push({ edgeId: pathStack[k].inEdge, from: pathStack[k - 1].state, to: pathStack[k].state })
    }
    hops.push({ edgeId: backEdge.id, from: pathStack[pathStack.length - 1].state, to: pathStack[fromIdx].state })
    if (hops.some((p) => !p.edgeId)) return false
    return hops.every((p) => edgeSig.has(`${p.to}->${p.from}`))
  }

  const walkFrom = (root) => {
    const color = new Map()
    const pathStack = []

    const stack = [{ u: root, i: 0 }]
    color.set(root, GREY)
    pathStack.push({ state: root, inEdge: null })

    while (stack.length) {
      const top = stack[stack.length - 1]
      const neighbors = adj.get(top.u) || []
      if (top.i >= neighbors.length) {
        color.set(top.u, BLACK)
        stack.pop()
        pathStack.pop()
        continue
      }
      const { to, edgeId } = neighbors[top.i]
      top.i += 1

      if (color.get(to) === GREY) {
        const pos = pathStack.findIndex((x) => x.state === to)
        const backEdge = edges.find((e) => e.id === edgeId)
        if (pos !== -1 && pos !== pathStack.length - 1 && !isPairedBacktrack(pathStack, pos, backEdge)) {
          const seq = []
          for (let k = pos; k < pathStack.length; k++) {
            seq.push(pathStack[k].state)
            const edge = k + 1 < pathStack.length ? pathStack[k + 1].inEdge : edgeId
            if (edge) seq.push(`--[${edge}]-->`)
          }
          seq.push(to)
          const sig = seq.join(' ')
          if (!reportedCycleSig.has(sig)) {
            reportedCycleSig.add(sig)
            cycles.push(seq)
          }
        }
        continue
      }
      if (color.get(to) === BLACK) continue
      color.set(to, GREY)
      pathStack.push({ state: to, inEdge: edgeId })
      stack.push({ u: to, i: 0 })
    }
  }

  for (const u of adj.keys()) walkFrom(u)

  return {
    cycles,
    duplicateEdges: [...duplicateEdges],
    ambiguousEdges: [...ambiguousEdges],
    dangling,
    backEdges,
    unknownVersions: [...unknownVersions],
    selfLoops
  }
}

function applyAnchor(anchor, edge) {
  if (anchor == null) return { anchor: null, note: null }
  const map = edge.anchorMap || {}
  if (!Object.prototype.hasOwnProperty.call(map, anchor)) {
    return { anchor: null, note: `锚点 #${anchor} 在边 ${edge.id} 上没有映射` }
  }
  const mapped = map[anchor]
  return mapped === '' || mapped == null
    ? { anchor: null, note: `锚点 #${anchor} 已随 ${edge.kind} 移除（边 ${edge.id}）` }
    : { anchor: mapped, note: null }
}

function applyBlocks(blocks, edge) {
  if (!blocks.length) return blocks
  // 边未声明 blocks 映射 => 该跳不掌握折叠块去向，保持原值（不臆造）
  if (!edge.blocks) return blocks
  return blocks.map((b) => {
    if (b.current == null) return b
    if (Object.prototype.hasOwnProperty.call(edge.blocks, b.current)) {
      const next = edge.blocks[b.current]
      return next ? { ...b, current: next } : { ...b, current: null, lostReason: `折叠块 ${b.source} 在边 ${edge.id} 被删除` }
    }
    return { ...b, current: null, lostReason: `折叠块 ${b.source} 在边 ${edge.id} 无映射` }
  })
}

/**
 * 沿版本链解析单个稳定节点的迁移结果。
 *
 * @param {object} p
 * @param {object[]} p.edges 迁移边
 * @param {string[]} p.order semver 升序版本号
 * @param {string} p.from 源版本
 * @param {string} p.to 目标版本
 * @param {string} p.nodeId 源稳定节点 ID
 * @param {string|null} [p.anchor] 源锚点
 * @param {string[]} [p.blockIds] 源页面展开的折叠块 ID
 * @param {number} [p.maxChain]
 * @param {(version:string,nodeId:string)=>string|null} [p.visible]
 *        返回 null=可见；否则返回不可见原因（私有撤权/节点范围不足）
 * @param {(version:string,nodeId:string)=>{id:string,title?:string,path?:string}|null} [p.getNode]
 * @returns {object} 解析结果（见文件底部 RESULT_SHAPE 说明）
 */
export function resolveMigration(p) {
  const {
    edges, order, from, to, nodeId,
    anchor = null, blockIds = [],
    maxChain = DEFAULT_MAX_CHAIN,
    visible = () => null,
    getNode = () => null
  } = p

  const trailRequires = []
  const fail = (reason, extra = {}) => ({
    status: 'error', reason, trail: [], hops: 0, candidates: [], target: null,
    anchor: null, blocks: [], branchReports: [], diagnostics: [], ...extra
  })

  if (!order.includes(from)) return fail(`源版本 ${from} 不存在于版本链`)
  if (!order.includes(to)) return fail(`目标版本 ${to} 不存在于版本链（缺失目标版本）`)
  if (!getNode(from, nodeId)) {
    return fail(`节点 ${nodeId} 在版本 ${from} 中不存在`)
  }

  const { chainPath } = resolveChainPath(order, from, to)
  const index = buildEdgeIndex(edges)

  let branches = [{
    states: [{ version: from, nodeId }],
    trail: [], hops: 0, alive: true,
    anchor, anchorNote: anchor ? null : null,
    blocks: blockIds.map((id) => ({ source: id, current: id, lostReason: null })),
    outcome: null, note: null
  }]

  const diagnostics = []

  for (let h = 0; h < chainPath.length - 1; h++) {
    const cur = chainPath[h]
    const next = chainPath[h + 1]
    const nextBranches = []

    for (const br of branches) {
      if (!br.alive) { nextBranches.push(br); continue }
      const head = br.states[br.states.length - 1]
      const es = index.get(`${pairKey(cur, next)}|${head.nodeId}`) || []

      if (es.length === 0) {
        nextBranches.push({
          ...br, alive: false,
          outcome: 'dead',
          note: `版本 ${cur}→${next} 上节点 ${head.nodeId} 没有迁移边（缺失目标，无法映射）`
        })
        continue
      }

      for (const e of es) {
        // 链长上限：防止重命名链/错误数据导致无限追踪
        if (br.hops + 1 > maxChain) {
          nextBranches.push({
            ...br, alive: false, outcome: 'too-long',
            note: `迁移链超过上限 ${maxChain} 跳（最后一条边 ${e.id}）`
          })
          continue
        }
        if (e.kind === 'removed') {
          nextBranches.push({
            ...br, states: [...br.states, { version: next, nodeId: null }],
            trail: [...br.trail, e.id], hops: br.hops + 1,
            alive: false, outcome: 'removed', note: e.note || '该章节已在此版本下线'
          })
          continue
        }
        const nextState = { version: next, nodeId: e.toNodeId }
        const stateKey = `${nextState.version}|${nextState.nodeId}`
        // 精确状态重复（同版本层内损坏数据）
        const exactRepeat = br.states.some((s) => `${s.version}|${s.nodeId}` === stateKey)
        // 语义回环：链上 nodeId 必须真的“变过”，之后又回到更早出现过的旧 ID
        // （如 a -> b1 -> a）；连续同名 rename（n -> n）不算。
        const seenIds = new Set(br.states.map((s) => s.nodeId))
        const idActuallyChanged = seenIds.size > 1
        const semanticLoop = e.kind !== 'identity' && idActuallyChanged &&
          br.states.some((s) => s.nodeId === e.toNodeId && s.version !== next)
        if (exactRepeat || semanticLoop) {
          diagnostics.push({ severity: 'fatal', code: 'CYCLE', edgeId: e.id, state: stateKey })
          nextBranches.push({
            ...br, states: [...br.states, nextState],
            trail: [...br.trail, e.id], hops: br.hops + 1,
            alive: false, outcome: 'cycle',
            note: exactRepeat
              ? `迁移图存在环：回到了 ${stateKey}（边 ${e.id}）`
              : `迁移图存在语义环：节点 ${e.toNodeId} 在更名后又回到自身（边 ${e.id}）`
          })
          continue
        }
        const hiddenReason = visible(next, e.toNodeId)
        const a = applyAnchor(br.anchor, e)
        const nb = {
          ...br,
          states: [...br.states, nextState],
          trail: [...br.trail, e.id],
          hops: br.hops + 1,
          anchor: a.anchor,
          anchorNote: a.note || (a.anchor === br.anchor ? br.anchorNote : br.anchorNote),
          blocks: applyBlocks(br.blocks, e),
          note: e.note || br.note
        }
        if (hiddenReason) {
          nextBranches.push({ ...nb, alive: false, outcome: 'no-access', note: hiddenReason })
        } else {
          nextBranches.push(nb)
        }
      }
    }
    branches = nextBranches
  }

  const branchReports = branches.map((br) => ({
    outcome: br.outcome || 'alive',
    head: br.states[br.states.length - 1],
    note: br.note || null,
    trail: br.trail,
    hops: br.hops
  }))

  const alive = branches.filter((b) => b.alive)
  const landingsMap = new Map()
  for (const br of alive) {
    const head = br.states[br.states.length - 1]
    if (head.version !== to) continue
    if (!landingsMap.has(head.nodeId)) {
      landingsMap.set(head.nodeId, {
        nodeId: head.nodeId,
        version: to,
        node: getNode(to, head.nodeId),
        anchor: br.anchor,
        anchorNote: br.anchorNote,
        blocks: br.blocks,
        trail: br.trail
      })
    }
  }
  const landings = [...landingsMap.values()]

  const result = {
    status: null,
    reason: null,
    from: { version: from, nodeId },
    target: null,
    candidates: [],
    anchor: null,
    blocks: [],
    trail: [],
    hops: alive[0]?.hops ?? 0,
    branchReports,
    diagnostics
  }

  if (landings.length === 1) {
    const l = landings[0]
    result.status = 'unique'
    result.target = { nodeId: l.nodeId, version: to, path: l.node?.path || null, title: l.node?.title || null }
    result.anchor = l.anchor
    result.blocks = l.blocks
    result.trail = l.trail
  } else if (landings.length > 1) {
    result.status = 'choose'
    result.reason = '该章节在目标版本被拆分为多个章节，请选择要查看的内容'
    result.candidates = landings.map((l) => ({
      nodeId: l.nodeId,
      version: to,
      path: l.node?.path || null,
      title: l.node?.title || l.nodeId,
      note: null,
      anchor: l.anchor
    }))
    result.blocks = landings[0]?.blocks || []
  } else {
    const removed = branches.filter((b) => b.outcome === 'removed')
    const noAccess = branches.filter((b) => b.outcome === 'no-access')
    const cycles = branches.filter((b) => b.outcome === 'cycle')
    const tooLong = branches.filter((b) => b.outcome === 'too-long')
    if (cycles.length) {
      result.status = 'error'
      result.reason = `检测到迁移环：${cycles[0].note}`
    } else if (tooLong.length) {
      result.status = 'error'
      result.reason = tooLong[0].note
    } else if (removed.length && removed.length === branches.length) {
      result.status = 'removed'
      result.reason = removed[0].note
    } else if (noAccess.length && noAccess.length === branches.length) {
      result.status = 'no-access'
      result.reason = noAccess[0].note
    } else {
      result.status = 'unmapped'
      const dead = branches.find((b) => b.outcome === 'dead') || noAccess[0] || removed[0]
      result.reason = dead
        ? `在版本 ${to} 中没有可跳转的对应章节：${dead.note}`
        : '迁移结果为空，且没有任何分支到达目标版本'
    }
  }

  if (result.status === 'unique' && result.anchor == null && anchor != null) {
    const note = landings[0]?.anchorNote
    if (note) diagnostics.push({ severity: 'info', code: 'ANCHOR_LOST', note })
  }
  return result
}

/** 导出版本链路径（versions.js 中同构实现的图内副本，避免模块循环依赖歧义） */
export function resolveChainPath(ordered, from, to) {
  const i = ordered.indexOf(from)
  const j = ordered.indexOf(to)
  if (i === -1 || j === -1) return { chainPath: null }
  if (i === j) return { chainPath: [from] }
  return { chainPath: i < j ? ordered.slice(i, j + 1) : ordered.slice(j, i + 1).reverse() }
}
