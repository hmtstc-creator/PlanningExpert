// OEE Agent Report (planlamacı, 2026-10-16): seçilen günün kısa, sıralı notları —
// grafik yok. CEO özeti en üstte; ardından kalıplar, makineler, vardiyalar, tekrar
// eden duruşlar, açık konular ve iyi haberler. Kararlar: docs/oee-agent-report.md.
//
// Saf hesap: notları kurallar yazar (yapay zekâ yok); her sayı sitenin kendi OEE
// hesabından (oee.ts: süreler toplanır, oran toplamdan). Tesise özel değer yok:
// eşikler ve hangi kayıp grubunun kalıp / makine olduğu OEE ayarında (OeeConfig.agent,
// lossGroups[].agent).

import {
  addDaysIso,
  groupLabel,
  ratios,
  shiftNumber,
  sumTimes,
  type DayRow,
  type DowntimeDay,
  type DowntimeEvent,
  type LossDay,
  type OeeConfig,
  type OeeTimes,
  type OrderRow,
  type ShiftRow,
} from './oee'

// ---- ayar -------------------------------------------------------------------------

export interface AgentThresholds {
  /** Parça (kalıp) kaybı notu: günde en az bu kadar dakika … */
  partLossMin: number
  /** … ya da en az bu kadar duruş. */
  partLossStops: number
  /** Makine arızası notu: iş yerinde günde en az bu kadar dakika. */
  machineLossMin: number
  /** OEE düşüşü / yükselişi: 4 haftalık ortalamadan en az bu kadar puan. */
  oeeDropPoints: number
  /** Tekrar: son 7 günün en az bu kadarında. */
  repeatDays: number
  /** Vardiya örüntüsü: son 5 günün en az bu kadarında en kötü vardiya. */
  shiftPatternDays: number
  /** Hurda + red oranı, son 7 günün ortalamasının en az bu katı. */
  scrapFactor: number
  /** Ortalama duruş süresi (MTTR), son 7 günün en az bu katı. */
  mttrFactor: number
  /** Bu kadar dakikadan kısa yüklemesi olan vardiya / iş yeri karşılaştırılmaz. */
  minLoadingMin: number
  /** Sebebi girilmemiş ("#") duruş payı (%) bu kadar ve üstündeyse not. */
  undefinedSharePct: number
  /** CEO özetindeki en çok not sayısı. */
  summaryNotes: number
}

export const AGENT_DEFAULTS: AgentThresholds = {
  partLossMin: 30,
  partLossStops: 3,
  machineLossMin: 30,
  oeeDropPoints: 10,
  repeatDays: 3,
  shiftPatternDays: 4,
  scrapFactor: 2,
  mttrFactor: 1.5,
  minLoadingMin: 120,
  undefinedSharePct: 10,
  summaryNotes: 5,
}

export const agentThresholds = (c: OeeConfig): AgentThresholds => ({ ...AGENT_DEFAULTS, ...(c.agent ?? {}) })

export type AgentRole = 'die' | 'machine'

/**
 * Kayıp grubunun Agent Report'taki rolü: ayarda seçilen; seçilmemişse grafik
 * sütunu ya da adından (Die / Mold / Kalıp → kalıp; Machine / Makine / Press → makine).
 */
export function groupRole(code: string, c: OeeConfig): AgentRole | null {
  const g = c.lossGroups.find((x) => x.code === code)
  if (!g) return null
  if (g.agent) return g.agent === 'none' ? null : g.agent
  const text = `${g.chart} ${g.label}`.toLowerCase()
  if (/\b(die|dies|mold|mould|tool)\b|kalıp|kalip|matri/.test(text)) return 'die'
  if (/\b(machine|machines|press|presses|equipment)\b|makine|mașin|masin/.test(text)) return 'machine'
  return null
}

// ---- giriş ve çıkış ----------------------------------------------------------------

export interface DieTopic {
  id: string
  material: string
  problemType: string
  occurredAt: string
  status: string
  action?: string
  press?: string
}

export interface MachineTopic {
  id: string
  press: string
  problemType: string
  occurredAt: string
  status: string
  stopsPress: boolean
}

export interface MoldAlarmRow {
  material: string
  status: string
  openedAt: number
  shotsAtAlarm: number
  limitAtAlarm: number
}

export interface AgentInput {
  /** Raporun günü (YYYY-MM-DD). */
  day: string
  config: OeeConfig
  /** Gün × iş merkezi, `day − 27 … day` (seçime göre süzülmüş). */
  days: DayRow[]
  /** Kayıp özeti, aynı 4 hafta. */
  lossDays: LossDay[]
  /** Vardiya satırları, `day − 6 … day`. */
  shifts: ShiftRow[]
  /** Ham duruşlar, `day − 6 … day`. */
  events: DowntimeDay[]
  /** Siparişler, `day − 6 … day`. */
  orders: OrderRow[]
  /** null = bu kullanıcı göremez (modül izni yok). */
  dieTopics: DieTopic[] | null
  machineTopics: MachineTopic[] | null
  moldAlarms: MoldAlarmRow[] | null
}

