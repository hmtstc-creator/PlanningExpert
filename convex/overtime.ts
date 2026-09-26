import { ConvexError, v } from 'convex/values'

import { guardedMutation, guardedQuery } from './guarded'
import {
  DAY_MINUTES,
  WEEKDAY_KEYS,
  pressDay,
  type OvertimeDefinition,
  type PressDaySources,
} from '../src/lib/pressCalendar'
import { SETTINGS_DEFAULTS } from '../src/lib/settingsDefaults'

/**
 * Mesai: tanımlar (tam mesai, yarım mesai…), tarihli mesai ve şablondaki
 * tekrarlayan mesai. Kurallar src/lib/pressCalendar.ts'tedir; burada her
 * kayıt aynı kurallarla denetlenir — plana alınamayacak bir mesai
 * (24 saati aşan, normal vardiyayla ya da başka mesaiyle çakışan) kaydedilmez.
 */

// Convex'in üretilen tipleri bu ortamda yok; gevşek tiplenmiş.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

const ISO = /^\d{4}-\d{2}-\d{2}$/

const definitionValidator = v.object({
  _id: v.id('overtimeDefinitions'),
  _creationTime: v.number(),
  name: v.string(),
  description: v.optional(v.string()),
  startMinute: v.number(),
  durationMinutes: v.number(),
})

const pressOvertimeValidator = v.object({
  _id: v.id('pressOvertime'),
  _creationTime: v.number(),
  press: v.string(),
  date: v.string(),
  definitionId: v.id('overtimeDefinitions'),
})

export const listDefinitions = guardedQuery({
  args: {},
  returns: v.array(definitionValidator),
  handler: async (ctx: Ctx) => ctx.db.query('overtimeDefinitions').collect(),
})

export const saveDefinition = guardedMutation({
  args: {
    id: v.optional(v.id('overtimeDefinitions')),
    name: v.string(),
    description: v.optional(v.string()),
    startMinute: v.number(),
    durationMinutes: v.number(),
  },
  returns: v.null(),
  handler: async (ctx: Ctx, args: Ctx) => {
    const name = args.name.trim()
    if (!name) throw new ConvexError('Give the overtime a name (e.g. Full overtime)')
    if (!Number.isInteger(args.startMinute) || args.startMinute < 0 || args.startMinute >= DAY_MINUTES) {
      throw new ConvexError('Start time must be between 00:00 and 23:59')
    }
    if (!Number.isInteger(args.durationMinutes) || args.durationMinutes <= 0 || args.durationMinutes > DAY_MINUTES) {
      throw new ConvexError('Duration must be more than 0 and at most 24 hours')
    }
    const doc = {
      name,
      description: args.description?.trim() || undefined,
      startMinute: args.startMinute,
      durationMinutes: args.durationMinutes,
    }
    if (args.id) {
      // Değişen tanım, onu kullanan her mesaiye yansır: kullananlar yeniden denetlenir.
      await ctx.db.patch(args.id, doc)
      const problems = await problemsForDefinition(ctx, args.id)
      if (problems.length) throw new ConvexError(`This change cannot be planned: ${problems.slice(0, 3).join(' ')}`)
    } else {
      await ctx.db.insert('overtimeDefinitions', doc)
    }
    return null
  },
})

export const removeDefinition = guardedMutation({
  args: { id: v.id('overtimeDefinitions') },
  returns: v.null(),
  handler: async (ctx: Ctx, { id }: Ctx) => {
    const dated = await ctx.db
      .query('pressOvertime')
      .withIndex('by_definition', (q: Ctx) => q.eq('definitionId', id))
      .first()
    const recurring = (await ctx.db.query('pressTemplates').collect()).find((t: Ctx) =>
      (t.recurringOvertime ?? []).some((r: Ctx) => r.definitionId === id),
    )
    if (dated || recurring) {
      throw new ConvexError(
        `Still in use (${dated ? `${dated.press} ${dated.date}` : `every ${recurring.press} template`}) — remove that overtime first.`,
      )
    }
    await ctx.db.delete(id)
    return null
  },
})

export const listPressOvertime = guardedQuery({
  args: {},
  returns: v.array(pressOvertimeValidator),
  handler: async (ctx: Ctx) => ctx.db.query('pressOvertime').collect(),
})

/** Bir presin bir gününe mesai aç. Plana alınamayacaksa kaydedilmez. */
export const addPressOvertime = guardedMutation({
  args: { press: v.string(), date: v.string(), definitionId: v.id('overtimeDefinitions') },
  returns: v.null(),
  handler: async (ctx: Ctx, args: Ctx) => {
    const press = args.press.trim()
    if (!press) throw new ConvexError('Press is required')
    if (!ISO.test(args.date)) throw new ConvexError('Date must be YYYY-MM-DD')
    await requireDefinedPress(ctx, press)
    if (!(await hasCalendar(ctx, press))) {
      throw new ConvexError(`${press} has no Work Calendar pattern yet — define its days and shifts first.`)
    }
    const def = await ctx.db.get(args.definitionId)
    if (!def) throw new ConvexError('This overtime type no longer exists — choose another one.')
    const sameDay = await ctx.db
      .query('pressOvertime')
      .withIndex('by_press_date', (q: Ctx) => q.eq('press', press).eq('date', args.date))
      .collect()
    if (sameDay.some((o: Ctx) => o.definitionId === args.definitionId)) {
      throw new ConvexError(`${def.name} is already open on ${args.date} for ${press}.`)
    }
    // Yaz, sonra denetle: sorun varsa hata işlemi geri alır, kayıt kalmaz.
    await ctx.db.insert('pressOvertime', { press, date: args.date, definitionId: args.definitionId })
    const day = await dayOf(ctx, press, args.date)
    if (day.problems.length) {
      throw new ConvexError(`Cannot open ${def.name} on ${args.date} for ${press}: ${day.problems.join(' ')}`)
    }
    return null
  },
})

