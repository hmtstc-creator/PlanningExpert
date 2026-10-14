# VPS'e taşıma — site ve Convex (seçenek B, 2026-10-14)

Hedef: site ve veritabanı (Convex) kendi sunucumuzda — Hetzner CX33 (Ubuntu 24.04),
Karabasan botuyla **aynı makine**. Adres (ücretsiz, Tailscale Funnel):

- Site: `https://planningexpert.<tailnet>.ts.net`
- Convex API: `https://planningexpert.<tailnet>.ts.net:8443`

**Veri kaybı olmaz**: Convex Cloud'daki veri taşıma bitip 30 gün geçene kadar
silinmez; her aşamanın kontrolü geçmeden sonrakine geçilmez.

## Mantık: kim ne yapar

| Kim | Ne yapar |
|---|---|
| **Bulut oturumu** (Claude, bu depo) | Kodu, betikleri ve bu kitabı hazırlar; sunucudaki oturuma aşama aşama görev yollar, raporunu okur, sonrakini açar. |
| **Sunucu oturumu** (sunucudaki Claude Code, Remote Control) | Komutları çalıştırır, her aşamanın sonunda **rapor** verir. Kontrol kırmızıysa durur. |
| **Ahmet** | Yalnızca 🔑 kapılarda: Tailscale onay bağlantıları, Convex Cloud anahtarı, kesinti saati, eski sistemleri kapatma. |

## Kurallar (hiçbir aşamada çiğnenmez)

1. **Karabasan botuna dokunulmaz**: kapsayıcıları, `/opt/karabasan-bot`, `karabasan-*`
   servisleri, ufw kuralları ve 8080–8092 kapıları olduğu gibi kalır. PlanningExpert
   yalnızca `/opt/planningexpert` ve compose projesi `planningexpert`.
2. **İnternete kapı açılmaz** (sunucunun kuralı). Dışarıya yalnızca Tailscale Funnel,
   yalnızca PlanningExpert'in iki adresi.
3. **Bellek**: her kapsayıcıda sınır (backend 1200 MB, site 384 MB, Tailscale 128 MB).
   Derleme gibi ağır işlerden önce `free -m`; kullanılabilir bellek **1 GB'ın altına
   düşecekse durulur**. Sunucuda test koşulmaz (`SKIP_LOCAL_VERIFY=1`); yalnızca
   CI'da yeşil commit yayınlanır.
4. **Convex Cloud'a yazan tek işlem** taşıma gecesi `pause`. Cloud'a `import`,
   `deploy`, silme **yok**. Her `convex import` yalnızca kendi sunucumuza;
   hedef `scripts/convex-target.sh` ile denetlenir (iki hedef birden = dur).
5. Veri kontrolü: `scripts/compare-exports.mjs` — Cloud yedeği ile sunucudan geri
   alınan yedek tablo tablo, kimlik kimlik aynı olmalı (fotoğraflar dahil). Fark = dur.
6. Gizli değerler yalnızca sunucuda, `chmod 600` dosyalarda (`deploy/.env`,
   `/etc/planningexpert/*.env`); sohbette, mesajda, git'te yok.
7. `docker compose down -v`, `docker system prune --volumes` **asla** (veriyi siler).
8. Backend süreçleri `ps` ile listelenmez: komut satırında `--instance-secret` taşır
   (günlüğe düşer). Durum yalnızca `docker compose ps`, healthcheck ve
   `curl …/version` ile. Gizli değerli dosyalar `cat` ile değil, yalnızca
   "dolu mu" (`grep -c`) diye kontrol edilir.

## Aşamalar

Her aşamanın sonunda sunucu oturumu "**Aşama N raporu**" yollar.

### Aşama 0 — Envanter ✅ (2026-10-14)

Ubuntu 24.04, 4 çekirdek, 7,6 GiB RAM (botlar ~5 GB; kullanılabilir ~2,6 GB), disk
66 GB boş. Docker 29 + compose var; node, caddy, unzip yok. ufw: yalnızca
`tailscale0`. 80, 443, 3000, 3210, 6791 boş. GitHub erişimi var.

### Aşama 1 — Hazırlık ✅ (2026-10-14)

```bash
apt-get install -y unzip                                   # yedek kontrolü için
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs   # Convex CLI ve derleme
git clone -b claude/vps-tasima https://github.com/hmtstc-creator/PlanningExpert /opt/planningexpert
install -d -m 700 /etc/planningexpert
```

Kontrol: `node -v` (v22), botlar çalışıyor (`docker ps` sayısı aynı), `free -m`.

### Aşama 2 — Tailscale cihazı + boş Convex (2026-10-14: backend ✅, Funnel ✅)

> Not (2026-10-14): ilk kurulumda iki gizli değer oturum günlüğüne kısmen düştü
> (tırnaksız anahtar, `ps`); veri gelmeden önce boş volume silinip yeni
> INSTANCE_SECRET ve admin anahtarıyla yeniden kuruldu. **Aşama 3'ten sonra
> volume silmek yok.**

```bash
cd /opt/planningexpert/deploy
cp .env.example .env && chmod 600 .env     # INSTANCE_SECRET=$(openssl rand -hex 32), sürüm etiketleri
# Giriş (🔑 Ahmet onaylar). containerboot, TS_AUTHKEY yokken 60 sn sonra yeniden
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
```

