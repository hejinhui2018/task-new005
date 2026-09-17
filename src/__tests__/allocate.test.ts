import { describe, it, expect } from 'vitest'
import { allocate } from '../engine/allocate'
import type { Channel, Interpreter, Meeting } from '../engine'

const LANGS = [
  { code: 'zh', name: '中文', native: '中文' },
  { code: 'en', name: '英语', native: 'English' },
  { code: 'fr', name: '法语', native: 'Français' },
  { code: 'ja', name: '日语', native: '日本語' },
  { code: 'de', name: '德语', native: 'Deutsch' },
]

const interp = (
  id: string,
  source: string,
  target: string,
  capacity: number,
  online = true,
  name?: string,
): Interpreter => ({ id, name: name ?? id, source, target, capacity, online })

const channel = (
  id: string,
  target: string,
  priority: number,
  allowedRelays: string[] = [],
): Channel => ({ id, target, priority, allowedRelays })

function meeting(
  interpreters: Interpreter[],
  channels: Channel[],
  speaker = 'zh',
): Meeting {
  return { speaker, languages: LANGS, interpreters, channels }
}

describe('基本分配', () => {
  it('直译频道占用一个席位', () => {
    const m = meeting([interp('a', 'zh', 'en', 2)], [channel('c1', 'en', 1)])
    const r = allocate(m)
    expect(r.stats).toEqual({ total: 1, covered: 1, overloaded: 0, broken: 0 })
    expect(r.channels[0].route?.hops.map((h) => h.interpreterId)).toEqual(['a'])
    expect(r.usage.a.used).toBe(1)
    expect(r.usage.a.capacity).toBe(2)
    expect(r.usage.a.consumers).toEqual(['c1'])
  })

  it('两跳中继在两位译员身上各占一个席位', () => {
    const m = meeting(
      [interp('a', 'zh', 'en', 3), interp('b', 'en', 'fr', 2)],
      [channel('c-fr', 'fr', 1, ['en'])],
    )
    const r = allocate(m)
    expect(r.channels[0].status).toBe('COVERED')
    expect(r.usage.a.used).toBe(1)
    expect(r.usage.b.used).toBe(1)
    expect(r.usage.b.consumers).toEqual(['c-fr'])
  })

  it('源声频道零跳覆盖且不占席位', () => {
    const m = meeting([], [channel('floor', 'zh', 0)])
    const r = allocate(m)
    expect(r.channels[0].status).toBe('COVERED')
    expect(r.channels[0].route?.hopsCount).toBe(0)
  })
})

describe('容量竞争', () => {
  it('译员不能超出容量：第三家竞争频道超载，前两家正常', () => {
    // zh→en 只有一位容量 2 的译员；三个英语频道抢两席
    const m = meeting(
      [interp('a', 'zh', 'en', 2)],
      [channel('e1', 'en', 1), channel('e2', 'en', 2), channel('e3', 'en', 3)],
    )
    const r = allocate(m)
    expect(r.stats.covered).toBe(2)
    expect(r.stats.overloaded).toBe(1)
    expect(r.usage.a.used).toBe(2)
    expect(r.channels.map((c) => c.status)).toEqual([
      'COVERED',
      'COVERED',
      'OVERLOADED',
    ])
    expect(r.channels[2].failure?.code).toBe('DIRECT_FULL_RELAY_UNAVAILABLE')
  })

  it('任何路径都不超容量：同一译员被两个频道共用时席位精确累计', () => {
    // a: zh→en 容量 2；b: en→fr 容量 1
    // 英语频道占 a 一席；法语中继占 a+b 各一席 → a 恰好 2/2
    const m = meeting(
      [interp('a', 'zh', 'en', 2), interp('b', 'en', 'fr', 1)],
      [channel('c-en', 'en', 1), channel('c-fr', 'fr', 2, ['en'])],
    )
    const r = allocate(m)
    expect(r.stats.covered).toBe(2)
    expect(r.usage.a.used).toBe(2)
    expect(r.usage.b.used).toBe(1)
  })

  it('中继链第二跳容量不足时整条路径被拒绝，不留半条中继', () => {
    // a: zh→en 容量 9；b: en→fr 容量 1
    const m = meeting(
      [interp('a', 'zh', 'en', 9), interp('b', 'en', 'fr', 1)],
      [
        channel('f1', 'fr', 1, ['en']),
        channel('f2', 'fr', 2, ['en']),
      ],
    )
    const r = allocate(m)
    // f1 成功；f2 第二跳满 → 超载，且 a 上没有为 f2 留下任何占用
    expect(r.channels[1].status).toBe('OVERLOADED')
    expect(r.usage.a.used).toBe(1)
    expect(r.usage.b.used).toBe(1)
    expect(r.channels[1].failure?.langPair).toEqual(['en', 'fr'])
  })

  it('容量归零的译员等同无运力', () => {
    const m = meeting(
      [interp('a', 'zh', 'en', 1), interp('b', 'en', 'fr', 1)],
      [channel('c-fr', 'fr', 1, ['en'])],
    )
    const r = allocate(m)
    expect(r.channels[0].status).toBe('COVERED')
    // 再加一个同样依赖中继的频道，第二跳容量 1 → 第二个超载
    const m2 = meeting(
      [interp('a', 'zh', 'en', 1), interp('b', 'en', 'fr', 1)],
      [channel('f1', 'fr', 1, ['en']), channel('f2', 'fr', 2, ['en'])],
    )
    const r2 = allocate(m2)
    expect(r2.stats.overloaded).toBe(1)
  })
})

