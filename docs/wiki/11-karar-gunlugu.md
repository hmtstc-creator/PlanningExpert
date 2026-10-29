# 11 · Karar günlüğü (neden böyle?)

> Son güncelleme: 2026-10-29 (Asakai: bugün gizli, bütün iş yerleri; Work calendar Edit / Save; Asakai kırmızı = en büyük 2 duruş, vardiyalar da; gün kaydı, ZPP_DAILY önceliği, kapalı aralık, iş penceresi durumu) · Kaynak: `docs/decisions.md` (iş kararlarının tam listesi) + bu sohbetlerdeki mühendislik kararları

Biçim: **Karar** — *neden* — *alternatif* (neden seçilmedi).

## Plan ve hesap

- **ZPP_DAILY önce, haftalık ZPP yalnız boş kapasiteye** (2026-10-28, #95) — SAP'nin günlük ihtiyacına saygı; haftalık talebin güne bölünmesine planlamacı güvenmiyor. Kısmen kapsanan hafta bölünür (`W38` + `W38 LT`), uzun vade lotu geç sayılmaz, öne alınsa da günlük lotların arkasında kalır. *Alt.: karışık lotu ilk ihtiyaç gününe göre sınıflamak* (haftalık talep günlük önceliğe taşınırdı).
- **Gün kaydı = nihai karar** (2026-10-28) — Production Plan → *Work calendar* hücresi pres × gün × vardiyayı tek tek açar / kapatır; gün kaydı > istisna hafta > şablon, tatilde de. Vardiya numarası listesi tutulur (sayı değil), çünkü "yalnız 3. vardiya" gibi art arda olmayan günler gerekir. Plan elle hesaplanır kuralı korunur: kayıt "plan güncel değil" işareti koyar. *Alt.: hücre tıklamasıyla istisna hafta yazmak* (bütün haftayı değiştirirdi, tek günü değil).
- **Work calendar yazma anı = Save** (2026-10-28, #105) — kutu okuma kipinde açılır; *Edit* ile taslak, *Save* ile tek seferde yazılır (vardiya + o günün tarihli mesaisi). Kaydetme sırası mesai kaldırma → gün kaydı → mesai ekleme: sunucu açılan vardiyayla çakışan mesaiyi reddediyor. *Alt.: her tıklamada anında yazmak* (#97'deki davranış — yanlış tıklama hemen canlı veriye gidiyordu, mesai de buradan düzenlenemiyordu).
- **Plan settings = kapalı aralık** (2026-10-28, #94) — "başlangıç bitiş saati, sadece öteleme olmasın": pres `holdFrom` → `from` arası iş almaz, başlangıç boşsa şu andan. *Alt.: yalnız "plan until" (bitişten sonra kapalı)* — aralık ikisini de kapsar.
- **İş penceresi durumu ihtiyaç günü 08:00'e göre** (2026-10-28, #93) — her ihtiyaç noktası için saat önce / geç; ihtiyacı aşan rulo / min. lot fazlası *overstock*. Geç tanımıyla aynı teslim anı ve pay (`jobRequirements`).

- **Stok cost center'a göre sayılır** (2026-10-24, #54) — holdingde aynı kod bir cost center'da mamul, diğerinde hammadde; parça ana makinesinin cost center'ının depolarıyla (WIP + mamul / hammadde) sayılır, WIP mamul stoğuna dahil. Ayrı tablo `costCenterStorage`, tanım yoksa depo tikleri. *Alt.: depo tiklerine cost center listesi eklemek* (aynı depo farklı CC'de farklı rol alamazdı); *plants.costCenters içine yazmak* (org yönetimi yetkisi ile ana veri yetkisi karışırdı).
- **Ara mamul yalnız mamul tarafında sayılır** (2026-10-24) — fabrikada üretilen bir kod başka parçanın hammaddesiyse hammadde stoğu / ihtiyacı / satın almaya girmez; tüketen CC'nin çektiği miktar üreticinin ZPP'sinde var (kullanıcı). *Alt.: ara mamul talebini tüketen CC'nin planından türetmek* (motorda büyük değişiklik, ZPP ile çift talep riski); *ayrı depo + uyarı* (SAP düzeni değişmeli).
- **Müşteri önce, doluluk sonra** — geç bir parça müşteriyi durdurur; doluluk / setup kazancı bunun yerini tutmaz. *Alt.: doluluğu önce* (reddedildi).
- **Geç iş = pay, bütün sipariş değil** (2026-10-22) — ZPP günlük ihtiyaç rehber; teslimde yarısı hazırsa yarısı zamanında. *Alt.: yalnızca son parçanın gecikmesi* (müşteri etkisini abartıyordu).
- **Müşteri duruş süresi hesaplanmaz, tahmin gösterilir** — tüketim saatleri bilinmiyor; *ortalama* ve *son parça* verilir.
- **Lot bölme yerel aramada, ek setup yalnızca geç işi kurtarırsa** (2026-10-22) — mevcut puan sırası aynen kalır; mimariyi (varyant listesi) değiştirmez.
  *Alt.: ayrı bir "bölünmüş" senaryo ailesi* (arama büyüklüğünü katlardı).
- **Tam rulo sınırında bölme, Min. lot altına inmez** — bağlı rulo kesilmez; Min. lot bilinçli korunur.
- **İhtiyacı olmayan lot parçası dolgu fazına geçer** — faz sırası fazları aşmadığı için yoksa geç lot araya giremezdi.
- **Hammadde plandan bağımsız** — plan eklemek mükerrer sipariş doğurur.
- **Tedarik süresi takvim günü, yalnızca siparişi tarihler** — tedarikçi takvimle verir; teslim haftasını kaydırmak emniyet mantığını bozardı.
- **Plan elle hesaplanır** (2026-10-07) — otomatik / saatlik hesap Convex kotasını dolduruyordu.

## OEE analizi

- **Aynı duruş tek satır: makine + başlangıç + bitiş; her anahtarda tek kayıt** (2026-10-26, planlamacı; önleme amaçlı) — 23.10 PRS-110 v2 KLP farkı (Excel ≈115, site ≈344 dk) Excel hatası çıktı, site doğruydu; yine de tekrarlı yüklemenin bir satırı iki kez saydırma riski kalmasın diye kural sıkılaştırıldı. Duruş kimliği sipariş değil başlangıç + bitiş anı (saatsiz satır ayıklanmaz); yeni yüklenen geçerli, komşu günde (± 1) kalan eski kopya silinir. Vardiya (gün + vardiya + makine) zaten üzerine yazılıyordu; artık anahtarda birden çok kayıt varsa fazlası da silinir (gün toplamı, kayıp özeti, süre histogramı aynı). Eskiden kalanlar için OEE Data → *Check duplicates*: önce tarar ve gösterir, onayla siler (`src/lib/oeeDedup.ts`, `convex/oee.ts` → `duplicates`, sayfa sayfa). *Alt.: okurken ayıklamak* (her sayfada tekrar hesap, saklı özetler yine çift kalırdı); *sipariş anahtarda kalsın* (aynı duruş birden çok siparişle gelirse iki kez sayılır); *yeni `loadedAt` alanı* (şema değişikliği; aynı dosyanın tekrar yüklenmesi her satırı yeniden yazdırırdı).
- **Tanımsız duruş (RC1 ya da RC2 "#") = Unassigned; sütun sırası tek kaynak** (2026-10-26, planlamacı) — RC1 "#" her zaman kayıp (ayarda işaretli olmasa da), planlı değil; RC2 "#" kendi RC1'i kayıpsa kayıp; ikisi de her sayfada Unassigned. Kural tek yerde (`classifyLoss`, `src/lib/oee.ts`); kısa duruş bölmesi aynen (`Unassigned<` → Short stops); ayardaki "#" grubu kullanılmaz (silinmez). 2026-10-07 köprü kararı ("#" hesap dışı) kalktı. Sütunlar: ayardaki grup sırası (Settings ↑ ↓), Short stops, Speed, en sonda Unassigned. Özetler ham kodla kalır, veri taşıması yok. *Alt.: yüklemede RC2'yi "Unassigned"a yazmak* (ham veri bozulur, geçmiş yeniden yüklenmeli); *her tüketicide ayrı kontrol* (dağınık, eskir).
- **Kayıp > %100 of Loading kod hatası değil** (2026-10-26, doğrulama) — MES Loading vardiya − planlıdan kısa olunca (ör. 21.09 PRS-104 v1: 395 / 480 dk) kayıtlı duruş Loading'i aşar (%103); vardiya eşleşmesi doğru, düzeltme yok. Canlı 23.10 PRS-110 v2 %239 aynı örüntü olmalı; Excel paydası (≈ vardiya − planlı) açık soru.
- **Asakai weekly: masraf yeri başına blok, Excel'in yan yana düzeni değil** (2026-10-26, #83, planlamacı: "30 iş yerli costcenter'da format bozulmasın") — üstte aylık / 10 hafta / günler, altta iş yeri başına tek satır (günlerin OEE'si + haftanın kayıpları; iki Excel tablosu birleşti). İş yeri sayısı yalnız tabloyu uzatır; PDF çok sayfa, blok bölünmez. *Alt.: Excel'in birebir yan yana düzeni* (2'den çok masraf yeri ya da ~10'dan çok iş yerinde sığmıyor). Asakai detail Excel'deki gibi kaldı (aşağı uzar).
- ~~**Asakai detail kırmızı hücre = ≥ %10 of Loading**~~ (2026-10-26, #83) → **her iş yerinin gününde en büyük 2 duruş** (planlamacı, 2026-10-28; `ASAKAI_TOP`). Speed ve Unassigned sayılmaz. Vardiya satırları (1-2-3) da kendi en büyük 2 duruşuyla boyanır (kullanıcı, 2026-10-28).
- **Asakai sayfaları bugünü göstermez; iş yeri listesi tanımdan gelir** (2026-10-29, #107, kullanıcı: "bugünün süresi tamamlanmadığı için veriler yanlış görünüyor", "bir departman seçtiğimde altındaki bütün iş yerleri gelmeli") — iki sayfa da en çok düne bakar; bugünü kapsayan yüklenmiş hafta / ay satırı da bırakılır, o dönem günlerin toplamından hesaplanır (yarım gün toplamı büyütüp OEE'yi düşürüyordu). İş yerleri Work Center Definitions'taki masraf yeri bağından gelir, veriden değil: o gün çalışmayan makine de satır olur (boş). *Alt.: bütün OEE sayfalarında bugünü gizlemek* (Daily Report ve Trend bugünü bilerek gösteriyor, istenmedi); *bugünü yarım diye uyarı bandıyla göstermek* (planlamacı Asakai'yi PDF olarak dağıtıyor, yanlış sayı kâğıda giderdi); *iş yeri listesini yüklenen veriden tamamlamak* (o gün verisi hiç olmayan makine yine görünmezdi).
- **Kod değişince OEE geçmişi yeni koda taşınır** (2026-10-24, Ahmet, K5) — aynı work center'ın geçmişi iki koda bölünmesin; taşıma arka planda sayfa sayfa (mutasyon sınırı), çakışmada yeni kodlu satır kalır (daha yenidir, aynı gün iki kez sayılmaz). SAP bir süre eski kodu getirir: `workCenterAliases` yüklemede çevirir, zincir kısaltılır (A → B → C ise A → C). *Alt.: geçmiş eski kodla kalsın* (önceki kural; trend kesiliyordu); *istemci imleçle taşısın* (`rebuildStored` gibi; Master Data yetkilisinde OEE yetkisi olmayabilir, sayfa kapanınca yarım kalırdı).
- **Kısa duruş (< 2 dk) performans, uzun availability; A / P MES'te kalır** (2026-10-23, Ahmet, #46) — MES Production zaten yalnız ≥ 2 dk duruşları düşüyor (fixture'da 7/7 vardiya, 0,1 dk); kayıp ekranları aynı kodu olay süresine göre böler (`oeeShortStops.ts`). Eşik ayarda (`shortStopMin`, 2); 2'den farklıysa yalnız bölünme değişir.
  MTTR / MTBF ≥ eşik olaylarla (#47): arıza ve setup kullanılabilirlik kaybıdır; mikro duruşlar (ARZ'nin %96'sı) MTTR'yi küçültüp MTBF'i kısaltırdı. Kısa duruşlar ilk süre kovasında görünür.
  *Alt.: A' = (Production + kısa) ÷ Loading* (kısa duruşları iki kez sayardı); *eşik ≠ 2 iken A / P'yi kaydırmak* (vardiya ve MES haftalık / aylık satırlarında süre yok, sayfalar arası tutarsız olurdu); *kod başına aile ayarı* (aynı kodun kısa ve uzun olayları farklı kayıptır → kaldırıldı).
- **Kayıp kodu anlamları: varsayılan kodda, kullanıcınınki önce** (2026-10-23, #42) — sözlük `LOSS_CODE_MEANINGS` (`settingsDefaults.ts`), Meaning boşsa kullanılır ve Settings'te placeholder olur; ayara kopyalanmaz (varsayılan değişince eskimesin). Metin İngilizce: sayfa ve yapay zekâ isteği İngilizce. *Alt.: ayara yazmak* (kullanıcı değeriyle karışırdı).
- **Mola sonrası / 5S sinyali duruş metninden** (#42) — kayıp özetinde olay zamanı yok, yalnız metin; kalıplar `AFTER_BREAK`, `FIVE_S` (`oeeInsights.ts`). Gerçek metinler farklıysa kalıp genişletilir; #44 bilinen yazımları ekledi. Tuzak: "BREAK" tek başına aranmaz ("AFTER BREAKDOWN" arızadır); yeni yazım önce testteki eşleşmeli / eşleşmemeli listeye eklenir.
- **OEE açık konular ayrı, kalıcı bir liste** (2026-10-23, #37) — masraf yeri × iş yeri × kayıp grubu anahtarıyla; Die / Machine Problems'a yazılmaz.
  *Alt.: makine arızası kaydı açmak* (pres duruyor bayrağıyla planı etkileyebilirdi); *Decision Log → Open Issue* (masraf yeri / kapanış takibi yok).
- **Kararı ücretsiz yapay zekâ verir, kurallar adayı seçer ve yedektir** (2026-10-23, kullanıcı) — OpenAI uyumlu API (`AI_API_KEY`); anahtar yoksa / cevap bozuksa kurallar.
  Yapay zekâ yalnız kuralların seçtiği adaylar arasında karar verir, kanıt her zaman koddan sayıyla yazılır.
- **Gün bir kez, açık konu yeniden yazılmaz** — `oeeTopicRuns` işlenen günü tutar; açık konu ertesi gün yalnızca *last seen* günceller.
- **Loss Bridge'de < 2 dk kısa duruşlar kalem değil, Speed loss'un içinde** (#81, 2026-10-26) — *planlamacı: ayrı yerde (MTTR & MTBF süre kovaları) analiz edilecek; MES zaten Production'dan düşmediği için A ve availability kaybı değişmez* — *alternatif: ayrı "< 2 min" adımları* (köprüde gürültü, kullanıcı istemedi).

## Yayın ve işletim

- **Yayın zamanlayıcıyla otomatik** (2026-10-22) — bulut oturumu sunucu oturumuna mesaj gönderemiyor; her yayın için onay istenmesi kabul edilmedi.
  *Alt.: sunucu oturumuna kalıcı komut izni* (yetki yüzeyi geniş; zamanlayıcı daha küçük).
- **Başarısız commit yeniden denenmez** — yedek ve derleme her 5 dakikada tekrarlanmasın.
- **Kilit betiğin içinde** — servis sarmalayıcısı elle çalıştırmayı korumuyordu.
- **Birleşen PR dalı otomatik silinir (GitHub iş akışı)** — bulut oturumundan dal silinemiyor (izin sistemi).
- **Her şey VPS'te** (2026-10-16) — Vercel / Convex Cloud kaldırıldı; veri ve yayın tek yerde.
- **Bir iş = bir oturum** (2026-10-22) — tek uzun sohbet bağlamı 560k token'a çıkardı ve kullanım hızla doluyordu; bilgi zaten wiki'de olduğu için her iş yeni oturumda başlar, kapanışta `/devir` skill'i wiki'yi günceller.
- **Wiki + CLAUDE.md + CI denetimleri** (2026-10-22) — oturumlar arası bilgi depoda kalıcı; mantık değişince sayfa güncellemesi ve mimari kural ihlali CI'da yakalanır.

- **Devir = docs PR'ı** (2026-10-22) — iş bitince `/devir`: sürüm günlüğü satırı, kararlar ve dersler, "Devam" maddesi tek docs PR'ında; CI yeşilse birleşir.
  Yeni oturum yalnız depoyu okuyarak başlar. *Alt.: sohbet özeti* (oturum bitince kaybolur).

## Arayüz

- **Geç listede öneri yerine neden** — planlamacı hafta içi çözüm bulamaz; ne yüzden geç olduğunu ve hesabın nereden geldiğini görmeli.
- **Sağlık göstergesi gerçek veri akışına bakar** — "healthy" yalnızca soket açık demek değildi.
- **Telefonda tablo yerine kart** — yana kayan tabloda açıklama görünmüyordu.

## Yönetim ekranları

- **Bölüm sorumlusu bölüm adına bağlı, ayrı tablo yok** (2026-10-24, #62) — `plants.departmentOwners` (bölüm adı → kullanıcı); yeniden adlandırmada `carryDepartmentOwners` taşır (tam bir ad gidip bir ad geldiyse), silinen bölüm / kullanıcıyla düşer. Sorumlu yetki vermez, yalnız gösterilir. *Alt.: bölümleri ID'li ayrı tabloya taşımak* (todolist P1 *Bölümler ad listesi*; masraf yeri, OEE, KPI, Board adla bağlı — büyük göç; bölüme hedef ya da yetki eklenirse yeniden ele alınır).
- **Board / KPI'da bölüm seviyesi, bölüm sorumlusu, holding hedefi, Board PDF** (2026-10-24, Ahmet, K7) — dördü de yapılacak (todolist 2 → [G]); holding hedefi girilmezse şirket planlarının toplamı.
- **KPI ağırlıkları bugünkü gibi** (2026-10-24, K8, varsayılan) — Absenteeism % normal mevcudiyetle, Productivity (adet/saat sayılır) toplam mevcudiyetle; saati boş satır: hiçbirinde yoksa eşit, varsa 0 (`src/lib/kpi.ts`, `weighted`). Ahmet sitede yanlış görürse değişir. *Alt.: operatör sayısıyla* (Productivity adet/kişi olsaydı doğru olurdu; birim bilinmiyor).
- **Organization map ayrı sayfa, eski sayfalar kalır** (2026-10-22) — kullanıcı istedi; harita yeterli olunca eski ağaç / Users & permissions onayla kaldırılır. *Alt.: eski sayfayı hemen değiştirmek* (geri dönüşsüz, riskli).
- **Harita yeni sunucu kodu yazmaz** (2026-10-22) — sürükle-bırak mevcut mutation'ları çağırır (`setCompanyHolding`, `updatePlant`, `users.update`, `saveGroup`); yetki ve denetim kaydı tek yerde kalır. Work center sürükleme yok: `presses.upsert` aktif plant ve tam kayıt ister. *Alt.: harita için yeni mutation* (kural kopyası).
- **Tuval kütüphanesi `@xyflow/react` (sürüm sabit)** — kaydırma, yakınlaştırma, mini harita, çarpışma (`getIntersectingNodes`) hazır; yerleşim kendi saf fonksiyonumuz (test edilir). *Alt.: elle SVG tuval* (çok kod).
- **PR'ı Claude birleştirir** (2026-10-22, kullanıcı) — CI `verify` yeşil ve açık yorum yoksa taslak PR hazır yapılır, squash merge edilir; kullanıcı beklenmez. *Alt.: kullanıcı birleştirir* (her PR'da bekleme).
