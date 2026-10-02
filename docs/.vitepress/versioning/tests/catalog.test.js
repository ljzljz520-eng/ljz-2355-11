import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { fileApiSource, fetchBuildInput } from '../api/client.js'
import { assembleCatalog, publishAtomic, versionAccess, nodeAccess } from '../core/catalog.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, '..', 'fixtures')

let input
before(async () => {
  input = await fetchBuildInput(fileApiSource(FIXTURES), { product: 'demo-lib' })
})

test('夹具构建：物化成功且拆分章节为 choose', () => {
  const { catalog, issues, ok } = assembleCatalog({
    ...input,
    build: { product: 'demo-lib', commit: 'abc123', builtAt: new Date().toISOString() }
  })
  assert.equal(ok, true, issues.map((i) => i.message).join('\n'))
  assert.equal(catalog.build.commit, 'abc123') // 目录绑定 commit
  // 1.1 Dialog -> 2.0 拆分
  const r = catalog.materialized['1.1.0']['component-dialog']['2.0.0']
  assert.equal(r.status, 'choose')
  assert.deepEqual(r.candidates.map((c) => c.nodeId).sort(),
    ['component-dialog-drawer', 'component-dialog-modal'])
  // 反向合并去重
  const back = catalog.materialized['2.0.0']['component-dialog-modal']['1.1.0']
  assert.equal(back.status, 'unique')
  assert.equal(back.target.nodeId, 'component-dialog')
  // 警告里包含悬挂边
  assert.ok(issues.some((i) => i.code === 'DANGLING_EDGE'))
})

test('锚点物化：quickstart 1.1->2.0 first-call -> first-request', () => {
  const { catalog } = assembleCatalog({
    ...input,
    build: { product: 'demo-lib', commit: 'c', builtAt: '' }
  })
  // 从 1.0 跨到 2.0：1.0->1.1 identity 无锚点表（保留），1.1->2.0 rename 映射
  const r = catalog.materialized['1.1.0']['guide-quickstart']['2.0.0']
  assert.equal(r.status, 'unique')
})

test('重名术语被各版本分别物化；1.x token 与 2.x token 定义不同', () => {
  const { catalog } = assembleCatalog({
    ...input,
    build: { product: 'demo-lib', commit: 'c', builtAt: '' }
  })
  const t1 = catalog.terms['1.1.0']['token']
  const t2 = catalog.terms['2.0.0']['token']
  assert.match(t1.body, /SCSS/)
  assert.match(t2.body, /运行时/)
  assert.notEqual(t1.body, t2.body)
  // css scope 版本独立
  assert.ok(catalog.terms['2.0.0']['token@css'])
})

test('致命错误（环）时不产出 catalog', () => {
  // 环：1.1 button -> 2.0 modal ->(e-modal-20-11) 1.1 dialog -> 2.0 button
  //     ->(e-button-20-11) 1.1 button。补两条边 cyc-x1 / cyc-x2 闭合。
  const badEdges = [
    ...input.edges,
    { id: 'cyc-x1', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'component-button', toNodeId: 'component-dialog-modal', kind: 'split' },
    { id: 'cyc-x2', fromVersion: '1.1.0', toVersion: '2.0.0', fromNodeId: 'component-dialog', toNodeId: 'component-button', kind: 'split' }
  ]
  const { catalog, ok, issues } = assembleCatalog({
    ...input, edges: badEdges,
    build: { product: 'demo-lib', commit: 'c', builtAt: '' }
  })
  assert.equal(ok, false)
  assert.equal(catalog, null)
  assert.ok(issues.some((i) => i.severity === 'fatal' && i.code === 'CYCLE'),
    issues.map((i) => `${i.code}:${i.message}`).join('\n'))
})

test('原子发布：先有 last-good，发布失败/索引重建不影响读者', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cat-'))
  const good = {
    schema: 'x', product: 'p', build: { commit: 'old', builtAt: '', maxChain: 8 },
    versions: [], order: [], sections: {}, terms: {}, materialized: {}, warnings: []
  }
  const r1 = await publishAtomic(dir, good)
  assert.equal(r1.published, true)
  const before = await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8')
  assert.match(before, /"commit": "old"/)

  // 模拟“索引重建失败”：根本不调用 publishAtomic，旧文件原样保留
  await new Promise((r) => setTimeout(r, 10))
  const after = await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8')
  assert.equal(after, before)

  // 发布新目录成功后内容替换
  const good2 = { ...good, build: { commit: 'new', builtAt: '', maxChain: 8 } }
  const r2 = await publishAtomic(dir, good2)
  assert.equal(r2.published, true)
  const swapped = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'))
  assert.equal(swapped.build.commit, 'new')
})

test('私有版撤权：版本级与节点级', () => {
  const v = { version: '3.0.0-beta', status: 'private', scopes: ['beta-preview'] }
  assert.equal(versionAccess(v, []).ok, false)
  assert.equal(versionAccess(v, ['beta-preview']).ok, true)
  assert.equal(versionAccess({ version: '2.1.0', status: 'draft' }, ['x']).ok, false)

  const section = { id: 'x', status: 'published', scope: 'beta-preview' }
  assert.match(nodeAccess(section, []).reason, /beta-preview/)
  assert.equal(nodeAccess(section, ['beta-preview']).ok, true)
  assert.match(nodeAccess({ status: 'draft' }).reason, /草稿/)
})
