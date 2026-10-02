import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir, cp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts/build-catalog.mjs')

async function runBuild(sourceFile, outDir) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      '--source',
      path.relative(root, sourceFile),
      '--out',
      path.relative(root, outDir)
    ], { cwd: root })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message }
  }
}

test('索引重建在缺失迁移目标时失败', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'catalog-missing-'))
  try {
    const catalog = JSON.parse(await readFile(path.join(root, 'catalog/catalog.source.json'), 'utf8'))
    catalog.edges[0].to.nodeId = 'does-not-exist'
    const sourceFile = path.join(temp, 'catalog.json')
    const outDir = path.join(temp, 'out')
    await writeFile(sourceFile, JSON.stringify(catalog))
    const result = await runBuild(sourceFile, outDir)
    assert.equal(result.code, 2)
    assert.match(result.stderr, /MISSING_EDGE_TARGET/)
    assert.match(result.stderr, /索引重建失败/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('公开 API 隐藏撤权私有版的节点、术语和私有边', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'catalog-public-'))
  try {
    const sourceFile = path.join(root, 'catalog/catalog.source.json')
    const outDir = path.join(temp, 'out')
    const result = await runBuild(sourceFile, outDir)
    assert.equal(result.code, 0, result.stderr)

    const rootIndex = JSON.parse(await readFile(path.join(outDir, 'index.json'), 'utf8'))
    assert.equal(rootIndex.releases.some((release) => release.id === 'v4'), false)
    assert.equal(rootIndex.catalogs.v4, undefined)
    assert.equal(rootIndex.glossary.v4, undefined)

    const v3 = JSON.parse(await readFile(path.join(outDir, 'releases/v3/index.json'), 'utf8'))
    assert.equal(v3.edges.some((edge) => edge.to.releaseId === 'v4'), false)

    const glossary = JSON.parse(await readFile(path.join(outDir, 'releases/v2/glossary.json'), 'utf8'))
    const names = glossary.terms.map((term) => term.name)
    assert.equal(names.filter((name) => name === '按钮').length, 2)
    assert.equal(new Set(glossary.terms.map((term) => term.id)).size, 2)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('缺失 Markdown 文件会导致公开节点索引失败', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'catalog-file-'))
  try {
    const catalog = JSON.parse(await readFile(path.join(root, 'catalog/catalog.source.json'), 'utf8'))
    catalog.nodes.push({
      releaseId: 'v3',
      locale: 'zh-CN',
      id: 'missing-page',
      chapter: '指南',
      title: '缺失页面',
      path: '/guide/missing',
      anchors: []
    })
    const sourceFile = path.join(temp, 'catalog.json')
    const outDir = path.join(temp, 'out')
    await writeFile(sourceFile, JSON.stringify(catalog))
    const result = await runBuild(sourceFile, outDir)
    assert.equal(result.code, 2)
    assert.match(result.stderr, /MISSING_DOC_FILE/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('默认构建目录绑定当前提交并标记 working-tree 来源', async () => {
  const { stdout } = await execFileAsync(process.execPath, [script], { cwd: root })
  const manifest = JSON.parse(await readFile(path.join(root, 'catalog/build-manifest.json'), 'utf8'))
  assert.match(manifest.commit, /^[0-9a-f]{7,40}$/)
  assert.equal(manifest.source, 'working-tree')
  assert.match(stdout, new RegExp(manifest.commit.slice(0, 7)))
})

test('严格构建拒绝未提交编辑', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'catalog-strict-'))
  try {
    const work = path.join(temp, 'work')
    await mkdir(path.join(work, 'scripts'), { recursive: true })
    await mkdir(path.join(work, 'docs/.vitepress'), { recursive: true })
    await cp(path.join(root, 'scripts/build-catalog.mjs'), path.join(work, 'scripts/build-catalog.mjs'))
    await cp(
      path.join(root, 'docs/.vitepress/versioning'),
      path.join(work, 'docs/.vitepress/versioning'),
      { recursive: true }
    )
    await mkdir(path.join(work, 'catalog'), { recursive: true })
    await writeFile(path.join(work, 'catalog/catalog.source.json'), JSON.stringify({
      schemaVersion: 1,
      maxMigrationHops: 5,
      releases: [],
      nodes: [],
      edges: [],
      terms: []
    }))
    await execFileAsync('git', ['init', '--quiet'], { cwd: work })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: work })
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: work })
    await execFileAsync('git', ['add', '.'], { cwd: work })
    await execFileAsync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: work })
    await writeFile(path.join(work, 'README.md'), 'unpublished edit\n')
    await assert.rejects(
      execFileAsync(process.execPath, [path.join(work, 'scripts/build-catalog.mjs'), '--strict'], { cwd: work }),
      /严格构建要求干净工作区/
    )
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
