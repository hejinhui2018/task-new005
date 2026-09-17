import { useMemo } from 'react'
import type { AllocationResult, Meeting } from '../engine'
import { buildLayout } from './layout'

interface Props {
  meeting: Meeting
  result: AllocationResult
}

const LANG_W = 118
const LANG_H = 58
const INT_W = 128
const INT_H = 46

const STATUS_GLYPH: Record<string, string> = {
  COVERED: '✓',
  OVERLOADED: '⚠',
  BROKEN: '✕',
}
const STATUS_TEXT: Record<string, string> = {
  COVERED: '覆盖',
  OVERLOADED: '超载',
  BROKEN: '断路',
}

export function GraphView({ meeting, result }: Props) {
  const layout = useMemo(() => buildLayout(meeting), [meeting])

  const langById = useMemo(() => {
    const m = new Map<string, (typeof layout.languages)[number]>()
    for (const l of layout.languages) m.set(l.code, l)
    m.set(layout.speaker.code, layout.speaker)
    return m
  }, [layout])

  const langName = (code: string) =>
    meeting.languages.find((l) => l.code === code)?.name ?? code.toUpperCase()
  const langNative = (code: string) =>
    meeting.languages.find((l) => l.code === code)?.native ?? code.toUpperCase()

  // 目标语种 → 频道状态
  const targetStatus = useMemo(() => {
    const m = new Map<string, { status: string; channelId: string }>()
    for (const ch of meeting.channels) {
      const r = result.channels.find((c) => c.channelId === ch.id)
      if (r && (!m.has(ch.target) || r.status === 'BROKEN')) {
        m.set(ch.target, { status: r.status, channelId: ch.id })
      }
    }
    // 覆盖优先于故障展示（同一语种多频道时）
    for (const ch of meeting.channels) {
      const r = result.channels.find((c) => c.channelId === ch.id)
      if (r?.status === 'COVERED') m.set(ch.target, { status: 'COVERED', channelId: ch.id })
    }
    return m
  }, [meeting, result])

  const usage = result.usage
  const usedSet = new Set(
    Object.values(usage)
      .filter((u) => u.used > 0)
      .map((u) => u.interpreterId),
  )

  return (
    <div className="graph-wrap">
      <svg
        className="graph-svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="语种与译员路由节点图"
      >
        <defs>
          <marker id="arrowGray" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow" />
          </marker>
          <marker id="arrowGreen" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow active" />
          </marker>
          <marker id="arrowAmber" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow active-hot" />
          </marker>
        </defs>

        {/* —— 连线（先画，压在节点下）—— */}
        {layout.interpreters.map(({ interpreter, x, y }) => {
          const src = langById.get(interpreter.source)
          const dst = langById.get(interpreter.target)
          if (!src || !dst) return null
          const online = interpreter.online
          const used = usage[interpreter.id]?.used ?? 0
          const active = online && used > 0
          const atCapacity = active && used >= interpreter.capacity
          const cls = !online
            ? 'edge offline-edge'
            : atCapacity
              ? 'edge active-hot'
              : active
                ? 'edge active'
                : 'edge'
          const marker = !online
            ? 'url(#arrowGray)'
            : atCapacity
              ? 'url(#arrowAmber)'
              : active
                ? 'url(#arrowGreen)'
                : 'url(#arrowGray)'
          const mx = (src.x + x) / 2
          const my = (src.y + y) / 2
          return (
            <g key={`edge-${interpreter.id}`}>
              <line x1={src.x} y1={src.y} x2={x} y2={y} className={cls} />
              <line
                x1={x}
                y1={y}
                x2={dst.x}
                y2={dst.y}
                className={cls}
                markerEnd={marker}
              />
              {active && (
                <text x={mx + 6} y={my - 6} className={`edge-label ${atCapacity ? '' : 'active'}`}>
                  {used}席/{interpreter.capacity}
                </text>
              )}
            </g>
          )
        })}

        {/* —— 语种节点 —— */}
        {[layout.speaker, ...layout.languages].map((node) => {
          const isSpeaker = node.code === layout.speaker.code
          const st = targetStatus.get(node.code)
          return (
            <g
              key={`lang-${node.code}`}
              className={`lang-node ${isSpeaker ? 'speaker' : ''}`}
              transform={`translate(${node.x - LANG_W / 2}, ${node.y - LANG_H / 2})`}
            >
              <rect width={LANG_W} height={LANG_H} rx={10} />
              <text x={LANG_W / 2} y={22} textAnchor="middle" fontSize={15} fontWeight={700}>
                {langName(node.code)}
              </text>
              <text x={LANG_W / 2} y={38} textAnchor="middle" className="lang-native">
                {langNative(node.code)}
              </text>
              <text x={LANG_W / 2} y={52} textAnchor="middle" className="lang-badge">
                {isSpeaker ? '● 主讲声源' : node.code.toUpperCase()}
              </text>
              {st && (
                <g transform={`translate(${LANG_W - 8}, -10)`}>
                  <circle
                    r={13}
                    fill="#0d1117"
                    stroke={
                      st.status === 'COVERED'
                        ? 'var(--ok)'
                        : st.status === 'OVERLOADED'
                          ? 'var(--warn)'
                          : 'var(--danger)'
                    }
                    strokeWidth={2}
                  />
                  <text
                    textAnchor="middle"
                    y={4}
                    fontSize={12}
                    fontWeight={800}
                    fill={
                      st.status === 'COVERED'
                        ? 'var(--ok)'
                        : st.status === 'OVERLOADED'
                          ? 'var(--warn)'
                          : 'var(--danger)'
                    }
                  >
                    {STATUS_GLYPH[st.status]}
                  </text>
                  <text
                    textAnchor="middle"
                    y={LANG_H + 16}
                    x={-LANG_W / 2 + 8}
                    fontSize={10.5}
                    fontWeight={700}
                    fill={
                      st.status === 'COVERED'
                        ? 'var(--ok)'
                        : st.status === 'OVERLOADED'
                          ? 'var(--warn)'
                          : 'var(--danger)'
                    }
                  >
                    {STATUS_GLYPH[st.status]} {STATUS_TEXT[st.status]}
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* —— 译员节点 —— */}
        {layout.interpreters.map(({ interpreter, x, y }) => {
          const u = usage[interpreter.id]
          const used = u?.used ?? 0
          const carrying = usedSet.has(interpreter.id)
          return (
            <g
              key={`interp-${interpreter.id}`}
              className={`interp-node ${interpreter.online ? 'online' : 'offline'}`}
              transform={`translate(${x - INT_W / 2}, ${y - INT_H / 2})`}
            >
              <rect
                width={INT_W}
                height={INT_H}
                fill={carrying ? '#16271d' : undefined}
                stroke={
                  !interpreter.online
                    ? undefined
                    : used >= interpreter.capacity
                      ? 'var(--warn)'
                      : carrying
                        ? 'var(--ok)'
                        : undefined
                }
              />
              <text x={INT_W / 2} y={17} textAnchor="middle" className="interp-name">
                {interpreter.name}
                {!interpreter.online ? '（离席）' : ''}
              </text>
              <text x={INT_W / 2} y={31} textAnchor="middle" className="interp-meta">
                {interpreter.source.toUpperCase()}→{interpreter.target.toUpperCase()}
              </text>
              <text x={INT_W / 2} y={42} textAnchor="middle" className="interp-meta">
                {interpreter.online ? `席位 ${used}/${interpreter.capacity}` : 'OFFLINE'}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
