# OEE Agent Report (2026-10-16, planlamacı)

**OEE → Agent Report** (`/oee/agent`): bir günün kısa, sıralı notları — grafik yok.
Amaç: CEO ve yöneticiler sayfayı (ya da PDF'i) açınca o gün nerede ne kaybedildiğini,
neyin tekrar ettiğini ve hangi açık konunun hâlâ kaybettirdiğini bir bakışta görsün.

- Dil İngilizce; yetki diğer OEE sayfalarıyla aynı.
- **Save PDF**: A4 dikey, metin (docs/pdf.md), `GGAAYY AGENT REPORT`.
- Notları **kurallar** yazar (yapay zekâ yok, maliyet yok); her sayı sitenin OEE
  hesabından (süreler toplanır, oran toplamdan — Loss Bridge ile aynı).
- Kod: kurallar `src/lib/oeeAgent.ts` (saf, testli: `oeeAgent.test.ts`), görünüm
  `src/components/AgentReportView.tsx`, PDF `src/lib/agentPdf.ts`, sayfa
  `src/routes/oee/agent.tsx`.

## Gün ve veri

- Gün: ortak filtre çubuğundaki gün; o güne veri yüklenmediyse son yüklü gün (sayfa
  bunu söyler). Alan / masraf yeri ve makine seçimi ortak filtreden; vardiya
  filtresi kullanılmaz (rapor bütün vardiyalar).
- Okunan veri: gün × iş yeri ve kayıp özeti **28 gün** (4 haftalık ortalama), vardiya
  satırları, ham duruşlar ve siparişler **7 gün** (ham duruşlar en çok 8 gün
  okunur). Açık Die Problems ve kalıp ömür alarmları (Die ya da Planning modülü
  izni), açık makine arızaları (Machine ya da Planning izni); izni olmayana bölüm
  "not shown" diye yazılır.
- Hangi kayıp grubu kalıp, hangisi makine kaybı: **OEE Settings → Loss groups →
  Agent role** (Die loss / Machine loss / Neither); seçilmemişse grafik sütunu ya da
  adından tahmin (Die / Mold / Kalıp → kalıp; Machine / Press / Makine → makine).
  Hiçbiri yoksa sayfa uyarır.

## Seviyeler ve sıralama

| Seviye | Anlamı |
|---|---|
| Critical | Bugün karar / müdahale gerekiyor |
| Warning | Takip edilmeli, büyüyor |
| Watch | Küçük ama örüntü var |
| Good news | Belirgin düzelme, çözülmüş olabilecek konu |

- Notlar önce seviyeye, sonra o gün kaybettirilen süreye göre sıralı. Bölüm başına
  en çok 10 not; kalanı "+ N smaller notes" diye sayılır.
- **Summary for management**: kritik ve uyarılardan en çok 5 (ayar), etkiye göre;
  aynı parça / iş yeri / vardiya bir kez.
- Etki: kalıp ve makine notunda kaybın dakikası; OEE düşüşü ve en kötü vardiyada
  **normaline göre fazladan** kayıp (aynı kaybı ikinci kez saymamak için).

## Kurallar

**Dies** (Agent role = die gruplarının duruşları, parça = MATERIAL)
- Parça × iş yeri günde ≥ 30 dk ya da ≥ 3 duruş, **açık Die Problems konusu var** →
  Critical: "konu N gündür açık, kayıp sürüyor", aksiyonuyla.
- Aynısı, konu yok → Warning, 7 günün ≥ 3'ünde tekrar ediyorsa Critical;
  **+ Open follow-up**: Die Follow-up penceresi parça, iş yeri, kayıp, neden ve
  gün gün süreyle dolu açılır (kaydeden kullanıcı; Action zorunlu).
- Ömür limitini aşmış kalıp (açık alarm) o gün çalıştı → Critical.
- Hurda + red oranı son 7 günün ≥ 2 katı (en az 10 adet) → Warning (Quality).

**Presses and machines** (Agent role = machine)
- İş yerinde günde ≥ 30 dk: açık arıza kaydı varsa Critical, yoksa Warning
  ("kayıt yok"); 7 günün ≥ 3'ünde tekrar ediyorsa Critical.
- OEE, iş yerinin 4 haftalık ortalamasından ≥ 10 puan düşük → Warning (en büyük
  kayıp grubuyla); ≥ 10 puan yüksek → Good news. Yüklemesi 120 dk'dan az olan gün
  karşılaştırılmaz.
- Duruş başına süre son 7 günün ≥ 1,5 katı (≥ 3 duruş) → Watch.
- Kısa duruşlar (< eşik, OEE Settings → Short-stop limit, varsayılan 2 dk; hız kaybı) ≥ 10 ve günlük ortalamanın ≥ 2 katı → Watch.
- Kalıp ve makine notları (yeni kayıp, tekrar, MTTR artışı) kullanılabilirlik analizidir: yalnız ≥ eşik duruşlar sayılır (2026-10-23).

**Shifts**
- Günün en kötü vardiyası (iş yeri × vardiya, yükleme ≥ 120 dk): OEE, aynı
  vardiyanın bu haftaki ortalamasına göre fark, ana kayıp ve en çok kaybettiren
  parça; fark ≥ 10 puan ise Warning, değilse Watch.
- Aynı vardiya son 5 günün ≥ 4'ünde tesisin en kötüsü → Warning (örüntü).
- Hız kaybının ≥ %50'si tek vardiyada (≥ 60 dk) → Watch.
- Sebebi girilmemiş ("#") duruş günün duruşlarının ≥ %10'u ve ≥ 30 dk → Watch.

**Repeating stops** (son 7 gün; planlı setup metinleri — OEE Settings → Setups —
sayılmaz; haftalık toplam ≥ 30 dk)
- Aynı iş yeri + aynı neden ≥ 3 günde, bugün de var: kalıp / makine grubuysa
  Warning, değilse Watch. Her gün aynı yarım saatte başlıyorsa "süreç, arıza değil".
- Aynı parça + aynı neden ≥ 2 preste, ≥ 3 günde → Warning: "duruş parçayı izliyor".
- Bu hafta ≥ 3 günde olan, bugün olmayan → Good news.

**Open topics**
- Açık konu bugün kaybettirdi: notu Dies / Presses'te yoksa burada Warning; varsa
  "Cost time on …" satırında, ilgili bölüme yönlendirerek.
- ≥ 7 gündür açık, son 7 günde kaybı yok ve parça / iş yeri ≥ 2 gün çalıştı →
  Good news: "may be solved — close?". Diğerleri "No loss on …" satırında.

## Eşikler

OEE Settings → **Agent Report** (her biri > 0; "Back to the defaults"):

| Alan | Varsayılan |
|---|---|
| Die loss of a part: min per day / stops per day | 30 / 3 |
| Machine loss of a work center: min per day | 30 |
| OEE against the 4-week average: points | 10 |
| Repeating: days of the last 7 | 3 |
| Shift pattern: weakest on days of the last 5 | 4 |
| Scrap + reject: times the 7-day rate | 2 |
| Time per stop: times the 7-day average | 1.5 |
| Compare only with loading of at least (min) | 120 |
| Downtime without a reason: % of the day | 10 |
| Notes in the management summary | 5 |

Ayar `oeeSettings.agent` ve `lossGroups[].agent` (isteğe bağlı alanlar; şema yalnızca
genişledi, `scripts/schema.snapshot.json`).

## OEE open topics — ajan (2026-10-23, planlamacı)

**OEE → Open Topics** (`/oee/topics`): ajanın kronik ve kritik bulduğu kayıplar,
masraf yeri bazında. Agent Report günü her açılışta yeniden hesaplar; bu liste ise
**kalıcıdır** (`oeeTopics` tablosu).

- **Ne zaman:** OEE yüklemesi bitince (`oee.finishImport` → `oeeTopics.analyse`) son
  **kapanmış** gün (bugünden önceki son yüklü gün, fabrika saati) **bir kez**
  incelenir; gün içindeki yarım yükleme incelenmez (2026-10-23: yarım gün "yapıldı"
  sayılıp tam veri gelince atlanıyordu). İşlenen gün `oeeTopicRuns`'a yazılır; ikinci
  yükleme aynı günü yeniden yapmaz. Yeniden denenen: başarısız, 15 dk'dan uzun yarım
  kalmış ya da gün kapanmadan başlamış çalışma (`shouldRun`). Sayfadaki *Analyse the
  last day* de aynı kurala uyar.
- **Aday** (kurallar, `src/lib/oeeTopics.ts`): iş yeri × kayıp grubu (Reason Code 1
  kayıp, Reason Code 2 ≠ "#") o gün ≥ 60 dk kayıp ve geriye bakılan 6 haftanın
  (7'şer gün) en az birinde ≥ 120 dk. En çok 12 yeni aday, bu haftanın kaybına göre.
- **Karar:** yapay zekâ adayın gerçekten kronik ve kritik olup olmadığına karar verir,
  başlık / kısa analiz / ilk aksiyon yazar. Yapay zekâ yoksa ya da cevap bozuksa
  **kurallar**: geçmiş haftaların ≥ 3'ü kayıplı, son 7 gün ≥ 120 dk ve geçmiş
  ortalamadan az değil. Her konuda kanıt (bugün, son 7 gün, haftalık dakikalar) sayıyla
  yazılır; kararı kimin verdiği (AI / rules) görünür.
- **Tekrar yok:** anahtar = masraf yeri | iş yeri | kayıp grubu. Açık konu ertesi gün
  yine aday olursa yeniden yazılmaz; yalnızca *last seen* ve *days seen* güncellenir.
  Kapatılmış konu tekrar ederse yeni konu açılır. Kapatma not ister (`oee.data` izni).
- **Yapay zekâ ayarı** (kendi sunucumuzdaki — self-hosted — Convex'in ortam değişkenleri;
  kodda / veritabanında değil; adımlar `docs/deployment.md` → *OEE açık konular — yapay zekâ*):
  `AI_API_KEY` (zorunlu), `AI_API_URL` (varsayılan Google Gemini'nin OpenAI uyumlu
  adresi), `AI_MODEL` (varsayılan `gemini-flash-latest`). OpenAI uyumlu her ücretsiz
  servis olur (ör. Groq: `https://api.groq.com/openai/v1/chat/completions`).
  Gönderilen yalnızca masraf yeri / iş yeri / kayıp grubu adları ve dakikalardır.
  Ücretsiz katmanlarda servis veriyi kendi geliştirmesi için kullanabilir.
- Eşikler şimdilik koddadır (`TOPIC_DEFAULTS`); OEE Settings'e taşınması açık iş.

- Kısa duruşlar ayrı konudur (2026-10-23): süre histogramı varsa aynı kod ikiye bölünür, `ARZ` ≥ eşik (kullanılabilirlik), `ARZ<` < eşik ("Machine breakdown < 2 min", hız kaybı). Eski açık konular `ARZ` anahtarıyla kalır; dakikaları artık yalnız uzun duruşlardır.

## Agent Insights (2026-10-23, Ahmet — Karabasan oturumu üzerinden)

**OEE → Agent Insights** (`/oee/insights`): masraf yeri, iş yeri (ya da tümü) ve
tarih aralığı (varsayılan son 4 tam hafta; hazır 1 / 4 / 12 hafta, en çok 13 hafta)
seçilir, **Agent report** 3–5 tespit yazar: "standart OEE Pareto'sunda görünmeyen".

- **Eğitim = önce sinyal, sonra yorum.** Yapay zekâya ham toplam gitmez. Kod
  (`src/lib/oeeInsights.ts`, saf, her tür için test) şu sinyalleri hesaplar; her
  birinin kanıtı, kazancı (dk / hafta ve gerçekleşen hızla adet / hafta) ve güveni
  sayıyla yazılır:
  1. **Gizli yoğunlaşma** — bir kayıp grubunun ≥ %50'si tek parçada ve kayıp payı
     ÷ yükleme payı ≥ 1,5.
  2. **Parça × iş yeri** — aynı parça bir iş yerinde yükleme saati başına ≥ 2 kat
     kayıp (iki iş yerinde de ≥ 240 dk yükleme).
  3. **Sipariş değişimi** — günlük sipariş sayısı ile availability korelasyonu ≤ −0,5
     (≥ 8 gün).
  4. **Vardiya** — bir vardiyanın OEE'si diğerlerinden ≥ 8 puan düşük, haftaların
     ≥ %60'ında.
  5. **Haftanın günü** — bir günün yükleme saati başına kaybı günlerin ortalamasının
     ≥ 1,6 katı.
  6. **Mikro duruş** — ≥ 20 duruş; süre verisi varsa (01.09.2026'dan beri) yalnız < eşik olaylar (hız kaybı), yoksa duruş başına ≤ 2 dk. Diğer sinyaller kayıp kodlarının ≥ eşik olaylarıyla çalışır (kısa duruşlar availability analizine girmez).
  7. **Rejim değişimi** — kayıp bir günden sonra ≥ 2 kat (her iki yanda ≥ 5 yüklü gün).
  8. **Performans anomalisi** — parça × iş yerinde performans > %105 ya da < %50
     (ideal çevrim süresi master verisi).
  9. **Veri kalitesi** — kaybın ≥ %10'u sebepsiz ("#"); binlerce adette hiç ıskarta /
     red yok; bir iş yerinde "#" duruş olay başına ≥ 20 dk ve kodlu duruşların ≥ 2 katı
     (büyük duruşlar nedensiz kalıyor).
  10. **Sık ve kısa ayar** — aynı ayar metni (ör. "REGLAJ ELECTROT") haftada ≥ 50 kez,
      olay başına ≤ 5 dk. Ayar sayılır: grubun anlamı set-up / adjustment diyorsa, metin
      Setup texts'teyse ya da REGLAJ / SETUP / ADJUST / AYAR / SCHIMB geçiyorsa. Kazanç
      kaybın yarısı.
  11. **Mola sonrası artık duruş** — metinde "after (lunch/coffee) break" / "after lunch" / "post-break" /
      "după pauză" / "după masă" / "mola sonrası" / "moladan sonra" / "mola dönüşü" / "yemekten sonra"
      (aksanlı ya da aksansız; "after breakdown" arızadır, sayılmaz); kazanç kaybın tamamı.
  12. **Plansız 5S** — kayıp kodunda (üretim süresi içinde) yazılmış 5S ("5S", "5 S", "5-S"); kazanç yarısı.
- **Alt nedenler (2026-10-23):** her kayıp sinyalinin kanıtına o kayıptaki en büyük 3
  duruş metni (`oeeLossDays.reasons`, `rc1|rc2|metin`) dk ve olay sayısıyla eklenir
  ("Top reasons: …"); yapay zekâ da görür.
  Plan bağlantısı (geciken malzeme × kayıp) henüz yok — açık iş.
- **Puan** = kazanç (dk / hafta) × sürpriz (tür ağırlığı; yoğunlaşmada lift) × güven
  (yüksek 1 / orta 0,7 / düşük 0,4). En iyi 20 sinyal yapay zekâya gider
  (`INSIGHT_SYSTEM`, İngilizce; istek ≤ 24 000 karakter, `INSIGHT_MAX_CHARS`).
- **Yapay zekâ** yalnız verilen sinyal kimliklerine dayanan tespit yazabilir; kazanç
  dayandığı sinyallerin toplamını aşamaz; eksik alan sinyalden doldurulur. Anahtar
  yoksa / cevap kullanılamazsa **en güçlü 3 sinyal** gösterilir ve sayfa bunu yazar.
- **Kayıp kodlarının anlamı:** OEE Settings → Loss groups → *Meaning*
  (`lossGroups[].meaning`). Kullanıcının yazdığı her zaman önce gelir; boşsa varsayılan
  sözlük (`src/lib/settingsDefaults.ts` → `LOSS_CODE_MEANINGS`, planlamacının verdiği:
  #, SCHED_DOWN YNT / UTS, STP, UNSCD_DOWN YNT, KLP, ARZ, KSD, KON, OFC, MLZ, CLR, DEV)
  kullanılır ve Settings'te gri placeholder olarak görünür. "RC1 RC2" anahtarı (ör.
  `UNSCD_DOWN YNT`) kayıp sayılan Reason Code 1 ile eşleşirse önce o, sonra yalnız RC2.
  Ne ayarda ne varsayılanda anlamı olan grup varsa sayfa uyarır.
- **Tanımsız kod (undefined code):** veride kayıp olarak geçip Loss groups'ta olmayan
  Reason Code 2. Rapor bunları kaydeder (`oeeInsightReports.undefinedCodes`) ve sayfa
  uyarır; yapay zekâ "not defined in OEE Settings" işaretiyle görür. OEE Settings son
  7 günün duruşlarından aynı uyarıyı ve *Add* düğmesini gösterir.
- **İstek sınırı:** 24 000 karakteri aşarsa en zayıf sinyaller çıkarılır (JSON
  bozulmaz).
- **Kişisel veri yok:** `responsible` alanı okunurken atılır; giden yalnız masraf yeri
  / iş yeri / parça / kod adları ve sayılar.
- **Kayıt:** `oeeInsightReports` (filtre, aralık, gün, kaynak, model, tespitler, sinyal
  sayısı). Aynı filtre aynı gün yeniden istenirse kayıttan gelir; *Regenerate* yenisini
  yapar. Uzun iş sunucu işlemidir (`oeeInsights.build`), sayfa ilerlemeyi gösterir.
  Rapor yapmak `oee.data` izni ister; okumak OEE izni.
- Yapay zekâ istemcisi ortak: `convex/aiClient.ts` (açık konular ajanı da kullanır).
