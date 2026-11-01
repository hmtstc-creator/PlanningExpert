# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-0640 · src/routes/die-followup/problems.tsx · degisiklik-yok: Odak sayfa Die Problems (/die-followup/problems) için yalnız ilk 220 satır görüldü. Veri sunucu sorgularından geliyor ve katman ihlali yok. Kalıp seçimi MaterialPicker ile yapılıyor, bu iyi bir koruma. Vardiya mühendisi bir sorun buldu: seçim listeleri (lookups) yüklenirken sayfa 'liste boş, sorun bildirilemez' uyarısını yanl
- 20261031-1040 · src/routes/die-followup/problems.tsx · degisiklik-yok: Odak sayfa Die Problems (/die-followup/problems) için yalnız ilk 220 satır görüldü. Veri sunucu sorgularından geliyor ve katman ihlali yok. Kalıp seçimi MaterialPicker ile yapılıyor, bu iyi bir koruma. Vardiya mühendisi bir sorun buldu: seçim listeleri (lookups) yüklenirken sayfa 'liste boş, sorun bildirilemez' uyarısını yanl
- 20261031-0940 · src/routes/die-followup/maintenance.tsx · degisiklik-yok: Odak sayfa Die Maintenance (/die-followup/maintenance) için yalnız ilk 220 satır görüldü. Veri sunucu sorgularından geliyor ve hesap lib/moldLife ile lib/maintenance içinde, bu yüzden katman ihlali yok. Planlama uzmanı, hazır değil kalıp kaydının plana gittiğini ve periyodik bakımın sayacı sıfırladığını, arıza onarımının s

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Gönderme (submit) işlevi malzeme, operasyon veya sorun tipi eksikse sessizce dönüyor; satır 220 sonrasındaki düğme devre dışı değilse eksik alanı belirten bir mesaj gösterilmeli (sayfanın devamı görüldükten sonra küçük görev).
- Downtime alanı Number(downtime) ile çevriliyor; negatif veya geçersiz değer kontrolü formun devamında (min/step) var mı doğrulanmalı, yoksa küçük görev olarak yazılmalı.
- MaterialPicker master data dışında serbest kod girişine izin veriyor mu doğrulanmalı; izin veriyorsa kayıt tanımsız koda gidebilir.
- Alarms rozeti (kritik alarm sayısı, üst menü ve Cockpit) vardiya amirinin 30 saniye hedefi için hâlâ en değerli iş; navigasyona dokunduğu için ayrı tasarım gerekiyor.
- Die Follow-up özetindeki 'Dies not ready' ve 'Shot-limit alarms' kutuları URL arama parametresiyle doğrudan ilgili bölüme götürmeli; bakım sayfasının yapısına bağlı, ayrı tasarım gerekir.
- Die Problems ile Die Maintenance sayfaları arasında kalıp bazlı geçiş yok (ilişki haritasında Bağlantı sütunu yalnız /reports); aynı kalıbın arıza kaydından bakım kaydına geçişi navigasyon tasarımıyla birlikte ele alınmalı.
- Machine Follow-up ve Die Follow-up özetleri aynı kalıbı (ModuleStat + liste) tekrarlıyor; ortak özet iskeleti çıkarılabilir (mimari sadeleştirme, büyük iş).
- Maintenance sayfasında products.listAll, actualProduction.listAll ve moldAlarms.list yüklenirken sayaçlar ('exceeded', 'near limit', 'no limit set') 0 gösterebilir; satır 220 sonrası okunup yükleniyor durumu varsa doğrulanmalı, yoksa küçük görev olarak yazılmalı.
- actualIncomplete değişkeni hesaplanıyor; satır 220 sonrasında kullanıcıya 'Production data is incomplete' uyarısı gösterilip gösterilmediği doğrulanmalı. Gösterilmiyorsa kalıp ömrü sayıları sessizce eksik kalır.
- Die Follow-up özetindeki 'Dies not ready' ve 'Shot-limit alarms' kutuları bu sayfaya düz bağlanıyor; URL arama parametresiyle doğrudan ilgili bölüme (hazır değil kalıplar / açık alarmlar) götürmek daha doğru olur. Sayfanın bölüm yapısı görüldükten sonra tasarlanmalı.
