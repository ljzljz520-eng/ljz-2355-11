// 版本 API 客户端。
//
// 生产环境应替换 base 指向真实后端：
//   GET  {base}/products/:product/versions                -> Version[]
//   GET  {base}/products/:product/versions/:v/sections    -> Section[]
//   GET  {base}/products/:product/versions/:v/terms       -> Term[]
//   GET  {base}/products/:product/edges?kind=section|term -> Edge[]
//
// 本演示仓库用 fixtures/ 下的静态 JSON 模拟该 API（fileApiSource）；
// 浏览器运行时则通过 fetch 读取构建产物 /version-data/*（staticFetchSource）。
// “页面从版本 API 获取章节与术语索引”即由此抽象承担。

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 基于夹具目录的 API 源（构建任务使用） */
export function fileApiSource(fixtureDir = path.join(HERE, '..', 'fixtures')) {
  const readJson = async (p) => JSON.parse(await fsp.readFile(p, 'utf8'))
  return {
    async getVersions() {
      return readJson(path.join(fixtureDir, 'versions.json'))
    },
    async getSections(_product, version) {
      return readJson(path.join(fixtureDir, 'sections', `${version}.json`))
    },
    async getTerms(_product, version) {
      return readJson(path.join(fixtureDir, 'terms', `${version}.json`))
    },
    async getSectionEdges() {
      return readJson(path.join(fixtureDir, 'edges.json'))
    },
    async getTermEdges() {
      return readJson(path.join(fixtureDir, 'term-edges.json'))
    }
  }
}

/** 带超时与状态校验的 HTTP API 源（真实后端接入时使用） */
export function httpApiSource(base, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const get = async (p) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`${base.replace(/\/$/, '')}${p}`, { signal: ctrl.signal })
      if (!res.ok) {
        const err = new Error(`版本 API ${p} 返回 ${res.status}`)
        err.status = res.status
        throw err
      }
      return await res.json()
    } finally {
      clearTimeout(t)
    }
  }
  return {
    getVersions: () => get('/versions'),
    getSections: (_product, v) => get(`/versions/${encodeURIComponent(v)}/sections`),
    getTerms: (_product, v) => get(`/versions/${encodeURIComponent(v)}/terms`),
    getSectionEdges: () => get('/edges?kind=section'),
    getTermEdges: () => get('/edges?kind=term')
  }
}

/**
 * 拉取构建所需的全部输入。任一资源失败即抛出（由构建任务转为“索引重建失败”，
 * 不覆盖已发布目录）。
 */
export async function fetchBuildInput(api, { product } = {}) {
  const versions = await api.getVersions(product)
  const [sections, termsByVersion] = await Promise.all([
    Promise.all(versions.map((v) => api.getSections(product, v.version).then((list) =>
      list.map((s) => ({ ...s, version: s.version || v.version }))
    ))),
    Promise.all(versions.map((v) => api.getTerms(product, v.version).then((list) => [v.version, list])))
  ])
  return {
    versions,
    sections: sections.flat(),
    termsByVersion: Object.fromEntries(termsByVersion),
    edges: await api.getSectionEdges(product),
    termEdges: await api.getTermEdges(product)
  }
}
