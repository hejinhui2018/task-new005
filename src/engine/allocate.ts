/**
 * 容量分配
 *
 * 每个被覆盖的听众频道恰好占用「一条路径」：直译占 1 个席位，
 * 一次中继占 2 个席位（两跳各一位译员）。
 *
 * 调度策略（确定性）：
 *  1. 频道按 priority 升序处理（1 最高），同优先级按 id；
 *  2. 每个频道按候选路径的固定顺序取「第一条每一跳跃仍有剩余席位」的路径；
 *  3. 已被高优先级频道占用的席位不可被抢占 —— 高优先级频道因此被确定性保住；
 *  4. 存在候选链路但全部因席位不足而放不下 → OVERLOADED（超载/竞争失败）；
 *     在线拓扑上根本不存在任何候选链路 → BROKEN（断路）。
 *     任何失败都不做部分占用，不会留下半条中继。
 */
import type {
  AllocationResult,
  Channel,
  ChannelResult,
  HopFailure,
  Interpreter,
  LangCode,
  Meeting,
  Route,
  SeatUsage,
} from './types'
import { buildCandidateRoutes } from './routes'

type Remaining = Record<string, number>

function initialRemaining(interpreters: Interpreter[]): Remaining {
  const r: Remaining = {}
  for (const i of interpreters) r[i.id] = i.online ? i.capacity : 0
  return r
}

function routeFits(route: Route, remaining: Remaining): boolean {
  // 每跳占一座位；同一路径理论上不会重复同一译员（枚举已排除），
  // 这里仍按跳数累计需求，保证严谨。
  const need = new Map<string, number>()
  for (const hop of route.hops) {
    need.set(hop.interpreterId, (need.get(hop.interpreterId) ?? 0) + 1)
  }
  for (const [id, seats] of need) {
    if ((remaining[id] ?? 0) < seats) return false
  }
  return true
}

function consume(route: Route, remaining: Remaining): void {
  for (const hop of route.hops) remaining[hop.interpreterId] -= 1
}

/** 拓扑层面的断路诊断（candidates 为空时调用） */
function diagnoseTopology(meeting: Meeting, channel: Channel): HopFailure {
  const { speaker, interpreters } = meeting
  const online = interpreters.filter((i) => i.online && i.source !== i.target)
  const existsPair = (from: LangCode, to: LangCode) =>
    online.some((i) => i.source === from && i.target === to)

  if (channel.allowedRelays.length === 0) {
    return {
      code: 'NO_CANDIDATE',
      detail: `没有在线译员能直译 ${speaker}→${channel.target}，且该频道未配置中继语言。`,
      langPair: [speaker, channel.target],
    }
  }

  for (const relay of channel.allowedRelays) {
    if (relay === speaker || relay === channel.target) continue
    if (!existsPair(speaker, relay)) {
      return {
        code: 'NO_SPEAKER_RELAY',
        detail: `中继链第一跳缺失：没有在线译员能把主讲语 ${speaker} 译成中继语 ${relay}。`,
        langPair: [speaker, relay],
      }
    }
    if (!existsPair(relay, channel.target)) {
      return {
        code: 'RELAY_TO_TARGET_MISSING',
        detail: `中继链第二跳缺失：没有在线译员能把中继语 ${relay} 译成 ${channel.target}。`,
        langPair: [relay, channel.target],
      }
    }
  }

  return {
    code: 'NO_CANDIDATE',
    detail: `不存在 ${speaker}→${channel.target} 的合规链路（中继语不能与主讲语或目标语相同）。`,
  }
}

