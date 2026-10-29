# Dağıtım (deploy) — VPS

Site ve veritabanı **kendi VPS'imizde** çalışır (Hetzner CX33, Karabasan botuyla aynı
makine). Dış barındırma hizmeti yoktur: Vercel ve Convex Cloud kullanılmaz (taşıma
2026-10-16'da tamamlandı). Adres ücretsiz: Tailscale Funnel
(`https://planningexpert.<tailnet>.ts.net`), sunucuda internete kapı açılmaz; Convex
SQLite ile, bellek sınırlı. Sunucu kitabı (güncelleme, yedek, geri yükleme, kurulum):
**[deploy/README.md](../deploy/README.md)**. Program iki parçadır:

| Parça | Ne | Nerede çalışır |
|---|---|---|
| **Arayüz** | TanStack Start (Vite + Nitro) — sayfalar ve sunucu tarafı render | VPS'te `web` kapsayıcısı (`node .output/server/index.mjs`) |
| **Sunucu + veritabanı** | Convex (self-hosted): bütün `convex/*.ts` işlevleri, tablolar, zamanlayıcı (günlük özet, gece temizliği; plan elle hesaplanır), dosyalar (fotoğraflar), Node action'ları (`auth.ts`, `planEngine.ts`) | VPS'te `backend` kapsayıcısı (`deploy/compose.yml`) |

GitHub yalnızca kodu ve CI'ı (`.github/workflows/ci.yml`: tip + test + build) tutar;
yayını sunucu yapar (`scripts/release.sh`). Nitro VPS'te varsayılan Node sunucusunu
üretir.

## Veri güvenliği — geliştirme sürerken canlı veri korunur

Kullanıcılar siteyi kullanırken geliştirme devam eder. Kural: **canlı
veritabanı hiçbir zaman silinmez, sıfırlanmaz, şeması daraltılmaz.**

| Risk | Önlem | Nerede |
|---|---|---|
| Şemadan alan / tablo kaldırmak, alanı zorunlu yapmak, tipi daraltmak | **Şema kapısı**: canlı şemanın kaydı `scripts/schema.snapshot.json`; yeni şema yalnızca genişleyebilir, aksi CI'da kırmızı (yayınlanmaz). Yeni alan eklenince `npm run schema:snapshot` | `convex/schemaGuard.test.ts`, `src/lib/schemaCompat.ts` |
| Yayın sırasında bir şey ters gitmesi | **Yayın betiği** önce doğrular, sonra canlı verinin tam yedeğini alır (dosyalar dahil), yedek yoksa durur; sonra Convex, en son arayüz | `scripts/release.sh` |
| Günlük veri kaybı | **Günlük yedek** (systemd timer, 02:15), son 30 tutulur; isteğe bağlı sunucu dışına kopya | `scripts/backup.sh`, `deploy/systemd/` |
| Yanlış veritabanına yazmak | Betikler yalnızca kendi Convex sunucumuza yazar (`CONVEX_SELF_HOSTED_URL` + `_ADMIN_KEY`); başka bir Convex anahtarı tanımlıysa durur | `scripts/convex-target.sh` |
| Geliştirirken canlıya yazmak | Geliştirme **yerel** bir Convex'te (aşağıda "Yerel geliştirme"); canlı sunucuya yalnızca sunucudaki `scripts/release.sh` yazar | — |
| Veriyi dönüştüren geçiş | Geçiş bir kerelik bayrakla, tekrar çalışırsa zararsız, eski alanı silmeden (docs/architecture.md kural 12) | `planRuns.migrateSettings`, `tenancy.backfill` |
| Elle silme | Tek kayıt, onaylı; şirket / plant silme ad yazılarak, şirket için askıdan 90 gün sonra; kullanımdaki work center / parça / cost center silinmez | `convex/platform.ts`, `workCenterRefs.ts`, `materialRefs.ts` |

**Alan kaldırmak gerekirse (iki yayın):** (1) kod alanı okumayı / yazmayı
bırakır, bir geçiş alanı boşaltır, yayınlanır; (2) bir sonraki yayında alan
şemadan ve `scripts/schema.snapshot.json`'dan elle çıkarılır (gerekçe commit
mesajında).

