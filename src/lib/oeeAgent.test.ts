import { describe, expect, it } from 'vitest'

import fixture from './oee.fixture.json'
import { addDaysIso, daysFromShifts, lossDayOf, parseOeeWorkbook, type DayRow, type DowntimeDay, type DowntimeEvent, type OeeConfig, type OrderRow, type ShiftRow, type SheetRows } from './oee'
import { AGENT_DEFAULTS, agentReport, groupRole, type AgentInput, type AgentNote } from './oeeAgent'

const DAY = '2026-10-15'

const config: OeeConfig = {
  areas: [{ name: 'PRS', pick: 'costCenter' }],
  costCenters: [{ code: 'CC1', name: 'Press', area: 'PRS' }],
  shifts: [
    { code: 'UB64', number: 1 },
    { code: 'UB65', number: 2 },
    { code: 'UB66', number: 3 },
  ],
  lossReasonCodes: ['UNSCD_DOWN'],
  breakReasonCodes: ['SCHED_DOWN'],
  lossGroups: [
    { code: 'KLP', label: 'KLP', chart: 'Die', breakdown: true },
    { code: 'ARZ', label: 'ARZ', chart: 'Machine', breakdown: true },
    { code: 'STP', label: 'STP', chart: 'Setup', breakdown: false },
    { code: 'KSD', label: 'KSD', chart: 'Short', breakdown: false },
  ],
  setupTexts: [],
  startupRunMin: 15,
  trendWeeks: 10,
  topN: 5,
}

const SHIFT_CODE = { 1: 'UB64', 2: 'UB65', 3: 'UB66' } as const

function ev(p: Partial<DowntimeEvent> & { rc2: string; minutes: number }): DowntimeEvent {
  return {
    order: '1',
    material: 'M1',
    mold: '',
    shiftGroup: '',
    shiftDefinition: 'UB64',
    rc1: 'UNSCD_DOWN',
    rc3: '',
    rc4: '',
    rc5: '',
    textEn: p.rc2 === 'KLP' ? 'MOLD PART BREAKAGE' : p.rc2 === 'ARZ' ? 'HYDRAULIC LEAK' : 'OTHER',
    textTr: '',
    seconds: 0,
    startDate: '',
    startTime: '08:10:00',
    endDate: '',
    endTime: '',
    ...p,
  }
}

const downtime = (date: string, workCenter: string, events: DowntimeEvent[]): DowntimeDay => ({
  date,
  plant: 'P',
  plantKey: 'P',
  costCenter: 'CC1',
  workCenter,
  events,
})

/** Gün × iş yeri: OEE = production ÷ loading × operating ÷ production × good ÷ (good + bad). */
function dayRow(date: string, workCenter: string, oee: number, loadingMin = 1320): DayRow {
  return {
    date,
    plantKey: 'P',
    responsible: '',
    costCenter: 'CC1',
    workCenter,
    source: 'shiftly',
    good: 1000,
    scrap: 0,
    reject: 0,
    scheduledMin: 0,
    unscheduledMin: 0,
    loadingMin,
    productionMin: loadingMin * oee,
    operatingMin: loadingMin * oee,
  }
}

function shiftRow(date: string, workCenter: string, shift: 1 | 2 | 3, oee: number, loadingMin = 440): ShiftRow {
  return {
    ...dayRow(date, workCenter, oee, loadingMin),
    shiftGroup: SHIFT_CODE[shift],
    shiftDefinition: SHIFT_CODE[shift],
    availability: 0,
    quality: 0,
    performance: 0,
    oee: 0,
  } as ShiftRow
}

/** 4 hafta: her iş yeri her gün %70 OEE. */
function baseDays(wcs: string[], oee = 0.7): DayRow[] {
  const out: DayRow[] = []
  for (let i = 27; i >= 1; i--) for (const wc of wcs) out.push(dayRow(addDaysIso(DAY, -i), wc, oee))
  return out
}

