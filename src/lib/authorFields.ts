/**
 * "Kim yaptı" alanları sunucuda oturumdan yazılır: tarayıcının gönderdiği ad
 * yok sayılır (yoksa biri başkasının adıyla arıza bildirebilir, kalıbı
 * "hazır" işaretleyebilirdi). convex/guarded.ts → guardedMutation her yazmada
 * uygular; yalnızca işlevin args'ında tanımlı alanlar doldurulur.
 */
export const AUTHOR_FIELDS = [
  'author',
  'reportedBy',
  'solvedBy',
  'closedBy',
  'reopenedBy',
  'createdBy',
  'updatedBy',
  'completedBy',
  'uploadedBy',
] as const

export function stampAuthor<A extends Record<string, unknown>>(declared: Record<string, unknown> | undefined, args: A, userName: string): A {
  if (!declared) return args
  const out: Record<string, unknown> = { ...args }
  for (const f of AUTHOR_FIELDS) if (f in declared) out[f] = userName
  return out as A
}
