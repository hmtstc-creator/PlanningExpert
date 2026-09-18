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
