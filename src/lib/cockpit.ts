// "Today" paneli: yöneticinin (CEO, üretim direktörü, planlama şefi) ilk
// bakışta görmesi gereken kararlar. Kayıt sayısı değil, risk ve neden:
//
//   1. Teslimat riski     geç kalan parçalar, kaç saat, en kötüleri ve öneri
//   2. Kaçınılabilir mi    hiçbir planın kurtaramayacağı geç (kapasite) —
//                          fazla mesai / alternatif makine kararı burada
//   3. Darboğaz            yakın haftalarda kapasitesi aşılan makineler
//   4. Engeller            planı tutan kalıp ve makineler
//   5. Verinin tazeliği    plan eski SAP verisiyle mi kuruldu?
//   6. Planın sağlığı      son hesap hata verdi mi, plan bayat mı?
//
// Saf hesap: sunucu (convex/cockpit.ts) planın özet dokümanını ve birkaç
// küçük tabloyu verir, kural burada (test: cockpit.test.ts).

import type { PlanAlarms } from './planAlarms'

export type SignalLevel = 'critical' | 'warning' | 'ok'

export interface Signal {
  key: string
  level: SignalLevel
  title: string
  detail?: string
  /** Ayrıntı listesi (en çok birkaç satır). */
  items?: { text: string; sub?: string }[]
  to: string
}

/**
 * Today eşikleri — plant ayarı (Company settings → Today & daily digest);
 * kaydedilmemişse TODAY_DEFAULTS (src/lib/settingsDefaults.ts).
 */
export interface TodayThresholds {
  /** Talep (ZPP) ve stok (MB52) bu kadar saatten eskiyse uyarı. */
  sapStaleHours: number
  /** Plan elle hesaplanır (günde bir); bundan eskiyse uyarı. */
  planStaleHours: number
  /** Darboğaz: talebi kapasitenin bu yüzdesini aşan hafta. */
  overloadPercent: number
  /** Darboğaza bakılan hafta sayısı (bu hafta + sonrakiler). */
  bottleneckWeeks: number
}

/** Today'in sinyal türleri (günlük özette hangilerinin gideceği seçilir). */
export const SIGNAL_TYPES: { key: string; label: string }[] = [
  { key: 'late', label: 'Late parts and on-time status' },
  { key: 'blockers', label: 'Dies / machines holding up deliveries' },
  { key: 'bottleneck', label: 'Work centers over capacity' },
  { key: 'freshness', label: 'Old or missing SAP data' },
  { key: 'plan', label: 'Plan health (failed, missing or old plan)' },
  { key: 'rules', label: 'Rule breaches found by the plan check' },
  { key: 'breakdowns', label: 'Machines stopped by a breakdown' },
  { key: 'dieProblems', label: 'Open die problems' },
]

/** Sinyalin türü (planError / noPlan / planStale → plan). */
export const signalType = (key: string) => (key === 'planError' || key === 'noPlan' || key === 'planStale' ? 'plan' : key)

export interface CockpitInput {
  now: number
  /** Planlama modülü yoksa null (sinyaller yalnızca izinli modüllerden). */
  plan: {
    computedAt: number
    lateItems: { material: string; presses: string[]; lateHours: number; deadline: string; suggestion: string }[]
    lateLowerBound?: number
    brokenRules: { label: string; broken: number }[]
    capacity?: { weeks: { label: string }[]; presses: { press: string; capacity: number[]; demand: number[] }[] } | null
    alarms?: PlanAlarms
  } | null
  planError?: { message: string; at: number } | null
  /** Plan girdisinin son değiştiği an (planStatus.dataChangedAt): plandan sonraysa plan güncel değil. */
  planChangedAt?: number | null
  /** SAP yüklemeleri: anahtar → son yükleme anı (0 = hiç). */
  uploads?: Record<string, number> | null
  openBreakdowns?: { total: number; stopping: number } | null
  openDieProblems?: number | null
}