export type NoteLevel = 'critical' | 'warning' | 'watch' | 'good'
export type NoteSection = 'dies' | 'machines' | 'shifts' | 'repeats' | 'topics' | 'good'
export type NoteOwner = 'Die shop' | 'Maintenance' | 'Production' | 'Quality'

export interface NoteLink {
  to: string
  label: string
  search?: Record<string, string | number>
}

/** Die Follow-up penceresinin taslağı (DieFollowUpDialog). */
export interface NoteFollowUp {
  material: string
  press: string
  loss: string
  minutes: number
  days: { date: string; minutes: number }[]
  detail?: string
}

export interface AgentNote {
  key: string
  /** Aynı konunun notları CEO özetinde bir kez (ör. iş yeri, parça). */
  subject: string
  level: NoteLevel
  section: NoteSection
  /** Tek cümle. */
  title: string
  /** Kanıt: sayılar, tekrar, açık konu. */
  evidence: string
  owner: NoteOwner
  /** Sıralama: o gün kaybettirilen dakika. */
  impactMin: number
  link?: NoteLink
  followUp?: NoteFollowUp
}

export interface AgentHeadline {
  oee: number | null
  baseOee: number | null
  loadingMin: number
  workCenters: number
}

export interface AgentReport {
  day: string
  headline: AgentHeadline
  /** CEO özeti: kritik ve uyarılar, etkiye göre; aynı konu bir kez. */
  summary: AgentNote[]
  sections: Record<NoteSection, AgentNote[]>
  /** Açık konuların o gün etkilemediği listesi (kısa). */
  quietTopics: string[]
  /** O gün kaybettiren, notu başka bölümde (Dies / Presses) olan açık konular (kısa). */
  affectedTopics: string[]
  /** Bölümde gösterilmeyen (en çok MAX_PER_SECTION) küçük notların sayısı. */
  hidden: Record<NoteSection, number>
  /** Eksik veri / yetki. */
  notices: string[]
  counts: Record<NoteLevel, number>
}

// ---- yardımcılar -------------------------------------------------------------------

const LEVEL_RANK: Record<NoteLevel, number> = { critical: 0, warning: 1, watch: 2, good: 3 }
/** Bölüm başına en çok not: kısa rapor; kalanı yalnızca sayı (önce kritik, sonra etki). */
export const MAX_PER_SECTION = 10
const SECTIONS: NoteSection[] = ['dies', 'machines', 'shifts', 'repeats', 'topics', 'good']

/** "45 min" ya da "2.2 h". */
export const duration = (min: number) => (Math.abs(min) < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`)
const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`)
const pts = (x: number) => `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} pts`
/** 15.10 */
export const dmShort = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

const undefinedCode = (e: { rc1: string; rc2: string }) => e.rc1 === '#' || e.rc2 === '#'
const isLoss = (e: DowntimeEvent, c: OeeConfig) => !undefinedCode(e) && c.lossReasonCodes.includes(e.rc1)
const partOf = (m: string) => (m && m !== '#' ? m : '')
const textOf = (e: DowntimeEvent) => (e.textEn || e.rc2).trim().toUpperCase()
const eventShift = (e: DowntimeEvent, c: OeeConfig) => shiftNumber(e.shiftDefinition, c) ?? shiftNumber(e.shiftGroup, c)
const oeeOfRows = (rows: OeeTimes[]) => {
  const t = sumTimes(rows)
  return { oee: t.loadingMin > 0 ? ratios(t).oee : null, loadingMin: t.loadingMin }
}

interface Ev {
  date: string
  workCenter: string
  e: DowntimeEvent
}

const flatten = (days: DowntimeDay[]): Ev[] => days.flatMap((d) => d.events.map((e) => ({ date: d.date, workCenter: d.workCenter, e })))

function topText(evs: Ev[]): { text: string; minutes: number } {
  const m = new Map<string, number>()
  for (const x of evs) m.set(textOf(x.e), (m.get(textOf(x.e)) ?? 0) + x.e.minutes)
  const [text, minutes] = [...m].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  return { text, minutes }
}

const sumMin = (evs: Ev[]) => evs.reduce((a, x) => a + x.e.minutes, 0)

// ---- rapor -------------------------------------------------------------------------

