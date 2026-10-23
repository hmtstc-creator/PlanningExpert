# 08 · Sürüm günlüğü

> Son güncelleme: 2026-10-23 · Kaynak: `git log` (her satır bir birleştirilmiş PR). **Yeni iş bitince en üste bir satır eklenir.**

| PR | Tarih | Ne | Neden / not |
|---|---|---|---|
| #40 | 2026-10-23 | **OEE açık konular: yalnız kapanmış gün** — bugünkü yarım yükleme incelenmez; gün kapanmadan başlamış çalışma (23.10) tam veriyle yeniden yapılır (`shouldRun`) | Karabasan oturumu bildirdi: yarım gün "done" sayılıp tam veri atlanıyordu → `docs/oee-agent-report.md` |
| #37 | 2026-10-23 | **OEE açık konular ajanı** (`/oee/topics`): OEE yüklemesi bitince son gün bir kez incelenir; masraf yeri × iş yeri × kayıp grubu adayları 6 haftalık geçmişle tartılır, kronik ve kritik olanlar kalıcı listeye eklenir. Karar ücretsiz yapay zekâ (OpenAI uyumlu, `AI_API_KEY`) ya da kurallar; açık konu yeniden yazılmaz, işlenen gün tekrar yapılmaz. Yeni tablolar `oeeTopics`, `oeeTopicRuns` | Kullanıcı isteği; plan mantığı değişmedi → `docs/oee-agent-report.md` |
| #36 | 2026-10-23 | **Gantt'ta silme:** elle eklenen iş → *Delete job* (kilit kalkar); onaylı / taşınmış iş → *Remove approval* (motora döner); motor işi → *Delete this lot* (lot 0 adet, talep sonraki lotlara). Onay sorulur; Platform history "Job deleted" | Kullanıcı kararı 4 (2026-10-23): yalnız o iş çıkar, talep varsa motor başka yere planlar |
| #35 | 2026-10-23 | **Gantt'ta elle iş ekleme** (Plan → *+ Add job*): parça, adet, pres, gün, saat, "kalıp takılı"; süre motorun hesabıyla. O saatte kilitlenir, adedi talepten düşer, presin diğer işleri arkasına kayar | Kullanıcı örneği: PRS104'ün önüne stok amaçlı iş → [02](02-planlama-motoru.md) |
| #34 | 2026-10-23 | **Gantt'ta sürükle-bırak:** iş başka pres / gün / saate sürüklenir (telefonda basılı tut + sürükle) ya da iş penceresi → *Move…*; bırakılan yerde kilitlenir, motor adedini talepten düşer ve diğer işleri etrafına dizer. Geçmişe, ufuk dışına ve kilitli / dondurulmuş işe ya da bakıma bindirilemez | Kullanıcı kararı 2026-10-23 (todolist §1 *Gantt: elle iş*, sıralama: önce sürükle-bırak) → [02](02-planlama-motoru.md) |
| #32 | 2026-10-23 | **Demand** sayfasına malzeme filtresi (kod içinde arama, büyük/küçük harf fark etmez; filtre yazılınca 200'ün ötesindeki satırlar da yüklenir) | Kullanıcı isteği; yalnız arayüz, plan mantığı değişmedi |
| #30 | 2026-10-22 | Organization map → Users & groups: çizgiler soldan sağa **Plant → Group → User** (kullanıcı grubun altında); bütün plant'leri gören grup doğrudan şirkete bağlı | Kenarlar ters yönde (kullanıcı → grup → plant) çizildiği için geri kıvrılıyor, yapı yanlış görünüyordu. Veri / yetki değişmedi → `docs/board.md` |
| #29 | 2026-10-22 | Organization map açılınca "Something went wrong" (React #185) düzeltildi: boş sorgu sonuçları için sabit dizi; `OrgMap.test.tsx` | `useQuery(...) ?? []` her çizimde yeni dizi üretiyordu → graph → `setNodes` → sonsuz döngü (Structure görünümünde users/groups hep `skip`) |
| #27 | 2026-10-22 | **Organization map** (`/admin/map`, yalnız General): yapı (holding → … → work center) ve bir şirketin kullanıcı / grupları sonsuz tuvalde; sürükle-bırakla şirket → holding, masraf yeri → bölüm, kullanıcı → grup, grup → plant; kırmızı çerçeve + "To fix" listesi. Yeni bağımlılık `@xyflow/react` 12.10.0 | Eski ağaç sayfasında aynı adlı plant'ler ve bağsız kayıtlar gözden kaçıyordu. Şema değişmedi, eski mutation'lar kullanılır; eski sayfalar harita netleşince silinecek → `docs/board.md` |
| #26 | 2026-10-22 | `main` ruleset ile korundu (PR + `verify` zorunlu, squash, force push / silme yasak); açık konudan çıktı | Yayın otomatik; main'e giren her şey ~5 dk sonra canlı → [05](05-yayin-ve-isletim.md) |
| #24 | 2026-10-22 | Wiki: #22 sürüm günlüğüne işlendi; otomatik dal silme açık konulardan çıktı | Devir adımı (docs PR) → [09](09-acik-konular.md) |
| #23 | 2026-10-22 | **Token tasarrufu:** bir iş = bir oturum, `/yeni-is` ve `/devir` skill'leri, büyük dosya listesi, `.claude/settings.json` ile üretilmiş / ağır dosyaları okuma yasağı | Tek sohbet 563k / 1M token'a çıkmıştı → [07](07-calisma-sozlesmesi.md) |
| #22 | 2026-10-22 | **Wiki** (`docs/wiki`), mimari etki kontrolü, `architecture.test.ts` ve `wiki.test.ts` | Yeni sohbet açılmayacağı için kalıcı hafıza; **birleşen PR dalının otomatik silinmesi ilk kez gerçek PR'da doğrulandı** (`claude/wiki` birleşmeden hemen sonra silindi) → [07](07-calisma-sozlesmesi.md) |
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
- **Bildirim olayları kısa karşılanır:** PR izleme bildirimleri (abonelik, CI, birleşme) yalnızca durum kontrolü ve tek satır yanıttır; her biri için ayrıntılı özet yazmak token harcar.
- **Dal silme GitHub'a bırakıldı:** bulut oturumunun izin sistemi dal silmeyi engelliyor; birleşme olayında çalışan iş akışı bunu kendisi yapıyor (ilk gerçek PR'da doğrulandı).
- **Sunucuya erişim yok:** nedeni sunucu tarafında doğrulanamayan sorunlarda kod düzeyinde kök neden + ölçüm satırı eklenir (ör. *Live data check*).