export const removePressOvertime = guardedMutation({
  args: { id: v.id('pressOvertime') },
  returns: v.null(),
  handler: async (ctx: Ctx, { id }: Ctx) => {
    await ctx.db.delete(id)
    return null
  },
})

/** Şablondaki tekrarlayan mesai (her hafta, iptal edilene kadar). */
export const setRecurringOvertime = guardedMutation({
  args: {
    press: v.string(),
    items: v.array(v.object({ dayKey: v.string(), definitionId: v.id('overtimeDefinitions') })),
  },
  returns: v.null(),
  handler: async (ctx: Ctx, { press, items }: Ctx) => {
    await requireDefinedPress(ctx, press)
    const template = await ctx.db
      .query('pressTemplates')
      .withIndex('by_press', (q: Ctx) => q.eq('press', press))
      .first()
    if (!template) throw new ConvexError(`${press} has no Work Calendar pattern yet — define its days and shifts first.`)
    for (const it of items) {
      if (!(WEEKDAY_KEYS as readonly string[]).includes(it.dayKey)) throw new ConvexError(`Unknown day ${it.dayKey}`)
    }
    await ctx.db.patch(template._id, { recurringOvertime: items })
    // Normal bir hafta üzerinde denetle: her tekrarlayan gün plana alınabilmeli.
    const src = await sources(ctx)
    src.holidays = new Set()
    for (let i = 0; i < 7; i++) {
      const date = `2001-01-0${i + 1}` // 1 Ocak 2001 Pazartesi
      const problems = pressDay(src, press, '2001-01-01', date).problems
      if (problems.length) throw new ConvexError(`${WEEKDAY_KEYS[i]}: ${problems.join(' ')}`)
    }
    return null
  },
})

// ---- yardımcılar ----------------------------------------------------------

async function sources(ctx: Ctx): Promise<PressDaySources> {
  const settings = await ctx.db
    .query('globalShiftSettings')
    .withIndex('by_key', (q: Ctx) => q.eq('key', 'default'))
    .first()
  const calendar = await ctx.db
    .query('workCalendar')
    .withIndex('by_key', (q: Ctx) => q.eq('key', 'default'))
    .first()
  const country = settings?.country ?? SETTINGS_DEFAULTS.country
  const official = await ctx.db
    .query('officialHolidays')
    .withIndex('by_country', (q: Ctx) => q.eq('country', country))
    .collect()
  const templates = await ctx.db.query('pressTemplates').collect()
  const overrides = await ctx.db.query('pressWeekOverrides').collect()
  const defs = await ctx.db.query('overtimeDefinitions').collect()
  const dated = await ctx.db.query('pressOvertime').collect()
  const datedOvertime = new Map<string, { press: string; date: string; definitionId: string }[]>()
  for (const o of dated) {
    const key = `${o.press}|${o.date}`
    datedOvertime.set(key, [...(datedOvertime.get(key) ?? []), { press: o.press, date: o.date, definitionId: o.definitionId }])
  }
  return {
    shiftStartMinute: settings?.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute,
    shiftMinutes: settings?.shiftMinutes ?? SETTINGS_DEFAULTS.shiftMinutes,
    templates: new Map(templates.map((t: Ctx) => [t.press, t])),
    weekOverrides: new Map(overrides.map((o: Ctx) => [`${o.press}|${o.weekStart}`, o])),
    datedOvertime,
    definitions: new Map(
      defs.map((d: Ctx): [string, OvertimeDefinition] => [
        d._id,
        { id: d._id, name: d.name, description: d.description, startMinute: d.startMinute, durationMinutes: d.durationMinutes },
      ]),
    ),
    holidays: new Set<string>([...(calendar?.holidays ?? []), ...official.map((h: Ctx) => h.date)]),
  }
}

/** Pres listesinin tek kaynağı Press Definitions (presses tablosu). */
async function requireDefinedPress(ctx: Ctx, press: string) {
  const found = await ctx.db
    .query('presses')
    .withIndex('by_name', (q: Ctx) => q.eq('name', press))
    .first()
  if (!found) throw new ConvexError(`${press} is not defined on Press Definitions — define the press first.`)
}

async function hasCalendar(ctx: Ctx, press: string) {
  return !!(await ctx.db
    .query('pressTemplates')
    .withIndex('by_press', (q: Ctx) => q.eq('press', press))
    .first())
}

function mondayOf(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

async function dayOf(ctx: Ctx, press: string, date: string) {
  return pressDay(await sources(ctx), press, mondayOf(date), date)
}

async function problemsForDefinition(ctx: Ctx, id: string): Promise<string[]> {
  const src = await sources(ctx)
  const out: string[] = []
  const dated = await ctx.db
    .query('pressOvertime')
    .withIndex('by_definition', (q: Ctx) => q.eq('definitionId', id))
    .collect()
  for (const o of dated) {
    for (const p of pressDay(src, o.press, mondayOf(o.date), o.date).problems) out.push(`${o.press} ${o.date}: ${p}`)
  }
  return out
}