**Geri dönüş:** yedekten `npx convex import --replace-all` — önce geçici bir
Convex'te denenir (deploy/README.md → Geri yükleme provası, Geri dönüş).

## Yayın adımları

```bash
# GitHub'da commit'in CI'ı yeşil olduktan sonra, sunucuda:
cd /opt/planningexpert && git pull
set -a; . /etc/planningexpert/portal.env; set +a
./scripts/release.sh                         # yedek → convex deploy → site derlemesi
docker compose -f deploy/compose.yml restart web
```

- **Sıra önemli:** önce `convex deploy`, sonra arayüz. Tersi olursa arayüz
  henüz olmayan işlevi çağırır (ekranda "function has not been pushed").
- Convex CLI `CONVEX_SELF_HOSTED_URL` ve `CONVEX_SELF_HOSTED_ADMIN_KEY` ile çalışır
  (`/etc/planningexpert/portal.env`; admin anahtarı:
  `docker compose exec backend ./generate_admin_key.sh`). `VITE_CONVEX_URL` =
  backend'in dışarıdan erişilen adresi (`CONVEX_PUBLIC_URL`; betik kendisi ayarlar).
- CSP yalnızca bu adrese izin verir (`src/lib/securityHeaders.ts`); başka bir Convex
  adresine bağlanan bir derleme tarayıcıda engellenir.
- Şema değişikliği geriye uyumludur (docs/architecture.md kural 12): yeni
  alan `v.optional`. Alan kaldırmak iki adımda yapılır: önce veri temizlenir,
  sonra şemadan silinir.

## Yerel geliştirme

Geliştirme bulut hesabı olmadan, bilgisayarda çalışan geçici bir Convex ile:

```bash
docker run -d --name pe-dev -p 127.0.0.1:3210:3210 -p 127.0.0.1:3211:3211 \
  -e INSTANCE_SECRET="$(openssl rand -hex 32)" ghcr.io/get-convex/convex-backend:<sürüm>
docker exec pe-dev ./generate_admin_key.sh
# .env.local (git'e girmez):
#   CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
#   CONVEX_SELF_HOSTED_ADMIN_KEY='…'
#   VITE_CONVEX_URL=http://127.0.0.1:3210
npx convex dev                                # işlevleri yerel Convex'e yükler, izler
npm run dev                                   # arayüz: http://localhost:3000
```

Canlı veriye benzer veriyle denemek için bir gece yedeği yerel Convex'e
`npx convex import --replace-all` ile yüklenebilir (yedek kişisel veri içerir;
bilgisayarda bırakılmaz).

## Sunucuda olması gerekenler

- Convex backend (SQLite) + site + Tailscale (Docker Compose, `deploy/compose.yml`);
  Convex paneli yalnızca gerektiğinde (`--profile tools`), dışarıya açılmaz.
- Günlük otomatik yedek, isteğe bağlı sunucu dışına kopya; ayda bir geri yükleme
  provası (`scripts/compare-exports.mjs` ile doğrulanır).
- HTTPS: Tailscale Funnel; güvenlik duvarı: yalnızca `tailscale0`.
- İzleme: sunucu ayakta mı (dış uptime kontrolü — todolist.md 4.1), disk / bellek;
  uygulama hataları zaten System errors'ta.
- Zamanlanmış işler (`convex/crons.ts`) backend'le birlikte çalışır; ayrı cron
  gerekmez.

## Karar geçmişi: Convex nerede?

2026-10-03: önce arayüz VPS'e, Convex bulutta (A). **2026-10-14: B** — Convex de
VPS'e (veri tamamen bizim sunucumuzda; SQLite, çünkü sunucunun belleği botlarla
paylaşılıyor, Postgres yok). 2026-10-16: taşıma tamamlandı; bulut hizmetleri
bırakıldı. Bedeli: yedek ve backend güncellemesi bizim işimiz, tek sunucu = tek
arıza noktası (izleme ve yedek şart).

## Günlük özet e-postası (Today & daily digest)

E-posta Resend üzerinden gider. Anahtar programda ve veritabanında **tutulmaz**;
Convex sunucumuzun ortam değişkenidir (sunucuda `npx convex env set`, ya da Convex
paneli → Settings → Environment Variables; deploy/README.md → Ortam değişkenleri):

