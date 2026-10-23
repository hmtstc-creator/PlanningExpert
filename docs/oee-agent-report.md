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
- 2 dk'dan kısa duruşlar ≥ 10 ve günlük ortalamanın ≥ 2 katı → Watch.

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
  yüklü gün **bir kez** incelenir; işlenen gün `oeeTopicRuns`'a yazılır, ikinci
  yükleme aynı günü yeniden yapmaz (yalnızca başarısız ya da 15 dk'dan uzun yarım
  kalmış gün yeniden denenir). Sayfadaki *Analyse the last day* de aynı kurala uyar.
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
- **Yapay zekâ ayarı** (Convex ortam değişkenleri; kodda / veritabanında değil):
  `AI_API_KEY` (zorunlu), `AI_API_URL` (varsayılan Google Gemini'nin OpenAI uyumlu
  adresi), `AI_MODEL` (varsayılan `gemini-flash-latest`). OpenAI uyumlu her ücretsiz
  servis olur (ör. Groq: `https://api.groq.com/openai/v1/chat/completions`).
  Gönderilen yalnızca masraf yeri / iş yeri / kayıp grubu adları ve dakikalardır.
  Ücretsiz katmanlarda servis veriyi kendi geliştirmesi için kullanabilir.
- Eşikler şimdilik koddadır (`TOPIC_DEFAULTS`); OEE Settings'e taşınması açık iş.