const hours = (ms: number) => ms / 3_600_000
const ageText = (ms: number) => {
  const h = hours(ms)
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`
}
const fmt = (n: number) => Math.round(n).toLocaleString('en-GB')

export function buildCockpit(input: CockpitInput, t: TodayThresholds): Signal[] {
  const out: Signal[] = []
  const { plan, now } = input

  // 6. Planın sağlığı — en başta: hatalı/bayat planın diğer sinyalleri yanıltır.
  if (input.planError && (!plan || input.planError.at > plan.computedAt)) {
    out.push({ key: 'planError', level: 'critical', title: 'The last plan calculation failed', detail: input.planError.message, to: '/planlama' })
  }
  if (!plan && input.uploads) {
    out.push({ key: 'noPlan', level: 'critical', title: 'No plan yet', detail: 'Upload demand and stock on SAP Data, then press Calculate plan on Planning.', to: '/planlama' })
  } else if (plan && (input.planChangedAt ?? 0) > plan.computedAt) {
    out.push({ key: 'planStale', level: 'warning', title: 'The plan is not up to date', detail: `The data changed ${ageText(now - (input.planChangedAt ?? now))} ago, after the last calculation — press Calculate plan.`, to: '/planlama' })
  } else if (plan && hours(now - plan.computedAt) > t.planStaleHours) {
    out.push({ key: 'planStale', level: 'warning', title: `The plan is ${ageText(now - plan.computedAt)} old`, detail: 'The plan is calculated by hand — open Planning and press Calculate plan.', to: '/planlama' })
  }

  // 5. Verinin tazeliği.
  if (input.uploads) {
    const sources: [string, string][] = [
      ['weeklyDemand', 'Demand (ZPP)'],
      ['stock', 'Stock (MB52)'],
    ]
    const stale = sources
      .map(([key, label]) => ({ label, at: input.uploads?.[key] ?? 0 }))
      .filter((s) => !s.at || hours(now - s.at) > t.sapStaleHours)
    if (stale.length) {
      const never = stale.some((s) => !s.at)
      out.push({
        key: 'freshness',
        level: never ? 'critical' : 'warning',
        title: never ? 'SAP data missing' : 'The plan runs on old SAP data',
        items: stale.map((s) => ({ text: s.label, sub: s.at ? `uploaded ${ageText(now - s.at)} ago` : 'never uploaded' })),
        to: '/sapdata',
      })
    }
  }

  if (plan) {
    // 1–2. Teslimat riski ve kaçınılabilirliği.
    const late = [...plan.lateItems].sort((a, b) => b.lateHours - a.lateHours)
    if (late.length) {
      const total = late.reduce((s, l) => s + l.lateHours, 0)
      const unavoidable = Math.min(late.length, plan.lateLowerBound ?? 0)
      out.push({
        key: 'late',
        level: 'critical',
        title: `${late.length} part${late.length === 1 ? '' : 's'} late — ${fmt(total)} h behind in total`,
        detail:
          unavoidable > 0
            ? `${unavoidable} of them no plan can save with today's capacity — decide overtime or another work center. The rest is sequencing.`
            : 'Each could be on time with a different sequence — see the suggestions.',
        items: late.slice(0, 3).map((l) => ({ text: `${l.material} on ${l.presses.join(', ') || '—'} — ${fmt(l.lateHours)} h late (due ${l.deadline})`, sub: l.suggestion })),
        to: '/planlama',
      })
    } else {
      out.push({ key: 'late', level: 'ok', title: 'Every delivery in the horizon is on time', to: '/planlama' })
    }

    // 3. Darboğaz.
    const cap = plan.capacity
    if (cap) {
      const hits: { press: string; week: string; ratio: number }[] = []
      for (const p of cap.presses) {
        for (let w = 0; w < Math.min(t.bottleneckWeeks, cap.weeks.length); w++) {
          const c = p.capacity[w] ?? 0
          const d = p.demand[w] ?? 0
          if (d > 0 && (c <= 0 || (d / c) * 100 > t.overloadPercent)) hits.push({ press: p.press, week: cap.weeks[w].label, ratio: c > 0 ? d / c : Infinity })
        }
      }
      hits.sort((a, b) => b.ratio - a.ratio)
      if (hits.length) {
        out.push({
          key: 'bottleneck',
          level: 'warning',
          title: `${new Set(hits.map((h) => h.press)).size} work center${hits.length === 1 ? '' : 's'} over capacity in the next ${t.bottleneckWeeks} weeks`,
          items: hits.slice(0, 4).map((h) => ({ text: `${h.press} — ${h.week}`, sub: Number.isFinite(h.ratio) ? `${Math.round(h.ratio * 100)} % of capacity` : 'demand but no capacity (no calendar)' })),
          to: '/capacity',
        })
      }
    }

    // 4. Engeller.
    const dies = (plan.alarms?.dies ?? []).filter((d) => d.critical)
    const machines = (plan.alarms?.machines ?? []).filter((m) => m.critical)
    if (dies.length || machines.length) {
      out.push({
        key: 'blockers',
        level: 'critical',
        title: `${dies.length + machines.length} die${dies.length + machines.length === 1 ? '' : 's'} / machines hold up deliveries`,
        items: [
          ...machines.slice(0, 2).map((m) => ({ text: `Machine ${m.press}`, sub: m.explanation })),
          ...dies.slice(0, 3).map((d) => ({ text: `Die ${d.material}`, sub: d.explanation })),
        ],
        to: '/alarms',
      })
    }

    // Plan kuralı ihlali: bağımsız kontrol bir kuralın çiğnendiğini gördü.
    const broken = plan.brokenRules.filter((r) => r.broken > 0)
    if (broken.length) {
      out.push({
        key: 'rules',
        level: 'warning',
        title: `The independent plan check found ${broken.reduce((s, r) => s + r.broken, 0)} rule breach(es)`,
        items: broken.slice(0, 3).map((r) => ({ text: r.label, sub: `${r.broken} case(s)` })),
        to: '/planlama',
      })
    }
  }

  // Bakım tarafı (plan dışı da görünür).
  if (input.openBreakdowns && input.openBreakdowns.stopping > 0) {
    out.push({
      key: 'breakdowns',
      level: 'warning',
      title: `${input.openBreakdowns.stopping} machine${input.openBreakdowns.stopping === 1 ? ' is' : 's are'} stopped by a breakdown`,
      detail: `${input.openBreakdowns.total} open breakdown(s) in total.`,
      to: '/machine-followup/breakdowns',
    })
  }
  if (input.openDieProblems && input.openDieProblems > 0) {
    out.push({ key: 'dieProblems', level: 'warning', title: `${input.openDieProblems} open die problem${input.openDieProblems === 1 ? '' : 's'}`, to: '/die-followup/problems' })
  }

  const rank: Record<SignalLevel, number> = { critical: 0, warning: 1, ok: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}
