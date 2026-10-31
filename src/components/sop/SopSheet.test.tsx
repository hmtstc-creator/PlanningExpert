// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { emptyDraft, type Draft } from '../../lib/sop/sopSchema'
import { SopSheet } from './SopSheet'

const draft = (n: number): Draft => ({
  ...emptyDraft({ operation: 'Sac yükleme', reference: 'P-1' }),
  steps: Array.from({ length: n }, (_, i) => ({ text: `Adım ${i + 1}`, key: 'Dikkat', reason: 'Çünkü', photos: [{ storageId: `s${i}`, second: i, mark: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }] })),
  ppe: { ...emptyDraft().ppe, shoes: true, clothes: true },
})

afterEach(cleanup)

describe('SOP sayfası', () => {
  it('şablonun sabit yazıları ve başlık alanları yerinde', () => {
    const { getByText } = render(<SopSheet draft={draft(1)} page={0} pages={1} urls={{ s0: 'blob:x' }} />)
    for (const t of ['PROCEDURĂ STANDARD DE OPERARE (SOP)', 'NUME OPERAȚIE', 'Sac yükleme', 'P-1', 'TÜT', 'S1-P1F12/Rev.01', '1/1', 'S5-P2T3F1'])
      expect(getByText(t)).toBeTruthy()
  })

  it('2. sayfa: numara 7 ve 8, boş kutularda numara yok; PAG 2/2', () => {
    const { queryByText, getByText } = render(<SopSheet draft={draft(8)} page={1} pages={2} urls={{}} />)
    expect(getByText('7')).toBeTruthy()
    expect(getByText('8')).toBeTruthy()
    expect(queryByText('9')).toBeNull()
    expect(getByText('2/2')).toBeTruthy()
    expect(getByText('Adım 7')).toBeTruthy()
  })

  it('KKD satırı: yalnız işaretli kalemler, düzenleme düğmesi yok (seçim formun altındaki panelde)', () => {
    const { getByText, queryByText, container } = render(<SopSheet draft={draft(1)} page={0} pages={1} urls={{}} />)
    expect(getByText('FOLOSIȚI PANTOFI DE PROTECȚIE')).toBeTruthy()
    expect(getByText('FOLOSIȚI TRICOUL ȘI PANTALONII')).toBeTruthy()
    expect(queryByText('FOLOSIȚI MĂNUȘI')).toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelector('[contenteditable]')).toBeNull()
  })
})
