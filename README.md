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
