# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261031-0140 · src/routes/admin_.map.tsx · degisiklik-yok: Odak sayfa Organization map (/admin_/map) incelendi. Sayfa ince bir sarmalayıcı: tüm mantık OrgMap bileşeninde, sayfa kendi başına veri okumuyor/yazmıyor, tek kaynak ve katman açısından sorun yok. Haritada /admin_/map sayfasından geri dönüş bağlantısı yok (/admin'den harita açılıyor ama harita sayfasında 'Administration'a dön' yolu yok)
- 20261031-0040 · src/routes/account.tsx · degisiklik-yok: Odak sayfa Hesabım (/account) incelendi. Sayfa tek kaynak ilkesine uyuyor: kimlik ve izinler plant bağlamından, oturumlar users.mySessions'tan geliyor, katman ihlali yok. Mimari ve planlama açısından bulgu çıkmadı. Vardiya mühendisi ve amir tarafında tek eksik, durum mesajlarının ekran okuyucuya duyurulmaması ve eski başarı mesajının yeni 

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Organization map sayfasında /admin'e ('Holdings & companies' ve 'Users & permissions') geri dönüş bağlantısı eklenebilir; harita ile liste sayfaları arasındaki ilişki yalnızca metinde anlatılıyor, tıklanabilir değil. PageHeader'ın bir 'back' ya da actions özelliği varsa kullanılmalı (önce PageHead
- /settings_/map sayfası ile /admin_/map neredeyse aynı yapıda (iki sarmalayıcı, aynı OrgMap); ortak bir sarmalayıcı bileşene indirgenerek tekrar azaltılabilir, ancak kapı (TenancyGate) önek mantığına dokunduğu için yetki gözden geçirmesiyle birlikte yapılmalı.
- Sayfada kırmızı çerçeveli sorunlar (aynı adlı plant, holdingsiz company vb.) yalnızca haritanın içinde görünüyor; /admin sayfasında bu sorunların sayısını gösteren bir rozet vardiya amiri/yönetici için haritaya hızlı giriş sağlar. Sorun sayımı OrgMap'te hesaplandığı için tek kaynağa taşınması gere
- Harita sürükle-bırak ile çalışıyor; klavye ve dokunmatik kullanım için alternatif (seçili düğümde 'Move to…' menüsü) sahada tablet kullanımı için değerli olabilir, ancak OrgMap içi büyük bir iş.
- Hesabım sayfasında hiçbir bağlantı yok (harita: Bağlantı boş); yöneticiler için 'Users' (/users) bağlantısı ve plant değiştirici kısayolu eklenebilir, ancak yetki mantığına dokunduğu için önce yetki kuralları gözden geçirilmeli.
- Devices bölümü yalnızca açık oturum sayısını gösteriyor; cihaz/tarayıcı adı ve son etkinlik zamanı için users.mySessions çıktısının genişletilmesi gerekir (Convex tarafı, görev dışı).
- Kendi son kayıtlarını gösteren 'Recent changes by me' bölümü /kayitlar verisiyle eklenebilir; vardiya amiri için denetim izi görünürlüğü artar, ama ayrı bir tasarım kararı gerektirir.
