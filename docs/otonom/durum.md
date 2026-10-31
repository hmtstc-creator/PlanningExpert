# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261031-0940 · src/routes/die-followup/maintenance.tsx · degisiklik-yok: Odak sayfa Die Maintenance (/die-followup/maintenance) için yalnız ilk 220 satır görüldü. Veri sunucu sorgularından geliyor ve hesap lib/moldLife ile lib/maintenance içinde, bu yüzden katman ihlali yok. Planlama uzmanı, hazır değil kalıp kaydının plana gittiğini ve periyodik bakımın sayacı sıfırladığını, arıza onarımının s
- 20261031-0840 · src/routes/die-followup/index.tsx · yayinda: Odak sayfa Die Follow-up özet ekranı (/die-followup) incelendi. Veri sunucu sorgularından geliyor ve sayfa yalnız görüntülüyor, bu yüzden katman ihlali yok. Vardiya amiri açısından iki eksik bulundu. Veri yüklenirken sayfa '0' ve 'No open die problems.' gösteriyor, bu yanlış bir güvence veriyor. Açık sorun listesi sessizce 8 kayıtla ke
  - Die Follow-up yükleniyor durumu
- 20261031-0740 · src/routes/depolar.tsx · degisiklik-yok: Odak sayfa Storage Locations (/depolar) incelendi. Veri sunucu sorgularından geliyor, sayfa yalnız tanım yazıyor ve stok toplamlarını görüntülüyor; katman ihlali görülmedi. İlişki haritasında /depolar'dan başka sayfaya giden bağlantı yok (PageHeader'daki relatedPages dışında), oysa depo tanımsız MB52 stoku varken kullanıcının /sapdata'ya g

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Maintenance sayfasında products.listAll, actualProduction.listAll ve moldAlarms.list yüklenirken sayaçlar ('exceeded', 'near limit', 'no limit set') 0 gösterebilir; satır 220 sonrası okunup yükleniyor durumu varsa doğrulanmalı, yoksa küçük görev olarak yazılmalı.
- actualIncomplete değişkeni hesaplanıyor; satır 220 sonrasında kullanıcıya 'Production data is incomplete' uyarısı gösterilip gösterilmediği doğrulanmalı. Gösterilmiyorsa kalıp ömrü sayıları sessizce eksik kalır.
- Alarms rozeti (kritik alarm sayısı, üst menü ve Cockpit) vardiya amirinin 30 saniye hedefi için hâlâ en değerli iş; navigasyona dokunduğu için ayrı tasarım gerekiyor.
- Die Follow-up özetindeki 'Dies not ready' ve 'Shot-limit alarms' kutuları bu sayfaya düz bağlanıyor; URL arama parametresiyle doğrudan ilgili bölüme (hazır değil kalıplar / açık alarmlar) götürmek daha doğru olur. Sayfanın bölüm yapısı görüldükten sonra tasarlanmalı.
- Maintenance sayfası 835 satır ve tek bileşende birden çok iş yapıyor (bakım kaydı, hazırlık kutusu, alarmlar, kalıp ömrü tablosu). Bölümleri ayrı bileşenlere ayırmak mimari sadeleştirme olur, ama büyük iş.
- Sayfa 'ilişki haritası'nda Bağlantı sütunu boş: /die-followup/problems ve /alarms sayfalarına geçiş yok. Aynı kalıbın arıza kaydı ile bakım sayfası arasında gezinmesi navigasyon tasarımıyla birlikte ele alınmalı.
- Die Follow-up özetinde 'Dies not ready' ve 'Shot-limit alarms' kutuları aynı sayfaya (/die-followup/maintenance) gidiyor; sayfada süzgeç parametresi (URL arama) ile doğrudan ilgili sekmeye/süzgece götürmek daha doğru olur. Bu bakım sayfasının yapısına bağlı, ayrı tasarım gerekir.
- Machine Follow-up özeti ile Die Follow-up özeti aynı kalıbı (ModuleStat + liste) tekrarlıyor; ortak bir özet iskeleti bileşeni çıkarılabilir (mimari sadeleştirme, büyük iş).
- /die-followup için ilişki haritasında Bağlantı sütunu /alarms, /die-followup/maintenance, /die-followup/problems gösteriyor ama /die-followup/reports (Pareto raporu) özetten bağlanmıyor; navigasyon tasarımıyla birlikte ele alınmalı.
- Depolar sayfasında 'MB52 has stock in locations not defined here' uyarısındaki her depo kodu için tek tıkla 'Add location' (kodu forma doldur) eylemi eklenebilir; sayfanın devamı (satır 220 sonrası) görüldükten sonra küçük görev olarak yazılmalı.
