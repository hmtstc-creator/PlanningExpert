import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * Grafiğin iki sütunlu düzeni için kaynak düzeyinde koruma.
 *
 * Pres adları bir zamanlar grafikle AYNI yatay kaydırma kutusunun içinde
 * `sticky left-0` ile duruyordu. Kaydırınca ad kutusu çubukların üstüne
 * biniyor, altındaki işi ve ilk saat etiketini örtüyordu. Düzeltme adları
 * kaydırma alanının dışına, kendi sütununa taşımak oldu.
 *
 * Hiza iki sütunda da aynı yükseklik sabitlerinden geliyor; biri değişip
 * diğeri kalırsa satırlar birbirinden kayar ve ad yanlış presi gösterir —
 * bu sessiz ve tehlikeli bir hata olur.
 */
const SOURCE = readFileSync('src/components/WeekGantt.tsx', 'utf-8')

describe('WeekGantt düzeni', () => {
  it('pres adları kaydırılan alanın üstünde yüzmez', () => {
    // Yorumda geçmesi serbest; sınıf adı olarak geçmesi yasak.
    expect(SOURCE).not.toMatch(/className=[`"'][^`"']*\bsticky\b/)
  })

  it('satır yükseklikleri iki sütunda da aynı sabitten gelir', () => {
    for (const constant of ['ROW_HEIGHT', 'CATEGORY_HEIGHT', 'HEADER_HEIGHT']) {
      const uses = SOURCE.split(`height: ${constant}`).length - 1
      // Solda ad sütunu, sağda grafik: her yükseklik en az iki yerde.
      expect(uses, `${constant} iki sütunda da kullanılmalı`).toBeGreaterThanOrEqual(2)
    }
  })

  it('yalnızca grafik tarafı yatay kayar', () => {
    expect(SOURCE.split('overflow-x-auto').length - 1).toBe(1)
  })

  it('grafiğin genişliği ad sütununu içermez', () => {
    // Ad sütunu artık kaydırma alanının dışında; genişliğe eklenirse
    // sağda o kadar boşluk kalır.
    expect(SOURCE).not.toContain('LABEL_WIDTH + totalPx')
  })
})