export function agentReport(input: AgentInput): AgentReport {
  const { day, config: c } = input
  const t = agentThresholds(c)
  const notes: AgentNote[] = []
  const notices: string[] = []
  const add = (n: AgentNote) => notes.push(n)
  const weekFrom = addDaysIso(day, -6)
  const baseFrom = addDaysIso(day, -27)

  const today = input.days.filter((d) => d.date === day)
  const base = input.days.filter((d) => d.date >= baseFrom && d.date < day)
  const plant = oeeOfRows(today)
  const plantBase = oeeOfRows(base)
  const headline: AgentHeadline = {
    oee: plant.oee,
    baseOee: plantBase.oee,
    loadingMin: plant.loadingMin,
    workCenters: new Set(today.map((d) => d.workCenter)).size,
  }
  if (!today.length) notices.push(`No OEE data for ${dmShort(day)} in this selection.`)

  const all = flatten(input.events.filter((d) => d.date >= weekFrom && d.date <= day))
  const losses = all.filter((x) => isLoss(x.e, c))
  const lossToday = losses.filter((x) => x.date === day)
  if (!input.events.some((d) => d.date === day) && today.length) notices.push(`No downtime rows for ${dmShort(day)} — die, machine and repeat notes need them.`)
  const role = (x: Ev) => groupRole(x.e.rc2, c)
  const dieToday = lossToday.filter((x) => role(x) === 'die')
  const machineToday = lossToday.filter((x) => role(x) === 'machine')
  if (!c.lossGroups.some((g) => groupRole(g.code, c) === 'die'))
    notices.push('No loss group is marked as a die loss — set it on OEE Settings → Loss groups (Agent role).')
  if (!c.lossGroups.some((g) => groupRole(g.code, c) === 'machine'))
    notices.push('No loss group is marked as a machine loss — set it on OEE Settings → Loss groups (Agent role).')
  if (input.dieTopics === null) notices.push('Die problems are not shown: no access to Die Follow-up.')
  if (input.machineTopics === null) notices.push('Machine breakdowns are not shown: no access to Machine Follow-up.')

  const openDie = (input.dieTopics ?? []).filter((p) => p.status === 'open')
  const openMachine = (input.machineTopics ?? []).filter((p) => p.status === 'open')
  const ranOn = (material: string, date: string) =>
    all.some((x) => x.date === date && partOf(x.e.material) === material) || input.orders.some((o) => o.date === date && o.material === material)

  // ---- kalıplar ----
  const byPart = new Map<string, Ev[]>()
  for (const x of dieToday) {
    const m = partOf(x.e.material)
    if (!m) continue
    const k = `${m}|${x.workCenter}`
    byPart.set(k, [...(byPart.get(k) ?? []), x])
  }
  const dieWeek = losses.filter((x) => role(x) === 'die')
  for (const [k, evs] of byPart) {
    const [material, wc] = k.split('|')
    const minutes = sumMin(evs)
    if (minutes < t.partLossMin && evs.length < t.partLossStops) continue
    const top = topText(evs)
    const group = groupLabel(evs[0].e.rc2, c)
    const partDays = [...new Set(dieWeek.filter((x) => partOf(x.e.material) === material).map((x) => x.date))]
    const repeat = partDays.length >= t.repeatDays
    const topics = openDie.filter((p) => p.material === material)
    const lead = `${wc} · ${material}: ${group} ${duration(minutes)} (${plural(evs.length, 'stop')}), mainly ${top.text}`
    const repeatText = repeat ? ` Die losses on ${partDays.length} of the last 7 days.` : ''
    if (topics.length) {
      const oldest = topics.reduce((a, b) => (a.occurredAt <= b.occurredAt ? a : b))
      const age = Math.max(0, daysBetween(oldest.occurredAt, day))
      add({
        key: `die-open|${k}`,
        subject: `part|${material}`,
        level: 'critical',
        section: 'dies',
        title: `${lead} — while a die follow-up has been open for ${plural(age, 'day')}.`,
        evidence: `Open topic: ${oldest.problemType}${oldest.action ? ` · action: ${oldest.action}` : ''}.${repeatText}`,
        owner: 'Die shop',
        impactMin: minutes,
        link: { to: '/die-followup/problems', label: 'Die problems' },
      })
    } else {
      const perDay = new Map<string, number>()
      for (const x of dieWeek.filter((x) => partOf(x.e.material) === material && x.workCenter === wc))
        perDay.set(x.date, (perDay.get(x.date) ?? 0) + x.e.minutes)
      add({
        key: `die-new|${k}`,
        subject: `part|${material}`,
        level: repeat ? 'critical' : 'warning',
        section: 'dies',
        title: `${lead} — no die follow-up topic is open.`,
        evidence: repeat ? `Repeating:${repeatText} Open a follow-up with an action.` : 'First time this week. Open a follow-up if it is not a one-off.',
        owner: 'Die shop',
        impactMin: minutes,
        followUp: {
          material,
          press: wc,
          loss: group,
          minutes,
          days: [...perDay].sort((a, b) => a[0].localeCompare(b[0])).map(([date, m]) => ({ date, minutes: m })),
          detail: top.text,
        },
      })
    }
  }
  // Ömür limitini aşmış kalıp o gün çalıştı.
  for (const a of (input.moldAlarms ?? []).filter((x) => x.status === 'open')) {
    if (!ranOn(a.material, day)) continue
    add({
      key: `alarm|${a.material}`,
      subject: `part|${a.material}`,
      level: 'critical',
      section: 'dies',
      title: `${a.material} ran on ${dmShort(day)} although its die is over its shot limit.`,
      evidence: `Shot-limit alarm open: ${a.shotsAtAlarm.toLocaleString('en-GB')} shots against a limit of ${a.limitAtAlarm.toLocaleString('en-GB')}.`,
      owner: 'Die shop',
      impactMin: 0,
      link: { to: '/die-followup/maintenance', label: 'Die maintenance' },
    })
  }
  // Hurda + red oranı arttı.
  const qual = new Map<string, { bad: number; all: number; prevBad: number; prevAll: number; wc: string }>()
  for (const o of input.orders) {
    if (!o.material || o.date < weekFrom || o.date > day) continue
    const q = qual.get(o.material) ?? { bad: 0, all: 0, prevBad: 0, prevAll: 0, wc: o.workCenter }
    const bad = o.scrap + o.reject
    const tot = o.good + bad
    if (o.date === day) {
      q.bad += bad
      q.all += tot
      q.wc = o.workCenter
    } else {
      q.prevBad += bad
      q.prevAll += tot
    }
    qual.set(o.material, q)
  }
  for (const [material, q] of qual) {
    if (q.all <= 0 || q.prevAll <= 0 || q.bad < 10) continue
    const now = q.bad / q.all
    const before = q.prevBad / q.prevAll
    if (before <= 0 || now < before * t.scrapFactor) continue
    add({
      key: `scrap|${material}`,
      subject: `part|${material}`,
      level: 'warning',
      section: 'dies',
      title: `${q.wc} · ${material}: scrap and reject ${pct(now)} of the pieces — ${(now / before).toFixed(1)}× its last-7-day rate.`,
      evidence: `${q.bad.toLocaleString('en-GB')} bad of ${q.all.toLocaleString('en-GB')} pieces (before: ${pct(before)}).`,
      owner: 'Quality',
      impactMin: 0,
      link: { to: '/oee/dies', label: 'Dies OEE Trend' },
    })
  }

  // ---- makineler ----
  const wcs = [...new Set(today.map((d) => d.workCenter))].sort()
  const machineWeek = losses.filter((x) => role(x) === 'machine')
  for (const wc of new Set(machineToday.map((x) => x.workCenter))) {
    const evs = machineToday.filter((x) => x.workCenter === wc)
    const minutes = sumMin(evs)
    if (minutes < t.machineLossMin) continue
    const top = topText(evs)
    const group = groupLabel(evs[0].e.rc2, c)
    const days = new Set(machineWeek.filter((x) => x.workCenter === wc).map((x) => x.date)).size
    const topics = openMachine.filter((p) => p.press === wc)
    const lead = `${wc}: ${group} ${duration(minutes)} (${plural(evs.length, 'stop')}), mainly ${top.text}`
    const repeat = days >= t.repeatDays ? ` Machine losses on ${days} of the last 7 days.` : ''
    if (topics.length) {
      const oldest = topics.reduce((a, b) => (a.occurredAt <= b.occurredAt ? a : b))
      add({
        key: `machine-open|${wc}`,
        subject: `wc|${wc}`,
        level: 'critical',
        section: 'machines',
        title: `${lead} — breakdown open since ${dmShort(oldest.occurredAt)}.`,
        evidence: `Open breakdown: ${oldest.problemType}${oldest.stopsPress ? ' (machine stopped)' : ''}.${repeat}`,
        owner: 'Maintenance',
        impactMin: minutes,
        link: { to: '/machine-followup/breakdowns', label: 'Machine breakdowns' },
      })
    } else {
      add({
        key: `machine-new|${wc}`,
        subject: `wc|${wc}`,
        level: repeat ? 'critical' : 'warning',
        section: 'machines',
        title: `${lead} — no breakdown is recorded in Machine Follow-up.`,
        evidence: repeat ? `Repeating:${repeat}` : 'Record it if it needs maintenance work.',
        owner: 'Maintenance',
        impactMin: minutes,
        link: { to: '/machine-followup/breakdowns', label: 'Machine breakdowns' },
      })
    }
  }
  for (const wc of wcs) {
    const now = oeeOfRows(today.filter((d) => d.workCenter === wc))
    const before = oeeOfRows(base.filter((d) => d.workCenter === wc))
    if (now.oee === null || before.oee === null || now.loadingMin < t.minLoadingMin || before.loadingMin < t.minLoadingMin) continue
    const diff = (now.oee - before.oee) * 100
    if (Math.abs(diff) < t.oeeDropPoints) continue
    const biggest = biggestLoss(input.lossDays.filter((l) => l.date === day && l.workCenter === wc), c)
    if (diff < 0)
      add({
        key: `drop|${wc}`,
        subject: `wc|${wc}`,
        level: 'warning',
        section: 'machines',
        title: `${wc}: OEE ${pct(now.oee)} — ${pts(diff)} below its 4-week average (${pct(before.oee)}).`,
        evidence: biggest ? `Biggest loss: ${biggest.label} ${duration(biggest.minutes)}.` : `Loading ${duration(now.loadingMin)}.`,
        owner: 'Production',
        impactMin: (-diff / 100) * now.loadingMin,
        link: { to: '/oee/bridge', label: 'Loss Bridge', search: { from: day, to: day } },
      })
    else
      add({
        key: `rise|${wc}`,
        subject: `wc|${wc}`,
        level: 'good',
        section: 'good',
        title: `${wc}: OEE ${pct(now.oee)} — ${pts(diff)} above its 4-week average (${pct(before.oee)}).`,
        evidence: `Loading ${duration(now.loadingMin)}.`,
        owner: 'Production',
        impactMin: 0,
      })
  }
  // Ortalama duruş süresi uzadı (makine kayıpları).
  for (const wc of new Set(machineToday.map((x) => x.workCenter))) {
    const now = machineToday.filter((x) => x.workCenter === wc)
    const before = machineWeek.filter((x) => x.workCenter === wc && x.date !== day)
    if (now.length < 3 || before.length < 3) continue
    const mNow = sumMin(now) / now.length
    const mBefore = sumMin(before) / before.length
    if (mBefore <= 0 || mNow < mBefore * t.mttrFactor) continue
    add({
      key: `mttr|${wc}`,
      subject: `wc|${wc}`,
      level: 'watch',
      section: 'machines',
      title: `${wc}: machine stops last longer — ${mNow.toFixed(1)} min per stop against ${mBefore.toFixed(1)} min in the last 7 days.`,
      evidence: `${plural(now.length, 'stop')} on ${dmShort(day)}.`,
      owner: 'Maintenance',
      impactMin: (mNow - mBefore) * now.length,
      link: { to: '/oee/mttr', label: 'MTTR & MTBF' },
    })
  }
  // Kısa duruşlar arttı (2 dakikadan kısa kayıp duruşları).
  for (const wc of wcs) {
    const shortNow = lossToday.filter((x) => x.workCenter === wc && x.e.minutes < 2).length
    const otherDays = new Set(losses.filter((x) => x.workCenter === wc && x.date !== day).map((x) => x.date)).size
    if (shortNow < 10 || !otherDays) continue
    const avg = losses.filter((x) => x.workCenter === wc && x.date !== day && x.e.minutes < 2).length / otherDays
    if (shortNow < avg * 2) continue
    add({
      key: `short|${wc}`,
      subject: `wc|${wc}`,
      level: 'watch',
      section: 'machines',
      title: `${wc}: ${shortNow} short stops (under 2 min) — ${avg ? `${(shortNow / avg).toFixed(1)}× the daily average` : 'none on the other days'}.`,
      evidence: `Short stops rarely get a breakdown record but add up: ${duration(lossToday.filter((x) => x.workCenter === wc && x.e.minutes < 2).reduce((a, x) => a + x.e.minutes, 0))} today.`,
      owner: 'Production',
      impactMin: 0,
    })
  }

  // ---- vardiyalar ----
  const shiftKey = (r: ShiftRow) => shiftNumber(r.shiftGroup, c)
  const todayShifts = input.shifts.filter((r) => r.date === day)
  const slots = new Map<string, ShiftRow[]>()
  for (const r of todayShifts) {
    const n = shiftKey(r)
    if (n === null) continue
    const k = `${r.workCenter}|${n}`
    slots.set(k, [...(slots.get(k) ?? []), r])
  }
  const ranked = [...slots]
    .map(([k, rows]) => ({ k, ...oeeOfRows(rows) }))
    .filter((x) => x.oee !== null && x.loadingMin >= t.minLoadingMin)
    .sort((a, b) => a.oee! - b.oee!)
  const worst = ranked[0]
  if (worst) {
    const [wc, nText] = worst.k.split('|')
    const n = Number(nText)
    const same = input.shifts.filter((r) => r.date !== day && r.workCenter === wc && shiftKey(r) === n && r.date >= weekFrom)
    const sameBase = oeeOfRows(same)
    const diff = sameBase.oee !== null && sameBase.loadingMin >= t.minLoadingMin ? (worst.oee! - sameBase.oee) * 100 : null
    const evs = lossToday.filter((x) => x.workCenter === wc && eventShift(x.e, c) === n)
    const top = topText(evs)
    const parts = new Map<string, number>()
    for (const x of evs) if (partOf(x.e.material)) parts.set(partOf(x.e.material), (parts.get(partOf(x.e.material)) ?? 0) + x.e.minutes)
    const topPart = [...parts].sort((a, b) => b[1] - a[1])[0]
    add({
      key: `worst-shift|${worst.k}`,
      subject: `wc|${wc}`,
      level: diff !== null && diff <= -t.oeeDropPoints ? 'warning' : 'watch',
      section: 'shifts',
      title: `Weakest shift: ${wc}, shift ${n} on ${dmShort(day)} — OEE ${pct(worst.oee)}${diff !== null ? ` (${pts(diff)} against the same shift this week)` : ''}.`,
      evidence: [
        top.text ? `Main loss ${top.text} ${duration(top.minutes)}` : '',
        topPart ? `most on ${topPart[0]} (${duration(topPart[1])})` : '',
        `loading ${duration(worst.loadingMin)}`,
      ]
        .filter(Boolean)
        .join(', ')
        .replace(/^./, (s) => s.toUpperCase())
        .concat('.'),
      owner: 'Production',
      // Etki: aynı vardiyanın bu haftaki normaline göre fazladan kayıp (kalıp / makine notlarını ikinci kez saymaz).
      impactMin: diff !== null && diff < 0 ? (-diff / 100) * worst.loadingMin : 0,
      link: { to: '/oee/report', label: 'Daily Report', search: { from: day, to: day, shift: n } },
    })
  }
  // Örüntü: aynı vardiya son 5 günün çoğunda tesisin en kötüsü.
  const shiftDates = [...new Set(input.shifts.map((r) => r.date))].filter((d) => d <= day).sort().slice(-5)
  if (shiftDates.length >= t.shiftPatternDays) {
    const worstBy = new Map<number, number>()
    for (const d of shiftDates) {
      const byN = new Map<number, ShiftRow[]>()
      for (const r of input.shifts.filter((x) => x.date === d)) {
        const n = shiftKey(r)
        if (n !== null) byN.set(n, [...(byN.get(n) ?? []), r])
      }
      const w = [...byN]
        .map(([n, rows]) => ({ n, ...oeeOfRows(rows) }))
        .filter((x) => x.oee !== null && x.loadingMin >= t.minLoadingMin)
        .sort((a, b) => a.oee! - b.oee!)[0]
      if (w) worstBy.set(w.n, (worstBy.get(w.n) ?? 0) + 1)
    }
    for (const [n, count] of worstBy) {
      if (count < t.shiftPatternDays) continue
      add({
        key: `shift-pattern|${n}`,
        subject: `shift|${n}`,
        level: 'warning',
        section: 'shifts',
        title: `Shift ${n} was the plant's weakest shift on ${count} of the last ${shiftDates.length} days.`,
        evidence: 'A pattern, not a one-off: look at staffing, handover and the first hour of the shift.',
        owner: 'Production',
        impactMin: 0,
        link: { to: '/oee', label: 'Trend Analysis' },
      })
    }
  }
  // Hız kaybı tek vardiyada toplanıyor.
  const speed = new Map<number, number>()
  for (const o of input.orders.filter((o) => o.date === day)) {
    const n = shiftNumber(o.shift, c)
    if (n === null) continue
    speed.set(n, (speed.get(n) ?? 0) + Math.max(0, o.productionMin - o.operatingMin))
  }
  const speedAll = [...speed.values()].reduce((a, b) => a + b, 0)
  const speedTop = [...speed].sort((a, b) => b[1] - a[1])[0]
  if (speedTop && speedAll >= 60 && speed.size > 1 && speedTop[1] / speedAll >= 0.5)
    add({
      key: `speed|${speedTop[0]}`,
      subject: `shift|${speedTop[0]}`,
      level: 'watch',
      section: 'shifts',
      title: `Speed loss sits in shift ${speedTop[0]}: ${duration(speedTop[1])} of ${duration(speedAll)} on ${dmShort(day)}.`,
      evidence: 'Running below the set rate — check the stroke rate settings and material feeding on that shift.',
      owner: 'Production',
      impactMin: speedTop[1],
      link: { to: '/oee/dies', label: 'Dies OEE Trend' },
    })
  // Sebebi girilmemiş duruşlar.
  const todayAll = all.filter((x) => x.date === day && !(c.breakReasonCodes.includes(x.e.rc1) && !undefinedCode(x.e)))
  const undef = todayAll.filter((x) => undefinedCode(x.e))
  const undefMin = sumMin(undef)
  const allMin = sumMin(todayAll)
  if (allMin > 0 && undefMin >= 30 && (undefMin / allMin) * 100 >= t.undefinedSharePct) {
    const byWc = new Map<string, number>()
    for (const x of undef) byWc.set(x.workCenter, (byWc.get(x.workCenter) ?? 0) + x.e.minutes)
    const topWc = [...byWc].sort((a, b) => b[1] - a[1]).slice(0, 3)
    add({
      key: 'undefined',
      subject: 'data|undefined',
      level: 'watch',
      section: 'shifts',
      title: `${Math.round((undefMin / allMin) * 100)}% of the downtime on ${dmShort(day)} has no reason (${duration(undefMin)}).`,
      evidence: `Most on ${topWc.map(([w, m]) => `${w} ${duration(m)}`).join(', ')}. A loss without a reason cannot be solved.`,
      owner: 'Production',
      impactMin: undefMin,
      link: { to: '/oee/data', label: 'Uploaded downtimes' },
    })
  }

  // ---- tekrar eden duruşlar ----
  // Planlı setup (OEE ayarı → Setups) her gün olur: tekrar sayılmaz.
  const plannedSetup = new Set(c.setupTexts.filter((s) => s.kind === 'planned').map((s) => s.text.trim().toUpperCase()))
  const repeatable = losses.filter((x) => !plannedSetup.has(textOf(x.e)))
  const repeatGroups = new Map<string, Ev[]>()
  for (const x of repeatable) {
    const k = `${x.workCenter}|${textOf(x.e)}`
    repeatGroups.set(k, [...(repeatGroups.get(k) ?? []), x])
  }
  for (const [k, evs] of repeatGroups) {
    const dates = new Set(evs.map((x) => x.date))
    // Önemsiz tekrarlar not olmaz: haftada en az parça kaybı eşiği kadar.
    if (dates.size < t.repeatDays || !dates.has(day) || sumMin(evs) < t.partLossMin) continue
    const [wc, text] = k.split('|')
    const r = role(evs[0])
    // Her gün aynı yarım saatte başlıyorsa: süreç, arıza değil.
    const slot = sameTimeSlot(evs, t.repeatDays)
    add({
      key: `repeat|${k}`,
      subject: `wc|${wc}`,
      level: r ? 'warning' : 'watch',
      section: 'repeats',
      title: `${wc}: ${text} on ${dates.size} of the last 7 days — ${duration(sumMin(evs))} in ${plural(evs.length, 'stop')}.`,
      evidence: slot
        ? `It starts around ${slot.time} on ${slot.days} of these days — a routine in the process, not a random breakdown.`
        : `${duration(sumMin(evs.filter((x) => x.date === day)))} of it on ${dmShort(day)}.`,
      owner: ownerOf(r),
      impactMin: sumMin(evs.filter((x) => x.date === day)),
    })
  }
  // Parçayı izleyen duruş: aynı parça + aynı neden farklı iş yerlerinde.
  const byPartText = new Map<string, Ev[]>()
  for (const x of repeatable) {
    const m = partOf(x.e.material)
    if (!m) continue
    const k = `${m}|${textOf(x.e)}`
    byPartText.set(k, [...(byPartText.get(k) ?? []), x])
  }
  for (const [k, evs] of byPartText) {
    const dates = new Set(evs.map((x) => x.date))
    const presses = [...new Set(evs.map((x) => x.workCenter))].sort()
    if (presses.length < 2 || dates.size < t.repeatDays || !dates.has(day) || sumMin(evs) < t.partLossMin) continue
    const [material, text] = k.split('|')
    add({
      key: `follows-part|${k}`,
      subject: `part|${material}`,
      level: 'warning',
      section: 'repeats',
      title: `${material}: ${text} on ${presses.join(', ')} — the stop follows the part, not the press.`,
      evidence: `${dates.size} of the last 7 days, ${duration(sumMin(evs))} in total. The cause is likely the die or the material, not the machine.`,
      owner: 'Die shop',
      impactMin: sumMin(evs.filter((x) => x.date === day)),
    })
  }
  // Önceki günlerde tekrarlayan, bugün olmayan: aksiyon işe yaramış olabilir.
  for (const [k, evs] of repeatGroups) {
    const dates = new Set(evs.map((x) => x.date))
    if (dates.has(day) || dates.size < t.repeatDays || sumMin(evs) < t.partLossMin) continue
    const [wc, text] = k.split('|')
    if (!today.some((d) => d.workCenter === wc && d.loadingMin >= t.minLoadingMin)) continue
    add({
      key: `gone|${k}`,
      subject: `wc|${wc}`,
      level: 'good',
      section: 'good',
      title: `${wc}: ${text} did not occur on ${dmShort(day)} after ${dates.size} days this week.`,
      evidence: 'If an action was taken, it seems to work.',
      owner: ownerOf(role(evs[0])),
      impactMin: 0,
    })
  }

  // ---- açık konular ----
  const quietTopics: string[] = []
  const affectedTopics: string[] = []
  for (const p of openDie) {
    const evs = dieToday.filter((x) => partOf(x.e.material) === p.material)
    const age = Math.max(0, daysBetween(p.occurredAt, day))
    if (evs.length) {
      if (notes.some((n) => n.key.startsWith('die-open|') && n.key.includes(`|${p.material}|`))) {
        affectedTopics.push(`Die · ${p.material} · ${p.problemType}: ${duration(sumMin(evs))} (see Dies)`)
        continue
      }
      add({
        key: `topic-die|${p.id}`,
        subject: `part|${p.material}`,
        level: 'warning',
        section: 'topics',
        title: `Open die topic ${p.material} (${p.problemType}, ${plural(age, 'day')} open) cost ${duration(sumMin(evs))} on ${dmShort(day)}.`,
        evidence: p.action ? `Action: ${p.action}.` : 'No action written yet.',
        owner: 'Die shop',
        impactMin: sumMin(evs),
        link: { to: '/die-followup/problems', label: 'Die problems' },
      })
    } else {
      const weekLoss = dieWeek.some((x) => partOf(x.e.material) === p.material)
      const ran = [...new Set(all.filter((x) => partOf(x.e.material) === p.material).map((x) => x.date))].length
      if (age >= 7 && !weekLoss && ran >= 2)
        add({
          key: `topic-quiet|${p.id}`,
          subject: `part|${p.material}`,
          level: 'good',
          section: 'good',
          title: `Die topic ${p.material} (${p.problemType}) may be solved: no die loss in the last 7 days while the part ran on ${plural(ran, 'day')}.`,
          evidence: `Open for ${plural(age, 'day')} — close it on Die problems if it is fixed.`,
          owner: 'Die shop',
          impactMin: 0,
          link: { to: '/die-followup/problems', label: 'Die problems' },
        })
      else quietTopics.push(`Die · ${p.material} · ${p.problemType} (${plural(age, 'day')} open)`)
    }
  }
  for (const p of openMachine) {
    const evs = machineToday.filter((x) => x.workCenter === p.press)
    const age = Math.max(0, daysBetween(p.occurredAt, day))
    if (evs.length) {
      if (notes.some((n) => n.key === `machine-open|${p.press}`)) {
        affectedTopics.push(`Machine · ${p.press} · ${p.problemType}: ${duration(sumMin(evs))} (see Presses and machines)`)
        continue
      }
      add({
        key: `topic-machine|${p.id}`,
        subject: `wc|${p.press}`,
        level: 'warning',
        section: 'topics',
        title: `Open breakdown on ${p.press} (${p.problemType}, ${plural(age, 'day')} open) cost ${duration(sumMin(evs))} on ${dmShort(day)}.`,
        evidence: p.stopsPress ? 'Recorded as stopping the machine.' : 'Recorded as not stopping the machine.',
        owner: 'Maintenance',
        impactMin: sumMin(evs),
        link: { to: '/machine-followup/breakdowns', label: 'Machine breakdowns' },
      })
    } else {
      const weekLoss = machineWeek.some((x) => x.workCenter === p.press)
      const ran = new Set(input.days.filter((d) => d.workCenter === p.press && d.date >= weekFrom && d.loadingMin > 0).map((d) => d.date)).size
      if (age >= 7 && !weekLoss && ran >= 2)
        add({
          key: `topic-quiet|${p.id}`,
          subject: `wc|${p.press}`,
          level: 'good',
          section: 'good',
          title: `Breakdown on ${p.press} (${p.problemType}) may be solved: no machine loss in the last 7 days while it ran on ${plural(ran, 'day')}.`,
          evidence: `Open for ${plural(age, 'day')} — close it on Machine breakdowns if it is fixed.`,
          owner: 'Maintenance',
          impactMin: 0,
          link: { to: '/machine-followup/breakdowns', label: 'Machine breakdowns' },
        })
      else quietTopics.push(`Machine · ${p.press} · ${p.problemType} (${plural(age, 'day')} open)`)
    }
  }

  // ---- sıralama ve özet ----
  const order = (a: AgentNote, b: AgentNote) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.impactMin - a.impactMin || a.key.localeCompare(b.key)
  notes.sort(order)
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, notes.filter((n) => n.section === s).slice(0, MAX_PER_SECTION)])) as Record<
    NoteSection,
    AgentNote[]
  >
  const hidden = Object.fromEntries(SECTIONS.map((s) => [s, Math.max(0, notes.filter((n) => n.section === s).length - MAX_PER_SECTION)])) as Record<
    NoteSection,
    number
  >
  const seen = new Set<string>()
  const summary: AgentNote[] = []
  // Özet: önce kritik, sonra uyarılar; her biri kendi içinde etkiye göre; konu başına bir not.
  for (const n of notes.filter((n) => n.level === 'critical' || n.level === 'warning')) {
    if (summary.length >= t.summaryNotes) break
    if (seen.has(n.subject)) continue
    seen.add(n.subject)
    summary.push(n)
  }
  const counts = { critical: 0, warning: 0, watch: 0, good: 0 } as Record<NoteLevel, number>
  for (const n of notes) counts[n.level]++
  return { day, headline, summary, sections, quietTopics, affectedTopics, hidden, notices, counts }
}

