# PlanningExpert Wiki

Programın **kalıcı hafızası**. Her iş yeni bir oturumda başlar (token tasarrufu); bir iş sürerken ya da yeni bir talimat
gelince ilk bakılan yer burasıdır. Burası dağınık belgelerin (`docs/*.md`, `deploy/README.md`,
sitedeki *Planning Logic*) yerine geçmez; hepsine **yön gösterir** ve konuşmalarda alınan
kararları, öğrenilenleri ve sürüm geçmişini tek yerde toplar.

> Son güncelleme: 2026-10-22 · main `f905340` (PR #22)

## Nereden başlamalı

| Sorum | Sayfa |
|---|---|
| Program nasıl kurulu, hangi dosya ne iş yapar? | [01 Sistem haritası](01-sistem-haritasi.md) |
| Plan nasıl hesaplanıyor? (talep → lot → pres → senaryo) | [02 Planlama motoru](02-planlama-motoru.md) |
| "Geç" ne demek, neden geç görünüyor? | [03 Geç iş tanımı](03-gec-is-tanimi.md) |
| Sac siparişi, tedarik süresi, "en geç sipariş günü" | [04 Hammadde](04-hammadde.md) |
| Site nasıl yayınlanıyor, yedek, geri alma, sunucu | [05 Yayın ve işletim](05-yayin-ve-isletim.md) |
| Sarı "Fallback" bandı, WebSocket, istemci taşıması | [06 Bağlantı](06-baglanti-ve-istemci.md) |
| **Yeni talimat gelince ne yapılır?** Mimari etki kontrolü | [07 Çalışma sözleşmesi](07-calisma-sozlesmesi.md) |
| Ne zaman ne yapıldı? | [08 Sürüm günlüğü](08-surum-gunlugu.md) |
| Neler açık, neler riskli? | [09 Açık konular](09-acik-konular.md) |
| Bu kelime ne demek? (lot, kova, kontrol noktası…) | [10 Sözlük](10-sozluk.md) |
| Neden böyle yapıldı? | [11 Karar günlüğü](11-karar-gunlugu.md) |

## Belge haritası (wiki dışındakiler)

| Dosya | İçerik | Ne zaman güncellenir |
|---|---|---|
| `CLAUDE.md` | Depoda çalışan her oturumun uyacağı kurallar | kural değişince |
| `README.md` (kök) | Tanıtım, kurulum, doğrulama | yapı değişince |
| `docs/architecture.md` | Katmanlar, **tek kaynak haritası**, geliştirme kuralları | katman / tek kaynak değişince |
| `docs/decisions.md` | Planlamacıyla alınan iş kararları | her karar |
| `docs/fixeddefinitions.md` | Koddaki sabit sayılar | sabit eklenince |
| `docs/deployment.md`, `deploy/README.md` | Dağıtım, **sunucu kitabı** | yayın / sunucu değişince |
| `docs/security.md` | Giriş, yetki, başlıklar, dosyalar | güvenlik değişince |
| `docs/plant-genisletme.md` | Çok şirket / çok fabrika modeli | model değişince |
| `docs/oeedashboard.md`, `docs/oee-*.md` | OEE kararları, Agent Report, köprü | OEE değişince |
| `docs/kpi.md`, `docs/board.md`, `docs/pdf.md`, `docs/updates.md` | KPI, Board, PDF, Updates | ilgili modül değişince |
| `todolist.md` | **Bütün açık işler** (tek liste) | her iş açılıp kapanınca |
| Sitede **Planning Logic** (`src/routes/planlogic.tsx`) | Planlamacının okuduğu kurallar | **mantık değişen her PR'da (CI denetler)** |

## Wiki nasıl güncel tutulur

1. Bir PR mimariyi, bir akışı, bir kuralı ya da bir kararı değiştiriyorsa **ilgili wiki sayfası aynı PR'da**
   güncellenir; sayfanın başındaki *Son güncelleme* satırı değişir.
2. Yeni bir iş bittiğinde [08 Sürüm günlüğü](08-surum-gunlugu.md)'ne bir satır eklenir.
3. Yeni bir sayfa eklenirse bu dizine (yukarıdaki tablo) eklenir; `src/lib/wiki.test.ts` her sayfanın
   dizinde olduğunu ve bütün bağlantıların çalıştığını denetler.
4. Wiki ile kod çelişirse **kod doğrudur**; çelişki bir hatadır, aynı gün düzeltilir.
