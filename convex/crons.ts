import { cronJobs } from 'convex/server'

import { internal } from './_generated/api'

const crons = cronJobs()

/**
 * Saat başı yeniden hesap. Veri değişmese de plan eskir: günün geçen
 * saatleri kapasiteden düşer ve vardiya başında yeni gün açılır. Değişiklik
 * olduğunda zaten birkaç saniye içinde hesaplanıyor; bu yalnızca saatin
 * ilerlemesi için. Birinci vardiya genelde saat başında başladığı için
 * dakika 5'te çalışır — yeni gün açıldıktan hemen sonra.
 */
// Fabrika başına: tenancy.recomputeAll her fabrikanın hesabını ayrı kurar.
crons.hourly('recompute plan', { minuteUTC: 5 }, internal.tenancy.recomputeAll, {
  trigger: 'clock',
})

/**
 * Günlük özet e-postası: her 15 dakikada bir, saati gelen plant'ler
 * (Company settings → Today & daily digest). Aynı gün ikinci kez gitmez.
 */
crons.interval('daily digest', { minutes: 15 }, internal.tenancy.digestTick, {})

// Süresi dolmuş oturumlar her gece silinir (tenancy.purgeExpiredSessions).
crons.daily('purge expired sessions', { hourUTC: 2, minuteUTC: 17 }, internal.tenancy.purgeExpiredSessions, {})

export default crons
