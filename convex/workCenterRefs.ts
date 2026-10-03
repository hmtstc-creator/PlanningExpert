/**
 * Work center kodunun (ör. PRS-106; SAP iş yeri kodu) bağlı olduğu yerler.
 *
 * Kayıtlar work center'a kodla bağlıdır (SAP'deki gibi). Bütünlük burada
 * korunur: kullanımdaki work center silinmez, kod değişikliği bütün bağlı
 * kayıtlara birlikte yazılır. `db` fabrikaya kilitli veritabanıdır
 * (convex/plantDb.ts) — yalnızca seçili plant'in kayıtları.
 *
 * Kapsam dışı (geçmiş, değişmez): yüklenen OEE verisi (SAP dosyasındaki kod
 * olduğu gibi kalır) ve plan arşivi (planSnapshots).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const PRODUCT_FIELDS = ['mainMachine', 'altMachine1', 'altMachine2', 'altMachine3', 'altMachine4'] as const

/** Tek alanı `press` olan, by_press önekli indeksi bulunan tablolar. */
const PRESS_TABLES: { table: string; index: string; label: string }[] = [
  { table: 'pressTemplates', index: 'by_press', label: 'Work Calendar pattern' },
  { table: 'pressOvertime', index: 'by_press_date', label: 'overtime' },
  { table: 'pressWeekOverrides', index: 'by_press_week', label: 'exception weeks' },
  { table: 'pressMaintenance', index: 'by_press', label: 'maintenance' },
  { table: 'machineProblems', index: 'by_press', label: 'breakdowns' },
  { table: 'pressPlanStarts', index: 'by_press', label: 'plan start' },
]

async function pressRows(db: Any, table: string, index: string, name: string): Promise<Any[]> {
  return db
    .query(table)
    .withIndex(index, (q: Any) => q.eq('press', name))
    .collect()
}

export interface Usage {
  label: string
  count: number
}

/** Work center'ın kullanıldığı yerler (yalnızca sayısı olanlar). */
export async function whereUsed(db: Any, name: string): Promise<Usage[]> {
  const out: Usage[] = []
  const products: Any[] = await db.query('products').collect()
  const parts = products.filter((p) => PRODUCT_FIELDS.some((f) => p[f]?.trim() === name)).length
  if (parts) out.push({ label: `master data (${parts === 1 ? '1 part' : `${parts} parts`})`, count: parts })
  for (const t of PRESS_TABLES) {
    const n = (await pressRows(db, t.table, t.index, name)).length
    if (n) out.push({ label: t.label, count: n })
  }
  const overrides = ((await db.query('planOverrides').collect()) as Any[]).filter((o) => o.press?.trim() === name).length
  if (overrides) out.push({ label: 'plan pins', count: overrides })
  const crane = ((await db.query('craneGroups').collect()) as Any[]).filter((g) => g.machines.includes(name)).length
  if (crane) out.push({ label: 'crane groups', count: crane })
  return out
}

export function usageText(name: string, usage: Usage[]): string {
  return `${name} is still used in ${usage.map((u) => (u.label.includes('(') ? u.label : `${u.label} (${u.count})`)).join(', ')}`
}

/** Kodu bütün bağlı kayıtlarda değiştirir; değişen kayıt sayısını döner. */
export async function renameEverywhere(db: Any, from: string, to: string): Promise<number> {
  let changed = 0
  for (const p of (await db.query('products').collect()) as Any[]) {
    const patch: Any = {}
    for (const f of PRODUCT_FIELDS) if (p[f]?.trim() === from) patch[f] = to
    if (Object.keys(patch).length) {
      await db.patch(p._id, patch)
      changed++
    }
  }
  for (const t of PRESS_TABLES) {
    for (const r of await pressRows(db, t.table, t.index, from)) {
      await db.patch(r._id, { press: to })
      changed++
    }
  }
  for (const o of (await db.query('planOverrides').collect()) as Any[]) {
    if (o.press?.trim() === from) {
      await db.patch(o._id, { press: to })
      changed++
    }
  }
  for (const g of (await db.query('craneGroups').collect()) as Any[]) {
    if (g.machines.includes(from)) {
      await db.patch(g._id, { machines: g.machines.map((m: string) => (m === from ? to : m)) })
      changed++
    }
  }
  return changed
}
