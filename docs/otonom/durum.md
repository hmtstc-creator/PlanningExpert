# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-1540 · src/routes/kpi/monthly/dashboard.tsx · degisiklik-yok: Odak sayfa src/routes/kpi/monthly/dashboard.tsx incelendi. Dosya 8 satırlık bir sarmalayıcı: KpiDashboardPage'i period="month" ile çağırıyor, veri sorgusu ya da yazma işlemi içermiyor. Önceki toplantının açık sorusu olan 'alt sayfalar yönlendirme mi, eksik bileşen mi' bu okumayla yanıtlandı: yönlendirme ya da eksik değil, ort
- 20261101-1440 · src/routes/kpi/index.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kpi/index.tsx (KPI ana sayfası) incelendi. Sayfa yalnızca aylık ve haftalık KPI veri girişi ile dashboard sayfalarına giden dört bağlantı içeriyor; veri sorgusu, yazma işlemi ve planlama mantığı yok. Planlama, vardiya ve amir açısından ciddi bir hata ya da katman ihlali bulunmadı, bu yüzden görev yazılmad
- 20261101-1340 · src/routes/kayitlar.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kayitlar.tsx (Karar Günlüğü) incelendi. Kayıt ekleme, kategori filtreleri ve silme akışı tutarlı bulundu. Ciddi sorun olarak, sayfa usePaginatedQuery ile yalnızca ilk 100 kaydı yüklüyor ama 'Load more' düğmesi yok. Bu yüzden 100'den eski kararlar hiçbir ekranda görünmüyor ve 'All (n)' ile kategori sayıları

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Sayfa ilişki haritası (scripts/otonom/harita.mjs) yalnız route dosyasını tarıyor. /kpi/monthly/* ve /kpi/weekly/* sayfaları components/KpiDashboard bileşenine bağlı olduğu için Okur/Yazar sütunları boş kalıyor ve harita KPI akışını yanlış 'veri yok' gibi gösteriyor. Haritanın import edilen bileşen
- Bekleyen öneri listesindeki 'alt sayfalar yalnız 8 satır, doğrulanmalı' maddesi kapatılabilir: dosyalar gerçek sayfa, yönlendirme değil. Durum özetinin güncellenmesi gerekir.
- KPI ana sayfası, aylık ve haftalık dashboard'lar için ortak KpiDashboard bileşeninin veri sorgusu ve tazelik bilgisi tek yerde tutuluyor mu, bu bileşen incelenmeli (sonraki toplantının odağı olabilir).
- KPI ana sayfasında veri tazeliği ya da son girilen dönem bilgisi yok. Vardiya amiri için her grubun yanında 'son giriş: tarih' gibi bir gösterge eklenmesi 30 saniyelik bilgi ihtiyacını karşılar. Bu, kpi/monthly ve kpi/weekly sorgularına dokunduğu için kullanıcı onayı gerektirir.
- Ana sayfada, KPI'nin planlama ve OEE ekranlarıyla (ör. /performans, /oee/mttr) ilişkisi gösterilmiyor. Bu bağlantılar navigasyon kararı olduğu için kullanıcı onayı beklenmeli.
- Haftalık ve aylık alt sayfaların (src/routes/kpi/monthly/*, weekly/*) yalnızca 8 satır olduğu haritada görünüyor. Bunların gerçekten yönlendirme mi, yoksa eksik bir bileşen mi olduğu ayrıca doğrulanmalı.
- Sayfaya başlık ve açıklama üzerinden arama kutusu eklenmesi, vardiya amirinin 30 saniyede kararı bulmasını hızlandırır. Bu yalnız sayfa içinde kalan bir arayüz işidir, ama önce yükleme düzeltilmeli.
- Yazar alanı şu an boş 'Who?' metni olarak giriliyor; oturumdaki kullanıcı adı varsayılan olarak yazılırsa kayıt sahipliği tutarlı olur. Oturum bilgisinin nasıl okunacağı kullanıcı kararı gerektirir.
- Planning Logic (/planlogic) ile Karar Günlüğü arasında bağlantı yok; planlama kuralı değişince ilgili kayda bağlantı verilmesi planlamacıya yardımcı olur. Bu navigasyon kararı planlogic.tsx'e dokunur, kullanıcı onayı gerekir.
- Silme onayı 'This cannot be undone.' diyor; kayıt yalnız yönetici tarafından silinebilir mi sorusu yetki kararı gerektirir ve korunan yetki alanına girdiği için yazılmadı.
