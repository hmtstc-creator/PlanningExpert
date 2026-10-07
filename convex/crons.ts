import { cronJobs } from 'convex/server'

import { internal } from './_generated/api'

const crons = cronJobs()

// Plan saat başı yeniden hesaplanmaz: yalnızca elle (Planning → Calculate plan;
// planlamacı, 2026-10-07 — otomatik hesap Convex'in okuma / yazma kotasını dolduruyordu).

/**
 * Günlük özet e-postası: her 15 dakikada bir, saati gelen plant'ler
 * (Company settings → Today & daily digest). Aynı gün ikinci kez gitmez.
 */
crons.interval('daily digest', { minutes: 15 }, internal.tenancy.digestTick, {})

// Süresi dolmuş oturumlar her gece silinir (tenancy.purgeExpiredSessions).
crons.daily('purge expired sessions', { hourUTC: 2, minuteUTC: 17 }, internal.tenancy.purgeExpiredSessions, {})

// Hiçbir kayda bağlanmamış, 24 saatten eski yüklemeler (tenancy.purgeOrphanUploads).
crons.daily('purge orphan uploads', { hourUTC: 2, minuteUTC: 47 }, internal.tenancy.purgeOrphanUploads, {})

export default crons
