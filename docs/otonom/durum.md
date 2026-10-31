# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261031-0340 · src/routes/alarms.tsx · degisiklik-yok: Toplantı odak sayfa Alarms (/alarms) üzerineydi. Sayfa tek kaynak ilkesine uyuyor: veriyi usePlanAlarms kancasından alıyor, kalıp ve makine düzenleme işini kendi modüllerine bağlantıyla yönlendiriyor, katman ihlali görünmüyor. Planlama uzmanı kritik ve bilgi ayrımını doğru buldu. Vardiya amiri tarafında iki eksik görüldü: kritik alarm sayıs
- 20261031-0240 · src/routes/admin.tsx · degisiklik-yok: Odak sayfa Administration (/admin) incelendi. Sayfa tek kaynak ilkesine uyuyor: veriyi alt bileşenler okuyor, sayfa yalnız sekme ve rol kapısı yönetiyor. Katman ihlali yok. Planlama akışı açısından bulgu çıkmadı. Sahada tek somut eksik: sekme seçimi sayfa yenilenince veya haritadan geri dönünce hep 'Holdings & companies'e sıfırlanıyor; bu, h
- 20261031-0140 · src/routes/admin_.map.tsx · degisiklik-yok: Odak sayfa Organization map (/admin_/map) incelendi. Sayfa ince bir sarmalayıcı: tüm mantık OrgMap bileşeninde, sayfa kendi başına veri okumuyor/yazmıyor, tek kaynak ve katman açısından sorun yok. Haritada /admin_/map sayfasından geri dönüş bağlantısı yok (/admin'den harita açılıyor ama harita sayfasında 'Administration'a dön' yolu yok)

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Üst menüde ve Cockpit'te Alarms girişine kritik alarm sayısı rozeti eklenebilir (usePlanAlarms'tan tek kaynak). Vardiya amiri sayfayı açmadan sorunu görür. Navigasyon ve Cockpit dosyalarına dokunur, ayrı tasarım gerekir.
- Alarms makine tablosunda 'Parts affected' hücresi slice(0, 8) ile kesiliyor. Kesilen parça sayısı için '+N more' göstergesi olup olmadığı dosyanın sonu okunarak doğrulanmalı. Yoksa eklenmeli.
- Kritik kalıp ve makine satırlarından ilgili işin planına (/planlama) doğrudan bağlantı verilebilir. Şu an bağlantılar yalnızca takip modüllerine gidiyor, planlamacı etkilenen işi bulmak için elle arıyor.
- Alarm satırlarına önem sırası eklenebilir. Örneğin en erken stok bitiş tarihine göre sıralama, amirin 30 saniyede en acil kalıbı bulmasını sağlar. Sıralama usePlanAlarms çıktısında yapılmalı (tek kaynak).
- Administration sekmesi (tab) yalnızca useState'te tutuluyor; haritadan /admin'e dönünce veya sayfa yenilenince hep 'Holdings & companies' açılıyor. Sekmeyi rota arama parametresine (validateSearch ile ?tab=) taşımak ve haritadaki geri dönüş bağlantısını ?tab=organization ile vermek tıklama sayısın
- Administration sayfasında 'System errors' sekmesi için okunmamış/son 24 saat hata sayısını gösteren bir rozet (Tabs etiketinde) vardiya amirine ve General'e sorunu sekmeyi açmadan gösterir; sayı SystemErrors verisinden tek kaynaktan üretilmeli, bu yüzden OrgAdmin bileşenine dokunan ayrı bir tasarı
- 'Security' ve 'Platform history' sekmeleri /users ve /settings sayfalarındaki SecurityPanel/PlantChangeLog ile aynı bileşenleri kullanıyor; hangi sayfanın hangi kapsamı (tüm platform mi, tek plant mı) gösterdiği başlıkta belirtilmiyor. Her sekmenin başına tek cümlelik kapsam açıklaması eklenmesi k
- Organization map sayfasında /admin'e ('Holdings & companies' ve 'Users & permissions') geri dönüş bağlantısı eklenebilir; harita ile liste sayfaları arasındaki ilişki yalnızca metinde anlatılıyor, tıklanabilir değil. PageHeader'ın bir 'back' ya da actions özelliği varsa kullanılmalı (önce PageHead
- /settings_/map sayfası ile /admin_/map neredeyse aynı yapıda (iki sarmalayıcı, aynı OrgMap); ortak bir sarmalayıcı bileşene indirgenerek tekrar azaltılabilir, ancak kapı (TenancyGate) önek mantığına dokunduğu için yetki gözden geçirmesiyle birlikte yapılmalı.
- Sayfada kırmızı çerçeveli sorunlar (aynı adlı plant, holdingsiz company vb.) yalnızca haritanın içinde görünüyor; /admin sayfasında bu sorunların sayısını gösteren bir rozet vardiya amiri/yönetici için haritaya hızlı giriş sağlar. Sorun sayımı OrgMap'te hesaplandığı için tek kaynağa taşınması gere
