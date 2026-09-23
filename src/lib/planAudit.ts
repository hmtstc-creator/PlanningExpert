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
  decision?: {
    step: number
    candidates: { press: string; endDate?: string; endMinute?: number; note?: string }[]
  }
}

export interface AuditInputs {
  jobs: AuditJob[]
  maintenance: { press: string; date: string; start: number; end: number }[]
  moldBlackouts: { material: string; date: string }[]
  todayIso: string
  setupGapMinutes: number
  coilSetupGapMinutes: number
  concurrentSetupsPerHall: number
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
  const fillEarly = rule('fill-early', 'No lot starts before its stock reaches the safety level')
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
    { kind: 'setup' | 'coil'; label: string; start: number; end: number }[]
  >()
  const blackout = new Set(input.moldBlackouts.map((b) => `${b.material}|${b.date}`))

  for (const job of input.jobs) {
    const pressRule = input.pressRules?.get(job.material)
    if (pressRule && !job.frozen) {
      mainPress.check()
      const allowed = pressRule.flexible || job.press === pressRule.main || job.press === pressRule.pinned
      if (!allowed) {
        mainPress.fail(`${job.material} is on ${job.press}, but its main press is ${pressRule.main} and it is not flexible`)
      }
    }
    if (job.decision && job.endDate !== undefined && job.endMinute !== undefined) {
      earliest.check()
      const chosen = { date: job.endDate, minute: job.endMinute }
      for (const c of job.decision.candidates) {
        if (c.endDate === undefined || c.endMinute === undefined || c.press === job.press) continue
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
        })
        byHallDate.set(key, list)
      }
    }

    for (const [date, s] of span) {
      past.check()
      if (!job.frozen && date < input.todayIso) {
        past.fail(`${job.material} on ${job.press} runs on ${date}`)
      }
      mouldBlackout.check()
      if (blackout.has(`${job.material}|${date}`)) {
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
          const at = items.filter((y) => y.start <= x.start + EPS && x.start < y.end - EPS).length
          if (at > concurrent) crane.fail(`${hall} ${date}: ${at} ${kind === 'setup' ? 'setups' : 'coil changes'} at once`)
        }
      }
    }
  }

  const rules = [mainPress, earliest, pressOverlap, maintenance, mouldTwice, mouldBlackout, crane, fillEarly, past].map(
    (x) => x.r,
  )
  return { rules, ok: rules.every((r) => r.violationCount === 0) }
}
