// OEE açık konular ajanı (planlamacı, 2026-10-23): OEE verisi yüklenince son
// yüklü günü bir kez inceler; masraf yeri × iş yeri × kayıp grubu bazında o gün
// büyük kaybı olan konuları seçer, geçmiş haftalarla "gerçekten kronik ve kritik
// mi?" diye tartar ve OEE açık konular listesine ekler. Karar: yapay zekâ (varsa)
// ya da kurallar. Aynı konu açıkken yeniden yazılmaz, yalnızca "son görüldü"
// güncellenir. Kararlar: docs/oee-agent-report.md → OEE open topics.

import { addDaysIso, baseCode, costCenterName, groupLabel, type DayRow, type LossDay, type OeeConfig } from './oee'
import type { StopDay } from './oeeReliability'
import { splitShortStops } from './oeeShortStops'

export interface TopicThresholds {
  /** O gün bu kadar dakika kayıp → aday. */
  dayMin: number
  /** Bir haftanın (7 gün) bu konuda "kayıplı" sayılması için en az dakika. */
  weekMin: number
  /** Geriye bakılan hafta sayısı (bugünkü hafta hariç). */
  lookbackWeeks: number
  /** Kronik: geçmiş haftaların en az bu kadarı kayıplı. */
  chronicWeeks: number
  /** Yapay zekâya gönderilen en çok yeni aday (etkiye göre). */
  maxCandidates: number
}

export const TOPIC_DEFAULTS: TopicThresholds = {
  dayMin: 60,
  weekMin: 120,
  lookbackWeeks: 6,
  chronicWeeks: 3,
  maxCandidates: 12,
}

/** Gün × iş yeri: yükleme ve kayıp grubu (Reason Code 2) başına dakika. */
export interface GroupDay {
  date: string
  costCenter: string
  workCenter: string
  loadingMin: number
  groups: Record<string, number>
}

/**
 * Gün ve kayıp özetini sıkıştırır: yalnızca kayıp sayılan (Reason Code 1
 * kayıp listesinde) ve sebebi girilmiş (Reason Code 2 ≠ "#") duruşlar.
 * Süre histogramı (`stops`) verilirse aynı kod ikiye bölünür (oeeShortStops.ts):
 * < eşik duruşlar `ARZ<` ayrı konudur (hız kaybı), ≥ eşik `ARZ` kullanılabilirlik.
 */
export function compactDays(days: DayRow[], rawLosses: LossDay[], c: OeeConfig, stops?: StopDay[]): GroupDay[] {
  const losses = stops ? splitShortStops(rawLosses, stops, c).lossDays : rawLosses
  const map = new Map<string, GroupDay>()
  const at = (date: string, costCenter: string, workCenter: string) => {
    const key = `${date}|${workCenter}`
    let row = map.get(key)
    if (!row) map.set(key, (row = { date, costCenter, workCenter, loadingMin: 0, groups: {} }))
    if (!row.costCenter) row.costCenter = costCenter
    return row
  }
  for (const d of days) at(d.date, d.costCenter, d.workCenter).loadingMin += d.loadingMin
  for (const l of losses) {
    const row = at(l.date, l.costCenter, l.workCenter)
    for (const [k, [min]] of Object.entries(l.codes)) {
      const [rc1, rc2] = k.split('|')
      if (!rc2 || baseCode(rc2) === '#' || !c.lossReasonCodes.includes(rc1)) continue
      row.groups[rc2] = (row.groups[rc2] ?? 0) + min
    }
  }
  return [...map.values()]
}

export interface TopicCandidate {
  /** masraf yeri | iş yeri | kayıp grubu */
  key: string
  costCenter: string
  costCenterName: string
  workCenter: string
  group: string
  groupLabel: string
  todayMin: number
  loadingMin: number
  /** Haftalık kayıp, [0] = bu hafta (gün − 6 … gün), sonra geriye doğru. */
  weeks: number[]
  /** Geçmiş haftalardan kayıplı olanların sayısı. */
  pastHits: number
  /** Geçmiş haftaların ortalaması (dk). */
  pastAvgMin: number
  /** Kuralların kararı: kronik ve kritik → listeye eklenir. */
  ruleAdd: boolean
  /** Aynı anahtarla açık konu var: yeniden yazılmaz. */
  open: boolean
}

