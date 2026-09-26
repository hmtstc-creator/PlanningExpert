# PlanningExpert — mimari ve geliştirme kuralları

Bu dosya programın nasıl kurulduğunu ve kodu değiştirirken uyulacak kuralları
anlatır. Planlamacıyla alınan iş kararları `docs/decisions.md`'de, koddaki
sabit sayılar `docs/fixeddefinitions.md`'dedir. Kullanıcıya dönük açıklama
sitedeki **Planning Logic** sayfasıdır (`src/routes/planlogic.tsx`).

Üçü birlikte güncel tutulur: bir kural değişirse kod + `decisions.md` +
Planning Logic sayfası aynı commit'te değişir.

---

## 1. Katmanlar

```
Tarayıcı (React 19, TanStack Start/Router, Tailwind v4)
  src/routes/*.tsx          sayfalar — veriyi okur, girdiyi yazar, HESAP YAPMAZ*
  src/components/*.tsx      ortak bileşenler (Gantt, kapasite tablosu, mesai panelleri…)
        │  useQuery / useSafeMutation (src/lib/convexTransport.tsx, WebSocket yoksa HTTPS)
        ▼
Convex (sunucu, veritabanı)
  convex/schema.ts          bütün tablolar
  convex/*.ts               guardedQuery / guardedMutation (oturum denetimi)
  convex/planQueue.ts       girdi değişince 4 sn sonra tek hesap kuyruğu
  convex/crons.ts           saat başı (dk 5) yeniden hesap
  convex/planEngine.ts      Node action: planı hesaplar, planRuns'a yazar
        │  aynı kod
        ▼
Saf hesap kütüphanesi (src/lib/*.ts — React'e de Convex'e de bağlı değil)
  planPipeline.ts           uçtan uca plan: ham kayıt → lotlar → işler → rapor
  scheduler.ts              işleri pres/gün kovalarına yerleştirme
  planning.ts               lot, rulo, hafta kovaları
  capacityModel.ts          KAPASİTENİN TEK FORMÜLÜ
  pressCalendar.ts          TAKVİM KURALLARININ TEK YERİ
  shiftTimeline.ts          net dakika ↔ saat, planlı duruşlar, mesai pencereleri
  capacityForecast.ts       Capacity Dashboard hesabı
  rawMrp.ts                 hammadde MRP (plandan bağımsız)
  stockLocations.ts         depo matrisi (hangi depo neye sayılır)
  dailyDemand.ts            ZPP_DAILY
  planAudit.ts              kural denetimi (motordan ayrı kod)
  planValidator.ts          BAĞIMSIZ doğrulama (motorla hiçbir kodu paylaşmaz)
  settingsDefaults.ts       AYAR VARSAYILANLARININ TEK YERİ
  mutationErrors.ts         sunucu hatasını kullanıcı diline çevirme
  navigation.ts             menü + sayfalar arası kısayollar (RELATED_PAGES)
```

\* Sayfalar gösterim için küçük türetmeler yapabilir, ama bir sayıyı
hesaplayan formül her zaman `src/lib`'deki tek fonksiyondur.

### Plan nasıl oluşur

1. Kullanıcı bir girdi değiştirir (Excel yükleme, ayar, takvim, master data).
2. Mutation `affectsPlan` ise `planQueue` bir hesap kurar (4 sn gecikmeyle,
   art arda yazmalar birleşir).
3. `planEngine` (Node action) girdileri `planRuns` üzerinden okur,
   `planRuns.migrateSettings` ile eski kayıtları bir kez çevirir,
   `planPipeline`'ı çalıştırır, sonucu saklar (son 3 hesap).
4. Plan sayfası hazır sonucu okur; herkes aynı planı görür.
5. Saat başı plan yeniden hesaplanır (geçen saatler kapasiteden düşer).

### SAP yüklemeleri

`beginUpload → appendRows (parça parça) → finishUpload (tek anda geçiş) →
pruneOld`. Okuyanlar yalnızca geçerli yüklemenin satırlarını görür.

---

## 2. Tek kaynak haritası

Aynı değer farklı sayfalarda farklı görünmemeli. Her bilgi tek yerden gelir:

