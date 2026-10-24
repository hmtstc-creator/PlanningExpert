// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WeekGantt, type WeekGanttJob } from './WeekGantt'

afterEach(cleanup)

const job: WeekGanttJob = {
  date: '2026-10-22',
  press: 'PRS104',
  material: 'A-100',
  quantity: 500,
  late: false,
  setupStartMinute: 60,
  endMinute: 300,
  segments: [
    { kind: 'setup', date: '2026-10-22', start: 60, end: 120 },
    { kind: 'run', date: '2026-10-22', start: 120, end: 300 },
  ],
}
const presses = ['PRS104', 'PRS105'].map((name) => ({
  name,
  hall: 'H1',
  days: [{ date: '2026-10-22', shifts: 3, capacityMinutes: 1440 }],
}))

const renderGantt = (onJobMove = vi.fn(), onJobClick = vi.fn()) => {
  const view = render(
    <WeekGantt
      dates={['2026-10-22']}
      presses={presses}
      jobs={[job]}
      stops={[]}
      shiftStartMinute={420}
      shiftMinutes={480}
      onJobMove={onJobMove}
      onJobClick={onJobClick}
    />,
  )
  const bar = view.container.querySelector<HTMLElement>('[title*="drag to move"]')!
  const target = view.container.querySelector<HTMLElement>('[data-gantt-row="PRS105"]')!
  // jsdom çizim yapmaz: bırakılan noktanın altındaki satır elle verilir.
  document.elementFromPoint = () => target
  return { bar, onJobMove, onJobClick }
}

describe('WeekGantt — drag and drop', () => {
  it('fareyle sürüklenen iş bırakılan satırın presine ve saatine taşınır', () => {
    const { bar, onJobMove, onJobClick } = renderGantt()
    fireEvent.pointerDown(bar, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 120, clientY: 40 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 148, clientY: 40 })
    // Varsayılan yakınlık 24 px/saat: 48 px = 120 dk → 07:00 + 2 saat = 09:00.
    expect(onJobMove).toHaveBeenCalledWith(expect.objectContaining({ material: 'A-100' }), {
      press: 'PRS105',
      date: '2026-10-22',
      clockMinute: 540,
    })
    fireEvent.click(bar)
    expect(onJobClick).not.toHaveBeenCalled()
  })

  it('küçük kıpırdama sürükleme sayılmaz', () => {
    const { bar, onJobMove } = renderGantt()
    fireEvent.pointerDown(bar, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 102, clientY: 10 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 102, clientY: 10 })
    expect(onJobMove).not.toHaveBeenCalled()
  })
})

describe('WeekGantt — gap click', () => {
  it('iki iş arasındaki boşluğa tıklanınca boşluğun başladığı pres, gün ve saat gelir', () => {
    const later: WeekGanttJob = {
      ...job,
      material: 'B-200',
      setupStartMinute: 400,
      endMinute: 500,
      segments: [{ kind: 'run', date: '2026-10-22', start: 400, end: 500 }],
    }
    const onGapClick = vi.fn()
    const view = render(
      <WeekGantt
        dates={['2026-10-22']}
        presses={presses}
        jobs={[job, later]}
        stops={[]}
        shiftStartMinute={420}
        shiftMinutes={480}
        onGapClick={onGapClick}
      />,
    )
    const gap = view.container.querySelector<HTMLElement>('[title*="click to add a job here"]')!
    expect(gap.title).toContain('Idle 100 min before B-200')
    fireEvent.click(gap)
    // Boşluk ilk işin bitişinde (07:00 + 300 dk = 12:00) başlar.
    expect(onGapClick).toHaveBeenCalledWith({ press: 'PRS104', date: '2026-10-22', clockMinute: 720 })
  })
})
