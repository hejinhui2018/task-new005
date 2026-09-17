import { describe, it, expect } from 'vitest'
import { allocate } from '../engine/allocate'
import { PRESET_MEETING } from '../data/preset'
import type { Meeting } from '../engine'

/** 深拷贝场景，便于在每个演练阶段独立改状态 */
function cloneMeeting(): Meeting {
  return JSON.parse(JSON.stringify(PRESET_MEETING)) as Meeting
}

const byId = (m: Meeting, id: string) =>
  m.interpreters.find((i) => i.id === id)!

const resultById = (m: Meeting) =>
  Object.fromEntries(allocate(m).channels.map((c) => [c.channelId, c]))

describe('内置场景：中文主讲，英/法/日频道', () => {
  it('初始状态：英语直译、法语与日语经英语中继，全部覆盖', () => {
    const r = allocate(cloneMeeting())
    expect(r.stats).toEqual({ total: 4, covered: 4, overloaded: 0, broken: 0 })

    const c = Object.fromEntries(r.channels.map((x) => [x.channelId, x]))
    expect(c['ch-en'].route?.hopsCount).toBe(1)
    expect(c['ch-fr'].route?.relay).toBe('en')
    expect(c['ch-ja'].route?.relay).toBe('en')

    // 主力 i1 同时承担英语直听 + 法/日两跳中继 = 3/3 满载
    expect(r.usage.i1.used).toBe(3)
    expect(r.usage.i1.capacity).toBe(3)
    expect(r.usage.i1.consumers.sort()).toEqual(['ch-en', 'ch-fr', 'ch-ja'])
    expect(r.usage.i2.used).toBe(1)
    expect(r.usage.i3.used).toBe(1)
  })

  it('阶段二：关闭主力中英译员 i1 → 三个外语音频全部断路，原因各不相同且可读', () => {
    const m = cloneMeeting()
    byId(m, 'i1').online = false
    const r = allocate(m)
    expect(r.stats.broken).toBe(3)

    const c = resultById(m)
    expect(c['ch-en'].status).toBe('BROKEN')
    expect(c['ch-en'].failure?.code).toBe('NO_CANDIDATE')
    expect(c['ch-fr'].status).toBe('BROKEN')
    expect(c['ch-fr'].failure?.code).toBe('NO_SPEAKER_RELAY')
    expect(c['ch-ja'].status).toBe('BROKEN')
    expect(c['ch-ja'].failure?.code).toBe('NO_SPEAKER_RELAY')
    // 诊断必须点名缺失的语种对
    expect(c['ch-fr'].failure?.langPair).toEqual(['zh', 'en'])
    // 任何译员都不产生占用
    expect(Object.values(r.usage).every((u) => u.used === 0)).toBe(true)
  })

  it('阶段三：启用容量有限的备援 i4（2 席）→ 确定性保住高优先级的英语与法语，日语超载', () => {
    const m = cloneMeeting()
    byId(m, 'i1').online = false
    byId(m, 'i4').online = true

    const r = allocate(m)
    const c = Object.fromEntries(r.channels.map((x) => [x.channelId, x]))

    expect(c['ch-en'].status).toBe('COVERED')
    expect(c['ch-en'].route?.hops[0].interpreterId).toBe('i4')
    expect(c['ch-fr'].status).toBe('COVERED')
    expect(c['ch-fr'].route?.hops.map((h) => h.interpreterId)).toEqual(['i4', 'i2'])
    expect(c['ch-ja'].status).toBe('OVERLOADED')
    // 超载原因：备援 zh→en 两席被英语与法语占满
    expect(c['ch-ja'].failure?.code).toBe('RELAY_BOTTLENECK')
    expect(c['ch-ja'].failure?.interpreterIds).toEqual(['i4'])
    expect(c['ch-ja'].failure?.langPair).toEqual(['zh', 'en'])

    // i4 恰好 2/2，没有任何译员超容量
    expect(r.usage.i4.used).toBe(2)
    expect(Object.values(r.usage).every((u) => u.used <= u.capacity)).toBe(true)
  })

  it('阶段三的优先级是确定的：把日语提到法语之前，保住的就是英语与日语', () => {
    const m = cloneMeeting()
    byId(m, 'i1').online = false
    byId(m, 'i4').online = true
    const fr = m.channels.find((c) => c.id === 'ch-fr')!
    const ja = m.channels.find((c) => c.id === 'ch-ja')!
    fr.priority = 3
    ja.priority = 2

    const c = resultById(m)
    expect(c['ch-en'].status).toBe('COVERED')
    expect(c['ch-ja'].status).toBe('COVERED')
    expect(c['ch-fr'].status).toBe('OVERLOADED')
    expect(c['ch-fr'].failure?.interpreterIds).toEqual(['i4'])
  })

  it('阶段四：增加日语直译能力 i5 → 全部频道恢复覆盖', () => {
    const m = cloneMeeting()
    byId(m, 'i1').online = false
    byId(m, 'i4').online = true
    byId(m, 'i5').online = true

    const r = allocate(m)
    expect(r.stats).toEqual({ total: 4, covered: 4, overloaded: 0, broken: 0 })

    const c = Object.fromEntries(r.channels.map((x) => [x.channelId, x]))
    // 日语改走直译，不再和法语争抢 i4
    expect(c['ch-ja'].route?.hopsCount).toBe(1)
    expect(c['ch-ja'].route?.hops[0].interpreterId).toBe('i5')
    expect(r.usage.i4.used).toBe(2)
    expect(r.usage.i5.used).toBe(1)
    // 原 en→ja 接力箱 i3 变得空闲
    expect(r.idleInterpreters).toContain('i3')
  })

  it('把 i1 重新开回主力状态：英/法回到 i1，日语因 i5 在线而保持直译', () => {
    const m = cloneMeeting()
    byId(m, 'i1').online = false
    byId(m, 'i4').online = true
    byId(m, 'i5').online = true
    byId(m, 'i1').online = true

    const r = allocate(m)
    const c = Object.fromEntries(r.channels.map((x) => [x.channelId, x]))
    // 大舱优先：英语直译、法语中继回到 i1
    expect(c['ch-en'].route?.hops[0].interpreterId).toBe('i1')
    expect(c['ch-fr'].route?.hops.map((h) => h.interpreterId)).toEqual(['i1', 'i2'])
    // 一跳优先于两跳：日语继续走 i5 直译，而非经 i1 中继
    expect(c['ch-ja'].route?.hopsCount).toBe(1)
    expect(c['ch-ja'].route?.hops[0].interpreterId).toBe('i5')
    expect(r.usage.i1.used).toBe(2)
    // i4 备援与 i3 接力箱在线但空闲
    expect(r.idleInterpreters.sort()).toEqual(['i3', 'i4'])
  })
})
