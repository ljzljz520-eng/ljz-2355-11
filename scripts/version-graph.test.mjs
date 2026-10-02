import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildIndexes,
  detectCycle,
  fullNodePath,
  parseRoute,
  resolveMigration
} from '../docs/.vitepress/versioning/graph.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = JSON.parse(await readFile(path.join(root, 'catalog/catalog.source.json'), 'utf8'))

test('拆分章节在目标版本返回多个候选而不是按标题跳转', () => {
  const result = resolveMigration(
    source,
    { "releaseId": 'v1', "locale": 'zh-CN', "id": 'guide-start' },
    'v2'
  )
  assert.equal(result.status, 'ambiguous')
  assert.deepEqual(result.candidates.map((item) => item.target.id).sort(), [
    'guide-installation',
    'guide-quickstart'
  ])
})

test('章节合并时唯一目标可自动打开并投影锚点', () => {
  const result = resolveMigration(
    source,
    { "releaseId": 'v2', "locale": 'zh-CN', "id": 'guide-installation' },
    'v3',
    { "anchor": 'install' }
  )
  assert.equal(result.status, 'unique')
  assert.equal(result.candidates[0].href, '/v3/guide/start#install')
  assert.equal(result.candidates[0].relation, 'merge')
})

test('旧深链接在拆分章节中选择带匹配锚点的候选', () => {
  const result = resolveMigration(
    source,
    { "releaseId": 'v1', "locale": 'zh-CN', 'id': 'guide-start' },
    'v2',
    { "anchor": 'import-component' }
  )
  assert.equal(result.candidates[0].target.id, 'guide-quickstart')
  assert.equal(result.candidates[0].href, '/guide/quickstart#import')
})

test('v3 合并页反向切换到 v2 仍然保持一对多', () => {
  const result = resolveMigration(
    source,
    { "releaseId": 'v3', "locale": 'zh-CN', "id": 'guide-start' },
    'v2'
  )
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.candidates.length, 2)
})

test('迁移链超过上限时给出 chain-limit', () => {
  const result = resolveMigration(
    source,
    { "releaseId": 'v1', "locale": 'zh-CN', "id": 'guide-start' },
    'v3',
    { "maxHops": 1 }
  )
  assert.equal(result.status, 'chain-limit')
  assert.equal(result.candidates.length, 0)
})

test('没有迁移边到目标版本时返回 missing-target', () => {
  const result = resolveMigration(
    source,
    { "releaseId": 'v2', "locale": 'zh-CN', "id": 'guide-installation' },
    'v4'
  )
  assert.equal(result.status, 'missing-target')
  assert.equal(result.candidates.length, 0)
})

test('锚点无法沿迁移边投影时给出明确原因', () => {
  const result = resolveMigration(
    source,
    { "releaseId": 'v2', "locale": 'zh-CN', "id": 'guide-quickstart' },
    'v3',
    { anchor: 'not-in-map' }
  )
  assert.equal(result.candidates[0].anchorStatus, 'unmapped-anchor')
  assert.match(result.candidates[0].anchorReason, /not-in-map/)
})

test('私有版撤权返回 access-denied 且不暴露私有目标', () => {
  const result = resolveMigration(
    source,
    { "releaseId": 'v3', "locale": 'zh-CN', "id": 'components-button' },
    'v4'
  )
  assert.equal(result.status, 'access-denied')
  assert.match(result.accessDenied[0].node.title, /私有预览/)
})

test('稳定节点跨版本迁移英文按钮深链接', () => {
  const result = resolveMigration(
    source,
    { "releaseId": 'v1', "locale": 'en-US', "id": 'components-button' },
    'v3',
    { "anchor": 'basic-usage' }
  )
  assert.equal(result.status, 'unique')
  assert.equal(result.candidates[0].href, '/en/v3/components/button#basic-usage')
})

test('能识别带版本前缀和语言前缀的路由', () => {
  const parsed = parseRoute('/en/v3/guide/start#install', source.releases)
  assert.deepEqual(parsed, {
    "releaseId": 'v3',
    "locale": 'en-US',
    path: '/guide/start',
    "anchor": 'install'
  })
})

test('构建图无循环', () => {
  assert.equal(detectCycle(source, buildIndexes(source)).cyclic, false)
})

test('循环诊断返回涉及的节点链', () => {
  const cyclic = {
    ...source,
    edges: [
      ...source.edges,
      {
        from: { "releaseId": 'v3', "locale": 'zh-CN', nodeId: 'guide-start' },
        to: { "releaseId": 'v1', "locale": 'zh-CN', nodeId: 'guide-start' },
        type: 'renamed',
        anchorMap: { install: 'install-command' }
      }
    ]
  }
  const result = detectCycle(cyclic)
  assert.equal(result.cyclic, true)
  assert.ok(result.cycle.length >= 3)
})

test('目标完整 URL 由版本基路径、语言基路径和节点路径组成', () => {
  const release = source.releases.find((item) => item.id === 'v3')
  const node = source.nodes.find((item) => item.releaseId === 'v3' && item.locale === 'en-US' && item.id === 'guide-start')
  assert.equal(fullNodePath(release, node), '/en/v3/guide/start')
})
