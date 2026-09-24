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

/** Her problem kaydının (kalıp ya da makine) raporda kullanılan ortak alanları. */
export interface BaseProblem {
  occurredAt: string
  status: string
  downtimeMinutes?: number
}

/** Kayıtları bir anahtara göre gruplar: sayı, açık sayısı, duruş, son görülme. */
export function groupBy<T extends BaseProblem>(rows: T[], keyOf: (row: T) => string): ProblemGroup[] {
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

const group = (rows: ProblemRow[], keyOf: (row: ProblemRow) => string) => groupBy(rows, keyOf)

export interface ParetoBar {
  key: string
  value: number
  /** Toplamın yüzdesi. */
  share: number
  /** Bu çubuk dahil kümülatif yüzde. */
  cumulative: number
  /** Toplamın ilk %80'ini oluşturan "önemli azınlık"tan mı? */
  vital: boolean
}

/**
 * Pareto: değere göre büyükten küçüğe, kümülatif yüzdeyle. Toplamın ilk
 * %80'ine ulaşan çubuklar (ulaştıran dahil) "vital" işaretlenir — üzerine
 * gidilecek olanlar onlardır.
 */
export function pareto(groups: { key: string; value: number }[]): ParetoBar[] {
  const sorted = groups.filter((g) => g.value > 0).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
  const total = sorted.reduce((sum, g) => sum + g.value, 0)
  let running = 0
  let reached = false
  return sorted.map((g) => {
    running += g.value
    const cumulative = total > 0 ? (running / total) * 100 : 0
    const vital = !reached
    if (cumulative >= 80 - 1e-9) reached = true
    return { key: g.key, value: g.value, share: total > 0 ? (g.value / total) * 100 : 0, cumulative, vital }
  })
}

/** İki boyutlu sayım: satır (ör. kalıp) × sütun (ör. problem tipi). */
export function crossTab<T>(
  rows: T[],
  rowKey: (row: T) => string,
  colKey: (row: T) => string,
): { rows: string[]; cols: string[]; count: (r: string, c: string) => number; rowTotal: (r: string) => number } {
  const cells = new Map<string, number>()
  const rowTotals = new Map<string, number>()
  const colTotals = new Map<string, number>()
  for (const row of rows) {
    const r = rowKey(row)
    const c = colKey(row)
    cells.set(`${r}\u0000${c}`, (cells.get(`${r}\u0000${c}`) ?? 0) + 1)
    rowTotals.set(r, (rowTotals.get(r) ?? 0) + 1)
    colTotals.set(c, (colTotals.get(c) ?? 0) + 1)
  }
  const byTotal = (m: Map<string, number>) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k)
  return {
    rows: byTotal(rowTotals),
    cols: byTotal(colTotals),
    count: (r, c) => cells.get(`${r}\u0000${c}`) ?? 0,
    rowTotal: (r) => rowTotals.get(r) ?? 0,
  }
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
export function inRange<T extends BaseProblem>(rows: T[], from: string, to: string): T[] {
  if (from && to && from > to) return []
  return rows.filter(
    (row) => (!from || row.occurredAt >= from) && (!to || row.occurredAt <= to),
  )
}
