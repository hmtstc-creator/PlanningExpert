import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  // @deprecated kaldırıldı, sadece eski sözleşme uyumluluğu için tutuluyor
  machines: defineTable({
    name: v.string(),
    hall: v.string(),
    hasCrane: v.boolean(),
    tonnage: v.number(),
  }).index('by_name', ['name']),

  // @deprecated kaldırıldı, sadece eski sözleşme uyumluluğu için tutuluyor
  machinePriorities: defineTable({
    productCode: v.string(),
    machineName: v.string(),
    priority: v.number(),
  }).index('by_product', ['productCode']),

  products: defineTable({
    code: v.string(),
    coProduct: v.optional(v.string()),
    moldCavities: v.optional(v.number()),
    spm: v.optional(v.number()),
    rawMaterialCode: v.optional(v.string()),
    coilWeight: v.optional(v.number()),
    grossWeight: v.optional(v.number()),
    setupMinutes: v.optional(v.number()),
    coilSetupMinutes: v.optional(v.number()),
    mainMachine: v.optional(v.string()),
    altMachine1: v.optional(v.string()),
    altMachine2: v.optional(v.string()),
    altMachine3: v.optional(v.string()),
    altMachine4: v.optional(v.string()),
    name: v.optional(v.string()),
    material: v.optional(v.string()),
    cycleTimeSeconds: v.optional(v.number()),
  }).index('by_code', ['code']),

  craneGroups: defineTable({
    groupName: v.string(),
    machines: v.array(v.string()),
  }),

  demandWeekly: defineTable({
    material: v.string(),
    stockInStorage: v.optional(v.number()),
    overdue: v.optional(v.number()),
    periods: v.array(v.object({ label: v.string(), qty: v.number() })),
    uploadedAt: v.number(),
  }).index('by_material', ['material']),

  demandDaily: defineTable({
    material: v.string(),
    stockInStorage: v.optional(v.number()),
    overdue: v.optional(v.number()),
    periods: v.array(v.object({ label: v.string(), qty: v.number() })),
    uploadedAt: v.number(),
  }).index('by_material', ['material']),

  stock: defineTable({
    material: v.string(),
    plant: v.optional(v.string()),
    storageLocation: v.optional(v.string()),
    unrestricted: v.optional(v.number()),
    qualityInspection: v.optional(v.number()),
    restricted: v.optional(v.number()),
    blocked: v.optional(v.number()),
    returns: v.optional(v.number()),
    transit: v.optional(v.number()),
    uploadedAt: v.number(),
  }).index('by_material', ['material']),

  storageLocations: defineTable({
    code: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
  }).index('by_code', ['code']),

  workCalendar: defineTable({
    key: v.string(),
    shiftMinutesPerDay: v.number(),
    workingDays: v.array(v.string()),
    holidays: v.array(v.string()),
  }).index('by_key', ['key']),

  // Pres bazlı takvim ayarları: her presin kendi vardiya süresi, fazla
  // mesai vardiya süresi ve tatil ülkesi olabilir.
  pressCalendarSettings: defineTable({
    press: v.string(),
    shiftMinutes: v.number(),
    overtimeShiftMinutes: v.number(),
    country: v.optional(v.string()),
  }).index('by_press', ['press']),

  // Pres bazlı haftalık takvim: her hafta için her günün normal ve fazla
  // mesai vardiya sayısı ayrı ayrı tutulur.
  pressCalendarWeeks: defineTable({
    press: v.string(),
    weekStart: v.string(),
    days: v.array(
      v.object({
        key: v.string(),
        shifts: v.number(),
        overtimeShifts: v.number(),
      }),
    ),
  }).index('by_press_week', ['press', 'weekStart']),

  changeLog: defineTable({
    title: v.string(),
    detail: v.optional(v.string()),
    category: v.string(),
    author: v.optional(v.string()),
    createdAt: v.number(),
  }),
})
