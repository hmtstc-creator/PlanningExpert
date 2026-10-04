import { v } from 'convex/values'

import { ALL_MODULES, guardedQuery } from './guarded'

/**
 * Fabrika kurulum listesi (docs/plant-genisletme.md, aşama 5): yeni bir
 * fabrika boş başlar; creator adımları buradan izler. Her adım veriye
 * bakılarak "tamam / eksik" çıkar — elle işaretlenmez.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const any = async (q: Any) => (await q.take(1)).length > 0

export const checklist = guardedQuery({
  modules: ALL_MODULES,
  args: {},
  returns: v.array(v.object({ key: v.string(), label: v.string(), done: v.boolean(), to: v.string(), module: v.string(), hint: v.string() })),
  handler: async (ctx) => {
    const db = ctx.db
    const presses: Any[] = await db.query('presses').collect()
    const settings = await db
      .query('globalShiftSettings')
      .withIndex('by_key', (q: Any) => q.eq('key', 'default'))
      .first()
    const locations: Any[] = await db.query('storageLocations').collect()
    const uploads: Any[] = await db.query('sapUploads').collect()
    const uploaded = (key: string) => uploads.some((u) => u.key === key && u.uploadedAt > 0)
    const users = await db
      .query('users')
      .withIndex('by_company', (q: Any) => q.eq('companyId', ctx.plant.companyId))
      .take(2)
    const oeeSettings = await db
      .query('oeeSettings')
      .withIndex('by_key', (q: Any) => q.eq('key', 'default'))
      .first()
    return [
      { key: 'plant', module: 'planning', label: 'Country and time zone of the plant', to: '/platform', done: !!ctx.plant.country && !!ctx.plant.timeZone, hint: 'Holidays and every date and hour of the plan use them.' },
      {
        key: 'organization',
        module: 'planning',
        label: 'Departments and cost centers of the plant',
        to: '/platform',
        done: (ctx.plant.costCenters ?? []).length > 0 && (ctx.plant.costCenters ?? []).every((c: Any) => !!c.department && (ctx.plant.departments ?? []).includes(c.department)),
        hint: 'Plant → Department → Cost center: every cost center belongs to a department.',
      },
      {
        key: 'presses',
        module: 'planning',
        label: 'Work Center Definitions — cost center of every work center',
        to: '/makineler',
        done: presses.length > 0 && presses.every((p) => (ctx.plant.costCenters ?? []).some((c: Any) => c.code === p.costCenter)),
        hint: 'Every work center belongs to a cost center. Halls (shared setup crane) are optional.',
      },
      { key: 'calendar', module: 'planning', label: 'Work Calendar — shift length, days and shifts per work center', to: '/takvim', done: !!settings && (await any(db.query('pressTemplates'))), hint: 'Without a pattern a work center has no capacity.' },
      { key: 'locations', module: 'planning', label: 'Storage Locations — which stock counts', to: '/depolar', done: locations.some((l) => l.countFinished === true), hint: 'No location is counted until it is ticked.' },
      { key: 'master', module: 'planning', label: 'Master Data — parts, work centers, cycle and lot rules', to: '/referanslar', done: await any(db.query('products')), hint: 'Upload or enter the part master.' },
      { key: 'sap', module: 'planning', label: 'SAP Data — ZPP demand and MB52 stock', to: '/sapdata', done: uploaded('weeklyDemand') && uploaded('stock'), hint: 'The plan is calculated from the uploaded demand and stock.' },
      { key: 'oee', module: 'oee', label: 'OEE — settings and first upload', to: '/oee/settings', done: !!oeeSettings && (await any(db.query('oeeDays'))), hint: 'Upload the OEE file, then Suggest from data and Save.' },
      { key: 'users', module: 'planning', label: 'Users and groups', to: '/yonetim', done: users.length > 1, hint: 'Open the users of the plant and give them groups.' },
    ]
  },
})
