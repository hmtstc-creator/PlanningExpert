# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261031-0840 · src/routes/die-followup/index.tsx · yayinda: Odak sayfa Die Follow-up özet ekranı (/die-followup) incelendi. Veri sunucu sorgularından geliyor ve sayfa yalnız görüntülüyor, bu yüzden katman ihlali yok. Vardiya amiri açısından iki eksik bulundu. Veri yüklenirken sayfa '0' ve 'No open die problems.' gösteriyor, bu yanlış bir güvence veriyor. Açık sorun listesi sessizce 8 kayıtla ke
  - Die Follow-up yükleniyor durumu
- 20261031-0740 · src/routes/depolar.tsx · degisiklik-yok: Odak sayfa Storage Locations (/depolar) incelendi. Veri sunucu sorgularından geliyor, sayfa yalnız tanım yazıyor ve stok toplamlarını görüntülüyor; katman ihlali görülmedi. İlişki haritasında /depolar'dan başka sayfaya giden bağlantı yok (PageHeader'daki relatedPages dışında), oysa depo tanımsız MB52 stoku varken kullanıcının /sapdata'ya g
- 20261031-0644 · src/routes/compare.tsx · yayinda: Odak sayfa Compare plants (/compare) incelendi. Sayfa tek kaynak ilkesine uyuyor: veri compare.oeeWeeks sorgusundan geliyor, sayfa yalnız görüntülüyor, katman ihlali yok. Vardiya amiri ve mühendis tarafında iki eksik görüldü: veri gelene kadar sayfa boş kalıyor (yükleniyor mesajı yok), 26 haftaya çıkınca fabrika adı yatay kaydırmada kayboluyor. İ
  - Compare: yükleniyor durumu

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Alarms rozeti (kritik alarm sayısı, üst menü ve Cockpit) vardiya amirinin 30 saniye hedefi için hâlâ en değerli iş; navigasyona dokunduğu için ayrı tasarım gerekiyor.
- Die Follow-up özetinde 'Dies not ready' ve 'Shot-limit alarms' kutuları aynı sayfaya (/die-followup/maintenance) gidiyor; sayfada süzgeç parametresi (URL arama) ile doğrudan ilgili sekmeye/süzgece götürmek daha doğru olur. Bu bakım sayfasının yapısına bağlı, ayrı tasarım gerekir.
- Machine Follow-up özeti ile Die Follow-up özeti aynı kalıbı (ModuleStat + liste) tekrarlıyor; ortak bir özet iskeleti bileşeni çıkarılabilir (mimari sadeleştirme, büyük iş).
- /die-followup için ilişki haritasında Bağlantı sütunu /alarms, /die-followup/maintenance, /die-followup/problems gösteriyor ama /die-followup/reports (Pareto raporu) özetten bağlanmıyor; navigasyon tasarımıyla birlikte ele alınmalı.
- Depolar sayfasında 'MB52 has stock in locations not defined here' uyarısındaki her depo kodu için tek tıkla 'Add location' (kodu forma doldur) eylemi eklenebilir; sayfanın devamı (satır 220 sonrası) görüldükten sonra küçük görev olarak yazılmalı.
- stockRows en çok 500 satırla (initialNumItems: 500) yükleniyor ve usePaginatedQuery sonraki sayfaları getirmiyor olabilir; depo bazlı stok toplamları ve 'tanımsız depo' uyarısı büyük MB52 yüklemelerinde eksik görünebilir. Toplamların sunucu tarafında hesaplanması (stock.planStock benzeri tek kayna
- /depolar için ilişki haritasında Bağlantı sütunu boş: /sapdata (MB52 yükleme) ve /stoklar sayfalarına relatedPages üzerinden bağlantı olduğu doğrulanmalı; src/lib/navigation.ts korunan alan olmasa da navigasyon tasarımı Alarms rozeti önerisiyle birlikte ele alınmalı.
- Depo silme onayı window.confirm kullanıyor; programın diğer ekranlarındaki onay deseniyle (ortak diyalog bileşeni varsa) tutarlılığı ayrı turda kontrol edilmeli.
- Compare sayfası ilişki haritasında hiçbir sayfaya bağlanmıyor. Bir fabrikanın OEE'si düşükse ilgili /oee sayfasına geçiş yok; fabrika seçimi çok fabrikalı oturum modeline bağlı olduğu için ayrı tasarım gerekiyor.
- Compare sorgusu için hata durumu (query hata verirse mesaj) ortak useQuery sarmalayıcısına bağlı; sarmalayıcı davranışı doğrulanmadan sayfa içinde ele alınmamalı.