/** En büyük kayıp grubu (gün × iş yeri özetinden). */
function biggestLoss(lossDays: LossDay[], c: OeeConfig): { label: string; minutes: number } | null {
  const m = new Map<string, number>()
  for (const l of lossDays)
    for (const [code, [min]] of Object.entries(l.codes)) {
      const [rc1, rc2] = code.split('|')
      if (rc1 === '#' || rc2 === '#' || !c.lossReasonCodes.includes(rc1)) continue
      m.set(rc2, (m.get(rc2) ?? 0) + min)
    }
  const top = [...m].sort((a, b) => b[1] - a[1])[0]
  return top ? { label: groupLabel(top[0], c), minutes: top[1] } : null
}

/** Duruş her gün aynı yarım saatte mi başlıyor? (en az `minDays` gün) → { time: '06:00', days }. */
function sameTimeSlot(evs: Ev[], minDays: number): { time: string; days: number } | null {
  const bySlot = new Map<string, Set<string>>()
  for (const x of evs) {
    const [h, m] = x.e.startTime.split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue
    const slot = `${String(h).padStart(2, '0')}:${m < 30 ? '00' : '30'}`
    bySlot.set(slot, (bySlot.get(slot) ?? new Set()).add(x.date))
  }
  const top = [...bySlot].sort((a, b) => b[1].size - a[1].size)[0]
  return top && top[1].size >= minDays ? { time: top[0], days: top[1].size } : null
}

const ownerOf = (r: AgentRole | null): NoteOwner => (r === 'die' ? 'Die shop' : r === 'machine' ? 'Maintenance' : 'Production')
