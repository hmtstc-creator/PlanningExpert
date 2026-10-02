/**
 * Fabrikanın ülkesi ve saat dilimi — tek kaynak fabrika kaydı (`plants`,
 * docs/plant-genisletme.md aşama 5). Ayar kaydındaki (globalShiftSettings)
 * eski alanlar yalnızca fabrika kaydında değer yoksa okunur; ayar
 * kaydedilince fabrika kaydı da güncellenir.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export async function plantLocale(ctx: Any): Promise<{ country: string; timeZone: string }> {
  const plant = ctx.plant ?? (ctx.plantId ? await ctx.db.get(ctx.plantId) : null)
  return { country: plant?.country ?? '', timeZone: plant?.timeZone ?? '' }
}

/** Ayar kaydına fabrikanın ülke ve saat dilimini uygular (kayıt yoksa null kalır). */
export async function withLocale(ctx: Any, settings: Any): Promise<Any> {
  if (!settings) return settings
  const l = await plantLocale(ctx)
  return { ...settings, country: l.country || settings.country || '', timeZone: l.timeZone || settings.timeZone }
}

/** Ayarda ülke / saat dilimi değişince fabrika kaydına yazar. */
export async function saveLocale(ctx: Any, next: { country?: string; timeZone?: string }) {
  const plant = await ctx.db.get(ctx.plantId)
  if (!plant) return
  const patch: Any = {}
  if (next.country && next.country !== plant.country) patch.country = next.country
  if (next.timeZone && next.timeZone !== plant.timeZone) patch.timeZone = next.timeZone
  if (Object.keys(patch).length) await ctx.db.patch(plant._id, patch)
}
