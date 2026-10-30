# 02 · Planlama motoru

> Son güncelleme: 2026-10-30 (Production Plan takvim kutusu cost center modeline göre, ekip Work Calendar'da; operatör planı: haftalık operatör sayısı, operatör hattı her iş günü 3 vardiya, Capacity dashboard'da operatör sınırı; cost center bazında ikinci model, motorun önünde saf dağıtım aşaması; bütün parçalar ve iş yerleri çevrim süresiyle: süre = adet × dk/adet, nut welding de planda; presi durduran arıza da planlı duruş gibi; kapalı aralık planlı duruştur: üretim üstünden atlar, kesilen rulo bitince iş biter; mesai vardiya ızgarasının dışına; Gantt kapalı vardiyayı boyamaz; hafta sonu mesaisi; gün kaydı: pres × gün vardiyaları; Work calendar kutusu Edit / Save) · Kaynak: `src/lib/planPipeline.ts`, `scheduler.ts`, `planning.ts` ·
> Kullanıcıya dönük anlatım: sitede **Planning Logic**

Motor **saf fonksiyondur** (`computePlan(girdiler, şimdi)` → `PlanRun`). Aynı girdi aynı planı verir
(senaryo aramasındaki rastgelelik tohumludur).

## Uçtan uca adımlar

