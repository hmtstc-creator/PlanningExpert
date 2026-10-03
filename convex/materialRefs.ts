/**
 * Malzeme (parça / kalıp) kodunun bağlı olduğu kayıtlar. Kalıp bakımı,
 * problemleri, hazırlığı, alarmları, plan müdahaleleri ve eş ürün bağı
 * parçaya malzeme koduyla bağlıdır. Kullanımdaki parça silinmez ve kodu
 * değiştirilmez — geçmiş sahipsiz kalmasın. `db` fabrikaya kilitlidir.
 * SAP yüklemeleri (talep, stok, MB51) kapsam dışıdır: onlar SAP'nin verisidir.
 */
import type { Usage } from './workCenterRefs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const BY_MATERIAL: { table: string; label: string }[] = [
  { table: 'moldMaintenance', label: 'die maintenance' },
  { table: 'moldProblems', label: 'die problems' },
  { table: 'moldReadiness', label: 'die readiness' },
  { table: 'moldAlarms', label: 'die alarms' },
  { table: 'planOverrides', label: 'plan overrides' },
]

export async function materialUsage(db: Any, code: string): Promise<Usage[]> {
  const out: Usage[] = []
  for (const t of BY_MATERIAL) {
    const n = (await db.query(t.table).withIndex('by_material', (q: Any) => q.eq('material', code)).collect()).length
    if (n) out.push({ label: t.label, count: n })
  }
  const co = ((await db.query('products').collect()) as Any[]).filter((p) => p.code !== code && p.coProduct?.trim() === code).length
  if (co) out.push({ label: 'co-product of other parts', count: co })
  return out
}

export function materialUsageText(code: string, usage: Usage[]): string {
  return `${code} is used in ${usage.map((u) => `${u.label} (${u.count})`).join(', ')}`
}
