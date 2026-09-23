import { v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'

/**
 * Kalıp ömrü alarmları.
 *
 * Kural: limit aşılabilir, ama aşıldığı anda alarm doğar ve alarm kapanana
 * kadar o kalıp plana alınmaz. Kuralın kendisi `src/lib/moldAlarm.ts`
 * içinde saf fonksiyon olarak duruyor ve orada test ediliyor; burası onu
 * veriye uygulayan katman.
 */
const rowValidator = v.object({
  _id: v.id('moldAlarms'),
  _creationTime: v.number(),
  material: v.string(),
  status: v.string(),
  shotsAtAlarm: v.number(),
  limitAtAlarm: v.number(),
  openedAt: v.number(),
  closedAt: v.optional(v.number()),
  closedBy: v.optional(v.string()),
  closeReason: v.optional(v.string()),
})

export const list = guardedQuery({
  args: {},
  returns: v.array(rowValidator),
  handler: async (ctx) => ctx.db.query('moldAlarms').collect(),
})

/**
 * Son periyodik bakımdan bu yana yapılan vuruşlar, malzeme başına.
 *
 * `src/lib/moldLife.ts` ile aynı hesap: vuruş = adet ÷ göz sayısı ve
 * yalnızca son PERİYODİK bakımdan sonraki üretim sayılır. Onarım sayacı
 * sıfırlamaz — sıfırlasaydı kalıp olduğundan taze görünür ve ağır bakım
 * sonsuza ötelenirdi.
 */
/*
 * Yardımcılar `ctx`'i gevşek tiplenmiş alıyor. Convex'in üretilen tipleri
 * (`convex/_generated`) ancak canlı bir deploy anahtarıyla oluşuyor; bu
 * ortamda yoklar ve doküman tipleri `{}` görünüyor. Mutasyonların kendi
 * gövdesi üretimde doğru tiplenir; buradaki gevşeklik yalnızca paylaşılan
 * yardımcılarda.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

async function shotStates(ctx: Ctx) {
  const products = await ctx.db.query('products').collect()
  const maintenance = await ctx.db.query('moldMaintenance').collect()
  const actual = await ctx.db.query('actualProduction').collect()

  const lastPeriodic = new Map<string, string>()
  for (const row of maintenance) {
    if (row.kind === 'repair') continue
    const current = lastPeriodic.get(row.material)
    if (!current || row.date > current) lastPeriodic.set(row.material, row.date)
  }

  const productByCode = new Map<string, Ctx>(products.map((p: Ctx) => [p.code, p]))
  const shots = new Map<string, number>()
  for (const row of actual) {
    const since = lastPeriodic.get(row.material)
    if (since && row.postingDate <= since) continue
    const cavities =
      productByCode.get(row.material)?.moldCavities || 1
    shots.set(row.material, (shots.get(row.material) ?? 0) + row.quantity / cavities)
  }
  for (const material of lastPeriodic.keys()) {
    if (!shots.has(material)) shots.set(material, 0)
  }

  return Array.from(shots.entries()).map(([material, value]) => {
    const limit = productByCode.get(material)?.maxShots
    return {
      material,
      cumulativeShots: Math.round(value),
      maxShots: limit && limit > 0 ? limit : null,
    }
  })
}

/**
 * Vuruş sayılarını alarm kayıtlarıyla karşılaştırır.
 *
 * Yalnızca vuruş sayısını değiştiren iki olaydan sonra çağrılır: MB51
 * yüklemesi (vuruş artar) ve periyodik bakım kaydı (sayaç sıfırlanır).
 * Ayrıca ekrandaki düğmeyle elle çalıştırılabilir.
 */
export async function runSync(ctx: Ctx): Promise<{ opened: number; cleared: number }> {
  const states = await shotStates(ctx)
  const existing = await ctx.db.query('moldAlarms').collect()
  const byMaterial = new Map<string, Ctx>(existing.map((row: Ctx) => [row.material, row]))

  let opened = 0
  let cleared = 0

  for (const state of states) {
    const record = byMaterial.get(state.material)
    if (state.maxShots === null) {
      // Limit tanımsız ya da silinmiş: alarm uydurulmaz, varsa düşer.
      if (record) {
        await ctx.db.delete(record._id)
        cleared++
      }
      continue
    }
    if (state.cumulativeShots >= state.maxShots) {
      // Elle kapatılan alarm yeniden açılmaz; o karar korunur.
      if (record) continue
      await ctx.db.insert('moldAlarms', {
        material: state.material,
        status: 'open',
        shotsAtAlarm: state.cumulativeShots,
        limitAtAlarm: state.maxShots,
        openedAt: Date.now(),
      })
      opened++
      await ctx.db.insert('changeLog', {
        title: `Mold shot limit reached — ${state.material}`,
        detail:
          `${state.cumulativeShots.toLocaleString('en-GB')} shots against a limit of ` +
          `${state.maxShots.toLocaleString('en-GB')}. The mold is held out of the plan ` +
          `until the alarm is closed.`,
        category: 'maintenance',
        createdAt: Date.now(),
      })
    } else if (record) {
      // Sayaç sıfırlanmış: periyodik bakım yapılmış demektir.
      await ctx.db.delete(record._id)
      cleared++
    }
  }

  const known = new Set(states.map((s) => s.material))
  for (const record of existing as Ctx[]) {
    if (!known.has(record.material)) {
      await ctx.db.delete(record._id)
      cleared++
    }
  }

  return { opened, cleared }
}

export const sync = guardedMutation({
  args: {},
  returns: v.object({ opened: v.number(), cleared: v.number() }),
  handler: async (ctx) => runSync(ctx),
})

/**
 * Alarmı elle kapatır: "gördüm, bu kalıp çalışmaya devam etsin".
 *
 * Kayıt silinmez, kapalı olarak durur — böylece hem geçmişte kalır hem de
 * bir sonraki eşleme onu yeniden açmaz. Ancak sayaç sıfırlanınca düşer.
 */
export const close = guardedMutation({
  args: {
    id: v.id('moldAlarms'),
    reason: v.string(),
    closedBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row) throw new Error('Alarm not found')
    const reason = args.reason.trim()
    if (!reason) throw new Error('Say why the mold may keep running')

    await ctx.db.patch(args.id, {
      status: 'closed',
      closedAt: Date.now(),
      closedBy: args.closedBy,
      closeReason: reason,
    })
    await ctx.db.insert('changeLog', {
      title: `Mold shot alarm closed — ${row.material}`,
      detail: `${reason} The mold goes back into the plan.`,
      category: 'maintenance',
      author: args.closedBy,
      createdAt: Date.now(),
    })
    return null
  },
})

/** Kapatılan alarmı yeniden açar — karar geri alınabilir olmalı. */
export const reopen = guardedMutation({
  args: { id: v.id('moldAlarms'), reopenedBy: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row) throw new Error('Alarm not found')
    await ctx.db.patch(args.id, {
      status: 'open',
      closedAt: undefined,
      closedBy: undefined,
      closeReason: undefined,
    })
    await ctx.db.insert('changeLog', {
      title: `Mold shot alarm reopened — ${row.material}`,
      detail: 'The mold is held out of the plan again.',
      category: 'maintenance',
      author: args.reopenedBy,
      createdAt: Date.now(),
    })
    return null
  },
})
