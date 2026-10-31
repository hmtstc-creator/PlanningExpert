# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261031-0740 · src/routes/depolar.tsx · degisiklik-yok: Odak sayfa Storage Locations (/depolar) incelendi. Veri sunucu sorgularından geliyor, sayfa yalnız tanım yazıyor ve stok toplamlarını görüntülüyor; katman ihlali görülmedi. İlişki haritasında /depolar'dan başka sayfaya giden bağlantı yok (PageHeader'daki relatedPages dışında), oysa depo tanımsız MB52 stoku varken kullanıcının /sapdata'ya g
- 20261031-0644 · src/routes/compare.tsx · yayinda: Odak sayfa Compare plants (/compare) incelendi. Sayfa tek kaynak ilkesine uyuyor: veri compare.oeeWeeks sorgusundan geliyor, sayfa yalnız görüntülüyor, katman ihlali yok. Vardiya amiri ve mühendis tarafında iki eksik görüldü: veri gelene kadar sayfa boş kalıyor (yükleniyor mesajı yok), 26 haftaya çıkınca fabrika adı yatay kaydırmada kayboluyor. İ
  - Compare: yükleniyor durumu
- 20261031-0540 · src/routes/capacity.tsx · degisiklik-yok: Toplantı odak sayfa Capacity Dashboard (/capacity) üzerineydi. Sayfa tek kaynak ilkesine uyuyor: öngörü sunucuda planla birlikte hesaplanıyor, süzgeç yalnız görünümü daraltıyor, takvim ve duraklama verisi ortak modüllerden geliyor. Eski veri uyarısı için `stale` ve `recalculating` durumları var, bu iyi. Gösterilen ilk 220 satırda kesin ve

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Depolar sayfasında 'MB52 has stock in locations not defined here' uyarısındaki her depo kodu için tek tıkla 'Add location' (kodu forma doldur) eylemi eklenebilir; sayfanın devamı (satır 220 sonrası) görüldükten sonra küçük görev olarak yazılmalı.
- stockRows en çok 500 satırla (initialNumItems: 500) yükleniyor ve usePaginatedQuery sonraki sayfaları getirmiyor olabilir; depo bazlı stok toplamları ve 'tanımsız depo' uyarısı büyük MB52 yüklemelerinde eksik görünebilir. Toplamların sunucu tarafında hesaplanması (stock.planStock benzeri tek kayna
- /depolar için ilişki haritasında Bağlantı sütunu boş: /sapdata (MB52 yükleme) ve /stoklar sayfalarına relatedPages üzerinden bağlantı olduğu doğrulanmalı; src/lib/navigation.ts korunan alan olmasa da navigasyon tasarımı Alarms rozeti önerisiyle birlikte ele alınmalı.
- Depo silme onayı window.confirm kullanıyor; programın diğer ekranlarındaki onay deseniyle (ortak diyalog bileşeni varsa) tutarlılığı ayrı turda kontrol edilmeli.
- Compare sayfası ilişki haritasında hiçbir sayfaya bağlanmıyor. Bir fabrikanın OEE'si düşükse ilgili /oee sayfasına geçiş yok; fabrika seçimi çok fabrikalı oturum modeline bağlı olduğu için ayrı tasarım gerekiyor.
- Compare sorgusu için hata durumu (query hata verirse mesaj) ortak useQuery sarmalayıcısına bağlı; sarmalayıcı davranışı doğrulanmadan sayfa içinde ele alınmamalı.
- Tarih ve hafta sayısı süzgeci sayfa yenilenince sıfırlanıyor. URL arama parametresine taşımak vardiya devrinde aynı bakışı paylaşmayı sağlar; Capacity süzgeç önerisiyle birlikte ele alınmalı.
- Alarms rozeti (kritik alarm sayısı, üst menü ve Cockpit) hâlâ vardiya amirinin 30 saniye hedefi için en değerli iş; navigasyona dokunduğu için ayrı tasarım gerekiyor.
- Kabul edilen OEE alanı 5% ile 200% arasında geçerli. Aralık dışı bir değer yazılınca tablo sessizce kayıtlı değere dönüyor. Sayfanın devamında bu durum için görünür bir uyarı olup olmadığı doğrulanmalı. Yoksa 'Enter 5–200 %' mesajı eklenmeli.
- İlişki haritasında /capacity yalnızca /referanslar ve /takvim'e bağlanıyor. Kapasite açığı olan haftadan ilgili pres için /planlama sayfasına doğrudan bağlantı yok. Planlamacı açığı görünce planı elle arıyor. Tablo kodu görüldükten sonra bağlantı eklenebilir.
