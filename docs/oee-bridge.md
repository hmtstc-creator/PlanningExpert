# OEE Loss Bridge — kavram (2026-10-06)

İstek (planlamacı, 2026-10-06): OEE modülünde yeni sayfa — seçilen makinenin
ya da hattın OEE'si ve kayıpları, örnek görseldeki gibi köprü (bridge)
mantığında: A Toplam süre → planlanmamış → B planlı süre → availability
kayıpları → C → performans → D → kalite → E efektif süre; altında OEE
dağılımı, Level 1 / 2 / 3 kayıp dağılımı ve öncelik. Önce komite, sonra
kavram, sonra program, test, açık konuların çözümü.

## Komite

Üç bağımsız inceleme (birbirinden habersiz):

| Rol | Odak |
|---|---|
| OEE / TPM metodoloji uzmanı | Görseldeki tanımlar ile şirketin tanımları, hesap yöntemi, öncelik kuralı |
| Veri ve hesap denetçisi | Her çubuğun hangi alandan geldiği, mutabakat, veri boyutu, riskler |
| Fabrika müdürü | Toplantıda (Asakai / QRQC) hangi kararı destekler, ekran düzeni, güveni ne bozar |

## Örneğin değerlendirmesi — şirketle farklar

| Konu | Görsel (TPM) | Bu şirketin verisi (MES) | Karar |
|---|---|---|---|
| OEE tabanı B | Planlı süre (molalar, setup, planlı bakım kayıp) | **Loading** = vardiya − planlı duruş; molalar OEE dışında | Şirket seçer (OEE Settings → Loss bridge): **Loading (MES, varsayılan)** ya da **Shift time (TPM)**. Varsayılanda köprünün OEE'si OEE Dashboard ile birebir aynı (test). TPM tabanında tile "OEE (shift-time base)" olur, MES OEE yanında yazar. **İkinci turda kaldırıldı: taban her zaman Loading.** |
| Kısa duruşlar | Performans kaybı | MES Production'dan yalnızca ≥ 2 dk duruşları düşer; kısalar Production − Operation içinde | **Süreye göre** (2026-10-23): plansız duruş < eşik (OEE Settings, 2 dk) performans kalemi ("Machine < 2 min"), ≥ eşik availability; aynı kod ikiye bölünür. Eski "köprü ailesi" ayarı kaldırıldı. → `docs/oeedashboard.md` son bölüm |
| Kalite | Proses hatası, verim kaybı (süre) | Adet: Good / Scrap / Reject; dosyada şimdiye kadar hep %100. KON ("quality") bir **duruş** grubudur | Kalite süresi = Operation × (Scrap+Reject) ÷ (Good+Scrap+Reject), Scrap ve Reject adede göre ayrılır. KON availability'de kalır (çift sayılmaz). |
| Planlanmamış süre | Yasal, felaket, kapasite fazlası, deneme | Bu nedenler veride yok | Takvim − vardiya süresi: **resmi tatil günleri** (plant ülkesinin tatil listesi), **vardiyasız günler** (hafta sonu, talep yok, makine kullanılmadı), **vardiya dışı saatler**. Eksik yükleme de "vardiyasız" görünür → veri notu. **İkinci turda kaldırıldı** (köprü Loading'den başlar). |
| Performans > %100 | — | 57 vardiyada (en çok %134,5); planlamacı "olduğu gibi" dedi | Hız kaybı işaretli: negatifse "Speed above standard" adımı, 0'a kırpılmaz. |

## İkinci tur: yüzdesel köprü, taban her zaman Loading (2026-10-06)

Planlamacı ilk sürümü "hatalı, bir şey anlatmıyor" diye geri çevirdi:
yüzdesel görmek istiyor; MES'in **Loading time'ı planlı duruşları zaten
dışarıda bırakıyor**, köprüde planlıları yeniden düşmek saçma. Beklenti:
OEE %64, performans %80 ise availability ~%80'dir ve bu plansız duruşların
etkisidir; OEE'nin üstüne kayıpların yüzde dağılımı konunca %100 bulunmalı,
küçük farklar normaldir.

Bu yüzden ilk turun takvim (A, TEEP, tatil, vardiyasız gün) ve TPM tabanı
(Shift time, OEE Settings → Loss bridge) kaldırıldı. Köprü:

| Adım | Formül (Loading'in %'si) |
|---|---|
| Loading time | %100 (planlı duruşlar zaten dışında) |
| − Plansız duruş grupları | grafik sütunu başına kayıtlı dakika ÷ Loading, büyükten küçüğe |
| − Fark | (Loading − Production) − kayıtlı duruşlar: "Not explained" ya da "Over-recorded downtime"; gri, gruplara dağıtılmaz |
| = Availability | Production ÷ Loading (Dashboard'daki A) |
| − Kısa duruşlar (< 2 dk, kod başına) ve Speed loss | kısa duruş dakikası ÷ Loading; Speed = (Production − Operation − kısa duruşlar) ÷ Loading; toplamları A × (1 − P) |
| = A × P | Operation ÷ Loading |
| − Scrap / Reject | Operation × (1 − Q) ÷ Loading, adede göre ayrılır |
| = OEE | Effective ÷ Loading = A × P × Q (Dashboard'daki OEE) |

Örnek (test): A %80, P %80 → OEE %64; availability kaybı %20, performans
kaybı %80 × %20 = %16; OEE + kayıplar = %100. Kutular OEE, A, P, Q (önceki
döneme fark) ve öncelik. Planlı duruşlar köprünün altında "Outside OEE"
bilgisi olarak saatle yazılır, köprüye girmez.

**Level 1** (Loading'in payları, toplamı %100): OEE, availability kaybı
(1 − A), performans kaybı (A × (1 − P)), kalite kaybı (A × P × (1 − Q)).

**Level 2**: kayıp kalemleri, çoktan aza, % of loading.

**Öncelik**: en çok dakikalı kalem. Öncelik **olamaz**: Not explained,
tanımsız (Unassigned), gizli gruplar, hız kazancı ve planlı duruşlar (mola ve planlı toplantı
yönetimin planıdır ve OEE dışındadır). Sıklık önceliği belirlemez; karşı önlemi seçmek için Level 3'te
adet × MTTR gösterilir (çok kısa duruş → kaizen / otonom bakım; az uzun
duruş → planlı bakım / kalıp tamiri; setup → adet × ortalama süre).

**Level 3**: seçilen kalemin ilk 5'i + "Others":
- kayıtlı duruş kalemleri: nedene (duruş metni) ya da makineye göre, adet, MTTR,
- Speed: kalıba (Order Based: Production − Operation) ya da makineye göre;
  sipariş verisinin kapsamadığı kısım "Not in order data",
- Scrap / Reject: kalemin süresi adede göre kalıba ya da makineye dağılır,
- Not explained / Other planned stops: makine başına fark (hangi makine
  nedenini yazmıyor).
Satırların toplamı her zaman Level 2 kalemine eşit (test). Her satırda
önceki dönem: aralık bir takvim ayının tamamıysa önceki ayın tamamı,
diğerlerinde hemen önceki eşit dönem (tek gün ↔ önceki gün);
önceki dönem ilk yüklenen günden önce başlıyorsa karşılaştırma yok.

## Ekran

1. Başlık, bilgi (tanımlar, "Dashboard ile aynı OEE" kuralı), ilgili sayfalar, Save PDF (A3).
2. Seçim: alan → hat / makine (OEE sayfalarıyla ortak, hatırlanır) + hatta
   tek makine; dönem: **Single day** ya da **Date range** (en çok 31 gün;
   planlamacı 2026-10-07: hazır dönemler yerine). Varsayılan son yüklenen
   gün; dönem son yüklenen güne kırpılır.
3. Göstergeler (planlamacı, 2026-10-13): OEE, Availability, Performance,
   Quality hız göstergesi gibi 180° yarım dairede (önceki döneme göre fark);
   altlarında süreler — OEE: Loading ve Effective; A: Production ÷ Loading;
   P: Operation ÷ Production; Q: Effective ÷ Operation. Yanında ÖNCELİK.
4. Köprü (% of loading; ipucunda saat ve dakika), renkler: toplamlar mavi,
   availability turuncu, kayıt–MES farkı gri, performans mor, kalite pembe,
   OEE yeşil; toplam çubuklarında A / P / Q. Altında "Outside OEE" planlı
   duruşlar (bilgi). Köprü geniş ekranda yarım genişlikte; tıklanan adımın
   ayrıntısı hemen sağında (planlamacı, 2026-10-13).
5. Ayrıntı paneli: adımın payı, süresi, duruş sayısı, MTTR; Level 3 ilk 8 +
   diğerleri (nedene / makineye / parçaya göre), önceki dönem; "Hours by part
   (MATERIAL)" kısa listesi (hangi parçadan kaç saat); aksiyon bağlantısı
   (kalıp problemleri, makine arızaları, Losses Trend).
6. Level 2 (öncelik işaretli, tıklanınca panel o kalemi gösterir). "OEE
   deployment" ve "Level 1" sütunları kaldırıldı (2026-10-13).
7. Veri notları ve köprü tablosu.

Telefonda köprü yatay çubuklara döner (12+ adım 360 px'e sığmaz).

## Kapsam dışı / bilinen sınırlar

- **Vardiya filtresi en çok 8 gün:** duruş özetleri (`oeeLossDays`)
  vardiyayı tutmuyor; vardiya seçilince köprü ham duruşlardan
  (`oeeDowntimeDays`, vardiya kodu Shift Definition / Shift Group) ve vardiya
  kayıtlarından (`oeeShifts`) kurulur. Bu yüzden dönem 8 günü geçince vardiya
  seçimi kapanır. Parça kırılımı ise özetin `partList`'inden gelir, her dönemde
  çalışır (eski özetlerde ham duruşlardan, en çok 8 gün). Vardiyada planlanmamış süre (takvim) gösterilmez; vardiyaların
  toplamı tüm güne eşittir (test).
- MES'in plansız duruş toplamı (Unscheduled) ile duruş kayıtları neden
  tutmuyor — MES sahibine sorulmalı (açık konu, docs/oeedashboard.md karar 10).
  Köprüde fark görünür kalır; Losses Trend'de değişen bir şey yok.

## Uygulama denetimi (2026-10-06)

Program bittikten sonra veri denetçisi uygulamayı kendi bulgularına göre
denetledi: engelleyici hata yok (köprü her durumda kapanıyor, Loading
tabanında OEE Dashboard ile aynı). Düzeltilenler: çalışılmamış vardiya
kaydı planlı duruşu şişiriyordu → sınırlandı, planlanmamış süreye taşındı;
kalite Level 3'ü Level 2 ile tutmayabilirdi → süre adede göre dağıtılıyor;
kalıp kırılımında sipariş verisi olmayan kısım ayrı satır; gizlenmemiş "#"
öncelik olabiliyordu → olamaz; gizli gruplar "Not explained" sayılıyordu →
kendi kalemi; ay karşılaştırması takvim ayına hizalandı; Pazartesi / ayın
1'i boş dönem; seçim değişince makine filtresi; yarım önceki dönem; ülkesi
olmayan plant uyarısı; A/P "bridge split" etiketi. Hepsi testli
(src/lib/oeeBridge.test.ts).

## Vardiya tanımı ve vardiya filtresi (2026-10-06)

İstek: vardiya sistemi firma ve plant bazında kurulabilsin; ör. 1-2-3
vardiyaları MES'te UB61-62-63 gibi kodlarla gelir, bu eşleme vardiya
tanımında standartlansın.

- **Company settings → Shifts:** şirket standardı (No., ad, başlangıç /
  bitiş, MES kodları virgülle) ve her plant için "Company standard" ya da
  "Own shifts". Bir kod tek vardiyaya ait olabilir, numara 1–9. Kayıt
  denetim kaydına yazılır (`company.shifts`, `plant.shifts`); yalnızca şirket
  yöneticisi değiştirir (src/lib/shifts.ts, convex/platform.ts).
- **OEE:** plant'in geçerli tanımında kod varsa OEE sayfaları vardiyaları bu
  kodlarla numaralar; OEE Settings'teki Shifts kartı salt okunur olur ve
  Company settings'e yönlendirir. Tanım yoksa eski OEE ayarı geçerlidir.
- **Loss Bridge:** vardiya seçimi (adlar tanımdan) ve Level 3'te duruş
  kalemleri için kalıba göre kırılım (adet ve MTTR ile), en çok 8 günlük dönem.

## "#" duruşları hesaptan çıkar (2026-10-07, planlamacı)

> ~~Reason Code 1 ya da 2'si "#"~~ → yalnız **Reason Code 2 "#"** (2026-10-26): Reason Code 1 "#"
> artık kayıptır ve **Unassigned** kalemine girer (`classifyLoss`, `src/lib/oee.ts`;
> ayrıntı `docs/oeedashboard.md` → *Reason Code 1 "#" = Unassigned*).

Reason Code 1 ya da 2'si "#" olan (tanımsız) duruşlar köprünün hiçbir
kalemine, Level 3'e, parça ve vardiya kırılımına girmez
(src/lib/oeeBridge.ts `isUndefinedCode`). OEE ve A / P / Q MES sürelerinden
geldiği için değişmez; bu dakikalar Loading − Production'ın içinde
olduğundan gri "Not explained / Over-recorded" fark adımında kalır, köprü
yine kapanır. Veri notu kaç dakikanın dışarıda kaldığını yazar.

## Level 3: kalıp değil parça (2026-10-13, planlamacı)

"By die" görünümü **By part** oldu: duruş kalemleri ham duruşun **MATERIAL**
sütununa (Mold Number değil), hız kaybı ve hurda / ret siparişin **Material -
Key**'ine göre kırılır. Parça adları planlamadaki parça (malzeme) kodlarıyla
aynıdır. MATERIAL "#" ya da boşsa "(no part)". Satırın altında makine yazar.

Duruş özetleri (`oeeLossDays.partList`: [rc1, rc2, MATERIAL, dakika, adet])
parça kırılımını da tutar, böylece "hangi parçadan kaç saat" 31 günlük
aralıkta da görünür (ham duruşlar en çok 8 gün okunur). Eski özetler bir
kerelik "rebuild" adımıyla (OEE sayfası açılınca otomatik, `rebuildStored`
'losses') ya da dosya yeniden yüklenince tamamlanır; hiçbir şey silinmez.


## OEE Daily Report (2026-10-13, planlamacı)

Yeni sayfa **OEE → Daily Report** (`/oee/report`): tek sayfada, seçimin her
iş yeri için bir satır ve en altta toplam:

| Work center | OEE (A · P · Q) | Loss 1 | Materials | Loss 2 | Materials | Loss 3 | Materials | Speed loss | Materials |

- Filtreler Loss Bridge'inkiler (ortak `OeePeriodControl`): masraf yeri /
  alan, tek gün ya da tarih aralığı (en çok 31 gün), vardiya (en çok 8 gün),
  makine. Önceki dönemle karşılaştırma yok.
- Hesap köprüyle aynı (`src/lib/oeeDailyReport.ts`, test edilir): satırın
  OEE'si iş yerinin köprüsünün OEE'si; kayıplar Loading'in yüzdesi ve saat.
- **En büyük 3 kayıp**: öncelik olabilecek kalemler (duruş grupları, hurda,
  ret), çoktan aza; açıklanmayan fark ve hız kaybı değil — hız kaybının kendi
  sütunu var.
- **Materials**: kaybın parça kırılımının (Level 3 "By part") ilk 3'ü, saatle;
  toplam satırında malzemenin yanında iş yeri yazar. Sipariş verisinin
  kapsamadığı hız kaybı "Not in order data".
- Save PDF (A3) düğmesi sayfayı PDF yapar (`GGAAYY OEE LOSS BRIDGE`; docs/pdf.md).

## Trend Analysis'ten Loss Bridge'e (2026-10-13, planlamacı)

Trend Analysis'teki dört grafiğin (aylık, haftalık, haftanın günleri,
vardiyalar) sütununa tıklayınca Loss Bridge o sütunun dönemiyle açılır;
filtre yeniden kurulmaz:

- ay → ayın tamamı (tarih aralığı), hafta → Pazartesi–Pazar, gün → tek gün,
  vardiya → o gün ve o vardiya,
- alan / masraf yeri seçimi sayfalar arasında zaten ortak (tarayıcıda saklı),
- dönem URL'de: `/oee/bridge?from=2026-09-21&to=2026-09-27&shift=2`
  (`periodOfPoint`, `parsePeriodLink`; testli). Daily Report da aynı
  parametreleri okur. Loss Bridge'i açma izni olmayana sütun tıklanmaz.

## Parça saatinden Die Follow-up'a (2026-10-13, planlamacı)

Ayrıntı panelindeki "Hours by part (MATERIAL)" saatleri düğmedir (parça
görünümünde tabloda "+ Follow up"). Tıklayınca açılan pencere:

- hazır gelir: parça (MATERIAL), pres (iş yeri), kayıp kalemi, süre ve duruş
  tarihi — dönemde birden çok gün varsa en çok duruşun olduğu gün; diğer
  günler tek tıkla seçilir (`partDays`, günlerin toplamı satıra eşit, testli),
- seçilir: operasyon (OEE verisinde yok → "Not known" = "—") ve problem tipi
  (kayıp kalemi listede yoksa başa eklenir),
- **Action** zorunlu: kaydetmeden önce yapılacak iş yazılır,
- Save → Die Problems'ta açık problem (`moldProblems.press`, `.action`
  isteğe bağlı alanlar; listede pres ve "Action" kutusu görünür).

Düğme yalnızca Die Problems ya da Plan düzenleme izni olana çıkar; parçasız
"(no part)", "Not in order data" ve "Others" satırları eklenmez.

## Neden × parça saatinden ve Daily Report'tan Die Follow-up'a (2026-10-16, planlamacı)

Aynı pencere iki yerden daha açılır; süreler aynı mavi düğme (`FollowUpTime`):

- **Loss Bridge**, "By reason" görünümünde bir nedene tıklayınca çıkan
  "Hours by part (MATERIAL) · <neden>" tablosunun **Time** sütunu: parça, iş
  yeri, kayıp kalemi, neden ve vardiya hazır gelir; duruş günleri satırın
  kendi duruşlarından (`reasonShiftParts` → `days`, günlerin toplamı satıra
  eşit, testli).
- **OEE Daily Report** sağ paneli, "Where and when" ve "Other downtimes of
  this part" tablolarının **Time** sütunu: parça, iş yeri, satırın kayıp
  grubu, nedeni, vardiyası, günü ve süresi hazır gelir; açıklama
  "OEE Daily Report: …" ile başlar.

İzin ve kurallar yukarıdakiyle aynı: yalnızca Die Problems ya da Plan
düzenleme izni olana; "(no part)" satırları eklenmez; Action zorunlu.
