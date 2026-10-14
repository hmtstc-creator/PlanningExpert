# VPS'e taşıma — arayüz ve Convex (seçenek B, 2026-10-14)

Hedef: site ve veritabanı tamamen kendi sunucumuzda (Hetzner CX33 "Karabasan",
2.28.102.179, eu-central). **Veri kaybı olmaz**: Convex Cloud'daki veri taşıma
bitip 30 gün geçene kadar silinmez; her aşamanın kontrolü geçmeden sonrakine
geçilmez.

## Mantık: kim ne yapar

| Kim | Ne yapar |
|---|---|
| **Bulut oturumu** (Claude, bu depo) | Kodu, betikleri ve bu kitabı hazırlar, PR açar; VPS oturumuna aşama aşama görev yollar, raporunu okur, bir sonraki aşamayı açar. |
| **VPS oturumu** (sunucudaki Claude Code, Remote Control) | Komutları sunucuda çalıştırır. Her aşamanın sonunda **rapor** verir: ne yapıldı, kontrol çıktıları, sorun. Kontrol kırmızıysa durur, düzeltmeye girişmeden önce rapor eder. |
| **Sen** | Yalnızca **kapılarda (🔑)** devreye girersin: alan adı / DNS, gizli anahtarlar, kesinti saati, eski sistemleri kapatma. |

Kurallar (hiçbir aşamada çiğnenmez):

1. **Convex Cloud'a yazan tek komut** taşıma gecesi `pause` (Aşama 4). Cloud'a
   `import`, `deploy`, silme **yok**.
2. Her `convex import` yalnızca **kendi sunucumuzdaki** Convex'e; hedef
   `scripts/convex-target.sh` ile denetlenir (iki hedef birden tanımlıysa durur).
3. Veri kontrolü: `scripts/compare-exports.mjs` — Cloud yedeği ile VPS'ten geri
   alınan yedek **tablo tablo, kimlik kimlik** aynı olmalı (fotoğraflar dahil).
   Fark = dur.
4. Yedek üç yerde: sunucu (`/opt/portal/backups`), Hetzner Storage Box, senin
   bilgisayarın (taşıma gecesinin yedeği).
5. Sunucudaki **Karabasan botu** ve dosyalarına dokunulmaz; portal ayrı
   kullanıcı (`portal`), ayrı klasör (`/opt/portal`), ayrı Docker projesi
   (`portal-convex`). `docker compose down -v`, `docker system prune --volumes`
   **asla**.
6. Gizli anahtarlar yalnızca sunucuda, `chmod 600` dosyalarda
   (`/etc/portal/*.env`, `deploy/convex/.env`); sohbette, git'te, PR'da yok.

## Aşamalar

Her aşamanın sonunda VPS oturumu "**Aşama N raporu**" yazar; kontrol satırları
✅ değilse sonraki aşama başlamaz.

### Aşama 0 — Envanter (salt okunur, hiçbir şey değişmez)

- İşletim sistemi, çekirdek; RAM / disk / CPU kullanımı (`free -h`, `df -h`, `nproc`).
- Çalışan servisler ve **Karabasan botunun** nasıl çalıştığı (systemd / docker /
  pm2 / screen), ne kadar RAM / CPU kullandığı.
- Dinlenen portlar (`ss -tlnp`): 80, 443, 3000, 3210, 3211, 6791, 5432 boş mu?
- Kurulu: docker + compose, node (sürüm), caddy / nginx, git, rsync, unzip.
- Hetzner Cloud Firewall var mı (sunucudan görünmez → kapı 🔑).
- Sitenin bugünkü adresi (Vercel alan adı) ve DNS'in nerede yönetildiği → 🔑.

Kontrol: bot etkilenmeden kurulum için yer var mı (en az 3 GB boş RAM, 20 GB disk).

### 🔑 Kapı 1 — senden

- Alan adları: **PORTAL_HOST** (site, ör. `portal.firma.com`) ve **API_HOST**
  (Convex, ör. `api.portal.firma.com`). Prova için ayrıca `portal-test…` olabilir.
