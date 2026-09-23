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
crons.hourly('recompute plan', { minuteUTC: 5 }, internal.planEngine.recompute, {
  trigger: 'clock',
})

export default crons