| Bilgi | Tek kaynak | Kullananlar |
|---|---|---|
| Ayar varsayılanları | `settingsDefaults.ts` (`resolveSettings`) | motor, doğrulama, tüm sayfalar |
| Kayıtlı ayarlar | `globalShiftSettings` (key `default`) | hepsi |
| Pres listesi | Press Definitions (`presses` tablosu) | Work Calendar, Capacity Dashboard, mesai, Gantt |
| Pres grupları | presin **kategorisi** (`groupPresses`) | Gantt gruplaması, Capacity Dashboard toplamları |
| Hol | presin holü | setup ekibi, vinç kuralı |
| Pres takvimi | şablon + istisna hafta + mesai (`pressCalendar.ts`) | motor, doğrulama, Work Calendar, Capacity Dashboard, Performance |
| Kapasite dakikası | `capacityModel.ts` | aynı liste |
| Fabrika iş günü | `capacityModel.isPlantWorkingDate` | hammadde, acil hammadde, talep dağıtımı |
| Hangi depo neye sayılır | `stockLocations.ts` (Storage Locations matrisi) | plan, MRP, Capacity Dashboard, MB51 üretimi |
| Üretim adedi (MB51) | üretim girişi deposuna 101 − 102 | Actuals, Performance, kalıp ömrü, kalıp alarmı |
| Parça OEE'si | master data **Accepted OEE** (`performanceFactor`) | plan, Capacity Dashboard B |
| Tahmini OEE | ayar **Prediction OEE** (`acceptedPerformanceRate`) | yalnızca Capacity Dashboard A |
| Kapasite katsayısı | ayar `capacityFactor` (Performance sayfası) | plan |
| Planlı duruş | Work Calendar planlı duruş tablosu | kapasite, Gantt, mesai |
| Hata metni | `friendlyError()` | tüm kayıt işlemleri |

Kural: bir tanım (ör. "106 + 107 toplamı") koda elle yazılmaz; ilgili
tanımdan (kategori) türetilir.

---

## 3. Takvim ve kapasite kuralları (özet)

Ayrıntı `docs/decisions.md`'de. Kod: `pressCalendar.ts`, `capacityModel.ts`.

- Bir presin tek takvimi vardır: şablon (haftada N gün, günde M vardiya),
  istisna hafta, mesai.
- N gün Pazartesiden sırayla dolar (5 = Pzt–Cum).
- Vardiyalar eşit uzunlukta, ilk vardiya başından art arda.
- Resmi tatil tatildir: vardiya başka güne kaymaz. Çalışılacaksa tarihli mesai.
- Mesai yalnızca bir **mesai tanımıyla** (ad, açıklama, başlangıç, süre) açılır:
  tarihli (`pressOvertime`) ya da şablonda tekrarlayan (`recurringOvertime`).
  Tekrarlayan mesai tatilde çalışmaz.
- Gün ≤ 24 saat, hafta ≤ 168 saat; normal vardiyayla ya da başka mesaiyle
  çakışan mesai kaydedilmez.
- Planlı duruş mesai içine düşerse mesaiden de düşülür.
- Takvimi olmayan presin kapasitesi 0'dır; Plan sayfasında kırmızı alarm.
- Kapasite = vardiya × süre + mesai − planlı duruşlar (× kapasite katsayısı).
- Capacity Dashboard: kapasite olduğu gibi; talep saati = ideal süre ÷ OEE.
  A) Prediction OEE (tek oran, yalnızca bu görünüm) · B) Accepted OEE
  (master data, planla aynı).

---

## 4. Geliştirme kuralları

Bunlar kodu değiştiren herkes (ve Claude) için bağlayıcıdır.

### Çalışma şekli
1. Kararlar planlamacıyla konuşulur, `decisions.md`'ye yazılır; kod ancak
   "programı düzelt" denince değişir. Onaylanan işte ara onay beklenmez.
2. Kullanıcının girmediği sabit sayı ya da koşul eklenmeden önce sorulur;
   `fixeddefinitions.md`'ye yazılır (P = programda / K = kullanıcı).
3. Değişiklik → test → commit → push (`main`). Kullanıcıya Ctrl+F5 denir.
4. Şirket mail şifresi ya da kimlik bilgisi asla saklanmaz (mail = .eml taslağı).

### Tek kaynak
5. Formül tek yerde (`src/lib`); sayfa kendi hesabını yazmaz.
6. Varsayılan değer yalnızca `settingsDefaults.ts`'te; sayfada `?? 480` gibi
   ikinci bir varsayılan yazılmaz.
7. Pres, kategori, depo gibi listeler tanım tablosundan okunur; master
   data'da geçen ama tanımlanmamış pres listelere girmez, uyarı olarak
   gösterilir ve sunucu reddeder.
8. Bir kural değişirse motor (`scheduler`/`planPipeline`), `planAudit` ve
   `planValidator` birlikte güncellenir. Validator bağımsız kalır: motor
   kodunu import etmez, kuralı kendisi yeniden yazar.

