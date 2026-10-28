/**
 * Stok kapsaması (Demand sayfası): mevcut stok, gecikmiş ihtiyaçtan başlayarak
 * dönem dönem birikimli ihtiyacı karşıladığı sürece o dönem "kapsanmış" sayılır.
 * İhtiyaç negatif sayıdır (ZPP / ZPP_DAILY net ihtiyaç); pozitif değerler ihtiyaç
 * değildir ve yok sayılır. Bir dönem açık verince sonrakiler de kapsanmaz; stok
 * yoksa hiçbir dönem kapsanmış sayılmaz.
 *
 * Örnek: stok 30 196, ihtiyaç [0, -6 174, -3 000, -6 750, 0, -3 000, -12 000]
 *   → birikimli 0, 6 174, 9 174, 15 924, 15 924, 18 924, 30 924
 *   → [true, true, true, true, true, true, false]
 */
export function stockCoverage(stock: number, overdue: number, qtys: readonly number[]): boolean[] {
  let need = Math.max(0, -Math.min(0, overdue))
  const available = Math.max(0, stock)
  if (available === 0) return qtys.map(() => false)
  return qtys.map((q) => {
    need += Math.max(0, -q)
    return need <= available
  })
}
