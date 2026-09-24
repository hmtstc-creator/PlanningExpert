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
  }).index('by_code', ['code']),

  craneGroups: defineTable({
    groupName: v.string(),
    machines: v.array(v.string()),
  }),

  // Pres tanımları: hangi pres hangi holde. Aynı holdeki presler aynı anda
  // setup yapamaz (vinç kısıtı) — planlama motoru bunu buradan okur.
  presses: defineTable({
    name: v.string(),
    // Hol vinç kısıtıdır: aynı holde eşzamanlı setup sınırlıdır.
    hall: v.string(),
    // Kategori yalnızca gruplama/görüntüleme içindir; makine uygunluğu
    // master data'daki ana/alternatif makinelerden gelir.
    category: v.optional(v.string()),
    // Rulodan mı beslenir? Progresif hatlar rulo, transfer presler blank
    // kullanır — transferde rulo değişimi yoktur, setup tektir.
    feedsCoil: v.optional(v.boolean()),
    tonnage: v.optional(v.number()),
    // Bu presin planı kaç gün ileriye kadar dondurulmuş sayılsın.
    // Tanımsızsa global ayar geçerlidir.
    frozenDays: v.optional(v.number()),
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
  }).index('by_key', ['key']),

  // Planlı duruşlar: vardiya devri, çay, yemek, günlük bakım. Her vardiya
  // için elle tanımlanır ve tüm presler için ortaktır. Üretim bu aralıklara
  // yerleştirilmez.
  plannedStops: defineTable({
    // 1 = birinci vardiya, 2 = ikinci, 3 = üçüncü.
    shiftIndex: v.number(),
    name: v.string(),
    // 'handover' | 'tea' | 'meal' | 'maintenance' | 'other'
    kind: v.string(),
    // Gerçek saat (gece yarısından dakika), ör. 720 = 12:00.
    startMinute: v.number(),
    durationMinutes: v.number(),
  }).index('by_shift', ['shiftIndex']),

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
  }).index('by_material', ['material']),

  // Kalıp ömrü alarmı. Kalıbın periyodik bakım limitini aşmasına izin
  // verilir — üretim ortasında kendiliğinden durdurmak sahayı durdurmak
  // olurdu — ama aşıldığı anda burada bir alarm doğar ve alarm açık olduğu
  // sürece o kalıp plana hiç alınmaz.
  moldAlarms: defineTable({
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
    .index('by_material', ['material'])
    .index('by_status', ['status']),

  // Kalıbın imalata hazır olup olmadığı. Hazır değilse plan o kalıbı
  // hazır olacağı tarihe kadar hiç kullanmaz — bakım bölümü burayı yönetir.
  moldReadiness: defineTable({
    material: v.string(),
    ready: v.boolean(),
    // Hazır değilse üretime hazır olacağı tarih (YYYY-MM-DD).
    readyDate: v.optional(v.string()),
    // O gün hangi saatte hazır (gece yarısından dakika). Yoksa gün başı.
    readyMinute: v.optional(v.number()),
    reason: v.optional(v.string()),
    updatedBy: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_material', ['material']),

  // Pres bakımı: bakım departmanı hangi presin hangi gün hangi saatler
  // arasında kapalı olacağını buraya yazar. Plan bu aralığı doldurulmuş
  // kabul eder — o saatlerde o prese iş konmaz.
  pressMaintenance: defineTable({
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
    .index('by_press', ['press'])
    .index('by_date', ['date']),

  // Kalıp problem takibi: hangi kalıp, hangi operasyonda, hangi tarihte,
  // hangi problemi yaşadı; nasıl çözüldü.
  moldProblems: defineTable({
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
    .index('by_material', ['material'])
    .index('by_status', ['status']),

  // Kullanıcı tanımlı seçim listeleri: operasyonlar ve problem tipleri.
  // Admin sayfası yönetir; problem ekranı buradan okur.
  // Makine (pres) arızaları. Kalıp problemleriyle aynı akış: bildir, çöz
  // (çözüm açıklaması zorunlu), raporla. Farkı: "pres duruyor" işaretliyse
  // arıza çözülene (ya da beklenen devreye girişe) kadar plan o presi
  // kullanmaz.
  machineProblems: defineTable({
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
    .index('by_press', ['press'])
    .index('by_status', ['status']),

  lookups: defineTable({
    // 'operation' | 'problemType' | 'maintenanceReason' | 'machineProblemType'
    kind: v.string(),
    value: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_kind', ['kind']),

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
  }).index('by_name', ['name']),

  // Açık oturumlar. Jeton tarayıcıda saklanır; süresi dolunca yeniden
  // giriş istenir.
  sessions: defineTable({
    token: v.string(),
    userId: v.id('users'),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_user', ['userId']),

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
  // Sunucuda hesaplanan plan. Plan artık tarayıcıda değil burada hesaplanır
  // (convex/planEngine.ts); sayfa hazır sonucu okur. Büyük listeler
  // `planRunChunks` içinde parça parça durur — tek doküman ~1 MB ile sınırlı.
  planRuns: defineTable({
    status: v.string(), // 'writing' | 'ready'
    startedAt: v.number(),
    computedAt: v.number(),
    durationMs: v.optional(v.number()),
    trigger: v.optional(v.string()),
    chunkCount: v.optional(v.number()),
    // PlanRun'ın büyük listeler dışındaki alanları (src/lib/planPipeline.ts).
    summary: v.any(),
  }).index('by_status_computed', ['status', 'computedAt']),

  planRunChunks: defineTable({
    runId: v.id('planRuns'),
    index: v.number(),
    // 'jobs' | 'unplanned' | 'days' | 'rawNeeds' | 'maintenance'
    kind: v.string(),
    items: v.any(),
  }).index('by_run', ['runId', 'index']),

  // Yeniden hesaplama kuyruğunun durumu — tek kayıt (key = 'default').
  planStatus: defineTable({
    key: v.string(),
    requestedAt: v.optional(v.number()),
    scheduledFor: v.optional(v.number()),
    runningSince: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
    lastDurationMs: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lastErrorAt: v.optional(v.number()),
  }).index('by_key', ['key']),

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
    // Kaydı kimin yaptığı. Kullanıcı seçili değilse boş kalır.
    author: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_created', ['createdAt']),
})
