/**
 * 语言路由台 —— 核心领域模型
 */

/** 语种代码，使用 ISO 639-1（zh / en / fr / ja …） */
export type LangCode = string

export interface Language {
  code: LangCode
  /** 中文显示名，如「英语」 */
  name: string
  /** 原生写法，如 English */
  native: string
}

export interface Interpreter {
  id: string
  name: string
  /** 源语种 */
  source: LangCode
  /** 目标语种 */
  target: LangCode
  /** 可同时承担的席位数（>0） */
  capacity: number
  /** 是否在线；离线译员不参与任何路径 */
  online: boolean
}

export type FailureCode =
  | 'NO_CANDIDATE' // 一跳、两跳均不存在任何译员链路
  | 'RELAY_BOTTLENECK' // 直译为空，所有中继路径在某一跳被容量/在线状态卡死
  | 'DIRECT_FULL_RELAY_UNAVAILABLE' // 直译译员全部占满，且无可用中继
  | 'NO_SPEAKER_RELAY' // 源语 → 中继语 这一跳不存在（中继链第一跳缺失）
  | 'RELAY_TO_TARGET_MISSING' // 中继语 → 目标语 这一跳不存在

export interface Channel {
  id: string
  /** 听众频道对应的目标语种 */
  target: LangCode
  /** 调度优先级，数字越小越优先（1 = 最高） */
  priority: number
  /**
   * 允许使用的中继语种（按偏好排序）。
   * 空数组 = 仅允许直译；最多允许一次中继（两跳）。
   */
  allowedRelays: LangCode[]
}

export interface Meeting {
  /** 主讲语种 */
  speaker: LangCode
  languages: Language[]
  interpreters: Interpreter[]
  channels: Channel[]
}

/** 一跳：一位译员占用一个席位 */
export interface Hop {
  interpreterId: string
  from: LangCode
  to: LangCode
}

/** 一条候选/实际路径，最多两跳 */
export interface Route {
  channelId: string
  hops: Hop[]
  /** 源声直出 = 0；直译 = 1；经一次中继 = 2 */
  hopsCount: 0 | 1 | 2
  relay: LangCode | null
  /** 路径上译员的稳定排序键，用于确定性决策 */
  key: string
}

/** 译员席位占用明细 */
export interface SeatUsage {
  interpreterId: string
  used: number
  capacity: number
  /** 哪些频道占用了该译员（含经过的频道） */
  consumers: string[]
}

export interface HopFailure {
  code: FailureCode
  /** 面向调度员的中文说明 */
  detail: string
  /** 卡点相关的译员（已满员等） */
  interpreterIds?: string[]
  /** 卡点语种对，如 [en, fr] */
  langPair?: [LangCode, LangCode]
}

export interface ChannelResult {
  channelId: string
  status: 'COVERED' | 'OVERLOADED' | 'BROKEN'
  route: Route | null
  /** 未采用但可行的备选路径（用于调度台展示） */
  alternatives: Route[]
  failure: HopFailure | null
}

export interface AllocationResult {
  channels: ChannelResult[]
  /** 以译员 id 为键的席位占用表 */
  usage: Record<string, SeatUsage>
  /** 在线但完全空闲的译员 id */
  idleInterpreters: string[]
  /** 统计摘要 */
  stats: {
    total: number
    covered: number
    overloaded: number
    broken: number
  }
}
