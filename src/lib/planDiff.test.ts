import { describe, expect, it } from 'vitest'

import { diffPlans, type PlanJobLike } from './planDiff'

const job = (material: string, press: string, date: string, quantity: number): PlanJobLike => ({
  material,
  press,
  date,
  quantity,
})

describe('diffPlans', () => {
  it('değişmeyen planı yalnızca sayar', () => {
    const plan = [job('A', 'PRS-1', '2026-09-14', 500)]
    const diff = diffPlans(plan, plan)
    expect(diff.changes).toHaveLength(0)
    expect(diff.sameCount).toBe(1)
  })

  it('yeni eklenen malzemeyi added olarak işaretler', () => {
    const diff = diffPlans([], [job('A', 'PRS-1', '2026-09-14', 500)])
    expect(diff.addedCount).toBe(1)
    expect(diff.changes[0]).toMatchObject({ material: 'A', kind: 'added', currentQty: 500 })
  })

  it('plandan düşen malzemeyi removed olarak işaretler', () => {
    const diff = diffPlans([job('A', 'PRS-1', '2026-09-14', 500)], [])
    expect(diff.removedCount).toBe(1)
    expect(diff.changes[0].kind).toBe('removed')
  })

  it('presi veya günü değişen malzemeyi moved olarak işaretler', () => {
    const diff = diffPlans(
      [job('A', 'PRS-1', '2026-09-14', 500)],
      [job('A', 'PRS-2', '2026-09-14', 500)],
    )
    expect(diff.movedCount).toBe(1)
    expect(diff.changes[0].approvedSlots).toEqual(['PRS-1 · 2026-09-14'])
    expect(diff.changes[0].currentSlots).toEqual(['PRS-2 · 2026-09-14'])
  })

  it('aynı yerde kalıp miktarı değişeni quantity olarak işaretler', () => {
    const diff = diffPlans(
      [job('A', 'PRS-1', '2026-09-14', 500)],
      [job('A', 'PRS-1', '2026-09-14', 800)],
    )
    expect(diff.quantityCount).toBe(1)
    expect(diff.changes[0]).toMatchObject({ approvedQty: 500, currentQty: 800 })
  })

  it('aynı malzemenin birden fazla partisini toplar', () => {
    const diff = diffPlans(
      [job('A', 'PRS-1', '2026-09-14', 300), job('A', 'PRS-1', '2026-09-15', 200)],
      [job('A', 'PRS-1', '2026-09-14', 300), job('A', 'PRS-1', '2026-09-15', 200)],
    )
    expect(diff.sameCount).toBe(1)
    expect(diff.changes).toHaveLength(0)
  })
})
