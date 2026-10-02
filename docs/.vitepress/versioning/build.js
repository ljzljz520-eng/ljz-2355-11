#!/usr/bin/env node
// 构建任务：拉取版本 API -> 校验/物化 -> 原子发布绑定 commit 的目录。
//
// 用法：
//   node build.js --commit <git-sha> [--product demo-lib]
//                 [--fixtures <dir>] [--out <dir>] [--fail-index]
//
// --fail-index：模拟“索引重建失败”——只拉数据、不发布；验证旧目录仍可服务读者。

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { fileApiSource, fetchBuildInput } from './api/client.js'
import { assembleCatalog, publishAtomic } from './core/catalog.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
  }
  return args
}

function detectCommit(explicit) {
  if (explicit) return explicit
  try {
    return execSync('git rev-parse HEAD', { cwd: path.join(HERE, '..', '..', '..') }).toString().trim()
  } catch {
    return `unknown-${Date.now()}`
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const product = args.product || 'demo-lib'
  const commit = detectCommit(args.commit)
  const fixtures = args.fixtures ? path.resolve(args.fixtures) : undefined
  const out = path.resolve(args.out || path.join(HERE, '..', '..', 'public', 'version-data'))

  const started = Date.now()
  console.log(`[version-build] product=${product} commit=${commit}`)

  // 1) 从版本 API 拉取章节与术语索引
  let input
  try {
    input = await fetchBuildInput(fileApiSource(fixtures), { product })
  } catch (err) {
    console.error('[version-build] 索引重建失败（拉取阶段）：', err.message)
    console.error('[version-build] 已保留 last-good 目录，读者不受影响；本次构建中止。')
    process.exit(2)
  }

  // 2) 校验 + 物化所有迁移
  const { catalog, issues, ok } = assembleCatalog({
    ...input,
    build: { product, commit, builtAt: new Date().toISOString() }
  })

  const fatal = issues.filter((i) => i.severity === 'fatal')
  const warning = issues.filter((i) => i.severity !== 'fatal')
  for (const i of issues) {
    const line = `[version-build] ${i.severity.toUpperCase()} ${i.code}: ${i.message}`
    if (i.severity === 'fatal') console.error(line); else console.warn(line)
  }

  if (!ok || args['fail-index'] === true || args['fail-index'] === 'true') {
    console.error(`[version-build] 索引重建失败（${fatal.length} 个致命问题或 --fail-index）。`)
    console.error('[version-build] 不写入新目录，已发布的 last-good 快照继续服务读者。')
    process.exit(2)
  }

  // 3) 原子发布
  const result = await publishAtomic(out, catalog)
  if (!result.published) {
    console.error('[version-build] 原子发布失败：', result.error?.message)
    console.error('[version-build] 旧目录保留（keptPrevious=true）。')
    process.exit(3)
  }

  // 4) 运行时路由映射（供 Markdown 插件/UI 从当前 URL 判定所在版本）
  await fsp.writeFile(
    path.join(out, 'page-version.json'),
    JSON.stringify(buildPageVersionMap(catalog), null, 2),
    'utf8'
  )

  console.log(`[version-build] 已发布 ${result.file}`)
  console.log(`[version-build] 版本 ${catalog.order.join(', ')}；${warning.length} 条警告；用时 ${Date.now() - started}ms`)
}

export function buildPageVersionMap(catalog) {
  const map = []
  for (const v of catalog.versions) {
    for (const s of catalog.sections[v.version] || []) {
      map.push({ pathPrefix: v.basePath, version: v.version, path: s.path, nodeId: s.id })
    }
  }
  return map
}

main().catch((err) => {
  console.error('[version-build] 未预期错误：', err)
  process.exit(1)
})
