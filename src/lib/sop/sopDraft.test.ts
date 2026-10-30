import { describe, expect, it } from 'vitest'

import { addPhoto, insertStep, mergeFrames, moveStep, removeStep, setSecond, sopTitle } from './sopDraft'
import { emptyDraft, type Draft } from './sopSchema'

const draft = (): Draft => ({
  ...emptyDraft({ operation: 'Sac yükleme' }),
  steps: [
    { text: 'A', key: '', reason: '', photos: [{ storageId: 's1', second: 5 }] },
    { text: 'B', key: '', reason: '', photos: [] },
  ],
})

describe('SOP taslağı', () => {
  it('adım taşınır, eklenir, silinir', () => {
    expect(moveStep(draft(), 0, 1).steps.map((s) => s.text)).toEqual(['B', 'A'])
    expect(moveStep(draft(), 0, -1).steps.map((s) => s.text)).toEqual(['A', 'B'])
    expect(insertStep(draft(), 0).steps.map((s) => s.text)).toEqual(['A', '', 'B'])
    expect(removeStep(draft(), 0).steps.map((s) => s.text)).toEqual(['B'])
  })

  it('adım başına en çok 2 fotoğraf', () => {
    let d = addPhoto(draft(), 0, 9)
    d = addPhoto(d, 0, 12)
    expect(d.steps[0].photos).toEqual([{ storageId: 's1', second: 5 }, { second: 9 }])
  })

  it('kaydedilmemiş yazı varken gelen kare yalnız aynı saniyedeki fotoğrafa girer', () => {
    const local = setSecond({ ...draft(), steps: draft().steps.map((s, i) => (i === 1 ? { ...s, text: 'yazılan' } : s)) }, 0, 0, 6)
    const server = setSecond(draft(), 0, 0, 6)
    server.steps[0].photos[0] = { storageId: 's2', second: 6 }
    const merged = mergeFrames(local, server)
    expect(merged.steps[0].photos[0].storageId).toBe('s2')
    expect(merged.steps[1].text).toBe('yazılan')
  })

  it('dosya adı SOP no, yoksa referans, yoksa operasyon', () => {
    expect(sopTitle(draft())).toBe('SOP Sac yükleme')
    expect(sopTitle({ ...draft(), header: { ...draft().header, sopNo: 'SOP-7' } })).toBe('SOP SOP-7')
  })
})
