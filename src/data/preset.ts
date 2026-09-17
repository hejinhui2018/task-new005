/**
 * 内置演练场景：中文主讲国际会议
 *
 * 频道：
 *   P0 中文源声（零跳）
 *   P1 英语频道（直译）
 *   P2 法语频道（依赖英语中继）
 *   P3 日语频道（依赖英语中继）
 *
 * 译员：
 *   i1 张伟  zh→en 容量 3 —— 主力中英，正常状态下同时喂英语直听与法/日中继
 *   i2 李娜  en→fr 容量 2 —— 法语接力箱
 *   i3 佐藤  en→ja 容量 2 —— 日语接力箱
 *   i4 王强  zh→en 容量 2 —— 备援中英（容量有限，初始离线）
 *   i5 松下  zh→ja 容量 1 —— 日语直传备援（初始离线；启用后恢复全部覆盖）
 *
 * 演练脚本（README 同步说明）：
 *   1) 初始全员在线：3 条频道全部覆盖，i1 三席满载。
 *   2) 关闭 i1：英/法/日同时断路，诊断分别指出直译缺失与中继第一跳缺失。
 *   3) 启用 i4：按优先级确定保住英语（直译）与法语（中继），
 *      日语因 i4 两席用尽而超载（OVERLOADED）。
 *   4) 再启用 i5：日语改为直译，全部频道恢复覆盖。
 */
import type { Meeting } from '../engine'

export const PRESET_MEETING: Meeting = {
  speaker: 'zh',
  languages: [
    { code: 'zh', name: '中文', native: '中文' },
    { code: 'en', name: '英语', native: 'English' },
    { code: 'fr', name: '法语', native: 'Français' },
    { code: 'ja', name: '日语', native: '日本語' },
  ],
  interpreters: [
    { id: 'i1', name: '张伟', source: 'zh', target: 'en', capacity: 3, online: true },
    { id: 'i2', name: '李娜', source: 'en', target: 'fr', capacity: 2, online: true },
    { id: 'i3', name: '佐藤', source: 'en', target: 'ja', capacity: 2, online: true },
    { id: 'i4', name: '王强', source: 'zh', target: 'en', capacity: 2, online: false },
    { id: 'i5', name: '松下', source: 'zh', target: 'ja', capacity: 1, online: false },
  ],
  channels: [
    { id: 'ch-zh', target: 'zh', priority: 0, allowedRelays: [] },
    { id: 'ch-en', target: 'en', priority: 1, allowedRelays: [] },
    { id: 'ch-fr', target: 'fr', priority: 2, allowedRelays: ['en'] },
    { id: 'ch-ja', target: 'ja', priority: 3, allowedRelays: ['en'] },
  ],
}