### Sunucu
9. Her fonksiyon `guardedQuery` / `guardedMutation`; korumasız `query(` yok
   (istisnalar yalnızca `auth.ts`, `authInternal.ts`).
10. Kullanıcıya gidecek hata `throw new ConvexError('…')`; düz `Error`
    üretimde gizlenir. Mesaj İngilizce, kısa ve ne yapılacağını söyler.
11. Planı etkilemeyen kayıt `affectsPlan: false` (ör. Prediction OEE).
12. Şema değişikliği geriye uyumlu: yeni alan `v.optional`; eski veriyi
    çeviren kod `planRuns.migrateSettings`'e bir kerelik bayrakla eklenir.
13. Kayıt önce kurala göre denetlenir (ör. `patternProblem`, `pressDay`
    sorunları); plana alınamayacak kayıt kaydedilmez.

### Kütüphane
14. `src/lib`'deki motor dosyaları sunucuda da derlenir: yalnızca göreli
    import (`./x`), `@/` takma adı yok.
15. Saf fonksiyon, React/Convex bağımlılığı yok; her kurala test.

### Arayüz
16. Arayüz metinleri İngilizce, kod yorumları Türkçe.
17. Kayıt `useSafeMutation` / `friendlyError` ile; hata "Not saved" + neden
    olarak gösterilir, "[CONVEX …]" metni kullanıcıya çıkmaz.
18. Silme işlemleri `window.confirm` ister (uiGuards testi denetler).
19. Her sayfa `PageHeader` ile başlar (`src/components/PageHeader.tsx`):
    başlık, tek satır özet, uzun açıklama mavi **i** (`InfoTip`) içinde —
    üzerine gelince (dokunmatikte tıklayınca) açılır. Sayfa içindeki uzun
    açıklamalar da `InfoTip`'e konur; sayfada yalnızca kısa satır kalır.
20. İlişkili sayfalara kısayollar başlığın sağındadır. Liste tek yerde:
    `RELATED_PAGES` (`src/lib/navigation.ts`), etiketler menüden gelir.
    Ör. Work Calendar ↔ Capacity Dashboard. Yeni sayfa eklenince buraya da
    eklenir.
21. Uzun sayfalar gizle/göster bölümlerine ayrılır (`CollapsibleSection`).
22. Bir kural değişirse Planning Logic sayfası da güncellenir.

### Doğrulama (commit öncesi)
```
# convex/_generated yoksa geçici taslak (commit'e girmez)
mkdir -p convex/_generated
printf "import { anyApi } from 'convex/server'\nexport const api: any = anyApi\nexport const internal: any = anyApi\n" > convex/_generated/api.ts
printf "export { queryGeneric as query, mutationGeneric as mutation, actionGeneric as action, internalQueryGeneric as internalQuery, internalMutationGeneric as internalMutation, internalActionGeneric as internalAction, httpActionGeneric as httpAction } from 'convex/server'\n" > convex/_generated/server.ts
npx tsc --noEmit -p .
npx vitest run
npx vite build
rm -rf convex/_generated .output
```

---

## 5. Sayfalar ve bağlantıları

| Sayfa | Rota | Ne yapar | İlişkili |
|---|---|---|---|
| Production Plan | `/planlama` | plan, Gantt, geç işler, onay | Capacity Dashboard, Work Calendar, Alarms, Planning Logic |
| Overview | `/planningexpert` | günlük durum | Plan |
| Capacity Dashboard | `/capacity` | haftalık kapasite / talep, mesai | Work Calendar, Plan, Presses |
| Raw Material Coverage | `/hammadde` | hammadde MRP, sipariş | SAP Data, Storage Locations, Master Data |
| Alarms | `/alarms` | planı aksatan kalıp/makine | Plan |
| SAP Data | `/sapdata` | ZPP, ZPP_DAILY, MB52, MB51 yükleme | Demand, Stock, Actuals, Storage Locations |
| Planning Logic | `/planlogic` | kuralların açıklaması | hepsi |
| Demand / Stock / Actuals | `/siparisler` `/stoklar` `/gerceklesen` | yüklenen veri | SAP Data |
| Master Data | `/referanslar` | parça verisi, Accepted OEE | Presses, Plan |
| Presses | `/makineler` | pres, hol, kategori | Work Calendar, Capacity Dashboard |
| Work Calendar | `/takvim` | pres takvimi, mesai, tatil, duruş, ayarlar | Capacity Dashboard, Presses, Plan |
| Storage Locations | `/depolar` | depo matrisi | Stock, Raw Material Coverage |
| Performance | `/performans` | plan / gerçekleşen, kapasite katsayısı | Actuals, Plan |
