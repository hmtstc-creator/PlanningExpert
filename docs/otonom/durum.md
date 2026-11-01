# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-1840 · src/routes/kpi/weekly/entry.tsx · degisiklik-yok: Odak sayfa src/routes/kpi/weekly/entry.tsx, yalnızca 8 satırlık bir sarmalayıcı: KpiSeriesEntry bileşenini period="week" ile çağırıyor, kendi veri sorgusu ya da yazma işlemi yok. Planlama, vardiya ve amir açısından bu sayfada doğrulanabilir bir hata ya da katman ihlali bulunmadı. Durum özetindeki 'alt sayfalar eksik mi' sorusu kap
- 20261101-1740 · src/routes/kpi/weekly/dashboard.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kpi/weekly/dashboard.tsx incelendi. Dosya 8 satırlık bir sarmalayıcı: KpiDashboardPage bileşenini period="week" ile çağırıyor, kendi veri sorgusu ya da yazma işlemi yok. Planlama, vardiya ve amir açısından ciddi bir hata ya da katman ihlali bulunmadı. Önceki toplantılardaki 'alt sayfalar yalnız
- 20261101-1640 · src/routes/kpi/monthly/entry.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kpi/monthly/entry.tsx incelendi. Dosya 8 satırlık bir sarmalayıcı: KpiSeriesEntry bileşenini period="month" ile çağırıyor, kendi veri sorgusu ya da yazma işlemi yok. Bu, önceki toplantıdaki 'alt sayfalar yalnız 8 satır, yönlendirme mi eksik bileşen mi' sorusunu yanıtlıyor: sayfa eksik değil, bileş

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Durum özeti üreticisi (scripts/otonom/gunluk.mjs) aynı öneri maddelerini her toplantıda yeniden ekliyor. 'Alt sayfalar 8 satır, doğrulanmalı' maddesi kapatılmalı ve bekleyen öneriler tekilleştirilmeli; scripts/ korunan alan olduğu için kullanıcı onayı gerekir.
- Sayfa ilişki haritası (scripts/otonom/harita.mjs) yalnız route dosyasını tarıyor; /kpi/monthly/* ve /kpi/weekly/* için Okur/Yazar sütunları boş kalıyor. Haritanın import edilen bileşenleri (KpiSeriesEntry, KpiDashboard) de izlemesi gerekiyor; kullanıcı onayı gerektirir.
- KpiSeriesEntry ve KpiDashboard bileşenleri okunmadan ortak veri sorgusu ve tazelik bilgisi hakkında karar verilemez. Bu bileşenler okunduktan sonra, bir sonraki toplantıda bu konu tekrar ele alınabilir.
- KPI giriş ve dashboard ekranlarına 'son giriş: tarih' göstergesi eklenmesi vardiya amirinin 30 saniyelik bilgi ihtiyacını karşılar. Bu, kpi/monthly ve kpi/weekly sorgularına dokunduğu için kullanıcı onayı gerektirir.
- KPI verileri ile /performans ve OEE ekranları (/oee/mttr, /oee/losses) arasında açık bir bağlantı yok. Navigasyon kararı olduğu için kullanıcı onayı beklenmeli.
- Durum özetindeki 'alt sayfalar yalnız 8 satır, doğrulanmalı' maddesi üç ardışık toplantıda aynı şekilde tekrarlandı. Bu madde scripts/otonom/gunluk.mjs tarafında kapatılmalı; korunan alan olduğu için kullanıcı onayı gerekir.
- Durum özetindeki 'alt sayfalar yalnız 8 satır, doğrulanmalı' maddesi kapatılabilir: entry.tsx ve dashboard.tsx gerçek sayfa sarmalayıcısı, eksik bileşen değil. Bu, durum özetini üreten gunluk.mjs tarafında güncellenmeli.
- Haritanın (scripts/otonom/harita.mjs, korunan alan) import edilen bileşenleri de izlemesi gerekiyor. Böylece KpiSeriesEntry ve KpiDashboard üzerinden gerçek query/mutation bağlantıları görünür ve /kpi/* sayfaları 'veri yok' gibi kalmaz. Kullanıcı onayı ve scripts/ değişikliği gerektirir.
- KPI giriş ekranında (KpiSeriesEntry) kaydetme sonrası ya da girişte 'son girilen dönem' göstergesi, vardiya amirinin 30 saniyelik bilgi ihtiyacını karşılar. Bu, kpi/monthly ve kpi/weekly sorgularına dokunduğu için kullanıcı onayı gerektirir.
- KPI verileri ile planlama ve OEE ekranları (/performans, /oee/mttr, /oee/losses) arasında açık bir bağlantı yok. Bağlantı eklemek navigasyon kararı olduğu için kullanıcı onayı beklenmeli.
