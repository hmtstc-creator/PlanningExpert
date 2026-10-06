import { describe, expect, it } from 'vitest'

import {
  effectiveShifts,
  normalizeShifts,
  oeeShiftCodes,
  shiftLabel,
  shiftMinutes,
  shiftOfCode,
  shiftProblems,
  type ShiftDef,
} from './shifts'

const std: ShiftDef[] = [
  { number: 2, name: 'Late', start: '14:00', end: '22:00', codes: ['ub62', ' UB65 '] },
  { number: 1, name: 'Early', start: '06:00', end: '14:00', codes: ['UB61', 'UB64'] },
  { number: 3, name: 'Night', start: '22:00', end: '06:00', codes: ['UB63', 'UB66', 'ub66'] },
]

describe('vardiya tanımı', () => {
  it('kodlar büyük harf, tekrarsız; numaraya göre sıralı', () => {
    const n = normalizeShifts(std)
    expect(n.map((s) => s.number)).toEqual([1, 2, 3])
    expect(n[1].codes).toEqual(['UB62', 'UB65'])
    expect(n[2].codes).toEqual(['UB63', 'UB66'])
  })

  it('denetim: tekrar eden numara, iki vardiyada aynı kod, saat biçimi, ad', () => {
    expect(shiftProblems(std)).toEqual([])
    expect(shiftProblems([...std, { number: 1, name: 'X', codes: [] }])).toContain('Shift 1 is listed twice')
    expect(
      shiftProblems([
        { number: 1, name: 'A', codes: ['UB61'] },
        { number: 2, name: 'B', codes: ['ub61'] },
      ]),
    ).toContain('Code UB61 is in shift 1 and shift 2')
    expect(shiftProblems([{ number: 1, name: 'A', start: '6:00', codes: [] }])[0]).toMatch(/HH:MM/)
    expect(shiftProblems([{ number: 1, name: ' ', codes: [] }])).toContain('Shift 1 needs a name')
    expect(shiftProblems([{ number: 0, name: 'A', codes: [] }])).toContain('A shift number is 1 to 9')
  })

  it('plant kendi tanımı yoksa şirket standardı', () => {
    expect(effectiveShifts(undefined, std).source).toBe('company')
    expect(effectiveShifts([{ number: 1, name: 'Day', codes: ['X1'] }], std)).toMatchObject({
      source: 'plant',
      shifts: [{ number: 1, codes: ['X1'] }],
    })
    expect(effectiveShifts([], null)).toEqual({ shifts: [], source: 'none' })
  })

  it('kodun vardiyası ve OEE biçimi', () => {
    const s = normalizeShifts(std)
    expect(shiftOfCode('ub64', s)).toBe(1)
    expect(shiftOfCode(' UB66', s)).toBe(3)
    expect(shiftOfCode('UB99', s)).toBeNull()
    expect(shiftOfCode('', s)).toBeNull()
    expect(oeeShiftCodes(s)).toContainEqual({ code: 'UB65', number: 2 })
  })

  it('süre: gece vardiyası gün aşar', () => {
    expect(shiftMinutes({ start: '06:00', end: '14:00' })).toBe(480)
    expect(shiftMinutes({ start: '22:00', end: '06:00' })).toBe(480)
    expect(shiftMinutes({ start: '06:00' })).toBeNull()
    expect(shiftLabel(normalizeShifts(std)[0])).toBe('1 · Early 06:00–14:00')
  })
})
