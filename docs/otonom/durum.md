# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-1940 · src/routes/machine-followup/breakdowns.tsx · degisiklik-yok: Toplantıda odak sayfa machine-followup/breakdowns.tsx incelendi (ilk 220 satır). Bildirim formu, tezgâh durduş bilgisi ve Alarms/Reports bağlantıları sayfa içinde tutarlı görünüyor. Fotoğraf yükleme hatasının kullanıcıya gösterilmediği ve sayfa ilişkilerinde tekrar eden yardımcıların (inputClass, hhmm, minuteOf) ortak y
- 20261101-1840 · src/routes/kpi/weekly/entry.tsx · degisiklik-yok: Odak sayfa src/routes/kpi/weekly/entry.tsx, yalnızca 8 satırlık bir sarmalayıcı: KpiSeriesEntry bileşenini period="week" ile çağırıyor, kendi veri sorgusu ya da yazma işlemi yok. Planlama, vardiya ve amir açısından bu sayfada doğrulanabilir bir hata ya da katman ihlali bulunmadı. Durum özetindeki 'alt sayfalar eksik mi' sorusu kap
- 20261101-1740 · src/routes/kpi/weekly/dashboard.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kpi/weekly/dashboard.tsx incelendi. Dosya 8 satırlık bir sarmalayıcı: KpiDashboardPage bileşenini period="week" ile çağırıyor, kendi veri sorgusu ya da yazma işlemi yok. Planlama, vardiya ve amir açısından ciddi bir hata ya da katman ihlali bulunmadı. Önceki toplantılardaki 'alt sayfalar yalnız

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Fotoğraf yükleme hatası (submit içinde response.ok kontrolü ve throw) yakalanmıyor; hata ErrorBanner'a bağlanmalı. Dosyanın geri kalanı okunmadan yazılmadı, önce ilgili JSX doğrulanmalı.
- Bildirim formundaki Work center / Problem type listeleri için 'as' cast yerine ortak tip kullanılmalı; Breakdown tipi convex şemasıyla çakışma riski taşıyor (convex/schema.ts korunan alan, kullanıcı onayı gerekir).
- inputClass, hhmm ve minuteOf yardımcıları birçok sayfada kopyalanmış olabilir; src/lib altında tek kaynağa taşınması mimari açıdan iyi olur (birden çok dosya, kullanıcı onayı).
- Problem tipi listesi boşken uyarı 'Admin page (Lists → Machine problem types)' diyor ama tıklanabilir bağlantı yok; /settings veya /admin'e link eklenmesi vardiya amirinin 30 saniyelik ihtiyacını kısaltır (navigasyon kararı, kullanıcı onayı).
- Durduran arıza için 'beklenen dönüş' boşsa tezgâh çözülene kadar planda dışarıda kalıyor; bu kuralın planlogic.tsx sayfasında da anlatıldığı doğrulanmalı (korunan alan, yalnız öneri).
- AI önerisi: arıza açıklamasından problem tipi ve tahmini duruş süresi önerilebilir; kullanıcı onayıyla, otomatik kayıt olmadan (büyük fikir, planlama mantığına dokunmaz).
- Durum özeti üreticisi (scripts/otonom/gunluk.mjs) aynı öneri maddelerini her toplantıda yeniden ekliyor. 'Alt sayfalar 8 satır, doğrulanmalı' maddesi kapatılmalı ve bekleyen öneriler tekilleştirilmeli; scripts/ korunan alan olduğu için kullanıcı onayı gerekir.
- Sayfa ilişki haritası (scripts/otonom/harita.mjs) yalnız route dosyasını tarıyor; /kpi/monthly/* ve /kpi/weekly/* için Okur/Yazar sütunları boş kalıyor. Haritanın import edilen bileşenleri (KpiSeriesEntry, KpiDashboard) de izlemesi gerekiyor; kullanıcı onayı gerektirir.
- KpiSeriesEntry ve KpiDashboard bileşenleri okunmadan ortak veri sorgusu ve tazelik bilgisi hakkında karar verilemez. Bu bileşenler okunduktan sonra, bir sonraki toplantıda bu konu tekrar ele alınabilir.
- KPI giriş ve dashboard ekranlarına 'son giriş: tarih' göstergesi eklenmesi vardiya amirinin 30 saniyelik bilgi ihtiyacını karşılar. Bu, kpi/monthly ve kpi/weekly sorgularına dokunduğu için kullanıcı onayı gerektirir.
