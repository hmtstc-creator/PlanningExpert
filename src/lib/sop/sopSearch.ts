// SOP listesinde arama (kullanıcı 2026-10-31): başlık (operasyon adı) ve kod
// (parça kodu, SOP numarası) üzerinde, büyük-küçük harf ve Türkçe ı/i farkı olmadan.

export interface SearchableSop {
  operation: string
  reference: string
  sopNo: string
}

const norm = (s: string) => (s ?? '').toLocaleLowerCase('tr-TR').trim()

export function matchesSop(row: SearchableSop, query: string): boolean {
  const q = norm(query)
  if (!q) return true
  return [row.operation, row.reference, row.sopNo].some((field) => norm(field).includes(q))
}

export function filterSops<T extends SearchableSop>(rows: readonly T[], query: string): T[] {
  return rows.filter((r) => matchesSop(r, query))
}
