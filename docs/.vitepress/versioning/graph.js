/**
 * Pure version graph helpers shared by build validation and browser navigation.
 * No DOM, VitePress, or private runtime dependencies are allowed here.
 */

export const DEFAULT_MAX_HOPS = 5

export function releaseById(releases, releaseId) {
  return releases.find((release) => release.id === releaseId) ?? null
}

export function nodeKey(releaseId, locale, nodeId) {
  return `${releaseId}/${locale}/${nodeId}`
}

export function edgeKey(edge) {
  return `${nodeKey(edge.from.releaseId, edge.from.locale, edge.from.nodeId)}=>${nodeKey(
    edge.to.releaseId,
    edge.to.locale,
    edge.to.nodeId
  )}`
}

export function buildIndexes(catalog) {
  const releases = new Map(catalog.releases.map((release) => [release.id, release]))
  const nodes = new Map()
  const outgoing = new Map()
  const incoming = new Map()

  for (const node of catalog.nodes) {
    nodes.set(nodeKey(node.releaseId, node.locale, node.id), node)
  }

  for (const edge of catalog.edges) {
    const from = nodeKey(edge.from.releaseId, edge.from.locale, edge.from.nodeId)
    const to = nodeKey(edge.to.releaseId, edge.to.locale, edge.to.nodeId)
    outgoing.set(from, [...(outgoing.get(from) ?? []), edge])
    incoming.set(to, [...(incoming.get(to) ?? []), edge])
  }

  return { releases, nodes, outgoing, incoming }
}

export function parseRoute(routePath, releases) {
  const cleanPath = routePath.split('#')[0].split('?')[0]
  const [withoutHash = cleanPath, hash = ''] = routePath.split('#')
  const pathname = withoutHash.split('?')[0]
  const normalizedPath = normalizePath(pathname)

  const candidates = []
  for (const release of releases) {
    for (const [locale, prefix] of releaseRoutePrefixes(release)) {
      if (normalizedPath === prefix || (prefix && normalizedPath.startsWith(`${prefix}/`))) {
        candidates.push({ release, locale, prefix })
      } else if (prefix === '' && !normalizedPath.startsWith('/en/') && normalizedPath !== '/en') {
        candidates.push({ release, locale, prefix })
      }
    }
  }
  candidates.sort((a, b) => b.prefix.length - a.prefix.length)
  const matched = candidates[0]
  const matchedRelease = matched?.release ?? null

  let contentPath = normalizedPath
  if (matched?.prefix && contentPath.startsWith(matched.prefix)) {
    contentPath = contentPath.slice(matched.prefix.length) || '/'
  }
  contentPath = normalizePath(contentPath)
  if (contentPath === '/') contentPath = '/index'

  return {
    releaseId: matchedRelease?.id ?? null,
    locale: matched?.locale ?? 'zh-CN',
    path: contentPath,
    anchor: hash ? decodeURIComponent(hash) : ''
  }
}

function releaseRoutePrefixes(release) {
  if (release.routeBase) return Object.entries(release.routeBase)
  if (release.localeBase) {
    return Object.entries(release.localeBase).map(([locale, localeBase]) => [
      locale,
      `${release.basePath ?? ''}${localeBase}`
    ])
  }
  return [['zh-CN', release.basePath ?? '']]
}

export function normalizePath(pathname) {
  let path = pathname || '/'
  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\.(md|html)$/i, '')
  if (path.length > 1 && path.endsWith('/index')) path = path.slice(0, -'/index'.length)
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

export function findNodeByPath(catalog, indexes, releaseId, locale, path) {
  const wanted = normalizePath(path)
  const nodes = catalog.nodes.filter(
    (node) => node.releaseId === releaseId && node.locale === locale
  )
  return nodes.find((node) => normalizePath(node.path) === wanted) ?? null
}

export function fullNodePath(release, node) {
  const routeBase =
    release.routeBase?.[node.locale] ??
    `${release.basePath ?? ''}${release.localeBase?.[node.locale] ?? ''}`
  return `${routeBase}${node.path}`
}

/**
 * Find all bounded walks from a node in one release to the target release.
 * Reverse edges are supported because a reader can switch between archived and
 * latest docs in either direction, but traversal never revisits a node.
 */