function input(p: Partial<AgentInput>): AgentInput {
  return {
    day: DAY,
    config,
    days: [...baseDays(['PRS-104', 'PRS-106']), dayRow(DAY, 'PRS-104', 0.7), dayRow(DAY, 'PRS-106', 0.7)],
    lossDays: [],
    shifts: [],
    events: [],
    orders: [],
    dieTopics: [],
    machineTopics: [],
    moldAlarms: [],
    ...p,
  }
}

const byKey = (notes: AgentNote[], prefix: string) => notes.filter((n) => n.key.startsWith(prefix))

describe('Agent Report: kalıp', () => {
  it('açık konu varken kayıp sürüyor → kritik, aksiyon kanıtta', () => {
    const r = agentReport(
      input({
        events: [downtime(DAY, 'PRS-106', [ev({ rc2: 'KLP', minutes: 80, material: 'M315SP003' }), ev({ rc2: 'KLP', minutes: 52, material: 'M315SP003' })])],
        dieTopics: [{ id: 'd1', material: 'M315SP003', problemType: 'Punch broken', occurredAt: '2026-10-09', status: 'open', action: 'Change the punch' }],
      }),
    )
    const [n] = byKey(r.sections.dies, 'die-open|')
    expect(n.level).toBe('critical')
    // Açık konular bölümünde de: "bugün kaybettirdi, Dies'e bakın".
    expect(r.affectedTopics).toEqual(['Die · M315SP003 · Punch broken: 2.2 h (see Dies)'])
    expect(r.sections.topics).toHaveLength(0)
    expect(n.title).toContain('PRS-106 · M315SP003: KLP 2.2 h (2 stops), mainly MOLD PART BREAKAGE')
    expect(n.title).toContain('open for 6 days')
    expect(n.evidence).toContain('Change the punch')
    expect(r.summary[0].key).toBe(n.key)
  })

  it('konusu olmayan yeni kayıp → uyarı ve Die Follow-up taslağı', () => {
    const r = agentReport(input({ events: [downtime(DAY, 'PRS-104', [ev({ rc2: 'KLP', minutes: 35, material: 'M315SP403' })])] }))
    const [n] = byKey(r.sections.dies, 'die-new|')
    expect(n.level).toBe('warning')
    expect(n.followUp).toEqual({ material: 'M315SP403', press: 'PRS-104', loss: 'KLP', minutes: 35, days: [{ date: DAY, minutes: 35 }], detail: 'MOLD PART BREAKAGE' })
  })

  it('eşiğin altında not yok; duruş sayısı eşiği de yeter', () => {
    expect(agentReport(input({ events: [downtime(DAY, 'PRS-104', [ev({ rc2: 'KLP', minutes: 20 })])] })).sections.dies).toHaveLength(0)
    const three = [1, 2, 3].map(() => ev({ rc2: 'KLP', minutes: 4 }))
    expect(byKey(agentReport(input({ events: [downtime(DAY, 'PRS-104', three)] })).sections.dies, 'die-new|')).toHaveLength(1)
  })

  it('kalıp notu kullanılabilirlik analizidir: kısa duruşlar (< eşik) sayılmaz', () => {
    // 3 × 1,5 dk: duruş sayısı eşiğini (3) tutar ama hepsi < 2 dk → performans, kalıp notu yok.
    const short = [1, 2, 3].map(() => ev({ rc2: 'KLP', minutes: 1.5 }))
    expect(agentReport(input({ events: [downtime(DAY, 'PRS-104', short)] })).sections.dies).toHaveLength(0)
    // Eşik 1 dk olunca aynı duruşlar uzundur → not.
    const c1 = { ...config, shortStopMin: 1 }
    expect(byKey(agentReport(input({ events: [downtime(DAY, 'PRS-104', short)], config: c1 })).sections.dies, 'die-new|')).toHaveLength(1)
  })

  it('konusu yok ve 7 günün 3ünde tekrar → kritik', () => {
    const events = [0, 2, 4].map((i) => downtime(addDaysIso(DAY, -i), 'PRS-104', [ev({ rc2: 'KLP', minutes: 40 })]))
    const [n] = byKey(agentReport(input({ events })).sections.dies, 'die-new|')
    expect(n.level).toBe('critical')
    expect(n.evidence).toContain('3 of the last 7 days')
    expect(n.followUp!.days.map((d) => d.date)).toEqual([addDaysIso(DAY, -4), addDaysIso(DAY, -2), DAY])
  })

  it('ömür limitini aşmış kalıp o gün çalıştı → kritik', () => {
    const r = agentReport(
      input({
        events: [downtime(DAY, 'PRS-104', [ev({ rc2: 'STP', minutes: 5, material: 'M9' })])],
        moldAlarms: [{ material: 'M9', status: 'open', openedAt: 0, shotsAtAlarm: 120500, limitAtAlarm: 120000 }],
      }),
    )
    expect(byKey(r.sections.dies, 'alarm|')[0].level).toBe('critical')
  })

  it('hurda + red oranı 7 günün ortalamasının 2 katı → uyarı', () => {
    const order = (date: string, good: number, scrap: number) => ({ date, workCenter: 'PRS-104', material: 'M7', shift: 'UB64', good, scrap, reject: 0 }) as OrderRow
    const r = agentReport(input({ orders: [order(addDaysIso(DAY, -1), 990, 10), order(addDaysIso(DAY, -2), 990, 10), order(DAY, 960, 40)] }))
    const [n] = byKey(r.sections.dies, 'scrap|')
    expect(n.owner).toBe('Quality')
    expect(n.title).toContain('4.0×')
  })
})

