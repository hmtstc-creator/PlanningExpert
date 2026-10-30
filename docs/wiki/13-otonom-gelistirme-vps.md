# 13 · Otonom geliştirme (VPS) — mimari

> Son güncelleme: 2026-10-30 (kuruldu: `scripts/otonom/*`, `planningexpert-otonom-*` zamanlayıcıları, Administration → *Autonomous development*). **Durum: KURULU, KAPALI** — aşağıdaki *Açma* adımları bitince çalışır.
> Kullanıcı 2026-10-30 "başla" dedi. Kapatmak için tek komut: `touch /etc/otonom/DURDUR`.

## Amaç

7/24, her saat: 5 rollü eleştiri toplantısı (planlama uzmanı, AI uzmanı, mimari uzmanı, vardiya mühendisi,
vardiya amiri) → iyileştirme planı → kodu Gemini yazar → yerelde test → tek PR → CI yeşil → yayın.
Odak: **sayfaların doğru ilişkileri** ve **kullanıcı arayüzü**. Her saatin :50'sinde son değişikliğin yayında
olduğu garanti edilir. Sonuçlar creator'a özel *Otonom Gelişim* sayfasında görünür.

## 1. Taslak mimari (ilk hali)

- VPS'te cron: :00 Claude Code (`claude -p`) toplantı oturumu, bütün wiki + odak sayfa kodu okunur.
- Toplantı çıktısı → görev dosyaları → Gemini API → her görev ayrı worktree'de `npm run verify`.
- Geçenler toplu dala → tam verify → PR → CI → merge → `deploy.sh` → :50 doğrulama.
- CI kırmızı → Claude oturumu hatayı okur, düzeltir.

Tahmini maliyet: Claude 1–3 M token/gün, Actions 20–50 dk/gün.

## 2. Token düşürme aksiyonları (ikinci tur)

| # | Aksiyon | Etki |
|---|---|---|
| T1 | **Durum özeti** `docs/otonom/durum.md` (≤ 60 satır: son 3 karar, sıradaki işler, açık hatalar). Toplantı wiki yerine bunu okur; her tur sonunda script günceller | okuma ~%70 ↓ |
| T2 | **Sayfa ilişki haritası** `docs/otonom/harita.md`: script (`scripts/otonom/harita.mjs`) route'lardan rota → okunan Convex sorguları → bağlantılar → bileşenler çıkarır. Model kod değil haritayı okur | 1300 satır → ~100 satır |
| T3 | **Tek odak sırası**: saat başına tek sayfa / tek ilişki (round-robin listesi). Kod yalnız o sayfa için, `grep` + dar aralık | |
| T4 | **Kısa toplantı çıktısı**: sabit JSON şeması (bulgu, öncelik, dosya, kabul şartı), en fazla 5 görev. Serbest metin yok | çıktı token ↓ |
| T5 | **Deterministik işler script'te**: worktree, Gemini çağrısı, verify, birleştirme, PR, merge, deploy, :50 kontrol — hepsi bash/node. Claude yalnız *karar* verir (toplantı + diff onayı) | Claude oturum sayısı ↓ |
| T6 | **Hata düzeltmesini Gemini yapar**: verify / CI çıktısının son 40 satırı + diff → Gemini düzeltme turu (en fazla 3). Claude sohbeti yeniden okumaz | CI düzeltme Claude maliyeti ≈ 0 |
| T7 | **Diff onayı ucuz modelle**: `--model haiku` ile kural tabanlı onay (korunan dosya, boyut, test). Yalnız şüpheli diff `sonnet`'e | onay ~%80 ↓ |
| T8 | **Her adım yeni, kısa oturum** (`claude -p`, geçmiş yok); uzun sohbet yeniden okunmaz | |
| T9 | **Boş saat kısa devre**: son saatte değişiklik yoksa ve kuyruk doluysa toplantı atlanır, kuyruktan devam | |
| T10 | **Sabit sistem metni** (rol tanımları, kurallar) her çağrıda aynı → prompt önbelleği | giriş maliyeti ↓ |

## 3. Final mimari

```
VPS (ayrı kullanıcı: otonom, canlı veriye yazma yok)
│
├─ :00  toplanti.sh ──► claude -p (sonnet, ~20k giriş)
│         okur: durum.md + harita.md + odak sayfa dar kod
│         yazar: kuyruk/<saat>/*.json (≤5 görev)  ── (T1–T4, T9, T10)
│
├─ :05–:35  uygula.sh (sürekli, nice -n 19)
│         her görev: worktree → Gemini yazar → npm run verify
│         kırmızı → Gemini düzeltir (≤3 tur, son 40 satır)   ── (T5, T6)
│         yeşil → claude -p haiku diff onayı (kural listesi)  ── (T7)
│
├─ :40  yayinla.sh
│         onaylı görevler → toplu dal → tam verify → PR (tek)
│         GitHub CI verify (tek koşu) → kırmızı → Gemini düzeltme → yeşil olana kadar
│         yeşil → squash merge → deploy.sh
│
├─ :50  dogrula.sh
│         /version == origin/main ? değilse deploy.sh tekrar
│         sonuç → Otonom Gelişim kaydı (Convex, creator)
│
└─ her tur sonu: durum.md + harita.md güncellenir (script)
```

