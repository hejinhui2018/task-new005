import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import App from '../App'

/**
 * 端到端 UI 冒烟测试：演练按钮驱动预置场景的三个阶段，
 * 验证统计、状态徽标与故障原因都真实渲染（含无障碍文本，不只靠颜色）。
 */
const statsGroup = () => screen.getByRole('group', { name: '频道覆盖统计' })

describe('调度台交互', () => {
  it('初始四频道全覆盖', () => {
    render(<App />)
    expect(within(statsGroup()).getByText(/覆盖/).textContent).toMatch(/覆盖\s*4/)
    expect(
      screen
        .getAllByRole('status')
        .every((el) => el.textContent?.includes('正常覆盖')),
    ).toBe(true)
  })

  it('主力离席后三个外语频道断路且给出原因', () => {
    render(<App />)
    fireEvent.click(screen.getByTitle('演练阶段二：主力中英译员离席'))

    // 顶部统计：覆盖只剩中文源声 1，断路 3
    expect(within(statsGroup()).getByText(/断路/).textContent).toMatch(/断路\s*3/)
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(3)
    // 英语频道：无候选；法/日：中继第一跳缺失
    const alertText = alerts.map((a) => a.textContent).join('|')
    expect(alertText).toContain('NO_CANDIDATE')
    expect(alertText).toContain('NO_SPEAKER_RELAY')
  })

  it('启用 2 席备援后确定保住英语与法语，日语超载', () => {
    render(<App />)
    fireEvent.click(screen.getByTitle('演练阶段三：召回容量 2 的备援王强'))

    expect(within(statsGroup()).getByText(/超载/).textContent).toMatch(/超载\s*1/)
    // 日语频道卡片带状态类名与原因码
    const jaCard = screen.getByText('日语频道').closest('.channel-card')!
    expect(jaCard.className).toContain('OVERLOADED')
    expect(
      within(jaCard as HTMLElement).getByRole('alert').textContent,
    ).toContain('RELAY_BOTTLENECK')
  })

  it('增加日语直译后全部恢复覆盖', () => {
    render(<App />)
    fireEvent.click(screen.getByTitle('演练阶段四：再增加日语直译，恢复全部覆盖'))
    expect(within(statsGroup()).getByText(/超载/).textContent).toMatch(/超载\s*0/)
    expect(within(statsGroup()).getByText(/断路/).textContent).toMatch(/断路\s*0/)
    // 日语路由显示直译译员松下
    expect(screen.getByTestId('route-ch-ja').textContent).toContain('松下')
  })
})
