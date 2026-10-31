# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261031-0040 · src/routes/account.tsx · degisiklik-yok: Odak sayfa Hesabım (/account) incelendi. Sayfa tek kaynak ilkesine uyuyor: kimlik ve izinler plant bağlamından, oturumlar users.mySessions'tan geliyor, katman ihlali yok. Mimari ve planlama açısından bulgu çıkmadı. Vardiya mühendisi ve amir tarafında tek eksik, durum mesajlarının ekran okuyucuya duyurulmaması ve eski başarı mesajının yeni 

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Hesabım sayfasında hiçbir bağlantı yok (harita: Bağlantı boş); yöneticiler için 'Users' (/users) bağlantısı ve plant değiştirici kısayolu eklenebilir, ancak yetki mantığına dokunduğu için önce yetki kuralları gözden geçirilmeli.
- Devices bölümü yalnızca açık oturum sayısını gösteriyor; cihaz/tarayıcı adı ve son etkinlik zamanı için users.mySessions çıktısının genişletilmesi gerekir (Convex tarafı, görev dışı).
- Kendi son kayıtlarını gösteren 'Recent changes by me' bölümü /kayitlar verisiyle eklenebilir; vardiya amiri için denetim izi görünürlüğü artar, ama ayrı bir tasarım kararı gerektirir.
