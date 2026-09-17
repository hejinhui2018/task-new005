/**
 * 节点图布局（纯函数）
 *
 * 以主讲语为第 0 层，沿在线译员构成的语种图做 BFS：
 *   第 1 层 = 可直译到达的语种
 *   第 2 层 = 需一次中继到达的语种（本系统上限）
 * 译员节点放在源/目标语种节点的中点；同一语种对上的多位译员纵向散开。
 */
import type { Interpreter, LangCode, Meeting } from '../engine'

export interface LangNodePos {
  code: LangCode
  x: number
  y: number
  depth: number
}

export interface InterpNodePos {
  interpreter: Interpreter
  x: number
  y: number
}

export interface GraphLayout {
  width: number
  height: number
  speaker: LangNodePos
  languages: LangNodePos[]
  interpreters: InterpNodePos[]
}

const WIDTH = 980
const HEIGHT = 560
const MARGIN_Y = 90
const COL_X = [70, 430, 880]
const PAIR_GAP = 52

export function buildLayout(meeting: Meeting): GraphLayout {
  const { speaker, interpreters, languages, channels } = meeting

  // 仅以在线译员建立语种邻接（自环无效）
  const adj = new Map<LangCode, Set<LangCode>>()
  for (const i of interpreters) {
    if (!i.online || i.source === i.target) continue
    if (!adj.has(i.source)) adj.set(i.source, new Set())
    adj.get(i.source)!.add(i.target)
  }

  // BFS 深度（上限两跳）
  const depth = new Map<LangCode, number>([[speaker, 0]])
  let frontier: LangCode[] = [speaker]
  for (let d = 0; d < 2; d++) {
    const next: LangCode[] = []
    for (const code of frontier) {
      for (const nb of adj.get(code) ?? []) {
        if (!depth.has(nb)) {
          depth.set(nb, d + 1)
          next.push(nb)
        }
      }
    }
    frontier = next
  }

  // 未连通的语种：若被频道引用放第 2 层，否则第 1 层
  const channelTargets = new Set(channels.map((c) => c.target))
  for (const lang of languages) {
    if (!depth.has(lang.code)) {
      depth.set(lang.code, channelTargets.has(lang.code) ? 2 : 1)
    }
  }

  const byDepth = (d: number) =>
    languages
      .filter((l) => depth.get(l.code) === d && l.code !== speaker)
      .map((l) => l.code)
      .sort((a, b) => a.localeCompare(b))

  const col1 = byDepth(1)
  const col2 = byDepth(2)

  // 让第 2 层语种按频道优先级排序（高优先级在上）
  const prioOf = (code: LangCode) => {
    const ch = channels.find((c) => c.target === code)
    return ch ? ch.priority : 999
  }
  col2.sort((a, b) => prioOf(a) - prioOf(b) || a.localeCompare(b))

  const positions = new Map<LangCode, LangNodePos>()
  const placeColumn = (codes: LangCode[], d: number) => {
    const n = codes.length
    codes.forEach((code, idx) => {
      const y =
        n === 1 ? HEIGHT / 2 : MARGIN_Y + (idx * (HEIGHT - 2 * MARGIN_Y)) / (n - 1)
      positions.set(code, { code, x: COL_X[d], y, depth: d })
    })
  }

  positions.set(speaker, { code: speaker, x: COL_X[0], y: HEIGHT / 2, depth: 0 })
  // 没有第 2 层时，第 1 层居中使用更宽的列位
  if (col2.length === 0 && col1.length > 0) {
    const n = col1.length
    col1.forEach((code, idx) => {
      const y =
        n === 1 ? HEIGHT / 2 : MARGIN_Y + (idx * (HEIGHT - 2 * MARGIN_Y)) / (n - 1)
      positions.set(code, { code, x: 620, y, depth: 1 })
    })
  } else {
    placeColumn(col1, 1)
    placeColumn(col2, 2)
  }

  // 译员节点：按语种对分组，纵向散开
  const groups = new Map<string, Interpreter[]>()
  for (const interp of interpreters) {
    const key = `${interp.source}→${interp.target}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(interp)
  }

  const interpNodes: InterpNodePos[] = []
  for (const list of groups.values()) {
    list.sort((a, b) => b.capacity - a.capacity || a.name.localeCompare(b.name, 'zh'))
    // 用在线端点估算中点；端点缺失时退回到固定列
    const src = positions.get(list[0].source)
    const dst = positions.get(list[0].target)
    const baseX = src && dst ? (src.x + dst.x) / 2 : 250
    const baseY = src && dst ? (src.y + dst.y) / 2 : HEIGHT / 2

    list.forEach((interp, idx) => {
      const offset = (idx - (list.length - 1) / 2) * PAIR_GAP
      // 同列语种之间的译员（链路断开时会出现）：向画布内侧散开，避免溢出右缘
      const sameColumn = src && dst && src.x === dst.x
      interpNodes.push({
        interpreter: interp,
        x: sameColumn ? baseX - 90 - Math.abs(offset) : baseX,
        y: sameColumn ? baseY + (idx - (list.length - 1) / 2) * PAIR_GAP : baseY + offset,
      })
    })
  }

  return {
    width: WIDTH,
    height: HEIGHT,
    speaker: positions.get(speaker)!,
    languages: [...positions.values()].filter((p) => p.code !== speaker),
    interpreters: interpNodes,
  }
}
