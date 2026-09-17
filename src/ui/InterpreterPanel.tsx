import { useState } from 'react'
import type { AllocationResult, Interpreter, Meeting } from '../engine'

interface Props {
  meeting: Meeting
  result: AllocationResult
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onCapacity: (id: string, capacity: number) => void
  onAdd: (interpreter: Omit<Interpreter, 'id'>) => void
}

function SeatBar({ used, capacity }: { used: number; capacity: number }) {
  const total = Math.max(capacity, used, 1)
  return (
    <>
      <div className="seat-bar" aria-label={`已占用 ${used}，总容量 ${capacity}`}>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`seat-cell ${i < used ? 'used' : ''}`} />
        ))}
      </div>
      <div className="seat-meta">
        <span>
          {used}/{capacity} 席{used >= capacity && capacity > 0 ? ' · 已满舱' : ''}
        </span>
        <span>{capacity === 0 ? '零运力' : `空闲 ${capacity - used}`}</span>
      </div>
    </>
  )
}

export function InterpreterPanel({
  meeting,
  result,
  onToggle,
  onRemove,
  onCapacity,
  onAdd,
}: Props) {
  const [name, setName] = useState('')
  const [source, setSource] = useState(meeting.speaker)
  const [target, setTarget] = useState(
    meeting.languages.find((l) => l.code !== meeting.speaker)?.code ?? 'en',
  )
  const [capacity, setCap] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const langName = (code: string) =>
    meeting.languages.find((l) => l.code === code)?.name ?? code.toUpperCase()
  const channelName = (id: string) => {
    const ch = meeting.channels.find((c) => c.id === id)
    return ch ? `${langName(ch.target)}频道` : id
  }

  const submit = () => {
    if (!name.trim()) {
      setError('请填写译员姓名')
      return
    }
    if (source === target) {
      setError('源语种与目标语种不能相同（自环无效）')
      return
    }
    if (capacity < 1) {
      setError('容量至少为 1')
      return
    }
    onAdd({ name: name.trim(), source, target, capacity, online: true })
    setName('')
    setError(null)
  }

  // 在线译员排在前，同状态按语种对
  const ordered = [...meeting.interpreters].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    return (
      `${a.source}${a.target}`.localeCompare(`${b.source}${b.target}`) ||
      a.id.localeCompare(b.id)
    )
  })

  return (
    <div className="panel">
      <div className="panel-head">🎧 译员席位</div>
      <div className="panel-body">
        <div className="add-form">
          <label className="full">
            姓名
            <input
              type="text"
              value={name}
              placeholder="如：陈晨"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            源语种
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {meeting.languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标语种
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {meeting.languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="full">
            席位数
            <input
              type="number"
              min={1}
              max={99}
              value={capacity}
              onChange={(e) => setCap(Number(e.target.value))}
            />
          </label>
          {error && <div className="form-error">⚠ {error}</div>}
          <button type="button" className="btn primary full" onClick={submit}>
            ＋ 派遣译员
          </button>
        </div>

        {ordered.map((interp) => {
          const u = result.usage[interp.id]
          const used = u?.used ?? 0
          return (
            <div
              key={interp.id}
              className={`interp-card ${interp.online ? '' : 'offline'}`}
            >
              <div className="interp-card-row1">
                <span className="name">{interp.name}</span>
                <span className="pair">
                  {interp.source.toUpperCase()}→{interp.target.toUpperCase()}
                </span>
                <span className="spacer" />
                <span className={`status-dot ${interp.online ? 'online' : 'offline'}`}>
                  {interp.online ? '● 在岗' : '○ 离席'}
                </span>
              </div>
              {interp.online && <SeatBar used={used} capacity={interp.capacity} />}
              {interp.online && u && u.consumers.length > 0 && (
                <div className="consumers">
                  服务：{u.consumers.map(channelName).join('、')}
                </div>
              )}
              <div className="interp-controls">
                <button
                  type="button"
                  className={`btn toggle ${interp.online ? 'on' : 'off'}`}
                  onClick={() => onToggle(interp.id)}
                >
                  {interp.online ? '⏻ 令其离席' : '⏻ 召回在岗'}
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  容量
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={interp.capacity}
                    disabled={!interp.online}
                    aria-label={`${interp.name}容量`}
                    onChange={(e) => onCapacity(interp.id, Number(e.target.value))}
                  />
                </label>
                <span className="spacer" style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn danger-text"
                  onClick={() => onRemove(interp.id)}
                >
                  删除
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