1. **Girdiler** (`PlanInputs`): master data (parçalar), ZPP (haftalık), ZPP_DAILY (günlük), stok (MB52, yalnızca
   *Finished goods* depoları), preslerin takvimi, resmi tatiller, planlı duruşlar, kalıp bakımı / hazırlığı / alarmı,
   onaylı plan (dondurulmuş ufuk), onaylı işler (kilitler), plan müdahaleleri, yoldaki hammadde.
   - **Pres takvimi önceliği** (`pressCalendar.pressDay`, tek kaynak): **gün kaydı** (`pressDayShifts`, Production Plan →
     *Work calendar* kutusunda **Edit** → hücreye tıklama → **Save**) > istisna hafta > şablon. Gün kaydı tatilde de geçerlidir ve vardiyalar art arda
     olmak zorunda değildir (ör. yalnız 3. vardiya): `DayShape.activeShifts` / `DayBucket.activeShifts` taşır, zaman
     çizelgesi (`buildDayTimeline`), kova net dakikası, zamanlayıcının vardiya sınırı (`DayBucket.shiftNetMinutes`) ve
     bağımsız doğrulayıcı (kendi `normalShiftsOn`'u) bunu okur. `activeShifts` yalnız 1..n değilse doludur.
   - **Operatör planı** (2026-10-30, `src/lib/operatorAllocation.ts`): `plants.costCenters[].planningModel` =
     `'operator'` olan cost center'larda (APR / punta / somun kaynağı hatları) takvim tek başına karar vermez.
     Production Plan → *Operators per shift* ızgarası `operatorHeadcount` (cost center × üretim günü × vardiya →
     adam) yazar (kutu yalnız seçimde operatör cost center'ı varken görünür); hattın ekibi `presses.crewSize` (yok = 1; Work Calendar → Capacity overview'da girilir). Pipeline, kapasite kovalarından **önce** talebi
     (`buildDemandSchedule`, motorun aynı lotları) iş yüküne çevirir (lot adedi × `minutesPerPiece`, ana hat,
     vade = `dueDate`) ve `allocateOperators` her gün × vardiyada bakiyesi olan hatları en erken vade (eşitlikte
     kalan dakika büyük) sırasıyla ekip sığdıkça açar. Bakiye = vadesi o günün haftasının Pazar'ına kadar olan
     iş; çalışan her vardiyanın net dakikası (`shiftMinutes − o vardiyanın planlı duruşu`) × kapasite faktörü
     bakiyeden düşer. Adam sayısı girilmemiş gün × vardiya ve tatil → takvim; elle gün kaydı her zaman önce gelir
     (ekibi adam sayısından önce düşülür). Çıktı yalnız takvimden farklı hat × günlerdir; elle kayıtlarla
     birleştirilip ikinci `capacityModel`'e gider (`run.operatorDayShifts`). Talebin iş günlerine dağıtımı
     (`isPlantWorkingDate`) dağıtımdan **önceki** takvimle yapılır (döngü olmasın). Doğrulayıcı
     `run.operatorDayShifts`'i gün kaydı gibi okur ve **R14 `operator-headcount`** ile çalışan hatların ekip
     toplamının adam sayısını aşmadığını bağımsız denetler. Örnek (test + Planning Logic, `OPERATOR_EXAMPLE`):
     3 adam, 5 hat, L5 bakiyesiz → L1, L3, L2 açık (L3 900 dk > L2 600 dk, aynı vade), L4 adam kalmadı, L5 kapalı.
   - **Operatör hattı = 3 vardiya, haftalık operatör sayısı** (2026-10-30, `src/lib/operatorCapacity.ts`):
     operatör modelli cost center'ın hatlarında makine şablonu, tekrarlayan mesai ve istisna hafta **okunmaz**;
     Work Calendar'ın her iş gününde `OPERATOR_SHIFTS_PER_DAY` (3, `settingsDefaults.ts`) vardiya açık sayılır
     (`CapacitySources.operatorPattern` → `capacityModel`; plan, Work Calendar, Performance aynı; doğrulayıcı kendi
     kopyasıyla). Gün kaydı ve tarihli mesai geçerli. Uzun vade: `operatorWeekly` (cost center × hafta Pazartesi →
     o hafta sahadaki kişi, vardiyalara bölünmez; Work Calendar → *Capacity overview* → cost center seçilince
     *Operators per week*). `mergeWeeklyHeadcount`: o cost center'a o gün gün × vardiya satırı girilmemiş iş
     günlerinde 1..3. vardiyaya ⌊haftalık ÷ 3⌋ adam (ızgara önce gelir); motor ve R14 bu birleşik girdiyi okur
     (doğrulayıcı bağımsız kopya). Capacity dashboard: operatör hattının haftası dağıtımdan **önceki** 3 vardiya
     takviminden × `operatorWeekCapacity().factor` = min(makine × 3 × iş günü, haftalık ÷ ortalama ekip × iş günü)
     ÷ makine sınırı; haftalık yoksa makine × 3. Örnek (`OPERATOR_WEEKLY_EXAMPLE`): 4 hat, ekip 1-1-2-2, 5 gün,
     12 kişi → 60 / 40 → 40 vardiya; vardiya başına 4 adam. Work Calendar'da *All* seçiliyken operatör hatları
     sabit 3 vardiya, tıklanmaz ("operator plan" etiketi); gün × vardiya ızgarası yalnız ilk 2 hafta.
   - **Mesai vardiya ızgarasının dışına açılır** (2026-10-29): çalışılan günde vardiyalar günün ızgarasıdır
     (kapalı vardiya takvimden açılır, mesaiyle değil); mesai penceresi ızgaranın bitiminden üretim gününün
     sonuna kadardır (`pressCalendar.overtimeWindows`). 8 saatlik vardiyada günde 3 vardiya sığar → hafta içi
     mesai penceresi yok; 9 s 40 dk'lık vardiyada 2 vardiya sığar → 01:50–06:30 açıktır. Hiç vardiyası olmayan
     gün (Cmt / Paz / tatil) bütünüyle açıktır. Kayıt ayrıca fiilen boş zamana düşmelidir: boş pencere = üretim günü (ilk vardiya başlangıcından 24 saat)
     − açık vardiyalar − açılmış mesailer (`pressCalendar.freeWindows` / `freeMinutes`; "sığar mı?" `overtimeFitProblem`,
     tek kontrol `overtimeWindowProblem` — `dayOvertime` de onu kullanır). 3 × 8 saat çalışan günde boşluk yoktur, mesai
     ancak dolu olmayan bir güne (çoğunlukla **cumartesi / pazar**) açılır; 06:30'dan 2 × 9 s 40 dk çalışan preste
     01:50–06:30 boştur, gece mesaisi oraya sığar. Kapalı hafta sonu planın günlerinde görünmez (kapasite 0,
     `groupPlanWeeks` `minutes > 0`), ama *Work calendar* kutusunda gösterilen haftanın her günü düzenlenebilir.
   - **Gantt çubuğu çalışılan kesintiye göre bölünür** (2026-10-29): `WeekGantt` bir işin parçalarını
     iş × gün × **çalışma penceresi** olarak gruplar. Planlı duruş çubuğu bölmez (içinde nokta), kapalı vardiya
     böler. Önceden iş × gün gruplandığı için `min(start)–max(end)` kapalı vardiyanın üstünü boyuyordu:
     plan doğru, çizim yanlıştı.
   - **Bütün iş yerleri ve parçalar girer** (2026-10-29): `convex/planEngine.ts` hiçbir iş yerini ya da parçayı
     elemez (eski `pressPlanScope` / cycle hattı ayrımı kalktı). `presses.rateModel` şemada eski kayıtlar için durur,
     motor okumaz.
   - **Süre tek kaynaktan** (`src/lib/rateModel.ts`): `minutesPerPiece(parça)` = `cycleMinutes` (> 0 ise); yoksa
     geri uyum `1 ÷ (SPM × göz)` (göz yoksa 1); ikisi de yoksa 0 = süre tanımsız. İşin ideal süresi
     `runMinutesFor` = vuruş × dk/vuruş: göz yoksa **adet × dk/adet** (1200 × 0,25 = 300 dk); eski SPM'li parçada
     harfiyen `⌈adet ÷ göz⌉ ÷ SPM` (süre eskisiyle bit bit aynı). Göz yalnız vuruşu belirler (kalıp ömrü, rulo başına
     vuruş, maks. baskı); göz silinince vuruş = adet. `computeRunPlan`, kapasite öngörüsü, `performance.ts`,
     geç iş hesabı (`minutesPerPiece`) bunu kullanır; doğrulayıcı kendi kopyasıyla (`strokeMinutes`) "no cycle time in
     master data" ve "faster than the cycle time allows" der.
   - **Rulosuz / sacsız parça** (nut welding …): lot kuralı `missing` ama `cycleMinutes > 0` ise uyarı basılmaz
     (plan uyarısı, iş gerekçesi "exact quantity (cycle time, no coil)", doğrulayıcı bayrağı); hammadde sayfası
     da hammadde kodu + brüt ağırlık + rulo yoksa onu "eksik veri" saymaz. Min. lot varsa o uygulanır.
2. **Talep → lot** (`buildDemandSchedule`, `planning.ts`):
   - ZPP_DAILY kapsadığı günlerde **tam tarihine** düşer; ötesinde haftalık ZPP çalışma günlerine eşit yayılır; bakiye bugündür.
   - **ZPP_DAILY önce, haftalık ZPP uzun vade** (Slayt 1, 2026-10-28): ZPP_DAILY yüklü ve bugüne ulaşıyorsa haftalık ZPP'den gelen
     talep (ZPP_DAILY'nin son gününden sonrası + ZPP_DAILY satırı olmayan parçanın bütün haftalık talebi) `longTerm` lottur.
     **Karışık lot yok:** kısmen kapsanan hafta bölünür — kapsanan günler günlük lot (`W38`), kalan uzun vade lot (`W38 LT`, ilk tarihi
     kapsanan son günün ertesi). Gerekçe: karışık lot günlük önceliği alırsa haftalık talep günlük lotların kapasitesini kullanırdı;
     "ilk ihtiyaç gününe göre" sınıflamak ise lotun haftalık kısmını da günlük önceliğe taşırdı. Rulo yine kesilmez: günlük lotun rulo
     fazlası (`carry`) önce uzun vade ihtiyacından düşer, fazladan rulo bağlanmaz (örnek: 1000 + 1000 günlük, W38 = 5000, rulo 2500 →
     günlük 2500 + uzun vade 2500). Günlük lotun teslim noktaları yalnızca günlük talebi (ZPP_DAILY + bakiye) sayar; hiçbir günlük talebi
     karşılamayan günlük kökenli lot da uzun vadeye geçer. Uzun vade lotu her zaman **dolgu** fazındadır, aciliyeti 0'dır.
     ZPP_DAILY yoksa (ya da bugünden önce bitiyorsa) hiçbir lot uzun vade değildir, davranış eskisi gibidir.
   - Gün gün **tahmini stok** yürütülür; stok + önceki lotlar eksiye düşünce o gün lotun **stok bitiş günü**dür.
   - **Emniyet stoğu** (`safetyStockDays`): lot stok bitişinden bu kadar iş günü önce başlayabilir, daha erken değil.
     Başlangıç günü bugün ya da geçmişse lot **acil (urgent)**, değilse **dolgu (fill)**; bakiye **backlog**.
   - Lot adedi **rulo / Min. lot katına** yukarı yuvarlanır; fazlası sonraki haftanın ihtiyacından düşülür (`carry`).
     Planlamacı bir lotun adedini elle değiştirebilir (`planOverrides`, `quantity`), yuvarlama yine uygulanır.
   - Her lot **teslim kontrol noktaları** taşır: karşıladığı her ihtiyaç günü ve o güne kadar gereken **birikimli pay** ([03](03-gec-is-tanimi.md)).
   - Eş ürün çiftleri **tek vuruştan** çıkar; sac yalnızca asıl ürünün gramajıyla sayılır.
3. **Dondurulmuş ufuk:** onaylı plandaki işler (ve tek tek kilitlenen işler, `planJobLocks`) yerinde kalır; motor etrafına planlar.
   **Taşınan iş** (Gantt'ta sürükle-bırak ya da iş penceresi → *Move…*, 2026-10-23) da kilittir: `src/lib/jobMove.ts` işin parçalarını (setup, onay, üretim, rulo değişimi) sırası ve net süresiyle hedef presin günlerine döker (`reflowSegments`), geçmişe / ufuk dışına / başka kilitli, dondurulmuş işe ya da bakıma bindirmez (`planMove`); `convex/planJobLocks.ts` `move` eski kilidi kaldırıp yenisini tek işlemde yazar. Süre pres değişince aynı kalır (motor süreyi parçadan okur).
   **Elle eklenen iş** (Plan → *+ Add job*, stok amaçlı): süre `computeRunPlan` (motorla aynı), parça sırası `manualJobSegments` (setup → onay → rulo başına üretim, aralarda rulo değişimi; kalıp takılıysa setup yok, `feedsCoil` false ise rulo değişimi yok). Aynı `planMove` + `planJobLocks.move` yoluyla `phase: 'fill'` kilit olarak yazılır; adedi talepten düşer. Plan çıktısındaki `presses[]` artık `feedsCoil` taşır.
   **Kapalı aralık** (Plan settings, `pressPlanStarts`, 2026-10-28): pres `holdFrom*` → `from*` arasında iş almaz (başlangıç boşsa
   şu andan); aralık grafikte bakım bloğu gibi çizilir, aralığa değen onaylı işler serbest bırakılıp yeniden planlanır (`pressStart.test.ts`).
   Kapalı aralık ve presi durduran açık arıza **planlı duruştur, duvar değildir** (2026-10-29, #112 / #113): `MaintenanceBlock.pausable` → `FixedJob.pausable` →
   `Booking.pausable`. `tryPlaceOnPress` üretimi duruşa kadar yazar, duruşun sonundan sürdürür (vardiya kapanışı gibi);
   setup, kalite onayı ve rulo değişimi duruşu aşamaz, ilk vuruştan önce gelen duruş atlanmaz (iş duruştan sonraya kayar).
   Duruş bir ruloyu kestiyse iş o rulo bitince biter (`cutAfterCoils`): `schedule()` yerleştirmeyi geri alır, partiyi
   rulo sınırında baş + kalan olarak böler, başı yeniden yerleştirir; kalan hemen arkadan sıraya girer (kalıp takılı → setup'sız).
   İş eksende duruşun önü ve arkası olarak ayrı kayıt tutar (aralıklar çakışmaz kuralı). `materialBefore` duruşu atlar:
   planlı duruş kalıbı sökmez. Planlamacı kalıbı söktürmek isterse kalan partiyi elle iptal eder.
4. **Yerleştirme** (`schedule`, `scheduler.ts`): lotlar sırayla preslere konur.
   - **Sıra:** günlük lotlar → **uzun vade lotlar en sonda** (öne alınanlar dahil bütün günlük lotlardan sonra) ; her grupta öne alınanlar (priority) → faz (bakiye → acil → dolgu) → boost → faz içinde stok bitişi / aciliyet / az alternatifli önce.
   - **Uzun vade lotu günlük lotu itmez:** yalnızca kalan boşluğa girer; takılı kalıp kuralında dolgu olarak öne geçemez; setup'sız devam eden
     günlük işin önündeki boşluğa giremez (o işe setup geri getirirdi). Geç sayılmaz (`deliveryCheck`), `neededQuantity` 0.
   - Her lot **bütün uygun presleri** dener (ana pres; alternatifler yalnızca *Flexible work center* işaretliyse). Varsayılan seçim *en erken biten* pres.
   - Kısıtlar: setup ekibi (hol başına eşzamanlı setup, tesis geneli sınır), vinç aralığı, **kalıp aynı anda iki yerde olamaz**, kalıp hazır değil / alarm,
     kalıp ömrü (`maxShots`; parti sınırında bölünür, parçalar arka arkaya), rulo değişimi, planlı duruşlar, mesai.
   - **Takılı kalıp kuralı:** acil iş setup'la girecekken preste takılı kalıbın bekleyen dolgu lotu varsa dolgu setup'sız devam eder, acil iş ardından gelir (acil iş yine zamanındaysa).
5. **Geç iş onarımı** (en çok 6 tur): geç kalan lotlar **boost** (kendi fazının başına) ile öne alınır ve plan yeniden kurulur.
   En iyi plan saklanır (puan: *plansız günlük, geç malzeme, geç saat, geç lot, plansız uzun vade* — küçük iyi; plansız uzun vade lotu hiçbir zaman günlük lotun gecikmesinden önce gelmez).
6. **Senaryo araması** (en çok `maxScenarios` = 100 deneme): aynı kurallarla farklı **sıra** (en kısa / en uzun iş önce, az presli önce, karışık tohumlar)
   ve **pres seçimi** (en erken biten / en erken başlayan / en az yüklü). Seçim: önce müşteri (puan yukarıdaki gibi), sonra **üretken doluluk**
   (ilk 7 gün; setup / onay / rulo değişimi sayılmaz), sonra en az setup. Durur: hedef doluluk (%95) ve hiçbir şey geç değil · 25 denemede iyileşme yok ·
   deneme sınırı · 2 dakika.
7. **Yerel arama** (en çok 150 hamle / 1 dakika): her geç lot için tek tek hamle; **yalnızca puan iyileşirse** kabul:
   - lotu kendi fazında **1, 2, 4 gün öne** sırala; *boost*'u aç / kapat;
   - aynı preste ondan önce çalışan geç olmayan lotu **2 gün arkaya** al;
   - **Lot bölme** (PR #19): geç lotun önündeki en uzun iki lot **2 ya da 3 parçaya** bölünür (önce ihtiyaca göre 2, sonra eşit 2, eşit 3);
     parçalar **tam rulo**dur, Min. lotun altına inen bölme reddedilir; ilk parça yerinde kalır, diğerleri geç lotun arkasına sıralanır;
     ihtiyacı olmayan parça yalnızca rulo fazlası olduğu için **dolgu** sayılır. İkinci parça ek setup ister; bu yüzden yalnızca geç işi kurtarıyorsa tutulur.
     Parça etiketi `"W38 (1/2)"`; Gantt'ta adet değişikliği lotun tamamına uygulanır.
8. **Rapor:** geç kalemler (malzeme bazında, neden + hesap + pay), kapasite, doluluk, uyarılar, denetim, **bağımsız doğrulama**.

## Önemli kararlar ve tuzaklar

- **Müşteri önce, doluluk sonra.** Bir geç malzeme, doluluk ya da setup kazancı için asla feda edilmez.
- **Ek setup yalnızca müşteriyi kurtarıyorsa** kabul edilir (lot bölme, geç iş için öne alma).
- **Faz sırası fazları aşmaz:** bir lotun `orderShift`'i yalnızca kendi fazı içinde sıralar. Bu yüzden ihtiyacı olmayan lot parçası dolguya geçirilir.
- **Rulo kesilmez:** geç işi kurtarmak için bile lot rulonun altına inmez; çözüm sıra, pres, mesai ya da lotu **tam rulo sınırında bölmektir**.
- Motor ayarları tek yerden gelir: `SETTINGS_DEFAULTS` (varsayılanlar), `globalShiftSettings` (kayıtlı).

## Testler (örnek sayılar burada)

`planPipeline.test.ts`, `scheduler*.test.ts`, `lateRepair.test.ts`, `lotSplit.test.ts` (Y 6000 → 3000 + Z + 3000), `coilLots.test.ts`,
`minLot.test.ts`, `deliveryLateness.test.ts`, `lotQuantityOverride.test.ts`, `jobLocks.test.ts`,
`zppDailyPriority.test.ts` (D 7000 günlük önce, L 4000 uzun vade ardından; kısmi hafta 2500 + 2500 LT),
`operatorAllocation.test.ts` (3 adam, 5 hat → L1, L3, L2; L4 ve L5 kapalı), `operatorCapacity.test.ts` (4 hat, 12 kişi → 40 vardiya, vardiyada 4).