### Güvenlik sınırları (Claude kararı, kullanıcı onaylı ilke: "%100 doğruysa izin ver")

- Korunan dosyalar otonom döngüde **değişmez**, yalnız öneri olarak kuyruğa yazılır: `planPipeline`, `scheduler`,
  `planning`, `planValidator`, `oee`, `rawMrp`, `rawLeadTime`, `convex/schema.ts`, yetki dosyaları.
- Her PR: `npm run verify` + `architecture.test.ts` + `check-logic-docs.sh`; biri kırmızıysa merge yok.
- CI kırmızı: yeşile dönene kadar düzeltilir; aynı hata 3 turda geçmezse o görev toplu daldan çıkarılır,
  kalanlar yayınlanır, görev *Otonom Gelişim*'e "başarısız" notuyla düşer. Sistem kırık kalmaz.
- Yayın sonrası :50 doğrulaması başarısızsa `deploy.sh` geri alma yolu (wiki 05).
- Ajan ayrı Linux kullanıcısı, test Convex dev deployment'ında; canlı veritabanına yazma yetkisi yok.
- Durdurma: `/etc/otonom/DURDUR` dosyası varsa bütün script'ler ilk satırda çıkar.

### Otonom Gelişim sayfası (yalnız creator)

Her saat bir kart: saat, odak sayfa, 3–5 cümle ne yapıldı, **öncesi / sonrası** yorumu, PR bağlantısı,
durum (yayında / başarısız / değişiklik yok). Veri Convex'te ayrı tablo (şema değişikliği → snapshot).

### Bellek eklentisi (claude-mem vb.)

Önerilmez: her oturumun başına geçmiş özet **ekler**, giriş token'ını artırır ve wiki ile ikinci bir hafıza
oluşturur (tek kaynak ilkesine aykırı). Aynı işi T1 `durum.md` deterministik ve daha ucuz yapar. Ölçümde
toplantı kalitesi düşerse yeniden değerlendirilir.

### Tahmini günlük maliyet (final)

| Kalem | Taslak | Final |
|---|---|---|
| Claude | 1–3 M token | 0,4–0,8 M token (24 × ~20k toplantı + haiku onaylar) |
| GitHub Actions | 20–50 dk | 20–50 dk (saatte tek CI koşusu) |
| Gemini Flash | $1–5 | $1–5 |

### Kurulum için gerekenler (başla denince)

1. VPS'te `claude` CLI girişi (kullanıcı bir kez) ve `GEMINI_API_KEY` (mevcut anahtar).
2. `/version` uç noktası (yayındaki commit).
3. `scripts/otonom/*` ve systemd timer'ları (`otonom-toplanti`, `otonom-yayinla`, `otonom-dogrula`).
4. Otonom Gelişim sayfası + Convex tablosu.
5. İlk tur elle çalıştırılır, sonuç kullanıcıya gösterilir; sonra timer'lar açılır.

## Kurulum (kodda)

| Parça | Dosya | Saat |
|---|---|---|
| Ortak ayar, açık/kapalı kontrolü, kilit | `scripts/otonom/ortak.sh` | — |
| Kullanıcı `otonom`, `/etc/otonom/env`, klon, `claude` + `gh` CLI (idempotent, root) | `scripts/otonom/kur.sh` | :50 öncesi |
| Toplantı (sonnet, araçsız) → `kuyruk/` | `toplanti.sh` + `toplanti-prompt.md` | :00 |
| Gemini yazar (`qwen-yesil.sh`, aynı sınırlar) → verify → haiku onayı → `hazir/` | `uygula.sh` + `onay-prompt.md` | :05 |
| Toplu dal → verify → tek PR → CI yeşil (Gemini ≤3 düzeltme) → squash merge | `yayinla.sh` | :40 |
| Kayıt kartı + `docs/otonom/durum.md` | `gunluk.mjs` → `src/data/otonom-gunluk.json` | :40 |
| Sayfa ilişki haritası | `harita.mjs` → `docs/otonom/harita.md` | :00, :40 |
| Yayında mı? değilse `planningexpert-autodeploy` hemen | `dogrula.sh` (root) | :50 |

Zamanlayıcıları `deploy.sh` (`install_units`) kendisi kurar; elle iş yok. Betikler `/opt/planningexpert`'ten
çalışır, işi `/home/otonom/PlanningExpert` klonunda yapar (canlı kopyaya dokunmaz). Durum: `/var/lib/otonom/`
(`kuyruk`, `hazir`, `biten`, `toplantilar.jsonl`, `dogrula.log`). Günlük: `journalctl -u planningexpert-otonom-<ad>`.

Sayfa: **Administration → Autonomous development** (yalnız site sahibi): saat, odak sayfa, toplantı özeti,
her iyileştirme için *Before / After*, bekleyen öneriler.

## Açma (kullanıcı, sunucuda bir kez)

1. `sudo -iu otonom claude` → giriş yap (abonelik), çık.
2. `sudo -iu otonom gh auth login` → GitHub (repo + workflow yetkisi).
3. `/etc/otonom/env` içine `GEMINI_API_KEY=...` yaz.
4. `rm /etc/otonom/DURDUR` → bir sonraki :00'da ilk toplantı.

Herhangi biri eksikse betikler `kapalı: <neden>` yazıp çıkar (`journalctl -u planningexpert-otonom-toplanti`).
