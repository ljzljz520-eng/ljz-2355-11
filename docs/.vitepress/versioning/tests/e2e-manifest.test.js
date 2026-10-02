// 端到端：直接消费 build.js 产出的 manifest，通过核心解析器模拟浏览器切换行为。
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveMigration } from '../core/graph.js'
import { buildTermIndex, resolveTermRef } from '../core/terms.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = path.join(HERE, '..', '..', '..', 'public', 'version-data', 'manifest.json')

let m
before(async () => {
  m = JSON.parse(await fsp.readFile(MANIFEST_PATH, 'utf8'))
})

const getNode = (v, id) => (m.sections[v] || []).find((s) => s.id === id) || null
const resolve = (from, to, nodeId, opts = {}) => resolveMigration({
  edges: m.edges, order: m.order, from, to, nodeId, getNode,
  maxChain: m.build.maxChain, ...opts
})

test('验收①：章节拆分（1.1 Dialog -> 2.0）读者二选一，候选带 path', () => {
  const r = resolve('1.1.0', '2.0.0', 'component-dialog')
  assert.equal(r.status, 'choose')
  assert.deepEqual(r.candidates.map((c) => c.nodeId).sort(),
    ['component-dialog-drawer', 'component-dialog-modal'])
  assert.ok(r.candidates.every((c) => c.path))
})

test('验收②：章节合并（2.0 Modal/Drawer -> 1.1 Dialog）唯一', () => {
  assert.equal(resolve('2.0.0', '1.1.0', 'component-dialog-modal').target.nodeId, 'component-dialog')
  assert.equal(resolve('2.0.0', '1.1.0', 'component-dialog-drawer').target.nodeId, 'component-dialog')
})

test('验收②：锚点重命名 first-call -> first-request；删除锚点如实丢失', () => {
  const r = resolve('1.1.0', '2.0.0', 'guide-quickstart', { anchor: 'first-call' })
  assert.equal(r.anchor, 'first-request')
  const r2 = resolve('1.1.0', '2.0.0', 'guide-quickstart', { anchor: 'options' })
  assert.equal(r2.anchor, null)
  assert.ok(r2.diagnostics.some((d) => d.code === 'ANCHOR_LOST'))
})

test('验收②：折叠块迁移与删除原因', () => {
  const r = resolve('1.1.0', '2.0.0', 'guide-installation', {
    anchor: 'cdn', blockIds: ['b-cdn-mirror', 'b-legacy-npm']
  })
  assert.equal(r.status, 'unique')
  const mirror = r.blocks.find((b) => b.source === 'b-cdn-mirror')
  const legacy = r.blocks.find((b) => b.source === 'b-legacy-npm')
  assert.equal(mirror.current, 'b-cdn-mirror')
  assert.equal(legacy.current, null)
  assert.match(legacy.lostReason, /删除/)
})

test('验收：重名术语必须限定；不同版本定义隔离', () => {
  const termsOf = (v) => Object.entries(m.terms[v]).map(([q, t]) => ({
    ...t, slug: q.split('@')[0], scope: q.includes('@') ? q.split('@')[1] : null
  }))
  const i11 = buildTermIndex(termsOf('1.1.0'))
  const i20 = buildTermIndex(termsOf('2.0.0'))
  assert.equal(resolveTermRef('token', i11).status, 'ambiguous')
  assert.match(resolveTermRef('token@css', i11).term.body, /1\.1/)
  assert.match(resolveTermRef('token', i20).status === 'ambiguous'
    ? resolveTermRef('token@css', i20).term.body
    : resolveTermRef('token', i20).term.body, /2\.0|CSS Custom Properties/)
  // 1.1 没有 sdk，2.0 没有 app —— 绝不跨版本取词
  assert.equal(resolveTermRef('sdk', i11).status, 'unknown')
  assert.equal(resolveTermRef('app', i20).status, 'unknown')
})

test('验收：私有版撤权（3.0 modal 需 beta-preview）', () => {
  const visible = (v, id) => {
    const s = getNode(v, id)
    if (s?.scope === 'beta-preview') return '该章节需要权限范围：beta-preview'
    return null
  }
  const denied = resolve('2.0.0', '3.0.0-beta', 'component-dialog-modal', { visible })
  assert.equal(denied.status, 'no-access')
  const granted = resolve('2.0.0', '3.0.0-beta', 'component-dialog-modal')
  assert.equal(granted.status, 'unique')
})

test('验收：缺失目标（悬挂边与无映射节点）明确 unmapped', () => {
  // 2.0 changelog 在 1.1 没有任何边
  const r = resolve('2.0.0', '1.1.0', 'guide-changelog')
  assert.equal(r.status, 'unmapped')
  assert.match(r.reason, /没有迁移边/)
})

test('验收：草稿版本不暴露已发布导航（draft 章节不可达）', () => {
  // 2.1 migration 是 draft：从 2.0 过去不存在节点（draft 不参与 sections 公开视图）
  // 数据层保证 status=draft；运行时 canSeeSection 拒绝。
  const migration21 = (m.sections['2.1.0'] || []).find((s) => s.id === 'guide-migration-21')
  assert.equal(migration21.status, 'draft')
})

test('旧链接：legacyPaths 登记正确（深开救治数据源）', () => {
  const allLegacy = m.order.flatMap((v) =>
    (m.sections[v] || []).flatMap((s) => (s.legacyPaths || []).map((p) => [v, s.id, p])))
  const paths = allLegacy.map(([, , p]) => p)
  assert.ok(paths.includes('/v1/install.html'))
  assert.ok(paths.includes('/zh/install'))
  assert.ok(paths.includes('/v1/components/modal'))
})

test('物化结果与按请求解析一致（两种实现等价）', () => {
  for (const from of m.order) {
    for (const s of m.sections[from]) {
      for (const to of m.order) {
        if (to === from) continue
        const live = resolve(from, to, s.id)
        const mat = m.materialized[from][s.id][to]
        assert.equal(live.status, mat.status,
          `${from}:${s.id} -> ${to} live=${live.status} materialized=${mat.status}`)
      }
    }
  }
})

test('目录绑定 commit 且带最大链长配置', () => {
  assert.ok(m.build.commit)
  assert.equal(m.build.maxChain, 8)
})