describe('Agent Report: makine', () => {
  it('arıza kaydı yok → uyarı; açık arıza → kritik', () => {
    const events = [downtime(DAY, 'PRS-108', [ev({ rc2: 'ARZ', minutes: 45 })])]
    expect(byKey(agentReport(input({ events })).sections.machines, 'machine-new|')[0].level).toBe('warning')
    const r = agentReport(
      input({ events, machineTopics: [{ id: 'm1', press: 'PRS-108', problemType: 'Hydraulics', occurredAt: '2026-10-14', status: 'open', stopsPress: false }] }),
    )
    expect(byKey(r.sections.machines, 'machine-open|')[0].level).toBe('critical')
  })

  it("OEE 4 haftalık ortalamanın 10 puan altı → uyarı; üstü → iyi haber", () => {
    const r = agentReport(input({ days: [...baseDays(['PRS-104', 'PRS-106']), dayRow(DAY, 'PRS-104', 0.55), dayRow(DAY, 'PRS-106', 0.85)] }))
    expect(byKey(r.sections.machines, 'drop|')[0].title).toBe('PRS-104: OEE 55.0% — −15.0 pts below its 4-week average (70.0%).')
    expect(byKey(r.sections.good, 'rise|')[0].subject).toBe('wc|PRS-106')
    expect(r.headline.oee).toBeCloseTo(0.7, 5)
  })

  it('duruşlar uzadı (MTTR) → izle', () => {
    const before = [1, 2].map((i) => downtime(addDaysIso(DAY, -i), 'PRS-104', [1, 2].map(() => ev({ rc2: 'ARZ', minutes: 5 }))))
    const now = downtime(DAY, 'PRS-104', [1, 2, 3].map(() => ev({ rc2: 'ARZ', minutes: 12 })))
    const [n] = byKey(agentReport(input({ events: [...before, now] })).sections.machines, 'mttr|')
    expect(n.level).toBe('watch')
    expect(n.title).toContain('12.0 min per stop against 5.0 min')
  })
})

