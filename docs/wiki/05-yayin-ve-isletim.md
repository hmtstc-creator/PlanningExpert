# 05 · Yayın ve işletim

> Son güncelleme: 2026-10-31 (Qwen / Gemini kod yazma kaldırıldı; otonom birimleri) · Kaynak: `deploy/README.md` (**sunucu kitabı**), `docs/deployment.md`, `scripts/*.sh`, `.github/workflows/`

## Çalışma şekli (özet)

```
Claude (bulut oturumu)        GitHub                       VPS (Hetzner)
dal → npm run verify  ─push→  taslak PR → CI verify ─merge→ main
                                                              │  5 dakikada bir (systemd timer)
                                                              ▼
                                            scripts/deploy.sh: ff-only pull → yedek → convex deploy → site derle → web yeniden başlat → sağlık raporu
```

- **`main`'e doğrudan push yok.** Her değişiklik PR'dır; birleştirmeden önce CI `verify` (tip + test + build + `npm audit` kritik) yeşil olmalıdır.
- **Planning Logic denetimi:** PR'da mantık dosyası değişip `src/routes/planlogic.tsx` değişmediyse CI kırmızı olur (`scripts/check-logic-docs.sh`;
  gerçekten mantık değişmediyse `[logic-docs: n/a] <neden>`).
- **CI başlamadıysa çakışmaya bak** (2026-10-23, #46): main'le çakışan PR'da (`mergeable_state: dirty`) `verify` hiç çalışmaz; main dala birleştirilir (aynı gün birden çok oturum main'e yazıyor, en sık `08-surum-gunlugu.md` tablosunun ilk satırı çakışır — iki satır da kalır).
- **Birleşen PR'ın dalı otomatik silinir** (`.github/workflows/delete-merged-branches.yml`; `workflow_dispatch` ile eskiler tek seferde temizlenir).
- **Yayın otomatiktir** (2026-10-22): `planningexpert-autodeploy.timer` → `scripts/deploy.sh`. Elle çalıştırmak gerekmez.
- **Qwen / Gemini ile kod yazma kaldırıldı** (2026-10-31, kullanıcı kararı): `qwen-yesil.yml`, `scripts/qwen-yesil.sh`,
  `QWEN.md` silindi; kodu Claude yazar (CLAUDE.md → *Model*). SOP Builder'ın Gemini'si ayrıdır, yerinde.
- **Otonom geliştirme** (wiki 13): `planningexpert-otonom-*` birimleri; aç / kapat sitedeki düğmeyle.

## `scripts/deploy.sh` ne yapar

1. Boş bellek < 1 GB ise durur. 2. **Kilit** (`flock /run/planningexpert-deploy.lock`): ikinci çalıştırma hiçbir şey yapmadan çıkar.
3. `git fetch` + `merge --ff-only origin/main`. 4. Yayındaki commit `/var/lib/planningexpert/deployed-commit`; aynıysa çıkar. Başarısız olan commit `failed-commit`'e yazılır ve
**yeni commit gelene ya da `--force`'a kadar yeniden denenmez** (5 dakikada bir yedek alınmasın).
5. `deploy/systemd/planningexpert-*` birimlerini kurar / günceller (**root**; bu yüzden `main` yazma yetkisi ve CI zorunluluğu kritik).
6. `portal.env` yükler, `SKIP_LOCAL_VERIFY=1 release.sh`: **yedek → Convex işlevleri + şema → site derlemesi** (`VITE_BUILD_*` gömülür: commit, mesaj, zaman).
7. Yedekleri `chmod 600`, `restart web` (kuruluysa `sop-worker` da: `deploy/.env` → `SOP_WORKER_TOKEN`), yerel + Funnel 200 kontrolü, kapsayıcılar, backend restart / OOM, bellek; Karabasan'a **dokunulmaz**. Gizli değerler çıktıda maskelenir.

Yayını doğrulama: **System → Connection diagnostics → Version on this site** (commit, mesaj, yayın zamanı UTC + Türkiye).
Hata ayıklama (sunucuda): `systemctl list-timers planningexpert-autodeploy.timer`, `journalctl -u planningexpert-autodeploy -n 50`.

## Yedek

Gece 02:15 `planningexpert-backup.timer` → `scripts/backup.sh` (son 30 tutulur, `UMask=0077`); her yayından önce ayrıca `before-release-*.zip`.
Geri yükleme provası ayda bir (`deploy/README.md`). Şirket bazında dışa aktarım: Company settings → Organization → *Export data (JSON)*.

## Güvenlik notları

- Yayın otomatik olduğu için `main` **ruleset ile korunur** (2026-10-22, *Settings → Rules → Rulesets → `main koruması`*, bypass listesi boş): silme ve force push yasak, doğrusal geçmiş, PR zorunlu (0 onay — tek kişi kendi PR'ını onaylayamaz), yalnız **squash**, `verify` yeşil olmalı (*up to date* zorunlu değil). Doğrudan `main`'e push reddedilir; her şey dal → PR → CI yoluyla girer.
- Sunucudaki Claude oturumunun kalıcı izni yalnızca `deploy.sh` ve ilgili mesajlaşma içindir. Bulut oturumu sunucu oturumuna mesaj **gönderemez**
  (güvenilmeyen cihaz kuralı); sunucu bulut oturumuna yazabilir. Bu yüzden yayın zamanlayıcıya bırakıldı.
- Gizli değerler (jeton, anahtar, parola) çıktıya, commit'e, PR'a yazılmaz.
- **Sunucu oturumu gizli değer alamaz** (2026-10-30): `read -s` gibi gizli girişte klavye yok (komut boş döner, "oldu" gibi görünür),
  `.env` okuma / yazma izinle engelli. Gizli değer gereken yeni bir özellikte değeri **sayfadan** girdir (ör. SOP Builder → Setup)
  ya da kendiliğinden üret (worker jetonu); kullanıcıya terminal komutu verme. Çok satırlı komutu tek seferde yapıştırtma.

## Dokunulmaması gerekenler

- `release.sh` sırası (yedek → Convex → derleme); Convex mevcut veriye uymayan şemayı reddeder — şema geri uyumlu kalmalı.
- Yayın öncesi yedek; başarısız yayında site **eski haliyle** çalışmaya devam eder (web yeniden başlatılmaz).
- Karabasan kapsayıcılarına dokunulmaz (aynı sunucu).
