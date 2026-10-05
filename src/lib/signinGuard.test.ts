import { describe, expect, it } from 'vitest'

import { SIGNIN_BUCKET_MS, bucketStart, crossedStep, failuresSince, signinDelayMs, windowFailures, windowStart } from './signinGuard'

const T = Date.UTC(2026, 9, 5, 12, 34, 56)

describe('genel giriş freni', () => {
  it('10 dakikalık dilim ve 30 dakikalık pencere', () => {
    expect(bucketStart(T)).toBe(Date.UTC(2026, 9, 5, 12, 30))
    expect(windowStart(T)).toBe(Date.UTC(2026, 9, 5, 12, 10))
  })

  it('penceredeki hatalar: eski dilim sayılmaz', () => {
    const b = bucketStart(T)
    const buckets = [
      { bucket: b, failures: 4 },
      { bucket: b - SIGNIN_BUCKET_MS, failures: 5 },
      { bucket: b - 2 * SIGNIN_BUCKET_MS, failures: 6 },
      { bucket: b - 3 * SIGNIN_BUCKET_MS, failures: 100 },
    ]
    expect(windowFailures(buckets, T)).toBe(15)
  })

  it('eşiklere göre bekleme', () => {
    expect(signinDelayMs(0)).toBe(0)
    expect(signinDelayMs(29)).toBe(0)
    expect(signinDelayMs(30)).toBe(1000)
    expect(signinDelayMs(150)).toBe(3000)
    expect(signinDelayMs(5000)).toBe(5000)
  })

  it('eşik aşıldığı an bir kez bildirilir', () => {
    expect(crossedStep(29, 30)).toEqual({ failures: 30, delayMs: 1000 })
    expect(crossedStep(30, 31)).toBeNull()
    expect(crossedStep(99, 100)?.delayMs).toBe(3000)
  })

  it('belirli süredeki toplam ve bilinmeyen adlar', () => {
    const b = bucketStart(T)
    const r = failuresSince(
      [
        { bucket: b, failures: 3, unknownNames: 2 },
        { bucket: b - 24 * 60 * 60_000 - SIGNIN_BUCKET_MS, failures: 9, unknownNames: 9 },
      ],
      T - 24 * 60 * 60_000,
    )
    expect(r).toEqual({ failures: 3, unknownNames: 2 })
  })
})
