# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-1740 · src/routes/kpi/weekly/dashboard.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kpi/weekly/dashboard.tsx incelendi. Dosya 8 satırlık bir sarmalayıcı: KpiDashboardPage bileşenini period="week" ile çağırıyor, kendi veri sorgusu ya da yazma işlemi yok. Planlama, vardiya ve amir açısından ciddi bir hata ya da katman ihlali bulunmadı. Önceki toplantılardaki 'alt sayfalar yalnız
- 20261101-1640 · src/routes/kpi/monthly/entry.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kpi/monthly/entry.tsx incelendi. Dosya 8 satırlık bir sarmalayıcı: KpiSeriesEntry bileşenini period="month" ile çağırıyor, kendi veri sorgusu ya da yazma işlemi yok. Bu, önceki toplantıdaki 'alt sayfalar yalnız 8 satır, yönlendirme mi eksik bileşen mi' sorusunu yanıtlıyor: sayfa eksik değil, bileş
- 20261101-1540 · src/routes/kpi/monthly/dashboard.tsx · degisiklik-yok: Odak sayfa src/routes/kpi/monthly/dashboard.tsx incelendi. Dosya 8 satırlık bir sarmalayıcı: KpiDashboardPage'i period="month" ile çağırıyor, veri sorgusu ya da yazma işlemi içermiyor. Önceki toplantının açık sorusu olan 'alt sayfalar yönlendirme mi, eksik bileşen mi' bu okumayla yanıtlandı: yönlendirme ya da eksik değil, ort

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Durum özetindeki 'alt sayfalar yalnız 8 satır, doğrulanmalı' maddesi üç ardışık toplantıda aynı şekilde tekrarlandı. Bu madde scripts/otonom/gunluk.mjs tarafında kapatılmalı; korunan alan olduğu için kullanıcı onayı gerekir.
- Durum özetindeki 'alt sayfalar yalnız 8 satır, doğrulanmalı' maddesi kapatılabilir: entry.tsx ve dashboard.tsx gerçek sayfa sarmalayıcısı, eksik bileşen değil. Bu, durum özetini üreten gunluk.mjs tarafında güncellenmeli.
- Haritanın (scripts/otonom/harita.mjs, korunan alan) import edilen bileşenleri de izlemesi gerekiyor. Böylece KpiSeriesEntry ve KpiDashboard üzerinden gerçek query/mutation bağlantıları görünür ve /kpi/* sayfaları 'veri yok' gibi kalmaz. Kullanıcı onayı ve scripts/ değişikliği gerektirir.
- KPI giriş ekranında (KpiSeriesEntry) kaydetme sonrası ya da girişte 'son girilen dönem' göstergesi, vardiya amirinin 30 saniyelik bilgi ihtiyacını karşılar. Bu, kpi/monthly ve kpi/weekly sorgularına dokunduğu için kullanıcı onayı gerektirir.
- KPI verileri ile planlama ve OEE ekranları (/performans, /oee/mttr, /oee/losses) arasında açık bir bağlantı yok. Bağlantı eklemek navigasyon kararı olduğu için kullanıcı onayı beklenmeli.
- KpiSeriesEntry ve KpiDashboard bileşenlerinin ortak veri sorgusu ve tazelik bilgisini tek yerde tutup tutmadığı bir sonraki toplantının odağı olabilir; bileşen dosyası bu toplantıda okunmadı.
- Sayfa ilişki haritası (scripts/otonom/harita.mjs) yalnız route dosyasını tarıyor. /kpi/monthly/* ve /kpi/weekly/* sayfaları components/KpiDashboard bileşenine bağlı olduğu için Okur/Yazar sütunları boş kalıyor ve harita KPI akışını yanlış 'veri yok' gibi gösteriyor. Haritanın import edilen bileşen
- Bekleyen öneri listesindeki 'alt sayfalar yalnız 8 satır, doğrulanmalı' maddesi kapatılabilir: dosyalar gerçek sayfa, yönlendirme değil. Durum özetinin güncellenmesi gerekir.
- KPI ana sayfası, aylık ve haftalık dashboard'lar için ortak KpiDashboard bileşeninin veri sorgusu ve tazelik bilgisi tek yerde tutuluyor mu, bu bileşen incelenmeli (sonraki toplantının odağı olabilir).
- KPI ana sayfasında veri tazeliği ya da son girilen dönem bilgisi yok. Vardiya amiri için her grubun yanında 'son giriş: tarih' gibi bir gösterge eklenmesi 30 saniyelik bilgi ihtiyacını karşılar. Bu, kpi/monthly ve kpi/weekly sorgularına dokunduğu için kullanıcı onayı gerektirir.
