# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-1340 · src/routes/kayitlar.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/kayitlar.tsx (Karar Günlüğü) incelendi. Kayıt ekleme, kategori filtreleri ve silme akışı tutarlı bulundu. Ciddi sorun olarak, sayfa usePaginatedQuery ile yalnızca ilk 100 kaydı yüklüyor ama 'Load more' düğmesi yok. Bu yüzden 100'den eski kararlar hiçbir ekranda görünmüyor ve 'All (n)' ile kategori sayıları
- 20261101-1240 · src/routes/kalipproblem.tsx · degisiklik-yok: Odak sayfa src/routes/kalipproblem.tsx incelendi. Dosya 10 satırlık bir yönlendirme: eski /kalipproblem adresi /die-followup/problems sayfasına taşınıyor, veri sorgusu ya da arayüz yok. Planlama uzmanı, AI uzmanı, mimari uzmanı, vardiya mühendisi ve vardiya amiri açısından ciddi bir sorun görülmedi; sayfa ilişki haritasıyla tutarlı. C
- 20261101-1140 · src/routes/kaliplar.tsx · degisiklik-yok: Odak sayfa src/routes/kaliplar.tsx incelendi. Dosya yalnızca eski /kaliplar adresini /die-followup/maintenance sayfasına yönlendiren 10 satırlık bir redirect; veri sorgusu, arayüz ya da planlama mantığı içermiyor. Sayfa ilişki haritasıyla tutarlı. Ciddi bir hata ya da katman ihlali bulunmadığı için somut bir görev yazılmadı.

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Sayfaya başlık ve açıklama üzerinden arama kutusu eklenmesi, vardiya amirinin 30 saniyede kararı bulmasını hızlandırır. Bu yalnız sayfa içinde kalan bir arayüz işidir, ama önce yükleme düzeltilmeli.
- Yazar alanı şu an boş 'Who?' metni olarak giriliyor; oturumdaki kullanıcı adı varsayılan olarak yazılırsa kayıt sahipliği tutarlı olur. Oturum bilgisinin nasıl okunacağı kullanıcı kararı gerektirir.
- Planning Logic (/planlogic) ile Karar Günlüğü arasında bağlantı yok; planlama kuralı değişince ilgili kayda bağlantı verilmesi planlamacıya yardımcı olur. Bu navigasyon kararı planlogic.tsx'e dokunur, kullanıcı onayı gerekir.
- Silme onayı 'This cannot be undone.' diyor; kayıt yalnız yönetici tarafından silinebilir mi sorusu yetki kararı gerektirir ve korunan yetki alanına girdiği için yazılmadı.
- Eski /kaliplar yönlendirmesinin ne kadar kullanıldığı izlenebilir. Kullanım bittikten sonra kaldırılması, yer imi ve dış bağlantılar kontrol edildikten sonra kullanıcı kararıyla yapılmalı (dosya silme bu otonom döngünün görev kapsamında değil).
- Ana sayfaya vardiya başı özeti eklenmesi: bugünkü plan durumu, geç işler ve veri tazeliği tek kartta gösterilirse amir 30 saniyede bilgi alabilir. Bu veri ve navigasyon kararı gerektirdiği için kullanıcı onayı beklenmeli.
- Sorgu sonucundaki 'complete' bayrağı bu sayfada görünmüyor; eksik veri varken toplamlar yanıltıcı olabilir. Sunucu anlamı doğrulanıp uyarı gösterilmesi düşünülmeli (convex tarafı karar gerektirir).
- Güvenlik stoğu ve ek kg kaydedildiğinde planlama sonuçlarının yeniden hesaplanıp hesaplanmadığı kullanıcıya gösterilmiyor; kayıt sonrası 'planı yeniden çalıştır' ipucu eklenebilir (navigasyon ve planlama akışı kararı gerektirir).
- Mail hazırlama metni İngilizce sabit yazılmış; arayüz dili ile e-posta dilinin tek bir yerden yönetilmesi kararı alınmalı (korunan alan değil, ama dil politikası kullanıcı onayı ister).
- Sorgu sonucundaki 'complete' bayrağı sayfada hiç kullanılmıyor. complete false ise toplamlar eksik olabilir; sunucu anlamı doğrulanıp, false iken 'partial data' uyarısı gösterilmesi düşünülmeli (convex tarafı ayrı karar gerektirir).
