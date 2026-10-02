import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareVersions, sortVersions, chainPath, isVersionVisible, parseVersion
} from '../core/versions.js'
import {
  resolveMigration, validateGraph, buildEdgeIndex, DEFAULT_MAX_CHAIN
} from '../core/graph.js'

// ---- 版本链 -------------------------------------------------------------
test('semver：预发布小于正式版，排序与链路径正确', () => {
  assert.equal(compareVersions('1.0.0', '1.0'), 0)
  assert.equal(compareVersions('2.0.0', '2.0.0-beta'), 1)
  assert.equal(compareVersions('3.0.0-beta.1', '3.0.0-beta.2'), -1)
  const ordered = sortVersions([
    { version: '2.0.0' }, { version: '1.0.0' }, { version: '3.0.0-beta' }, { version: '1.1.0' }
  ]).map((v) => v.version)
  assert.deepEqual(ordered, ['1.0.0', '1.1.0', '2.0.0', '3.0.0-beta'])
  assert.deepEqual(chainPath(ordered, '1.0.0', '2.0.0'), ['1.0.0', '1.1.0', '2.0.0'])
  assert.deepEqual(chainPath(ordered, '2.0.0', '1.0.0'), ['2.0.0', '1.1.0', '1.0.0'])
  assert.equal(chainPath(ordered, '1.0.0', '9.9.9'), null)
})

test('非法版本号抛错', () => {
  assert.throws(() => parseVersion(''), /非法/)
  assert.throws(() => parseVersion('latest'), /无法解析/)
})

test('版本可见性：draft 永不出现；private 需全部 scope', () => {
  assert.equal(isVersionVisible({ status: 'draft' }), false)
  assert.equal(isVersionVisible({ status: 'public' }), true)
  assert.equal(isVersionVisible({ status: 'private', scopes: ['beta-preview'] }, []), false)
  assert.equal(isVersionVisible({ status: 'private', scopes: ['beta-preview'] }, ['beta-preview']), true)
  assert.equal(isVersionVisible({ status: 'private', scopes: ['a', 'b'] }, ['a']), false)
})

