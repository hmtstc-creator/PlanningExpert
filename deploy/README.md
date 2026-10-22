# VPS — site ve Convex kendi sunucumuzda

PlanningExpert'in **tamamı** kendi sunucumuzda çalışır — Hetzner CX33 (Ubuntu 24.04),
Karabasan botuyla **aynı makine**. Dış barındırma hizmeti (Vercel, Convex Cloud)
kullanılmaz. Adres (ücretsiz, Tailscale Funnel; sunucuda internete kapı açılmaz):

- Site: `https://planningexpert.<tailnet>.ts.net`
- Convex API: `https://planningexpert.<tailnet>.ts.net:8443`

| Parça | Ne | Nerede |
|---|---|---|
| `ts` | Tailscale cihazı "planningexpert": Funnel ile HTTPS | `deploy/compose.yml` |
| `backend` | Convex (self-hosted): `convex/*.ts` işlevleri, tablolar, zamanlayıcı, dosyalar (fotoğraflar); veritabanı SQLite (volume `convex-data`) | `deploy/compose.yml` |
| `web` | Site: TanStack Start / Nitro Node sunucusu (`.output/server/index.mjs`) | `deploy/compose.yml` |
| `dashboard` | Convex paneli — yalnızca gerektiğinde (`--profile tools`) | `deploy/compose.yml` |
| Yedek | Her gece 02:15, son 30 (isteğe bağlı sunucu dışı kopya) | `scripts/backup.sh`, `deploy/systemd/` |

Kod `/opt/planningexpert`'te, dal **`main`** (sunucu yalnızca `main`'den güncellenir;
yeni iş kısa ömürlü bir dalda yapılır, CI yeşilken PR ile `main`'e girer). Gizli değerler yalnızca
sunucuda: `deploy/.env` ve `/etc/planningexpert/portal.env` (ikisi de `chmod 600`).

## Mantık: kim ne yapar

| Kim | Ne yapar |
|---|---|
| **Bulut oturumu** (Claude, bu depo) | Kodu, betikleri ve bu kitabı hazırlar; GitHub'a gönderir, CI'ın yeşil olduğunu görür. Sunucuya erişmez. |
| **Sunucu oturumu** (sunucudaki Claude Code, Remote Control) | Komutları çalıştırır (güncelleme, yedek, geri yükleme provası), sonunda **rapor** verir. Kontrol kırmızıysa durur. |
| **Ahmet** | Yalnızca 🔑 kapılarda: Tailscale onay bağlantıları, kesinti saati, geri yükleme kararı. |

## Kurallar (hiçbir işte çiğnenmez)

1. **Karabasan botuna dokunulmaz**: kapsayıcıları, `/opt/karabasan-bot`, `karabasan-*`
   servisleri, ufw kuralları ve 8080–8092 kapıları olduğu gibi kalır. PlanningExpert
   yalnızca `/opt/planningexpert` ve compose projesi `planningexpert`.
2. **İnternete kapı açılmaz** (sunucunun kuralı). Dışarıya yalnızca Tailscale Funnel,
   yalnızca PlanningExpert'in iki adresi.
3. **Bellek**: her kapsayıcıda sınır (backend 1200 MB, site 384 MB, Tailscale 128 MB).
   Derleme gibi ağır işlerden önce `free -m`; kullanılabilir bellek **1 GB'ın altına
   düşecekse durulur**. Sunucuda test koşulmaz (`SKIP_LOCAL_VERIFY=1`); yalnızca
   CI'da yeşil commit yayınlanır.
4. **Tek veritabanı**: yayın ve yedek betikleri yalnızca kendi Convex sunucumuza
   yazar (`scripts/convex-target.sh`; `CONVEX_DEPLOY_KEY` ya da `CONVEX_DEPLOYMENT`
   tanımlıysa durur).
5. Gizli değerler yalnızca sunucuda, `chmod 600` dosyalarda (`deploy/.env`,
   `/etc/planningexpert/*.env`); sohbette, mesajda, git'te yok.
6. `docker compose down -v`, `docker system prune --volumes` **asla** (veriyi siler).
7. Backend süreçleri `ps` ile listelenmez: komut satırında `--instance-secret` taşır
   (günlüğe düşer). Durum yalnızca `docker compose ps`, healthcheck ve
   `curl …/version` ile. Gizli değerli dosyalar `cat` ile değil, yalnızca
   "dolu mu" (`grep -c`) diye kontrol edilir.

## Güncelleme (yeni sürümü yayına almak)

Önce GitHub'da o commit'in CI'ı (`verify`: tip + test + build) **yeşil** olmalı.

