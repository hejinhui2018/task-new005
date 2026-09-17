import type { AllocationResult, Channel, Meeting } from '../engine'

interface Props {
  meeting: Meeting
  result: AllocationResult
  onPriorityChange: (channelId: string, priority: number) => void
  onRelaysChange: (channelId: string, relays: string[]) => void
}

const STATUS: Record<
  string,
  { glyph: string; text: string }
> = {
  COVERED: { glyph: '✓', text: '正常覆盖' },
  OVERLOADED: { glyph: '⚠', text: '超载竞争失败' },
  BROKEN: { glyph: '✕', text: '断路' },
}

export function ChannelPanel({
  meeting,
  result,
  onPriorityChange,
  onRelaysChange,
}: Props) {
  const byId = new Map(result.channels.map((r) => [r.channelId, r]))
  const ordered = [...meeting.channels].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  )
  const langName = (code: string) =>
    meeting.languages.find((l) => l.code === code)?.name ?? code.toUpperCase()
  const interpName = (id: string) =>
    meeting.interpreters.find((i) => i.id === id)?.name ?? id

  const otherLangs = (c: Channel) =>
    meeting.languages.filter((l) => l.code !== meeting.speaker && l.code !== c.target)

  const toggleRelay = (c: Channel, code: string) => {
    const has = c.allowedRelays.includes(code)
    onRelaysChange(
      c.id,
      has ? c.allowedRelays.filter((r) => r !== code) : [...c.allowedRelays, code],
    )
  }

  return (
    <div className="panel">
      <div className="panel-head">📻 听众频道与路由</div>
      <div className="panel-body">
        {ordered.map((channel) => {
          const r = byId.get(channel.id)!
          const st = STATUS[r.status]
          return (
            <div key={channel.id} className={`channel-card ${r.status}`}>
              <div className="channel-head">
                <span className="channel-title">
                  {langName(channel.target)}频道
                </span>
                <span className="channel-prio">P{channel.priority}</span>
                <span className="spacer" />
                <span className={`badge ${r.status}`} role="status">
                  <span className="glyph" aria-hidden>
                    {st.glyph}
                  </span>
                  {st.text}
                </span>
              </div>

              <div className="route-box">
                {r.route && r.route.hopsCount === 0 && (
                  <div className="route-chain">
                    <span className="relay-tag">源声直出 · 无需译员</span>
                  </div>
                )}
                {r.route && r.route.hopsCount >= 1 && (
                  <div className="route-chain" data-testid={`route-${channel.id}`}>
                    <span className="hop-chip">
                      {langName(meeting.speaker)}声源
                    </span>
                    {r.route.hops.map((hop, idx) => {
                      const u = result.usage[hop.interpreterId]
                      const full = u ? u.used >= u.capacity : false
                      return (
                        <span key={idx} style={{ display: 'contents' }}>
                          <span className="arrow-mark">──▶</span>
                          <span className={`hop-chip ${full ? 'full' : ''}`}>
                            {interpName(hop.interpreterId)}
                            <span className="seat">
                              [{u?.used ?? 0}/{u?.capacity ?? 0}席]
                            </span>
                          </span>
                        </span>
                      )
                    })}
                    <span className="arrow-mark">──▶</span>
                    <span className="hop-chip">
                      {langName(channel.target)}耳机
                    </span>
                    {r.route.relay && (
                      <span className="relay-tag">
                        中继：{langName(r.route.relay)}（两跳）
                      </span>
                    )}
                  </div>
                )}
              </div>

              {r.failure && (
                <div className={`failure-box ${r.status}`} role="alert">
                  <span className="reason-tag">{r.failure.code}</span>
                  <span>{r.failure.detail}</span>
                </div>
              )}

              {r.alternatives.length > 0 && (
                <div className="alt-list">
                  备选 {r.alternatives.length} 条：
                  {r.alternatives.slice(0, 3).map((alt) => (
                    <div key={alt.key}>
                      ·{' '}
                      {alt.hopsCount === 1
                        ? '直译'
                        : `经${alt.relay ? langName(alt.relay) : ''}中继`}{' '}
                      （{alt.hops.map((h) => interpName(h.interpreterId)).join(' → ')}
                      ）
                    </div>
                  ))}
                </div>
              )}

              <div className="channel-controls">
                <label>
                  优先级
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={channel.priority}
                    aria-label={`${langName(channel.target)}频道优先级`}
                    onChange={(e) =>
                      onPriorityChange(channel.id, Number(e.target.value))
                    }
                  />
                </label>
                {channel.target !== meeting.speaker && (
                  <label>
                    允许中继：
                    {otherLangs(channel).map((l) => (
                      <label key={l.code} style={{ marginLeft: 6 }}>
                        <input
                          type="checkbox"
                          checked={channel.allowedRelays.includes(l.code)}
                          onChange={() => toggleRelay(channel, l.code)}
                        />
                        {l.name}
                      </label>
                    ))}
                  </label>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
