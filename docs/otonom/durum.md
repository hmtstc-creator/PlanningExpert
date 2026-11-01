# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-0840 · src/routes/gerceklesen.tsx · yayinda: Odak sayfa Actual Production (/gerceklesen) incelendi. Veri tek bir sorgudan geliyor, katman ihlali yok ve sayfa planlama mantığına dokunmuyor. Bulunan asıl sorunlar arayüzde: arama sonucu boş olduğunda da 'No MB51 data uploaded yet.' mesajı gösteriliyor, bu da kullanıcıyı yanlış yönlendiriyor. Tablo başlıklarında Türkçe etiketler kalmış ('Ma
  - Arama boş sonucu için doğru mesaj
- 20261101-0740 · src/routes/die-followup/reports.tsx · degisiklik-yok: Toplantıda Die Reports sayfasının ilk 220 satırı incelendi. Veri moldProblems.list'ten geliyor, filtreleme istemci tarafında yapılıyor ve katman ihlali yok. Vardiya mühendisi ile amir için asıl sorun, veri yüklenirken 'Problems' ve 'Dies affected' kutularının 0 göstermesi; bu, 'sorun yok' diye okunabilir. Karar: yalnız yükleme
- 20261101-0640 · src/routes/die-followup/problems.tsx · degisiklik-yok: Odak sayfa Die Problems (/die-followup/problems) için yalnız ilk 220 satır görüldü. Veri sunucu sorgularından geliyor ve katman ihlali yok. Kalıp seçimi MaterialPicker ile yapılıyor, bu iyi bir koruma. Vardiya mühendisi bir sorun buldu: seçim listeleri (lookups) yüklenirken sayfa 'liste boş, sorun bildirilemez' uyarısını yanl

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Sorgu sonucundaki 'complete' bayrağı sayfada hiç kullanılmıyor. complete false ise toplamlar eksik olabilir; sunucu anlamı doğrulanıp, false iken 'partial data' uyarısı gösterilmesi düşünülmeli (convex tarafı ayrı karar gerektirir).
- Sayfada tarih aralığı filtresi yok; vardiya amiri için son 30 gün varsayılanı ve tarih seçimi hızlı bilgi verir. Bu varsayılan veri davranışını değiştirdiği için kullanıcı onayı gerekir.
- Üretim toplamı ile plan karşılaştırması bu sayfadan yapılamıyor; plan-gerçekleşen karşılaştırması için /planningexpert veya /performans bağlantısı eklenebilir (navigasyon kararı gerektirir).
- Arama kutusunda aria-label yok; ekran okuyucu ve test için etiket eklenmesi düşük öncelikli bir erişilebilirlik iyileştirmesi.
- Sayfa tüm geçmişi açıyor; vardiya amiri için varsayılan tarih aralığı (son 30 gün) hızlı bilgi verir. Bu veri varsayılanını değiştirdiği için kullanıcı onayı gerekir.
- Seçili kalıp için kalıp sorunları (/die-followup/problems) ve kalıp bakımı (/die-followup/maintenance) sayfalarına bağlantı yok; ilişki haritasında Reports'un giden bağlantısı boş. Bu, navigasyon tasarımıyla birlikte ele alınmalı.
- Seçili kalıp ve tarih aralığı URL arama parametresinde tutulmuyor; sayfa yenilenince filtre kayboluyor. Arama parametresi tasarlanmalı.
- Başlangıç tarihi bitiş tarihinden büyükse sayfa sessizce boş liste gösterir olabilir; inRange bunu nasıl ele alıyor, doğrulanmalı ve gerekiyorsa kullanıcıya uyarı verilmeli.
- Production lost değeri dakika olarak gösteriliyor; 1 saatin üzeri için 'h min' biçimi okunabilirliği artırır (düşük öncelik).
- Gönderme (submit) işlevi malzeme, operasyon veya sorun tipi eksikse sessizce dönüyor; satır 220 sonrasındaki düğme devre dışı değilse eksik alanı belirten bir mesaj gösterilmeli (sayfanın devamı görüldükten sonra küçük görev).
