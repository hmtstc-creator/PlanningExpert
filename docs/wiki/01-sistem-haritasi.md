# 01 · Sistem haritası

> Son güncelleme: 2026-10-25 (harita düzenleme) · Kaynak: `docs/architecture.md` (ayrıntı ve **tek kaynak haritası** orada)

## Ne bu?

Pres üretimi için kiralanan, çok şirketli üretim planlama portalı: **PlanningExpert** (plan),
**OEE**, **KPI**, **Die Follow-up**, **Machine Follow-up**, **Board Dashboard**. Tek sistem, tek adres;
her fabrikanın (plant) verisi ayrıdır. Organizasyon: `Holding → Company → Plant → Department → Cost center → Work center`.

## Üç katman (içten dışa bağımlılık yönü)

```
src/lib/*.ts  (SAF hesap kütüphanesi — React'e de Convex'e de bağlı DEĞİL)
      ▲
convex/*.ts   (sunucu: şema, guardedQuery/guardedMutation, planEngine action)  ← src/lib'i kullanır
      ▲
src/routes + src/components  (arayüz: veriyi okur, girdiyi yazar, HESAP YAPMAZ)
```

- **Hesap yalnızca `src/lib`'de.** Bir sayıyı üreten formül tek fonksiyondur; sayfalar göstermek için küçük
  türetme yapabilir ama formül yazmaz.
- **Sunucu `src/lib`'i kullanır, arayüze bağlanmaz.** `convex/` hiçbir zaman `src/routes` / `src/components` içe aktarmaz.
- **Arayüz sayfaları birbirini içe aktarmaz**; ortak parça `src/components`'tedir.
- Bu üç kural `src/lib/architecture.test.ts` ile **otomatik denetlenir** (bkz. [07](07-calisma-sozlesmesi.md)).

## Teknoloji

React 19 · TanStack Start/Router · Tailwind v4 · **Convex (self-hosted)** · Docker Compose · Tailscale Funnel ·
Hetzner VPS. Dış barındırma yok (Vercel / Convex Cloud kaldırıldı, 2026-10-16). Ayrıntı: [05](05-yayin-ve-isletim.md).

## Veri akışı

1. Kullanıcı bir girdiyi değiştirir (Excel yükleme, ayar, takvim, master data, plan müdahalesi).
2. Mutation `affectsPlan` ise plan **eskimiş** işaretlenir. Plan **elle hesaplanır** (Planning → Calculate plan);
   otomatik / saatlik hesap kapatıldı (Convex okuma-yazma kotası, 2026-10-07).
3. `convex/planEngine.ts` (Node action) girdileri okur, `src/lib/planPipeline.ts`'i çalıştırır, sonucu `planRuns`'a yazar (son 3 hesap).
4. Plan sayfaları hazır sonucu okur; herkes aynı planı görür.
5. Bağımsız doğrulayıcı (`planValidator.ts`) aynı sonucu motordan ayrı kodla yeniden oynatır ([03](03-gec-is-tanimi.md)).

## Önemli dosyalar (hangi iş nerede)

| Konu | Dosya |
|---|---|
| Uçtan uca plan | `src/lib/planPipeline.ts` |
| Yerleştirme (pres/gün) | `src/lib/scheduler.ts` |
| Lot, rulo, hafta kovaları | `src/lib/planning.ts` |
| Kapasitenin tek formülü | `src/lib/capacityModel.ts` |
| Takvim kuralları | `src/lib/pressCalendar.ts`, `src/lib/shiftTimeline.ts` |
| Ayar varsayılanları (tek yer) | `src/lib/settingsDefaults.ts` |
| Hammadde MRP, tedarik süresi | `src/lib/rawMrp.ts`, `src/lib/rawLeadTime.ts`, `convex/rawLeadTimes.ts` |
| Bağımsız doğrulama | `src/lib/planValidator.ts` (motorla kod paylaşmaz) |
| Plan müdahaleleri | `convex/planOverrides.ts`, `convex/planJobLocks.ts` |
| Yetki | `convex/guarded.ts`, `convex/tenancy.ts` |
| Organizasyon ağacı ve haritası (`/admin`, `/admin/map`) | `src/lib/orgTree.ts`, `src/lib/orgMap.ts` (`nodeEdits`), `src/components/org/OrgMapEditor.tsx`, `convex/platform.ts`, `convex/users.ts` |
| İstemci taşıma (WebSocket / HTTPS) | `src/lib/convexTransport.tsx` |
| Yayın | `scripts/deploy.sh`, `scripts/release.sh`, `deploy/systemd/` |

## Değişmezler (bozulmaması gerekenler)

1. **Tek kaynak:** aynı değer iki yerde hesaplanmaz / varsayılanlanmaz (`docs/architecture.md` §2).
2. **Fabrikaya kilitli veri:** her sorgu `plantId` ile; yeni tablo `plantField` taşır ve `guardedQuery/guardedMutation` kullanır.
3. **Doğrulayıcı bağımsızdır:** `planValidator.ts` motorun hesap kodunu çağırmaz (yalnızca tür, depo matrisi ve varsayılanlar).
4. **Müşteri önce:** plan seçiminde sıra *plansız → geç malzeme → geç saat → geç lot*; doluluk ve setup bunun **altında** kalır.
5. **Bağlı rulo yarıda kesilmez.**
6. **Plan elle hesaplanır;** yayın otomatiktir.
7. **Canlı veri korunur:** şema geri uyumlu olmalı (`npm run schema:snapshot`, `schemaGuard.test.ts`); yayın öncesi yedek alınır.
