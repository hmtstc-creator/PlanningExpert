# Save PDF — sitedeki bütün çıktılar (2026-10-16, planlamacı)

Sitede yazdırma düğmesi yok; her çıktı **Save PDF**. PDF tarayıcıda, kullanıcının
bilgisayarında üretilir (sunucuya yük yok, dışarıya bir şey gitmez).

| Sayfa | Kâğıt | Nasıl | Dosya adı |
|---|---|---|---|
| KPI Dashboard (aylık / haftalık) | A3 yatay, kenarsız, tek sayfa | sayfa görüntüsü | `GGAAYY KPI MONTHLY` / `GGAAYY KPI WEEKLY` (dönemin ilk günü) |
| OEE Trend Analysis | A4 yatay, çok sayfa | sayfa görüntüsü | `GGAAYY OEE TREND` (seçili gün) |
| OEE Losses Trend | A4 yatay, çok sayfa | sayfa görüntüsü | `GGAAYY LOSSES TREND` (seçili gün) |
| OEE Loss Bridge | A3 yatay, tek sayfa | sayfa görüntüsü | `GGAAYY OEE LOSS BRIDGE` (dönemin son günü) |
| OEE Daily Report | A3 yatay, tek sayfa | sayfa görüntüsü | `GGAAYY OEE DAILY REPORT` (dönemin son günü) |
| OEE Agent Report | A4 dikey, çok sayfa | **metin** (seçilir, aranır) | `GGAAYY AGENT REPORT` |

## Kayıt

- **Chrome / Edge:** düğmeye basınca kayıt penceresi **Masaüstü** klasöründe ve ad
  dolu açılır; "Kaydet" yeter. Pencere tıklamanın hemen ardından açılır (Chrome
  pencereyi yalnızca tıklamadan sonraki birkaç saniyede açar), PDF ondan sonra
  üretilir; pencere kapatılırsa PDF hiç üretilmez.
- **Firefox / Safari:** pencere desteklenmez; PDF indirme klasörüne iner, düğmenin
  altında bunu söyleyen bir not çıkar.
- Tarayıcılar güvenlik gereği hiçbir siteye bilgisayara kendiliğinden yazma izni
  vermez; "doğrudan masaüstüne" bundan öteye gidemez.

## Sayfa görüntüsünden PDF (`src/lib/pdfSheet.ts`)

- Sayfa parçası görünmez bir kopyaya alınır (`.pdf-capture`), **açık temada**
  (koyu temada da kâğıt beyaz), 2× çözünürlükte görüntüye çevrilir, jsPDF ile
  sayfalara konur. Ekranda ne görünüyorsa PDF'te o; yazılar görüntü olduğu için
  seçilmez, dosya sayfa başına birkaç yüz KB – birkaç MB.
- Tailwind'in `print:` sınıfları PDF kopyasında da geçerli (`src/styles.css` →
  `@custom-variant print`): `print:hidden` düğmeler PDF'te yok, `print:block`
  başlıklar (seçili filtreler) yalnızca PDF'te. Kaydırma kutuları PDF'te açılır.
- **Tek sayfa (fit):** parça ekrandaki genişliğinde alınır ve sayfaya sığdırılır
  (yatayda ortalı). KPI sayfası zaten A3 ölçüsünde, kenarsız.
- **Çok sayfa (flow):** parça kâğıt genişliğinde alınır; grafikler sığmazsa
  orantılı küçülür. `.print-avoid-break` bölümleri sayfa arasında bölünmez
  (`pageSlices`, testli); sayfadan uzun bölüm mecburen bölünür.
- Grafikler rengi SVG özniteliğinde CSS değişkeniyle verir (`fill="var(--viz-1)"`);
  görüntü kopyası değişkenleri taşımadığı için öznitelikler önce hesaplanmış
  renkle değiştirilir (`resolveSvgColors`) — yoksa çubuklar siyah çıkar.

## Metin PDF (`src/lib/agentPdf.ts`)

- Agent Report notlardan oluşur: PDF doğrudan metinle yazılır (A4 dikey, sayfa
  numarası, başlık ilk notuyla aynı sayfada).
- Yazı tipi **Liberation Sans** (SIL Open Font License, `public/fonts/`, lisans
  `LiberationSans-LICENSE.txt`): Türkçe ve Romence harfler (ş ğ ı İ ș ț ă î â)
  PDF'e gömülür. Yalnızca PDF üretilirken yüklenir (~800 KB, bir kez).

## Denetim

- Kütüphaneler: `jspdf` 4.2.1, `html-to-image` 1.11.13 (sürüm sabit); yalnızca
  düğmeye basılınca yüklenir, sayfaların açılışını yavaşlatmaz. `npm audit`:
  yeni açık yok.
- Tarayıcıda denendi (2026-10-16, Chromium, fixture verisi): A4 çok sayfa, A3 tek
  sayfa, KPI A3 kenarsız, koyu tema, metin PDF, kayıt penceresi (tıklamadan sonra
  açılıyor, Masaüstü, ad dolu), vazgeçme ve indirme yolu.
