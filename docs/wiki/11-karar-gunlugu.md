# 11 · Karar günlüğü (neden böyle?)

> Son güncelleme: 2026-10-22 · Kaynak: `docs/decisions.md` (iş kararlarının tam listesi) + bu sohbetlerdeki mühendislik kararları

Biçim: **Karar** — *neden* — *alternatif* (neden seçilmedi).

## Plan ve hesap

- **Müşteri önce, doluluk sonra** — geç bir parça müşteriyi durdurur; doluluk / setup kazancı bunun yerini tutmaz. *Alt.: doluluğu önce* (reddedildi).
- **Geç iş = pay, bütün sipariş değil** (2026-10-22) — ZPP günlük ihtiyaç rehber; teslimde yarısı hazırsa yarısı zamanında. *Alt.: yalnızca son parçanın gecikmesi* (müşteri etkisini abartıyordu).
- **Müşteri duruş süresi hesaplanmaz, tahmin gösterilir** — tüketim saatleri bilinmiyor; *ortalama* ve *son parça* verilir.
- **Lot bölme yerel aramada, ek setup yalnızca geç işi kurtarırsa** (2026-10-22) — mevcut puan sırası aynen kalır; mimariyi (varyant listesi) değiştirmez.
  *Alt.: ayrı bir "bölünmüş" senaryo ailesi* (arama büyüklüğünü katlardı).
- **Tam rulo sınırında bölme, Min. lot altına inmez** — bağlı rulo kesilmez; Min. lot bilinçli korunur.
- **İhtiyacı olmayan lot parçası dolgu fazına geçer** — faz sırası fazları aşmadığı için yoksa geç lot araya giremezdi.
- **Hammadde plandan bağımsız** — plan eklemek mükerrer sipariş doğurur.
- **Tedarik süresi takvim günü, yalnızca siparişi tarihler** — tedarikçi takvimle verir; teslim haftasını kaydırmak emniyet mantığını bozardı.
- **Plan elle hesaplanır** (2026-10-07) — otomatik / saatlik hesap Convex kotasını dolduruyordu.

## Yayın ve işletim

- **Yayın zamanlayıcıyla otomatik** (2026-10-22) — bulut oturumu sunucu oturumuna mesaj gönderemiyor; her yayın için onay istenmesi kabul edilmedi.
  *Alt.: sunucu oturumuna kalıcı komut izni* (yetki yüzeyi geniş; zamanlayıcı daha küçük).
- **Başarısız commit yeniden denenmez** — yedek ve derleme her 5 dakikada tekrarlanmasın.
- **Kilit betiğin içinde** — servis sarmalayıcısı elle çalıştırmayı korumuyordu.
- **Birleşen PR dalı otomatik silinir (GitHub iş akışı)** — bulut oturumundan dal silinemiyor (izin sistemi).
- **Her şey VPS'te** (2026-10-16) — Vercel / Convex Cloud kaldırıldı; veri ve yayın tek yerde.
- **Bir iş = bir oturum** (2026-10-22) — tek uzun sohbet bağlamı 560k token'a çıkardı ve kullanım hızla doluyordu; bilgi zaten wiki'de olduğu için her iş yeni oturumda başlar, kapanışta `/devir` skill'i wiki'yi günceller.
- **Wiki + CLAUDE.md + CI denetimleri** (2026-10-22) — oturumlar arası bilgi depoda kalıcı; mantık değişince sayfa güncellemesi ve mimari kural ihlali CI'da yakalanır.

- **Devir = docs PR'ı** (2026-10-22) — iş bitince `/devir`: sürüm günlüğü satırı, kararlar ve dersler, "Devam" maddesi tek docs PR'ında; CI yeşilse birleşir.
  Yeni oturum yalnız depoyu okuyarak başlar. *Alt.: sohbet özeti* (oturum bitince kaybolur).

## Arayüz

- **Geç listede öneri yerine neden** — planlamacı hafta içi çözüm bulamaz; ne yüzden geç olduğunu ve hesabın nereden geldiğini görmeli.
- **Sağlık göstergesi gerçek veri akışına bakar** — "healthy" yalnızca soket açık demek değildi.
- **Telefonda tablo yerine kart** — yana kayan tabloda açıklama görünmüyordu.

## Yönetim ekranları

- **Organization map ayrı sayfa, eski sayfalar kalır** (2026-10-22) — kullanıcı istedi; harita yeterli olunca eski ağaç / Users & permissions onayla kaldırılır. *Alt.: eski sayfayı hemen değiştirmek* (geri dönüşsüz, riskli).
- **Harita yeni sunucu kodu yazmaz** (2026-10-22) — sürükle-bırak mevcut mutation'ları çağırır (`setCompanyHolding`, `updatePlant`, `users.update`, `saveGroup`); yetki ve denetim kaydı tek yerde kalır. Work center sürükleme yok: `presses.upsert` aktif plant ve tam kayıt ister. *Alt.: harita için yeni mutation* (kural kopyası).
- **Tuval kütüphanesi `@xyflow/react` (sürüm sabit)** — kaydırma, yakınlaştırma, mini harita, çarpışma (`getIntersectingNodes`) hazır; yerleşim kendi saf fonksiyonumuz (test edilir). *Alt.: elle SVG tuval* (çok kod).
- **PR'ı Claude birleştirir** (2026-10-22, kullanıcı) — CI `verify` yeşil ve açık yorum yoksa taslak PR hazır yapılır, squash merge edilir; kullanıcı beklenmez. *Alt.: kullanıcı birleştirir* (her PR'da bekleme).
