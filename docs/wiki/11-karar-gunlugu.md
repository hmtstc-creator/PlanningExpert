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
- **Wiki + CLAUDE.md + CI denetimleri** (2026-10-22) — yeni sohbet açılmayacağı için bilgi depoda kalıcı; mantık değişince sayfa güncellemesi ve mimari kural ihlali CI'da yakalanır.

## Arayüz

- **Geç listede öneri yerine neden** — planlamacı hafta içi çözüm bulamaz; ne yüzden geç olduğunu ve hesabın nereden geldiğini görmeli.
- **Sağlık göstergesi gerçek veri akışına bakar** — "healthy" yalnızca soket açık demek değildi.
- **Telefonda tablo yerine kart** — yana kayan tabloda açıklama görünmüyordu.