/** 容量层面的超载诊断（存在候选但全部放不下时调用） */
function diagnoseCapacity(
  meeting: Meeting,
  channel: Channel,
  candidates: Route[],
  remaining: Remaining,
): HopFailure {
  const { speaker } = meeting
  const direct = candidates.filter((r) => r.hopsCount === 1)
  const relays = candidates.filter((r) => r.hopsCount === 2)

  // 沿候选顺序找第一条被容量卡住的路径，报告具体卡点跳
  for (const route of candidates) {
    const blocking = route.hops.filter((h) => (remaining[h.interpreterId] ?? 0) <= 0)
    if (blocking.length === 0) continue
    const hop = blocking[0]
    const ids = Array.from(new Set(blocking.map((h) => h.interpreterId)))
    if (route.hopsCount === 1) {
      return {
        code:
          relays.length === 0
            ? 'DIRECT_FULL_RELAY_UNAVAILABLE'
            : 'RELAY_BOTTLENECK',
        detail:
          relays.length === 0
            ? `直译译员 ${hop.from}→${hop.to} 的席位全部被高优先级频道占满，且没有可用中继路径。`
            : `直译 ${hop.from}→${hop.to} 席位已满；中继路径同样无法整体容纳。`,
        interpreterIds: ids,
        langPair: [hop.from, hop.to],
      }
    }
    return {
      code: 'RELAY_BOTTLENECK',
      detail: `中继路径 ${speaker}→${route.relay}→${channel.target} 在 ${hop.from}→${hop.to} 这一跳被占满（备援席位不足）。`,
      interpreterIds: ids,
      langPair: [hop.from, hop.to],
    }
  }

  // 直译为空、只有中继候选的兜底
  if (direct.length === 0 && relays.length > 0) {
    return {
      code: 'RELAY_BOTTLENECK',
      detail: '所有中继路径均因席位竞争失败，且无直译译员。',
    }
  }
  return {
    code: 'RELAY_BOTTLENECK',
    detail: '所有候选路径均因席位不足被高优先级频道挤占。',
  }
}

/**
 * 执行一次完整分配。纯函数：同输入必同输出。
 */
export function allocate(meeting: Meeting): AllocationResult {
  const remaining = initialRemaining(meeting.interpreters)

  const ordered = [...meeting.channels].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  )

  const results = new Map<string, ChannelResult>()

  for (const channel of ordered) {
    const candidates = buildCandidateRoutes(meeting, channel)

    // 源声频道（零跳）永远覆盖，不占席位
    if (candidates.length === 1 && candidates[0].hopsCount === 0) {
      results.set(channel.id, {
        channelId: channel.id,
        status: 'COVERED',
        route: candidates[0],
        alternatives: [],
        failure: null,
      })
      continue
    }

    const chosen = candidates.find((r) => routeFits(r, remaining)) ?? null
    if (chosen) {
      consume(chosen, remaining)
      results.set(channel.id, {
        channelId: channel.id,
        status: 'COVERED',
        route: chosen,
        alternatives: candidates.filter((r) => r.key !== chosen.key),
        failure: null,
      })
    } else if (candidates.length === 0) {
      results.set(channel.id, {
        channelId: channel.id,
        status: 'BROKEN',
        route: null,
        alternatives: [],
        failure: diagnoseTopology(meeting, channel),
      })
    } else {
      results.set(channel.id, {
        channelId: channel.id,
        status: 'OVERLOADED',
        route: null,
        alternatives: candidates,
        failure: diagnoseCapacity(meeting, channel, candidates, remaining),
      })
    }
  }

  // —— 汇总席位占用 ——
  const usage: Record<string, SeatUsage> = {}
  for (const interp of meeting.interpreters) {
    usage[interp.id] = {
      interpreterId: interp.id,
      used: 0,
      capacity: interp.capacity,
      consumers: [],
    }
  }
  for (const channel of ordered) {
    const route = results.get(channel.id)!.route
    if (!route) continue
    for (const hop of route.hops) {
      const u = usage[hop.interpreterId]
      u.used += 1
      if (!u.consumers.includes(channel.id)) u.consumers.push(channel.id)
    }
  }

  const list = meeting.channels.map((c) => results.get(c.id)!)
  const covered = list.filter((r) => r.status === 'COVERED').length
  const overloaded = list.filter((r) => r.status === 'OVERLOADED').length
  const broken = list.filter((r) => r.status === 'BROKEN').length

  const idleInterpreters = meeting.interpreters
    .filter((i) => i.online && (usage[i.id]?.used ?? 0) === 0)
    .map((i) => i.id)

  return {
    channels: list,
    usage,
    idleInterpreters,
    stats: { total: list.length, covered, overloaded, broken },
  }
}
