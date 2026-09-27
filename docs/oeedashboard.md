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

## Kararlar

(henüz yok)
