# OEE Dashboard — notlar

Bu dosya OEE Dashboard işinin tek not defteridir; her karar ve bulgu buraya
yazılır, eski not silinmez (değişirse "~~eski~~ → yeni" diye güncellenir).

Kaynak: `ASAKAI_2026_REV_12.xlsm` (2026-09-27 yüklendi). Planlamacı bu dosyayı
güncelleyip tekrar yükleyecek; program her yüklemede verileri alır.

## Talimat (planlamacı, 2026-09-27)

- Dosyada talimat dışında iş yapılmaz.
- Şu sekmelerin verileri **sıralaması ve formülleri olduğu gibi** yeni bir
  veritabanı sayfasına alınır: Shiftly KPI, Daily KPI, Weekly KPI, Monthly KPI,
  Downtimes, Shiftly Base Order KPI (gizli ya da görünür fark etmez).
- Bu verilerle, dosyadaki grafiklere karşılık gelen bir **OEE Dashboard**
  sayfası yapılır.
- Vardiya: **UB64 = 1. vardiya, UB65 = 2., UB66 = 3.**
- Shiftly KPI'daki Loading time, Operation time, Production time ile
  Availability ve Performance hesaplanır; formül anlaşılmalı.
- Hafta, ay vb. toplamlarda **ortalama alınmaz**: süreler toplanır, sonra
  bölünür.
- Önce inceleme ve sorular; kod yazılmaz.

## Dosyadaki sekmeler

| Sekme (dosyadaki adı) | Durum | Gerçek satır | Kapsam |
|---|---|---|---|
| Shiftly KPI | gizli | 557 | 10–25 Eylül 2026 (14 gün), vardiya × iş merkezi |
| Daily KPI | gizli | 230 | 10–25 Eylül (14 gün), gün × iş merkezi |
| Weekly KPI | gizli | 74 | 36–39. haftalar, hafta × iş merkezi |
| Monthly KPI | görünür | 134 | Ocak–Temmuz (01–07), ay × iş merkezi — Ağustos/Eylül yok |
| Shiftly Order Based KPI | gizli | 840 | 10–25 Eylül, vardiya × iş merkezi × sipariş (kalıp) |
| Downtimes (1) | gizli | 29 965 | 1–25 Eylül, her duruş bir satır |

Notlar:
- Talimattaki "Shiftly Base Order KPI" dosyada **"Shiftly Order Based KPI"**,
  "Downtimes" ise **"Downtimes (1)"** adında.
- Order Based sekmesinde 17 979 satırda formül var ama yalnızca 840'ında veri
  var (geri kalanı boş satıra kopyalanmış formül).
- Downtimes sekmesinde formül 49 998 satıra kadar kopyalanmış; veri 29 965 satır.
- Talimatta olmayan ama grafiklerin kullandığı sekmeler: **Weekly KPI_fix**
  (2–37. haftalar, geçmiş haftalar grafiği), **Losses_Follow** (haftalık kayıp
  tablosu), **Data** (AC:AD = vardiya kodu → 1/2/3), **OEE_Calculation**
  (gizli; doğru hesap yöntemi örneği).

## Sütunlar (sırası dosyadaki gibi)

### Shiftly KPI (A–S)
Date · Plant - Key · Production Responsible · Cost Center · Work Center ·
Shift Group · Shift Definition · Good Quantity · Scrap Quantity · Reject
Quantity · Scheduled Downtime(Min) · Unscheduled Downtime(Min) · Net Operating
Time(Min) · Net Production Time(Min) · Loading Time(Min) · Availability ·
Quality · Performance · Oee

- Formül yok (değerler sistemden gelir). U486'da tek başına `=O486-N486`
  var (başıboş hücre).
- Shift Group: UB64 Early / UB65 Late / UB66 Night (presler); UB61 1st / UB62
  2nd / UB63 3rd (APR iş merkezleri).

### Daily KPI (A–R)
Date · Plant - Key · Production Responsible · Cost Center - Key · Work Center ·
GOODQUANTITY · SCRAPQUANTITY · REJECTQUANTITY · Scheduled Downtime (saniye) ·
Scheduled Downtime(Min) · Unscheduled Downtime(Min) · Net Operating Time(Min) ·
Net Production Time(Min) · Loading Time(Min) · Availability · Quality ·
Performance · Oee

### Weekly KPI (A–R)
Daily ile aynı; ilk sütun **Week** (ISO hafta no).

### Monthly KPI (A–S)
Month (Türkçe ad: Ocak…) · Month Key ("01"…) · sonra Daily'deki sütunlar.

### Shiftly Order Based KPI (A–V)
Date · Plant · Plant Name · workcenter · Shift · Order · Equipment (kalıp no) ·
Material (512/840 satırda boş) · Good Quantity · Scrap Quantity · Reject
Quantity · Scheduled Downtime (min) (hep 0) · Unscheduled Downtime (min) ·
Net Operating Time (min) · Net Production Time (min) · Loading Time (min) ·
Availability · Quality · Performance · OEE · **WEEK** · **TOTAL1**

- Formüller: `U = ISOWEEKNUM(A)` (hafta), `V = T × I` (OEE × iyi adet —
  kalıp grafiğinde adet ağırlıklı OEE için).
- W185:Z188'de başıboş analiz formülleri var (SUMIFS ile adet ağırlıklı OEE).

### Downtimes (1) (A–AA)
Date · Plant · Plant - Key · Cost Center - Key · Work Center - Key (Not
Compounded) · Order Number · Material · Mold Number · Shift Group · Shift
Defination · Reason Code 1 · Reason Code 2 · Reason Code 3 · Reason Code 4 ·
Reason Code 5 · Reason Code Defination EN · Reason Code Defination TR ·
Stoppage Duration (saniye) · Stoppage Duration(Min) · StartDate · StartTime ·
EndDate · EndTime · **Shift** · **Week** · **material** · **min**

- Formüller: `X = VLOOKUP(J, Data!AC:AD, 2, 0)` (UB61/64→1, UB62/65→2,
  UB63/66→3), `Y = ISOWEEKNUM(A)`, `Z = G`, `AA = S`.
- Reason Code 1: SCHED_DOWN (planlı) / UNSCD_DOWN (plansız) / # (tanımsız).
- Reason Code 2 = kayıp grubu: KLP die breakdown, STP setup, ARZ machine
  breakdown, KON quality, KSD short stoppages, OFC logistic, YNT management,
  UTS planlı mola (çay/yemek), # undefined, CLR, DEV.

## Formüller (doğrulandı — 557 vardiya satırının hepsinde birebir tutuyor)

Tanımlar (planlamacının adlarıyla):
- **Loading time** = Loading Time(Min) — vardiya süresi eksi planlı duruş
  (8 saatlik vardiyada genelde Loading + Scheduled = 480).
- **Production time** = Net Production Time(Min).
- **Operation time** = Net Operating Time(Min).

```
Availability = Production time ÷ Loading time
Performance  = Operation time  ÷ Production time
Quality      = Good ÷ (Good + Scrap + Reject)        (dosyada hep %100)
OEE          = Availability × Performance × Quality
             = Operation time ÷ Loading time  (Quality %100 iken)
```

Toplama kuralı (planlamacı + OEE_Calculation sekmesi): her dönem için
(vardiya, gün, hafta, ay, pres grubu) **süreler toplanır, sonra bölünür**.
Örnek (OEE_Calculation): üç vardiyanın OEE ortalaması %60,5 çıkarken doğru
hesap (toplam/toplam) %60,0; başka örnekte ortalama %64,4, doğrusu %75,6.

Kontroller:
- Daily KPI = o günün Shiftly KPI vardiyalarının toplamı (230/230 birebir).
- Weekly ve Monthly sekmelerinin oranları da toplam/toplam ile hesaplanmış.
- Order Based'in vardiya toplamı Shiftly ile adet, Operating, Production ve
  Loading'de birebir aynı; Scheduled orada hep 0, Unscheduled = Loading −
  Production.
