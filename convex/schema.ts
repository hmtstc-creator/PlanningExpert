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
    // Kalıbın bakım öncesi maksimum baskı (shot) limiti — kullanıcı tanımlar.
    maxShots: v.optional(v.number()),
    name: v.optional(v.string()),
    material: v.optional(v.string()),
    cycleTimeSeconds: v.optional(v.number()),
  }).index('by_code', ['code']),

  craneGroups: defineTable({
    groupName: v.string(),
    machines: v.array(v.string()),
  }),

  // Pres tanımları: hangi pres hangi holde. Aynı holdeki presler aynı anda
  // setup yapamaz (vinç kısıtı) — planlama motoru bunu buradan okur.
  presses: defineTable({
    name: v.string(),
    hall: v.string(),
    tonnage: v.optional(v.number()),
  }).index('by_name', ['name']),

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

  // Vardiya süresi tüm presler için ortaktır (dakika); tatil ülkesi de
  // tek bir global seçimdir. Setup kısıtları da burada: aynı holde aynı
  // anda kaç setup yapılabilir ve ardışık setuplar arasında en az kaç
  // dakika olmalı.
  globalShiftSettings: defineTable({
    key: v.string(),
    shiftMinutes: v.number(),
    overtimeShiftMinutes: v.number(),
    country: v.string(),
    setupGapMinutes: v.optional(v.number()),
    concurrentSetupsPerHall: v.optional(v.number()),
    // Birinci vardiyanın başlangıç saati (gece yarısından dakika).
    // Planda gerçek saat göstermek için kullanılır.
    shiftStartMinute: v.optional(v.number()),
    // Kapasite düzeltme katsayısı (0–1). Performans sayfasında ölçülen
    // gerçekleşme oranı buraya yazılabilir; planlama kapasiteyi bu oranla
    // çarpar, böylece plan gerçekçi olur.
    capacityFactor: v.optional(v.number()),
    // Planlamanın kaç haftalık ufka baktığı. Çalışma takvimi 30 hafta
    // gösterir; plan ufku bundan bağımsız ve ayarlanabilirdir.
    planningHorizonWeeks: v.optional(v.number()),
    // Vardiya başına planlı duruş (mola, vardiya devri, günlük bakım).
    breakMinutesPerShift: v.optional(v.number()),
  }).index('by_key', ['key']),

  // Her presin "standart" haftalık düzeni: kaç gün çalışılır, gün başına
  // kaç vardiya, haftalık kaç fazla mesai vardiyası. 30 haftalık takvimde
  // özel olarak düzenlenmemiş her hafta bu şablonu kullanır — yani hafta
  // ilerledikçe otomatik "kayar", elle yeniden girmeye gerek kalmaz.
  pressTemplates: defineTable({
    press: v.string(),
    workingDays: v.number(),
    shiftsPerDay: v.number(),
    overtimeShifts: v.number(),
  }).index('by_press', ['press']),

  // İstisna haftalar: plan değişikliği olan belirli bir hafta için
  // şablonu geçersiz kılan kayıt.
  pressWeekOverrides: defineTable({
    press: v.string(),
    weekStart: v.string(),
    workingDays: v.number(),
    shiftsPerDay: v.number(),
    overtimeShifts: v.number(),
  }).index('by_press_week', ['press', 'weekStart']),

  // Kalıp bakım kayıtları. Kalıp ömrü sayacı son bakımdan sonraki
  // üretimi sayar; bakım kaydı yoksa eldeki tüm gerçekleşen üretim sayılır.
  moldMaintenance: defineTable({
    material: v.string(),
    date: v.string(),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_material', ['material']),

  // Otomatik plana kullanıcı müdahaleleri. Plan her zaman otomatik
  // hesaplanır; burada tutulan kurallar hesaba girdi olarak katılır, yani
  // müdahale kalıcıdır ama planın kendisi yine motordan çıkar.
  planOverrides: defineTable({
    material: v.string(),
    // 'exclude' | 'pin' | 'priority'
    kind: v.string(),
    press: v.optional(v.string()),
    date: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_material', ['material']),

  // Nager.Date'ten çekilen resmi tatiller. Takvim ekranı bunları yazar,
  // planlama motoru okur — aksi halde tatiller sadece ekranda görünür,
  // kapasite hesabına girmezdi.
  officialHolidays: defineTable({
    country: v.string(),
    year: v.number(),
    date: v.string(),
    name: v.string(),
  })
    .index('by_country_year', ['country', 'year'])
    .index('by_country', ['country']),

  // Onaylanan plan anlık görüntüleri. Otomatik plan her zaman canlı
  // veriden yeniden hesaplanır; onaylandığında buraya versiyonlanarak
  // yazılır ki "hangi planı onayladık" kaydı kalsın.
  planSnapshots: defineTable({
    createdAt: v.number(),
    approvedBy: v.optional(v.string()),
    horizonStart: v.string(),
    jobCount: v.number(),
    unplannedCount: v.number(),
    // jobCount, planlanan toplam iş sayısıdır; jobs dizisi Convex doküman
    // boyut sınırı nedeniyle kırpılmış olabilir.
    truncated: v.optional(v.boolean()),
    jobs: v.array(
      v.object({
        material: v.string(),
        press: v.string(),
        hall: v.string(),
        date: v.string(),
        phase: v.string(),
        quantity: v.number(),
        shots: v.number(),
        coilsNeeded: v.number(),
        setupStartMinute: v.number(),
        endMinute: v.number(),
        reason: v.string(),
      }),
    ),
  }).index('by_created', ['createdAt']),

  // MB51'den yüklenen gerçekleşen üretim hareketleri. Plan/gerçek
  // karşılaştırması ve performans faktörü buradan beslenir.
  actualProduction: defineTable({
    material: v.string(),
    postingDate: v.string(),
    quantity: v.number(),
    plant: v.optional(v.string()),
    storageLocation: v.optional(v.string()),
    movementType: v.optional(v.string()),
    orderNumber: v.optional(v.string()),
    uploadedAt: v.number(),
  })
    .index('by_material', ['material'])
    .index('by_date', ['postingDate']),

  changeLog: defineTable({
    title: v.string(),
    detail: v.optional(v.string()),
    category: v.string(),
    author: v.optional(v.string()),
    createdAt: v.number(),
  }),
})
