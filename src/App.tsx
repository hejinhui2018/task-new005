import { useMemo, useReducer } from 'react'
import { allocate } from './engine'
import { PRESET_MEETING } from './data/preset'
import { meetingReducer } from './state/meetingReducer'
import { GraphView } from './ui/GraphView'
import { ChannelPanel } from './ui/ChannelPanel'
import { InterpreterPanel } from './ui/InterpreterPanel'

export default function App() {
  const [meeting, dispatch] = useReducer(
    meetingReducer,
    PRESET_MEETING,
    (p) => JSON.parse(JSON.stringify(p)),
  )
  const result = useMemo(() => allocate(meeting), [meeting])

  const langName = (code: string) =>
    meeting.languages.find((l) => l.code === code)?.name ?? code.toUpperCase()

  // 演练快捷操作（幂等：只在状态不符时切换）
  const setOnline = (id: string, online: boolean) => {
    const it = meeting.interpreters.find((i) => i.id === id)
    if (it && it.online !== online) dispatch({ type: 'toggleOnline', id })
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>🎛 语言路由台 · Language Routing Console</h1>
          <div className="subtitle">
            主讲：{langName(meeting.speaker)}声源 · 本地纯浏览器计算，无后端
          </div>
        </div>

        <div className="stats" role="group" aria-label="频道覆盖统计">
          <span className="stat ok">
            <span aria-hidden>✓</span> 覆盖 <b>{result.stats.covered}</b>
          </span>
          <span className="stat warn">
            <span aria-hidden>⚠</span> 超载 <b>{result.stats.overloaded}</b>
          </span>
          <span className="stat danger">
            <span aria-hidden>✕</span> 断路 <b>{result.stats.broken}</b>
          </span>
          <span className="stat">
            频道 <b>{result.stats.total}</b>
          </span>
        </div>

        <span className="spacer" />

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn"
            title="演练阶段二：主力中英译员离席"
            onClick={() => setOnline('i1', false)}
          >
            ① 主力离席
          </button>
          <button
            type="button"
            className="btn"
            title="演练阶段三：召回容量 2 的备援王强"
            onClick={() => {
              setOnline('i1', false)
              setOnline('i4', true)
            }}
          >
            ② 启用备援(2席)
          </button>
          <button
            type="button"
            className="btn"
            title="演练阶段四：再增加日语直译，恢复全部覆盖"
            onClick={() => {
              setOnline('i1', false)
              setOnline('i4', true)
              setOnline('i5', true)
            }}
          >
            ③ 加直译恢复
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => dispatch({ type: 'resetPreset' })}
          >
            ↺ 重置场景
          </button>
        </div>
      </header>

      <main className="main">
        <section className="panel" aria-label="节点图">
          <div className="panel-head">🕸 语种 — 译员节点图</div>
          <GraphView meeting={meeting} result={result} />
          <div className="legend">
            <span className="legend-item">
              <span className="legend-line ok" /> 正在传声（线上标注已占席位数）
            </span>
            <span className="legend-item">
              <span className="legend-line idle" /> 在线空闲
            </span>
            <span className="legend-item">
              <span className="legend-line offline" /> 离席译员
            </span>
            <span className="legend-item">
              <span aria-hidden style={{ color: 'var(--warn)' }}>⚠</span> 琥珀色 =
              该译员已满载
            </span>
            <span className="legend-item">
              频道卡斜纹底 = 超载；红色横纹底 = 断路（纹理 + 图标 + 文字三重编码）
            </span>
          </div>
          <div className="scenario-hint">
            <b>调度规则：</b>按优先级 P 小者先分配；每个频道优先直译，其次经一种中继语言
            （最多两跳）；同一译员占满即拒绝再分配，循环路径（中继语等于主讲语或目标语）
            一律不采用。故障频道卡片给出具体原因码与卡点语种对。
          </div>
        </section>

        <ChannelPanel
          meeting={meeting}
          result={result}
          onPriorityChange={(channelId, priority) =>
            dispatch({ type: 'setPriority', channelId, priority })
          }
          onRelaysChange={(channelId, relays) =>
            dispatch({ type: 'setRelays', channelId, relays })
          }
        />

        <InterpreterPanel
          meeting={meeting}
          result={result}
          onToggle={(id) => dispatch({ type: 'toggleOnline', id })}
          onRemove={(id) => dispatch({ type: 'removeInterpreter', id })}
          onCapacity={(id, capacity) =>
            dispatch({ type: 'setCapacity', id, capacity })
          }
          onAdd={(interpreter) =>
            dispatch({ type: 'addInterpreter', interpreter })
          }
        />
      </main>
    </div>
  )
}
