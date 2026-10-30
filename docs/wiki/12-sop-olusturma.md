# 12 · SOP oluşturma (videodan standart operasyon prosedürü)

> Son güncelleme: 2026-10-29 · Durum: **ilk sürüm kodda** (Machine Follow-up → SOP Builder); sunucuda
> `sop-worker` kurulunca çalışır ([05](05-yayin-ve-isletim.md), `deploy/README.md` → SOP Builder).
> Kaynak: kullanıcıyla 2026-10-28 / 29 konuşması, şablon `docs/sop/sop-sablon.xlsx`.

Yetkili kullanıcı bir operasyon videosu yükler; yapay zekâ videoyu izleyip operasyonu adımlara böler,
her adımı en iyi gösteren kareyi seçer ve açıklamaları yazar; kullanıcı ekranda düzeltir ve **Save PDF** alır.

## Kesin kural: çıktı şablona %100 uyar

- **Tek kaynak:** [`docs/sop/sop-sablon.xlsx`](../sop/sop-sablon.xlsx) (kullanıcının verdiği `Sop_new_format.XLSX`,
  2026-10-29). Referans görüntü: [`docs/sop/sablon-onizleme.png`](../sop/sablon-onizleme.png)
  (LibreOffice çizimi; Calibri yerine Carlito, oran ve çizgiler doğru).
- Yapı **asla değişmez**: satır / sütun oranı, birleştirmeler, etiketler, sıra, renkler, KKD satırı, alt bilgi.
  Alan eklenmez, kaldırılmaz, yeri değişmez. Sığmayan metin hücreyi büyütmez, yazı küçülür.
- **6 adımdan fazlası için sayfa çoğaltılır:** her sayfa şablonun tam kopyasıdır (başlık, künye, KKD, alt bilgi
  dahil), adım numarası sayfalar arasında devam eder (7, 8, …), `PAG` kutusu `1/2`, `2/2` olur.
- Etiket metinleri şablondaki gibi (Romence) kalır, Türkçe seçilse de; içerik dili SOP başına seçilir
  (TR **ya da** RO, tek dil).
- Ölçüler ve kutular **tek yerde**: `src/lib/sop/sopLayout.ts`. `sopLayout.test.ts` sütun genişliklerini, satır
  yüksekliklerini, birleştirmeleri ve sabit yazıları şablon dosyasının kendisiyle karşılaştırır — biri kayarsa CI kırmızı.
  Şablon değişirse: dosya `docs/sop/`'ta değişir, test neyin değiştiğini söyler, `sopLayout.ts` ona göre güncellenir.

## Kâğıt ve ölçüler (şablondan okundu)

