# Dağıtım (deploy) — VPS

Durum (2026-10-03): site Vercel'den bir VPS'e taşınacak. Program iki
parçadır; ikisi ayrı düşünülür:

| Parça | Ne | Nerede çalışır |
|---|---|---|
| **Arayüz** | TanStack Start (Vite + Nitro) — sayfalar ve sunucu tarafı render | VPS'te Node süreci (`node .output/server/index.mjs`) |
| **Sunucu + veritabanı** | Convex: bütün `convex/*.ts` işlevleri, tablolar, zamanlayıcı (saat başı plan), dosyalar (fotoğraflar), Node action'ları (`auth.ts`, `planEngine.ts`) | A) Convex Cloud **ya da** B) VPS'te kendi barındırılan Convex |

Kodda Vercel'e bağlı bir şey yok; Nitro VPS'te varsayılan Node sunucusu
üretir.

## Veri güvenliği — geliştirme sürerken canlı veri korunur

Kullanıcılar siteyi kullanırken geliştirme devam eder. Kural: **canlı
veritabanı hiçbir zaman silinmez, sıfırlanmaz, şeması daraltılmaz.**

| Risk | Önlem | Nerede |
|---|---|---|
| Şemadan alan / tablo kaldırmak, alanı zorunlu yapmak, tipi daraltmak | **Şema kapısı**: canlı şemanın kaydı `scripts/schema.snapshot.json`; yeni şema yalnızca genişleyebilir, aksi CI'da kırmızı (deploy'a gitmez). Yeni alan eklenince `npm run schema:snapshot` | `convex/schemaGuard.test.ts`, `src/lib/schemaCompat.ts` |
| Yayın sırasında bir şey ters gitmesi | **Yayın betiği** önce doğrular, sonra production'ın tam yedeğini alır (dosyalar dahil), yedek yoksa durur; sonra Convex, en son arayüz | `scripts/release.sh` |
| Günlük veri kaybı | **Günlük yedek** (cron), son 30 tutulur; sunucu dışına da kopyalanır | `scripts/backup.sh` |
| Geliştirirken production'a yazmak | Geliştirme **ayrı dev deployment**'ta (`npx convex dev` kendi dev veritabanına yazar). `.env.local`'daki `CONVEX_DEPLOYMENT` production olmamalı; production'a yalnızca `scripts/release.sh` yazar (prod anahtarı olmadan çalışmaz) | — |
| Veriyi dönüştüren geçiş | Geçiş bir kerelik bayrakla, tekrar çalışırsa zararsız, eski alanı silmeden (docs/architecture.md kural 12) | `planRuns.migrateSettings`, `tenancy.backfill` |
| Elle silme | Tek kayıt, onaylı; şirket / plant silme ad yazılarak, şirket için askıdan 90 gün sonra; kullanımdaki work center / parça / cost center silinmez | `convex/platform.ts`, `workCenterRefs.ts`, `materialRefs.ts` |

**Alan kaldırmak gerekirse (iki yayın):** (1) kod alanı okumayı / yazmayı
bırakır, bir geçiş alanı boşaltır, yayınlanır; (2) bir sonraki yayında alan
şemadan ve `scripts/schema.snapshot.json`'dan elle çıkarılır (gerekçe commit
mesajında).

**Geri dönüş:** `npx convex import --replace backups/<dosya>.zip` (önce boş
bir deployment'ta denenir; production'a yalnızca gerçek bir kayıpta).

## VPS'e taşıma kontrol listesi — seçenek A (2026-10-03 kararı: haftaya)

Seçenek A'da veritabanı Convex'te kalır; taşınan yalnızca arayüzdür, veri
yerinden oynamaz.

1. Taşımadan önce `scripts/backup.sh` ile yedek al, dosyayı sunucu dışına kopyala.
2. VPS'te arayüzü **aynı production Convex adresiyle** kur (`VITE_CONVEX_URL`);
   eski site çalışmaya devam eder (iki adres aynı veriye bakar).
3. VPS adresinde giriş yap; **System → Connection diagnostics**'te deployment
   adı eski siteyle aynı mı, kayıt sayıları aynı mı bak.
4. Birkaç kullanıcıyla VPS adresini dene; sorun yoksa alan adını (DNS) VPS'e
   çevir. Eski siteyi bir hafta açık tut (geri dönüş yolu).
5. VPS'te `scripts/backup.sh` için cron ve `scripts/release.sh` ile yayın.

## Karar: Convex nerede? (2026-10-03: **A**, taşıma haftaya)

| | A) Arayüz VPS, Convex Cloud | B) Hepsi VPS (self-hosted Convex) |
|---|---|---|
| Kurulum | En kolay: yalnızca arayüz taşınır | Convex backend (Docker) + veritabanı (Postgres önerilir) + dashboard |
| Veri | Convex'te (ABD/AB bölgesi) | Tamamen sizin sunucunuzda (KVKK / müşteri isteği için güçlü) |
| Yedek | Convex panelinden | **Sizin işiniz**: Postgres yedeği + Convex dışa aktarımı, zamanlanmış |
| Güncelleme | Convex yapar | Backend imajını siz güncellersiniz |
| Maliyet | Convex planı | VPS kaynakları (plan motoru CPU ister) |
| Risk | Dış bağımlılık | Tek sunucu = tek arıza noktası; izleme ve yedek şart |

Öneri: müşteriye "veri bizim sunucumuzda" denecekse **B**, değilse
geçişi hızlı yapmak için önce **A**, sonra B.

## Yayın adımları (her iki seçenekte)

```bash
npm ci
npm run verify                         # tip + test + build; kırmızıysa yayınlama
npx convex deploy                      # önce Convex işlevleri ve şema
VITE_CONVEX_URL=<convex adresi> npm run build
node .output/server/index.mjs          # systemd / pm2 ile, önünde nginx/caddy (HTTPS)
```

- **Sıra önemli:** önce `convex deploy`, sonra arayüz. Tersi olursa arayüz
  henüz olmayan işlevi çağırır (ekranda "function has not been pushed").
- **A** için `CONVEX_DEPLOY_KEY` = Convex panelinden `prod:` anahtarı.
- **B** için Convex CLI self-hosted backend'in adresi ve admin anahtarıyla
  çalışır (Convex self-hosting belgesindeki ortam değişkenleri; kurulumda
  doğrulanacak). `VITE_CONVEX_URL` = backend'in dışarıdan erişilen adresi.
- Şema değişikliği geriye uyumludur (docs/architecture.md kural 12): yeni
  alan `v.optional`. Alan kaldırmak iki adımda yapılır: önce veri temizlenir,
  sonra şemadan silinir.

## B seçilirse VPS'te olması gerekenler

- Convex backend + Postgres (Docker Compose), Convex dashboard (yalnızca
  VPN / IP kısıtlı).
- Günlük otomatik yedek (Postgres dump + dosya deposu) başka bir yere
  (S3 vb.); ayda bir geri yükleme provası.
- HTTPS (caddy / nginx + Let's Encrypt), güvenlik duvarı (yalnızca 443).
- İzleme: sunucu ayakta mı (dış uptime kontrolü), disk / CPU alarmı; uygulama
  hataları zaten System errors'ta.
- Saat başı plan hesabı (`convex/crons.ts`) backend'le birlikte çalışır;
  ayrı cron gerekmez.
