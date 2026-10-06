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
| OEE tabanı B | Planlı süre (molalar, setup, planlı bakım kayıp) | **Loading** = vardiya − planlı duruş; molalar OEE dışında | Şirket seçer (OEE Settings → Loss bridge): **Loading (MES, varsayılan)** ya da **Shift time (TPM)**. Varsayılanda köprünün OEE'si OEE Dashboard ile birebir aynı (test). TPM tabanında tile "OEE (shift-time base)" olur, MES OEE yanında yazar. |
| Kısa duruşlar | Performans kaybı | KSD duruş olarak kayıtlı → Loading − Production içinde (availability) | Her kayıp grubunun **köprü ailesi** ayarda: availability (varsayılan, MES gibi) ya da performance. Aile değişince OEE değişmez, yalnızca A/P payı. |
| Kalite | Proses hatası, verim kaybı (süre) | Adet: Good / Scrap / Reject; dosyada şimdiye kadar hep %100. KON ("quality") bir **duruş** grubudur | Kalite süresi = Operation × (Scrap+Reject) ÷ (Good+Scrap+Reject), Scrap ve Reject adede göre ayrılır. KON availability'de kalır (çift sayılmaz). |
| Planlanmamış süre | Yasal, felaket, kapasite fazlası, deneme | Bu nedenler veride yok | Takvim − vardiya süresi: **resmi tatil günleri** (plant ülkesinin tatil listesi), **vardiyasız günler** (hafta sonu, talep yok, makine kullanılmadı), **vardiya dışı saatler**. Eksik yükleme de "vardiyasız" görünür → veri notu. |
| Performans > %100 | — | 57 vardiyada (en çok %134,5); planlamacı "olduğu gibi" dedi | Hız kaybı işaretli: negatifse "Speed above standard" adımı, 0'a kırpılmaz. |

## Hesap (her çubuk)

Seçilen kapsam (alan → hat / makine, isteğe bağlı makine) ve dönem için
gün × makine kayıtları (`oeeDays`) **toplanır**, sonra bölünür. Duruş
özetleri (`oeeLossDays`) yalnızca vardiya verisi olan gün × makinede sayılır.

| Adım | Formül |
|---|---|
| A Calendar time | gün × 1440 × makine (tanımlı iş merkezleri ∪ verideki) |
| − Official holidays / Days without shift / Hours without shift | vardiyası olmayan tatil günleri / diğer günler / A − kalan |
| Shift time | Loading + Scheduled downtime |
| − Planned stops | Reason Code 1 = mola/planlı (Settings) duruşları, grup başına; fark "Other planned stops" (işaretli) |
| Loading time | Loading — **B (MES tabanı)** |
| − Availability kayıpları | Reason Code 1 = kayıp duruşları, grafik sütunu (Settings → Chart column) başına, ailesi availability olanlar |
| − Not explained | (Loading − Production) − kayıtlı görünür duruşlar. Gizli "#" grubu ve kaydı olmayan süre burada. Negatifse "Recorded beyond Loading − Production". **Hiçbir zaman gruplara dağıtılmaz.** |
| Production time | Production + performans ailesine alınan grupların süresi — **C** |
| − Performans | Performans ailesindeki gruplar; Speed loss = Production − Operation (işaretli) |
| Operation time | Operation — **D** |
| − Quality | Scrap, Reject (adetten süreye) |
| Effective time | Operation × Quality — **E** |

OEE = E ÷ B, TEEP = E ÷ A, Availability = C ÷ B, Performance = D ÷ C,
Quality = E ÷ D. Köprü her zaman kapanır: A − Σkayıp = E (test).

**Level 1** (OEE tabanının payları, toplamı %100): OEE = E/B, availability
kaybı = (B − C)/B, performans kaybı = (C − D)/B, kalite kaybı = (D − E)/B.
1 − A, 1 − P, 1 − Q gösterilmez (toplamı tutmaz).

**Level 2**: OEE tabanındaki kalemler, dakikaya göre çoktan aza, % of B.
Loading tabanında planlı duruşlar ayrı listede (OEE dışında, bilgi).

**Öncelik**: en çok dakikalı kalem. Öncelik **olamaz**: Not explained,
tanımsız (Unassigned), gizli gruplar, hız kazancı ve planlı duruşlar (her iki
tabanda: mola ve planlı toplantı yönetimin planıdır, kaizen hedefi değil —
TPM tabanında Level 2'de görünürler). Sıklık önceliği belirlemez; karşı önlemi seçmek için Level 3'te
adet × MTTR gösterilir (çok kısa duruş → kaizen / otonom bakım; az uzun
duruş → planlı bakım / kalıp tamiri; setup → adet × ortalama süre).

**Level 3**: seçilen kalemin ilk 5'i + "Others":
- kayıtlı duruş kalemleri: nedene (duruş metni) ya da makineye göre, adet, MTTR,
- Speed: kalıba (Order Based: Production − Operation) ya da makineye göre,
- Scrap / Reject: kalıba ya da makineye göre,
- Not explained: makine başına (hangi makine nedenini yazmıyor).
Her satırda önceki eşit dönem.

## Ekran

1. Başlık, bilgi (tanımlar, "Dashboard ile aynı OEE" kuralı), ilgili sayfalar, A3 yazdır.
2. Seçim: alan → hat / makine (OEE sayfalarıyla ortak, hatırlanır) + hatta
   tek makine; dönem: Yesterday, This week, Last week, This month, Last
   month, Custom (en çok 62 gün). Dönem son yüklenen güne kırpılır.
3. Kutular: OEE (önceki döneme göre fark), TEEP, Loading saati, ÖNCELİK kalemi.
4. Köprü (saat; her kayıpta % of B), aile renkleri: süreler mavi,
   availability turuncu (planlı duruş taralı), performans mor, kalite pembe,
   efektif yeşil, planlanmamış gri. Tıklanan kayıp Level 3'ü açar.
5. OEE dağılımı · Level 1 · Level 2 (öncelik işaretli, tıklanır).
6. Level 3: ilk 5 + diğerleri, önceki dönem, aksiyon bağlantısı (kalıp
   problemleri, makine arızaları, Losses Trend).
7. Veri notları ve köprü tablosu.

Telefonda köprü yatay çubuklara döner (12+ adım 360 px'e sığmaz).

## Kapsam dışı / bilinen sınırlar

- **Vardiya filtresi yok:** duruş özetleri vardiyayı tutmuyor (`oeeLossDays`
  gün × makine); vardiya kırılımı ham duruşlardan en çok 8 günlük okunabilir.
- **Setup kalıba göre değil:** özet kalıbı tutmuyor; setup Level 3'ü nedene
  ve makineye göre. Kalıp kırılımı için özete kalıp alanı eklenmeli (yeniden
  kurulum gerektirir).
- Planlama takvimi (vardiya planı) kullanılmaz: yalnızca PRS'te var; bütün
  plant'lerde aynı kural için resmi tatil + gerçekleşen vardiya.
- MES'in plansız duruş toplamı (Unscheduled) ile duruş kayıtları neden
  tutmuyor — MES sahibine sorulmalı (açık konu, docs/oeedashboard.md karar 10).
  Köprüde fark görünür kalır; Losses Trend'de değişen bir şey yok.
