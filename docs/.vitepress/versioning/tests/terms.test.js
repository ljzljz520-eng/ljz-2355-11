import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTermIndex, resolveTermRef, traceTerm } from '../core/terms.js'

test('重名术语：未限定 => ambiguous 并给出 scopes（含全局）；限定 => 唯一定义', () => {
  const idx = buildTermIndex([
    { id: 't1', slug: 'token', scope: null, title: '全局', body: 'g' },
    { id: 't2', slug: 'token', scope: 'css', title: 'CSS', body: 'c' },
    { id: 't3', slug: 'token', scope: 'js', title: 'JS', body: 'j' }
  ])
  const amb = resolveTermRef('token', idx)
  assert.equal(amb.status, 'ambiguous')
  assert.deepEqual(amb.scopes, [null, 'css', 'js'])

  const css = resolveTermRef('token@css', idx)
  assert.equal(css.status, 'unique')
  assert.equal(css.term.title, 'CSS')
})

test('唯一术语直接解析', () => {
  const idx = buildTermIndex([
    { id: 't1', slug: 'sdk', scope: null, title: 'SDK', body: '' }
  ])
  assert.equal(resolveTermRef('sdk', idx).status, 'unique')
})

test('未知术语（含限定名）明确报 unknown，不回退到其它版本词典', () => {
  const idx = buildTermIndex([{ id: 't', slug: 'a', scope: null, title: 'A', body: '' }])
  const r = resolveTermRef('b@css', idx)
  assert.equal(r.status, 'unknown')
  assert.equal(r.qualified, 'b@css')
})

test('重复限定名在索引构建时被捕获', () => {
  const idx = buildTermIndex([
    { id: 't', slug: 'a', scope: 'x', title: '1', body: '' },
    { id: 't', slug: 'a', scope: 'x', title: '2', body: '' }
  ])
  assert.deepEqual(idx.duplicateQualified, ['a@x'])
})

test('术语跨版本：rename 链追踪（1.1 app -> 2.0 sdk）', () => {
  const order = ['1.1.0', '2.0.0']
  const termEdges = [
    { id: 'te', fromVersion: '1.1.0', toVersion: '2.0.0', fromTermId: 'term-app', toTermId: 'term-sdk', kind: 'rename' }
  ]
  const r = traceTerm({ termEdges, order, from: '1.1.0', to: '2.0.0', termId: 'term-app' })
  assert.equal(r.status, 'unique')
  assert.equal(r.termId, 'term-sdk')
})

test('术语拆分 => choose；removed => removed', () => {
  const order = ['1.1.0', '2.0.0']
  const split = [
    { id: 't1', fromVersion: '1.1.0', toVersion: '2.0.0', fromTermId: 'term-dialog', toTermId: 'term-modal', kind: 'split' },
    { id: 't2', fromVersion: '1.1.0', toVersion: '2.0.0', fromTermId: 'term-dialog', toTermId: 'term-drawer', kind: 'split' }
  ]
  const rc = traceTerm({ termEdges: split, order, from: '1.1.0', to: '2.0.0', termId: 'term-dialog' })
  assert.equal(rc.status, 'choose')
  assert.equal(rc.candidates.length, 2)

  const rm = traceTerm({
    termEdges: [{ id: 'r', fromVersion: '1.1.0', toVersion: '2.0.0', fromTermId: 'term-x', toTermId: null, kind: 'removed', note: '废弃' }],
    order, from: '1.1.0', to: '2.0.0', termId: 'term-x'
  })
  assert.equal(rm.status, 'removed')
  assert.match(rm.reason, /废弃/)
})

test('术语环与链上限', () => {
  const order = ['1.1.0', '2.0.0', '3.0.0']
  const cyc = [
    { id: 'a', fromVersion: '1.1.0', toVersion: '2.0.0', fromTermId: 'x', toTermId: 'y', kind: 'rename' },
    { id: 'b', fromVersion: '2.0.0', toVersion: '3.0.0', fromTermId: 'y', toTermId: 'x', kind: 'rename' }
  ]
  const r = traceTerm({ termEdges: cyc, order, from: '1.1.0', to: '3.0.0', termId: 'x' })
  assert.equal(r.status, 'error')
  assert.match(r.reason, /环/)

  const longOrder = ['v0', 'v1', 'v2', 'v3']
  const longEdges = []
  for (let i = 0; i < 3; i++) {
    longEdges.push({ id: `e${i}`, fromVersion: longOrder[i], toVersion: longOrder[i + 1], fromTermId: `n${i}`, toTermId: `n${i + 1}`, kind: 'rename' })
  }
  const rl = traceTerm({ termEdges: longEdges, order: longOrder, from: 'v0', to: 'v3', termId: 'n0', maxChain: 1 })
  assert.equal(rl.status, 'error')
  assert.match(rl.reason, /上限/)
})
