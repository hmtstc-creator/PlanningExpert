# 03 · Geç iş tanımı

> Son güncelleme: 2026-10-28 · Kaynak: `scheduler.ts` (`deliveryCheck`), `planPipeline.ts` (`lateShare`, `explainLate`), `planValidator.ts`
> Kullanıcıya dönük anlatım: Planning Logic → *Late jobs are re-planned*

## Tanım

**ZPP günlük ihtiyaç rehberdir.** Her ihtiyaç günü bir **teslim noktasıdır**: o güne kadarki **birikimli** ihtiyaç, günün **teslim saatinde**
(`deliveryCutoffMinute`, varsayılan 08:00) hazır olmalıdır. Bakiye ve bugüne düşen ihtiyaç **ertesi gün** teslim saatinde istenir.
Teslimde tatil gözetilmez (müşteri tatilde de isteyebilir).

Bir lot, **herhangi bir** kontrol noktasında gereken pay hazır değilse geçtir. Rapor **ilk kaçırılan** noktayı gösterir.

**Uzun vade lotu geç sayılmaz** (2026-10-28): ZPP_DAILY yüklüyken haftalık ZPP'den gelen lot yalnızca boş kapasiteyi doldurur ([02](02-planlama-motoru.md)).
Günlük lotun kontrol noktaları da yalnızca günlük talebi sayar. Doğrulayıcının kendi kuralı: yalnızca uzun vade adedi eksikse bu bir
müşteri duruşu değildir, `summary.longTermShort`'ta sayılır.

## Pay (adet ∝ üretim dakikası)

Parçalar, işin üretim (`run`) dakikaları boyunca düzgün çıkar; setup ve kalite onayı adet vermez. Böylece:

- **Needed qty** — ilk kaçırılan teslim noktasına kadar gereken adet (birikimli ZPP; lot büyüklüğü değil: 8 günü karşılayan 40.000'lik lot ilk noktada yalnızca ilk günün ihtiyacını borçludur).
- **On time** — teslim anında hazır olan pay (`onTimeQty`).
- **Late share** — kalan pay (`lateQty`), **ortalama** gecikme (`avgLateHours`) ve **son parçanın** gecikmesi (`lateHours` = hazır − teslim).

Son parçanın gecikmesi: üretim teslimden 6 saat sonra başlayıp j saat sürerse tamamı **6 + j saat** geç. Müşteri ilk parçalardan beslendiği için
gerçek bekleme ortalamaya daha yakındır. Müşterinin gerçek duruş süresi, onun tüketim saatleri bilinmeden **hesaplanmaz** (tahmindir).

Örnek (`lateShare.test.ts`): 6000 adet bakiye, 600 adet/saat, tek vardiya → teslimde 5100 hazır (**%85**), 900 adet (**%15**) 1,5 saat sonra; ortalama ≈ 0,8 saat.

## "Why late" — neden geç

Plandan hesaplanır, en belirleyici önce: payın özeti · zaten gecikmiş (bakiye / bugüne kadar stok yetmiyor) · **teslime kadar preste yeterli üretim süresi yok**
(var olan süre ↔ gereken süre, eksik saat) · pres önceden dolu (kaç iş / saat; daha önce gereken, dondurulmuş, daha sonra gereken, plan override ile öne alınanlar) ·
pres setup'tan önce bekledi · pres kapalı saatler (yalnızca yukarıdaki "yetersiz süre" yoksa) · kapasite katsayısı < %100.
Satıra dokununca hesap adımları ve **kontrol edilecek girdiler** (talep, stok, hız, setup, vardiya) bağlantılarıyla açılır — girdi yanlışsa parça yalnızca *geç görünür*.

## Bağımsız doğrulama

`planValidator.ts` motorun kodunu kullanmadan stoğu **saat saat yeniden oynatır** (SAP dosyaları + planlanan işler). Her stok eksiği bir **gerçek müşteri duruşu**dur;
geç liste bununla **birebir** uyuşmalıdır (eksik adet, toparlanma saati, gecikme). `lateShare.test.ts` aynı sayıları karşılaştırır.
Denetlenen kurallar (`rule(...)`): r1 pres aynı anda tek iş · r2 kalıp aynı anda tek preste · r4 tesis geneli setup sınırı · r5 uygun pres ·
r6 çalışma zamanı · r7 setup gün sınırını aşmaz · r8 lot kuralları (tam rulo ya da ≥ Min. lot, kalıp ömrü, SPM) · **r10 dondurulmuş işler onaylı kesimle aynı** ·
**r11 ufuk talebi stok + üretimle karşılanır ya da plansız listelenir** · r12 setup'sız iş aynı kalıbı izler. Lot bölme (PR #19) bu kuralların hiçbirini bozmaz (test).

## Dokunulmaması gerekenler

- Puan sırası *plansız → geç malzeme → geç saat → geç lot* (`planPipeline.ts` `score`).
- Teslim saati ve tatil kuralı (`computeDeadline`).
- Doğrulayıcının motordan bağımsızlığı.