describe('Agent Report: vardiya', () => {
  const shifts = (worstByDay: (1 | 2 | 3)[]) =>
    worstByDay.flatMap((w, i) => {
      const date = addDaysIso(DAY, -(worstByDay.length - 1 - i))
      return ([1, 2, 3] as const).map((s) => shiftRow(date, 'PRS-104', s, s === w ? 0.5 : 0.75))
    })

  it('günün en kötü vardiyası: iş yeri, vardiya, ana kayıp ve parça', () => {
    const r = agentReport(
      input({
        shifts: shifts([1, 2, 3, 1, 3]),
        events: [downtime(DAY, 'PRS-104', [ev({ rc2: 'KLP', minutes: 25, material: 'M5', shiftDefinition: 'UB66' })])],
      }),
    )
    const [n] = byKey(r.sections.shifts, 'worst-shift|')
    expect(n.title).toContain('Weakest shift: PRS-104, shift 3 on 15.10 — OEE 50.0%')
    expect(n.evidence).toContain('MOLD PART BREAKAGE 25 min')
    expect(n.evidence).toContain('M5')
    expect(n.link).toEqual({ to: '/oee/report', label: 'Daily Report', search: { from: DAY, to: DAY, shift: 3 } })
  })

  it('aynı vardiya 5 günün 4ünde en kötü → örüntü uyarısı', () => {
    const r = agentReport(input({ shifts: shifts([3, 3, 1, 3, 3]) }))
    expect(byKey(r.sections.shifts, 'shift-pattern|')[0].title).toBe("Shift 3 was the plant's weakest shift on 4 of the last 5 days.")
    expect(byKey(agentReport(input({ shifts: shifts([3, 2, 1, 3, 3]) })).sections.shifts, 'shift-pattern|')).toHaveLength(0)
  })

  it('sebebi girilmemiş duruş payı', () => {
    const events = [downtime(DAY, 'PRS-104', [ev({ rc1: '#', rc2: '#', minutes: 40 }), ev({ rc2: 'STP', minutes: 60 })])]
    expect(byKey(agentReport(input({ events })).sections.shifts, 'undefined')[0].title).toBe('40% of the downtime on 15.10 has no reason (40 min).')
  })
})

