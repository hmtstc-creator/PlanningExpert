/**
 * Ayarların TEK varsayılan listesi. Kaydedilmemiş bir ayar her yerde — motor,
 * bağımsız kontrol, bütün sayfalar — buradaki değerle okunur. Bir sayfada
 * farklı bir varsayılan yazmak, kullanıcının gördüğü değerle planın
 * kullandığı değerin ayrışması demekti.
 *
 * Kaydedilen değer tek bir kayıtta durur (globalShiftSettings, key
 * 'default'); her sayfa onu okur ve yazar, kopya tutulmaz.
 */
export const SETTINGS_DEFAULTS = {
  shiftMinutes: 480,
  overtimeShiftMinutes: 480,
  country: 'RO',
  setupGapMinutes: 10,
  coilSetupGapMinutes: 30,
  concurrentSetupsPerHall: 1,
  shiftStartMinute: 420,
  capacityFactor: 1,
  planningHorizonWeeks: 4,
  breakMinutesPerShift: 0,
  frozenDays: 0,
  safetyStockDays: 2,
  timeZone: 'Europe/Bucharest',
  maxSetupsPlantWideNormal: 1,
  maxSetupsPlantWide: 2,
  setupsCrossShifts: true,
  pullForwardDays: 10,
  deliveryCutoffMinute: 480,
  utilisationTarget: 95,
  maxScenarios: 100,
  rawCoverageDays: 10,
  rawOrderExtraKg: 500,
  rawUrgentDays: 3,
} as const

/** Work Calendar'da gün seçilmemişse çalışma günleri. */
export const DEFAULT_WORKING_DAYS: readonly string[] = ['MO', 'TU', 'WE', 'TH', 'FR']

export type SettingKey = keyof typeof SETTINGS_DEFAULTS
export type ResolvedSettings = { -readonly [K in SettingKey]: (typeof SETTINGS_DEFAULTS)[K] extends boolean ? boolean : (typeof SETTINGS_DEFAULTS)[K] extends string ? string : number }

/** Kayıttaki değerler + eksikler için varsayılan. */
export function resolveSettings(saved: Partial<Record<SettingKey, unknown>> | null | undefined): ResolvedSettings {
  const out = { ...SETTINGS_DEFAULTS } as unknown as Record<string, unknown>
  if (saved) {
    for (const key of Object.keys(SETTINGS_DEFAULTS)) {
      const value = (saved as Record<string, unknown>)[key]
      if (value !== undefined && value !== null && value !== '') out[key] = value
    }
  }
  return out as ResolvedSettings
}
