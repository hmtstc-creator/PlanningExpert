# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261031-0440 · src/routes/board.tsx · degisiklik-yok: Odak sayfa Board (/board) incelendi. Sayfa 8 satırlık ince bir sarmalayıcı: tüm içerik BoardDashboard bileşeninde, sayfa kendi başına veri okumuyor ya da yazmıyor. Bu yüzden katman ve tek kaynak açısından sayfada sorun yok. Ancak ilişki haritasında /board'a yalnızca Cockpit'ten (/) bağlantı var, Board'dan başka sayfaya çıkış görünmüyor. Boar
- 20261031-0340 · src/routes/alarms.tsx · degisiklik-yok: Toplantı odak sayfa Alarms (/alarms) üzerineydi. Sayfa tek kaynak ilkesine uyuyor: veriyi usePlanAlarms kancasından alıyor, kalıp ve makine düzenleme işini kendi modüllerine bağlantıyla yönlendiriyor, katman ihlali görünmüyor. Planlama uzmanı kritik ve bilgi ayrımını doğru buldu. Vardiya amiri tarafında iki eksik görüldü: kritik alarm sayıs
- 20261031-0240 · src/routes/admin.tsx · degisiklik-yok: Odak sayfa Administration (/admin) incelendi. Sayfa tek kaynak ilkesine uyuyor: veriyi alt bileşenler okuyor, sayfa yalnız sekme ve rol kapısı yönetiyor. Katman ihlali yok. Planlama akışı açısından bulgu çıkmadı. Sahada tek somut eksik: sekme seçimi sayfa yenilenince veya haritadan geri dönünce hep 'Holdings & companies'e sıfırlanıyor; bu, h

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Board sayfasının asıl mantığı src/components/BoardDashboard içinde. Bir sonraki turda odak dosyası olarak bu bileşen verilmeli. Hangi sorguları okuduğu ve alarm ya da plan verisini usePlanAlarms ve usePlanState gibi ortak kancalardan mı yoksa kendi hesabından mı aldığı doğrulanmalı (tek kaynak).
- İlişki haritasında /board satırında Okur, Yazar ve Bağlantı sütunları boş. Veri bileşen içinde okunuyorsa harita betiği (scripts/otonom/harita.mjs) bileşen içindeki sorguları da taramalı. Aksi halde toplantı bu sayfanın ilişkilerini göremiyor. Betik korunan alanda olduğu için Claude ya da kullanıc
- Board panosundaki kartlardan ilgili ayrıntı sayfalarına (/alarms, /planlama, /oee) tıklanabilir bağlantı olup olmadığı kontrol edilmeli. Yoksa vardiya amiri panoda sorunu görüp ilgili sayfaya gitmek için menüden elle arar. Bileşen okunmadan görev yazılamaz.
- Board için 'son güncelleme zamanı' ve veri yoksa boş durum mesajı olup olmadığı BoardDashboard içinde doğrulanmalı. Vardiya başında amirin panonun eski veriyi gösterip göstermediğini anlaması gerekir.
- Önceki turlarda biriken Alarms rozeti önerisi (üst menü ve Cockpit'te kritik alarm sayısı) Board sayfasıyla birlikte tasarlanmalı. Board, amirin vardiya başı giriş ekranı olacaksa kritik alarm özeti burada da tek kaynaktan gösterilmeli.
- Üst menüde ve Cockpit'te Alarms girişine kritik alarm sayısı rozeti eklenebilir (usePlanAlarms'tan tek kaynak). Vardiya amiri sayfayı açmadan sorunu görür. Navigasyon ve Cockpit dosyalarına dokunur, ayrı tasarım gerekir.
- Alarms makine tablosunda 'Parts affected' hücresi slice(0, 8) ile kesiliyor. Kesilen parça sayısı için '+N more' göstergesi olup olmadığı dosyanın sonu okunarak doğrulanmalı. Yoksa eklenmeli.
- Kritik kalıp ve makine satırlarından ilgili işin planına (/planlama) doğrudan bağlantı verilebilir. Şu an bağlantılar yalnızca takip modüllerine gidiyor, planlamacı etkilenen işi bulmak için elle arıyor.
- Alarm satırlarına önem sırası eklenebilir. Örneğin en erken stok bitiş tarihine göre sıralama, amirin 30 saniyede en acil kalıbı bulmasını sağlar. Sıralama usePlanAlarms çıktısında yapılmalı (tek kaynak).
- Administration sekmesi (tab) yalnızca useState'te tutuluyor; haritadan /admin'e dönünce veya sayfa yenilenince hep 'Holdings & companies' açılıyor. Sekmeyi rota arama parametresine (validateSearch ile ?tab=) taşımak ve haritadaki geri dönüş bağlantısını ?tab=organization ile vermek tıklama sayısın
