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
| 11 | Genel çalışma günü seçilmemişse | — | — | Kaldırıldı: pres takvimi esas | — |
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
| 22 | Acil hammadde süresi | 3 iş günü (varsayılan) | Work Calendar ayarı | K — uygulandı | K |
| 23 | Kalıp setup'ının çay/yemek molasından geçebilmesi | çay, yemek, mola türleri | `planPipeline.ts` (SETUP_THROUGH_KINDS) | P | |
| 24 | Vinç kontrolünde komşu güne bakış | 360 dk | `scheduler.ts` (BOUNDARY_REACH) | P (teknik) | |
| 26 | Tekrarlayan mesai resmi tatilde | çalışmaz (tatilde mesai tarihli açılır) | `pressCalendar.ts` | P | P — onaylandı |
| 27 | "İş günü" sayarken mesai | sayılmaz: yalnızca normal vardiyası olan gün | `capacityModel.ts` (isPlantWorkingDate) | P | P — onaylandı |
| 28 | Normal vardiyayla ya da başka mesaiyle çakışan mesai | kaydedilmez | `pressCalendar.ts` | P | |
| 25 | Varsayılan depolar (matriste tik yoksa) | bitmiş ürün ve hammadde: 2009, 1009; üretim girişi: 2009 | `stockLocations.ts` | P | |

Not: Eski "14 gün stok = acil" kuralının kodu kaldırıldı; acil tanımı stok
projeksiyonundan gelir.

## OEE (docs/oeedashboard.md) — karar: programda sabit (şimdilik)

| # | Konu | Değer | Kodda |
|---|---|---|---|
| 29 | Masraf yeri adları | 51010171 Transfer, 51010173 Progressive, 51010172 APR | `src/lib/oee.ts` (COST_CENTERS) |
| 30 | Vardiya kodu → vardiya | UB61/UB64 = 1, UB62/UB65 = 2, UB63/UB66 = 3 | `src/lib/oee.ts` (SHIFT_NUMBER) |
| 31 | Kayıp grupları | KLP, STP, ARZ, KSD, KON, OFC, YNT, # ; Others = YNT + OFC + KON | `src/lib/oee.ts` (LOSS_GROUPS) |
| 32 | Trend uzunluğu | 10 hafta | `src/routes/oee/*.tsx` (WEEKS) |
| 33 | Listelerde ilk gösterilen | en kötü 10 kalıp, 15 neden | `src/routes/oee/losses.tsx` |
| 34 | Duruş satırı okuma sınırı | bir sorguda en çok 8 gün | `convex/oee.ts` |
| 35 | Setup sayılan duruşlar | DIE SETUP - PLANNED/UNPLANNED, REGLAJ MATRITA - PLANIFICATA/NEPLANIFICATA | `src/lib/oee.ts` (DIE_SETUP_TEXTS) |
| 36 | Setup sonrası OK için üretim | 60 dk (planlamacının kararı) | `src/lib/oee.ts` (STARTUP_RUN_MIN) |