export const topicKey = (costCenter: string, workCenter: string, group: string) => `${costCenter}|${workCenter}|${group}`

/**
 * Günün adayları. Aday: o gün ≥ dayMin kayıp ve geçmiş haftalardan en az biri
 * kayıplı. Kural kararı (yapay zekâ yoksa): geçmişin ≥ chronicWeeks haftası
 * kayıplı (kronik) ve bu haftanın kaybı ≥ weekMin ve geçmiş ortalamadan az
 * değil (azalmıyor → kritik). Sıra: bu haftanın kaybı.
 */
export function topicCandidates(
  day: string,
  rows: GroupDay[],
  c: OeeConfig,
  openKeys: Set<string>,
  t: TopicThresholds = TOPIC_DEFAULTS,
): TopicCandidate[] {
  const weekOf = (date: string) => {
    const back = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000)
    return back < 0 ? -1 : Math.floor(back / 7)
  }
  // iş yeri | grup → haftalık dakika
  const series = new Map<string, number[]>()
  for (const r of rows) {
    const w = weekOf(r.date)
    if (w < 0 || w > t.lookbackWeeks) continue
    for (const [g, min] of Object.entries(r.groups)) {
      const k = `${r.workCenter}|${g}`
      const s = series.get(k) ?? series.set(k, Array(t.lookbackWeeks + 1).fill(0)).get(k)!
      s[w] += min
    }
  }
  const out: TopicCandidate[] = []
  for (const r of rows) {
    if (r.date !== day) continue
    for (const [g, todayMin] of Object.entries(r.groups)) {
      if (todayMin < t.dayMin) continue
      const weeks = series.get(`${r.workCenter}|${g}`)!.map((m) => Math.round(m))
      const past = weeks.slice(1)
      const pastHits = past.filter((m) => m >= t.weekMin).length
      if (!pastHits) continue
      const pastAvgMin = Math.round(past.reduce((a, m) => a + m, 0) / past.length)
      const key = topicKey(r.costCenter, r.workCenter, g)
      out.push({
        key,
        costCenter: r.costCenter,
        costCenterName: costCenterName(r.costCenter, c),
        workCenter: r.workCenter,
        group: g,
        groupLabel: groupLabel(g, c),
        todayMin: Math.round(todayMin),
        loadingMin: Math.round(r.loadingMin),
        weeks,
        pastHits,
        pastAvgMin,
        ruleAdd: pastHits >= t.chronicWeeks && weeks[0] >= t.weekMin && weeks[0] >= pastAvgMin,
        open: openKeys.has(key),
      })
    }
  }
  return out.sort((a, b) => b.weeks[0] - a.weeks[0] || b.todayMin - a.todayMin || a.key.localeCompare(b.key))
}