| Değişken | Ne | Örnek |
|---|---|---|
| `RESEND_API_KEY` | Resend API anahtarı | `re_…` |
| `DIGEST_FROM` | Gönderen (doğrulanmış alan adı) | `Production Portal <portal@firma.com>` |
| `APP_URL` | İsteğe bağlı: e-postadaki bağlantılar | `https://planningexpert.<tailnet>.ts.net` |

Alıcılar, gün, saat ve içerik Company settings → Today & daily digest'te.
Ayarlanmamışsa özet gönderilmez ve sayfa nedenini söyler.

## OEE açık konular — yapay zekâ (OEE → Open Topics)

Ajan (`convex/oeeTopics.ts`) OpenAI uyumlu herhangi bir sohbet API'sini kullanır.
Anahtar da e-postadaki gibi Convex sunucumuzun ortam değişkenidir (bulut değil;
Convex 2026-10-16'dan beri bu VPS'te). Anahtar yoksa kurallar karar verir; sayfa
"AI not set up" yazar.

| Değişken | Ne | Örnek |
|---|---|---|
| `AI_API_KEY` | Servisin API anahtarı (zorunlu) | Gemini `AIza…`, Groq `gsk_…` |
| `AI_API_URL` | İsteğe bağlı; yoksa Gemini | `https://api.groq.com/openai/v1/chat/completions` |
| `AI_MODEL` | İsteğe bağlı; yoksa `gemini-flash-latest` | `llama-3.3-70b-versatile` (Groq) |

Ücretsiz anahtar:
- **Google Gemini** (varsayılan): https://aistudio.google.com → Google hesabıyla gir →
  *Get API key* → *Create API key* → kopyala. Kart gerekmez.
- **Groq** (alternatif): https://console.groq.com → kaydol → *API Keys* → *Create API Key*.

Sunucuya yazma (anahtar sohbete, git'e, mesaja yazılmaz):

```bash
ssh <sunucu>
cd /opt/planningexpert
set -a; . /etc/planningexpert/portal.env; set +a
npx convex env set AI_API_KEY '<anahtar>'
# yalnız Groq için:
npx convex env set AI_API_URL 'https://api.groq.com/openai/v1/chat/completions'
npx convex env set AI_MODEL 'llama-3.3-70b-versatile'
npx convex env list    # adlar görünür; değeri ekrana dökme
```

Yeniden yayın gerekmez. Deneme: OEE → Open Topics → *Analyse the last day* (o gün daha
önce işlendiyse bir sonraki yüklemede çalışır). Satırda "AI (model)" görünmeli.
Ücretsiz katmanda servis gönderilen veriyi (masraf yeri / iş yeri / kayıp grubu adları
ve dakikalar) kendi geliştirmesi için kullanabilir.

## SOP Builder — işleyici ve yapay zekâ (Machine Follow-up → SOP Builder)

Video analizi ayrı kapsayıcıda çalışır (`sop-worker`, `deploy/compose.yml`): ffmpeg + Gemini
Files API. Anahtarlar **worker'ın** ortamındadır (`deploy/.env`), OEE'nin `AI_API_KEY`'inden
ayrı; Convex'e yalnız worker jetonu yazılır. Kurulum adımları: `deploy/README.md` → *SOP Builder*.

| Değişken | Nerede | Ne |
|---|---|---|
| `SOP_WORKER_TOKEN` | `deploy/.env` **ve** Convex (`npx convex env set`) | Worker ↔ Convex jetonu (ikisinde aynı; `openssl rand -hex 32`) |
| `SOP_AI_KEY` | `deploy/.env` | Gemini anahtarı (Google AI Studio `AIza…`); yoksa `AI_API_KEY` denenir |
| `SOP_AI_MODEL` | `deploy/.env` (isteğe bağlı) | Varsayılan `gemini-flash-latest`; videoyu anlayan bir Gemini modeli olmalı |

Ücretsiz katmanda Google gönderilen videoyu kendi geliştirmesi için kullanabilir; gizli bir
operasyon için ücretli katman (faturalandırma açık proje) kullanılmalı.

