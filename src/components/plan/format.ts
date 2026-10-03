/** Plan sayfasının saat biçimi (Gantt ipucu, karar hücresi). */

export function formatClock(minute: number, shiftMinutes: number, shiftStartMinute: number): string {
  const shiftIndex = Math.floor(minute / shiftMinutes) + 1
  const absolute = (shiftStartMinute + minute) % (24 * 60)
  const h = Math.floor(absolute / 60)
  const m = Math.round(absolute % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (shift ${shiftIndex})`
}