**Otomatik (2026-10-22'den beri):** `planningexpert-autodeploy.timer` 5 dakikada bir
`deploy.sh`'yi çalıştırır; `main`'e giren her commit en geç ~5 dakika + derleme süresi
içinde yayındadır. Yayındaki commit `/var/lib/planningexpert/deployed-commit`'te
tutulur; yayını başarısız olan commit `failed-commit`'e yazılır ve `main`'e yeni bir
commit gelene (ya da `--force`) kadar yeniden denenmez. Elle çalıştırmayla çakışmaz
(`flock`). `deploy.sh` `deploy/systemd/` birimlerini kendisi kurar / günceller, yani
zamanlayıcı ilk elle yayında kendiliğinden açılır.

```bash
systemctl list-timers planningexpert-autodeploy.timer   # sonraki kontrol
journalctl -u planningexpert-autodeploy -n 50            # son yayınların çıktısı
systemctl disable --now planningexpert-autodeploy.timer  # otomatiği kapat
```

Tek komut (2026-10-20'den beri; sunucudaki Claude oturumunda bu betiğe kalıcı izin
verilir, her adım için onay istenmez):

```bash
/opt/planningexpert/scripts/deploy.sh          # main'de yeni commit yoksa bir şey yapmaz
/opt/planningexpert/scripts/deploy.sh --force  # yine de yeniden yayınla
```

Betik sırayla: bellek ≥ 1 GB değilse durur → `main`'i ileri sarar (ff-only) →
`portal.env` → `SKIP_LOCAL_VERIFY=1 ./scripts/release.sh` (aşağıda) → yedekleri
`chmod 600` → `restart web` → yerel / Funnel 200, kapsayıcılar, backend restart / OOM,
bellek, Karabasan kapsayıcı sayısı. Gizli değerler çıktıda maskelenir. Elle aynısı:

```bash
cd /opt/planningexpert
free -m                                    # kullanılabilir ≥ 1 GB + derleme payı
git pull
set -a; . /etc/planningexpert/portal.env; set +a
./scripts/release.sh                       # yedek → Convex işlevleri + şema → site derlemesi
docker compose -f deploy/compose.yml restart web
```

`release.sh` sırası bozulmaz: (1) `npm ci` (+ `SKIP_LOCAL_VERIFY=1` değilse
`npm run verify`), (2) yayın öncesi tam yedek `backups/before-release-*.zip` —
alınamazsa durur, (3) `npx convex deploy` — Convex mevcut veriye uymayan şemayı
reddeder, (4) site derlemesi (`VITE_CONVEX_URL` = `CONVEX_PUBLIC_URL`).

Kontrol: sitede giriş; System → Connection diagnostics yeşil; değişen sayfa açılıyor.
Aynı sayfada **Version on this site**: yayındaki commit, mesajı ve yayın zamanı (UTC ve
Türkiye) — `release.sh` derlemeden önce `VITE_BUILD_*` olarak gömer; GitHub'daki `main`'in
en üstüyle aynıysa site günceldir.

## Yedek

- Gece yedeği: `planningexpert-backup.timer` → `scripts/backup.sh` → 
  `/opt/planningexpert/backups/daily-*.zip` (veri + dosyalar), son 30 tutulur.
  Sunucu dışı kopya: `portal.env`'de `BACKUP_REMOTE` (ör. Hetzner Storage Box).
  Durum: `systemctl list-timers planningexpert-backup.timer`,
  `journalctl -u planningexpert-backup`.
- Her yayından önce `release.sh` ayrıca yedek alır (`before-release-*.zip`).
- Şirket bazında dışa aktarım: Company settings → Organization → şirket →
  *Export data (JSON)*.

## Geri yükleme provası (ayda bir)

Son gece yedeği **ayrı, geçici** bir Convex'e yüklenir; canlı backend'e ve
volume'una dokunulmaz.

```bash
cd /opt/planningexpert
free -m                                    # ≥ 1 GB boş değilse dur
set -a; . deploy/.env; set +a
docker run -d --name pe-restore-test -p 127.0.0.1:3310:3210 --memory 800m \
  -e INSTANCE_NAME=restoretest -e INSTANCE_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/get-convex/convex-backend:"$CONVEX_BACKEND_TAG"
docker exec pe-restore-test ./generate_admin_key.sh      # anahtarı yalnızca aşağıda kullan
LAST=$(ls -1t backups/daily-*.zip | head -1)
( export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3310 CONVEX_SELF_HOSTED_ADMIN_KEY='…'
  npx convex import --replace-all -y "$LAST"
  npx convex export --include-file-storage --path backups/restore-test.zip )
node scripts/compare-exports.mjs "$LAST" backups/restore-test.zip   # → OK
docker rm -f -v pe-restore-test                         # yalnızca geçici kapsayıcı ve kendi isimsiz volume'u
rm backups/restore-test.zip
```

Kontrol: `compare-exports` **OK — every document of the source is in the target**;
süre ve bellek tepe değeri rapora yazılır.

## Geri dönüş (gerçek bir kayıpta, 🔑 Ahmet'in kararıyla)

```bash
set -a; . /etc/planningexpert/portal.env; set +a
npx convex export --include-file-storage --path backups/before-restore-$(date -u +%Y%m%d-%H%M%S).zip
npx convex import --replace-all -y backups/<seçilen yedek>.zip
```

Önce aynı yedek geri yükleme provasındaki gibi geçici Convex'te denenir. Yedekten
sonra girilen veri kaybolur; bu yüzden kesinti saati 🔑 Ahmet'le seçilir.

## Ortam değişkenleri (e-posta vb.)

Convex sunucumuzun ortam değişkenleri `npx convex env set <AD> <değer>` ile
(`portal.env` yüklüyken) ya da Convex panelinden (`docker compose -f deploy/compose.yml
--profile tools up -d dashboard`, yalnızca tailnet / SSH tüneliyle). Liste:
docs/deployment.md → Günlük özet e-postası. Paneli iş bitince kapat:
`docker compose -f deploy/compose.yml stop dashboard`.

## Parola sıfırlama (site sahibi parolasını unutursa)

```bash
set -a; . /etc/planningexpert/portal.env; set +a
npx convex run auth:resetPassword '{"name":"admin","newPassword":"<geçici parola>"}'
```

Kullanıcı ilk girişte parolasını değiştirmek zorundadır.

## Sıfırdan kurulum (yeni sunucu ya da yeniden kurulum)

```bash
apt-get install -y unzip
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
git clone -b main https://github.com/hmtstc-creator/PlanningExpert /opt/planningexpert
install -d -m 700 /etc/planningexpert

cd /opt/planningexpert/deploy
cp .env.example .env && chmod 600 .env     # INSTANCE_SECRET=$(openssl rand -hex 32), sürüm etiketleri
# Tailscale girişi (🔑 Ahmet onaylar). containerboot, TS_AUTHKEY yokken 60 sn sonra yeniden
# başlayıp her seferinde YENİ bağlantı üretir; bu yüzden ya .env'e tek kullanımlık
# TS_AUTHKEY, ya da aynı volume'la geçici kapsayıcıda bir kez:
#   tailscaled --tun=userspace-networking --statedir=/var/lib/tailscale &
#   tailscale up --accept-dns=false --timeout=40m     # yalnız bu bayrak (--hostname verme)
docker compose up -d ts
docker compose exec ts tailscale status --json | grep DNSName   # → planningexpert.<tailnet>.ts.net
# .env: CONVEX_PUBLIC_URL=https://planningexpert.<tailnet>.ts.net:8443
docker compose up -d backend
docker compose exec backend ./generate_admin_key.sh   # → /etc/planningexpert/portal.env (chmod 600)
docker compose exec ts tailscale funnel status        # 🔑 tailnet'te HTTPS + Funnel kapalıysa
# bağlantı çıkar → Ahmet açar; sonra `docker compose restart ts` (serve.json yeniden yüklenir)

cd /opt/planningexpert
set -a; . /etc/planningexpert/portal.env; set +a
./scripts/release.sh
docker compose -f deploy/compose.yml up -d web
# Veri: son yedekten → npx convex import --replace-all -y backups/<yedek>.zip

cp deploy/systemd/planningexpert-backup.* /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now planningexpert-backup.timer
```

- `CONVEX_BACKEND_TAG`: o günkü son kararlı sürüm, `.env`'e yazılır (latest değil).
- `/etc/planningexpert/portal.env`: `deploy/portal.env.example`'dan.
- Kontrol: `curl -fsS https://planningexpert.<tailnet>.ts.net:8443/version` (dışarıdan,
  Funnel) cevap veriyor; `docker stats --no-stream` bellek sınırları; botlar etkilenmedi.

## Geçmiş

- 2026-10-14: seçenek B kararı (site ve Convex VPS'te); sunucu hazırlığı, Tailscale
  Funnel ve boş Convex kuruldu.
- 2026-10-16: taşıma tamamlandı — her şey VPS'te. Vercel ve Convex Cloud artık
  kullanılmıyor; depodan onlara ait ayar, betik ve talimatlar kaldırıldı.
- 2026-10-16: sunucu `claude/vps-tasima` dalından `main`'e geçti (bir kez:
  `git fetch origin && git checkout main && git pull`).
- 2026-10-19: gece yedeği timer'ı kuruldu (o güne dek kurulmamıştı), ilk `daily-*.zip`
  denendi. Vercel GitHub uygulaması, Vercel projesi ve Convex Cloud deployment'ı
  silindi; sunucudan `/etc/planningexpert/cloud.env` silindi.
