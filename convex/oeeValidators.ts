import { v } from 'convex/values'

/**
 * OEE tablolarının alanları — şema ve işlevler aynı tanımı kullanır.
 * Alanların anlamı src/lib/oee.ts'teki tiplerde; sütun sırası ve kaynak
 * sayfalar docs/oeedashboard.md'de.
 */

export const timeFields = {
  good: v.number(),
  scrap: v.number(),
  reject: v.number(),
  scheduledMin: v.number(),
  unscheduledMin: v.number(),
  operatingMin: v.number(),
  productionMin: v.number(),
  loadingMin: v.number(),
  availability: v.number(),
  quality: v.number(),
  performance: v.number(),
  oee: v.number(),
}

export const shiftFields = {
  date: v.string(),
  plantKey: v.string(),
  responsible: v.string(),
  costCenter: v.string(),
  workCenter: v.string(),
  shiftGroup: v.string(),
  shiftDefinition: v.string(),
  ...timeFields,
}

export const orderFields = {
  date: v.string(),
  plant: v.string(),
  plantName: v.string(),
  workCenter: v.string(),
  shift: v.string(),
  order: v.string(),
  equipment: v.string(),
  material: v.string(),
  ...timeFields,
}

export const weeklyFields = {
  year: v.number(),
  week: v.number(),
  plantKey: v.string(),
  responsible: v.string(),
  costCenter: v.string(),
  workCenter: v.string(),
  scheduledSec: v.number(),
  ...timeFields,
  /** Hangi sayfadan geldiği (Weekly KPI / Weekly KPI_fix). */
  sheet: v.optional(v.string()),
  /** @deprecated eski yüklemelerden; okunmaz. */
  source: v.optional(v.union(v.literal('archive'), v.literal('weekly'))),
}

export const monthlyFields = {
  /** Dosyada yok; yüklemede tarihlerden çıkarılır. Eski kayıtlarda boş olabilir. */
  year: v.optional(v.number()),
  month: v.string(),
  monthKey: v.string(),
  plantKey: v.string(),
  responsible: v.string(),
  costCenter: v.string(),
  workCenter: v.string(),
  scheduledSec: v.number(),
  ...timeFields,
}

/**
 * Gün × iş merkezi duruşları. Satır sayısı çok (ayda ~30 000) olduğundan her
 * duruş bir dizi elemanı; sıra: order, material, mold, shiftGroup,
 * shiftDefinition, rc1…rc5, textEn, textTr, seconds, minutes, startDate,
 * startTime, endDate, endTime (src/lib/oeeStore.ts çevirir).
 */
export const downtimeDayFields = {
  date: v.string(),
  plant: v.string(),
  plantKey: v.string(),
  costCenter: v.string(),
  workCenter: v.string(),
  events: v.array(v.array(v.union(v.string(), v.number()))),
}

const cells = v.array(v.array(v.union(v.string(), v.number())))

/**
 * Gün × iş merkezi kayıp özeti, ham kodlarla (ayardan bağımsız). Alan adı
 * olarak serbest metin kullanılmaz: diziler.
 */
export const lossDayFields = {
  date: v.string(),
  costCenter: v.string(),
  workCenter: v.string(),
  /** [rc1, rc2, dakika, adet] */
  codes: v.optional(cells),
  /** [rc1, rc2, metin, dakika, adet] */
  reasonList: v.optional(cells),
  /** @deprecated ilk biçim; okunmaz. */
  groups: v.optional(cells),
  /** @deprecated ilk biçim; okunmaz. */
  reasons: v.optional(cells),
}

/** Daily KPI satırı (ilk kurulum geçmişi). */
export const dailyFields = {
  date: v.string(),
  plantKey: v.string(),
  responsible: v.string(),
  costCenter: v.string(),
  workCenter: v.string(),
  scheduledSec: v.number(),
  ...timeFields,
}

const plainTimes = {
  good: v.number(),
  scrap: v.number(),
  reject: v.number(),
  scheduledMin: v.number(),
  unscheduledMin: v.number(),
  operatingMin: v.number(),
  productionMin: v.number(),
  loadingMin: v.number(),
}

/** Gün × iş merkezi — hafta ve ay hesaplarının tabanı (vardiyalardan ya da Daily KPI). */
export const dayFields = {
  date: v.string(),
  plantKey: v.string(),
  responsible: v.string(),
  costCenter: v.string(),
  workCenter: v.string(),
  source: v.union(v.literal('shiftly'), v.literal('daily')),
  ...plainTimes,
}

/** OEE ayarları (src/lib/oee.ts OeeConfig). */
export const configFields = {
  areas: v.array(v.object({ name: v.string(), pick: v.union(v.literal('costCenter'), v.literal('machine')), startupRunMin: v.optional(v.number()) })),
  costCenters: v.array(v.object({ code: v.string(), name: v.string(), area: v.string() })),
  shifts: v.array(v.object({ code: v.string(), number: v.number() })),
  lossReasonCodes: v.array(v.string()),
  breakReasonCodes: v.array(v.string()),
  lossGroups: v.array(v.object({ code: v.string(), label: v.string(), chart: v.string(), breakdown: v.boolean(), hidden: v.optional(v.boolean()) })),
  setupTexts: v.array(v.object({ text: v.string(), kind: v.union(v.literal('planned'), v.literal('unplanned')) })),
  startupRunMin: v.number(),
  trendWeeks: v.number(),
  topN: v.number(),
}
