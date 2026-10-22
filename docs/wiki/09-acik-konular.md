# 09 · Açık konular ve riskler

> Son güncelleme: 2026-10-22 · Kaynak: bu sohbetler; **bütün açık işlerin tek listesi `todolist.md`** (burası yalnızca son dönemin özeti)

## Kullanıcının yapması gerekenler

| Konu | Ne | Neden |
|---|---|---|
| **Branch protection** | GitHub → Settings → Branches → `main` için *Require a pull request* + *Require status checks: verify* | Yayın otomatik; main'e giren her şey ~5 dk sonra canlı. `deploy.sh` birimleri **root** kurar |
| Gerçek veride lot bölme | Yayından sonra planı yeniden hesaplat; plan kontrolünde *Lots split…* satırına bak | Testler küçük senaryo; gerçek 30.000'lik lot davranışı doğrulanmadı |
| Gerçek veride geç iş payı | Overview → Late materials → *On time / Late share* ve *Why late* sayılarını bir örnekte elle doğrula | Yeni tanım ([03](03-gec-is-tanimi.md)) |
| Tedarik süreleri | Raw Material Coverage → *Lead times* tablosunu doldur (varsayılan 14 gün tahmindir) | Girilmeyen sac varsayılanı kullanır, "not entered" görünür |

## Devam

- **Yarım iş yok.** main `fef0b72`, açık PR yok, açık dal yok (yalnız `main`).
- **Sıradaki adım:** yukarıdaki kullanıcı doğrulamaları (branch protection, gerçek veride lot bölme ve geç iş payı, tedarik süreleri). Sonuç / sorun gelirse yeni oturumda ele alınır.
- **Dikkat edilecek yerler:** lot bölme `src/lib/planPipeline.ts` `planOnce` (satır ~899) ve yerel arama "Lot bölme" bloğu (~1264), `splitLot` `src/lib/scheduler.ts` (~176);
  geç iş payı `lateShare` (~1465), `explainLate` (~1511), `lateItems` (~1622). Satır numaraları kayabilir; `grep` ile bul.

## Bilinen sınırlar / riskler

- **Müşteri duruş süresi tahmindir:** müşterinin tüketim saatleri bilinmiyor; *son parça* ve *ortalama* gecikme gösterilir.
- **Lot bölme Min. lotun altına inmez** (r8 "tam rulo **ya da** ≥ Min. lot" izin verse de bölme muhafazakârdır). Min. lotlu parçalarda bölme hiç denenmez.
- **WebSocket yedek modunun kök nedeni sunucuda doğrulanamadı** (zayıf mobil sinyal ya da yayın sonrası meşgul sunucu olası). PR #20 geri dönüşü ve ölçüm satırını ekledi; tekrar ederse *Live data check* değeri istenir.
- **Sunucu oturumuna mesaj gönderilemez** (bulut oturumundan): yayın zamanlayıcıdadır; sunucu oturumu yalnızca gözlemci / işletmendir.
- **Losses Trend'den çıkan setup analizi** ayrı bir sayfa olarak istenirse yeniden eklenecek (PR #12 notu).
- **Sabit sayılar** (`docs/fixeddefinitions.md`): bazıları hâlâ kodda; kullanıcı ayarına taşınması tartışılacak.

## Sıradaki olası işler (karar bekler)

- Müşteri tüketim saatleriyle gerçek duruş süresi tahmini (ZPP_DAILY saat kırılımı yok; veri gerekir).
- Lot bölmede 4+ parça ve farklı preslerde parça (şu an 2–3 parça, aynı preste).
- `todolist.md` §4 (kurumsallaşma): güvence, veri modeli, güvenlik, kod ve doküman düzeni.
