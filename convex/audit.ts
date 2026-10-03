/**
 * Platform denetim kaydı (todolist.md 4.3): holding, şirket, plant, bölüm,
 * masraf yeri, kullanıcı, grup, parola ve giriş kilidi işlemleri. Fabrika
 * değişiklik kaydından (changeLog) ayrıdır: fabrikaya değil şirkete /
 * holding'e bağlıdır, silinmez, ekrandan değiştirilemez.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export interface AuditEntry {
  /** İşlemi yapan (oturumdaki kullanıcı adı). */
  actor?: string
  /** Kısa işlem adı, ör. "user.update", "company.suspend". */
  action: string
  /** Ne üzerinde: kullanıcı, şirket, plant adı … */
  target: string
  /** Eski → yeni değerler, okunur metin. */
  detail?: string
  companyId?: string
  holdingId?: string
}

export async function audit(db: Any, e: AuditEntry): Promise<void> {
  await db.insert('auditLog', {
    at: Date.now(),
    action: e.action,
    target: e.target,
    ...(e.actor ? { actor: e.actor } : {}),
    ...(e.detail ? { detail: e.detail } : {}),
    ...(e.companyId ? { companyId: e.companyId } : {}),
    ...(e.holdingId ? { holdingId: e.holdingId } : {}),
  })
}

/** "alan: eski → yeni" listesi; değişmeyen alan yazılmaz. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const show = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') || '—' : String(v))
  const out: string[] = []
  for (const k of Object.keys(after)) {
    if (show(before[k]) !== show(after[k])) out.push(`${k}: ${show(before[k])} → ${show(after[k])}`)
  }
  return out.join('; ')
}