const dur = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`)

/** Kanıt: sayılar (kural ve yapay zekâ kararında aynı). */
export function evidenceOf(x: TopicCandidate): string {
  const share = x.loadingMin > 0 ? ` (${Math.round((x.todayMin / x.loadingMin) * 100)}% of loading)` : ''
  return (
    `Today ${dur(x.todayMin)}${share}. Last 7 days ${dur(x.weeks[0])}; ` +
    `lost time in ${x.pastHits} of the ${x.weeks.length - 1} weeks before, average ${dur(x.pastAvgMin)} a week. ` +
    `Weekly, newest first: ${x.weeks.map((m) => Math.round(m)).join(' · ')} min.`
  )
}

export const ruleTitle = (x: TopicCandidate) =>
  `${x.workCenter} · ${x.groupLabel}: chronic loss in ${x.pastHits} of the last ${x.weeks.length - 1} weeks`

// ---- yapay zekâ ---------------------------------------------------------------------

export interface AiVerdict {
  add: boolean
  title: string
  analysis: string
  action: string
}

export const AI_SYSTEM = [
  'You are an OEE analyst in a metal stamping plant. You get loss topics of one day:',
  'cost center, work center, loss group, today\'s lost minutes and the lost minutes of the',
  'last weeks (newest first). Decide for each topic whether it is really CHRONIC (it keeps',
  'coming back over the weeks, not a one-off) AND CRITICAL (big enough and not getting',
  'better). Only such topics go to the open topics list. Be strict: one bad week is not',
  'chronic, a clearly falling trend is not critical. Use only the numbers given.',
  'Answer with JSON only: {"topics":[{"key":"…","add":true|false,"title":"one short',
  'sentence","analysis":"two or three sentences with the numbers","action":"what to check',
  'or do first, one sentence"}]}. Write in English. Keep every key exactly as given.',
].join(' ')

/** Yapay zekâya giden istek gövdesi (yalnız sayılar ve adlar; kişi verisi yok). */
export function aiUserMessage(day: string, xs: TopicCandidate[]): string {
  return JSON.stringify({
    day,
    weekStartsBack: 'weeks[0] = the 7 days ending on day, weeks[1] = the 7 days before, …',
    topics: xs.map((x) => ({
      key: x.key,
      costCenter: x.costCenterName,
      workCenter: x.workCenter,
      lossGroup: x.groupLabel,
      todayMin: x.todayMin,
      loadingMinToday: x.loadingMin,
      weeksMin: x.weeks,
    })),
  })
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '')

/**
 * Cevabı denetler: yalnızca sorulan anahtarlar, boş başlık yok. Bozuk cevap →
 * boş harita (kurallar karar verir).
 */
export function parseAiAnswer(text: string, keys: string[]): Map<string, AiVerdict> {
  const out = new Map<string, AiVerdict>()
  const body = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return out
  }
  const list = (data as { topics?: unknown })?.topics
  if (!Array.isArray(list)) return out
  const allowed = new Set(keys)
  for (const item of list) {
    const t = (item ?? {}) as Record<string, unknown>
    const key = t.key
    if (typeof key !== 'string' || !allowed.has(key) || out.has(key)) continue
    const title = clip(t.title, 160)
    if (typeof t.add !== 'boolean' || !title) continue
    out.set(key, { add: t.add, title, analysis: clip(t.analysis, 600), action: clip(t.action, 300) })
  }
  return out
}

export interface TopicDecision {
  candidate: TopicCandidate
  title: string
  analysis: string
  action: string
  evidence: string
  source: 'ai' | 'rules'
}

/**
 * Yeni (açık olmayan) adaylardan listeye eklenecekler: yapay zekânın kararı
 * varsa o, yoksa kuralların kararı.
 */
export function decideTopics(candidates: TopicCandidate[], ai: Map<string, AiVerdict> | null): TopicDecision[] {
  const out: TopicDecision[] = []
  for (const x of candidates) {
    if (x.open) continue
    const v = ai?.get(x.key)
    if (v ? !v.add : !x.ruleAdd) continue
    out.push({
      candidate: x,
      title: v?.title || ruleTitle(x),
      analysis: v?.analysis ?? '',
      action: v?.action ?? '',
      evidence: evidenceOf(x),
      source: v ? 'ai' : 'rules',
    })
  }
  return out
}

/** Bir haftanın ilk günü (gün − 7k − 6) ve son günü: veri haftalık parçalarla okunur. */
export const weekWindow = (day: string, k: number) => ({ from: addDaysIso(day, -7 * k - 6), to: addDaysIso(day, -7 * k) })

// ---- hangi gün, ne zaman --------------------------------------------------------------

export interface TopicRunState {
  status: string
  startedAt: number
  /** Çalışmanın başladığı an fabrika saatiyle tarih (YYYY-MM-DD). */
  startedDate: string
}

/** 'running' bu kadar eskiyse yarıda kalmış sayılır (yeniden denenir). */
export const STALE_RUN_MS = 15 * 60_000

/**
 * Gün incelenmeli mi? Yalnızca kapanmış gün (bugünden önce, fabrika saati)
 * incelenir: gün içindeki yarım yükleme günü "yapıldı" saydırmaz. Önceki
 * çalışma gün kapanmadan başladıysa (yarım veriyle), başarısızsa ya da
 * yarıda kaldıysa gün yeniden incelenir; aksi hâlde bir kez.
 */
export function shouldRun(day: string, today: string, run: TopicRunState | null, now: number): boolean {
  if (day >= today) return false
  if (!run) return true
  if (run.status === 'failed') return true
  if (run.status === 'running') return now - run.startedAt > STALE_RUN_MS
  return run.startedDate <= day
}
