# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-2040 · src/routes/machine-followup/index.tsx · degisiklik-yok: Toplantıda odak sayfa machine-followup/index.tsx incelendi. Dört üst kutu (plana engel, duran tezgâh, açık arıza, 14 gün bakım) ve açık arıza listesi, veriyi doğru kaynaklardan okuyup doğru sayfalara bağlıyor; planlama ve vardiya açısından yanlış veri ya da kırık bağlantı bulunmadı. Bulgular düşük öncelikli: tipler inline ca
- 20261101-1940 · src/routes/machine-followup/breakdowns.tsx · degisiklik-yok: Toplantıda odak sayfa machine-followup/breakdowns.tsx incelendi (ilk 220 satır). Bildirim formu, tezgâh durduş bilgisi ve Alarms/Reports bağlantıları sayfa içinde tutarlı görünüyor. Fotoğraf yükleme hatasının kullanıcıya gösterilmediği ve sayfa ilişkilerinde tekrar eden yardımcıların (inputClass, hhmm, minuteOf) ortak y
- 20261101-1840 · src/routes/kpi/weekly/entry.tsx · degisiklik-yok: Odak sayfa src/routes/kpi/weekly/entry.tsx, yalnızca 8 satırlık bir sarmalayıcı: KpiSeriesEntry bileşenini period="week" ile çağırıyor, kendi veri sorgusu ya da yazma işlemi yok. Planlama, vardiya ve amir açısından bu sayfada doğrulanabilir bir hata ya da katman ihlali bulunmadı. Durum özetindeki 'alt sayfalar eksik mi' sorusu kap

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Inline tip cast'leri (breakdowns, maintenance) convex/schema.ts ile çakışabilir; ortak tip kullanımı şema korunan alanı olduğu için kullanıcı onayı gerektirir.
- Açık arıza satırındaki 'running' ve 'down' metinleri text-amber-700 ve text-destructive gibi sabit renk sınıfları kullanıyor; tema token'ına taşınması görsel tutarlılığı artırır (küçük, ama genel stil kararı).
- Açık arıza satırı sayfadan ilgili arıza kaydına gitmiyor; vardiya amiri için breakdowns sayfasında ilgili kayda odaklanan bir bağlantı ya da filtre, 30 saniyelik bilgi ihtiyacını kısaltır (navigasyon kararı, kullanıcı onayı).
- 'Maintenance, next 14 days' kutusu bakım sayfasına gidiyor ama 14 günlük filtreyi uygulamıyor; bağlantıya tarih filtresi parametresi eklenirse amir tek tıkla ilgili kayda ulaşır (route arama parametresi, kullanıcı onayı).
- Bu sayfanın planlama mantığına etkisi yok; plan uyarıları usePlanAlarms üzerinden geliyor. Planning Logic sayfasında 'duran tezgâh, beklenen dönüş boşsa dışarıda kalır' kuralının anlatıldığı doğrulanmalı (planlogic.tsx korunan alan, yalnız öneri).
- Fotoğraf yükleme hatası (submit içinde response.ok kontrolü ve throw) yakalanmıyor; hata ErrorBanner'a bağlanmalı. Dosyanın geri kalanı okunmadan yazılmadı, önce ilgili JSX doğrulanmalı.
- Bildirim formundaki Work center / Problem type listeleri için 'as' cast yerine ortak tip kullanılmalı; Breakdown tipi convex şemasıyla çakışma riski taşıyor (convex/schema.ts korunan alan, kullanıcı onayı gerekir).
- inputClass, hhmm ve minuteOf yardımcıları birçok sayfada kopyalanmış olabilir; src/lib altında tek kaynağa taşınması mimari açıdan iyi olur (birden çok dosya, kullanıcı onayı).
- Problem tipi listesi boşken uyarı 'Admin page (Lists → Machine problem types)' diyor ama tıklanabilir bağlantı yok; /settings veya /admin'e link eklenmesi vardiya amirinin 30 saniyelik ihtiyacını kısaltır (navigasyon kararı, kullanıcı onayı).
- Durduran arıza için 'beklenen dönüş' boşsa tezgâh çözülene kadar planda dışarıda kalıyor; bu kuralın planlogic.tsx sayfasında da anlatıldığı doğrulanmalı (korunan alan, yalnız öneri).
