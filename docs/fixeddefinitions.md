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
| 12 | ~~Hol adı boş bırakılırsa "Hall 1"~~ | hol zorunlu; boşsa kayıt reddedilir | `convex/presses.ts` | K | Kaldırıldı (2026-10-02, plant genişletme aşama 5) |
| 13 | Bakiye ve bugünün ihtiyacı | ertesi iş günü, teslim saatinde | `planPipeline.ts` | P | |
| 14 | Varış tarihi olmayan yoldaki rulo | bu hafta gelmiş sayılır | `rawMrp.ts`, `planning.ts` | P | |
| 15 | Yoldakiler Excel'inde birim "TO" | tona çevrilir (×1000) | `sapParsers.ts` | P | |
| 16 | Oturum süresi | 12 saat | `authRules.ts`, `convex/authInternal.ts` | K | |
| 17 | Yeni parola kuralı | en az 8 karakter, en az bir harf ve bir rakam; kullanıcı adı ve `admin` olamaz (eski parolalar çalışır) | `src/lib/authRules.ts` (sunucu ve ekran aynı kural) | P | P — 2026-10-03 (eski: 4 karakter) |
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
| 25 | ~~Varsayılan depolar 2009, 1009~~ | tiksiz depo sayılmaz; hiç "Finished goods" tiki yoksa plan uyarır | `stockLocations.ts` | K | Kaldırıldı (2026-10-02). Mevcut kurulumda geçiş tikleri veriye yazar |

| 36 | ~~Ülke RO, saat dilimi Europe/Bucharest~~ | fabrika kaydında (`plants`), fabrika açılırken zorunlu; bilinmiyorsa UTC | `convex/plantLocale.ts` | K | Kaldırıldı (2026-10-02). Plant 1'e geçişte yazılır |
| 37 | İlk kurulum kullanıcısı admin / admin | yalnızca platformun ilk kurulumu (hiç kullanıcı yokken); fabrikada kullanıcıyı creator geçici şifreyle açar | `convex/auth.ts` | P | Kalır |
| 38 | Hatalı girişte kilit | art arda 5 hatalı parola | `src/lib/authRules.ts` (MAX_FAILED_LOGINS) | P | P — 2026-10-03 |
| 39 | Kilit süresi | 15 dakika; yeni parola verilince hemen kalkar | `src/lib/authRules.ts` (LOCKOUT_MS) | P | P — 2026-10-03 |

Not: Eski "14 gün stok = acil" kuralının kodu kaldırıldı; acil tanımı stok
projeksiyonundan gelir.

## OEE (docs/oeedashboard.md) — karar: tesise özel hiçbir değer kodda yok (2026-09-27)

Planlamacı: "manuel programın kodunda yazılı bir değer olmamalı". Aşağıdakiler
kullanıcının **OEE → Settings** sayfasında tanımlanır (`oeeSettings` tablosu):

| # | Konu | Nerede |
|---|---|---|
| 29 | Alanlar (üstteki düğmeler) ve seçim türü (masraf yeri / makine) | Settings → Areas |
| 30 | Masraf yeri adları ve alanı | Settings → Cost centers |
| 31 | Vardiya grubu kodu → vardiya numarası | Settings → Shifts |
| 32 | Kayıp sayılan / mola sayılan Reason Code 1 | Settings → Reason Code 1 |
| 33 | Kayıp grupları (Reason Code 2): ad, grafik sütunu, arıza (MTTR/MTBF) | Settings → Loss groups |
| 34 | Setup sayılan duruş metinleri (planlı / plansız) | Settings → Setups |
| 35 | Setup sonrası OK için üretim süresi, trend hafta sayısı, liste uzunluğu | Settings → Numbers |

Programda kalanlar yalnızca dosya biçimidir (sayfa adları, sütun başlıkları,
formüller) ve "Suggest from data" düğmesinin öneri değerleri
(`src/lib/settingsDefaults.ts` → `OEE_SUGGESTED`: 60 dk, 10 hafta, 10 satır) —
öneri kaydedilmeden hiçbir hesap onu kullanmaz. Duruş satırlarını okuma sınırı
(bir sorguda 8 gün) teknik sınırdır.
