// VitePress Markdown 扩展：
// 1) 行内术语 {{t:slug}} / {{t:slug@scope}}
//    渲染为 <VersionTerm>，并把“当前文档版本”透传进去——版本由文件路径决定，
//    组件挂载后只从该版本的词典取定义（历史文档不拼接最新词典）。
// 2) ::: legacy 容器：过时示例，标注适用版本范围与替代入口。
//
// 不依赖构建产物即可解析；术语定义在运行时由组件 fetch manifest 获取。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mdContainer from 'markdown-it-container'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

/** 根据文件路径判断文档版本（与 page-version 约定一致） */
export function versionOfFile(relativePath) {
  const norm = relativePath.replace(/\\/g, '/')
  if (norm.startsWith('v1/') || norm.includes('/v1/')) return '1.1.0'
  if (norm.startsWith('next/') || norm.includes('/next/')) {
    // /next/ 目录当前托管 3.0-beta 私有预览
    return '3.0.0-beta'
  }
  return '2.0.0'
}

const TERM_RE = /\{\{t:([a-z0-9][\w-]*)(?:@([a-z0-9][\w-]*))?\}\}/i

export function installVersionMarkdown(md, { buildDir = path.join(HERE, 'versioning') } = {}) {
  // -------- 行内术语 --------
  md.inline.ruler.after('text', 'version_term', (state, silent) => {
    const m = TERM_RE.exec(state.src.slice(state.pos))
    if (!m || m.index !== 0) return false
    if (!silent) {
      const token = state.push('version_term', '', 0)
      token.content = m[0]
      token.meta = { slug: m[1], scope: m[2] || '' }
    }
    state.pos += m[0].length
    return true
  })

  md.renderer.rules.version_term = (tokens, idx, opts, env) => {
    const { slug, scope } = tokens[idx].meta
    const file = env?.relativePath || env?.path || ''
    const version = versionOfFile(file)
    const scopeAttr = scope ? ` scope="${scope}"` : ''
    return `<VersionTerm slug="${slug}"${scopeAttr} version="${version}" />`
  }

  // -------- ::: legacy 容器 --------
  md.use(mdContainer, 'legacy', {
    validate(params) {
      return !!params.trim().match(/^legacy(\s+(.*))?$/)
    },
    render(tokens, idx) {
      if (tokens[idx].nesting === 1) {
        const info = tokens[idx].info.trim().match(/^legacy(\s+(.*))?$/)
        const rest = (info?.[2] || '').trim()
        // 参数格式：适用范围 | 替代入口（可选）
        const [range, alt] = rest.split('|').map((s) => (s || '').trim())
        return `<VersionLegacy range="${escapeAttr(range || '历史版本')}"${alt ? ` alt="${escapeAttr(alt)}"` : ''}>\n`
      }
      return '</VersionLegacy>\n'
    }
  })

  // -------- ::: removed 容器：已下线章节说明 --------
  md.use(mdContainer, 'removed', {
    validate(params) { return !!params.trim().match(/^removed(\s+(.*))?$/) },
    render(tokens, idx) {
      if (tokens[idx].nesting === 1) {
        const note = (tokens[idx].info.trim().match(/^removed(\s+(.*))?$/)?.[2] || '该内容已在此版本下线').trim()
        return `<div class="vp-removed-doc"><strong>内容已下线</strong><p>${escapeAttr(note)}</p>`
      }
      return '</div>'
    }
  })
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
