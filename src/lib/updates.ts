// Portal ana sayfasındaki "Updates" paneli (docs/updates.md): oturum açan
// kişi son gelişmeleri ve verinin ne zaman yayınlandığını görür.
//
//   What's new    son günlerin olayları: Die / Machine konuları açıldı-çözüldü,
//                 plan hesaplandı-onaylandı, SAP ve OEE verisi yüklendi
//   Latest data   her kaynağın son yayın anı, kişisi, kapsadığı dönem
//
// Saf hesap: sunucu (convex/updates.ts) yalnızca kişinin okuyabildiği
// modüllerin kayıtlarını verir; hangi satırın nasıl yazılacağı burada
// (test: updates.test.ts). Eskime eşikleri Today'inkilerdir.

import { ageText, type TodayThresholds } from './cockpit'
import { SAP_UPLOAD_LABELS, type SapUpload, type SapUploadKey } from './sapUploads'
import type { Module } from './tenancy'

/** Akışın geriye baktığı gün sayısı (docs/fixeddefinitions.md #40). */
export const FEED_WINDOW_DAYS = 7
/** Akışta en çok kaç olay (docs/fixeddefinitions.md #41). */
export const FEED_LIMIT = 12
/** Plan onayının Change Log başlığı — convex/planSnapshots.ts yazar, convex/updates.ts arar. */
export const PLAN_APPROVED_TITLE = 'Plan approved'

/** Die ya da Machine takip konusu (moldProblems / machineProblems). */
export interface TopicRecord {
  id: string
  /** Kalıp: "malzeme operasyon"; makine: pres. */
  subject: string
  problemType: string
  reportedAt: number
  reportedBy?: string
  status: string
  solvedAt?: number
  solvedBy?: string
  solution?: string
  /** Kalıp konusunda duruşun presi (Loss Bridge'den açılan konu). */
  press?: string
  /** Yapılacak iş (Loss Bridge'den açılan konu). */
  action?: string
  /** Makine arızası: pres duruyor mu. */
  stopsPress?: boolean
}

export interface UpdatesInput {
  now: number
  /** Planlama modülü yoksa undefined. computedAt null = henüz plan yok. */
  plan?: {
    computedAt: number | null
    dataChangedAt: number | null
    approvedAt?: number | null
    approvedBy?: string
  }
  /** SAP dosyalarının son yüklemesi (convex/sapUploads.ts currentUploads); izin yoksa undefined. */
  sap?: SapUpload[]
  /** OEE modülü yoksa undefined. imports: yeniden eskiye. dataTo: yüklü verinin son günü. */
  oee?: {
    imports: { fileName: string; uploadedAt: number; uploadedBy?: string }[]
    dataTo: string | null
  }
  dieTopics?: TopicRecord[]
  breakdowns?: TopicRecord[]
}

/** fresh: güncel · stale: eşikten eski ya da plan güncel değil · missing: hiç yok · info: eşiği yok. */
export type FreshnessState = 'fresh' | 'stale' | 'missing' | 'info'

export interface FreshnessRow {
  key: string
  module: Module
  label: string
  /** Son yayın anı; null = hiç. */
  at: number | null
  by?: string
  detail?: string
  state: FreshnessState
  to: string
}

export interface FeedItem {
  key: string
  module: Module
  at: number
  title: string
  detail?: string
  by?: string
  to: string
}

const hours = (ms: number) => ms / 3_600_000

/** Today'in eşiği olan SAP dosyaları: plan bunlarla kurulur. */
const SAP_REQUIRED: SapUploadKey[] = ['weeklyDemand', 'stock']

const coverText = (u: SapUpload) =>
  u.coversFrom ? (u.coversFrom === u.coversTo || !u.coversTo ? `covers ${u.coversFrom}` : `covers ${u.coversFrom} → ${u.coversTo}`) : undefined

const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ') || undefined

