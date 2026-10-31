# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261031-0644 · src/routes/compare.tsx · yayinda: Odak sayfa Compare plants (/compare) incelendi. Sayfa tek kaynak ilkesine uyuyor: veri compare.oeeWeeks sorgusundan geliyor, sayfa yalnız görüntülüyor, katman ihlali yok. Vardiya amiri ve mühendis tarafında iki eksik görüldü: veri gelene kadar sayfa boş kalıyor (yükleniyor mesajı yok), 26 haftaya çıkınca fabrika adı yatay kaydırmada kayboluyor. İ
  - Compare: yükleniyor durumu
- 20261031-0540 · src/routes/capacity.tsx · degisiklik-yok: Toplantı odak sayfa Capacity Dashboard (/capacity) üzerineydi. Sayfa tek kaynak ilkesine uyuyor: öngörü sunucuda planla birlikte hesaplanıyor, süzgeç yalnız görünümü daraltıyor, takvim ve duraklama verisi ortak modüllerden geliyor. Eski veri uyarısı için `stale` ve `recalculating` durumları var, bu iyi. Gösterilen ilk 220 satırda kesin ve
- 20261031-0440 · src/routes/board.tsx · degisiklik-yok: Odak sayfa Board (/board) incelendi. Sayfa 8 satırlık ince bir sarmalayıcı: tüm içerik BoardDashboard bileşeninde, sayfa kendi başına veri okumuyor ya da yazmıyor. Bu yüzden katman ve tek kaynak açısından sayfada sorun yok. Ancak ilişki haritasında /board'a yalnızca Cockpit'ten (/) bağlantı var, Board'dan başka sayfaya çıkış görünmüyor. Boar

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Compare sayfası ilişki haritasında hiçbir sayfaya bağlanmıyor. Bir fabrikanın OEE'si düşükse ilgili /oee sayfasına geçiş yok; fabrika seçimi çok fabrikalı oturum modeline bağlı olduğu için ayrı tasarım gerekiyor.
- Compare sorgusu için hata durumu (query hata verirse mesaj) ortak useQuery sarmalayıcısına bağlı; sarmalayıcı davranışı doğrulanmadan sayfa içinde ele alınmamalı.
- Tarih ve hafta sayısı süzgeci sayfa yenilenince sıfırlanıyor. URL arama parametresine taşımak vardiya devrinde aynı bakışı paylaşmayı sağlar; Capacity süzgeç önerisiyle birlikte ele alınmalı.
- Alarms rozeti (kritik alarm sayısı, üst menü ve Cockpit) hâlâ vardiya amirinin 30 saniye hedefi için en değerli iş; navigasyona dokunduğu için ayrı tasarım gerekiyor.
- Kabul edilen OEE alanı 5% ile 200% arasında geçerli. Aralık dışı bir değer yazılınca tablo sessizce kayıtlı değere dönüyor. Sayfanın devamında bu durum için görünür bir uyarı olup olmadığı doğrulanmalı. Yoksa 'Enter 5–200 %' mesajı eklenmeli.
- İlişki haritasında /capacity yalnızca /referanslar ve /takvim'e bağlanıyor. Kapasite açığı olan haftadan ilgili pres için /planlama sayfasına doğrudan bağlantı yok. Planlamacı açığı görünce planı elle arıyor. Tablo kodu görüldükten sonra bağlantı eklenebilir.
- Seçili görünüm (hat ya da pres), performans kaynağı ve süzgeç tarayıcıda localStorage'da tutuluyor. Başka cihazda ya da vardiya devrinde aynı bakış gelmiyor. Bu bir tasarım kararı. Gerekirse URL arama parametresine taşınabilir. Bu, Administration sekmesi önerisiyle birlikte ele alınmalı.
- Board (/board) için BoardDashboard bileşeni bir sonraki turlarda odak dosyası olmalı. Harita betiği (scripts/otonom/harita.mjs) bileşen içindeki sorguları da taramalı. Aksi halde /board, /admin ve /kpi sayfalarının okuma ve yazma ilişkileri haritada boş görünüyor. Betik korunan alanda, Claude ya d
- Alarms rozeti (üst menü ve Cockpit'te kritik alarm sayısı, usePlanAlarms'tan tek kaynak) birkaç turdır bekliyor. Vardiya amirinin 30 saniye hedefi için en değerli iş bu. Navigasyon ve Cockpit'e dokunduğu için ayrı tasarım gerekiyor.
- Board sayfasının asıl mantığı src/components/BoardDashboard içinde. Bir sonraki turda odak dosyası olarak bu bileşen verilmeli. Hangi sorguları okuduğu ve alarm ya da plan verisini usePlanAlarms ve usePlanState gibi ortak kancalardan mı yoksa kendi hesabından mı aldığı doğrulanmalı (tek kaynak).
