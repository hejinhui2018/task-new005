import { describe, it, expect } from 'vitest'
import { buildCandidateRoutes } from '../engine/routes'
import type { Channel, Interpreter, Meeting } from '../engine'

const LANGS = [
  { code: 'zh', name: '中文', native: '中文' },
  { code: 'en', name: '英语', native: 'English' },
  { code: 'fr', name: '法语', native: 'Français' },
  { code: 'ja', name: '日语', native: '日本語' },
  { code: 'de', name: '德语', native: 'Deutsch' },
]

function makeMeeting(interpreters: Interpreter[], speaker = 'zh'): Meeting {
  return { speaker, languages: LANGS, interpreters, channels: [] }
}

const interp = (
  id: string,
  source: string,
  target: string,
  extra: Partial<Interpreter> = {},
): Interpreter => ({
  id,
  name: id,
  source,
  target,
  capacity: 1,
  online: true,
  ...extra,
})

const ch = (target: string, allowedRelays: string[] = []): Channel => ({
  id: `ch-${target}`,
  target,
  priority: 1,
  allowedRelays,
})

describe('路径枚举', () => {
  it('只生成直译路径', () => {
    const m = makeMeeting([interp('a', 'zh', 'en')])
    const routes = buildCandidateRoutes(m, ch('en'))
    expect(routes).toHaveLength(1)
    expect(routes[0].hopsCount).toBe(1)
    expect(routes[0].hops.map((h) => h.interpreterId)).toEqual(['a'])
    expect(routes[0].relay).toBeNull()
  })

  it('经一种中继语言生成两跳路径', () => {
    const m = makeMeeting([
      interp('a', 'zh', 'en'),
      interp('b', 'en', 'fr'),
    ])
    const routes = buildCandidateRoutes(m, ch('fr', ['en']))
    expect(routes).toHaveLength(1)
    expect(routes[0].hopsCount).toBe(2)
    expect(routes[0].relay).toBe('en')
    expect(routes[0].hops.map((h) => h.interpreterId)).toEqual(['a', 'b'])
  })

  it('最多两跳：存在三段链路时绝不生成三跳路径', () => {
    const m = makeMeeting([
      interp('a', 'zh', 'en'),
      interp('b', 'en', 'de'),
      interp('c', 'de', 'fr'),
      interp('d', 'en', 'fr'),
    ])
    const routes = buildCandidateRoutes(m, ch('fr', ['en', 'de']))
    expect(routes.every((r) => r.hopsCount <= 2)).toBe(true)
    // 只能走 zh→en→fr，zh→en→de→fr 被两跳上限拒绝
    expect(routes).toHaveLength(1)
    expect(routes[0].hops.map((h) => h.interpreterId)).toEqual(['a', 'd'])
  })

  it('拒绝离线译员', () => {
    const m = makeMeeting([
      interp('a', 'zh', 'en', { online: false }),
      interp('b', 'en', 'fr', { online: false }),
      interp('c', 'en', 'fr'),
    ])
    expect(buildCandidateRoutes(m, ch('en'))).toHaveLength(0)
    // 第一跳离线 → 整条中继不成立
    expect(buildCandidateRoutes(m, ch('fr', ['en']))).toHaveLength(0)
  })

  it('拒绝自环译员（源语种等于目标语种）', () => {
    const m = makeMeeting([interp('a', 'zh', 'zh')])
    expect(buildCandidateRoutes(m, ch('zh'))).toEqual([
      expect.objectContaining({ hopsCount: 0 }), // 源声零跳，而非走自环译员
    ])
  })
})

describe('循环拒绝', () => {
  it('中继语等于主讲语时拒绝', () => {
    const m = makeMeeting([
      interp('a', 'zh', 'en'),
      interp('b', 'en', 'zh'),
      interp('c', 'zh', 'fr'),
    ])
    // zh → zh(中继) → fr 是回环，必须拒绝；直译 zh→fr 仍正常
    const routes = buildCandidateRoutes(m, ch('fr', ['zh']))
    expect(routes).toHaveLength(1)
    expect(routes[0].hopsCount).toBe(1)
    expect(routes.some((r) => r.hopsCount === 2)).toBe(false)
  })

  it('中继语等于目标语时拒绝', () => {
    const m = makeMeeting([
      interp('a', 'zh', 'fr'),
      interp('b', 'fr', 'en'),
    ])
    // zh → fr(中继) → fr 等于原地打转；只剩直译
    const routes = buildCandidateRoutes(m, ch('fr', ['fr']))
    expect(routes).toHaveLength(1)
    expect(routes[0].hopsCount).toBe(1)
    expect(routes.some((r) => r.hopsCount === 2)).toBe(false)
  })

  it('已访问语种必须互不相同（zh→en→zh 形式的折返不产生两跳路径）', () => {
    const m = makeMeeting([
      interp('a', 'zh', 'en'),
      interp('b', 'en', 'zh'),
      interp('c', 'zh', 'ja'),
    ])
    // en 中继只能折返回 zh，没有 en→ja 第二跳 → 仅保留直译 zh→ja
    const routes = buildCandidateRoutes(m, ch('ja', ['en']))
    expect(routes).toHaveLength(1)
    expect(routes[0].hopsCount).toBe(1)
    expect(routes[0].hops[0].interpreterId).toBe('c')
  })
})

describe('确定性排序', () => {
  it('直译始终排在中继之前', () => {
    const m = makeMeeting([
      interp('a', 'zh', 'fr', { capacity: 1 }),
      interp('b', 'zh', 'en', { capacity: 9 }),
      interp('c', 'en', 'fr', { capacity: 9 }),
    ])
    const routes = buildCandidateRoutes(m, ch('fr', ['en']))
    expect(routes[0].hopsCount).toBe(1)
    expect(routes[0].hops[0].interpreterId).toBe('a')
    expect(routes[1].hopsCount).toBe(2)
  })

  it('同为直译时容量大的译员优先（小容量留作备援）', () => {
    const m = makeMeeting([
      interp('small', 'zh', 'en', { capacity: 1, name: 'A小舱' }),
      interp('big', 'zh', 'en', { capacity: 5, name: 'B大舱' }),
    ])
    const routes = buildCandidateRoutes(m, ch('en'))
    expect(routes.map((r) => r.hops[0].interpreterId)).toEqual(['big', 'small'])
  })

  it('同容量时按姓名、id 排序，结果稳定', () => {
    const m = makeMeeting([
      interp('x2', 'zh', 'en', { capacity: 2, name: '李娜' }),
      interp('x1', 'zh', 'en', { capacity: 2, name: '李娜' }),
    ])
    const first = buildCandidateRoutes(m, ch('en')).map((r) => r.key)
    const second = buildCandidateRoutes(m, ch('en')).map((r) => r.key)
    expect(first).toEqual(second)
    expect(first).toEqual(['x1', 'x2'])
  })

  it('中继按频道声明的偏好排序', () => {
    const m = makeMeeting([
      interp('a', 'zh', 'en'),
      interp('b', 'en', 'fr'),
      interp('c', 'zh', 'de'),
      interp('d', 'de', 'fr'),
    ])
    const preferEn = buildCandidateRoutes(m, ch('fr', ['en', 'de']))
    expect(preferEn[0].relay).toBe('en')
    const preferDe = buildCandidateRoutes(m, ch('fr', ['de', 'en']))
    expect(preferDe[0].relay).toBe('de')
  })
})
