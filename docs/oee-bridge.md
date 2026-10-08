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
| Kısa duruşlar | Performans kaybı | KSD duruş olarak kayıtlı → Loading − Production içinde (availability) | Her kayıp grubunun **köprü ailesi** ayarda: availability (varsayılan, MES gibi) ya da performance. Aile değişince OEE değişmez, yalnızca A/P payı. |
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
| − Speed loss (+ performans ailesindeki gruplar) | (Production − Operation) ÷ Loading = A × (1 − P) |
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

1. Başlık, bilgi (tanımlar, "Dashboard ile aynı OEE" kuralı), ilgili sayfalar, A3 yazdır.
2. Seçim: alan → hat / makine (OEE sayfalarıyla ortak, hatırlanır) + hatta
   tek makine; dönem: **Single day** ya da **Date range** (en çok 31 gün;
   planlamacı 2026-10-07: hazır dönemler yerine). Varsayılan son yüklenen
   gün; dönem son yüklenen güne kırpılır.
3. Kutular: OEE, Availability, Performance, Quality (önceki döneme göre
   fark, kaybın Loading'e payı), ÖNCELİK kalemi.
4. Köprü (% of loading; ipucunda saat ve dakika), renkler: toplamlar mavi,
   availability turuncu, kayıt–MES farkı gri, performans mor, kalite pembe,
   OEE yeşil; toplam çubuklarında A / P / Q. Altında "Outside OEE" planlı
   duruşlar (bilgi). Tıklanan kayıp Level 3'ü açar.
5. OEE dağılımı · Level 1 · Level 2 (öncelik işaretli, tıklanır).
6. Level 3: ilk 5 + diğerleri, önceki dönem, aksiyon bağlantısı (kalıp
   problemleri, makine arızaları, Losses Trend).
7. Veri notları ve köprü tablosu.

Telefonda köprü yatay çubuklara döner (12+ adım 360 px'e sığmaz).

## Kapsam dışı / bilinen sınırlar

- **Vardiya filtresi ve kalıp kırılımı en çok 8 gün:** duruş özetleri
  (`oeeLossDays`) vardiyayı ve kalıbı tutmuyor; vardiya seçilince ya da
  "By die" görünümünde köprü ham duruşlardan (`oeeDowntimeDays`, vardiya
  kodu Shift Definition / Shift Group, kalıp Mold) ve vardiya kayıtlarından
  (`oeeShifts`) kurulur. Bu yüzden dönem 8 günü geçince vardiya seçimi
  kapanır. Vardiyada planlanmamış süre (takvim) gösterilmez; vardiyaların
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

Reason Code 1 ya da 2'si "#" olan (tanımsız) duruşlar köprünün hiçbir
kalemine, Level 3'e, kalıp ve vardiya kırılımına girmez
(src/lib/oeeBridge.ts `isUndefinedCode`). OEE ve A / P / Q MES sürelerinden
geldiği için değişmez; bu dakikalar Loading − Production'ın içinde
olduğundan gri "Not explained / Over-recorded" fark adımında kalır, köprü
yine kapanır. Veri notu kaç dakikanın dışarıda kaldığını yazar.
