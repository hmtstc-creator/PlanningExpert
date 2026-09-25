// Rastgele ama tekrarlanabilir test fabrikası: senin tesisine benzer holler,
// esnek/tekil parçalar, bakiye, bakım ve hazır olmayan kalıp. Motor ve
// bağımsız doğrulama testleri aynı fabrikaları kullanır.

import type { PlanInputs } from './planPipeline'

export function rng(seed: number) {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 1_000_000) / 1_000_000
  }
}

export function randomPlant(seed: number): PlanInputs {
  const r = rng(seed)
  const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length)]
  // Senin tesisine benzer: progresif hol (104,105,108,110) + transfer (106,107).
  const progressive = ['104', '105', '108', '110']
  const transfer = ['106', '107']
  const presses = [
    ...progressive.map((name) => ({ name, hall: 'Progressive' })),
    ...transfer.map((name) => ({ name, hall: 'Transfer', feedsCoil: false })),
  ]
  const products = Array.from({ length: 25 }, (_, i) => {
    const group = r() < 0.6 ? progressive : transfer
    const main = pick(group)
    // Bazı parçalar tekil, bazılarının 1–3 alternatifi var.
    const alts = group.filter((p) => p !== main && r() < 0.5)
    return {
      code: `P${i}`,
      moldCavities: 1 + Math.floor(r() * 3),
      spm: 8 + Math.floor(r() * 30),
      setupMinutes: 20 + Math.floor(r() * 60),
      coilSetupMinutes: 10 + Math.floor(r() * 15),
      qualityApprovalMinutes: Math.floor(r() * 20),
      grossWeight: 0.5 + r() * 2,
      coilWeight: 2000 + Math.floor(r() * 6000),
      maxShots: r() < 0.3 ? 4000 : 50_000,
      mainMachine: main,
      altMachine1: alts[0],
      altMachine2: alts[1],
      altMachine3: alts[2],
      // Çoğu parça esnek, bazıları kalite gereği yalnız ana preste.
      flexiblePress: r() < 0.7,
    }
  })
  const weeklyDemand = products.map((p) => ({
    material: p.code,
    overdue: r() < 0.3 ? -Math.floor(r() * 3000) : 0,
    periods: [0, 1, 2, 3].map((w) => ({ label: `W${w}`, qty: -Math.floor(r() * 4000) })),
  }))
  return {
    products,
    weeklyDemand,
    stock: products.map((p) => ({ material: p.code, unrestricted: Math.floor(r() * 3000) })),
    locations: [],
    presses,
    templates: presses.map((p) => ({
      press: p.name,
      workingDays: 5,
      shiftsPerDay: 1 + Math.floor(r() * 3),
      overtimeShifts: 0,
    })),
    settings: {
      shiftMinutes: 480,
      shiftStartMinute: 420,
      planningHorizonWeeks: 3,
      setupGapMinutes: 60,
      coilSetupGapMinutes: 30,
      concurrentSetupsPerHall: 1,
    },
    workCalendar: null,
    officialHolidays: [],
    latestSnapshot: null,
    plannedStops: [
      { shiftIndex: 1, name: 'Tea', kind: 'break', startMinute: 120, durationMinutes: 15 },
      { shiftIndex: 1, name: 'Lunch', kind: 'meal', startMinute: 240, durationMinutes: 30 },
    ],
    overrides: [],
    moldMaintenance: [{ material: 'P3', date: '2026-09-17' }],
    readiness: [{ material: 'P5', ready: false, readyDate: '2026-09-22' }],
    pressMaintenance: [
      {
        press: '105',
        date: '2026-09-17',
        startMinute: 600,
        endMinute: 720,
        reason: 'service',
        status: 'planned',
      },
    ],
    alarms: [],
    truncatedInputs: [],
  }
}
