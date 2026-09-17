/**
 * 候选路径枚举
 *
 * 规则：
 *  - 听众频道可以直译（主讲语 → 目标语），也可以经过一种「中继语言」，最多两跳；
 *  - 只使用在线译员；自环（源=目标）译员视为无效；
 *  - 用「已访问语种集合」拒绝循环：中继语不得等于主讲语或目标语，
 *    同一条路径上同一位译员也不得重复出现；
 *  - 输出顺序完全确定：直译优先于中继；中继按频道声明的偏好排序；
 *    同等条件下容量大的译员优先（把小容量备援留到最后），再按姓名、id。
 *    容量不参与候选路径的「可行性」判断（在分配阶段处理剩余席位）。
 */
import type { Channel, Interpreter, LangCode, Meeting, Route } from './types'

interface OrderedInterpreter extends Interpreter {}

function makeRoute(
  channelId: string,
  hops: Route['hops'],
  relay: LangCode | null,
): Route {
  return {
    channelId,
    hops,
    hopsCount: hops.length as Route['hopsCount'],
    relay,
    key: hops.map((h) => h.interpreterId).join('>'),
  }
}

/**
 * 枚举某个频道在当前在线状态下的全部候选路径（不考虑剩余席位）。
 */
export function buildCandidateRoutes(meeting: Meeting, channel: Channel): Route[] {
  const { speaker, interpreters } = meeting
  const routes: Route[] = []

  // 源声频道：目标语就是主讲语，无需译员（零跳）。
  if (channel.target === speaker) {
    return [makeRoute(channel.id, [], null)]
  }

  const online: OrderedInterpreter[] = interpreters.filter(
    (i) => i.online && i.source !== i.target,
  )

  const byPair = (from: LangCode, to: LangCode): OrderedInterpreter[] =>
    online
      .filter((i) => i.source === from && i.target === to)
      .sort(
        (a, b) =>
          b.capacity - a.capacity ||
          a.name.localeCompare(b.name, 'zh') ||
          a.id.localeCompare(b.id),
      )

  const toHop = (i: OrderedInterpreter) => ({
    interpreterId: i.id,
    from: i.source,
    to: i.target,
  })

  // —— 第一优先：直译 ——
  for (const i of byPair(speaker, channel.target)) {
    routes.push(makeRoute(channel.id, [toHop(i)], null))
  }

  // —— 第二优先：一次中继（两跳）——
  const seenRelays = new Set<LangCode>()
  channel.allowedRelays.forEach((relay) => {
    if (seenRelays.has(relay)) return
    seenRelays.add(relay)

    // 循环拒绝：中继语必须是与主讲语、目标语都不同的第三种语言。
    if (relay === speaker || relay === channel.target) return

    const first = byPair(speaker, relay)
    const second = byPair(relay, channel.target)
    if (first.length === 0 || second.length === 0) return

    for (const a of first) {
      for (const b of second) {
        // 同一位译员不能在一条路径里出现两次（也拒绝重复节点造成的环）。
        if (a.id === b.id) continue
        // 已访问语种集合：speaker → relay → target，三者互不相同才成立。
        const visited = new Set<LangCode>([speaker, relay, channel.target])
        if (visited.size !== 3) continue
        routes.push(makeRoute(channel.id, [toHop(a), toHop(b)], relay))
      }
    }
  })

  return sortRoutes(routes, channel, capacityOf(online))
}

function capacityOf(list: Interpreter[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of list) m.set(i.id, i.capacity)
  return m
}

/**
 * 确定性排序：跳数少者优先；同为两跳时按频道的中继偏好；
 * 再按各跳译员「容量降序」（大舱优先、保留小舱备援），最后按姓名/id。
 */
export function sortRoutes(
  routes: Route[],
  channel: Channel,
  cap: Map<string, number> = new Map(),
): Route[] {
  const relayPref = (r: Route) =>
    r.relay === null ? -1 : channel.allowedRelays.indexOf(r.relay)

  // 逐跳比较容量：先比第一跳，容量大者优先；相同再比第二跳
  const compareCaps = (x: Route, y: Route): number => {
    const n = Math.min(x.hops.length, y.hops.length)
    for (let k = 0; k < n; k++) {
      const cx = cap.get(x.hops[k].interpreterId) ?? 0
      const cy = cap.get(y.hops[k].interpreterId) ?? 0
      if (cx !== cy) return cy - cx
    }
    return 0
  }

  return [...routes].sort((x, y) => {
    if (x.hopsCount !== y.hopsCount) return x.hopsCount - y.hopsCount
    const rx = relayPref(x)
    const ry = relayPref(y)
    if (rx !== ry) return rx - ry
    const byCap = compareCaps(x, y)
    if (byCap !== 0) return byCap
    return x.key.localeCompare(y.key)
  })
}
