# 07 · Çalışma sözleşmesi ve mimari etki kontrolü

> Son güncelleme: 2026-10-22 · Kaynak: `CLAUDE.md`, `docs/architecture.md` §4, `src/lib/architecture.test.ts`

Yeni bir sohbet açılmadığı için bu sayfa her oturumun **ilk okuyacağı yerdir**.

## Yeni talimat geldiğinde — uygulamadan ÖNCE (zorunlu)

Genel mimariye zarar vermediğini **önce** kontrol et. Kısa kontrol listesi (cevaplar PR açıklamasına yazılır):

1. **Hangi katman?** Hesap `src/lib`'e, veri / yetki `convex/`'e, gösterim `src/routes|components`'e. Katman sırası bozulmuyor mu? (`architecture.test.ts`)
2. **Tek kaynak:** bu değer / formül / varsayılan zaten bir yerde var mı? Varsa orayı kullan, kopyalama (`docs/architecture.md` §2 tablosu).
3. **Motorun değişmezleri** ([01](01-sistem-haritasi.md) *Değişmezler*): müşteri önce, rulo kesilmez, doğrulayıcı bağımsız, plan elle hesaplanır.
4. **Canlı veri:** şema değişiyorsa geri uyumlu mu? Yeni tablo ayrı mı, `plantField` var mı, `guardedQuery/Mutation` kullanıldı mı? `npm run schema:snapshot`.
5. **Planning Logic:** mantık değişiyorsa sayfa aynı PR'da güncelleniyor mu? Davranışı gösteren test var mı? (CI denetler.)
6. **Wiki:** ilgili sayfa + [08 Sürüm günlüğü](08-surum-gunlugu.md) güncellendi mi?
7. **Etkilenen diğer sayfalar / hesaplar:** `grep` ile kullanım yerlerine bak (özellikle `PlanRun` alanları, `cockpit`, Overview, Excel çıktıları, doğrulayıcı).
8. **Geri alınabilir mi?** Yayın otomatik olduğu için merge = canlı. Riskli değişiklik ayrı, küçük PR olur.

Bir madde "hayır" ise **uygulama**; nedenini ve alternatifi kullanıcıya yaz. Karar gerekiyorsa `docs/decisions.md`'ye eklenir.

## Otomatik korumalar (kırılırsa CI kırmızı)

| Koruma | Denetlediği |
|---|---|
| `src/lib/architecture.test.ts` | katman yönü (lib ↔ convex ↔ arayüz), saf hesap dosyaları React / Convex / TanStack içe aktarmaz, doğrulayıcı motor koduna bağlanmaz |
| `src/lib/wiki.test.ts` | wiki dizini tam, bütün bağlantılar çalışıyor |
| `scripts/check-logic-docs.sh` | mantık dosyası değişti ⇒ Planning Logic değişti |
| `convex/schemaGuard.test.ts` (+ `schema.snapshot.json`) | şema geri uyumlu |
| `convex/security.test.ts`, `tenancy.test.ts`, `authGuard.test.ts` | yetki ve fabrika kilidi |
| `npm run verify` | tip + bütün testler + build |

## Çalışma kuralları (kullanıcıyla anlaşılanlar)

- **Onay beklemeden ilerle** (planlamacı): proje için emin olunan iş yayına alınır; silinmesi gereken şeyleri kullanıcıya söyle.
  Yayın otomatiktir; birleştirmeden önce CI yeşil olmalı. Dışarıya dönük / geri alınamaz işlerde (silme, harici hizmet) yine dikkatli ol.
- **Dil:** kullanıcıya Türkçe, kısa, madde madde; commit ve PR metinleri Türkçe.
- **Token tasarrufu** (2026-10-22): basit / mekanik işler için küçük model ve düşük çaba; karmaşık işte (motor, mimari) güçlü model ve yüksek çaba.
  Model değiştirmeyi oturum yapamaz; kullanıcı `/model` ile yapar. Gereksiz dosya okuma, tekrar özet ve uzun yanıt yok.
- **Her şey yazılı:** yeni bir bilgi, karar ya da öğrenilen ders aynı gün wiki'ye girer (yeni sohbet olmayacak).
- Gizli değer yazılmaz; sunucuya doğrudan erişim yok (bulut oturumu sunucu oturumuna mesaj gönderemez).

## PR akışı

`git checkout -b claude/<konu>` → değişiklik + test + Planning Logic + wiki → `npm run verify` → push → **taslak PR** (Türkçe, ne / neden / test) →
CI yeşil → squash merge → site ~5 dk içinde güncellenir → Connection diagnostics'te commit doğrulanır. Dal otomatik silinir.

## Wiki sayfa şablonu

```
# NN · Başlık
> Son güncelleme: YYYY-MM-DD · Kaynak: <dosyalar> · Kullanıcıya dönük: <Planning Logic bölümü>
Ne / neden → nasıl çalışıyor → önemli kararlar ve tuzaklar → dokunulmaması gerekenler → testler.
```
