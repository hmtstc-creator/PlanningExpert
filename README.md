# Üretim Planlama

Preshane üretim planlama sistemi (Claude/Macaly'de geliştirildi, buradan
Claude Code ile devam edilebilir).

## Kurulum

```bash
npm install
```

Bu proje mevcut Convex backend'ine (`.env.local` içinde tanımlı) bağlanacak
şekilde ayarlı — yani Referanslar, Siparişler, Stoklar vb. sayfalara daha
önce girdiğin tüm veri korunuyor, sıfırdan kurulum gerekmiyor.

## Geliştirme

```bash
npm run dev
```

Ayrıca arka planda Convex fonksiyonlarını izlemek ve deploy etmek için:

```bash
npx convex dev
```

## Önemli notlar

- Bu proje Macaly Cloud'dan dışa aktarıldı. `@macaly/bridge` ve
  `@macaly/static-tagger` paketleri (Macaly'ye özel) kaldırıldı; bunlar
  olmadan proje normal şekilde çalışır.
- `src/components/ui/*` klasörü (shadcn/ui bileşenleri) bu pakette YOK —
  şu anki sayfalar bunlara ihtiyaç duymuyor. İleride ihtiyaç olursa:
  `npx shadcn@latest add <bileşen-adı>`
- Convex şemasında bazı alanlar `@deprecated` olarak işaretli
  (`machines`, `machinePriorities` tabloları, `products` içindeki `name`,
  `material`, `cycleTimeSeconds`) — bunlar eski sürümlerden kalma,
  geriye dönük uyumluluk için tutuluyor, silersen mevcut veriler bozulabilir.

## Sayfalar

- `/` — Özet (dashboard)
- `/siparisler` — ZPP / ZPP_DAILY yükleme ve görüntüleme
- `/stoklar` — MB52 stok yükleme, özet/detay görünüm
- `/referanslar` — Kalıp/makine referans verisi
- `/planlama` — Talep oluşturma (ZPP'den otomatik veya elle) + plan üretme
- `/depolar` — Depo yeri kategorileri (planlamaya dahil / satılmış-buffer / hariç)
- `/takvim` — Vardiya, çalışma günleri, tatiller
- `/kayitlar` — Karar/kural/geliştirme/sorun kayıtları

## Sayfalar

| Sayfa | Ne yapar |
| --- | --- |
| Özet | Günlük durum, bakiye, uyarılar, akış adımları |
| Siparişler | ZPP / ZPP_DAILY talep yükleme |
| Stoklar | MB52 stok yükleme |
| Gerçekleşen | MB51 gerçekleşen üretim yükleme |
| Referanslar | Kalıp/makine kartları, göz sayısı, SPM, ağırlıklar, max shot |
| Planlama | Otomatik plan, müdahale, onay |
| Performans | Plan/gerçekleşen karşılaştırması, kapasite katsayısı |
| Makine Tanımları | Pres ve hol tanımları (vinç kısıtı buradan) |
| Kalıp Ömrü | Kalıp vuruş sayacı ve bakım kayıtları |
| Depo Tanımları | Depo yerlerinin kategorilendirilmesi |
| Çalışma Takvimi | Vardiya, mola, tatil, plan ufku, pres bazlı takvim |
| Bağlantı Teşhisi | Hangi veritabanına bağlı olduğunu gösterir |

## Planlama motoru

Plan tamamen otomatik hesaplanır; elle plan girilmez. Öncelik sırası:

1. **Bakiye** (gecikmiş talep) — plan başından itibaren üretilebilir.
2. **Acil** — stoğu en çabuk bitecek malzemeler (stok kaç gün yetiyor).
3. **Dolgu** — kalan kapasite; bu kalemler kendi ihtiyaç haftasından önce
   üretilmez, aksi halde erken üretim stok şişirir.

Gözetilen kısıtlar:

- Aynı holdeki presler aynı anda setup yapamaz (vinç); ardışık setuplar
  arasında en az `setupGapMinutes` bırakılır.
- Aynı kalıp aynı anda iki preste çalışamaz (dakika aralığı bazlı kontrol);
  aynı gün içinde ardışık çalışabilir.
- Kalıp maksimum baskı limiti aşılıyorsa üretim partilere bölünür.
- Rulo sayısı brüt ağırlık ve rulo ağırlığından hesaplanır; her rulo için
  rulo setup süresi eklenir.
- Eş üründen (aynı vuruşta çıkan parça) üretilen miktar, eş ürünün
  talebinden düşülür.
- Resmi tatiller ve çalışma günü tanımı kapasiteyi sıfırlar/kısar; vardiya
  başına mola süresi her vardiyadan düşülür.

Hesaplama katmanı Convex ve React'ten bağımsızdır (`src/lib/`), bu yüzden
birim testi yazılabilir:

```bash
npm test
```

## "Telefonda girdiğim veri bilgisayarda görünmüyor"

Bunun tek sebebi vardır: iki cihaz farklı Convex deployment'ına bakıyordur.

1. **Ayarlar → Bağlantı Teşhisi** sayfasını hem telefonda hem bilgisayarda aç.
2. **Deployment** satırındaki adı karşılaştır.
3. Adlar farklıysa Vercel projesindeki `CONVEX_DEPLOY_KEY` bir `preview:`
   anahtarıdır. Preview anahtarı her dal için ayrı ve geçici bir veritabanı
   oluşturur. Convex panelinden `prod:` ile başlayan production anahtarını
   alıp Vercel'de değiştir.
4. Adlar aynıysa ve kayıt sayıları farklıysa tarayıcı önbelleğidir —
   sayfayı yenile.

Yazma hatası olursa artık ekranın altında uyarı çıkar; sessizce kaybolmaz.

## Vercel build komutu

`convex deploy --cmd`, build komutunu codegen'den ÖNCE çalıştırır; bu yüzden
codegen ayrıca çağrılmalıdır:

```
npx convex codegen && npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL
```
