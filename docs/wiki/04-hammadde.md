# 04 · Hammadde (sac)

> Son güncelleme: 2026-10-24 · Kaynak: `src/lib/rawMrp.ts`, `src/lib/rawLeadTime.ts`, `src/lib/rawOrderExport.ts`, `convex/rawLeadTimes.ts`, `src/routes/hammadde.tsx`
> Kullanıcıya dönük: Planning Logic → *Raw material requirement (MRP)*

**Hammadde hesabı plandan bağımsızdır** (`rawMrp.ts`). Plan eklenirse aynı talep iki kez sipariş edilirdi: planın öne çekmesi ve rulo / Min. lot fazlası
aynı talebin zamanlaması ve yuvarlamasıdır; 10 günlük emniyet stoğu bu sapmayı karşılar.

## Hesap (Raw Material Coverage sayfası)

1. **Talep:** ZPP'nin son haftasına kadar haftalık kovalar; bakiye bu haftaya yazılır.
2. **Mamul stoğu** (parçanın cost center'ının WIP + bitmiş depoları; tanımı yoksa *Finished goods* tikli depolar — bkz. aşağıda *Cost center başına depolar*) en erken haftadan başlayarak (FIFO) düşülür.
3. **Sac ihtiyacı:** net adet × parça başı brüt ağırlık. Eş ürün aynı vuruştan çıkar; sac yalnızca asıl ürünün gramajıyla sayılır.
4. **Arz:** rulo stoğu, o kodu tüketen cost center'ların hammadde depolarından (tanımı yoksa *Raw material* tikli depolar) başlangıçtır; yoldakiler (Excel listesi) **varış haftasında** girer (tarih yok ya da geçmişse ilk hafta).
5. **Haftalık stok yürütme:** hafta başı stok + yoldan gelen + sipariş, o haftanın tüketimini **ve** hafta sonundan itibaren `rawCoverageDays` (10) **iş günü**nün tüketimini (emniyet) karşılamalı.
6. **Sipariş:** karşılamıyorsa **o hafta teslim edilecek** sipariş = eksik + standart ek (`rawOrderExtraKg`, 500 kg). Talep yoksa sipariş yok.
7. Satır = **bir rulo kodu** (parça değil); satırı açınca mamul bazında döküm (stok, kaç hafta yetiyor, sacın ilk gerektiği hafta) görünür.

`rawUrgentDays` (3): yalnızca Overview'daki **acil sac** listesini belirler (sacın gerçekten gerektiği gün, PR #13); sipariş haftasını kaydırmaz.

## Tedarik süresi ve "en geç sipariş günü" (PR #15)

- Tablo `rawLeadTimes` (plantId, `rawMaterialCode`, `leadTimeDays`, tedarikçi, not). Kod `'*'` = **varsayılan satır**; o da yoksa `SETTINGS_DEFAULTS.rawLeadTimeDays` (14).
  Satırı olmayan sac **"not entered"** işaretlenir. Süre boş bırakılırsa satır silinir.
- Süre **takvim günüdür** (tedarikçi takvimle verir; tatil fabrikanın takvimidir).
- **Order by = teslim haftasının Pazartesi'si − tedarik süresi.** Bugünden önceyse **late** (kırmızı), bu hafta içindeyse turuncu.
  Sayfada kartlar: *Order late*, *Order this week*; ana tabloda *Order by* sütunu; açık satırda her siparişin tarihi.
- Süre **yalnızca siparişi tarihler**: teslim haftasını, emniyet stoğunu ve üretim planını değiştirmez (`affectsPlan: false`).
- Excel (`rawOrderExport.ts`): *Orders* sayfasında süre ve ilk sipariş tarihi, yeni *Order by* sayfası. Outlook taslağı (`.eml`) aynı Excel'i ekler.

## Dokunulmaması gerekenler

- Plan eklenmez (mükerrer sipariş).
- Süre teslim haftasını kaydırmaz; yalnızca "en geç sipariş günü"nü hesaplar.
- Yeni sac tablosu şemada **ayrı tablo**dur; mevcut tablolara dokunulmadı (canlı veri).

## Cost center başına depolar (2026-10-24)

Aynı holdingde bir malzeme bir cost center'ın **bitmiş ürünü**, diğerinin **hammaddesi** olabilir; aynı kod
farklı depolarda farklı anlam taşır. Bu yüzden Storage Locations sayfasında her cost center'a üç depo listesi
verilir (tablo `costCenterStorage`, kural `src/lib/stockLocations.ts` → `stockScope`):

| Rol | Anlamı |
|---|---|
| **Production (WIP)** | MB51 101/102 buraya üretimdir; buradaki stok o cost center'ın bitmiş stoğuna da sayılır |
| **Finished goods** | plan, doğrulayıcı, Demand, Capacity Dashboard, MRP mamul netleştirmesi |
| **Raw material** | o cost center'ın tükettiği hammadde (MRP eldeki stok) |

- Parçanın cost center'ı = **ana makinesinin** (work center) cost center'ı; eş ürün aynı cost center'dadır.
- Hammadde kodu, onu tüketen parçaların cost center'larının hammadde depolarından sayılır (birleşim).
- Örnek: 171 ve 173 → WIP 2009, hammadde + bitmiş 1009; 172 → WIP 2010, hammadde + bitmiş 1009. 172 parçasının
  2009'daki stoğu sayılmaz; 172 parçası 171'in hammaddesiyse 171 için 1009'dan sayılır.
- Tanımı olmayan cost center ya da cost center'ı olmayan parça **depo tikleriyle** sayılır (eski davranış).
