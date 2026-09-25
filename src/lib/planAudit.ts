// Planın kurallara uyup uymadığının bağımsız denetimi.
//
// Motor kuralları iş yerleştirirken uygular; bu dosya ise bitmiş plana
// DIŞARIDAN bakar ve her işi her kurala karşı yeniden sayar. İkisi ayrı kod
// olduğu için motordaki bir hata burada yakalanır. Planlamacının yüzlerce
// işi elle saymasına gerek kalmaz: her hesaplamadan sonra bu kontrol
// çalışır ve sonucu Plan sayfasında görünür.

interface AuditSegment {
  kind: string
  date: string
  start: number
  end: number
}

export interface AuditJob {
  material: string
  press: string
  hall: string
  date: string
  phase: string
  dueDate: string
  earliestDate?: string
  frozen?: boolean
  segments: AuditSegment[]
  endDate?: string
  endMinute?: number
  /** Setup bakiye/geç iş kuralıyla başka bir setup'la çakışabildi. */
  urgentSetup?: boolean
  /** Aynı kalıbın devamı olarak (setup'sız) yerleşti — en erken bitiş kuralı aranmaz. */
  continued?: boolean
  quantity?: number
  decision?: {
    step: number
    candidates: { press: string; endDate?: string; endMinute?: number; note?: string; late?: boolean }[]
  }
}

export interface AuditInputs {
  jobs: AuditJob[]
  maintenance: { press: string; date: string; start: number; end: number }[]
  moldBlackouts: { material: string; date: string; untilNet?: number }[]
  todayIso: string
  setupGapMinutes: number
  coilSetupGapMinutes: number
  concurrentSetupsPerHall: number
  /** Fabrika genelinde aynı anda en fazla bu kadar kalıp setup'ı (bakiye/geç iş). */
  maxSetupsPlantWide?: number
  /** Normal işlerde fabrika genelinde aynı anda en fazla kalıp setup'ı. */
  maxSetupsPlantWideNormal?: number
  /**
   * Parça → bir rulonun verdiği adet (vuruş × göz). Rulolu her lot bunun tam
   * katı olmalı: bağlanan rulo yarıda bırakılmaz.
   */
  coilUnits?: Map<string, number>
  /**
   * Seçilen senaryonun pres kuralı. "En erken biten pres" denetimi yalnızca
   * bu kural (varsayılan) seçildiyse yapılır.
   */
  pressRule?: string
  /**
   * Parça → ana pres ve esneklik. Esnek olmayan parça yalnız ana preste
   * (ya da kullanıcının sabitlediği preste) çalışabilir.
   */
  pressRules?: Map<string, { main: string; flexible: boolean; pinned?: string }>
}

export interface AuditRule {
  id: string
  label: string
  /** Kaç şey denetlendi (iş, setup, parça…). */
  checked: number
  /** İhlaller — ilk birkaçı, okunur metin olarak. */
  violations: string[]
  violationCount: number
}

export interface PlanAudit {
  rules: AuditRule[]
  ok: boolean
}

const MAX_LISTED = 5
/**
 * Dakikalar kesirli hesaplanır (vuruş ÷ SPM); tam 60 dakika sonra konan bir
 * setup kayan nokta yüzünden 59,99999999 görünebilir. Binde bir dakikanın
 * altındaki fark ihlal sayılmaz.
 */
const EPS = 0.001

function rule(id: string, label: string) {
  const r: AuditRule = { id, label, checked: 0, violations: [], violationCount: 0 }
  return {
    r,
    check() {
      r.checked += 1
    },
    fail(text: string) {
      r.violationCount += 1
      if (r.violations.length < MAX_LISTED) r.violations.push(text)
    },
  }
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end - EPS && b.start < a.end - EPS
}

function clock(date: string, minute: number) {
  return `${date} +${Math.round(minute)} min`
}

