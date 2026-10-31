import { describe, expect, it } from 'vitest'

import { CAMERA_CONSTRAINTS, captureGeometry } from './photoCapture'

describe('kamera çekimi geometrisi', () => {
  it('istek: 4:3, 1600 × 1200 ideal, arka kamera', () => {
    expect(CAMERA_CONSTRAINTS).toMatchObject({ aspectRatio: { ideal: 4 / 3 }, width: { ideal: 1600 }, height: { ideal: 1200 }, facingMode: { ideal: 'environment' } })
  })

  it('yatay 4:3 kare: döndürme yok, boyut aynı', () => {
    expect(captureGeometry(1600, 1200)).toEqual({ rotate: false, outW: 1600, outH: 1200, offX: 0, offY: 0 })
  })

  it('yatay 16:9 kare: 4:3\'e ortadan kırpılır (sol-sağ)', () => {
    const g = captureGeometry(1920, 1080)
    expect(g.rotate).toBe(false)
    expect(g.outH).toBe(1080)
    expect(g.outW).toBe(1440)
    expect(g.offX).toBe(240)
    expect(g.offY).toBe(0)
  })

  it('dik çekim (1200 × 1600): 90° döner, sonuç 4:3 yatay', () => {
    const g = captureGeometry(1200, 1600)
    expect(g.rotate).toBe(true)
    expect(g.outW / g.outH).toBeCloseTo(4 / 3, 2)
    expect(g.outW).toBe(1600)
    expect(g.outH).toBe(1200)
  })

  it('dik ve 16:9 dik kare: döner ve dik kenar kırpılır', () => {
    const g = captureGeometry(1080, 1920)
    expect(g.rotate).toBe(true)
    expect(g.outW / g.outH).toBeCloseTo(4 / 3, 2)
    expect(g.outH).toBe(1080)
    expect(g.outW).toBe(1440)
    expect(g.offX).toBe(240)
  })
})
