# 08 · Sürüm günlüğü

> Son güncelleme: 2026-10-22 · Kaynak: `git log` (her satır bir birleştirilmiş PR). **Yeni iş bitince en üste bir satır eklenir.**

| PR | Tarih | Ne | Neden / not |
|---|---|---|---|
| #21 | 2026-10-22 | Geç iş: gereken adedin teslim anındaki payı (x% zamanında, kalanı gecikmeli; ortalama + son parça); *Why late*: "teslime kadar yeterli üretim süresi yok"; `CLAUDE.md` + CI denetimi: Planning Logic zorunlu güncelleme | Eskiden teslimde yarısı hazır olsa da tamamı "late" yazılıyordu; "Needed qty" birden çok lotun toplamıydı. Bağımsız doğrulayıcıyla aynı sayı → [03](03-gec-is-tanimi.md) |
| #20 | 2026-10-22 | Bağlantı: yavaş WebSocket kalıcı yedek moda düşürmesin; Diagnostics çelişmesin | Deneme sorgusu 8 sn'de cevaplanmayınca oturum sonuna kadar HTTPS'te kalıyordu → [06](06-baglanti-ve-istemci.md) |
| #19 | 2026-10-22 | Senaryo aramasında **lot bölme** (tam rulo; geç lot araya girer) | 100 senaryoda böyle bir deneme yoktu → [02](02-planlama-motoru.md) |
| #18 | 2026-10-22 | Birleşen PR dalları otomatik silinir (iş akışı + tek seferlik temizlik) | Elle dal temizliği kalktı |
| #17 | 2026-10-22 | `deploy.sh` kilidi betiğin içinde | Zamanlayıcı ilk açılışta elle yayınla çakıştı; biri yedek adımında kaldı |
| #16 | 2026-10-22 | Geç malzemeler: öneri yerine **neden geç** + gecikme hesabı; **sunucuda otomatik yayın** (5 dk) | "71 saat nereden geliyor?" sorusu; yayın için onay istenmesin |
| #15 | 2026-10-22 | Hammadde: sac başına **tedarik süresi**, "en geç sipariş günü", Excel *Order by* sayfası | Ahmet / sunucu oturumu isteği → [04](04-hammadde.md) |
| #14 | 2026-10-22 | Connection diagnostics: **yayındaki sürüm** (commit, mesaj, UTC + Türkiye) | Hangi sürüm yayında görülemiyordu |
| #13 | 2026-10-22 | Acil hammadde: sacın gerçekten gerektiği gün; Coverage'da mamul bazında döküm | Acil liste yanlış günü kullanıyordu |
| #12 | 2026-10-20 | Losses Trend: tek grafik — kayıp ve alt kayıp trendi | Sayfa çok kalabalıktı; setup analizi sayfadan çıktı ([09](09-acik-konular.md)) |
| #11 | 2026-10-20 | Sunucuda tek komutla yayın `scripts/deploy.sh` | Her adım için onay istenmesin |
| #10 | 2026-10-19 | **Overview baştan:** planın tam özeti; Production Plan yalnızca Gantt + araçlar; Warnings kaldırıldı | Özet sayfası dağınıktı |
| #9 | 2026-10-19 | Plan grafiği: işi tek başına **onayla (kilit)** ve parçayı **hariç tut** | Eksik malzemeli referans planlanmasın |
| #8 | 2026-10-19 | Plan grafiği: işe tıklayıp **lot adedini değiştir** ve yeniden hesapla | Planlamacı elle ayar |
| #7 | 2026-10-19 | Gece yedeği: `UMask=0077`, kurulum notları | Yedekler veri içerir |
| #6 | 2026-10-19 | Gantt: büyük araç düğmeleri ve **referans arama** (vurgu) | Telefonda kullanılabilirlik |
| #5 | 2026-10-19 | Ana sayfa **Updates**: son gelişmeler ve verinin son yayını | → `docs/updates.md` |
| #4 | 2026-10-16 | OEE Agent Report ve sitedeki bütün çıktılar **Save PDF** | → `docs/pdf.md`, `docs/oee-agent-report.md` |
| #3 | 2026-10-16 | **Her şey VPS'te:** site ve Convex kendi sunucumuzda; Vercel / Convex Cloud kaldırıldı | → [05](05-yayin-ve-isletim.md), `deploy/README.md` |
| #2 | 2026-10-14 | OEE Aksiyonlar sunumu (ortak filtre, A4 çıktı, Daily Report, Loss Bridge, MTTR & MTBF, Dies OEE Trend) | → `docs/oeedashboard.md` |
| #1 | 2026-10 (başı) | Organization tree: holding → company → plant → department → cost center | → `docs/plant-genisletme.md`, `docs/board.md` |

## Öğrenilen dersler (kısa)

- **Yayın aracı = zamanlayıcı:** bulut oturumu sunucu oturumuna mesaj gönderemez; yayını zamanlayıcıya bırakmak onay sorununu kökten çözdü.
- **Kilit betiğin içinde olmalı:** servis sarmalayıcısındaki kilit elle çalıştırmayı korumaz.
- **Faz sırası fazları aşmaz:** lot bölmede ihtiyacı olmayan parça dolguya geçirilmeden araya geç lot giremedi.
- **"healthy" yalnızca soket açık demekti:** sağlık göstergesi gerçek veri akışına bakmalı.
- **Sunucuya erişim yok:** nedeni sunucu tarafında doğrulanamayan sorunlarda kod düzeyinde kök neden + ölçüm satırı eklenir (ör. *Live data check*).
