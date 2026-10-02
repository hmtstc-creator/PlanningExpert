import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { configFields, dayFields, downtimeDayFields, lossDayFields, monthlyFields, orderFields, shiftFields, weeklyFields } from './oeeValidators'

/**
 * Fabrika anahtarı (docs/plant-genisletme.md). Fabrikaya ait her tabloda
 * var ve her index onunla başlar; erişim yalnızca convex/plantDb.ts'deki
 * kilitli veritabanından yapılır. Geçiş bitene kadar eski kayıtlarda boş.
 */
const plantField = { plantId: v.optional(v.id('plants')) }

export default defineSchema({
  // ---- Platform (fabrikadan bağımsız) ----
  companies: defineTable({
    name: v.string(),
    // 'active' | 'suspended' (askıda: salt okunur)
    status: v.string(),
    /** Açık modüller: 'planning' | 'oee' | 'die' | 'machine'. */
    modules: v.array(v.string()),
    suspendedAt: v.optional(v.number()),
    /** Askıya alınınca +90 gün: bu tarihten sonra kalıcı silinebilir. */
    deleteAfter: v.optional(v.number()),
    createdAt: v.number(),
  }),

  plants: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    code: v.optional(v.string()),
    country: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    /** Bu fabrikada kapatılan modüller. */
    disabledModules: v.optional(v.array(v.string())),
    /**
     * Fabrikanın masraf yerleri (SAP cost center kodu + adı). Tek kaynak:
     * OEE ve diğer modüller adı buradan okur (Company → Plant → Cost center).
     */
    costCenters: v.optional(v.array(v.object({ code: v.string(), name: v.string() }))),
    createdAt: v.number(),
  }).index('by_company', ['companyId']),

  userGroups: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    /** Şirketin bütün fabrikaları (sonradan eklenenler dahil). */
    allPlants: v.boolean(),
    plantIds: v.array(v.id('plants')),
    permissions: v.object({
      planning: v.optional(v.string()),
      oee: v.optional(v.string()),
      die: v.optional(v.string()),
      machine: v.optional(v.string()),
      kpi: v.optional(v.string()),
    }),
    createdAt: v.number(),
  }).index('by_company', ['companyId']),

  /** Tek seferlik platform durumu (ör. fabrika anahtarı geçişi). */
  platformState: defineTable({
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  // @deprecated kaldırıldı, sadece eski sözleşme uyumluluğu için tutuluyor
  machines: defineTable({
    ...plantField,
    name: v.string(),
    hall: v.string(),
    hasCrane: v.boolean(),
    tonnage: v.number(),
  }).index('by_name', ['plantId', 'name'])
    .index('by_plant', ['plantId']),

  // @deprecated kaldırıldı, sadece eski sözleşme uyumluluğu için tutuluyor
  machinePriorities: defineTable({
    ...plantField,
    productCode: v.string(),
    machineName: v.string(),
    priority: v.number(),
  }).index('by_product', ['plantId', 'productCode'])
    .index('by_plant', ['plantId']),

  // Planlamacının pres bazında müdahalesi: pres şu andan önce plana girmez
  // (operatör yok, hammadde yok…) ve/veya onaylı işleri geride/ileride.
  pressPlanStarts: defineTable({
    ...plantField,
    press: v.string(),
    // Plan başlangıcı: takvim günü + saat (gece yarısından dakika).
    fromDate: v.optional(v.string()),
    fromMinute: v.optional(v.number()),
    reason: v.optional(v.string()),
    // Onaylı (dondurulmuş/çalışan) işler bu kadar dakika geride (+) / ileride (−).
    delayMinutes: v.optional(v.number()),
    updatedBy: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_press', ['plantId', 'press'])
    .index('by_plant', ['plantId']),

  products: defineTable({
    ...plantField,
    code: v.string(),
    coProduct: v.optional(v.string()),
    moldCavities: v.optional(v.number()),
    spm: v.optional(v.number()),
    rawMaterialCode: v.optional(v.string()),
    coilWeight: v.optional(v.number()),
    grossWeight: v.optional(v.number()),
    // Minimum lot (adet). Tanımlıysa rulo hesabının yerine geçer.
    minLotQty: v.optional(v.number()),
    setupMinutes: v.optional(v.number()),
    coilSetupMinutes: v.optional(v.number()),
    mainMachine: v.optional(v.string()),
    altMachine1: v.optional(v.string()),
    altMachine2: v.optional(v.string()),
    altMachine3: v.optional(v.string()),
    altMachine4: v.optional(v.string()),
    // İşaretliyse alternatif preslerde de planlanabilir. İşaretsizse (varsayılan)
    // kalite gereği HER ZAMAN ana preste çalışır; alternatifler kullanılmaz.
    flexiblePress: v.optional(v.boolean()),
    // Kalıbın bakım öncesi maksimum baskı (shot) limiti — kullanıcı tanımlar.
    maxShots: v.optional(v.number()),
    // Setup sonrası ilk parça / kalite onayı süresi (dk).
    qualityApprovalMinutes: v.optional(v.number()),
    // Kalıp bazlı OEE çarpanı (0–1): kullanılabilirlik × performans.
    // İşin toplam penceresini belirler; setup ve onay bu pencereden düşülür.
    performanceFactor: v.optional(v.number()),
    name: v.optional(v.string()),
    material: v.optional(v.string()),
    cycleTimeSeconds: v.optional(v.number()),
  }).index('by_code', ['plantId', 'code'])
    .index('by_plant', ['plantId']),

  craneGroups: defineTable({
    ...plantField,
    groupName: v.string(),
    machines: v.array(v.string()),
  })
    .index('by_plant', ['plantId']),

  // Pres tanımları: hangi pres hangi holde. Aynı holdeki presler aynı anda
  // setup yapamaz (vinç kısıtı) — planlama motoru bunu buradan okur.
  presses: defineTable({
    ...plantField,
    name: v.string(),
    // Hol vinç kısıtıdır: aynı holde eşzamanlı setup sınırlıdır.
    hall: v.string(),
    // Kategori yalnızca gruplama/görüntüleme içindir; makine uygunluğu
    // master data'daki ana/alternatif makinelerden gelir.
    category: v.optional(v.string()),
    // Rulodan mı beslenir? Progresif hatlar rulo, transfer presler blank
    // kullanır — transferde rulo değişimi yoktur, setup tektir.
    feedsCoil: v.optional(v.boolean()),
    // @deprecated Pres tonajı kaldırıldı (hiçbir hesapta yoktu).
    tonnage: v.optional(v.number()),
    // Bu presin planı kaç gün ileriye kadar dondurulmuş sayılsın.
    // Tanımsızsa global ayar geçerlidir.
    frozenDays: v.optional(v.number()),
  }).index('by_name', ['plantId', 'name'])
    .index('by_plant', ['plantId']),

  demandWeekly: defineTable({
    ...plantField,
    material: v.string(),
    stockInStorage: v.optional(v.number()),
    overdue: v.optional(v.number()),
    periods: v.array(v.object({ label: v.string(), qty: v.number() })),
    uploadedAt: v.number(),
  }).index('by_material', ['plantId', 'material'])
    .index('by_uploadedAt', ['plantId', 'uploadedAt'])
    .index('by_plant', ['plantId']),

  demandDaily: defineTable({
    ...plantField,
    material: v.string(),
    stockInStorage: v.optional(v.number()),
    overdue: v.optional(v.number()),
    periods: v.array(v.object({ label: v.string(), qty: v.number() })),
    uploadedAt: v.number(),
  }).index('by_material', ['plantId', 'material'])
    .index('by_uploadedAt', ['plantId', 'uploadedAt'])
    .index('by_plant', ['plantId']),

  stock: defineTable({
    ...plantField,
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
  }).index('by_material', ['plantId', 'material'])
    .index('by_uploadedAt', ['plantId', 'uploadedAt'])
    .index('by_plant', ['plantId']),

  // SAP dosyalarının son yüklemesi — hangi dosya, ne zaman, kim, kaç satır.
  // Veri tablolarında dosya adı yok; planın hangi dosyayla hesaplandığını
  // göstermenin tek yolu bu kayıt.
  sapUploads: defineTable({
    ...plantField,
    key: v.string(), // 'weeklyDemand' | 'dailyDemand' | 'stock' | 'actuals'
    fileName: v.optional(v.string()),
    uploadedAt: v.number(),
    uploadedBy: v.optional(v.string()),
    rowsInFile: v.number(),
    rowsImported: v.number(),
    skippedUnknownMaterial: v.number(),
    skippedUnknownLocation: v.number(),
    // Dosyanın kapsadığı dönem: ilk ve son hafta/gün ya da kayıt tarihi.
    coversFrom: v.optional(v.string()),
    coversTo: v.optional(v.string()),
    // Kayıt, bu özellikten önce yüklenmiş verinin yerini tutuyor (dosya adı
    // bilinmiyor). uploadedAt 0 ise ortada hiç veri yok.
    legacy: v.optional(v.boolean()),
  }).index('by_key', ['plantId', 'key'])
    .index('by_plant', ['plantId']),

  storageLocations: defineTable({
    ...plantField,
    code: v.string(),
    description: v.optional(v.string()),
    // @deprecated Yalnızca açıklamaydı; neyin sayılacağına tikler karar verir.
    category: v.optional(v.string()),
    /** Bitmiş ürün stoğu plana ve MRP netleştirmesine sayılır mı. Boşsa varsayılan. */
    countFinished: v.optional(v.boolean()),
    /** Hammadde (bobin) stoğu MRP'de eldeki stok sayılır mı. Boşsa varsayılan. */
    countRaw: v.optional(v.boolean()),
    /** MB51: bu depoya 101/102 hareketleri üretim sayılır. Boşsa varsayılan (2009). */
    countProduction: v.optional(v.boolean()),
  }).index('by_code', ['plantId', 'code'])
    .index('by_plant', ['plantId']),

  workCalendar: defineTable({
    ...plantField,
    key: v.string(),
    // @deprecated Vardiya süresinin eski kopyası; tek kaynak globalShiftSettings.shiftMinutes.
    shiftMinutesPerDay: v.optional(v.number()),
    workingDays: v.array(v.string()),
    holidays: v.array(v.string()),
  }).index('by_key', ['plantId', 'key'])
    .index('by_plant', ['plantId']),

  // Vardiya süresi tüm presler için ortaktır (dakika); tatil ülkesi de
  // tek bir global seçimdir. Setup kısıtları da burada: aynı holde aynı
  // anda kaç setup yapılabilir ve ardışık setuplar arasında en az kaç
  // dakika olmalı.
  globalShiftSettings: defineTable({
    ...plantField,
    key: v.string(),
    shiftMinutes: v.number(),
    overtimeShiftMinutes: v.number(),
    country: v.string(),
    setupGapMinutes: v.optional(v.number()),
    // Aynı holde iki rulo değişimi arasındaki en az süre (dk).
    coilSetupGapMinutes: v.optional(v.number()),
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
    // @deprecated plannedStops tablosu bunun yerini aldı; eski kayıtlarla
    // uyum için tutuluyor.
    breakMinutesPerShift: v.optional(v.number()),
    // Planın ilk kaç günü dondurulmuş sayılsın (0 = kapalı).
    frozenDays: v.optional(v.number()),
    // Emniyet stoğu, iş günü: sonraki lot stok bitmeden bu kadar önce başlar.
    safetyStockDays: v.optional(v.number()),
    // Tesisin saat dilimi (IANA adı). Plan sunucuda hesaplanıyor ve sunucu
    // UTC'de çalışıyor; gün ve vardiya tesis saatine göre değişmeli.
    timeZone: v.optional(v.string()),
    // Fabrika geneli setup sınırları: normalde ve bakiye/geç iş varken.
    maxSetupsPlantWideNormal: v.optional(v.number()),
    maxSetupsPlantWide: v.optional(v.number()),
    // Setup vardiya değişimini aşabilir mi (varsayılan evet).
    setupsCrossShifts: v.optional(v.boolean()),
    // Dolgu işi en fazla kaç gün öne çekilir (pres boş kalmasın).
    pullForwardDays: v.optional(v.number()),
    // Teslim saati (gece yarısından dakika, 480 = 08:00): ihtiyaç günü bu
    // saate kadar hazır olan adet geç sayılmaz.
    deliveryCutoffMinute: v.optional(v.number()),
    // Senaryo araması: hedef doluluk (%) ve en çok kaç senaryo denenir.
    utilisationTarget: v.optional(v.number()),
    maxScenarios: v.optional(v.number()),
    // Hammadde: elde tutulacak gün ve her siparişe eklenen standart kg.
    rawCoverageDays: v.optional(v.number()),
    rawOrderExtraKg: v.optional(v.number()),
    // Acil hammadde: ilk eksik iş bu kadar iş günü içindeyse Plan sayfasında.
    rawUrgentDays: v.optional(v.number()),
    // Capacity Dashboard A görünümü: kabul edilen performans oranı (0–2).
    // Yalnızca o görünümde kullanılır, planı değiştirmez.
    acceptedPerformanceRate: v.optional(v.number()),
    // Hammadde sipariş maili: alıcılar ve bilgi (CC) grubu, bir kez tanımlanır.
    rawOrderMailTo: v.optional(v.array(v.string())),
    rawOrderMailCc: v.optional(v.array(v.string())),
    // Tek seferlik geçişler yapıldı mı (ör. setup arası 60 → 10 dk).
    migratedSetupGap10: v.optional(v.boolean()),
    // Pres takvimi v2: şablondaki mesai sayıları silindi, depo tikleri açık yazıldı.
    migratedCalendarV2: v.optional(v.boolean()),
  }).index('by_key', ['plantId', 'key'])
    .index('by_plant', ['plantId']),

  // Planlı duruşlar: vardiya devri, çay, yemek, günlük bakım. Her vardiya
  // için elle tanımlanır ve tüm presler için ortaktır. Üretim bu aralıklara
  // yerleştirilmez.
  plannedStops: defineTable({
    ...plantField,
    // 1 = birinci vardiya, 2 = ikinci, 3 = üçüncü.
    shiftIndex: v.number(),
    name: v.string(),
    // 'handover' | 'tea' | 'meal' | 'maintenance' | 'other'
    kind: v.string(),
    // Gerçek saat (gece yarısından dakika), ör. 720 = 12:00.
    startMinute: v.number(),
    durationMinutes: v.number(),
  }).index('by_shift', ['plantId', 'shiftIndex'])
    .index('by_plant', ['plantId']),

  // Her presin "standart" haftalık düzeni: haftada kaç gün (Pazartesiden
  // sırayla), günde kaç vardiya ve her hafta tekrarlayan mesai. Özel olarak
  // düzenlenmemiş her hafta bu şablonu kullanır.
  pressTemplates: defineTable({
    ...plantField,
    press: v.string(),
    workingDays: v.number(),
    shiftsPerDay: v.number(),
    // @deprecated Mesai artık tarihli açılır; okunmaz.
    overtimeShifts: v.optional(v.number()),
    // Her hafta tekrarlayan mesai (ör. her Cumartesi tam mesai); iptal
    // edilene kadar geçerli, resmi tatilde çalışmaz.
    recurringOvertime: v.optional(
      v.array(v.object({ dayKey: v.string(), definitionId: v.id('overtimeDefinitions') })),
    ),
  }).index('by_press', ['plantId', 'press'])
    .index('by_plant', ['plantId']),

  // Mesai tanımları: tam mesai, yarım mesai… Mesai açılırken biri seçilir.
  overtimeDefinitions: defineTable({
    ...plantField,
    name: v.string(),
    // ör. "hafta sonu mesaisi", "hafta içi mesaisi"
    description: v.optional(v.string()),
    // Saat (gece yarısından dakika) ve süre (dk).
    startMinute: v.number(),
    durationMinutes: v.number(),
  })
    .index('by_plant', ['plantId']),

  // Tarihli mesai: bir presin bir üretim gününe açılan mesai.
  pressOvertime: defineTable({
    ...plantField,
    press: v.string(),
    date: v.string(),
    definitionId: v.id('overtimeDefinitions'),
  })
    .index('by_press_date', ['plantId', 'press', 'date'])
    .index('by_date', ['plantId', 'date'])
    .index('by_definition', ['plantId', 'definitionId'])
    .index('by_plant', ['plantId']),

  // İstisna haftalar: plan değişikliği olan belirli bir hafta için
  // şablonu geçersiz kılan kayıt.
  pressWeekOverrides: defineTable({
    ...plantField,
    press: v.string(),
    weekStart: v.string(),
    workingDays: v.number(),
    shiftsPerDay: v.number(),
    // @deprecated Mesai artık tarihli açılır; okunmaz.
    overtimeShifts: v.optional(v.number()),
  }).index('by_press_week', ['plantId', 'press', 'weekStart'])
    .index('by_plant', ['plantId']),

  // Kalıp bakım kayıtları. Kalıp ömrü sayacı son bakımdan sonraki
  // üretimi sayar; bakım kaydı yoksa eldeki tüm gerçekleşen üretim sayılır.
  moldMaintenance: defineTable({
    ...plantField,
    material: v.string(),
    // Bakımın ilk günü. Tek günlük bakımda `dateTo` ile aynıdır.
    date: v.string(),
    // Bakımın son günü — çok günlü bakım için. Eski kayıtlarda yok.
    dateTo: v.optional(v.string()),
    // 'periodic' = ağır/periyodik bakım (shot sayacını sıfırlar),
    // 'repair' = arıza onarımı. Eski kayıtlar periyodik sayılır.
    kind: v.optional(v.string()),
    note: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_material', ['plantId', 'material'])
    .index('by_plant', ['plantId']),

  // Kalıp ömrü alarmı. Kalıbın periyodik bakım limitini aşmasına izin
  // verilir — üretim ortasında kendiliğinden durdurmak sahayı durdurmak
  // olurdu — ama aşıldığı anda burada bir alarm doğar ve alarm açık olduğu
  // sürece o kalıp plana hiç alınmaz.
  moldAlarms: defineTable({
    ...plantField,
    material: v.string(),
    // 'open' = plana alınmaz | 'closed' = elle onaylandı, çalışmaya devam
    status: v.string(),
    /** Alarm doğduğu andaki vuruş ve limit — sonradan değişse de kayıt kalır. */
    shotsAtAlarm: v.number(),
    limitAtAlarm: v.number(),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    closedBy: v.optional(v.string()),
    /** Elle kapatılırken yazılan gerekçe. */
    closeReason: v.optional(v.string()),
  })
    .index('by_material', ['plantId', 'material'])
    .index('by_status', ['plantId', 'status'])
    .index('by_plant', ['plantId']),

  // Kalıbın imalata hazır olup olmadığı. Hazır değilse plan o kalıbı
  // hazır olacağı tarihe kadar hiç kullanmaz — bakım bölümü burayı yönetir.
  moldReadiness: defineTable({
    ...plantField,
    material: v.string(),
    ready: v.boolean(),
    // Hazır değilse üretime hazır olacağı tarih (YYYY-MM-DD).
    readyDate: v.optional(v.string()),
    // O gün hangi saatte hazır (gece yarısından dakika). Yoksa gün başı.
    readyMinute: v.optional(v.number()),
    reason: v.optional(v.string()),
    updatedBy: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_material', ['plantId', 'material'])
    .index('by_plant', ['plantId']),

  // Pres bakımı: bakım departmanı hangi presin hangi gün hangi saatler
  // arasında kapalı olacağını buraya yazar. Plan bu aralığı doldurulmuş
  // kabul eder — o saatlerde o prese iş konmaz.
  pressMaintenance: defineTable({
    ...plantField,
    press: v.string(),
    // Planlanan gün ve saat aralığı (gece yarısından dakika).
    date: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    reason: v.string(),
    note: v.optional(v.string()),
    // 'planned' | 'done' | 'cancelled'
    status: v.string(),
    // Bakım bittikten sonra girilen GERÇEKLEŞEN saatler. Planla farkı
    // bakım performansını verir; kayıt geçmişe dönük saklanır.
    actualDate: v.optional(v.string()),
    actualStartMinute: v.optional(v.number()),
    actualEndMinute: v.optional(v.number()),
    createdBy: v.optional(v.string()),
    completedBy: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_press', ['plantId', 'press'])
    .index('by_date', ['plantId', 'date'])
    .index('by_plant', ['plantId']),

  // Kalıp problem takibi: hangi kalıp, hangi operasyonda, hangi tarihte,
  // hangi problemi yaşadı; nasıl çözüldü.
  moldProblems: defineTable({
    ...plantField,
    material: v.string(),
    // OP10, OP20 … — tanım listesinden seçilir.
    operation: v.string(),
    // Çapak, yırtık, zımba kırılması … — tanım listesinden seçilir.
    problemType: v.string(),
    description: v.optional(v.string()),
    occurredAt: v.string(),
    reportedBy: v.optional(v.string()),
    reportedAt: v.number(),
    // 'open' | 'solved'
    status: v.string(),
    solution: v.optional(v.string()),
    solvedBy: v.optional(v.string()),
    solvedAt: v.optional(v.number()),
    /** Bu problem yüzünden kaybedilen üretim süresi (dk). */
    downtimeMinutes: v.optional(v.number()),
    /** Convex dosya deposundaki fotoğraf kimlikleri. */
    photos: v.optional(v.array(v.id('_storage'))),
  })
    .index('by_material', ['plantId', 'material'])
    .index('by_status', ['plantId', 'status'])
    .index('by_plant', ['plantId']),

  // Kullanıcı tanımlı seçim listeleri: operasyonlar ve problem tipleri.
  // Admin sayfası yönetir; problem ekranı buradan okur.
  // Makine (pres) arızaları. Kalıp problemleriyle aynı akış: bildir, çöz
  // (çözüm açıklaması zorunlu), raporla. Farkı: "pres duruyor" işaretliyse
  // arıza çözülene (ya da beklenen devreye girişe) kadar plan o presi
  // kullanmaz.
  machineProblems: defineTable({
    ...plantField,
    press: v.string(),
    problemType: v.string(),
    description: v.optional(v.string()),
    occurredAt: v.string(),
    // Arızanın saati (gece yarısından dakika) — duruş bu andan başlar.
    occurredMinute: v.optional(v.number()),
    /** Pres bu arıza yüzünden duruyor mu? Duruyorsa plan onu kullanmaz. */
    stopsPress: v.boolean(),
    /** Beklenen devreye giriş; yoksa çözülene kadar süresiz durur. */
    expectedUpDate: v.optional(v.string()),
    expectedUpMinute: v.optional(v.number()),
    reportedBy: v.optional(v.string()),
    reportedAt: v.number(),
    // 'open' | 'solved'
    status: v.string(),
    solution: v.optional(v.string()),
    solvedBy: v.optional(v.string()),
    solvedAt: v.optional(v.number()),
    /** Kaybedilen üretim süresi (dk). */
    downtimeMinutes: v.optional(v.number()),
    photos: v.optional(v.array(v.id('_storage'))),
  })
    .index('by_press', ['plantId', 'press'])
    .index('by_status', ['plantId', 'status'])
    .index('by_plant', ['plantId']),

  lookups: defineTable({
    ...plantField,
    // 'operation' | 'problemType' | 'maintenanceReason' | 'machineProblemType'
    kind: v.string(),
    value: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_kind', ['plantId', 'kind'])
    .index('by_plant', ['plantId']),

  // Kullanıcılar. DİKKAT: burada parola yok ve bu bir kimlik DOĞRULAMA
  // değildir — kimin ne yaptığını kaydetmek (atıf) içindir. Gerçek giriş
  // ayrı bir iştir; bkz. README.
  users: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    // 'admin' | 'planner' | 'maintenance' | 'viewer'
    role: v.string(),
    active: v.boolean(),
    /**
     * PBKDF2-SHA512 karması ve tuzu. Parolanın kendisi hiçbir yerde
     * saklanmaz; karma Node tarafında (action) üretilir.
     * Eski kayıtlarda yok — parolası olmayan kullanıcı giriş yapamaz.
     */
    passwordHash: v.optional(v.string()),
    passwordSalt: v.optional(v.string()),
    /** Varsayılan parolayla oluşturuldu; değiştirmeden uygulamaya giremez. */
    mustChangePassword: v.optional(v.boolean()),
    createdAt: v.number(),
    /** Platform seviyesi: site sahibi ya da general. Şirketsizdir. */
    platformRole: v.optional(v.string()),
    /** Kullanıcının şirketi (platform kullanıcılarında yok). */
    companyId: v.optional(v.id('companies')),
    /** Şirket creator'ı: şirketin bütün fabrikaları, bütün modüller. */
    isCreator: v.optional(v.boolean()),
    groupIds: v.optional(v.array(v.id('userGroups'))),
  })
    .index('by_name', ['name'])
    .index('by_company', ['companyId']),

  // Açık oturumlar. Jeton tarayıcıda saklanır; süresi dolunca yeniden
  // giriş istenir.
  sessions: defineTable({
    token: v.string(),
    userId: v.id('users'),
    createdAt: v.number(),
    expiresAt: v.number(),
    /** Oturumda seçili fabrika. */
    plantId: v.optional(v.id('plants')),
  })
    .index('by_token', ['token'])
    .index('by_user', ['userId']),

  // Otomatik plana kullanıcı müdahaleleri. Plan her zaman otomatik
  // hesaplanır; burada tutulan kurallar hesaba girdi olarak katılır, yani
  // müdahale kalıcıdır ama planın kendisi yine motordan çıkar.
  planOverrides: defineTable({
    ...plantField,
    material: v.string(),
    // 'exclude' | 'pin' | 'priority'
    kind: v.string(),
    press: v.optional(v.string()),
    date: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_material', ['plantId', 'material'])
    .index('by_plant', ['plantId']),

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
  // Sunucuda hesaplanan plan. Plan artık tarayıcıda değil burada hesaplanır
  // (convex/planEngine.ts); sayfa hazır sonucu okur. Büyük listeler
  // `planRunChunks` içinde parça parça durur — tek doküman ~1 MB ile sınırlı.
  planRuns: defineTable({
    ...plantField,
    status: v.string(), // 'writing' | 'ready'
    startedAt: v.number(),
    computedAt: v.number(),
    durationMs: v.optional(v.number()),
    trigger: v.optional(v.string()),
    chunkCount: v.optional(v.number()),
    // PlanRun'ın büyük listeler dışındaki alanları (src/lib/planPipeline.ts).
    summary: v.any(),
  }).index('by_status_computed', ['plantId', 'status', 'computedAt'])
    .index('by_plant', ['plantId']),

  planRunChunks: defineTable({
    ...plantField,
    runId: v.id('planRuns'),
    index: v.number(),
    // 'jobs' | 'unplanned' | 'days' | 'rawNeeds' | 'maintenance'
    kind: v.string(),
    items: v.any(),
  }).index('by_run', ['plantId', 'runId', 'index'])
    .index('by_plant', ['plantId']),

  // Yeniden hesaplama kuyruğunun durumu — tek kayıt (key = 'default').
  planStatus: defineTable({
    ...plantField,
    key: v.string(),
    requestedAt: v.optional(v.number()),
    scheduledFor: v.optional(v.number()),
    runningSince: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
    lastDurationMs: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lastErrorAt: v.optional(v.number()),
  }).index('by_key', ['plantId', 'key'])
    .index('by_plant', ['plantId']),

  planSnapshots: defineTable({
    ...plantField,
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
        // İş gün sınırını aştıysa bittiği gün; eski kayıtlarda yok.
        endDate: v.optional(v.string()),
        // İşin parçaları — dondurulmuş ufku çizebilmek için.
        segments: v.optional(
          v.array(
            v.object({
              kind: v.string(),
              date: v.string(),
              start: v.number(),
              end: v.number(),
            }),
          ),
        ),
        reason: v.string(),
      }),
    ),
  }).index('by_created', ['plantId', 'createdAt'])
    .index('by_plant', ['plantId']),

  // MB51'den yüklenen gerçekleşen üretim hareketleri. Plan/gerçek
  // karşılaştırması ve performans faktörü buradan beslenir.
  // Yoldaki hammadde (rulo) — kullanıcının Excel listesi; MRP'de planlı giriş.
  rawInTransit: defineTable({
    ...plantField,
    material: v.string(),
    quantityKg: v.number(),
    /** Tahmini varış (ISO). Yoksa ilk haftada gelmiş sayılır. */
    eta: v.optional(v.string()),
    poNumber: v.optional(v.string()),
    supplier: v.optional(v.string()),
    uploadedAt: v.number(),
  })
    .index('by_material', ['plantId', 'material'])
    .index('by_uploadedAt', ['plantId', 'uploadedAt'])
    .index('by_plant', ['plantId']),

  actualProduction: defineTable({
    ...plantField,
    material: v.string(),
    postingDate: v.string(),
    quantity: v.number(),
    plant: v.optional(v.string()),
    storageLocation: v.optional(v.string()),
    movementType: v.optional(v.string()),
    orderNumber: v.optional(v.string()),
    uploadedAt: v.number(),
  })
    .index('by_material', ['plantId', 'material'])
    .index('by_date', ['plantId', 'postingDate'])
    .index('by_uploadedAt', ['plantId', 'uploadedAt'])
    .index('by_plant', ['plantId']),

  // ---- OEE Trend and Losses (docs/oeedashboard.md) ----
  // Yüklemeler yalnızca ekler ya da günceller; geçmiş silinmez.
  oeeShifts: defineTable({ ...shiftFields, ...plantField })
    .index('by_date', ['plantId', 'date'])
    .index('by_key', ['plantId', 'date', 'workCenter', 'shiftGroup'])
    .index('by_plant', ['plantId']),
  oeeDays: defineTable({ ...dayFields, ...plantField })
    .index('by_date', ['plantId', 'date'])
    .index('by_key', ['plantId', 'date', 'workCenter'])
    .index('by_plant', ['plantId']),
  oeeOrders: defineTable({ ...orderFields, ...plantField })
    .index('by_date', ['plantId', 'date'])
    .index('by_key', ['plantId', 'date', 'workCenter', 'shift', 'order', 'equipment'])
    .index('by_plant', ['plantId']),
  oeeWeekly: defineTable({ ...weeklyFields, ...plantField })
    .index('by_week', ['plantId', 'year', 'week'])
    .index('by_key', ['plantId', 'year', 'week', 'workCenter'])
    .index('by_plant', ['plantId']),
  oeeMonthly: defineTable({ ...monthlyFields, ...plantField }).index('by_key', ['plantId', 'workCenter', 'monthKey'])
    .index('by_plant', ['plantId']),
  oeeDowntimeDays: defineTable({ ...downtimeDayFields, ...plantField })
    .index('by_date', ['plantId', 'date'])
    .index('by_key', ['plantId', 'date', 'workCenter'])
    .index('by_plant', ['plantId']),
  oeeLossDays: defineTable({ ...lossDayFields, ...plantField })
    .index('by_date', ['plantId', 'date'])
    .index('by_key', ['plantId', 'date', 'workCenter'])
    .index('by_plant', ['plantId']),
  oeeSettings: defineTable({ ...plantField, key: v.string(), ...configFields, updatedAt: v.number(), updatedBy: v.optional(v.string()) }).index('by_key', ['plantId', 'key'])
    .index('by_plant', ['plantId']),
  oeeImports: defineTable({
    ...plantField,
    fileName: v.string(),
    uploadedAt: v.number(),
    uploadedBy: v.optional(v.string()),
    /** [sayfa, tür, satır] */
    sheets: v.array(v.array(v.union(v.string(), v.number()))),
    ranges: v.array(v.array(v.string())),
  }).index('by_uploadedAt', ['plantId', 'uploadedAt'])
    .index('by_plant', ['plantId']),

  // ---- KPI (docs/kpi.md): masraf yeri × ay ya da ISO hafta, plan ve gerçekleşen ----
  kpiEntries: defineTable({
    ...plantField,
    period: v.string(), // 'month' | 'week'
    year: v.number(),
    num: v.number(), // ay 1–12 ya da ISO hafta
    costCenter: v.string(),
    /** Aynı masraf yerinin satır sırası (Direct ve Indirect ayrı satır olabilir). */
    line: v.optional(v.number()),
    operatorType: v.string(), // 'direct' | 'indirect'
    plan: v.any(),
    actual: v.any(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  })
    .index('by_period', ['plantId', 'period', 'year', 'num'])
    .index('by_plant', ['plantId']),

  changeLog: defineTable({
    ...plantField,
    title: v.string(),
    detail: v.optional(v.string()),
    category: v.string(),
    // Kaydı kimin yaptığı. Kullanıcı seçili değilse boş kalır.
    author: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_created', ['plantId', 'createdAt'])
    .index('by_plant', ['plantId']),
})
