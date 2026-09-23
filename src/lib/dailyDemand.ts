// ZPP_DAILY: satış gününün kendisi.
//
// ZPP haftalık toplam verir; hangi gün sevk edileceğini söylemez. Motor
// haftayı iş günlerine eşit bölmek zorunda kalıyordu — Çarşamba sevk edilecek
// 5000, günde 1000 sayılıyordu. ZPP_DAILY'de her sütun bir gündür ve o gün
// satış günüdür; kapsadığı günler için plan artık onu esas alır.

const DATE_TOKEN = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Bir sütun başlığını tarihe çevirir. `order` gün-ay ('dmy') ya da ay-gün
 * ('mdy') sırasıdır; Excel'in varsayılan tarih biçimi ay-gündür (9/15/26),
 * Avrupa biçimleri gün-aydır (15.09.2026).
 */
export function parseDayLabel(label: string, order: 'dmy' | 'mdy' = 'dmy'): string | null {
  const match = DATE_TOKEN.exec(label.trim())
  if (!match) return null
  if (match[1]) return valid(Number(match[1]), Number(match[2]), Number(match[3]))
  const a = Number(match[4])
  const b = Number(match[5])
  let y = Number(match[6])
  if (y < 100) y += 2000
  return order === 'dmy' ? valid(y, b, a) : valid(y, a, b)
}

/**
 * Başlıkların hepsini birden yorumlar. Gün-ay mı ay-gün mü olduğunu
 * tahmin etmez: iki okumayı da dener ve günleri artan sırada veren, daha çok
 * başlığı okuyabileni seçer — ardışık günler ancak doğru okumada sıralı olur.
 */
export function interpretDayLabels(labels: string[]): Map<string, string> {
  let best = new Map<string, string>()
  let bestScore = -1
  for (const order of ['dmy', 'mdy'] as const) {
    const parsed = new Map<string, string>()
    let previous = ''
    let ordered = true
    for (const label of labels) {
      const iso = parseDayLabel(label, order)
      if (!iso) continue
      if (iso <= previous) ordered = false
      previous = iso
      parsed.set(label, iso)
    }
    const score = parsed.size * (ordered ? 2 : 1)
    if (score > bestScore) {
      best = parsed
      bestScore = score
    }
  }
  return best
}

export interface DailyDemand {
  /** malzeme → [tarih, adet] (adet mutlak değer). */
  byMaterial: Map<string, { date: string; qty: number }[]>
  /** Dosyanın kapsadığı son gün; bu güne kadar günlük veri esastır. */
  until: string | null
  /** Tarih olarak okunamayan sütun başlıkları. */
  unreadable: string[]
}

export function readDailyDemand(
  rows: { material: string; periods: { label: string; qty: number }[] }[],
): DailyDemand {
  const labels: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const p of row.periods) {
      if (!seen.has(p.label)) {
        seen.add(p.label)
        labels.push(p.label)
      }
    }
  }
  const dates = interpretDayLabels(labels)
  const unreadable = labels.filter((l) => !dates.has(l))
  let until: string | null = null
  for (const iso of dates.values()) if (!until || iso > until) until = iso

  const byMaterial = new Map<string, { date: string; qty: number }[]>()
  for (const row of rows) {
    const list: { date: string; qty: number }[] = []
    for (const p of row.periods) {
      const date = dates.get(p.label)
      if (!date) continue
      const qty = Math.abs(Number(p.qty) || 0)
      if (qty > 0) list.push({ date, qty })
    }
    // Satırın hiç talebi olmasa da malzeme dosyada var: kapsadığı günlerde
    // talebi sıfırdır. Bu da bilgidir — boş liste bu yüzden tutulur.
    byMaterial.set(row.material, list)
  }
  return { byMaterial, until, unreadable }
}

/**
 * Bir haftanın gün gün talebi.
 *
 * - Günlük dosyanın kapsadığı günler: ZPP_DAILY'deki adet, o gün.
 * - Kapsamadığı günler: haftalık adetten günlük dosyanın bu haftaya
 *   düşen kısmı çıkarılır, kalan bu günlere eşit bölünür.
 * - Hafta tamamen kapsanıyorsa haftalık rakam kullanılmaz; toplam, günlük
 *   dosyanın toplamıdır.
 *
 * `openDays` haftanın bugünden itibaren talep alabilecek günleri (iş günleri).
 * Geçmiş günlerin günlük talebi sayılmaz — o kısım ZPP'nin bakiyesindedir.
 */
export function splitWeek(input: {
  weekStart: string
  weekEnd: string
  weeklyQty: number
  today: string
  openDays: string[]
  daily?: { date: string; qty: number }[]
  dailyUntil: string | null
}): { total: number; perDay: Map<string, number> } {
  const perDay = new Map<string, number>()
  const add = (date: string, qty: number) => perDay.set(date, (perDay.get(date) ?? 0) + qty)

  if (!input.daily || !input.dailyUntil || input.dailyUntil < input.weekStart) {
    // Günlük veri yok ya da bu haftaya ulaşmıyor: eski yöntem.
    const days = input.openDays.length > 0 ? input.openDays : [input.today]
    if (input.weeklyQty > 0) for (const d of days) add(d, input.weeklyQty / days.length)
    return { total: input.weeklyQty, perDay }
  }

  let dailySum = 0
  for (const { date, qty } of input.daily) {
    if (date < input.weekStart || date > input.weekEnd || date < input.today) continue
    add(date, qty)
    dailySum += qty
  }
  if (input.dailyUntil >= input.weekEnd) return { total: dailySum, perDay }

  // Hafta kısmen kapsanıyor: kalan haftalık adet kapsanmayan günlere.
  const rest = Math.max(0, input.weeklyQty - dailySum)
  const uncovered = input.openDays.filter((d) => d > input.dailyUntil!)
  const days = uncovered.length > 0 ? uncovered : input.openDays.length > 0 ? input.openDays : [input.today]
  if (rest > 0) for (const d of days) add(d, rest / days.length)
  return { total: dailySum + rest, perDay }
}
