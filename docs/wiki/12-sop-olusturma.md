# 12 · SOP oluşturma (videodan standart operasyon prosedürü)

> Son güncelleme: 2026-10-29 · Durum: **tasarım** — kod yok; format incelendi, sorular kullanıcıda.
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
- Etiket metinleri şablondaki gibi (Romence) kalır; içerik dili SOP başına seçilir (TR **ya da** RO, tek dil).
  *(Etiketlerin TR seçilince de Romence kalması kullanıcıya soruldu — aşağıda.)*

## Kâğıt ve ölçüler (şablondan okundu)

| Özellik | Değer |
|---|---|
| Kâğıt | **A3 yatay** (`paperSize 8`), kenar boşlukları 0, yatay + dikey ortalı, tek sayfaya sığdır (ölçek 65) |
| Yazdırma alanı | `A6:BC85` — **logo, başlık ve künye (1–5. satır) ile alt bilginin son satırı dışarıda** (soruldu) |
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
| Başlık altı şerit | — | `I6:AW7` | boş |
| Form künyesi | `AR1:AV5` | `AW1:BC5` | Issued Date 10.02.2011 · Revision Date 26.02.2024 · Revision No 1 · Confidency Classification L2 · Document No S5-P2T3F1 |
| Sayfa | `AX6:AZ7` `PAG` | `BA6:BC7` | `1/1` |
| Üretim birimi | `A8:C9` `UNITATEA DE PRODUCȚIE` | `D8:I9` | boş |
| ? | `J8:M9` `TÜT` | `N8:P9` (?) | boş — etiket mi değer mi belirsiz |
| Proje | `Q8:T9` `PROIECT` | `U8:AB9` | `V769` (örnek) |
| ? | — | `AC8:AG9` | boş, etiketsiz |
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

- Adım numarası fotoğrafın **sol altında** beyaz, siyah çerçeveli kutu (metin kutusu, `B27` `T27` `AL27`, `B61` `T61` `AL61`).
- Bant 2'nin fotoğraf alanı bant 1'den bir satır (15 pt) kısadır — şablon böyle, aynen korunur.

**Alt kısım**

| Satır | İçerik |
|---|---|
| 81–83 | `A81:G83` `ECHIPAMENT DE PROTECȚIE PERSONAL`; `H81:BC83` üç KKD grubu (simge + ürün resmi + onay kutusu + yazı): `FOLOSIȚI PANTOFI DE PROTECȚIE` (iş ayakkabısı), `FOLOSIȚI MĂNUȘI` (eldiven), `FOLOSIȚI TRICOUL ȘI PANTALONII` (tişört + pantolon) |
| 84–86 | `A84:AT86` "Toate versiunile tipărite … COPII NECONTROLATE … / Tüm çıktı alınmış versiyonları KONTROLSÜZ KOPYAdır …" (RO + TR); `AU84:BC86` `S1-P1F12/Rev.01` |

**Şablondaki tuhaflıklar** (kullanıcıya soruldu, cevaba göre güncellenecek): yazdırma alanı başlığı dışarıda bırakıyor;
`K46` ve `AC80`'de 2 px yüksekliğe çökmüş "UZUN KOLLU İŞ ELBİSESİ KULLAN" KKD grupları (görünmüyor, büyük olasılıkla
kopyalama artığı); `AL27` ve `T61`'de üst üste iki numara kutusu; `CN36`'da boşluk karakteri.

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

**Sonuç — yapay zekâdan istenen JSON** formun alanlarına indirgenir: adım başına `temel_adim`, `puf_noktasi`, `nedeni`,
kare saniyesi (+ işaret yeri); KKD için üç onay kutusu. İlk taslaktaki `operasyon_ozeti`, `gerekli_ekipman`,
`genel_riskler`, `kalite_kontrol_noktalari` formda yer olmadığı için istenmez (yer açılırsa döner).

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

## Açık sorular (2026-10-29, kullanıcıda)

Yazdırma alanı; `UNITATEA DE PRODUCȚIE` / `TÜT` / `AC8:AG9` / `REFERINȚĂ` alanlarının anlamı; parça adı ve makinenin
formdaki yeri; künye ve alt bilgi kodlarının sabit olup olmadığı; `NR. SOP` ve revizyon alanlarını kim doldurur;
TR seçilince etiket dili; KKD kutularının işaretlenmesi; adım başına fotoğraf sayısı; fotoğraf üstüne otomatik
kırmızı işaret; boş adım kutularında numara. Cevaplar gelince bu sayfa güncellenir.