describe('Agent Report: tekrar eden duruşlar', () => {
  it('aynı iş yeri + aynı neden 3 günde; her gün aynı saatte → süreç notu', () => {
    const events = [0, 1, 3].map((i) => downtime(addDaysIso(DAY, -i), 'PRS-105', [ev({ rc2: 'STP', minutes: 15, textEn: 'WAITING CRANE', startTime: '06:05:00' })]))
    const [n] = byKey(agentReport(input({ events })).sections.repeats, 'repeat|')
    expect(n.title).toBe('PRS-105: WAITING CRANE on 3 of the last 7 days — 45 min in 3 stops.')
    expect(n.evidence).toContain('around 06:00 on 3 of these days')
    expect(n.level).toBe('watch')
  })

  it('aynı parça + aynı neden iki preste → parçayı izliyor', () => {
    const events = [
      downtime(DAY, 'PRS-104', [ev({ rc2: 'KLP', minutes: 10, material: 'M2' })]),
      downtime(addDaysIso(DAY, -1), 'PRS-106', [ev({ rc2: 'KLP', minutes: 10, material: 'M2' })]),
      downtime(addDaysIso(DAY, -2), 'PRS-104', [ev({ rc2: 'KLP', minutes: 10, material: 'M2' })]),
    ]
    expect(byKey(agentReport(input({ events })).sections.repeats, 'follows-part|')[0].title).toBe(
      'M2: MOLD PART BREAKAGE on PRS-104, PRS-106 — the stop follows the part, not the press.',
    )
  })

  it('planlı setup tekrar sayılmaz', () => {
    const events = [0, 1, 3].map((i) => downtime(addDaysIso(DAY, -i), 'PRS-105', [ev({ rc2: 'STP', minutes: 40, textEn: 'DIE SETUP - PLANNED' })]))
    const c2 = { ...config, setupTexts: [{ text: 'DIE SETUP - PLANNED', kind: 'planned' as const }] }
    expect(agentReport(input({ events, config: c2 })).sections.repeats).toHaveLength(0)
    expect(agentReport(input({ events })).sections.repeats).toHaveLength(1)
  })

  it('önemsiz tekrar (haftada 30 dakikadan az) not olmaz', () => {
    const events = [0, 1, 3].map((i) => downtime(addDaysIso(DAY, -i), 'PRS-105', [ev({ rc2: 'STP', minutes: 3, textEn: 'WAITING CRANE' })]))
    expect(agentReport(input({ events })).sections.repeats).toHaveLength(0)
  })

  it('bölümde en çok 10 not; kalanı sayı olarak', () => {
    const wcs = Array.from({ length: 14 }, (_, i) => `PRS-${200 + i}`)
    // Her iş yerinde başka parça: "parçayı izleyen duruş" notu çıkmasın.
    const events = wcs.flatMap((wc, k) =>
      [0, 1, 2].map((i) => downtime(addDaysIso(DAY, -i), wc, [ev({ rc2: 'STP', minutes: 12, textEn: 'WAITING CRANE', material: `M${k}` })])),
    )
    const r = agentReport(input({ events }))
    expect(r.sections.repeats).toHaveLength(10)
    expect(r.hidden.repeats).toBe(4)
  })

  it('bu hafta tekrarlayan, bugün olmayan → iyi haber', () => {
    const events = [1, 2, 3].map((i) => downtime(addDaysIso(DAY, -i), 'PRS-104', [ev({ rc2: 'STP', minutes: 15, textEn: 'WAITING CRANE' })]))
    expect(byKey(agentReport(input({ events })).sections.good, 'gone|')).toHaveLength(1)
  })
})

describe('Agent Report: açık konular', () => {
  it('7 gündür kayıpsız ve parça çalıştı → "çözülmüş olabilir"; çalışmadıysa yalnızca listede', () => {
    const ran = [0, 1].map((i) => downtime(addDaysIso(DAY, -i), 'PRS-104', [ev({ rc2: 'STP', minutes: 5, material: 'M3' })]))
    const topics = [
      { id: 'a', material: 'M3', problemType: 'Burr', occurredAt: '2026-10-01', status: 'open' },
      { id: 'b', material: 'M4', problemType: 'Crack', occurredAt: '2026-10-01', status: 'open' },
    ]
    const r = agentReport(input({ events: ran, dieTopics: topics }))
    expect(byKey(r.sections.good, 'topic-quiet|')[0].title).toContain('M3 (Burr) may be solved')
    expect(r.quietTopics).toEqual(['Die · M4 · Crack (14 days open)'])
  })

  it('kayıp eşiğin altında ama açık konu etkiledi → açık konular bölümünde', () => {
    const r = agentReport(
      input({
        events: [downtime(DAY, 'PRS-104', [ev({ rc2: 'KLP', minutes: 12, material: 'M8' })])],
        dieTopics: [{ id: 'c', material: 'M8', problemType: 'Burr', occurredAt: '2026-10-13', status: 'open', action: 'Grind' }],
      }),
    )
    expect(r.sections.dies).toHaveLength(0)
    expect(byKey(r.sections.topics, 'topic-die|')[0].title).toBe('Open die topic M8 (Burr, 2 days open) cost 12 min on 15.10.')
  })
})