export function auditPlan(input: AuditInputs): PlanAudit {
  const pressOverlap = rule('press-overlap', 'A press runs one job at a time')
  const maintenance = rule('press-maintenance', 'Nothing runs during press maintenance')
  const mouldTwice = rule('mould-twice', 'A mould is never on two presses at the same time')
  const mouldBlackout = rule('mould-blackout', 'Nothing runs on a mould maintenance or not-ready day')
  const crane = rule('crane', 'Crane: setup gaps and simultaneous setups per hall')
  const fillEarly = rule(
    'fill-early',
    'No lot starts before its pull-forward window (stock reaching the safety level minus the pull-forward days)',
  )
  const plantSetups = rule('plant-setups', 'Plant-wide: never more mould setups at once than allowed')
  const wholeCoils = rule('whole-coils', 'Every coil-fed lot is whole coils — a mounted coil is run out')
  const past = rule('past', 'Nothing is planned in the past')
  const mainPress = rule(
    'main-press',
    'Parts not marked "Flexible press" run only on their main press',
  )
  const earliest = rule(
    'earliest-press',
    'Each job went to the eligible press that finished it earliest at that moment',
  )

  // pres|tarih → dolu aralıklar (işler + bakım)
  const byPressDate = new Map<string, { label: string; start: number; end: number }[]>()
  // malzeme|tarih → [pres, aralık]
  const byMouldDate = new Map<string, { press: string; start: number; end: number }[]>()
  // hol|tarih → setup / rulo değişimi
  const byHallDate = new Map<
    string,
    { kind: 'setup' | 'coil'; label: string; start: number; end: number; urgent?: boolean }[]
  >()
  // tarih → bütün hollerdeki kalıp setupları (fabrika geneli sınır)
  const setupsByDate = new Map<string, { label: string; start: number; end: number; urgent: boolean }[]>()
  // malzeme|gün → o gün hangi net dakikaya kadar kapalı (yoksa bütün gün)
  const blackout = new Map<string, number>()
  for (const b of input.moldBlackouts) {
    const key = `${b.material}|${b.date}`
    blackout.set(key, Math.max(blackout.get(key) ?? 0, b.untilNet ?? Number.POSITIVE_INFINITY))
  }

  for (const job of input.jobs) {
    const pressRule = input.pressRules?.get(job.material)
    if (pressRule && !job.frozen) {
      mainPress.check()
      const allowed = pressRule.flexible || job.press === pressRule.main || job.press === pressRule.pinned
      if (!allowed) {
        mainPress.fail(`${job.material} is on ${job.press}, but its main press is ${pressRule.main} and it is not flexible`)
      }
    }
    const earliestRule = (input.pressRule ?? 'earliestFinish') === 'earliestFinish'
    if (earliestRule && !job.continued && job.decision && job.endDate !== undefined && job.endMinute !== undefined) {
      earliest.check()
      const chosen = { date: job.endDate, minute: job.endMinute }
      const chosenLate = job.decision.candidates.find((c) => c.press === job.press)?.late
      for (const c of job.decision.candidates) {
        if (c.endDate === undefined || c.endMinute === undefined || c.press === job.press) continue
        // Geç kalmayan aday, geç kalacak (ama erken biten) adaya tercih edilir.
        if (c.late && !chosenLate) continue
        const better =
          c.endDate < chosen.date || (c.endDate === chosen.date && c.endMinute < chosen.minute - EPS)
        if (better) {
          earliest.fail(
            `${job.material} went to ${job.press} (done ${chosen.date} +${Math.round(chosen.minute)} min) ` +
              `but ${c.press} would have finished it ${c.endDate} +${Math.round(c.endMinute)} min`,
          )
        }
      }
    }
    const unit = input.coilUnits?.get(job.material)
    if (unit && unit > 0 && !job.frozen && job.quantity !== undefined) {
      wholeCoils.check()
      if (Math.round(job.quantity) % unit !== 0) {
        wholeCoils.fail(
          `${job.material} on ${job.press} ${job.date}: ${Math.round(job.quantity)} pcs is not a whole number of coils (${unit} pcs per coil)`,
        )
      }
    }
    fillEarly.check()
    // Dolgu işi, stoğun emniyet seviyesine indiği günden önce başlamaz.
    const allowedFrom = job.earliestDate ?? job.dueDate
    if (!job.frozen && job.phase === 'fill' && job.date < allowedFrom) {
      fillEarly.fail(`${job.material} starts ${job.date}, stock allows it from ${allowedFrom}`)
    }

    // Bir işin gün başına tek aralığı: pres ve kalıp meşguliyeti için.
    const span = new Map<string, { start: number; end: number }>()
    for (const seg of job.segments) {
      const cur = span.get(seg.date)
      span.set(seg.date, {
        start: cur ? Math.min(cur.start, seg.start) : seg.start,
        end: cur ? Math.max(cur.end, seg.end) : seg.end,
      })
      if (seg.kind === 'setup' || seg.kind === 'coil') {
        const key = `${job.hall}|${seg.date}`
        const list = byHallDate.get(key) ?? []
        list.push({
          kind: seg.kind,
          label: `${job.material} on ${job.press}`,
          start: seg.start,
          end: seg.end,
          urgent: seg.kind === 'setup' && !!job.urgentSetup,
        })
        byHallDate.set(key, list)
        if (seg.kind === 'setup') {
          const all = setupsByDate.get(seg.date) ?? []
          all.push({ label: `${job.material} on ${job.press}`, start: seg.start, end: seg.end, urgent: !!job.urgentSetup })
          setupsByDate.set(seg.date, all)
        }
      }
    }

    for (const [date, s] of span) {
      past.check()
      if (!job.frozen && date < input.todayIso) {
        past.fail(`${job.material} on ${job.press} runs on ${date}`)
      }
      mouldBlackout.check()
      const closedUntil = blackout.get(`${job.material}|${date}`)
      if (closedUntil !== undefined && s.start < closedUntil - EPS) {
        mouldBlackout.fail(`${job.material} runs on ${date} while its mould is blocked`)
      }
      const pk = `${job.press}|${date}`
      const plist = byPressDate.get(pk) ?? []
      plist.push({ label: job.material, ...s })
      byPressDate.set(pk, plist)
      const mk = `${job.material}|${date}`
      const mlist = byMouldDate.get(mk) ?? []
      mlist.push({ press: job.press, ...s })
      byMouldDate.set(mk, mlist)
    }
  }

  for (const [key, list] of byPressDate) {
    const [press, date] = key.split('|')
    const sorted = [...list].sort((a, b) => a.start - b.start)
    // O ana kadar en geç biten iş: içe geçmiş aralıklar da yakalanır.
    let last: { label: string; end: number } | null = null
    for (const item of sorted) {
      pressOverlap.check()
      if (last && item.start < last.end - EPS) {
        pressOverlap.fail(
          `${press} ${date}: ${last.label} and ${item.label} overlap at ${clock(date, item.start)}`,
        )
      }
      if (!last || item.end > last.end) last = item
    }
    for (const m of input.maintenance.filter((b) => b.press === press && b.date === date)) {
      for (const job of list) {
        maintenance.check()
        if (overlaps(job, m)) maintenance.fail(`${job.label} runs during maintenance on ${press} ${date}`)
      }
    }
  }

  for (const [key, list] of byMouldDate) {
    const [material, date] = key.split('|')
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        mouldTwice.check()
        if (list[i].press !== list[j].press && overlaps(list[i], list[j])) {
          mouldTwice.fail(`${material} is on ${list[i].press} and ${list[j].press} at the same time on ${date}`)
        }
      }
    }
  }

  const concurrent = Math.max(1, input.concurrentSetupsPerHall)
  for (const [key, list] of byHallDate) {
    const [hall, date] = key.split('|')
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      crane.check()
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]
        if (a.kind === b.kind) {
          // Bakiye/geç iş setup'ı başka bir setup'la çakışabilir; onun sınırı
          // aşağıdaki fabrika geneli kuraldır.
          if (a.kind === 'setup' && (a.urgent || b.urgent)) continue
          const gap = a.kind === 'setup' ? input.setupGapMinutes : input.coilSetupGapMinutes
          // Aynı türden iki iş arasında `gap` dakika olmalı (tek setup
          // izni varken; birden fazlaysa aşağıda eşzamanlılık sayılır).
          if (concurrent === 1 && a.start < b.end + gap - EPS && b.start < a.end + gap - EPS) {
            crane.fail(
              `${hall} ${date}: ${a.kind === 'setup' ? 'mould setups' : 'coil changes'} of ${a.label} and ${b.label} are less than ${gap} min apart`,
            )
          }
        } else if (overlaps(a, b)) {
          crane.fail(`${hall} ${date}: mould setup and coil change at the same time (${a.label}, ${b.label})`)
        }
      }
    }
    if (concurrent > 1) {
      // Aynı anda en fazla `concurrent` setup.
      for (const kind of ['setup', 'coil'] as const) {
        const items = list.filter((x) => x.kind === kind)
        for (const x of items) {
          if (x.urgent) continue
          const at = items.filter((y) => !y.urgent && y.start <= x.start + EPS && x.start < y.end - EPS).length
          if (at > concurrent) crane.fail(`${hall} ${date}: ${at} ${kind === 'setup' ? 'setups' : 'coil changes'} at once`)
        }
      }
    }
  }

  // Fabrika geneli: bir setup başladığı anda süren setup sayısı. Normal
  // setup yalnız normal setuplarla sayılır (acil setup sonradan onun üstüne
  // gelebilir); toplam hiçbir anda acil sınırını aşmaz.
  const urgentCap = input.maxSetupsPlantWide ?? Number.POSITIVE_INFINITY
  const normalCap = Math.min(urgentCap, input.maxSetupsPlantWideNormal ?? Number.POSITIVE_INFINITY)
  if (Number.isFinite(urgentCap) || Number.isFinite(normalCap)) {
    for (const [date, items] of setupsByDate) {
      for (const x of items) {
        plantSetups.check()
        const running = items.filter((y) => y.start <= x.start + EPS && x.start < y.end - EPS)
        const all = running.length
        const normal = running.filter((y) => !y.urgent).length
        if (all > urgentCap) {
          plantSetups.fail(`${date} ${clock(date, x.start)}: ${all} mould setups at once (limit ${urgentCap})`)
        } else if (!x.urgent && normal > normalCap) {
          plantSetups.fail(
            `${date} ${clock(date, x.start)}: ${normal} normal mould setups at once (limit ${normalCap} without backlog)`,
          )
        }
      }
    }
  }

  const rules = [mainPress, earliest, pressOverlap, maintenance, mouldTwice, mouldBlackout, crane, plantSetups, wholeCoils, fillEarly, past].map(
    (x) => x.r,
  )
  return { rules, ok: rules.every((r) => r.violationCount === 0) }
}