- DNS: iki **A kaydı → 2.28.102.179** (PORTAL_HOST'u taşıma gecesine kadar
  Vercel'de bırakmak istersen önce yalnızca API_HOST ve test adı).
- Hetzner: Firewall (22 yalnızca senin IP'n / Hetzner konsolu, 80, 443),
  sunucu Backups açık, **Storage Box** (sunucu dışı yedek) ve VPS'in SSH
  anahtarının Storage Box'a eklenmesi.

### Aşama 1 — Sunucu hazırlığı

- Paketler: `docker` + compose eklentisi, Node 22 (CI ile aynı), `caddy`, `git`,
  `rsync`, `unzip`.
- Kullanıcı `portal` (docker grubunda), `/opt/portal` (git clone, `main`),
  `/etc/portal/` (700).
- `deploy/caddy/Caddyfile` → `/etc/caddy/Caddyfile`'a **eklenir** (PORTAL_HOST ve
  API_HOST yazılarak); başka site varsa onun bloğu korunur.
- `deploy/systemd/*` → `/etc/systemd/system/` (henüz başlatılmaz).

Kontrol: `docker run --rm hello-world`, `node -v` (v22), `caddy validate`, bot
servisi hâlâ çalışıyor.

### Aşama 2 — Convex'i kendi sunucumuzda kur (boş)

```bash
cd /opt/portal/deploy/convex
cp .env.example .env && chmod 600 .env          # sürümler sabitlenir, sırlar üretilir
docker compose up -d
docker compose exec backend ./generate_admin_key.sh   # → /etc/portal/portal.env
curl -fsS https://API_HOST/version                     # Caddy üzerinden
```

- `CONVEX_BACKEND_TAG` / `CONVEX_DASHBOARD_TAG`: o günkü son kararlı sürüm,
  `.env`'e yazılır (latest kullanılmaz). Compose dosyası resmi self-hosted
  dosyasıyla karşılaştırılır; fark varsa rapor edilir.
- Dashboard yalnızca SSH tüneliyle: `ssh -L 6791:127.0.0.1:6791 portal@…`.

Kontrol: `/version` HTTPS'te cevap veriyor; `docker compose ps` üç servis healthy;
volume'lar (`portal-convex_pgdata`, `portal-convex_convex-data`) var.

### 🔑 Kapı 2 — Convex Cloud anahtarı

Convex panel → production → Settings → Deploy keys: **prod:** anahtarını
sunucuda `/etc/portal/cloud.env`'e sen yazarsın (`chmod 600`). Taşımadan sonra silinir.

### Aşama 3 — Prova (canlı site çalışmaya devam eder)

Cloud'a yalnızca **okuma** (export). Kullanıcılar eski sitede çalışmaya devam eder.

```bash
# a) Cloud'dan yedek (fotoğraflar dahil) — sunucuda ve Storage Box'ta saklanır
set -a; . /etc/portal/cloud.env; set +a
npx convex export --include-file-storage --path backups/rehearsal-cloud.zip
npx convex env list > /etc/portal/cloud-env-vars.txt     # Convex ortam değişkenleri (chmod 600)
unset CONVEX_DEPLOY_KEY

# b) Kendi sunucumuz: işlevler + şema, sonra veri
set -a; . /etc/portal/portal.env; set +a
npx convex deploy                     # şema ve indeksler
npx convex import --replace-all -y backups/rehearsal-cloud.zip
npx convex export --include-file-storage --path backups/rehearsal-vps.zip

# c) Veri aynı mı?
node scripts/compare-exports.mjs backups/rehearsal-cloud.zip backups/rehearsal-vps.zip
```

- Provada `RESEND_API_KEY` **girilmez** (kopya sistem e-posta göndermesin);
  diğer ortam değişkenleri `npx convex env set` ile.
- Arayüz: `./scripts/release.sh` (portal.env ile) → `systemctl start portal`;
  test adresinde (ya da `ssh -L 3000:…` ile) açılır.

Kontrol (hepsi ✅ olmalı):
- `compare-exports`: **OK — every document of the source is in the target**.
- Giriş yapılıyor; System → Connection diagnostics'te kayıt sayıları eski siteyle aynı.
- OEE sayfaları, plan hesabı (Plan → Calculate), bir fotoğraf açılıyor.
- Süreler: export, import ve kontrolün kaç dakika sürdüğü → kesinti süresi tahmini.

Prova verisi taşıma gecesi baştan yazılır (`--replace-all`); provada yapılan
değişiklikler kalıcı değildir.

### 🔑 Kapı 3 — kesinti saati

Senin seçtiğin saat (vardiya dışı, ör. Pazar 06:00). Provanın süresi + 30 dk.
Kullanıcılara duyuru.

### Aşama 4 — Taşıma gecesi

1. **Cloud'u dondur**: Convex panel → production → Settings → **Pause
   deployment** (sen ya da cloud.env ile CLI). Artık kimse yazamaz; eski site
   "bakımda" gibi hata verir. Veri yerinde, silinmez.
2. Son yedek: `npx convex export --include-file-storage --path backups/cutover-cloud.zip`
   → Storage Box'a ve senin bilgisayarına kopya.
3. Kendi sunucumuza: `npx convex import --replace-all -y backups/cutover-cloud.zip`,
   ortam değişkenleri (bu kez `RESEND_API_KEY` dahil; `APP_URL` = yeni adres).
4. Kontrol: `npx convex export … cutover-vps.zip` →
   `compare-exports cutover-cloud.zip cutover-vps.zip` **OK** olmalı. Değilse →
   Geri dönüş.
5. `./scripts/release.sh` (portal.env) → `systemctl restart portal`.
6. DNS: PORTAL_HOST → 2.28.102.179 (TTL önceden 300 sn'ye indirilmiş olur).
7. Duman testi: giriş, OEE, plan hesabı, fotoğraf, Connection diagnostics.
8. Açılış duyurusu.

### Geri dönüş

- **Açılıştan önce** (adım 1–7'de sorun): Cloud'u **Resume**, DNS'i Vercel'e
  geri al. Cloud'a hiç yazılmadığı için kayıp yok.
- **Açılıştan sonra**: VPS'e yeni veri girdiği için geri dönüş ters taşımadır
  (VPS export → Cloud'a import); yalnızca senin kararınla.

### Aşama 5 — Sonrası

- `systemctl enable --now portal-backup.timer` → her gece yedek + Storage Box;
  ilk sabah yedeğin geldiği kontrol edilir.
- Ayda bir **geri yükleme provası**: son yedek boş bir test Convex'ine
  (`INSTANCE_NAME=convex-restore-test`, ayrı compose projesi) yüklenir,
  `compare-exports` OK.
- İzleme: UptimeRobot (PORTAL_HOST, API_HOST `/version`); disk %80 alarmı.
- Güncelleme: `git pull && ./scripts/release.sh && systemctl restart portal`
  (yayın betiği önce yedek alır).
- 🔑 2 hafta sorunsuz → Vercel projesi kapatılır. 🔑 30 gün → Convex Cloud
  deployment'ı silinir (son yedeği saklı kalır), `/etc/portal/cloud.env` silinir.
