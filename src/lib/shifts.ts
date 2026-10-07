// Vardiya tanımı (Company settings → Shifts): şirket standardı, plant isterse
// kendi tanımını yapar. Her vardiyanın numarası (1, 2, 3 …), adı, saatleri
// ve MES'in kullandığı kodları (ör. Vardiya 1 = UB61, UB64) vardır. OEE
// modülü vardiyaları bu kodlarla numaralar (src/lib/oee.ts shiftNumber).

export interface ShiftDef {
  number: number
  name: string
  /** "HH:MM" (isteğe bağlı). */
  start?: string
  end?: string
  /** MES vardiya kodları (Shift Group / Shift Definition). */
  codes: string[]
}

export type ShiftSource = 'plant' | 'company' | 'none'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Kodlar büyük harf ve boşluksuz; vardiyalar numaraya göre. */
export function normalizeShifts(list: ShiftDef[]): ShiftDef[] {
  return [...list]
    .map((s) => ({
      number: s.number,
      name: s.name.trim(),
      ...(s.start?.trim() ? { start: s.start.trim() } : {}),
      ...(s.end?.trim() ? { end: s.end.trim() } : {}),
      codes: [...new Set(s.codes.map((c) => c.trim().toUpperCase()).filter(Boolean))],
    }))
    .sort((a, b) => a.number - b.number)
}

/** Kaydetmeden önce: numara 1–9 ve tekrarsız, ad dolu, saat HH:MM, kod tek vardiyada. */
export function shiftProblems(list: ShiftDef[]): string[] {
  const out: string[] = []
  const numbers = new Set<number>()
  const codeOwner = new Map<string, number>()
  for (const s of normalizeShifts(list)) {
    if (!Number.isInteger(s.number) || s.number < 1 || s.number > 9) out.push('A shift number is 1 to 9')
    else if (numbers.has(s.number)) out.push(`Shift ${s.number} is listed twice`)
    numbers.add(s.number)
    if (!s.name) out.push(`Shift ${s.number} needs a name`)
    for (const t of [s.start, s.end]) if (t && !TIME.test(t)) out.push(`Shift ${s.number}: time must be HH:MM (e.g. 06:00)`)
    for (const c of s.codes) {
      const owner = codeOwner.get(c)
      if (owner !== undefined && owner !== s.number) out.push(`Code ${c} is in shift ${owner} and shift ${s.number}`)
      codeOwner.set(c, s.number)
    }
  }
  return [...new Set(out)]
}

/** Plant'in geçerli tanımı: kendi tanımı varsa o, yoksa şirket standardı. */
export function effectiveShifts(
  plant: ShiftDef[] | undefined | null,
  company: ShiftDef[] | undefined | null,
): { shifts: ShiftDef[]; source: ShiftSource } {
  if (plant?.length) return { shifts: normalizeShifts(plant), source: 'plant' }
  if (company?.length) return { shifts: normalizeShifts(company), source: 'company' }
  return { shifts: [], source: 'none' }
}

/** Kodun vardiya numarası (büyük/küçük harf ve boşluk fark etmez). */
export function shiftOfCode(code: string | undefined, shifts: ShiftDef[]): number | null {
  const c = (code ?? '').trim().toUpperCase()
  if (!c) return null
  return shifts.find((s) => s.codes.some((x) => x.toUpperCase() === c))?.number ?? null
}

/** OEE ayarının biçimi: kod → numara. */
export function oeeShiftCodes(shifts: ShiftDef[]): { code: string; number: number }[] {
  return shifts.flatMap((s) => s.codes.map((code) => ({ code, number: s.number })))
}

/** Vardiya süresi (dk); gece vardiyası gün aşar. Saat yoksa null. */
export function shiftMinutes(s: Pick<ShiftDef, 'start' | 'end'>): number | null {
  if (!s.start || !s.end || !TIME.test(s.start) || !TIME.test(s.end)) return null
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
  const d = m(s.end) - m(s.start)
  return d > 0 ? d : d + 1440
}

/** Saati tanımlı değilse varsayılan vardiya süresi (dk). */
export const DEFAULT_SHIFT_MIN = 480

export interface NetShifts {
  /** Vardiya numarası → net süre (dk) = vardiya süresi − planlı duruşları. */
  byShift: Record<number, number>
  /** Vardiyaların net süresinin ortalaması (haftalık toplamda bölen). */
  average: number
  /** Vardiyaların planlı duruşlarının ortalaması (dk). */
  plannedAverage: number
  /** Vardiya saatleri Company settings → Shifts'te tanımlı mı (değilse 8 saat varsayılır). */
  timesDefined: boolean
}

/**
 * Bir vardiyanın net süresi (planlamacı, 2026-10-07): vardiya süresi
 * (Company settings → Shifts, saat yoksa 8 saat) − o vardiyanın planlı
 * duruşları (Planning → Calendar → Planned stops: çay, yemek, toplantı …).
 * Loading planlı duruşları içermez; "kaç vardiya çalışıldı" = Loading ÷ net süre.
 */
export function netShiftMinutes(
  shifts: Pick<ShiftDef, 'number' | 'start' | 'end'>[] | undefined | null,
  stops: { shiftIndex: number; durationMinutes: number }[] | undefined | null,
): NetShifts {
  const defs = (shifts ?? []).length ? (shifts ?? []) : [1, 2, 3].map((number) => ({ number }) as Pick<ShiftDef, 'number' | 'start' | 'end'>)
  const gross = defs.map((d) => ({ number: d.number, minutes: shiftMinutes(d) }))
  const timesDefined = gross.some((g) => g.minutes !== null)
  const byShift: Record<number, number> = {}
  let planned = 0
  for (const g of gross) {
    const stop = (stops ?? []).filter((x) => x.shiftIndex === g.number).reduce((a, x) => a + Math.max(0, x.durationMinutes), 0)
    planned += stop
    byShift[g.number] = Math.max(1, (g.minutes ?? DEFAULT_SHIFT_MIN) - stop)
  }
  const nets = Object.values(byShift)
  return {
    byShift,
    average: nets.reduce((a, b) => a + b, 0) / nets.length,
    plannedAverage: planned / gross.length,
    timesDefined,
  }
}

/** Ekranda: "1 · Early 06:00–14:00". */
export function shiftLabel(s: ShiftDef): string {
  return `${s.number} · ${s.name}${s.start && s.end ? ` ${s.start}–${s.end}` : ''}`
}
