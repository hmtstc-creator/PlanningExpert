import { isoWeeksInYear, type KpiPeriod } from '../lib/kpi'
import { isoWeek } from '../lib/oee'

/** Ay ve yıl ya da ISO hafta ve yıl seçimi. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export interface Slot {
  year: number
  num: number
}

/** Varsayılan: bu ay / bu ISO hafta. */
export function defaultSlot(period: KpiPeriod, now = new Date()): Slot {
  if (period === 'month') return { year: now.getFullYear(), num: now.getMonth() + 1 }
  const w = isoWeek(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
  return { year: w.year, num: w.week }
}

const sel = 'mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground'

export function KpiPeriodPicker({ period, value, onChange }: { period: KpiPeriod; value: Slot; onChange: (s: Slot) => void }) {
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 8 }, (_, i) => thisYear - 5 + i)
  const weeks = isoWeeksInYear(value.year)
  return (
    <div className="flex items-end gap-2 text-xs text-muted-foreground">
      <label>
        Year
        <select className={sel} value={value.year} onChange={(e) => onChange({ year: Number(e.target.value), num: Math.min(value.num, period === 'week' ? isoWeeksInYear(Number(e.target.value)) : 12) })}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label>
        {period === 'month' ? 'Month' : 'Week'}
        <select className={sel} value={value.num} onChange={(e) => onChange({ ...value, num: Number(e.target.value) })}>
          {period === 'month'
            ? MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))
            : Array.from({ length: weeks }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  W{i + 1}
                </option>
              ))}
        </select>
      </label>
    </div>
  )
}
