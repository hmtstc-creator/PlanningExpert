import { describe, expect, it } from 'vitest'

import { addPhoto, insertStep, mergeFrames, moveStep, moveStepTo, removeStep, setApproval, setPhotoStorage, setPpeImage, setSecond, sopTitle } from './sopDraft'
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

describe('sürükle-bırak ve onay', () => {
  const mk = (...texts: string[]) => ({ ...emptyDraft(), steps: texts.map((t) => ({ text: t, key: t + 'k', reason: t + 'r', photos: [{ second: 1 }] })) })

  it('adım içeriğiyle birlikte öne taşınır; numaralar konuma göre (1..n)', () => {
    const d = moveStepTo(mk('a', 'b', 'c', 'd'), 3, 0)
    expect(d.steps.map((s) => s.text)).toEqual(['d', 'a', 'b', 'c'])
    expect(d.steps[0]).toEqual({ text: 'd', key: 'dk', reason: 'dr', photos: [{ second: 1 }] })
  })

  it('geriye taşıma ve aynı yere bırakma', () => {
    expect(moveStepTo(mk('a', 'b', 'c'), 0, 2).steps.map((s) => s.text)).toEqual(['b', 'c', 'a'])
    expect(moveStepTo(mk('a', 'b'), 1, 1).steps.map((s) => s.text)).toEqual(['a', 'b'])
  })

  it('sınır dışı konum sona kırpılır; girdi değişmez', () => {
    const d = mk('a', 'b', 'c')
    expect(moveStepTo(d, 0, 99).steps.map((s) => s.text)).toEqual(['b', 'c', 'a'])
    expect(d.steps.map((s) => s.text)).toEqual(['a', 'b', 'c'])
  })

  it('onay: ad ve tarih ayrı ayrı yazılır', () => {
    const d = setApproval(setApproval(mk('a'), 'checked', { name: 'Ali' }), 'checked', { date: '2026-10-31' })
    expect(d.approvals?.checked).toEqual({ name: 'Ali', date: '2026-10-31' })
    expect(d.approvals?.prepared).toEqual({ name: '', date: '' })
  })
})

describe('kamera fotoğrafı', () => {
  it('kare yerine yeni dosya; saniye korunur, kırmızı işaret kalkar', () => {
    const d = setPhotoStorage(
      { ...emptyDraft(), steps: [{ text: 'a', key: '', reason: '', photos: [{ storageId: 'old', second: 5, mark: { x: 0, y: 0, w: 0.5, h: 0.5 } }] }] },
      0,
      0,
      'new',
    )
    expect(d.steps[0].photos[0]).toEqual({ storageId: 'new', second: 5 })
  })
})

describe('KKD görseli', () => {
  it('kullanıcı görseli kalemin depo kimliğini tutar; diğer kalemler değişmez', () => {
    const d = setPpeImage(emptyDraft(), 'welding_mask', 'img-1')
    expect(d.ppeImages).toEqual({ welding_mask: 'img-1' })
    expect(d.ppe.welding_mask).toBe(false)
  })
})