| Özellik | Değer |
|---|---|
| Kâğıt | **A3 yatay** (`paperSize 8`), kenar boşlukları 0, yatay + dikey ortalı, tek sayfaya sığdır (ölçek 65) |
| Yazdırma alanı | Şablonda `A6:BC85` (logo ve künye dışarıda kalıyor) — **kullanıcı 2026-10-29: formun tamamı** (`A1:BC86`) basılır |
| Sütunlar | `A` = 15,57 · `B`…`BC` = 54 sütun × 4,714 (eşit) → üç adım sütunu eşit genişlikte (18'er sütun) |
| Satır yükseklikleri (pt) | 1–7: 15 (toplam 105) · 8: 28,5 · 9: 15 · 10: 26 · 11: 54 · gövde 15; istisnalar 34: 39, 68: 41,25 |
| Yazı | Başlık Arial 20 kalın; etiketler Calibri 14–16 kalın; künye Calibri 11 / Arial 10; alt bilgi Calibri 16 kalın italik yeşil (`00B050`) |
| Yeşil etiketler | `PROIECT`, `REFERINȚĂ`, `NR. SOP` (`00B050`) |

## Hücre haritası

**Başlık (1–11. satır)**

| Alan | Etiket | Değer hücresi | Şablondaki değer |
|---|---|---|---|
| Logo | — | `A1:H7` (resim A1→H6, 506×184 px, Martur Fompak International) | sabit |
| Başlık | — | `I1:AQ5` | `PROCEDURĂ STANDARD DE OPERARE (SOP)` |
| Başlık altı şerit | — | `I6:AW7` | boş kalır |
| Form künyesi (**sabit**) | `AR1:AV5` | `AW1:BC5` | Issued Date 10.02.2011 · Revision Date 26.02.2024 · Revision No 1 · Confidency Classification L2 · Document No S5-P2T3F1 |
| Sayfa | `AX6:AZ7` `PAG` | `BA6:BC7` | `1/1` |
| Üretim birimi | `A8:C9` `UNITATEA DE PRODUCȚIE` | `D8:I9` | boş |
| (yazılabilir) | `J8:M9` | `N8:P9` | `TÜT` yazılı gelir, ikisi de elle değiştirilir |
| Proje | `Q8:T9` `PROIECT` | `U8:AB9` | `V769` (örnek) |
| (yazılabilir) | — | `AC8:AG9` | boş, elle yazılır |
| Operasyon adı | `AH8:AP9` `NUME OPERAȚIE` | `AQ8:BC9` | boş |
| Hazırlayan | `A10:C11` `EMIS DE` | `D10:I11` | boş |
| Düzenleme tarihi | `J10:P10` `DATĂ EMITERE` | `J11:P11` | boş |
| Revizyon tarihi | `Q10:U10` `DATĂ REVIZIE` | `Q11:U11` | boş |
| Revizyon no | `V10:Y10` `NR. REVIZIE` | `V11:Y11` | boş |
| Revizyon nedeni | `Z10:AM10` `MOTIV REVIZIE` | `Z11:AM11` | boş |
| Referans | `AN10:AX10` `REFERINȚĂ` | `AN11:AX11` | boş |
| SOP no | `AY10:BC10` `NR. SOP` | `AY11:BC11` | boş |

**Adımlar: sayfada 2 bant × 3 sütun = 6 adım**

| Satır | Bant 1 (adım 1–3) | Bant 2 (adım 4–6) | Sütunlar (adım 1/4 · 2/5 · 3/6) |
|---|---|---|---|
| Fotoğraf (A sütunu etiketsiz) | 12–30 (285 pt) | 47–64 (270 pt) | `B:S` · `T:AK` · `AL:BC` |
| `PAȘI DE BAZĂ` (gri dolgu) | 31–34 (84 pt) | 65–68 (86,25 pt) | aynı |
| `PUNCTE CHEIE` | 35–40 (90 pt) | 69–74 (90 pt) | aynı |
| `CAUZE` | 41–46 (90 pt) | 75–80 (90 pt) | aynı |

- Adım numarası fotoğrafın **sol altında** beyaz, siyah çerçeveli kutu (metin kutusu, `B27` `T27` `AL27`, `B61` `T61` `AL61`;
  63 × 63 px, Calibri 32 kalın). **Yalnız dolu adımda** görünür; boş kutuda numara yok.
- İçerik yazısı Calibri 14 kalın, siyah (CAUZE de siyah — şablondaki gibi); sığmazsa küçülür.
- Bant 2'nin fotoğraf alanı bant 1'den bir satır (15 pt) kısadır — şablon böyle, aynen korunur.

**Alt kısım**

| Satır | İçerik |
|---|---|
| 81–83 | `A81:G83` `ECHIPAMENT DE PROTECȚIE PERSONAL`; `H81:BC83` üç KKD grubu (simge + ürün resmi + onay kutusu + yazı): `FOLOSIȚI PANTOFI DE PROTECȚIE` (iş ayakkabısı), `FOLOSIȚI MĂNUȘI` (eldiven), `FOLOSIȚI TRICOUL ȘI PANTALONII` (tişört + pantolon) |
| 84–86 | `A84:AT86` "Toate versiunile tipărite … COPII NECONTROLATE … / Tüm çıktı alınmış versiyonları KONTROLSÜZ KOPYAdır …" (RO + TR); `AU84:BC86` `S1-P1F12/Rev.01` |

**Şablondaki artıklar** (çizilmez): `K46` ve `AC80`'de 2 px yüksekliğe çökmüş "UZUN KOLLU İŞ ELBİSESİ" grupları,
`AL27` / `T61`'de üst üste ikinci numara kutusu, `CN36`'da boşluk. KKD satırı şablondaki üç kalemdir; başka ekipman
gerekirse şablon güncellenir (kullanıcı 2026-10-29), kod `PPE_ITEMS`'ı izler.

## İçerik kuralları (TWI iş öğretimi)

Aynı yapıdaki dolu örnekten (başka bir firmanın Türkçe SOP'u; belge depoya **konmadı**, yalnız kuralları alındı):

| Satır | TR karşılığı | Ne yazılır |
|---|---|---|
| Fotoğraf | Görsel işlem adımları | Her hücrede **tek konulu** fotoğraf; operatörün dikkatini çekecek şekilde işaretli (kırmızı / sarı daire, ok) |
| `PAȘI DE BAZĂ` | Temel adımlar | Operatörün yaptığı iş; emir kipi, kısa ("Şablonu arabanın merkezine göre ayarla") |
| `PUNCTE CHEIE` | Püf noktaları | İşlem sırasında dikkat edilecek kritik nokta ("Dayamaları sıkarken dikkatli ol") |
| `CAUZE` | Nedenleri | Adımın / püf noktasının **neden** uygulanması gerektiği — iş güvenliği ya da kalite sonucu ("Saca tam oturmazsa robot sacı alamayabilir") |

Püf noktası ve neden boş kalabilir. Örnekte sayfa dolunca sayfa kopyalanmış, numaralar elle düzeltilmiş (hatalı:
`13`, `18`, `3`, `4`) — otomatik numaralama bu hatayı önler.

**Yapay zekâdan istenen JSON** formun alanlarına indirgenmiştir (`src/lib/sop/sopSchema.ts`, tek kaynak; worker aynı
şemayı Gemini'ye `responseSchema` olarak gönderir): adım başına `temel_adim`, `puf_noktasi`, `nedeni`,
`baslangic_sn` / `bitis_sn`, `kareler` (1–2 tane: `saniye` + isteğe bağlı `isaret` kutusu [ymin, xmin, ymax, xmax] 0–1000);
`kkd` için üç evet / hayır. İlk taslaktaki `operasyon_ozeti`, `genel_riskler`, `kalite_kontrol_noktalari` formda
yer olmadığı için istenmez.

## Nasıl çalışır

```
/machine-followup/sop  ──video──▶ Convex deposu ──▶ sopJobs: queued
                                                     │  (sop-worker 10 sn'de bir sorar; aynı anda tek iş)
sop-worker: claim ─▶ video diske (sop-data) ─▶ Convex kopyası silinir ─▶ ffprobe süre
            ─▶ Gemini Files API (resumable) ─▶ generateContent (prompt.md + responseSchema)
            ─▶ /check (Convex şemayla denetler; uymazsa hata metniyle 1 kez daha sorar, yine olmazsa error)
            ─▶ ffmpeg: her adımın kare saniyesinden JPEG ─▶ doğrulama turu (prompt-verify.md: kare adımı
               gösteriyor mu? değilse adım aralığında yeni saniye, işaret kutusu) ─▶ kareler depoya ─▶ /done
sopJobs: review ─▶ /machine-followup/sop/<id>: form ekranda düzeltilir ─▶ Save / Approve / Save PDF
```

| Durum | Anlamı |
|---|---|
| `queued` | sırada (ya da worker çökünce geri döndü) |
| `processing` | worker işliyor; ilerleme metni ve kalp atışı (60 sn). 10 dakika ses gelmezse cron (15 dk) sıraya geri koyar; en çok 2 deneme |
| `review` | taslak hazır, düzenlenebilir |
| `approved` | onaylandı (kim, ne zaman); düzenleme sürer. Onaylı SOP'lar aynı fabrika + dildeki yeni işlere **örnek** olur (son 3, 8'er adım) |
| `error` | hata metni; *Try again* sıraya koyar |

- **Düzenleme ekranı = PDF:** `SopSheet` şablonu 1891 × 1872 px çizer, ekranda küçültülür; yazılar yerinde
  düzenlenir (contentEditable), fotoğrafa tıklanınca sağdaki panelden kare saniyesi (−1 / −0,2 / +0,2 / +1, elle) →
  worker o kareyi çıkarır; kırmızı işaret sürükleyerek çizilir / kaldırılır; adım taşınır, eklenir, silinir; ikinci
  fotoğraf eklenir. *Save PDF* her sayfayı ayrı A3 yatay sayfa olarak, kenarsız ve ortalı basar (`sheetsToPdf`).
  Dosya adı `GGAAYY SOP <SOP no | referans | operasyon>`.
- **Kilit anlar** (isteğe bağlı): yükleme formunda saniyeler yazılır; prompt adımları bu anlardan böler.
- **Prompt** kod dışında: `sop-worker/prompt.md`, `sop-worker/prompt-verify.md` (worker her işte okur).
- **Worker uçları:** `POST /sop/worker/{claim,heartbeat,check,frame,done,fail,frames-done}` (convex/http.ts,
  `SOP_WORKER_TOKEN`), kuyruk convex/sopQueue.ts. Kısa video (≤ 3 dk) saniyede 2 kare izlenir, uzun (> 15 dk)
  düşük çözünürlükte.
- **Kurulmadan yükleme kapalı:** Convex'te `SOP_WORKER_TOKEN` yoksa sayfa yüklemeyi açmaz (video Convex deposunda
  bekleyip 30 gece yedeğine girmesin).
- **Bellek:** worker 384 MB sınırlı, tek çekirdek, `nice`; kullanılabilir bellek 900 MB'ın altındaysa iş almaz.
- **Gece temizliği** (`purgeOrphanUploads`) SOP'un bekleyen videosunu ve karelerini tanır, silmez.

## Kararlar (2026-10-28 / 29, kullanıcı)

- **Çıktı PDF**, Excel değil; tarayıcıda mevcut *Save PDF* altyapısıyla ([pdf](../pdf.md), `src/lib/pdfSheet.ts`).
  **Düzenleme ekranı = PDF'in kendisi**: metinler ve kareler düzeltilir, sonra Save PDF. Yeni npm paketi yok.
- **Kareler adımlardan seçilir** (sahne eşiği yok): model adım saniyelerini verir, ffmpeg yalnız o kareleri alır.
  Kullanıcı tek tek seçmez; inceleme ekranında yanlış kareyi kaydırarak düzeltir, isterse videoyu izlerken "kilit an"
  işaretler (model adımları bu anlardan böler, metni yine videodan yazar).
- **Yetki: creator** (+ platform owner / General) — `convex/guarded.ts` → `companyAdmin`; yeni yetki alanı yok.
- Form: makine serbest metin, hazırlayan elle yazılır, tarih, operasyon adı, parça adı, parça kodu, dil (TR / RO),
  video. **Vardiya yok. Video süre / boyut sınırı yok.**
- **Depolama:** video ayrı Docker volume'de saklanır (gece yedeği `--include-file-storage` olduğu için Convex
  deposuna konmaz: 30 yedek × video diski doldurur); kareler Convex deposunda önbellek (video durdukça yeniden
  çıkarılır); metinler + seçilen saniyeler veritabanında.