- `CONVEX_BACKEND_TAG`: o günkü son kararlı sürüm, `.env`'e yazılır (latest değil).
- `/etc/planningexpert/portal.env`: `deploy/portal.env.example`'dan.

Kontrol: `curl -fsS https://planningexpert.<tailnet>.ts.net:8443/version` (dışarıdan,
Funnel) cevap veriyor; `docker stats --no-stream` bellek sınırları; botlar etkilenmedi.

### 🔑 Kapı 2 — Convex Cloud anahtarı

Convex panel → `perceptive-frog-787` (production) → Settings → Deploy keys → **prod:**
anahtarı. Sunucuda `/etc/planningexpert/cloud.env`'e (chmod 600) Ahmet yazar ya da
sunucu oturumuna kendisi verir. Taşımadan sonra silinir.

### Aşama 3 — Prova (canlı site çalışmaya devam eder)

Cloud'a yalnızca **okuma** (export).

```bash
cd /opt/planningexpert
# a) Cloud'dan yedek (fotoğraflar dahil) ve ortam değişkenleri
( set -a; . /etc/planningexpert/cloud.env; set +a
  npx convex export --include-file-storage --path backups/rehearsal-cloud.zip
  npx convex env list > /etc/planningexpert/cloud-env-vars.txt; chmod 600 /etc/planningexpert/cloud-env-vars.txt )

# b) Kendi sunucumuz: işlevler + şema + site, sonra veri
set -a; . /etc/planningexpert/portal.env; set +a
./scripts/release.sh                       # boş veritabanının yedeği, deploy, derleme
docker compose -f deploy/compose.yml up -d web
npx convex import --replace-all -y backups/rehearsal-cloud.zip
npx convex export --include-file-storage --path backups/rehearsal-vps.zip

# c) Veri aynı mı?
node scripts/compare-exports.mjs backups/rehearsal-cloud.zip backups/rehearsal-vps.zip
```

- Provada `RESEND_API_KEY` **girilmez** (kopya sistem e-posta göndermesin); diğer
  ortam değişkenleri `npx convex env set` ile.

Kontrol (hepsi ✅):
- `compare-exports`: **OK — every document of the source is in the target**.
- Sitede giriş; System → Connection diagnostics'te kayıt sayıları eski siteyle aynı.
- OEE sayfaları, plan hesabı (Plan → Calculate), bir fotoğraf açılıyor.
- Süreler (export, import, kontrol) → kesinti süresi tahmini; bellek tepe değeri.

### 🔑 Kapı 3 — kesinti saati

Ahmet seçer (vardiya dışı). Provanın süresi + 30 dk. Kullanıcılara duyuru: yeni adres.

### Aşama 4 — Taşıma gecesi

1. **Cloud'u dondur**: Convex panel → production → Settings → **Pause deployment**.
   Eski site (planningexpert.vercel.app) artık yazamaz; veri yerinde, silinmez.
2. Son yedek: `npx convex export --include-file-storage --path backups/cutover-cloud.zip`
   (cloud.env ile) → bir kopya Ahmet'in bilgisayarına.
3. Kendi sunucumuza: `npx convex import --replace-all -y backups/cutover-cloud.zip`
   (portal.env ile); ortam değişkenleri (bu kez `RESEND_API_KEY` dahil; `APP_URL` =
   yeni adres).
4. Kontrol: `npx convex export … cutover-vps.zip` →
   `compare-exports cutover-cloud.zip cutover-vps.zip` **OK**. Değilse → Geri dönüş.
5. Duman testi: giriş, OEE, plan hesabı, fotoğraf, Connection diagnostics.
6. Kullanıcılara yeni adres. Vercel'deki site kapatılmaz, yalnızca kullanılmaz
   (Cloud dondurulduğu için yazamaz).

### Geri dönüş

- **Açılıştan önce**: Cloud'u **Resume** — eski site olduğu gibi çalışır. Cloud'a
  hiç yazılmadığı için kayıp yok.
- **Açılıştan sonra**: sunucuya yeni veri girdiği için geri dönüş ters taşımadır
  (sunucudan export → Cloud'a import); yalnızca Ahmet'in kararıyla.

### Aşama 5 — Sonrası

- `deploy/systemd/planningexpert-backup.*` → `/etc/systemd/system/`,
  `systemctl enable --now planningexpert-backup.timer` → her gece 02:15 yedek
  (`/opt/planningexpert/backups`, son 30). İsteğe bağlı sunucu dışı kopya:
  `BACKUP_REMOTE` (Storage Box).
- Ayda bir geri yükleme provası: son yedek ayrı, geçici bir Convex'e
  (`docker run … convex-backend`, ayrı volume) yüklenir, `compare-exports` OK.
- Güncelleme: `git pull && ./scripts/release.sh && docker compose -f deploy/compose.yml restart web`
  (yayın betiği önce yedek alır).
- 🔑 2 hafta sorunsuz → Vercel projesi silinir. 🔑 30 gün → Convex Cloud deployment'ı
  silinir (son yedeği saklı), `/etc/planningexpert/cloud.env` silinir.
