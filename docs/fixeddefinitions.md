# Kodda sabit duran tanımlar

Kullanıcının girmediği, programın içinde sabit duran sayı ve koşullar. İleride
her biri için karar verilecek: **P** = programda sabit kalsın, **K** =
kullanıcı tanımlasın. "Öneri" sütunu geliştiricinin önerisidir, karar değildir.

| # | Konu | Şu anki değer | Kodda | Öneri | Karar |
|---|---|---|---|---|---|
| 1 | Plan ufku üst sınırı | en fazla 30 hafta | `planPipeline.ts` | P | |
| 2 | Hammadde MRP ufku üst sınırı | en fazla 60 hafta (ZPP'nin son haftasına kadar) | `planPipeline.ts` | P | |
| 3 | Senaryo araması: iyileşme olmazsa dur | 25 deneme | `planPipeline.ts` (NO_IMPROVEMENT_LIMIT) | K | |
| 4 | Senaryo araması süre sınırı | 2 dakika | `planPipeline.ts` (TIME_BUDGET_MS) | P | |
| 5 | Doluluk hedefinin ölçüldüğü pencere | ilk 7 gün | `planPipeline.ts`, `planValidator.ts` | K | |
| 6 | Geç işler için yeniden deneme turu | en fazla 6 tur | `planPipeline.ts` | P | |
| 7 | Kalıp ömrü uyarısı | vuruş limitinin %80'i | `moldLife.ts` (warnRatio) | K | |
| 8 | Brüt ağırlık "birim hatası" uyarısı | parça başı 50 kg'dan fazla ya da 1 g'dan az | `rawMrp.ts` | P | |
| 9 | "Çok rulo" uyarısı | bir işte 200'den fazla rulo | `planPipeline.ts` (MANY_COILS) | P | |
| 10 | "Yer tutucu" rulo ağırlığı | 1 kg ve altı: rulo kuralı uygulanmaz | `planning.ts`, `planValidator.ts` | P | |
| 11 | Genel çalışma günü seçilmemişse | Pzt–Cuma | `settingsDefaults.ts` | — (genel tikler kalkıyor) | |
| 12 | Hol adı boş bırakılırsa | "Hall 1" | `pressDraft.ts` | K (hol zorunlu) | |
| 13 | Bakiye ve bugünün ihtiyacı | ertesi iş günü, teslim saatinde | `planPipeline.ts` | P | |
| 14 | Varış tarihi olmayan yoldaki rulo | bu hafta gelmiş sayılır | `rawMrp.ts`, `planning.ts` | P | |
| 15 | Yoldakiler Excel'inde birim "TO" | tona çevrilir (×1000) | `sapParsers.ts` | P | |
| 16 | Oturum süresi | 12 saat | `authRules.ts`, `convex/authInternal.ts` | K | |
| 17 | En kısa şifre | 4 karakter | `authRules.ts`, `convex/auth.ts` | K | |
| 18 | İlk kurulum yöneticisi | kullanıcı adı ve şifre `admin` | `authRules.ts`, `convex/auth.ts` | K (ilk girişte değiştirme zorunlu) | |
| 19 | Plan yeniden hesaplama gecikmesi | kayıttan 4 sn sonra | `convex/planQueue.ts` | P | |
| 20 | Saklanan eski plan sayısı | 3 | `convex/planRuns.ts` | P | |
| 21 | Tek seferde okunan en fazla satır | MB51 20.000; ZPP ve MB52 8.000 (aşılırsa uyarı) | `convex/*.ts` | P | |
| 22 | Acil hammadde süresi | 3 iş günü | `planPipeline.ts` (RAW_URGENT_DAYS) | K — **karar verildi**, Work Calendar'a taşınacak | K |
| 23 | Kalıp setup'ının çay/yemek molasından geçebilmesi | çay, yemek, mola türleri | `planPipeline.ts` (SETUP_THROUGH_KINDS) | P | |
| 24 | Vinç kontrolünde komşu güne bakış | 360 dk | `scheduler.ts` (BOUNDARY_REACH) | P (teknik) | |
| 25 | Varsayılan depolar (matriste tik yoksa) | bitmiş ürün ve hammadde: 2009, 1009; üretim girişi: 2009 | `stockLocations.ts` | P | |

Not: Eski "14 gün stok = acil" kuralının kodu (`planning.ts`, urgentCoverDays)
artık etkisizdir; acil tanımı stok projeksiyonundan gelir. Bir sonraki
düzeltmede kaldırılacak.
