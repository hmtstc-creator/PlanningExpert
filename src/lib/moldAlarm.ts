// Kalıp ömrü alarmı.
//
// Kural: kalıbın periyodik bakım limitini AŞMASINA izin verilir — üretim
// ortasında bir kalıbı kendiliğinden durdurmak sahayı durdurmak demektir.
// Ama limit aşıldığı anda bir alarm doğar ve alarm kapanana kadar o kalıp
// plana hiç alınmaz.
//
// Alarmın kapanmasının iki yolu var ve ikisi de farklı şey demek:
//
// - KENDİLİĞİNDEN: periyodik bakım kaydedilir, vuruş sayacı sıfırlanır ve
//   sayı limitin altına döner. Bakım gerçekten yapılmıştır.
// - ELLE: bakım sorumlusu "gördüm, bu kalıp çalışmaya devam etsin" der.
//   Bu bilinçli bir karardır ve KORUNMALIDIR: eşiğin üstünde olduğu için
//   alarmı hemen yeniden açmak, kapatma tuşunu işlevsiz kılardı. Elle
//   kapatılan alarm ancak sayaç sıfırlanıp limit yeniden aşılınca doğar.

export interface MoldShotState {
  material: string
  cumulativeShots: number
  /** Periyodik bakım limiti; tanımsızsa alarm üretilmez. */
  maxShots: number | null
}

export interface AlarmRecord {
  material: string
  /** 'open' = plana alınmaz, 'closed' = elle onaylanmış, çalışmaya devam. */
  status: string
}

export interface AlarmPlan {
  /** Yeni doğacak alarmlar. */
  toOpen: { material: string; shots: number; limit: number }[]
  /** Sayaç sıfırlandığı için düşecek alarm kayıtları. */
  toClear: string[]
}

/**
 * Mevcut alarm kayıtlarıyla güncel vuruş sayılarını karşılaştırır.
 *
 * Hiçbir şey yazmaz; ne yapılması gerektiğini söyler. Böylece kural
 * veritabanından bağımsız test edilebilir.
 */
export function planAlarms(
  states: MoldShotState[],
  existing: AlarmRecord[],
): AlarmPlan {
  const byMaterial = new Map(existing.map((row) => [row.material, row]))
  const toOpen: AlarmPlan['toOpen'] = []
  const toClear: string[] = []

  for (const state of states) {
    const record = byMaterial.get(state.material)
    // Limit tanımsızsa alarm uydurulmaz — limit yokluğu ayrı bir eksiklik.
    if (state.maxShots === null || state.maxShots <= 0) {
      if (record) toClear.push(state.material)
      continue
    }

    const over = state.cumulativeShots >= state.maxShots
    if (over) {
      // Elle kapatılmış alarm yeniden açılmaz; karar korunur.
      if (!record) {
        toOpen.push({
          material: state.material,
          shots: state.cumulativeShots,
          limit: state.maxShots,
        })
      }
    } else if (record) {
      // Sayaç sıfırlanmış: bakım yapılmış demektir, kayıt düşer.
      toClear.push(state.material)
    }
  }

  // Artık hiç vuruş verisi olmayan malzemenin alarmı da anlamsızdır.
  const known = new Set(states.map((s) => s.material))
  for (const record of existing) {
    if (!known.has(record.material) && !toClear.includes(record.material)) {
      toClear.push(record.material)
    }
  }

  return { toOpen, toClear }
}

/** Plana alınmayacak malzemeler: alarmı açık olanlar. */
export function alarmedMaterials(alarms: AlarmRecord[]): string[] {
  return alarms.filter((a) => a.status === 'open').map((a) => a.material)
}
