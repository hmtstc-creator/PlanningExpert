import { describe, expect, it } from 'vitest'

import { fittedSize, MAX_DIMENSION } from './imageResize'

describe('fotoğraf ölçüsü', () => {
  it('uzun kenarı sınıra çeker, oranı korur', () => {
    // 4000×3000 telefon fotoğrafı → 1600×1200.
    expect(fittedSize(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fittedSize(3000, 4000)).toEqual({ width: 1200, height: 1600 })
  })

  it('küçük resmi büyütmez', () => {
    // Büyütmek dosyayı şişirir, yeni ayrıntı katmaz.
    expect(fittedSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fittedSize(MAX_DIMENSION, 900)).toEqual({ width: MAX_DIMENSION, height: 900 })
  })

  it('kare ve çok ince resimlerde de çalışır', () => {
    expect(fittedSize(3200, 3200)).toEqual({ width: 1600, height: 1600 })
    // Panorama: kısa kenar 1 pikselin altına düşmemeli.
    expect(fittedSize(16000, 10)).toEqual({ width: 1600, height: 1 })
  })

  it('geçersiz ölçüde çökmez', () => {
    expect(fittedSize(0, 0)).toEqual({ width: 0, height: 0 })
    expect(fittedSize(-5, 100)).toEqual({ width: 0, height: 0 })
  })

  it('sınır özelleştirilebilir', () => {
    expect(fittedSize(4000, 2000, 800)).toEqual({ width: 800, height: 400 })
  })
})
