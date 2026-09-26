import { describe, expect, it } from 'vitest'

import { draftOf, pressPayload, sameDraft, type PressRecord } from './pressDraft'

const press: PressRecord = {
  name: 'PRS-107',
  hall: 'Hall 1',
  category: 'Transfer press',
  feedsCoil: false,
  frozenDays: 3,
}

describe('pres taslağı', () => {
  it('kaydı taslağa ve geri kayba uğramadan çevirir', () => {
    expect(pressPayload(press.name, draftOf(press))).toEqual(press)
  })

  it('holü değiştirmek diğer alanları silmez', () => {
    // Eski hata: her alan kendi onBlur'unda ayrı kaydediliyordu ve hol
    // kaydı kategoriyi, rulo beslemesini, dondurulmuş günü uçuruyordu.
    const edited = { ...draftOf(press), hall: 'Hall 2' }
    expect(pressPayload(press.name, edited)).toEqual({ ...press, hall: 'Hall 2' })
  })

  it('boş kutu tanımsız demektir, sıfır değil', () => {
    const cleared = { ...draftOf(press), frozenDays: '' }
    const payload = pressPayload(press.name, cleared)
    expect(payload.frozenDays).toBeUndefined()
    expect(pressPayload(press.name, { ...cleared, frozenDays: '0' }).frozenDays).toBe(0)
  })

  it('eksik alanlar varsayılana düşer', () => {
    const payload = pressPayload('PRS-1', draftOf({ name: 'PRS-1', hall: '' }))
    expect(payload.hall).toBe('Hall 1')
    // feedsCoil yazılmamışsa progresif hat kabul edilir.
    expect(payload.feedsCoil).toBe(true)
    expect(payload.category).toBeUndefined()
  })

  it('negatif dondurulmuş gün sıfıra çekilir', () => {
    const payload = pressPayload('PRS-1', { ...draftOf(press), frozenDays: '-5' })
    expect(payload.frozenDays).toBe(0)
  })

  it('değişiklik tespiti alan bazındadır', () => {
    const base = draftOf(press)
    expect(sameDraft(base, draftOf(press))).toBe(true)
    expect(sameDraft(base, { ...base, category: 'Progressive 800 t' })).toBe(false)
    expect(sameDraft(base, { ...base, feedsCoil: true })).toBe(false)
  })
})