- Downtimes'taki planlı duruş toplamı Shiftly'deki Scheduled Downtime ile
  557/557 aynı. Plansız duruş toplamı (UNSCD + #) Shiftly'dekinden çoğu
  vardiyada küçük (148/557 aynı; fark medyan 7,9 dk, en çok 163 dk).
- Performance %100'ü geçebiliyor: 57 vardiyada (en yüksek %134,5), Order
  Based'de 94 satırda.

## Dosyadaki grafikler (pres tarafı: QRQC ve BoardReport)

BoardReport (press) — APR için "BoardReport - Nut" ve "QRQC - NUT" ayrı:
1. **Monthly** — pres ve grup OEE'si aylara göre (Monthly KPI). Pres için
   sekmedeki Oee değeri; grup için ΣOperating ÷ ΣLoading.
2. **Weekly – last 10 weeks** — pres ve grup (Progressive / Transfer); geçmiş
   haftalar Weekly KPI_fix'ten, son hafta Weekly KPI'dan.
3. **Shiftly** — son günlerin vardiya OEE'si, grup bazında
   (ΣOperating ÷ ΣLoading).
4. **% of Loading** — günlük kayıp dağılımı (DIE, SETUP, MACHINE, SHORT,
   OTHERS, SPEED) ÷ Loading.
5. **Loss trend** — 10 haftalık kayıp oranları (Losses_Follow) grup bazında.
6. **Kalıp OEE — en kötü 10** (her pres için, rapor haftası; Order Based,
   adet ağırlıklı: ΣTOTAL1 ÷ ΣGood).
7. **Speed loss — en çok 10 kalıp** (saat: ΣProduction − ΣOperating).
8. **Machine breakdown / die breakdown / setup / short stoppage** — iş merkezi
   ya da neden bazında en çok 10 (saat).
9. **Pres başına haftalık OEE çizgisi** (10 hafta).

QRQC (tek pres, seçilen gün): OEE & losses, shiftly OEE (21 vardiya) + haftalık
ortalama çizgisi, daily OEE & weekly, kayıp nedenleri sıralı.

Formül ayrıntıları:
- Grup: cost center **51010171 = TRANSFER** (PRS-106, 107), **51010173 =
  PROGRESSIVE** (103, 104, 105, 108, 109, 110). APR = 51010172 (Nut).
- Kayıp oranı = Σ(plansız duruş dk, o grup kodu) ÷ ΣLoading.
- Speed loss = (ΣProduction − ΣOperating) ÷ ΣLoading.
- Rapor günü `rapordate` (BoardReport X2), rapor haftası = ISO hafta.

## Açık sorular (2026-09-27)

Cevaplar gelince buraya yazılacak.

1. Sekme adları: "Shiftly Base Order KPI" = "Shiftly Order Based KPI",
   "Downtimes" = "Downtimes (1)" — doğru mu?
2. Weekly KPI_fix (2–37. haftalar) listede yok ama geçmiş hafta grafikleri onu
   kullanıyor. Alınsın mı?
3. Monthly KPI'da yalnızca Ocak–Temmuz var. Eksik aylar Daily/Weekly'den
   toplanarak mı hesaplansın, yoksa sekme olduğu gibi mi gösterilsin?
4. Yükleme: her yüklemede sekmenin eski verisi tamamen silinip yenisi mi
   yazılsın, yoksa aynı tarih/vardiya/iş merkezi güncellenip eski tarihler
   saklansın mı (geçmiş birikir)?
5. Kapsam: yalnızca presler (PRS) mi, APR (Nut, cost center 51010172,
   UB61–63) de mi?
6. Pres grupları: Excel'deki cost center (Transfer/Progressive) mı, Press
   Definitions'taki kategori mi (tek kaynak kuralı)?
7. Performance %100'ü geçen vardiyalar olduğu gibi mi kalsın?
8. Kalıp OEE grafiği Excel'de adet ağırlıklı ortalama (TOTAL1). Kurala göre
   ΣOperating ÷ ΣLoading ile mi hesaplansın?
9. Kayıp grubu adları (KLP = Die breakdown …) programda sabit mi kalsın,
   yoksa bir tabloda siz mi tanımlayacaksınız?
10. Plansız duruş: Downtimes toplamı Shiftly'dekinden küçük. Aradaki fark
    grafikte "açıklanmamış" diye ayrıca gösterilsin mi?
11. Hangi grafikler: listedeki pres grafiklerinin hepsi mi, bir kısmı mı?
12. OEE hedefi (çizgi) var mı? Varsa değeri programda mı, sizde mi?
13. Rapor günü: varsayılan veri içindeki son gün, istenirse seçilebilir —
    uygun mu?
14. Sayfa yeri: menüde Analysis → OEE Dashboard; dosya yükleme aynı sayfada
    mı, SAP Data sayfasında mı?
15. İş merkezi adları (PRS-106 …) Press Definitions'taki pres adlarıyla aynı —
    eşleştirme ada göre mi yapılsın?

## Kararlar (2026-09-27, planlamacının cevapları)

1. Sekmeler doğru: Shiftly Order Based KPI ve Downtimes (1).
2. Weekly KPI_fix de alınır (geçmiş haftalar).
3. Monthly KPI olduğu gibi gösterilir (eksik aylar hesaplanmaz). Monthly komple
   yüklenebilir.
4. Az yükleme: planlamacı yalnızca Shiftly'yi yükleyebilmeli; Daily ve Weekly
   program tarafından Shiftly'den hesaplanır (toplam ÷ toplam).
   - Kontrol: Daily = günün vardiya toplamı (230/230). Weekly = ISO haftanın
     vardiya toplamı — Shiftly'nin haftanın tamamını kapsadığı 38 ve 39.
     haftalarda 19/19 birebir; 37. hafta dosyada yarım (10–12 Eylül), o yüzden
     farklı. Sonuç: geçmiş birikirse (her yükleme eskiyi silmezse) haftalar
     tam olur.
5. İki seçim: **PRS** ve **APR**. Hesap ve mantık aynı; APR'de hepsi aynı
   masraf yerinde (51010172) olduğundan makine (iş merkezi) bazlı gösterilir.
6. Pres grupları Excel'deki cost center'dan: 51010171 Transfer, 51010173
   Progressive (APR 51010172).
7. Performance %100 üstü olduğu gibi kalır.
8. Kalıp OEE'si adet ağırlıklı (ΣOEE×Good ÷ ΣGood, dosyadaki TOTAL1) —
   dosyadaki gibi.
9. Kayıp grubu adları programda sabit (ileride tabloya ayrılabilir).
10. Downtimes ile Shiftly plansız duruş farkı grafikte gösterilmez —
    **ayrıca incelenecek** (bekleyen konu).
11. Grafikler:
    - Masraf yeri bazlı OEE — 3 grafik.
    - Aylık ve haftalık — 2 grafik.
    - Tarih seçilir; seçilen tarihin haftasının trendi (BoardReport'taki gibi).
12. OEE hedefi yok.
13. Varsayılan gün: dün; tarih seçilebilir.
14. Portaldaki **"OEE Trend and Losses"** kartına (/oee) basınca dashboard
    açılır; veri yükleme için basit bir buton.
15. İş merkezi adı = Press Definitions'taki pres adı (PRS-106 …), ada göre
    eşleşir.

### Ek kararlar (2026-09-27, ikinci tur)

16. Yükleme: planlamacı sistemden **ayrı, sade bir dosya** indirip yükler
    (ASAKAI gibi karışık ve büyük değil). Dosya biçimi gelince sütunlar bu
    notlara yazılacak.
17. Masraf yeri grafiği **tek grafik**; masraf yeri bir seçimle değiştirilir
    (Transfer / Progressive / APR). İçeriği BoardReport'taki gibi: seçilen
    haftanın vardiya OEE'leri (Pzt-1 … Paz-3), ΣOperating ÷ ΣLoading.
18. OEE Dashboard sayfa düzeni (yukarıdan aşağı):
    1. **Aylık** OEE
    2. **Son 10 hafta** trendi
    3. **Mevcut hafta** trendi — hafta, seçilen tarihten gelir.
19. Kayıplar ayrı bir **Losses Trend** sayfasında izlenir:
    - Mevcut haftanın kayıp gidişatı, BoardReport'taki gibi (günlük kayıp
      dağılımı: die, setup, machine, short, others, speed — Loading'e oran).
    - Yanında **geçen haftanın** aynı değerleri: karşılaştırma, artış mı
      azalış mı görünür.

### Üçüncü tur (2026-09-27) — "programı düzelt"

20. Tek dosyada 6 sayfa gelir; program gerekli olanları okur (Daily KPI
    okunmaz, vardiyadan hesaplanır).
21. PRS seçilince masraf yeri (Transfer / Progressive / tümü), APR seçilince
    makine seçimi.
22. Aylık ve 10 hafta grafiği seçilen masraf yerini gösterir; altında pres
    bazında tablo.
23. Karşılaştırma: hafta farkı (gap) pres ve masraf yeri bazında.
24. Losses Trend sayfası: kayıp trendleri, en kötü kalıplar, setup detayları
    (setup'tan sonra üretim başlamış mı, KLP girilmiş mi = onay alınamamış),
    pres bazında listeler ve gelişmiş raporlar.

## Uygulama (2026-09-27)

Sayfalar (portaldaki "OEE Trend and Losses" kartı):
- **/oee — OEE Dashboard**: üstte PRS/APR, masraf yeri/makine, tarih
  (varsayılan dün), **Upload data** düğmesi. Kutular: seçilen gün, hafta,
  geçen hafta (fark), kalite. Grafikler: aylık (Monthly KPI), son 10 hafta,
  seçilen haftanın 21 vardiyası (Pzt-1 … Paz-3); her birinin altında pres
  bazında tablo.
- **/oee/losses — Losses Trend**: haftanın günlük % of Loading grafiği (OEE +
  Die, Setup, Machine, Short, Others, Speed) ve tablo (hafta, geçen hafta,
  gap); pres ve masraf yeri bazında hafta gap tablosu; 10 haftalık kayıp
  trendi; en çok duruş nedenleri (geçen haftayla); MTTR / MTBF (makine ve
  kalıp arızası); en kötü 10 kalıp (adet ağırlıklı OEE) ve en çok speed loss;
  setup listesi ve pres özeti.
- **/oee/data — Data**: yüklenen sayfalar dosyadaki sütun sırasıyla; formül
  sütunları dosyadaki formülle (Order Based WEEK, TOTAL1; Downtimes Shift,
  Week, material, min). Daily ve Weekly hesaplanmış hâliyle.

Yükleme kuralı: dosyanın kapsadığı tarih aralığı eskisinin yerine geçer,
daha eski tarihler kalır (geçmiş birikir). Haftalık satırlar hafta bazında,
Monthly KPI komple yenilenir. Haftalık sayfalarda yıl yok: hafta, dosyadaki
son vardiya tarihinin haftasından büyükse önceki yıla sayılır.

Hafta değeri: yüklenen haftalık satır (Weekly KPI / Weekly KPI_fix) o hafta
ve iş merkezi için varsa o; yoksa vardiyaların toplamı.

Setup evresi (varsayım — onaylanacak): ilk setup (STP) duruşundan siparişin
ilk kısa duruşuna (KSD) kadar; kısa duruş yalnızca pres çalışırken olur. Bu
evredeki KLP = onay alınamadı; KON = onay süresi. Örnek (PRS-105, sipariş
6586416): 07:55 setup, 08:46 kalite onayı, 09:07 KLP "BURR" 74 dk.
Gerçek dosyada 39. hafta: 57 setup; ilk kurallı hâliyle (setup'tan sonraki
her KLP) 36'sı "onaysız" çıkıyordu — üretim sırasındaki kalıp arızaları da
sayıldığı için bu evre tanımına geçildi.

Kod: `src/lib/oee.ts` (hesaplar), `src/lib/oeeStore.ts` (kayıt biçimi ve
yükleme sırası), `convex/oee.ts`, `convex/oeeValidators.ts`,
`src/routes/oee/*`, `src/components/OeeCharts.tsx`, `OeePanel.tsx`.
Testler Excel hücreleriyle birebir: Progressive 21 ve 22 Eylül % of Loading
(BoardReport satır 46–47), Transfer 39. hafta OEE (Weekly KPI / Losses_Follow
B6; BoardReport AQ30'daki değer eski hesap), PRS-110 kalıp OEE (AH78).

## Açık sorular (ikinci tur) — cevaplandı

1. Ayrı indirilecek dosya(lar): yalnızca Shiftly KPI mı? Losses Trend için
   Downtimes da gerekir; Monthly KPI ve Weekly KPI_fix (geçmiş haftalar) bir
   kez mi yüklenecek?
2. PRS/APR seçimi ile masraf yeri seçimi: PRS seçilince Transfer /
   Progressive / tümü; APR seçilince makine (APR-618 …) seçimi mi?
3. Aylık ve 10 hafta grafikleri: seçilen masraf yerinin tek çizgisi mi, yoksa
   preslerin ayrı çubukları + grup çizgisi mi (BoardReport'taki gibi)?
4. Losses Trend: geçen hafta karşılaştırması gün gün mü (Pzt↔Pzt), yoksa
   hafta toplamı kayıp grubu bazında mı (ör. Setup %18 → %15 ↓)?
5. Losses Trend'de kalıp listeleri (en kötü 10 kalıp OEE, speed loss en çok
   10 kalıp) olsun mu? Olursa Order Based dosyası da yüklenmeli.

### Setup kuralı (2026-09-27, planlamacı) — ~~ilk kısa duruş varsayımı~~ yerine

- Setup yalnızca **planlı ya da plansız kalıp setup'ı**: PRS "DIE SETUP -
  PLANNED / UNPLANNED", APR "REGLAJ MATRITA - PLANIFICATA / NEPLANIFICATA".
  Sensör, gripper, bobin vb. ayarlar setup değil; setup'tan sonra olursa
  üretime geçememe nedenidir.
- Setup bittikten sonra, bir sonraki kalıp setup'ından önce **1 saat üretim**
  (duruşsuz süre) yapıldıysa **OK**, yapılamadıysa **NOK** (üretime
  başlayamamış). Setup bitişinden o 1 saate (ya da sonraki setup'a) kadarki
  duruşlar nedendir: KSD, STP, KLP, …; molalar ayrı gösterilir. NOK'un ana
  nedeni en çok süre kaybettiren grup; hiç duruş yoksa "sonraki setup geldi".
- Arada üretim olmayan setup kayıtları (vardiya değişimi, mola) tek setup.
- Veri bitmeden sonuç belli değilse "Open".

Gerçek veri (1–25 Eylül):
- PRS: 186 setup → 175 OK, 10 NOK, 1 open. NOK ana nedenleri: KLP 6, KSD 2,
  YNT 1, sonraki setup 1. Setup bitişinden 1 saat üretime medyan 111 dk.
- APR: 656 setup → 258 OK, 398 NOK; 343'ünde neden "sonraki setup geldi"
  (APR'de siparişler kısa, 1 saat dolmadan sıradaki setup başlıyor).

### ~~Haftalık arşiv programın içinde~~ → sürdürülebilir kullanım (2026-09-27, planlamacı)

Planlamacı: "Program sürdürülebilir olmalı. İlk defaya mahsus sene başından
beri Weekly, Monthly, Daily vereceğim; sonra hep son 2 hafta Shiftly KPI,
Downtimes ve Shiftly Order Based KPI yükleyeceğim. Geçmişi silmemeli,
devamına eklemeli, aynı satırı mükerrer kaydetmemeli. Satın alan herkese
basit bir kullanım yöntemi verilmeli. Kodda elle yazılmış değer olmamalı."

Uygulama:
- Programa gömülü Weekly KPI_fix arşivi **kaldırıldı**; geçmiş yalnızca
  yüklenen veriden gelir ve veritabanında birikir.
- Yükleme **silmez**; her satır anahtarıyla eklenir ya da güncellenir:
  vardiya (tarih + iş merkezi + vardiya grubu), gün (tarih + iş merkezi),
  sipariş (tarih + iş merkezi + vardiya + sipariş + ekipman), duruş (iş
  merkezi + başlangıç tarihi/saati + sipariş; gün kaydında birleşir), hafta
  (yıl + hafta + iş merkezi), ay (yıl + ay + iş merkezi).
- Gün tabanı (`oeeDays`): vardiyaların toplamı; vardiyası olmayan günde Daily
  KPI. Hafta / ay = günlerin toplamı; yüklenen Weekly / Monthly satırı daha
  çok Loading kapsıyorsa o (geçmişin başı yalnızca haftalık/aylık olabilir).
- Aylık sayfada yıl yok: dosyadaki en son günlük/vardiya tarihinden çıkarılır.
- Tesise özel bütün değerler **OEE → Settings**'te (docs/fixeddefinitions.md
  29–35). "Suggest from data" verideki kodlardan öneri doldurur.
- Kayıp özeti ham kodlarla saklanır (Reason Code 1 | 2); ayar değişince
  sayfalar yeniden hesaplar, veri değişmez.
- Kullanım yöntemi: **OEE → How to use** sayfası (ilk kurulum, rutin
  yükleme, kontrol, hesap kuralları) ve neyin yüklü olduğu tablosu.

Eski biçimdeki kayıtlar: ilk sürümün kayıp özetleri okunmaz; yılı olmayan
aylık satırlar okunmaz. İlk kurulum yüklemesi aynı günleri/ayları yeniden
yazınca düzelir.

### Settings düzeltmesi (2026-09-28, planlamacı: "Cost center ekleyemiyorum")

- Sebep: ilk sürümle yüklenen veride gün toplamı (`oeeDays`) yoktu; öneri
  masraf yerlerini yalnızca günlerden alıyordu → liste boş kaldı, kullanıcı
  masraf yeri kodlarını alan adı olarak yazdı.
- Öneri artık masraf yerlerini günler + vardiyalar + duruşlardan birlikte
  alır (`dataCostCenters`); alan = makine adının en sık ön eki.
- Eksik gün toplamları ve eski biçim kayıp özetleri OEE sayfaları açılınca
  saklı vardiya/duruşlardan bir kez kurulur (`rebuildStored`, `coverage.needsRebuild`);
  silme yok, tekrar çalışması zararsız.
- Settings adımları: 1 Upload → 2 Suggest from data → 3 Check → 4 Save.
  Masraf yeri elle eklenebilir; veride olup tanımlanmamış kodlar düğme
  olarak çıkar. Alan adı bir masraf yeri koduysa uyarı + "Move to cost
  centers" (kodlar masraf yerine taşınır, alan veriden önerilir).
- Eksik mesajları ayrı: alan yok / masraf yeri yok / alanı olmayan masraf yeri.

### Rutin yükleme dosyası (2026-09-28, planlamacı)

Dosya 5 sekme: **Shiftly KPI**, **Shiftly Order Based KPI**, **Weekly KPI**,
**Monthly KPI**, **Downtimes(1)**. İlk seferde geçmişle birlikte, sonra hep
son 2 hafta.

- Weekly KPI ve Weekly KPI_fix ilk dosyada tek "Weekly KPI" sekmesinde
  birleştirilir (anahtar yıl + hafta + makine, mükerrer yok). Kural: **yeni
  eskiyi ezer** — sonraki yüklemelerde aynı satır gelirse günceller.
- Var olan kayıt atlanmaz, **güncellenir** (sistemdeki düzeltmeler gelsin).
- Duruşlar: dosyada bulunan her gün × makinenin duruşları dosyadakiyle
  **tamamen yenilenir** (saati değişen / bölünen duruş iki kez sayılmasın);
  dosyada olmayan günlere dokunulmaz. → yapıldı (`upsertDowntimeDays`).
- Monthly KPI: **ilk sütun Year**; yıl tahmin edilmez, sütundan okunur. Year
  sütunu yoksa ya da bir satırda boşsa dosya yüklenmez. → yapıldı.
- **Export Pazartesi'den başlar** (planlamacı, 2026-09-28): tarihli her sayfa
  (Shiftly, Daily, Order Based, Downtimes) ilk günü Pazartesi değilse dosya
  **hiç yüklenmez** ve uyarı verilir ("… starts on Tuesday 01.09.2026 —
  export from a Monday (31.08.2026)"). İstisna: 1 Ocak (sene başından geçmiş).
  Sebep: yarım başlayan hafta, kayıtlı tam haftanın üstüne yazılmasın
  (`mondayStartProblem`). → yapıldı.
- Weekly KPI: aynı dosyada iki haftalık sayfa varsa Loading'i büyük olan;
  yüklemeler arasında yeni eskiyi ezer.

### Açıklanmayan duruşlar (2026-09-28, planlamacı)

"#" işaretli duruşlar açıklanmayan duruşlardır: **grafiklerde gösterilmez,
tablolarda kalır**. Kodda "#" yazılı değil: Settings → Loss groups → "In
charts" işareti (`hidden`); öneri "#" grubunu gizli getirir. Bir grafik
sütununun bütün grupları gizliyse sütun grafikten çıkar.

### Dashboard grafikleri (2026-10-02, planlamacı)

OEE değeri her çubuğun üstünde: arka plansız, siyah, kalın, küçük punto,
yüzde işaretsiz tam sayı (ör. 60). Renk `--viz-value` (koyu temada açık).

## Konuşma özeti ve kalıcı kurallar (2026-10-02 itibarıyla)

Yeni bir sohbet bu dosyayla devam edebilsin diye.

**Çalışma kuralları (planlamacı)**
- Yalnızca planningexpert reposunda çalışılır (aksi söylenene kadar).
- Onay beklenmez, iş sonuna kadar tamamlanır; cevaplar kısa ve Türkçe;
  push sonrası "Ctrl+F5" hatırlatılır.
- "Programı düzelt" denince kod düzeltilir ve commit/push yapılır; sadece
  "fikre yorum yap" denirse kod yazılmaz.
- Kodda tesise özel sabit değer ya da koşul olmaz; çıkarsa planlamacıya
  sorulur (programda mı kalsın, kullanıcı mı tanımlasın). OEE'de hepsi
  Settings'te.
- ASAKAI dosyasında talimat dışında iş yapılmaz.
- Şirket mail şifresi/kimlik bilgisi saklanmaz (mail = Outlook .eml taslağı).

**Veri ve yükleme**
- Rutin dosya 5 sekme: Shiftly KPI, Shiftly Order Based KPI, Weekly KPI,
  Monthly KPI (ilk sütun Year), Downtimes(1); hep son 2 hafta,
  **Pazartesi'den** başlar (değilse dosya reddedilir; istisna 1 Ocak).
- Geçmiş silinmez; aynı anahtar gelirse yeni eskiyi ezer; duruşlar dosyadaki
  gün × makine için tamamen yenilenir.
- İlk sürümle yüklenen veride eksik gün toplamları / kayıp özetleri sayfa
  açılınca bir kez kurulur (`rebuildStored`).
- 28.09 ilk yükleme dosyası hazırlandı (OEE_upload_2026-09-28.xlsx):
  Weekly KPI + Weekly KPI_fix birleşik (W36 fix'ten, Weekly KPI'da yarımdı),
  Downtimes 07.09'dan (01–06.09 Pazartesi kuralı için çıkarıldı).

**Settings**
- Adımlar: Upload → Suggest from data → Check → Save. Masraf yerleri
  gün + vardiya + duruştan önerilir; elle eklenebilir; alan adı olarak
  yazılmış masraf yeri kodu "Move to cost centers" ile düzeltilir.
- Loss groups'ta "In charts": "#" (açıklanmayan duruş) grafiklerde gizli,
  tablolarda var. Planlamacı kayıtlı ayarda "#" işaretini bir kez kaldırmalı.

**Hesap**
- Avg setup = presin seçili haftada başlayan setup'larının setup metinli
  duruş dakikaları toplamı ÷ setup adedi (birleşen kayıtlar arasındaki mola
  vb. sayılmaz — istenirse değiştirilecek).

### Dördüncü tur (2026-10-02, planlamacı)

- **APR setup süresi ayrı:** her alanın kendi "setup sonrası üretim" süresi
  var (Settings → Areas, sütun "Production after a setup"); boşsa genel değer
  (Numbers). Öneri makine bazlı alana (APR) **10 dk** yazar — planlamacının
  geçici değeri. İleride parça bazlı setup süresi **Master Data**'da
  tanımlanacak; APR kayıp analizlerinin çözümünü planlamacı bulacak, şimdilik
  dikkate alınmaz.
- **Veri eksikleri ve farklar → yalnızca ekranda bildirim** ("Data notes"):
  - Dashboard: aylık / haftalık trendde verisi olmayan dönem ve o dönemde
    verisi olmayan makine (`trendGaps`).
  - Losses Trend: seçili haftada duruşu yüklenmemiş günler, vardiya verisi
    olmayan duruş günleri, Shiftly KPI ile Downtimes plansız duruş farkı
    (toplam ve en çok fark eden 5 makine; `lossCoverage`). Hesap değişmez.
- planValidator metni sabit "2009/1009" yerine Storage Locations'ta sayılan
  depoları yazar.
- Sistem öncelikli: veriler yenilenebilir; eski MB51 satırları sorun değil.
  Sıradaki iş **plant genişletme** (docs/plant-genisletme.md).

## KPI modülü (2026-10-02)

Ayrıntı ve açık sorular: docs/kpi.md. Gerçekleşen OEE ve (girilmezse) üretim
adedi / saati bu modülün günlerinden okunur.

## Kurumsal yapı: pres → work center (2026-10-03, planlamacı)

"Artık kurumsal yapıya dönüyoruz; sadece pres tanımla diyemeyiz, burası work
center olacak." Ekranlardaki bütün "press / presses" ifadeleri "work center /
work centers" oldu (Press Definitions → Work Center Definitions, hata ve
uyarı metinleri, Planning Logic dahil; "Save'e bas" gibi fiil anlamı
korundu). Veritabanı ve kod adları (`presses` tablosu, `press` alanı) aynı
kaldı — kayıtlı veri değişmedi, geçiş gerekmez. Kayıtlı eski plan gerekçeleri
bir sonraki plan hesabında yeni metinle yazılır.

## Bekleyen konular

- KPI ağırlıklı birleşim (Absenteeism %, Productivity) — docs/kpi.md →
  "Açık notlar", değerlendirilecek.

- ~~Veride eksikler (07–13.09, Ağustos/Eylül, 32–35. haftalar)~~ → veriye
  takılınmaz; ekranda "Data notes" olarak gösterilir.
- Avg setup'a birleşen setup kayıtları arasındaki süre de katılsın mı?
- ~~planValidator "2009/1009" metni~~ → düzeltildi. 3 günlük stok yaşı
  uyarısı program kuralı olarak kaldı.
- Plant genişletme: aşama 1–6 ve 7'nin ilk sürümü uygulandı (2026-10-02,
  docs/plant-genisletme.md → "Uygulama"). OEE verisi ve ayarları fabrika
  başına; karşılaştırma ekranının içeriği konuşulacak.
- Güvenlik (2026-10-02): TanStack Start 1.168.54'teki XSS açığı yüzünden
  1.168.60'a güncellendi.
- ~~MB51 eski satırlar~~ → sorun değil, veriler yenilenebilir.
- ~~APR setup süresi~~ → alan bazlı süre (APR 10 dk). Parça bazlı setup
  süresi Master Data'da — ileride.
- ~~Downtimes / Shiftly plansız duruş farkı~~ → yalnızca ekranda bildirim.

## Alan = bölüm (2026-10-03, K3)

OEE'nin üstteki alan düğmeleri artık plant'in **bölümleridir** (Company
settings → Organization); ayrı OEE alanı tanımlanmaz. Bölümün OEE'si
masraf yerlerinin toplam ÷ toplam OEE'sidir. OEE Settings → Departments:
yalnızca seçim türü ve setup sonrası süre. Eski alan ayarları devralınır.

## Loss Bridge (2026-10-06, planlamacı)

Yeni sayfa **OEE → Loss Bridge** (`/oee/bridge`): seçilen hat ya da makinenin
zamanı takvimden efektif süreye köprü (şelale) olarak; altında OEE dağılımı,
Level 1 / 2 / 3 kayıplar ve öncelik. Komite (metodoloji, veri denetimi,
fabrika müdürü) değerlendirmesi, hesap ve kararlar: **docs/oee-bridge.md**.

- OEE tabanı varsayılan Loading (MES) — köprünün OEE'si Dashboard ile
  birebir aynı. Settings → Loss bridge'den TPM tabanı (Shift time) seçilebilir.
- Settings → Loss groups'a "Bridge family" sütunu eklendi (availability /
  performance; varsayılan availability = MES).
- **Karar 10 ile ilişki:** Losses Trend'de Shiftly–Downtimes farkı hâlâ
  gösterilmiyor. Köprüde ise adımların toplamı tutmak zorunda olduğu için fark
  ayrı ve işaretli bir adımdır: "Not explained" (kayıtlar az) ya da
  "Over-recorded downtime" (kayıtlar fazla). Gruplara dağıtılmaz.
- Örnek veride (Progressive, 21.09) kayıtlı plansız duruşlar Loading −
  Production'dan 167 dk fazla; çalışılmamış vardiyaların "scheduled downtime"
  kayıtları da planlı süreden 480 dk fazla. Nedeni MES sahibine sorulmalı.

## Vardiya tanımı (2026-10-06, planlamacı)

Vardiyalar artık şirket ve plant bazında **Company settings → Shifts**'te
tanımlanır: numara, ad, saatler ve MES kodları (ör. 1 = UB61, UB64). Plant
kendi tanımını yapmazsa şirket standardını kullanır. Tanımda kod varsa OEE
sayfaları vardiyaları bu kodlarla numaralar ve OEE Settings'teki Shifts
kartı salt okunur olur; tanım yoksa eski OEE ayarı geçerli. Loss Bridge'de
vardiya filtresi ve kalıba göre Level 3 (en çok 8 gün, ham duruşlardan):
docs/oee-bridge.md.

## Loss Bridge ikinci tur (2026-10-06, planlamacı)

Köprü artık **Loading time = %100**'den başlayan yüzdesel şelale: plansız
duruş grupları → Availability → hız kaybı → A × P → kalite → OEE. Loading
planlı duruşları zaten dışarıda bıraktığı için köprüde yeniden düşülmezler
(yalnızca "Outside OEE" bilgisi). OEE, A, P, Q Dashboard'la birebir aynı;
OEE + kayıplar = %100. Takvim / TEEP adımları ve OEE Settings'teki TPM
tabanı seçeneği kaldırıldı. Ayrıntı: docs/oee-bridge.md.

## Yeni dosya biçimi: yalnızca Report + Downtimes (2026-10-06, planlamacı)

Planlamacı artık yalnızca iki dosya yükler; Daily / Weekly / Monthly KPI
dışa aktarılmaz (gün, hafta, ay vardiyalardan hesaplanır; daha önce
yüklenen haftalık / aylık satırlar silinmez).

| Dosya → sayfa | Sütunlar (başlıkla bulunur) |
|---|---|
| Report → Shiftly KPI | Date, Plant - Key, Cost Center - Key, Work Center, **Shift Defination** (vardiya kodu UB61 …), **Shift Definition Txt** (ad), GOODQUANTITY, SCRAPQUANTITY, REJECTQUANTITY, Scheduled / Unscheduled Downtime(Min), Net Operating / Net Production / Loading Time(Min), Availability, Quality, Performance, Oee |
| Report → Shiftly Order Based KPI | Date, **Plant - Key**, **Plant** (ad), Work Center, Shift Defination, Order, **Material - Key**, **Var_Equipment** (kalıp; APR / MARK hatlarında boş), süreler, Availability / Quality / Performance / Oee **(Order)** |
| Downtimes → Downtimes (1) | başlık **2. satırda**, A sütunu boş; Date, Plant, Plant - Key, Cost Center - Key, Work Center - Key (Not Compounded), Order Number, MATERIAL, Mold Number, Shift Group (UB), Shift Defination, Reason Code 1–5, Reason Code Defination EN / TR, Stoppage Duration, Stoppage Duration(Min), StartDate, StartTime, EndDate, EndTime |

- Başlık satırı ilk 10 satırda "Date" içeren ilk satırdır.
- Kaldırılan sütunlar (dosyada artık yok): Production Responsible, Shiftly'deki
  Shift Group, Order Based WEEK / TOTAL1, Downtimes formül sütunları (Shift,
  Week, material, min). OEE → Data yalnızca dosyadaki sütunları gösterir.
- Eski biçimde vardiya kodu "Shift Group"taydı; ikisi de okunur, kayıt anahtarı
  aynı (tarih + makine + vardiya kodu), yeni yükleme eskisini günceller.
- **Sipariş anahtarı** tarih + makine + vardiya + sipariş (kalıp anahtardan
  çıktı): eski dosyanın "Equipment" sütununda malzeme kodu vardı; yeni dosya
  aynı siparişi ikinci kayıt eklemeden düzeltir (test).
- Gerçek dosyalar (05.01–06.10.2026): 9.860 vardiya, 15.425 sipariş satırı,
  87.153 duruş (1.505 gün × makine, en büyük kayıt 55 KB); eksik sütun yok.
- Duruş dosyasında ayarlarda olmayabilecek Reason Code 2 kodları: DNM (proje /
  deneme), CLR (TPM / otonom bakım), DEV (yeni operatör eğitimi), SDK (planlı
  duruş). OEE Settings → "Suggest from data" bunları ekler; eklenmezse
  "Unassigned" görünür.

## OEE Trend Analysis (2026-10-07, planlamacı)

Dashboard sayfasının adı **OEE Trend Analysis**. Değişiklikler:

- **Çalışılan vardiya:** haftalık trend ve haftanın vardiya tablosunda başlığın
  (açık gri) hemen altında açık mavi **Shifts worked** satırı, altında Total ve
  presler. Shifts worked = Loading ÷ **net vardiya** = vardiya süresi (Company
  settings → Shifts; saat yoksa 8 saat) − o vardiyanın planlı duruşları
  (Planning → Calendar → Planned stops: çay, yemek, toplantı …). Loading planlı
  duruşları içermediği için bölen de onlarsız olmalı. Haftalıkta vardiyaların
  ortalama net süresi, vardiya tablosunda her sütunun kendi vardiyasınınki.
  Loading saati gösterilmez; aylıkta satır yok. OEE izni olan ama Planning
  izni olmayan kullanıcı planlı duruş sürelerini `oee.plannedStopMinutes` ile okur
  (src/lib/shifts.ts netShiftMinutes, test).
- **Performans çizgisi:** üç grafikte OEE çubuklarının üstünde koyu turuncu
  Performans % çizgisi (aynı yüzde ekseni; renk mavi ile doğrulandı, açık
  #c2410c / koyu #e0642a). Yorum için: OEE 64, P 80 → A × Q ≈ 80.
- Seçilen gün / hafta / önceki hafta / kalite kutuları kaldırıldı.
- **Yükleme tek noktadan:** "Upload data" yalnızca OEE Data sayfasında; Settings
  ve kılavuz oraya bağlantı verir.

## Yalnızca tanımlı iş merkezleri (2026-10-07, planlamacı)

OEE sayfaları (Trend Analysis, Losses Trend, Loss Bridge, Data) yalnızca
**Work Center Definitions'ta tanımlı ve fabrikanın bir masraf yerine bağlı**
iş merkezlerini gösterir ve sayar (OEE, çalışılan vardiya, kayıplar). Süzme
sunucuda, bütün OEE okumalarında aynı kuralla (convex/oee.ts oeeWorkCenters).
Tanımsız iş merkezinin (ör. PRS-103) yüklenen satırları silinmez; tanımlanınca
geçmişiyle görünür. Fabrikada hiç tanım yoksa süzülmez. Yükleme mesajı
saklanıp gösterilmeyen iş merkezlerini yazar. Test: tenancy.test.ts.

## Değişmeyen satır yeniden yazılmaz (2026-10-07, planlamacı)

OEE yüklemesinde (vardiya, gün, sipariş, duruş, kayıp özeti, hafta, ay) saklı
kayıt yeni satırla birebir aynıysa yazma atlanır (src/lib/oeeStore.ts
`sameStored`, convex/oee.ts `upsert`). Aynı dosyayı / aynı günleri tekrar
yüklemek yalnızca okuma harcar; değişen satır her zamanki gibi güncellenir.
Convex Database I/O kotası için (plan hesabının elle yapılmasıyla birlikte).

## Haftanın günleri (2026-10-08, planlamacı)

Trend Analysis'te haftalık trend ile vardiya grafiği arasında **Week Wnn by
day**: seçilen haftanın Pazartesi–Pazar günleri; OEE çubukları, Performans
çizgisi, altında Shifts worked (Loading ÷ ortalama net vardiya), Total ve
presler. Günler gün × iş merkezi kayıtlarından toplam ÷ toplam
(src/lib/oee.ts `weekDailyTrend`; 7 günün toplamı haftayla aynı — test).

## Ham dışa aktarım biçimi: rapor.xlsx (2026-10-13, planlamacı)

Planlamacı sistemden indirdiği dosyayı **olduğu gibi** yükler: tek dosya,
iki sayfa (**Shiftly KPI**, **Downtimes (1)**), ilk satır ve A sütunu boş
(başlık 2. satırda, B sütunundan başlar — zaten okunuyordu).

- Shiftly KPI'da **Oee** sütunu yok: dosyada yoksa A × P × Q ile hesaplanır
  (MES'in tanımı; önceki dosyada 25 bin satırda Oee ile fark 0). Availability,
  Quality, Performance da yoksa sürelerden hesaplanır.
- Downtimes'ta **EndTime** yok: bitiş = başlangıç + süre (saniye), gece
  yarısını geçebilir. Reason Code 3–5 de isteğe bağlı.
- Shiftly Order Based KPI bu dosyada yok; isteğe bağlı (kalıp ve hız analizi
  için), aynı ya da ayrı dosyada yüklenebilir.
- Gerçek dosya (05–13.10.2026): 364 vardiya, 9.221 duruş, eksik sütun yok;
  PRS-106 05.10 UB64 OEE 66,67 (MES ile aynı). Test: src/lib/oee.test.ts.

## Vardiyalar tek yerde: Working calendar (2026-10-13, planlamacı)

"Takvimde zaten vardiya tanımlıyorum, ayrıca plant bilgilerinde istiyorsun":
Company settings → Shifts sekmesi kaldırıldı. Vardiyalar Working calendar'dan:
saatler vardiya süresi ve 1. vardiya başlangıcından (en çok 3), planlı
duruşlar Planned stops'tan, MES kodları (UB61 …) aynı sayfada "Shifts and
planning rules" → **MES shift codes (OEE)** (globalShiftSettings.shiftCodes,
pressCalendar.saveShiftCodes; takvim düzenleme izni). Takvimde kod girilmemişse
eski Company settings → Shifts kodları ve adları kullanılır (kaybolmaz;
src/lib/shifts.ts `calendarShifts`, test). OEE Settings'in Shifts kartı
takvime yönlendirir.

## Aksiyonlar sunumu (2026-10-14, planlamacı)

Sunumdaki 8 slayt (9. boş) ve yapılanlar:

| Slayt | Sayfa | İstek | Yapılan |
|---|---|---|---|
| 1 | Daily Report | Tablo solda sığsın; referansa tıklayınca sağda gün, vardiya, kayıp tipi, detay | Tablo ekranın ~%64'ü (kayıp ve parçaları tek hücrede). Parçaya tıklayınca sağ panel: o parçanın o kayıptaki gün × vardiya × neden satırları (ilk duruş saati, adet, süre), parçanın bütün duruş kayıpları (grup başına) ve diğer duruşları. Hız ve hurda / ret için sipariş satırları. Ham duruşlardan: en çok 8 günlük dönem. |
| 1, 2, 3, 6 | Bütün OEE sayfaları | Filtre belirgin (toz mavi), her sayfada aynı, sayfa değişince kaybolmasın | Ortak filtre çubuğu: toz mavi zemin, kalın etiketler, sayfa kayarken üstte. Alan / masraf yeri, gün, dönem, vardiya, makine tek yerde (`src/lib/oeeFilters.ts`): alan tarayıcıda, diğerleri oturumda kalır. |
| 2 | Trend Analysis | A4 boyutu; A4 print → "GGAAYY OEE TREND" PDF, filtreler görünsün | Sayfa A4 yatay genişliğinde. "Save PDF" (2026-10-16'ya kadar "Print A4"; docs/pdf.md): yalnızca grafikler ve tablolar, A4 yatay, bölümler sayfa arasında bölünmez; başta başlık ve seçili filtreler. Kayıt penceresi "141026 OEE TREND" adıyla açılır. **Tarayıcı dosyayı kendisi masaüstüne yazamaz**: Chrome'da hedef "Save as PDF", klasör bir kez Masaüstü seçilir, sonra hatırlanır. |
| 3 | Losses Trend | Aynı (GGAAYY LOSSES TREND) | Aynı. |
| 4 | Losses Trend | Dies bölümü yeni "Dies OEE Trend" sayfasına; Setup bölümü dar | `/oee/dies` (OEE → Menu): haftanın en kötü kalıpları, en çok hız kaybı ve aynı kalıpların son haftalardaki OEE'si. Setup tabloları içerik kadar geniş. |
| 5 | Losses Trend → Setups | Özet solda, yanında NOK nedenleri; Order No ve Good yok; Main reason yerine STP'nin alt detayı | Özet ve "Why NOK" yan yana. Liste: Press, Setup, Part, **Setup type** (Downtimes metni: DIE SETUP - UNPLANNED, GRIPPER SETUP …; birleşen setup'larda "+" ile), Kind, süre, sonuç (NOK'ta ana nedeni yanında), üretime geçiş, sonrası duruşlar. |
| 6 | Loss Bridge | Göstergeler yarı boy solda, sağda boş "Pay Attention"; köprü eksen yazıları okunur; Level 2 ve Bridge table görünmesin | Dört gösterge sol blokta, altında ince öncelik şeridi; sağda "Pay Attention" (boş, sonra doldurulacak). Eksen yazıları 13 pt, kalın. Level 2 ve köprü tablosu hesapta duruyor, ekranda gizli. |
| 7 | Loss Bridge → yan panel | % of loading / time / stops / MTTR başlığın yanına, kalın; kalemlerde vardiya; kaleme tıklayınca hangi referans ve vardiya | İstatistikler başlığın yanında kutucuklarda, kalın başlıklarla. "By reason" tablosunda **Shift** sütunu (S1 61′ · S3 12′). Kaleme tıklayınca "Hours by part" o kaleme süzülür: parça, makine, vardiya, adet, süre. Ham duruşlardan: en çok 8 günlük dönem. |
| 8 | Yeni: MTTR & MTBF | OEE altında; Losses Trend'deki tablo buraya; ARZ, KLP, STP (kalıp setup planlı / plansız, rulo setup); yıllık (aylar), son 10 hafta, mevcut hafta (günler); MTTR sol, MTBF sağ; min dakika girdi hücresi; < 2, 2–10, > 10 dk kırılımı | `/oee/mttr` (OEE çubuğunda). Üstte haftanın makine tablosu (bütün kategoriler). Kategori düğmeleri (ARZ, KLP: OEE Settings'te "breakdown" işaretli gruplar; STP: setup metinleri seçilir, varsayılan DIE SETUP planlı / plansız ve COIL SETUP). Ekran ikiye: solda MTTR, sağda MTBF; her birinde yıl (aylar), son haftalar, hafta (günler). Filtre çubuğunda **Min. duration (min)**: altındaki duruşlar MTTR / MTBF'e girmez. Altta süre kovaları (< 2, 2–10, ≥ 10 dk): adet, toplam süre, MTTR, MTBF, presler; seçilen haftada parçalar ve vardiyalar. |

Hesap ve veri:

- **MTTR** = duruş dakikası ÷ duruş sayısı; **MTBF** = production time ÷ duruş sayısı (eski tabloyla aynı; eşik 0'da birebir — test).
- MTBF'in payı (net production time) yalnızca **duruş verisi yüklü günlerden** sayılır (2026-10-19): Shiftly KPI'de olup Downtimes'ta olmayan günün üretimi paya girip duruşları paydaya girmediğinde MTBF şişiyordu. Seçilen haftada böyle gün varsa sayfada uyarı çıkar. Filtrenin altında formülleri ve haftanın tablosundan canlı bir örneği gösteren bilgi bloğu; haftanın makine tablosunda **Prod. time** sütunu (MTBF elle doğrulanabilsin).
- Duruş satırı çok (ayda ~30 000): yılın MTTR / MTBF'i için yüklemede gün × iş merkezi başına **süre histogramı** saklanır (`oeeStopDays`: Reason Code 1, 2, metin, tam dakika dilimi → adet, dakika; `src/lib/oeeReliability.ts`). Eşik tam dakikayla: 9.7 dk, 10 dk eşiğinin altındadır; kovalar < 2, 2–< 10, ≥ 10.
- Önceden yüklenmiş veri için histogram, herhangi bir OEE sayfası OEE veri yetkisiyle açılınca bir kez kurulur (yalnızca ekler, hiçbir şey silmez — gün toplamları ve kayıp özetleriyle aynı yol).
- Parça / vardiya ayrıntısı (Daily Report paneli, Bridge vardiya sütunu, kovaların parça ve vardiyası) ham duruşlardan okunur: en çok 8 gün.

## Kısa duruşlar: < 2 dk performans, ≥ 2 dk availability (2026-10-23, Ahmet)

Karar: "2 dk altı duruşları availability değil performans kısmında görüyoruz; hız kayıplarını analiz etmek
için 2 dk altı duruşları, availability etkileri için 2 dk üstünü kullan. Bütün OEE hesaplarında bu
formülasyon olsun."

Doğrulama (fixture, `src/lib/oeeShortStops.test.ts`): **MES bunu zaten yapıyor.** Net Production Time
yalnızca ≥ 2 dk plansız duruşları (UNSCD_DOWN ve "#") düşer: bütün plansız duruşu kayıtlı ve planlı
duruşla çakışmayan 7 vardiyanın hepsinde Loading − Production = ≥ 2 dk duruşların toplamı (0,1 dk
hassasiyetle; örn. PRS-105 3. vardiya 140,6 dk, kısa duruşlar 21,6 dk). Eşik 0, 1 ya da 3 alınınca tutmuyor.
Bu yüzden önerilen A' = (Production + kısa) ÷ Loading mikro duruşları iki kez sayardı → **uygulanmadı.**

Uygulama:
- `ratios()` değişmez: A = Production ÷ Loading, P = Operation ÷ Production MES değerleridir (Dashboard,
  trendler, haftalık / aylık, Daily Report, Board, KPI). Kısa duruşlar zaten P'nin içinde.
- Kayıp ekranları aynı kodu **olay süresine göre** böler (`src/lib/oeeShortStops.ts`): kayıp özeti
  (`oeeLossDays`) süre histogramıyla (`oeeStopDays`, dilim = tam dakika) ikiye ayrılır; kısa duruşlar
  `ARZ<` gibi ayrı Reason Code 2 olur. Loss Bridge: uzunlar availability kalemi; kısalar **köprüde kalem
  değil** (2026-10-26, planlamacı: "2 dk altı görünmesin, ayrı yerde analiz edeceğiz") — hız kaybının
  (Production − Operation) içinde kalır, adım notu dakikasını yazar, analizi MTTR & MTBF süre kovalarında;
  Availability = MES A, kısalar availability'yi ve "Not explained"ı etkilemez (testle denetlenir). Losses
  Trend: "Short stops" sütunu, Speed = Production − Operation − kısa duruşlar. Toplam ve OEE değişmez.
- Eşik tek yerde: OEE Settings → Numbers → *Short-stop limit* (`shortStopMin`, varsayılan
  `MES_SHORT_STOP_MIN` = 2, tam dakika). 2'den farklıysa A / P yine MES'tir (vardiya ve MES haftalık /
  aylık satırlarında süre dağılımı yok, tutarlı kaydırılamaz); yalnız kayıp bölünmesi eşiği izler, ayar ve
  köprü uyarı yazar.
- `lossGroups[].family` ayarı kaldırıldı (alan eski kayıtlar için duruyor, okunmaz): aile süreden gelir.
- Süre histogramı 01.09.2026'dan beri var; öncesindeki gün × iş merkezi bölünmez (eski hesap) ve sayfa
  "Duration split not available before 01.09.2026" yazar.
- Ölçek (01.09–23.10, plansız): < 2 dk 41.454 olay / 18.161 dk; ≥ 2 dk 16.293 olay / 185.880 dk. ARZ
  olaylarının %96'sı mikro duruş, dakikasının üçte biri.
- MTTR / MTBF (2026-10-23, ikinci PR): **≥ eşik olaylar** — arıza ve setup kullanılabilirlik kaybıdır;
  kısa duruşlar sayılsaydı MTTR'yi küçültüp MTBF'i kısaltırdı (ARZ olaylarının %96'sı mikro duruş). Sayfanın
  "Min. duration" alanı varsayılan olarak eşiktir (tarayıcı ayarı `oee-mttr-v2`; elle değiştirilebilir).
  Süre kovaları < eşik / eşik–10 / ≥ 10 dk (`bucketsOf`); kısa duruşlar ilk kovada sayı ve dakikayla görünür.
  MTBF'in payı MES Net Production Time (Loading − ≥ 2 dk duruşlar).
- Agent Report: kalıp ve makine notları ≥ eşik olaylarla; "short stops" notu < eşik. Agent Insights:
  mikro duruş sinyali < eşik olaylar, diğer sinyaller ≥ eşik. Open Topics: aynı kod iki konu (`ARZ`, `ARZ<`).
- Planlı duruşlar (Reason Code 1 = mola: `breakReasonCodes`, ör. SCHED_DOWN — mola, iş yok, try-out,
  SCHED_DOWN YNT) bu ayrıma girmez. Kayıp sayılması Reason Code 1'e bağlı: SCHED_DOWN `lossReasonCodes`'ta
  değilse SCHED_DOWN YNT kayıp değildir (öneri: `#` ve UN… kayıp, diğerleri mola).

## Asakai weekly ve Asakai detail (2026-10-26, planlamacı)

Excel'deki iki sayfanın birebir kopyası, OEE menüsünde; ikisi de A4 yatay **Save PDF**.

- **Asakai weekly** (`/oee/asakai-weekly`): başlık "<ALAN> DAILY FOLLOW UP" + seçili gün. Seçili alanın her
  masraf yeri **bir blok** (ada göre sıralı): üstte yan yana aylık OEE (1–12, seçili aydan sonrası boş), son 10 hafta
  ve haftanın günlerinin yığılı sütunu (OEE + kayıplar, % of Loading); altta tek tablo — iş yeri başına bir satır:
  günlerin OEE'si, haftalık OEE ve haftanın kayıpları; son satır masraf yeri toplamı. Excel'deki yan yana düzen
  (Progressive | Transfer | Detail losses bridge) 30 iş yerli bir masraf yerinde bozulacağı için böyle düzenlendi
  (planlamacı, 2026-10-26): iş yeri sayısı yalnız tabloyu uzatır. PDF çok sayfa, blok sayfa arasında bölünmez.
- **Asakai detail** (`/oee/asakai-detail`): seçili gün, makine başına koyu satır = gün, 1-2-3 = vardiyalar: OEE,
  Loading (dk), kayıp sütunları; sağda günün malzemeleri ve vardiyada "iyi adet - %OEE" (sipariş dosyasından).
  Her iş yerinin gün satırında en büyük 2 duruş kırmızı (`ASAKAI_TOP`, `asakaiTopStops`); Speed duruş değil,
  Unassigned öncelik değil, sayılmaz; vardiya satırları boyanmaz (planlamacı, 2026-10-28).
- Hesap yeni değil (`src/lib/oeeAsakai.ts`): OEE toplam süreden, kayıplar Losses Trend'in `lossBreakdown`'u, vardiya
  kesiti Loss Bridge'in `shiftSlice`'ı, kısa duruşlar ayrılır. Kayıp sütunları OEE Settings'teki grafik sütunları.
- **Sütunlar** (2026-10-26, planlamacı; ~~"#" sütunu~~ → tanımsızlar en sonda UNASSIGNED, aşağıdaki bölüm): tablolar "#" (tanımsız, başlık UNDEFINED) gibi *grafikte gizli* grupları da
  gösterir — 2026-09-28 kararı "grafikte yok, tabloda var"; yığılı grafik göstermez. **UTS** (planlı mola) Asakai'de
  sütun değil (`ASAKAI_DROP`; UTS başka gruplarla aynı sütundaysa o sütun kalır). *Unassigned* = ayarda tanımsız kod;
  yalnız sayfada süresi varsa sütun olur. **Kısa duruşlar** (< 2 dk, MES'in Production − Operation farkının içinde)
  sütun değil, **SPEED_LOSS**'un içinde (planlamacı, 2026-10-26; Loss Bridge'deki gibi, #81) — kendi kodunda (KLP, STP …)
  sayılmaz.
- Excel'den farklar: hız kaybı eksiye düşmez (Production − Operation − kısa duruş, en az 0); gün etiketleri "21.09"
  (Excel'de "00/mm" hatası); gelecek aylar 0% yerine boş.

## Tanımsız duruş = Unassigned, sütun sırası (2026-10-26, planlamacı)

- Reason Code 1 **ya da** Reason Code 2 **"#"** (ya da boş RC2) = duruşu operatör tanımlamamış. Kayıp sayılan böyle
  her duruş **her yerde Unassigned** (`UNASSIGNED`) altında görünür. RC1 "#" her zaman kayıptır (ayarda
  `lossReasonCodes` içinde "#" olmasa bile), planlı duruş sayılmaz; RC2 "#" kendi RC1'i kayıpsa kayıptır.
  Ör. RC1 "#" / RC2 "STP" 30 dk → Unassigned 30 dk, Setup 0.
- Kural **tek yerde**: `src/lib/oee.ts` → `UNDEFINED_RC1`, `isUndefinedRc2`, `isLossRc1`, `isBreakRc1`,
  `classifyLoss` / `classifyLossKey` (rc1 + rc2 → kayıp mı, grup kodu, grafik sütunu). Losses Trend (`lossBreakdown`,
  `subLosses`, `chartGroups`), Loss Bridge ve Level 3, kısa duruş bölmesi, Asakai, Daily Report, Agent Report,
  Agent Insights, Open Topics, MTTR / MTBF parça listeleri bunu kullanır.
- **Kısa duruş** ayrımı aynen çalışır: `#|STP<`, `UNSCD_DOWN|#<` → grup `Unassigned<` → *Short stops* (hız kaybı).
- Özetler ham kodla (`${rc1}|${rc2}`) durur; gruplama okurken yapılır — veri taşıması / şema değişikliği yok.
- 2026-10-07 köprü kararı (~~"#" duruşları hesaptan çıkar~~) **kalktı**: tanımsızlar köprüde *Unassigned* kalemidir
  (öncelik olmaz); "Not explained" o kadar küçülür. OEE ve A / P / Q değişmez (MES süreleri).
- Ayardaki **"#" kayıp grubu kullanılmaz** (silinmez; OEE Settings → Loss groups'ta "not used, shown as Unassigned"
  yazar). Asakai'deki ~~"#" sütunu (UNDEFINED)~~ → **UNASSIGNED** sütunu. "Suggest from data" "#" grubu önermez.
- OEE Settings → Reason Code 1 kartında "#" seçilemez (sabit: *Loss — not defined by the operator*); Unassigned
  "ayarda tanımsız kod" önerisine (Loss groups uyarısı) girmez.
- **Sütun sırası** her sayfada aynı (`chartGroups`): ayardaki kayıp grubu sırası (OEE Settings → Loss groups,
  satır başına ↑ ↓; `moveLossGroup`), sonra Short stops, sonra Speed, **en sonda Unassigned**. Planlamacının
  istediği sıra STP, KLP, ARZ, KSD, OFC, KON, YNT — canlı ayarda ↑ ↓ ile verilir (koddan değiştirilmedi).
  "Suggest from data" ayardaki sırayı korur, yeni kodları sona ekler.

### Doğrulama: Asakai detail 23.10 PRS-110 vardiya 2, KLP %239 (2026-10-26)

- Canlı: Loading 144 dk, KLP ≈ 344 dk, KON %45; gün satırı da %239; vardiya 1 ve 3 Loading 0. Excel: die %80, others %21.
- Fixture'da (yalnız 21.09 duruşları) aynı örüntü: **MES Loading, vardiya süresi − planlı duruştan kısa** olan
  vardiyalarda kayıtlı plansız duruş Loading − Production'ı aşar. 21.09 PRS-104 vardiya 1: Loading 185,7 + planlı
  209,3 = 395 / 480 dk; kayıtlı plansız duruş 191,5 dk (MES Unscheduled 193,1 ile aynı) → %103 of Loading;
  fark ≈ 85 dk = 480 − 395. PRS-109 v2 (445 / 480; fark 34,4 ≈ 35) ve PRS-108 v3 de böyle (`oeeBridge.test.ts`).
- Kod hatası **bulunmadı**: duruşların vardiyası doğru eşleşiyor (her vardiyada kayıtlı planlı duruş = MES
  Scheduled, kuruşu kuruşuna); MES duruşları vardiya sınırında bölüyor (14:59:59 / 15:00:00), vardiyayı aşan tek
  duruş yok; gün satırı vardiya 2 ile aynı olduğuna göre Loading'i 0 olan vardiyaların kaybı güne eklenmiyor.
  Neden veri: MES Loading vardiyanın bir kısmını (büyük olasılıkla siparişsiz / oturum açılmamış süre) dışarıda
  bırakıyor, o süredeki duruşlar Downtimes'ta kalıyor. **Düzeltme yapılmadı.**
- Excel'in %80'i 344 ÷ ≈ 430 dk'ya (vardiya − planlı duruş) uyuyor: Excel paydası MES Loading değil olabilir —
  Excel formülüyle doğrulanmalı (açık soru). Köprü fazlayı "Over-recorded downtime" adımında gösterir.

## Tekrar satır kuralı ve Check duplicates (2026-10-26, planlamacı)

Bağlam: canlı Asakai'de 23.10 PRS-110 vardiya 2 KLP Excel'in ≈3 katı görünüyordu; planlamacı farkın
Excel hatası olduğunu doğruladı (site doğru). Karar **önleme amaçlı**:

- **Duruş:** aynı makine (Work Center) + aynı başlangıç (StartDate + StartTime) + aynı bitiş
  (EndDate + EndTime) = aynı duruş, tek satır. Sipariş anahtara girmez (önceki kimlik: başlangıç +
  sipariş). Yeni yüklenen eskisinin yerine geçer: dosyanın içinde son satır, saklı veride önceki /
  sonraki günün (± 1) kaydında kalan eski kopya silinir. Başlangıç ya da bitiş saati olmayan satır
  ayıklanmaz. Etkilenen günlerin kayıp özeti (`oeeLossDays`, parça kırılımı dahil) ve süre histogramı
  (`oeeStopDays`) yeniden hesaplanır.
- **Vardiya (Shiftly KPI):** aynı gün + vardiya (Shift Group) + makine — yükleme bu anahtarla zaten
  üzerine yazıyordu. Artık anahtarda birden çok kayıt bulunursa ilki güncellenir, fazlası silinir;
  gün toplamı (`oeeDays`) aynı kuralla tek kayıt.
- **Check duplicates** (OEE Data, `oee.data` düzenleme yetkisi): bütün saklı duruş ve vardiya
  satırlarını sayfa sayfa tarar (duruş 20, vardiya 150 kayıt / çağrı), bulunanı gösterir (satır,
  dakika, gün × makine, fazla özet kaydı); onaylanınca siler ve özetleri yeniden hesaplar. Yalnız
  seçili fabrika. Aynı gün × makinenin fazla kaydı bütünüyle silinir (yükleme hep ilk kaydı
  yeniler); iki günde aynı duruş varsa sonraki günün kaydı kalır.
- Kod: kural `src/lib/oeeDedup.ts` (testli: 3 kez yüklenmiş 115 dk KLP → 1 satır, 115 dk), sunucu
  `convex/oee.ts` (`upsertDowntimeDays`, `upsertShifts`, `duplicates`). Şema değişmedi.