export function resolveMigration(catalog, source, targetReleaseId, options = {}) {
  const maxHops = options.maxHops ?? catalog.maxMigrationHops ?? DEFAULT_MAX_HOPS
  const wantedAnchor = options.anchor ?? ''
  const indexes = options.indexes ?? buildIndexes(catalog)
  const startKey = nodeKey(source.releaseId, source.locale, source.id)

  const queue = [{ key: startKey, edges: [], nodes: [source] }]
  const found = []
  let chainLimitReached = false
  const accessDenied = []

  while (queue.length) {
    const current = queue.shift()
    const node = current.nodes[current.nodes.length - 1]
    if (node.releaseId === targetReleaseId) {
      found.push(current)
      continue
    }

    const directEdges = indexes.outgoing.get(current.key) ?? []
    const reverseEdges = indexes.incoming.get(current.key) ?? []
    const nextEdges = [
      ...directEdges.map((edge) => ({ edge, direction: 'forward' })),
      ...reverseEdges.map((edge) => ({ edge, direction: 'reverse' }))
    ]

    for (const item of nextEdges) {
      const endpointRef = item.direction === 'forward' ? item.edge.to : item.edge.from
      const nextNode = indexes.nodes.get(
        nodeKey(endpointRef.releaseId, endpointRef.locale, endpointRef.nodeId)
      )
      if (!nextNode) continue

      const nextKey = nodeKey(nextNode.releaseId, nextNode.locale, nextNode.id)
      if (current.nodes.some((visited) => nodeKey(visited.releaseId, visited.locale, visited.id) === nextKey)) {
        continue
      }

      if (current.edges.length >= maxHops) {
        chainLimitReached = true
        continue
      }

      const targetRelease = indexes.releases.get(nextNode.releaseId)
      const targetPrivate = targetRelease?.visibility === 'private'
      const targetRevoked = targetRelease?.access === 'revoked'
      if (targetPrivate && targetRevoked) {
        accessDenied.push({ node: nextNode, edge: item.edge })
        continue
      }

      queue.push({
        key: nextKey,
        edges: [...current.edges, { ...item.edge, traversed: item.direction }],
        nodes: [...current.nodes, nextNode]
      })
    }
  }

  const candidates = dedupeCandidates(found, wantedAnchor).map((walk) => {
    const target = walk.nodes[walk.nodes.length - 1]
    const targetRelease = indexes.releases.get(target.releaseId)
    const { anchor, anchorStatus, anchorReason } = projectAnchor(walk.edges, wantedAnchor)
    const relation = describeRelation(walk.edges, target)
    return {
      target,
      targetRelease,
      href: fullNodePath(targetRelease, target) + (anchor ? `#${anchor}` : ''),
      hops: walk.edges.length,
      edges: walk.edges,
      relation,
      anchor,
      anchorStatus,
      anchorReason,
      reason: candidateReason(walk, relation, anchorStatus, anchorReason)
    }
  })

  sortCandidates(candidates, wantedAnchor)

  const status = candidates.length
    ? candidates.length === 1
      ? 'unique'
      : 'ambiguous'
    : accessDenied.length
      ? 'access-denied'
      : chainLimitReached
        ? 'chain-limit'
        : 'missing-target'

  return {
    status,
    candidates,
    chainLimitReached,
    accessDenied: [...new Map(accessDenied.map((item) => [item.node.id, item])).values()]
  }
}

function dedupeCandidates(walks, wantedAnchor = '') {
  const byTarget = new Map()
  const walkScore = (walk) => {
    const projected = projectAnchor(walk.edges, wantedAnchor)
    const anchorScore = wantedAnchor && projected.anchorStatus !== 'mapped' ? 1 : 0
    return [anchorScore, walk.edges.length]
  }
  for (const walk of walks) {
    const target = walk.nodes[walk.nodes.length - 1]
    const key = nodeKey(target.releaseId, target.locale, target.id)
    const existing = byTarget.get(key)
    if (!existing || compareScores(walkScore(walk), walkScore(existing)) < 0) {
      byTarget.set(key, walk)
    }
  }
  return [...byTarget.values()]
}

function compareScores([anchorA, hopsA], [anchorB, hopsB]) {
  return anchorA - anchorB || hopsA - hopsB
}

function projectAnchor(edges, sourceAnchor) {
  if (!sourceAnchor) return { anchor: '', anchorStatus: 'no-anchor', anchorReason: '源链接未指定锚点' }
  let anchor = sourceAnchor
  for (const edge of edges) {
    const mapped = edge.anchorMap?.[anchor]
    if (!mapped) {
      return {
        anchor: '',
        anchorStatus: 'unmapped-anchor',
        anchorReason: `锚点 ${anchor} 无法沿“${edge.note ?? edge.type}”迁移`
      }
    }
    anchor = mapped
  }
  return { anchor, anchorStatus: 'mapped', anchorReason: '锚点已迁移' }
}

function describeRelation(edges, target) {
  if (edges.length === 1 && edges[0].type === 'same') return 'stable-node'
  if (edges.some((edge) => edge.type === 'split')) return 'split'
  if (edges.some((edge) => edge.type === 'merge')) return 'merge'
  if (edges.some((edge) => edge.type === 'private')) return 'private'
  return target.id === edges[0]?.from.nodeId ? 'stable-node' : 'renamed'
}

function candidateReason(walk, relation, anchorStatus, anchorReason) {
  const notes = walk.edges.map((edge) => edge.note).filter(Boolean)
  const relationText = {
    'stable-node': '稳定文档节点',
    split: '章节发生拆分，存在多个可能内容',
    merge: '章节已合并到同一页',
    private: '目标属于私有范围',
    renamed: '文档节点已更名或迁移'
  }[relation]
  const anchorText = anchorStatus === 'mapped' ? '锚点已自动映射' : anchorReason
  return [...new Set([relationText, ...notes, anchorText])].join('；')
}

function sortCandidates(candidates, wantedAnchor) {
  candidates.sort((a, b) => {
    const anchorScore = (candidate) => (wantedAnchor ? (candidate.anchorStatus === 'mapped' ? 0 : 1) : 0)
    return anchorScore(a) - anchorScore(b) || a.hops - b.hops || a.target.title.localeCompare(b.target.title)
  })
}

export function detectCycle(catalog, indexes = buildIndexes(catalog)) {
  const visiting = new Set()
  const visited = new Set()
  const stack = []

  function visit(key) {
    if (visiting.has(key)) {
      const start = stack.findIndex((item) => item.key === key)
      return { cyclic: true, cycle: [...stack.slice(start).map((item) => item.key), key] }
    }
    if (visited.has(key)) return null
    visiting.add(key)
    stack.push({ key })
    for (const edge of indexes.outgoing.get(key) ?? []) {
      const next = nodeKey(edge.to.releaseId, edge.to.locale, edge.to.nodeId)
      const result = visit(next)
      if (result) return result
    }
    stack.pop()
    visiting.delete(key)
    visited.add(key)
    return null
  }

  for (const key of indexes.nodes.keys()) {
    const result = visit(key)
    if (result) return result
  }
  return { cyclic: false, cycle: [] }
}
