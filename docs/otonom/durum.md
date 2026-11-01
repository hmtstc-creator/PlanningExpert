# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-1040 · src/routes/index.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/index.tsx (portal ana sayfası, ilk 220 satır) incelendi. Modül kartlarındaki bağlantılar ve yetki filtreleri tutarlı görüldü, sayfa planlama motoruna dokunmuyor ve katman ihlali bulunmadı. Küçük bir arayüz tutarsızlığı var: bölümün aria-label'ı 'Administration' iken görünen başlık 'Manage'. Ciddi bir hata çık
- 20261101-0940 · src/routes/hammadde.tsx · degisiklik-yok: Toplantıda Hammadde (Raw Material Coverage) sayfasının ilk 220 satırı incelendi. Veri tek bir sorgudan ve kurallar src/lib/rawMrp.ts içinden geliyor, sayfa planlama motoruna dokunmuyor, katman ihlali görülmedi. Planlama uzmanı ve vardiya amiri için sayfanın hesap ayarları iyi çalışıyor. Vardiya mühendisi ise Safety stock alanına 0 yazıldı
- 20261101-0840 · src/routes/gerceklesen.tsx · yayinda: Odak sayfa Actual Production (/gerceklesen) incelendi. Veri tek bir sorgudan geliyor, katman ihlali yok ve sayfa planlama mantığına dokunmuyor. Bulunan asıl sorunlar arayüzde: arama sonucu boş olduğunda da 'No MB51 data uploaded yet.' mesajı gösteriliyor, bu da kullanıcıyı yanlış yönlendiriyor. Tablo başlıklarında Türkçe etiketler kalmış ('Ma
  - Arama boş sonucu için doğru mesaj

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Ana sayfaya vardiya başı özeti eklenmesi: bugünkü plan durumu, geç işler ve veri tazeliği tek kartta gösterilirse amir 30 saniyede bilgi alabilir. Bu veri ve navigasyon kararı gerektirdiği için kullanıcı onayı beklenmeli.
- Sorgu sonucundaki 'complete' bayrağı bu sayfada görünmüyor; eksik veri varken toplamlar yanıltıcı olabilir. Sunucu anlamı doğrulanıp uyarı gösterilmesi düşünülmeli (convex tarafı karar gerektirir).
- Güvenlik stoğu ve ek kg kaydedildiğinde planlama sonuçlarının yeniden hesaplanıp hesaplanmadığı kullanıcıya gösterilmiyor; kayıt sonrası 'planı yeniden çalıştır' ipucu eklenebilir (navigasyon ve planlama akışı kararı gerektirir).
- Mail hazırlama metni İngilizce sabit yazılmış; arayüz dili ile e-posta dilinin tek bir yerden yönetilmesi kararı alınmalı (korunan alan değil, ama dil politikası kullanıcı onayı ister).
- Sorgu sonucundaki 'complete' bayrağı sayfada hiç kullanılmıyor. complete false ise toplamlar eksik olabilir; sunucu anlamı doğrulanıp, false iken 'partial data' uyarısı gösterilmesi düşünülmeli (convex tarafı ayrı karar gerektirir).
- Sayfada tarih aralığı filtresi yok; vardiya amiri için son 30 gün varsayılanı ve tarih seçimi hızlı bilgi verir. Bu varsayılan veri davranışını değiştirdiği için kullanıcı onayı gerekir.
- Üretim toplamı ile plan karşılaştırması bu sayfadan yapılamıyor; plan-gerçekleşen karşılaştırması için /planningexpert veya /performans bağlantısı eklenebilir (navigasyon kararı gerektirir).
- Arama kutusunda aria-label yok; ekran okuyucu ve test için etiket eklenmesi düşük öncelikli bir erişilebilirlik iyileştirmesi.
- Sayfa tüm geçmişi açıyor; vardiya amiri için varsayılan tarih aralığı (son 30 gün) hızlı bilgi verir. Bu veri varsayılanını değiştirdiği için kullanıcı onayı gerekir.
- Seçili kalıp için kalıp sorunları (/die-followup/problems) ve kalıp bakımı (/die-followup/maintenance) sayfalarına bağlantı yok; ilişki haritasında Reports'un giden bağlantısı boş. Bu, navigasyon tasarımıyla birlikte ele alınmalı.
