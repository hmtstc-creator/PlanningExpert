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
  // Ülke ve saat dilimi fabrika kaydındadır (plants); burada fabrikaya özel değer yok.
  country: '',
  setupGapMinutes: 10,
  coilSetupGapMinutes: 30,
  concurrentSetupsPerHall: 1,
  shiftStartMinute: 420,
  capacityFactor: 1,
  planningHorizonWeeks: 4,
  breakMinutesPerShift: 0,
  frozenDays: 0,
  safetyStockDays: 2,
  timeZone: 'UTC',
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
  acceptedPerformanceRate: 1,
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

/**
 * OEE ayarları için ÖNERİ (OEE → Settings → "Suggest from data"). Hesaplar
 * bunu kullanmaz; kullanıcı ayarı kaydedince onun değerleri geçerlidir.
 * Setup sonrası 60 dk üretim planlamacının verdiği değerdir (2026-09-27).
 * Makine bazlı seçilen alan (APR) için 10 dk (2026-10-02; parça bazlı setup
 * süresi ileride Master Data'dan gelecek).
 */
export const OEE_SUGGESTED = {
  startupRunMin: 60,
  machineAreaStartupRunMin: 10,
  trendWeeks: 10,
  topN: 10,
} as const

/**
 * Today panelinin eşikleri, kaydedilmemişse (plant kendi değerini Company
 * settings → Today & daily digest'te yazar). Bkz. src/lib/cockpit.ts.
 */
export const TODAY_DEFAULTS = {
  sapStaleHours: 36,
  planStaleHours: 24,
  overloadPercent: 100,
  bottleneckWeeks: 2,
} as const

