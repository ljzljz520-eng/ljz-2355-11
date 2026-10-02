// 切换版本时的阅读状态迁移。
//
// - 锚点：使用解析器逐跳映射后的 anchor；丢失时给理由并落到页面顶部。
// - 滚动：映射后锚点存在 => 浏览器原生定位；否则记录相对滚动比例，
//   在新页面按文档高度比例恢复（“尽可能迁移”）。
// - 展开状态：<details data-block-id> 的 ID 经 blocks 映射迁移；
//   无法映射的块给出 lostReason，不强行展开其它块。

export const PENDING_KEY = 'vp-pending-version-state'

/**
 * 保存切换前的状态（在导航离开前调用）。
 * @param {string} fromVersion
 * @param {string} nodeId
 */
export function capturePendingState(fromVersion, nodeId, { anchor, blocks } = {}) {
  const docEl = document.documentElement
  const scrollable = docEl.scrollHeight - window.innerHeight
  const ratio = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0
  const openBlocks = blocks && blocks.length
    ? blocks
    : [...document.querySelectorAll('details[data-block-id][open]')].map((el) => el.dataset.blockId)
  const payload = {
    fromVersion,
    nodeId,
    anchor: anchor || (location.hash || '').replace(/^#/, '') || null,
    ratio,
    blocks: openBlocks,
    createdAt: Date.now()
  }
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload)) } catch { /* ignore */ }
  return payload
}

export function readPendingState() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function clearPendingState() {
  try { sessionStorage.removeItem(PENDING_KEY) } catch { /* ignore */ }
}

/**
 * 在新页面应用迁移结果。
 * @param {object} args
 * @param {object|null} args.materialized 物化的单条解析结果（含 anchor/blocks 状态在运行时计算）
 * @param {{source:string,current:string|null,lostReason:string|null}[]} args.blockMap
 *        由解析器返回的 blocks（源块 -> 目标块）
 * @param {number} args.fallbackRatio
 */
export async function applyMigratedState({ anchor, anchorNote, blockMap, fallbackRatio, onNote }) {
  const notes = []
  // 1) 展开状态迁移：等下一帧 DOM 就绪
  await nextFrame()
  for (const b of blockMap || []) {
    if (b.current) {
      const el = document.querySelector(`details[data-block-id="${CSS.escape(b.current)}"]`)
      if (el) el.open = true
      else notes.push(`目标页面没有折叠块 ${b.current}`)
    } else if (b.lostReason) {
      notes.push(b.lostReason)
    }
  }

  // 2) 锚点 / 滚动
  await nextFrame()
  if (anchor) {
    const el = document.getElementById(anchor) || document.querySelector(`[data-anchor="${anchor}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'auto', block: 'start' })
      history.replaceState(null, '', `#${anchor}`)
    } else {
      notes.push(`目标文档缺少锚点 #${anchor}，已定位到页面顶部`)
      window.scrollTo({ top: 0 })
    }
  } else {
    if (anchorNote) notes.push(anchorNote)
    const h = document.documentElement.scrollHeight - window.innerHeight
    if (h > 0 && fallbackRatio > 0) window.scrollTo({ top: Math.round(h * fallbackRatio) })
  }

  if (notes.length && typeof onNote === 'function') onNote(notes)
  return notes
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}
