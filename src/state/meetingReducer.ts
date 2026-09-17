import type { Interpreter, LangCode, Meeting } from '../engine'
import { PRESET_MEETING } from '../data/preset'

export type MeetingAction =
  | { type: 'toggleOnline'; id: string }
  | { type: 'removeInterpreter'; id: string }
  | { type: 'setCapacity'; id: string; capacity: number }
  | {
      type: 'addInterpreter'
      interpreter: Omit<Interpreter, 'id'>
    }
  | { type: 'setPriority'; channelId: string; priority: number }
  | { type: 'setRelays'; channelId: string; relays: LangCode[] }
  | { type: 'resetPreset' }
  | { type: 'load'; meeting: Meeting }

let seq = 0
export function newId(prefix = 'u'): string {
  seq += 1
  return `${prefix}${Date.now().toString(36)}${seq}`
}

/** 确保语言表里存在某语种（用户新增冷门语对时自动登记） */
function ensureLanguage(meeting: Meeting, code: LangCode): Meeting {
  if (!code || meeting.languages.some((l) => l.code === code)) return meeting
  return {
    ...meeting,
    languages: [
      ...meeting.languages,
      { code, name: code.toUpperCase(), native: code.toUpperCase() },
    ],
  }
}

export function meetingReducer(state: Meeting, action: MeetingAction): Meeting {
  switch (action.type) {
    case 'toggleOnline':
      return {
        ...state,
        interpreters: state.interpreters.map((i) =>
          i.id === action.id ? { ...i, online: !i.online } : i,
        ),
      }
    case 'removeInterpreter':
      return {
        ...state,
        interpreters: state.interpreters.filter((i) => i.id !== action.id),
      }
    case 'setCapacity':
      return {
        ...state,
        interpreters: state.interpreters.map((i) =>
          i.id === action.id
            ? { ...i, capacity: Math.max(0, Math.round(action.capacity)) }
            : i,
        ),
      }
    case 'addInterpreter': {
      const id = newId('i')
      const withLangs = [action.interpreter.source, action.interpreter.target].reduce(
        (m, code) => ensureLanguage(m, code),
        state,
      )
      return {
        ...withLangs,
        interpreters: [
          ...withLangs.interpreters,
          { ...action.interpreter, id, online: true },
        ],
      }
    }
    case 'setPriority':
      return {
        ...state,
        channels: state.channels.map((c) =>
          c.id === action.channelId
            ? { ...c, priority: Math.max(0, Math.round(action.priority)) }
            : c,
        ),
      }
    case 'setRelays':
      return {
        ...state,
        channels: state.channels.map((c) =>
          c.id === action.channelId
            ? { ...c, allowedRelays: action.relays.filter((r) => r !== c.target) }
            : c,
        ),
      }
    case 'resetPreset':
      return JSON.parse(JSON.stringify(PRESET_MEETING))
    case 'load':
      return action.meeting
    default:
      return state
  }
}
