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
  /** 'archive' = Weekly KPI_fix, 'weekly' = Weekly KPI. */
  source: v.optional(v.union(v.literal('archive'), v.literal('weekly'))),
}

export const monthlyFields = {
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

/** Gün × iş merkezi kayıp özeti. Alan adı olarak serbest metin kullanılmaz: diziler. */
export const lossDayFields = {
  date: v.string(),
  costCenter: v.string(),
  workCenter: v.string(),
  /** [grup, dakika, adet] */
  groups: v.array(v.array(v.union(v.string(), v.number()))),
  /** [neden (EN), dakika, adet, grup] */
  reasons: v.array(v.array(v.union(v.string(), v.number()))),
}