- **İşleyici:** ayrı kapsayıcı `sop-worker` (`node:22-slim` + ffmpeg, depoyu salt okunur bağlar), aynı anda 1 iş,
  yavaş olabilir (günde 2–3 video). Gemini Files API ile video gönderilir; anahtar `SOP_AI_KEY` worker'ın ortamında.
- Logo şablonun içinden alınır (kullanıcı isterse `public/`'e PNG koyar).

## Kullanıcının cevapları (2026-10-29)

Yazdırma alanı: formun tamamı · `UNITATEA DE PRODUCȚIE`, `TÜT` kutuları, `PROIECT`, `AC8:AG9`, `REFERINȚĂ`, parça adı:
ekranda elle yazılır · künye ve form kodu sabit · `NR. SOP` elle · revizyon alanları ilk sürümde boş · başlık altı
şerit boş · TR seçilince de etiketler Romence · KKD: model işaretler, kullanıcı düzeltir (şablon gerekirse güncellenir)
· adım başına en çok 2 fotoğraf · fotoğrafa otomatik kırmızı işaret: evet · CAUZE siyah · boş kutuda numara yok.

## Açık / sonraki adımlar

- Sunucuda kurulum (`SOP_WORKER_TOKEN`, `SOP_AI_KEY`) ve **gerçek bir videoyla** ilk deneme; sonucun okunması.
- Kareler Convex deposundan geliyor; PDF görüntüsü için deponun CORS izni gerekir — ilk denemede *Save PDF*'te
  fotoğraflar çıkıyor mu bakılacak.
- Videoyu ekranda oynatıp kaydırarak kare seçmek (şimdilik saniye yazılıyor) — video sunucunun diskinde; site
  üzerinden oturumlu yayın ucu ayrı bir iş.
- İş silinince videonun diskteki kopyası kalır (kullanıcı videoların saklanmasını istedi); disk dolarsa elle temizlik.