describe('优先级', () => {
  it('低优先级频道不得抢占高优先级频道已占席位', () => {
    // 唯一译员容量 1；低优先级先声明也没用 —— 处理顺序按 priority
    const m = meeting(
      [interp('a', 'zh', 'en', 1)],
      [channel('low', 'en', 5), channel('high', 'en', 1)],
    )
    const r = allocate(m)
    const byId = Object.fromEntries(r.channels.map((c) => [c.channelId, c]))
    expect(byId.high.status).toBe('COVERED')
    expect(byId.low.status).toBe('OVERLOADED')
    expect(r.usage.a.consumers).toEqual(['high'])
  })

  it('相同优先级按 id 确定序，重复运行结果一致', () => {
    const m = meeting(
      [interp('a', 'zh', 'en', 1)],
      [channel('zzz', 'en', 1), channel('aaa', 'en', 1)],
    )
    const run1 = allocate(m)
    const run2 = allocate(m)
    expect(run1.channels.map((c) => c.status)).toEqual(
      run2.channels.map((c) => c.status),
    )
    const aaa = run1.channels.find((c) => c.channelId === 'aaa')!
    expect(aaa.status).toBe('COVERED')
  })

  it('高优先级频道选直译，低优先级仍可利用同一位大舱译员的剩余席位做中继', () => {
    // a zh→en 容量 2；b en→fr 容量 2
    // en 频道（P1）占 a 一席；fr 频道（P2）经 en 中继再占 a 一席
    const m = meeting(
      [interp('a', 'zh', 'en', 2), interp('b', 'en', 'fr', 2)],
      [channel('c-en', 'en', 1), channel('c-fr', 'fr', 2, ['en'])],
    )
    const r = allocate(m)
    expect(r.stats.covered).toBe(2)
    expect(r.channels[1].route?.relay).toBe('en')
  })
})

describe('断路诊断', () => {
  it('拓扑上无链路 → BROKEN 而不是 OVERLOADED', () => {
    const m = meeting([interp('a', 'zh', 'de', 2)], [channel('c-en', 'en', 1)])
    const r = allocate(m)
    expect(r.channels[0].status).toBe('BROKEN')
    expect(r.channels[0].failure?.code).toBe('NO_CANDIDATE')
  })

  it('中继第一跳缺失时给出 NO_SPEAKER_RELAY', () => {
    const m = meeting(
      [interp('b', 'en', 'fr', 2)],
      [channel('c-fr', 'fr', 1, ['en'])],
    )
    const r = allocate(m)
    expect(r.channels[0].status).toBe('BROKEN')
    expect(r.channels[0].failure?.code).toBe('NO_SPEAKER_RELAY')
  })

  it('中继第二跳缺失时给出 RELAY_TO_TARGET_MISSING', () => {
    const m = meeting(
      [interp('a', 'zh', 'en', 2)],
      [channel('c-fr', 'fr', 1, ['en'])],
    )
    const r = allocate(m)
    expect(r.channels[0].status).toBe('BROKEN')
    expect(r.channels[0].failure?.code).toBe('RELAY_TO_TARGET_MISSING')
  })

  it('离线译员不计入拓扑：在线时覆盖，下线后断路', () => {
    const interpreters = [interp('a', 'zh', 'en', 1, true)]
    const m1 = meeting(interpreters, [channel('c-en', 'en', 1)])
    expect(allocate(m1).channels[0].status).toBe('COVERED')
    const m2 = meeting(
      [interp('a', 'zh', 'en', 1, false)],
      [channel('c-en', 'en', 1)],
    )
    const r2 = allocate(m2)
    expect(r2.channels[0].status).toBe('BROKEN')
    expect(r2.usage.a.used).toBe(0)
  })
})

describe('故障重路由', () => {
  it('直译译员下线后自动改走可用中继', () => {
    const interpreters = [
      interp('d', 'zh', 'fr', 1, false), // 直译，离线
      interp('a', 'zh', 'en', 2, true),
      interp('b', 'en', 'fr', 2, true),
    ]
    const m = meeting(interpreters, [channel('c-fr', 'fr', 1, ['en'])])
    let r = allocate(m)
    expect(r.channels[0].route?.relay).toBe('en')

    // 直译恢复在线后，下一次分配优先回到直译
    interpreters[0].online = true
    r = allocate(m)
    expect(r.channels[0].route?.hopsCount).toBe(1)
    expect(r.channels[0].route?.hops[0].interpreterId).toBe('d')
    // 中继译员变为空闲
    expect(r.idleInterpreters).toContain('b')
  })

  it('中继第一跳扩容后频道从中超载恢复为覆盖', () => {
    const interpreters = [
      interp('a', 'zh', 'en', 1, true),
      interp('b', 'en', 'fr', 9, true),
    ]
    const channels = [
      channel('c-en', 'en', 1),
      channel('c-fr', 'fr', 2, ['en']),
    ]
    const before = allocate(meeting(interpreters, channels))
    // a 只有 1 席，被英语占走，法语中继超载
    expect(before.channels[1].status).toBe('OVERLOADED')
    interpreters[0].capacity = 2
    const after = allocate(meeting(interpreters, channels))
    expect(after.stats.covered).toBe(2)
    expect(after.usage.a.used).toBe(2)
  })
})