/** "Latest data": izinli her kaynağın son yayını ve tazeliği. */
export function buildFreshness(input: UpdatesInput, t: TodayThresholds): FreshnessRow[] {
  const { now } = input
  const rows: FreshnessRow[] = []

  if (input.plan) {
    const { computedAt, dataChangedAt } = input.plan
    const changed = computedAt !== null && (dataChangedAt ?? 0) > computedAt
    const old = computedAt !== null && hours(now - computedAt) > t.planStaleHours
    rows.push({
      key: 'plan',
      module: 'planning',
      label: 'Production plan — calculated',
      at: computedAt,
      state: computedAt === null ? 'missing' : changed || old ? 'stale' : 'fresh',
      detail:
        computedAt === null
          ? 'No plan yet — press Calculate plan on Planning'
          : changed
            ? `Data changed ${ageText(now - (dataChangedAt ?? now))} ago, after the calculation`
            : old
              ? `Older than ${t.planStaleHours} h — the plan is calculated by hand`
              : undefined,
      to: '/planlama',
    })
    if (input.plan.approvedAt) {
      rows.push({ key: 'planApproved', module: 'planning', label: 'Production plan — approved', at: input.plan.approvedAt, by: input.plan.approvedBy, state: 'info', to: '/planlama' })
    }
  }

  if (input.sap) {
    const byKey = new Map(input.sap.map((u) => [u.key, u]))
    for (const key of Object.keys(SAP_UPLOAD_LABELS) as SapUploadKey[]) {
      const u = byKey.get(key)
      const required = SAP_REQUIRED.includes(key)
      // İsteğe bağlı dosya hiç yüklenmediyse satır yok (her plant kullanmaz).
      if (!u?.uploadedAt && !required) continue
      const at = u?.uploadedAt || null
      rows.push({
        key: `sap.${key}`,
        module: 'planning',
        label: SAP_UPLOAD_LABELS[key],
        at,
        by: u?.uploadedBy,
        detail: u ? join(u.fileName, coverText(u)) : 'Never uploaded',
        state: !at ? 'missing' : required ? (hours(now - at) > t.sapStaleHours ? 'stale' : 'fresh') : 'info',
        to: '/sapdata',
      })
    }
  }

  if (input.oee) {
    const last = input.oee.imports[0]
    rows.push({
      key: 'oee',
      module: 'oee',
      label: 'OEE data',
      at: last?.uploadedAt ?? null,
      by: last?.uploadedBy,
      detail: last || input.oee.dataTo ? join(input.oee.dataTo ? `data through ${input.oee.dataTo}` : undefined, last?.fileName) : 'Never uploaded',
      state: last ? 'info' : 'missing',
      to: '/oee/data',
    })
  }

  return rows
}

/** "What's new": penceredeki olaylar, yeniden eskiye, en çok `limit`. */
export function buildFeed(input: UpdatesInput, windowDays = FEED_WINDOW_DAYS, limit = FEED_LIMIT): FeedItem[] {
  const since = input.now - windowDays * 24 * 3_600_000
  const items: FeedItem[] = []

  for (const d of input.dieTopics ?? []) {
    items.push({
      key: `die.${d.id}`,
      module: 'die',
      at: d.reportedAt,
      title: `New die topic — ${d.subject}`,
      detail: join(d.press ? `${d.problemType} on ${d.press}` : d.problemType, d.action && `Action: ${d.action}`),
      by: d.reportedBy,
      to: '/die-followup/problems',
    })
    if (d.status === 'solved' && d.solvedAt) {
      items.push({ key: `die.${d.id}.solved`, module: 'die', at: d.solvedAt, title: `Die topic solved — ${d.subject}`, detail: join(d.problemType, d.solution), by: d.solvedBy, to: '/die-followup/problems' })
    }
  }

  for (const b of input.breakdowns ?? []) {
    items.push({
      key: `machine.${b.id}`,
      module: 'machine',
      at: b.reportedAt,
      title: `Breakdown — ${b.subject}`,
      detail: join(b.problemType, b.stopsPress && 'work center stopped'),
      by: b.reportedBy,
      to: '/machine-followup/breakdowns',
    })
    if (b.status === 'solved' && b.solvedAt) {
      items.push({ key: `machine.${b.id}.solved`, module: 'machine', at: b.solvedAt, title: `Breakdown solved — ${b.subject}`, detail: join(b.problemType, b.solution), by: b.solvedBy, to: '/machine-followup/breakdowns' })
    }
  }

  if (input.plan?.computedAt) {
    items.push({ key: 'plan.calculated', module: 'planning', at: input.plan.computedAt, title: 'Plan calculated', to: '/planlama' })
  }
  if (input.plan?.approvedAt) {
    items.push({ key: 'plan.approved', module: 'planning', at: input.plan.approvedAt, title: 'Plan approved', by: input.plan.approvedBy, to: '/planlama' })
  }

  for (const u of input.sap ?? []) {
    if (!u.uploadedAt || u.legacy) continue
    items.push({
      key: `sap.${u.key}`,
      module: 'planning',
      at: u.uploadedAt,
      title: `${SAP_UPLOAD_LABELS[u.key]} uploaded`,
      detail: join(u.fileName, u.rowsImported !== undefined && `${u.rowsImported.toLocaleString('en-GB')} rows`, coverText(u)),
      by: u.uploadedBy,
      to: '/sapdata',
    })
  }

  for (const [n, i] of (input.oee?.imports ?? []).entries()) {
    items.push({ key: `oee.${i.uploadedAt}.${n}`, module: 'oee', at: i.uploadedAt, title: 'OEE data uploaded', detail: i.fileName, by: i.uploadedBy, to: '/oee/data' })
  }

  return items
    .filter((i) => i.at >= since && i.at <= input.now + 60_000)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}

/** Son ziyaretten sonraki olay sayısı; ilk ziyarette (lastSeen yok) 0. */
export function countNew(items: { at: number }[], lastSeen: number | null): number {
  return lastSeen === null ? 0 : items.filter((i) => i.at > lastSeen).length
}

/** Kayıtlı "son ziyaret" değeri: bozuk ya da elle değiştirilmişse yok sayılır. */
export function parseLastSeen(raw: string | null): number | null {
  const n = Number(raw)
  return raw && Number.isFinite(n) && n > 0 ? n : null
}
