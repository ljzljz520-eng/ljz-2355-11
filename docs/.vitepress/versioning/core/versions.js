// 版本模型与版本链工具
//
// 设计要点：
// - 一个产品(product)的每个版本(version)是版本线上的一个节点，按 semver 排序。
// - 章节迁移边(section edge)是“相邻版本之间”的有向边；跨多个版本时需要沿版本链
//   逐版本合成(见 graph.js)。因此这里提供稳定、可测的 semver 比较与版本链遍历。
// - 语义化预发布(如 3.0-beta)视为 < 3.0，公开状态(status)与授权(scopes)独立于排序。

/**
 * 解析语义化版本号，支持 pre-release 标签（如 1.0.0、2、3.0-beta.1）。
 * @param {string} raw
 * @returns {{major:number,minor:number,patch:number,pre:(string|number)[]}}
 */
export function parseVersion(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(`非法版本号: ${String(raw)}`)
  }
  const m = raw.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/)
  if (!m) throw new Error(`无法解析版本号: ${raw}`)
  const pre = m[4]
    ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p))
    : []
  return {
    major: Number(m[1]),
    minor: m[2] === undefined ? 0 : Number(m[2]),
    patch: m[3] === undefined ? 0 : Number(m[3]),
    pre
  }
}

/**
 * semver 比较：-1 / 0 / 1。有 pre-release 的同 (major,minor,patch) 更小。
 */
export function compareVersions(a, b) {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  const keys = ['major', 'minor', 'patch']
  for (const k of keys) {
    if (va[k] !== vb[k]) return va[k] < vb[k] ? -1 : 1
  }
  if (va.pre.length === 0 && vb.pre.length === 0) return 0
  if (va.pre.length === 0) return 1 // 1.0.0 > 1.0.0-beta
  if (vb.pre.length === 0) return -1
  const len = Math.max(va.pre.length, vb.pre.length)
  for (let i = 0; i < len; i++) {
    if (i === va.pre.length) return -1
    if (i === vb.pre.length) return 1
    const x = va.pre[i]
    const y = vb.pre[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x === 'number') return -1 // 数字标识符 < 字母标识符
    if (typeof y === 'number') return 1
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

/**
 * 按 semver 升序返回版本（去重、不修改入参）。
 * @param {{version:string}[]} versions
 */
export function sortVersions(versions) {
  return [...versions].sort((a, b) => compareVersions(a.version, b.version))
}

/**
 * 返回从 from 到 to 之间（含两端）的版本路径，按“行进方向”排列。
 *
 * 例如版本链 [1.0, 1.1, 2.0]：
 *   chainPath(list, '1.0', '2.0') => ['1.0','1.1','2.0']
 *   chainPath(list, '2.0', '1.0') => ['2.0','1.1','1.0']
 *
 * @param {string[]} ordered 已升序排列的版本号数组
 * @param {string} from
 * @param {string} to
 * @returns {string[]|null} 任一端点不在链上时返回 null（缺失目标的一种）
 */
export function chainPath(ordered, from, to) {
  const i = ordered.indexOf(from)
  const j = ordered.indexOf(to)
  if (i === -1 || j === -1) return null
  if (i === j) return [from]
  return i < j ? ordered.slice(i, j + 1) : ordered.slice(j, i + 1).reverse()
}

/**
 * 读者可见的版本：public 或其私有范围已被授权。
 * draft 永不出现在版本导航中（编辑中的变更未发布，不影响读者）。
 *
 * @param {{status:string,scopes?:string[]}} v
 * @param {string[]} [grantedScopes]
 */
export function isVersionVisible(v, grantedScopes = []) {
  if (v.status === 'draft') return false
  if (v.status === 'public') return true
  if (v.status === 'private') {
    const need = v.scopes || []
    return need.length > 0 && need.every((s) => grantedScopes.includes(s))
  }
  return false
}
