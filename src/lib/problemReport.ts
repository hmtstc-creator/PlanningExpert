// Kalıp problemlerinin raporlanabilir hâli.
//
// "Hangi kalıp hangi tarihte hangi problemi yaşadı" sorusunun cevabı ham
// kayıt listesi değil, gruplanmış sayılardır. Saf fonksiyon: test edilebilir
// ve ekrandan bağımsız.

export interface ProblemRow {
  material: string
  operation: string
  problemType: string
  occurredAt: string
  status: string
  downtimeMinutes?: number
}

export interface ProblemGroup {
  key: string
  count: number
  open: number
  downtimeMinutes: number
  /** En son yaşandığı tarih. */
  lastSeen: string
}

function group(rows: ProblemRow[], keyOf: (row: ProblemRow) => string): ProblemGroup[] {
  const map = new Map<string, ProblemGroup>()
  for (const row of rows) {
    const key = keyOf(row)
    const entry = map.get(key) ?? {
      key,
      count: 0,
      open: 0,
      downtimeMinutes: 0,
      lastSeen: row.occurredAt,
    }
    entry.count++
    if (row.status === 'open') entry.open++
    entry.downtimeMinutes += row.downtimeMinutes ?? 0
    if (row.occurredAt > entry.lastSeen) entry.lastSeen = row.occurredAt
    map.set(key, entry)
  }
  // En çok tekrarlayan başta; eşitlikte en son yaşanan başta.
  return Array.from(map.values()).sort(
    (a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen),
  )
}

export function byMold(rows: ProblemRow[]): ProblemGroup[] {
  return group(rows, (r) => r.material)
}

export function byProblemType(rows: ProblemRow[]): ProblemGroup[] {
  return group(rows, (r) => r.problemType)
}

export function byOperation(rows: ProblemRow[]): ProblemGroup[] {
  return group(rows, (r) => r.operation)
}

/**
 * Verilen tarih aralığındaki kayıtlar; sınırlar dahildir.
 *
 * Jenerik: çağıran taraf kendi satır tipini geri alsın, yalnızca rapor için
 * gereken alanlara indirgenmesin.
 */
export function inRange<T extends ProblemRow>(rows: T[], from: string, to: string): T[] {
  if (from && to && from > to) return []
  return rows.filter(
    (row) => (!from || row.occurredAt >= from) && (!to || row.occurredAt <= to),
  )
}