describe('Agent Report: özet, yetki, roller', () => {
  it('özet: en çok N not, önce kritik, aynı konu bir kez', () => {
    const events = [
      downtime(DAY, 'PRS-104', [ev({ rc2: 'KLP', minutes: 40, material: 'A' }), ev({ rc2: 'ARZ', minutes: 200 })]),
      downtime(DAY, 'PRS-106', [ev({ rc2: 'KLP', minutes: 90, material: 'B' }), ev({ rc2: 'ARZ', minutes: 31 })]),
    ]
    const r = agentReport(
      input({
        events,
        config: { ...config, agent: { summaryNotes: 3 } },
        dieTopics: [{ id: 'x', material: 'A', problemType: 'Burr', occurredAt: '2026-10-10', status: 'open' }],
      }),
    )
    expect(r.summary).toHaveLength(3)
    expect(r.summary[0].level).toBe('critical')
    expect(new Set(r.summary.map((n) => n.subject)).size).toBe(3)
    const rank = { critical: 0, warning: 1, watch: 2, good: 3 }
    const ranks = r.summary.map((n) => rank[n.level])
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(r.summary.every((n) => n.level === 'critical' || n.level === 'warning')).toBe(true)
  })

  it('izin yoksa not yerine bildirim', () => {
    const r = agentReport(input({ dieTopics: null, machineTopics: null, moldAlarms: null }))
    expect(r.notices).toContain('Die problems are not shown: no access to Die Follow-up.')
    expect(r.notices).toContain('Machine breakdowns are not shown: no access to Machine Follow-up.')
  })

  it('grup rolü: ayardaki, yoksa adından; "none" tahmini kapatır', () => {
    expect(groupRole('KLP', config)).toBe('die')
    expect(groupRole('ARZ', config)).toBe('machine')
    expect(groupRole('STP', config)).toBeNull()
    const c2 = { ...config, lossGroups: config.lossGroups.map((g) => (g.code === 'KLP' ? { ...g, agent: 'none' as const } : g.code === 'STP' ? { ...g, agent: 'machine' as const } : g)) }
    expect(groupRole('KLP', c2)).toBeNull()
    expect(groupRole('STP', c2)).toBe('machine')
  })

  it('varsayılan eşikler', () => {
    expect(AGENT_DEFAULTS.summaryNotes).toBe(5)
    expect(AGENT_DEFAULTS.repeatDays).toBe(3)
  })
})

describe('Agent Report: gerçek kesit (ASAKAI dosyası)', () => {
  it('çalışır, en kötü vardiyayı ve kalıp notlarını bulur', () => {
    const parsed = parseOeeWorkbook(fixture as unknown as Record<string, SheetRows>)
    const day = parsed.downtimes[0].date
    const plantConfig: OeeConfig = { ...config, shifts: [{ code: 'UB64', number: 1 }, { code: 'UB65', number: 2 }, { code: 'UB66', number: 3 }] }
    const r = agentReport({
      day,
      config: plantConfig,
      days: daysFromShifts(parsed.shifts),
      lossDays: parsed.downtimes.map(lossDayOf),
      shifts: parsed.shifts,
      events: parsed.downtimes,
      orders: parsed.orders,
      dieTopics: [],
      machineTopics: [],
      moldAlarms: [],
    })
    expect(r.headline.oee).not.toBeNull()
    expect(byKey(r.sections.shifts, 'worst-shift|')).toHaveLength(1)
    if (process.env.AGENT_DUMP) {
      const lines = [`OEE ${r.headline.oee} base ${r.headline.baseOee}`, ...r.notices.map((x) => `! ${x}`)]
      for (const n of Object.values(r.sections).flat()) lines.push(`[${n.level}] (${n.section}) ${n.title}\n      ${n.evidence}`)
      lines.push('SUMMARY: ' + r.summary.map((n) => n.key).join(', '), 'QUIET: ' + r.quietTopics.join('; '))
      process.stdout.write(lines.join('\n') + '\n')
    }
    for (const n of Object.values(r.sections).flat()) {
      expect(n.title.endsWith('.')).toBe(true)
      expect(n.title).not.toMatch(/undefined|NaN|null/)
      expect(n.evidence).not.toMatch(/undefined|NaN|null/)
    }
  })
})
