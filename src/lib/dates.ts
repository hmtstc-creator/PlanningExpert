// Date helpers shared by the planning layer and the pages.
//
// These must use LOCAL date parts, never toISOString(). A plant east of UTC
// (Türkiye is UTC+3) has local midnight fall on the previous UTC day, so
// `new Date(2026, 8, 14).toISOString().slice(0, 10)` returns 2026-09-13.
// That shifted every planned date one day back and made holiday matching miss.

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

/** Monday of the week containing `date`, at local midnight. */
export function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0 = Sunday
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * ISO 8601 week number.
 *
 * Week 1 is the week containing the first Thursday of the year, so the week
 * number is derived from that week's Thursday rather than from 1 January.
 * A date in early January can therefore belong to week 52 or 53 of the
 * previous year, and late December can belong to week 1 of the next.
 */
export function isoWeek(date: Date): number {
  const thursday = isoThursdayOf(date)
  const firstThursday = isoThursdayOf(new Date(thursday.getFullYear(), 0, 4))
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / msPerWeek)
}

/** The year the ISO week belongs to, which can differ from the calendar year. */
export function isoWeekYear(date: Date): number {
  return isoThursdayOf(date).getFullYear()
}

/** "2026-W38" */
export function isoWeekLabel(date: Date): string {
  return `${isoWeekYear(date)}-W${String(isoWeek(date)).padStart(2, '0')}`
}

/** Thursday of the ISO week containing `date`, at local midnight. */
function isoThursdayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const mondayBased = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - mondayBased + 3)
  return d
}