// ---- 迁移解析 -------------------------------------------------------------
const order = ['1.0.0', '1.1.0', '2.0.0']
const nodes = new Map([
  ['1.0.0|a', { id: 'a', title: 'A', path: '/a' }],
  ['1.1.0|a', { id: 'a', title: 'A', path: '/a' }],
  ['2.0.0|a', { id: 'a', title: 'A 改名后标题仍相同', path: '/a' }],
  ['1.1.0|b', { id: 'b', title: 'B', path: '/b' }],
  ['2.0.0|b1', { id: 'b1', title: 'B 一', path: '/b1' }],
  ['2.0.0|b2', { id: 'b2', title: 'B 二', path: '/b2' }],
  ['1.1.0|gone', { id: 'gone', title: '下线章节', path: '/gone' }],
  ['1.1.0|c', { id: 'c', title: 'C', path: '/c' }],
  ['2.0.0|c', { id: 'c', title: 'C', path: '/c' }]
])
const baseEdges = [
  { id: 'a1', fromVersion: '1.0.0', toVersion: '1.1.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity' },
  { id: 'a2', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity' },
  { id: 'a2r', fromVersion: '2.0.0', toVersion: '1.1.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity' },
  { id: 'a1r', fromVersion: '1.1.0', toVersion: '1.0.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity' },
  // b 在 1.1->2.0 拆成 b1/b2
  { id: 'bs1', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'b', toNodeId: 'b1', kind: 'split' },
  { id: 'bs2', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'b', toNodeId: 'b2', kind: 'split' },
  // b1/b2 反向合并到 b
  { id: 'bm1', fromVersion: '2.0.0', toVersion: '1.1.0', fromNodeId: 'b1', toNodeId: 'b', kind: 'merge' },
  { id: 'bm2', fromVersion: '2.0.0', toVersion: '1.1.0', fromNodeId: 'b2', toNodeId: 'b', kind: 'merge' },
  // gone 显式下线
  { id: 'gr', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'gone', toNodeId: null, kind: 'removed', note: '功能取消' },
  // c 仅 1.1/2.0 有，1.0 没有边（缺失目标场景在跨 1.0<->2.0 触发）
  { id: 'c2', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'c', toNodeId: 'c', kind: 'identity' },
  { id: 'c2r', fromVersion: '2.0.0', toVersion: '1.1.0', fromNodeId: 'c', toNodeId: 'c', kind: 'identity' }
]
const getNode = (v, id) => nodes.get(`${v}|${id}`) || null
const resolve = (over) => resolveMigration({ edges: baseEdges, order, getNode, ...over })

test('拆分 => choose 且候选两个；绝不只按标题相同跳转', () => {
  const r = resolve({ from: '1.1.0', to: '2.0.0', nodeId: 'b' })
  assert.equal(r.status, 'choose')
  assert.equal(r.candidates.length, 2)
  assert.deepEqual(r.candidates.map((c) => c.nodeId).sort(), ['b1', 'b2'])
})

test('反向合并 => 去重后 unique', () => {
  const r1 = resolve({ from: '2.0.0', to: '1.1.0', nodeId: 'b1' })
  const r2 = resolve({ from: '2.0.0', to: '1.1.0', nodeId: 'b2' })
  assert.equal(r1.status, 'unique')
  assert.equal(r1.target.nodeId, 'b')
  assert.equal(r2.status, 'unique')
})

test('跨多跳沿版本链合成（1.0 a -> 2.0 a）', () => {
  const r = resolve({ from: '1.0.0', to: '2.0.0', nodeId: 'a' })
  assert.equal(r.status, 'unique')
  assert.deepEqual(r.trail, ['a1', 'a2'])
})

test('标题相同但没有迁移边时不跳转（防止按标题猜）', () => {
  // 'a' 在 1.0 与 2.0 标题完全不同的场景由 b 系列覆盖；这里构造无边情况：
  const r = resolve({ from: '1.1.0', to: '2.0.0', nodeId: 'a', edges: [] })
  assert.equal(r.status, 'unmapped')
  assert.match(r.reason, /没有迁移边/)
})

test('removed => removed 状态并给出下线说明', () => {
  const r = resolve({ from: '1.1.0', to: '2.0.0', nodeId: 'gone' })
  assert.equal(r.status, 'removed')
  assert.match(r.reason, /功能取消/)
})

test('缺失目标（无边）=> unmapped 且 reason 明确', () => {
  const r = resolve({ from: '2.0.0', to: '1.0.0', nodeId: 'c' })
  assert.equal(r.status, 'unmapped')
  assert.match(r.reason, /没有迁移边|没有可跳转/)
})

test('锚点逐级映射；被删除锚点不臆造', () => {
  const edges = [
    { id: 'x1', fromVersion: '1.0.0', toVersion: '1.1.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity', anchorMap: { old: 'mid' } },
    { id: 'x2', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity', anchorMap: { mid: 'new' } }
  ]
  const r = resolveMigration({ edges, order, getNode, from: '1.0.0', to: '2.0.0', nodeId: 'a', anchor: 'old' })
  assert.equal(r.anchor, 'new')

  const r2 = resolveMigration({
    edges: [{ id: 'x', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity', anchorMap: { mid: '' } }],
    order, getNode, from: '1.1.0', to: '2.0.0', nodeId: 'a', anchor: 'mid'
  })
  assert.equal(r2.anchor, null)
  assert.ok(r2.diagnostics.some((d) => d.code === 'ANCHOR_LOST'))
})

test('折叠块状态迁移；删除块如实报告 lostReason', () => {
  const edges = [
    { id: 'x1', fromVersion: '1.0.0', toVersion: '1.1.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity', blocks: { p: 'q' } },
    { id: 'x2', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity', blocks: { q: '' } }
  ]
  const r = resolveMigration({ edges, order, getNode, from: '1.0.0', to: '2.0.0', nodeId: 'a', blockIds: ['p'] })
  assert.equal(r.blocks[0].current, null)
  assert.match(r.blocks[0].lostReason, /删除/)
})

test('循环诊断：跨版本环 => error CYCLE', () => {
  // 版本链 1.1 -> 2.0 -> 3.0：a -> b1 -> a（回到 1.1 层的同名状态）=> 真环
  const cycOrder = ['1.1.0', '2.0.0', '3.0.0']
  const cycNodes = new Map([
    ['1.1.0|a', { id: 'a', path: '/a' }],
    ['2.0.0|b1', { id: 'b1', path: '/b1' }],
    ['3.0.0|a', { id: 'a', path: '/a' }]
  ])
  const edges = [
    { id: 'f2', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'a', toNodeId: 'b1', kind: 'rename' },
    { id: 'loop', fromVersion: '2.0.0', toVersion: '3.0.0', fromNodeId: 'b1', toNodeId: 'a', kind:
      'rename' }
  ]
  const r = resolveMigration({
    edges, order: cycOrder,
    getNode: (v, id) => cycNodes.get(`${v}|${id}`) || null,
    from: '1.1.0', to: '3.0.0', nodeId: 'a'
  })
  assert.equal(r.status, 'error')
  assert.match(r.reason, /环/)
  assert.ok(r.diagnostics.some((d) => d.code === 'CYCLE'))
})

test('validateGraph：成对反向边不误报环；真环必报', () => {
  const clean = validateGraph(order, baseEdges, nodes)
  assert.equal(clean.cycles.length, 0)

  nodes.set('2.0.0|c', { id: 'c', path: '/c' })
  // 真环：1.1 b -> 2.0 c -> 1.1 c ->（同版本损坏边）-> 1.1 b
  const realCycle = [
    ...baseEdges,
    { id: 'bc', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'b', toNodeId: 'c', kind: 'rename' },
    { id: 'sameVer', fromVersion: '1.1.0', toVersion: '1.1.0', fromNodeId: 'c', toNodeId: 'b', kind: 'rename' }
  ]
  const d = validateGraph(order, realCycle, nodes)
  assert.ok(d.cycles.length >= 1, '应检测到 1.1 b->2.0 c->1.1 c->1.1 b 环')
})

test('迁移链上限：超长链报 error 并提示上限', () => {
  const longOrder = ['v0', 'v1', 'v2', 'v3', 'v4']
  const nmap = new Map()
  const es = []
  longOrder.forEach((v, i) => nmap.set(`${v}|n`, { id: 'n', path: '/n' }))
  for (let i = 0; i < 4; i++) {
    es.push({ id: `e${i}`, fromVersion: longOrder[i], toVersion: longOrder[i + 1], fromNodeId: 'n', toNodeId: 'n', kind: 'rename' })
  }
  const r = resolveMigration({
    edges: es, order: longOrder, getNode: (v, id) => nmap.get(`${v}|${id}`) || null,
    from: 'v0', to: 'v4', nodeId: 'n', maxChain: 2
  })
  assert.equal(r.status, 'error')
  assert.match(r.reason, /上限 2/)
})

test('私有版撤权：所有分支 no-access 时明确提示', () => {
  const edges = [
    { id: 's1', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'b', toNodeId: 'b1', kind: 'split' },
    { id: 's2', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'b', toNodeId: 'b2', kind: 'split' }
  ]
  const visible = (v, id) => '该章节需要权限范围：beta-preview'
  const r = resolveMigration({ edges, order, getNode, visible, from: '1.1.0', to: '2.0.0', nodeId: 'b' })
  assert.equal(r.status, 'no-access')
  assert.match(r.reason, /beta-preview/)
})

test('重复边/未知版本/自环/二义边被 validateGraph 捕获', () => {
  const edges = [
    { id: 'dup', fromVersion: '1.0.0', toVersion: '1.1.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity' },
    { id: 'dup2', fromVersion: '1.0.0', toVersion: '1.1.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity' },
    { id: 'unk', fromVersion: '1.0.0', toVersion: '9.9.9', fromNodeId: 'a', toNodeId: 'a', kind: 'identity' },
    { id: 'self', fromVersion: '1.1.0', toVersion: '1.1.0', fromNodeId: 'a', toNodeId: 'a', kind: 'identity' },
    // 两条同源同目标版本但未声明 split/merge
    { id: 'amb1', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'c', toNodeId: 'b1', kind: 'rename' },
    { id: 'amb2', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'c', toNodeId: 'b2', kind: 'rename' }
  ]
  nodes.set('2.0.0|b1', { id: 'b1', path: '/b1' })
  nodes.set('2.0.0|b2', { id: 'b2', path: '/b2' })
  const d = validateGraph(order, edges, nodes)
  assert.ok(d.duplicateEdges.length >= 1)
  assert.ok(d.unknownVersions.includes('9.9.9'))
  assert.ok(d.selfLoops.includes('self'))
  assert.ok(d.ambiguousEdges.includes('amb1') && d.ambiguousEdges.includes('amb2'))
})
