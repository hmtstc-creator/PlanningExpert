# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-1440 · src/routes/kpi/index.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kpi/index.tsx (KPI ana sayfası) incelendi. Sayfa yalnızca aylık ve haftalık KPI veri girişi ile dashboard sayfalarına giden dört bağlantı içeriyor; veri sorgusu, yazma işlemi ve planlama mantığı yok. Planlama, vardiya ve amir açısından ciddi bir hata ya da katman ihlali bulunmadı, bu yüzden görev yazılmad
- 20261101-1340 · src/routes/kayitlar.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kayitlar.tsx (Karar Günlüğü) incelendi. Kayıt ekleme, kategori filtreleri ve silme akışı tutarlı bulundu. Ciddi sorun olarak, sayfa usePaginatedQuery ile yalnızca ilk 100 kaydı yüklüyor ama 'Load more' düğmesi yok. Bu yüzden 100'den eski kararlar hiçbir ekranda görünmüyor ve 'All (n)' ile kategori sayıları
- 20261101-1240 · src/routes/kalipproblem.tsx · degisiklik-yok: Odak sayfa src/routes/kalipproblem.tsx incelendi. Dosya 10 satırlık bir yönlendirme: eski /kalipproblem adresi /die-followup/problems sayfasına taşınıyor, veri sorgusu ya da arayüz yok. Planlama uzmanı, AI uzmanı, mimari uzmanı, vardiya mühendisi ve vardiya amiri açısından ciddi bir sorun görülmedi; sayfa ilişki haritasıyla tutarlı. C

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- KPI ana sayfasında veri tazeliği ya da son girilen dönem bilgisi yok. Vardiya amiri için her grubun yanında 'son giriş: tarih' gibi bir gösterge eklenmesi 30 saniyelik bilgi ihtiyacını karşılar. Bu, kpi/monthly ve kpi/weekly sorgularına dokunduğu için kullanıcı onayı gerektirir.
- Ana sayfada, KPI'nin planlama ve OEE ekranlarıyla (ör. /performans, /oee/mttr) ilişkisi gösterilmiyor. Bu bağlantılar navigasyon kararı olduğu için kullanıcı onayı beklenmeli.
- Haftalık ve aylık alt sayfaların (src/routes/kpi/monthly/*, weekly/*) yalnızca 8 satır olduğu haritada görünüyor. Bunların gerçekten yönlendirme mi, yoksa eksik bir bileşen mi olduğu ayrıca doğrulanmalı.
- Sayfaya başlık ve açıklama üzerinden arama kutusu eklenmesi, vardiya amirinin 30 saniyede kararı bulmasını hızlandırır. Bu yalnız sayfa içinde kalan bir arayüz işidir, ama önce yükleme düzeltilmeli.
- Yazar alanı şu an boş 'Who?' metni olarak giriliyor; oturumdaki kullanıcı adı varsayılan olarak yazılırsa kayıt sahipliği tutarlı olur. Oturum bilgisinin nasıl okunacağı kullanıcı kararı gerektirir.
- Planning Logic (/planlogic) ile Karar Günlüğü arasında bağlantı yok; planlama kuralı değişince ilgili kayda bağlantı verilmesi planlamacıya yardımcı olur. Bu navigasyon kararı planlogic.tsx'e dokunur, kullanıcı onayı gerekir.
- Silme onayı 'This cannot be undone.' diyor; kayıt yalnız yönetici tarafından silinebilir mi sorusu yetki kararı gerektirir ve korunan yetki alanına girdiği için yazılmadı.
- Eski /kaliplar yönlendirmesinin ne kadar kullanıldığı izlenebilir. Kullanım bittikten sonra kaldırılması, yer imi ve dış bağlantılar kontrol edildikten sonra kullanıcı kararıyla yapılmalı (dosya silme bu otonom döngünün görev kapsamında değil).
- Ana sayfaya vardiya başı özeti eklenmesi: bugünkü plan durumu, geç işler ve veri tazeliği tek kartta gösterilirse amir 30 saniyede bilgi alabilir. Bu veri ve navigasyon kararı gerektirdiği için kullanıcı onayı beklenmeli.
- Sorgu sonucundaki 'complete' bayrağı bu sayfada görünmüyor; eksik veri varken toplamlar yanıltıcı olabilir. Sunucu anlamı doğrulanıp uyarı gösterilmesi düşünülmeli (convex tarafı karar gerektirir).
