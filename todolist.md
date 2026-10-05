# PlanningExpert — yapılacaklar listesi

Tek liste. Dağınık duran açık notlar buraya toplandı (2026-10-03); her
maddenin yanında geldiği yer yazıyor. Bir madde bitince ✅ ile işaretlenir,
yeni karar ilgili docs dosyasına da yazılır. Kısaltmalar: **[S]** sen
(planlamacı / site sahibi) yaparsın · **[K]** karar gerekiyor · **[G]**
geliştirme.

---

## 0. Senden karar bekleyenler (özet)

Ayrıntı ve gerekçe ilgili maddede; karar verilince madde güncellenir.

| # | Karar | Madde |
|---|---|---|
| ~~K1~~ | ✅ **A** (arayüz VPS, Convex bulutta) — taşıma haftaya | 4.1 |
| K2 | Yedek hedefi: kabul edilen veri kaybı (RPO) ve geri dönüş süresi (RTO) | 4.1 |
| ~~K3~~ | ✅ Evet: bölümün OEE'si olur, ayrı OEE alanı yok | 2, 4.2 |
| ~~K4~~ | ✅ Hayır, gerek yok | 4.2 |
| K5 | Work center kodu değişince OEE geçmişi de taşınsın mı? | 4.2 |
| ~~K6~~ | ✅ Hayır | 4.3 |
| K7 | Board / KPI kırılımına bölüm seviyesi; bölüm sorumlusu; holding hedefi; Board PDF | 2 |
| K8 | KPI ağırlıkları (Absenteeism, Productivity birimi, saati boş satır) | 2 |
| K9 | OEE: Avg setup'a ara süreler; kayıp grubu adları | 2 |
| K10 | Koddaki sabit sayılar: programda mı, kullanıcıda mı (P/K) | 2 |
| K11 | Fabrika karşılaştırma ekranının içeriği | 2 |
| K12 | "Doğrudan main" yerine PR + inceleme düzeni | 4.1 |
| K13 | Geç teslimatta karar sahibi ve tepki süresi (aksiyon kaydı) | 5 |
| ~~K14~~ | ✅ Kullanıcı ayarlar: Company settings → Today & daily digest (e-posta servisi anahtarı bekleniyor) | 5 |
| K15 | Plan sabitlenmesi (frozen) ve plana uyum hedefi (%) | 5 |

## 1. Hemen — senin yapacakların (yeni yapıya geçiş)

Organizasyon artık tepeden aşağı tek zincir:

```
Holding → Company → Plant → Department → Cost center → Work center
```

- [ ] **[S]** Bir holding aç; holding'siz şirketleri (Metal Stamping, Hala5)
  şirket panelinde holding'e bağla.
- [ ] **[S]** Aynı şirkette iki "Stamping" plant'i var: biri fazlaysa sil
  (verisi olanı tut), değilse adını değiştir.
- [ ] **[S]** Her plant'e bölümleri ekle; "Without a department" altındaki
  masraf yerlerini bölümlerine taşı.
- [ ] **[S]** Work Center Definitions'ta her work center'ın masraf yerini
  seç. Bağsız olanlar sayfanın üstünde ve ağaçta uyarı verir. OEE verisi
  başka bir masraf yeri gösteriyorsa satırda "OEE data: … · use" çıkar.
- [ ] **[S]** "Things to finish" listesi boşalana kadar devam et.

### Organizasyon teyidi (2026-10-03)

| Bağ | Durum | Nasıl korunuyor |
|---|---|---|
| Company → Holding | ✅ zorunlu | şirket holding içinde açılır, holding'siz bırakılamaz; şirketi olan holding silinmez |
| Plant → Company | ✅ zorunlu | baştan beri |
| Department → Plant | ✅ | plant kaydında, ad fabrikada tek |
| Cost center → Department | ✅ yeni kayıtta zorunlu | bölümsüz yeni masraf yeri kaydedilmez; masraf yeri olan bölüm silinmez; eski kayıtlar "Without a department" uyarısında |
| Work center → Cost center | ✅ yeni kayıtta zorunlu (bu tur) | yeni work center masraf yerisiz açılmaz, bağ boşaltılamaz, başka plant'in kodu kabul edilmez; work center'ı olan masraf yeri kaldırılamaz; eski kayıtlar uyarıda |
| OEE verisi → Cost center | ✅ | yüklemede yalnızca plant'in masraf yerleri alınır |
| KPI → Cost center | ✅ | kayıtta plant'in masraf yeri olmayan satır reddedilir |
| Work center tanımı ↔ OEE verisi | ⚠️ yalnızca uyarı | tanım ile verideki masraf yeri farklıysa ekranda yazar, program düzeltmez |
| Master data makine adları → Work center | ⚠️ serbest metin | tanımsız makine Work Center Definitions'ta uyarı olarak çıkar; bağ ad üzerinden (bkz. 4.2) |

---

## 2. Açık kararlar (konuşulacak)

### Organizasyon ve Board
- [ ] **[K]** Board Dashboard ve KPI kırılımına bölüm seviyesi (plant →
  bölüm → masraf yeri) eklensin mi? *(docs/board.md)*
- [x] ✅ Bölüm ile OEE **Area** birleşir (K3, 2026-10-03). Önceden iki ayrı gruplama
  var (bkz. 4.2). *(docs/board.md)*
- [ ] **[K]** Bölüme sorumlu kullanıcı atansın mı? *(docs/board.md)*
- [ ] **[K]** Holding'e kendi hedefi (ör. grup OEE hedefi) girilsin mi,
  yoksa yalnızca şirket planlarının toplamı mı kullanılsın? *(docs/board.md)*
- [ ] **[K]** Board Dashboard'un A3 / PDF çıktısı (KPI dashboard'undaki
  gibi). *(docs/board.md)*
- [ ] **[K]** Fabrika karşılaştırma ekranının içeriği (ilk sürüm yalnızca
  OEE). *(docs/plant-genisletme.md — aşama 7)*

### KPI
- [ ] **[K]** Absenteeism % ağırlığı: normal mevcudiyet saati mi, operatör
  sayısı mı? *(docs/kpi.md → Açık notlar)*
- [ ] **[K]** Productivity'nin birimi (adet/saat, adet/kişi …): birime göre
  doğru ağırlık değişir. *(docs/kpi.md)*
- [ ] **[K]** Saati boş satırın ağırlığı (bugün: hiçbirinde saat yoksa
  eşit, bazılarında varsa 0). *(docs/kpi.md)*

### OEE
- [ ] **[K]** Avg setup'a, birleşen setup kayıtları arasındaki süre de
  katılsın mı? *(docs/oeedashboard.md → Bekleyen konular)*
- [ ] **[G]** Parça bazlı setup süresi Master Data'da (APR için şimdilik
  alan bazlı 10 dk). *(docs/oeedashboard.md)*
- [ ] **[K]** Kayıp grubu adları programda mı kalsın, tabloya mı
  ayrılsın? *(docs/oeedashboard.md, soru 9)*

### Planlama ve sabit değerler
- [ ] **[K]** Koddaki sabit sayılar için P (programda kalır) / K
  (kullanıcı tanımlar) kararı — kararı boş olan satırlar: 1–10, 13–21, 23,
  24, 28. Öneriler tabloda var. *(docs/fixeddefinitions.md)*
- [ ] **[G]** Hammadde: talep yoksa sipariş yok; kanban ileride ayrı
  kural. *(docs/decisions.md, src/lib/rawMrp.ts)*

### Platform
- [x] ✅ Platform değişiklik kaydı → denetim kaydı (bkz. 4.3).
  *(docs/plant-genisletme.md → Kalan)*

---

## 3. Kapanmış ama izlenecek

- MB51'de hareket türü olmayan eski satırlar: sorun değil, veriler
  yenilenebilir. *(docs/decisions.md, madde 13 → oeedashboard.md)*
- Deploy: Vercel güvenlik açığı nedeniyle TanStack Start 1.168.60'a
  yükseltildi; paket güncellemeleri düzenli izlenmeli (bkz. 4.1).

---

## 4. Kurumsallaşma — acımasız eleştiri ve yapılacaklar

Kısaca: program işlevsel olarak zengin. Ancak **tek kişi + tek ajan +
doğrudan production** ile yürüyor. Bir müşteriye "kurumsal ürün" diye
kiralanacaksa en zayıf yer kod değil; güvence: test kapısı, yedek,
güvenlik, kayıt ve sürüm disiplini. Öncelik: **P0** = müşteri almadan önce,
**P1** = ilk aylarda, **P2** = büyürken.

### 4.1 Güvence ve operasyon

- [x] ✅ **P0 — CI yok** (2026-10-03): GitHub Actions her push ve PR'da
  tip kontrolü, testler ve build çalıştırır (`.github/workflows/ci.yml`);
  yerelde aynısı `npm run verify`. Tip kontrolündeki iki sahte hata
  (`QueryCtx`) giderildi.
  - [ ] **[S]** VPS'te yayın yalnızca CI yeşilken: yayın betiği önce
    `npm run verify` çalıştırır (docs/deployment.md); GitHub'da `main` için
    "Require status checks".
- [ ] **P0 — VPS'e taşıma (karar: A — arayüz VPS, Convex bulutta; haftaya).**
  Kontrol listesi: docs/deployment.md → "VPS'e taşıma kontrol listesi".
- [x] ✅ **P0 — Geliştirirken canlı veri korunur** (2026-10-03): şema kapısı
  (alan / tablo kaldırma, zorunlu yapma, daraltma CI'da durur), yayın öncesi
  zorunlu yedek (`scripts/release.sh`), günlük yedek (`scripts/backup.sh`),
  kurallar: docs/deployment.md → "Veri güvenliği".
- [ ] **P0 — Staging yok.** Değişikliği gerçek veriye benzer bir yerde
  denemenin yolu yok. → VPS'te ayrı bir staging Convex deployment'ı +
  arayüz kopyası, anonimleştirilmiş veriyle.
- [ ] **P0 — Yedek yok.** Tek koruma, şirket bazında elle alınan JSON
  dışa aktarımı; geri yükleme hiç denenmedi. Kodla çözülemez, Convex
  hesabından açılır — adımlar README → "Yedek ve geri yükleme".
  - [ ] **[S]** Convex panel → production → Backup & Restore: günlük yedek.
  - [ ] **[S]** İlk geri yükleme provası (boş bir deployment'a).
  - [ ] **[K]** Göze alınan veri kaybı (RPO, ör. 24 saat) ve geri dönüş
    süresi (RTO, ör. 4 saat) — müşteri sözleşmesine girecek değerler.
- [x] ✅ **P0 — İzleme yoktu** (2026-10-03, uygulama içi ilk adım):
  çöken sayfa, yakalanmamış ekran hatası ve plan hesabı hatası `errorLog`'a
  düşer (convex/errors.ts). Aynı hata 24 saatte tek satır + sayaç; kural
  mesajları ve ağ kopmaları gönderilmez. General: Administration →
  **System errors**.
  - [ ] **[S]** Dış izleme: erişilebilirlik alarmı (ör. UptimeRobot,
    ücretsiz) ve istenirse Sentry hesabı. Hesap açılınca bağlarım.
  - [ ] **[G]** Hata olunca bildirim (e-posta) — bildirim altyapısıyla
    birlikte (bkz. 4.5).
- [ ] **P1 — Kod incelemesi yok, bus factor 1.** 51 commit'in hepsi aynı
  yazardan, hiçbiri incelenmedi.
  → Önemli değişiklik PR ile gelsin; CI yeşilse ve en az bir okuma
  yapıldıysa merge edilsin (bu, "doğrudan main" kuralını değiştirir — karar
  senin).
- [ ] **P1 — Sürüm notu yok.** "Bir güncelleme herkese aynı anda gider"
  kararı doğru, ama müşteri neyin değiştiğini bilmiyor.
  → Kullanıcıya dönük değişiklik günlüğü (sürüm notları). Riskli
  özellikler için şirket bazında aç/kapa bayrağı.
- [ ] **P1 — Bağımlılık güncelliği.** Vercel'in build'i durdurmasıyla
  öğrendik. → Dependabot / Renovate ve aylık güncelleme günü.
- [ ] **P2 — Test kalitesi.** Uçtan uca (ekran) test yok.
  - [x] ✅ vitest kapanışta takılması ve "module is not defined" gürültüsü
    giderildi (2026-10-03): testler yalın `vitest.config.ts` ile koşar
    (uygulamanın sunucu eklentileri yüklenmez); tam doğrulama ~25 sn.
  → Kritik akışlar için Playwright testleri: giriş, plan onayı, OEE
  yükleme, KPI kaydı.

### 4.2 Veri modeli ve bütünlük

- [x] ✅ **P0 — İlişkiler kodla, bütünlük yoktu** (2026-10-03). Kayıtlar
  work center'a SAP kodu (PRS-106) ile bağlı — SAP'deki gibi, kodun kendisi
  anahtar; eksik olan bütünlüktü:
  - Kullanımdaki work center artık silinmez (master data, takvim şablonu,
    mesai, istisna hafta, bakım, arıza, plan başlangıcı, plan pini, vinç
    grubu); hata nerede kullanıldığını sayar. Önceden sessizce siliniyor,
    kayıtlar sahipsiz kalıyordu.
  - **Change code**: kod değişikliği bütün bağlı kayıtlara birlikte yazılır,
    değişiklik kaydına düşer; yüklenen OEE verisi ve plan arşivi eski
    koduyla kalır (geçmiş değişmez).
  - KPI girişi olan cost center kaldırılamaz (geçmişi sessizce hesaptan
    düşerdi); work center'ı bağlı cost center kaldırılamaz.
  - [ ] **[K]** OEE geçmişi de kod değişikliğiyle yeni koda taşınsın mı?
    (Bugün taşınmaz; SAP dosyası eski kodu taşır.)
  - [x] ✅ Parça (malzeme kodu) için aynı bütünlük: kalıp bakım /
    problem / hazırlık / alarm kaydı, plan müdahalesi ya da eş ürün bağı
    olan parça silinmez, kodu değiştirilmez. Master data'da makine alanına
    elle yalnızca tanımlı work center yazılır (toplu yüklemede tanımsız olan
    Work Center Definitions'ta uyarıyla çıkar).
  - [x] ✅ CI'daki `convex/_generated` taslağı artık veri modelini şemadan
    türetir (Doc, Id, tipli query/mutation) — gerçek kod üretimine yakın.
- [ ] **P1 — Gruplama eksenleri.** Work center için hol (vinç), kategori
  (hat), bölüm (organizasyon) vardı, bir de OEE Area.
  - [x] ✅ OEE Area bölümle birleşti (K3, 2026-10-03): OEE alanı = bölüm.
  - [ ] **[G]** Hol ve kategori "teknik özellik" olarak Work Center
    Definitions'ta ayrı başlık altında toplanacak.
- [ ] **P1 — Tarihsiz organizasyon.** Bir masraf yeri başka bölüme
  taşınınca geçmiş raporlar da yeni yapıya göre toplanıyor; geçmiş
  değişiyor.
  - [x] ✅ Ağaç değişikliklerinin kaydı tutuluyor (denetim kaydı: bölüm,
    masraf yeri eski → yeni).
  - [x] Geçerlilik tarihli organizasyon gerekmiyor (K4 kararı, 2026-10-03).
- [ ] **P1 — Bölümler ad listesi.** Bugün plant kaydında metin dizisi olarak
  duruyor; hedef, sorumlu ya da yetki eklenecekse ayrı bir tablo (ID) olmalı.
- [ ] **P1 — Eski alanlar.** Şemada 8 `@deprecated` alan, kullanıcıda eski
  `role` alanı (gruplardan önceki model) hâlâ var.
  - [x] ✅ Kullanılmayan `machines` / `machinePriorities` API'leri silindi
    (2026-10-03); tablolar veri temizlenene kadar şemada.
  - [ ] **[G]** İki adımlı temizlik: (1) geçiş alanları boşaltır, (2) bir
    sonraki yayında şemadan çıkarılır (Convex, alanı taşıyan kayıt varken
    şemadan silmeye izin vermez).
- [ ] **P2 — Ortak tatil tablosu.** Resmi tatiller ülke bazında ortak;
  plant'e özel kapanış (bayram köprüsü vb.) tatil olarak girilemiyor,
  planlı duruşla çözülüyor.

### 4.3 Güvenlik ve erişim

- [x] ✅ **P0 — Zayıf parola kuralı** (2026-10-03): yeni parola en az 8
  karakter, harf + rakam, kullanıcı adı / `admin` olamaz (sunucu ve ekran
  aynı kural). Art arda 5 hatalı parolada 15 dk kilit, değişiklik kaydına
  yazılır; creator yeni parola verince kilit kalkar. Giriş ekranı artık
  `admin/admin` ipucunu yalnızca boş kurulumda gösterir (önceden her zaman
  gösteriyordu). Eski kısa parolalar çalışmaya devam eder.
  - [x] Eski kısa parolalar zorla değiştirilmez (K6 kararı, 2026-10-03).
- [ ] **P1 — Kurumsal kimlik yok.** Müşteriler Azure AD / Google ile
  girmek isteyecek; parolayı creator elle veriyor, "parolamı unuttum" yok.
  → SSO (OIDC) ve e-postayla davet / parola sıfırlama.
- [x] ✅ **P1 — Denetim kaydı eksikti** (2026-10-03): `auditLog` tablosu
  (convex/audit.ts). Kayda düşenler: holding, şirket (ad, modül, askı,
  holding, silme), plant (ad, ülke, saat dilimi, kapalı modül, bölüm, masraf
  yeri), kullanıcı (açma, değişiklik, silme), grup, parola verme /
  değiştirme, giriş kilidi. Her kayıtta kim, ne zaman ve eski → yeni değer
  var. Ekran: şirket panelinde **History**, General için **Platform
  history**. Ekrandan silinmez.
  - [ ] **[G]** Dışa aktarma (CSV) ve saklama süresi kararı.
- [ ] **P2 — Yetki yalnızca plant × modül.** Bölüm ya da masraf yeri
  bazında yetki yok; onay akışı da yok (ör. master data ya da plan onayında
  dört göz).
- [ ] **P2 — Kişisel veri.** Kullanıcı adı ve e-posta, KPI'da devamsızlık
  gibi hassas veriler var; saklama süresi ve KVKK/GDPR metni yazılı değil.

### 4.4 Kod ve dokümantasyon düzeni

- [ ] **P1 — Dağınık karar defteri.** Kararlar 7 dosyaya yayılmış
  (decisions, oeedashboard 509 satır, plant-genisletme 473 satır …).
  "Açık sorular" bölümlerinin çoğu aslında cevaplanmış.
  - [x] ✅ README yeniden yazıldı (2026-10-03): belgeler haritası,
    organizasyon, doğrulama, yayın, yedek, izleme, güvenlik, yeni plant
    kurulumu. Açık işler yalnızca bu dosyada.
  - [ ] **[G]** Kararları tek "karar günlüğü"ne (tarih + karar + gerekçe)
    taşımak; eski "Açık sorular" bölümlerini kapatmak.
- [ ] **P1 — Dev dosyalar.** İncelemek ve değiştirmek zor.
  - [x] ✅ `planlama.tsx` 2000 → 955 satır (2026-10-03): geç işler, plan
    başlangıcı, veri kapsamı, bağımsız denetim / optimizasyon ve özet
    panelleri `src/components/plan/` altına taşındı (davranış aynı).
  - [x] ✅ `platform.tsx` → `src/components/org/OrgAdmin.tsx` + ince
    `/admin` ve `/settings` sayfaları (2026-10-03).
  - [ ] **[G]** `takvim.tsx` 1371 satır: 1100 satırı tek bileşen
    (PressCalendarSection) ve iç durumu paylaşıyor — mekanik taşıma değil,
    yeniden düzenleme ister; gerçek veriyle ekran testi gerektiği için ayrı
    ve dikkatli yapılacak.
  - [ ] **[G]** Motor: `scheduler.ts` 2146, `planValidator.ts` 2005 —
    kural modüllerine bölünecek (validator bağımsızlığı korunarak; yoğun
    testli olduğu için ayrı ve dikkatli bir iş).
- [x] ✅ **P1 — Sunucuda tip yoktu** (2026-10-03). Bütün sarmalayıcılar
  (`guardedQuery/Mutation`, `userQuery/Mutation`, `plantInternal*`) tipli
  bağlam verir; fabrikaya kilitli veritabanının kendi tipi var
  (convex/lockedDbTypes.ts: fabrika tablosunda indeks `plantId`'siz başlar).
  180 handler'ın 179'u derlemede denetleniyor (kalan: plan motoru action'ı).
  Tablo adını parametre alan genel kodlar (dışa aktarım, silme, geçiş, SAP
  yüklemesi, OEE tarih tabloları) bilerek gevşek ve yorumla işaretli.
  Denetimin bulduğu küçükler düzeltildi (boşluk kontrolleri, ölü koşul).
  - [ ] **[G]** Handler içindeki yerel `Any` değişkenleri kademeli kaldırma.
  - [ ] **[G]** ESLint (projede lint yok).
- [ ] **P2 — Ad karmaşası.** (Menüde kalan "Presses" → "Work Centers"
  düzeltildi, 2026-10-03.) Ekran "work center" diyor; tablo `presses`,
  alan `press`. Rotalar Türkçe (`/makineler`, `/takvim`, `/referanslar`),
  arayüz İngilizce, yorumlar Türkçe.
  → Rotaları İngilizceye çevir (eski adresler yönlendirsin); kodda
  `workCenter` adını kademeli kullan.
- [ ] **P2 — Tek dil.** Arayüz yalnızca İngilizce; kullanıcılar Türk ve
  Rumen. → Dil katmanı (i18n); önce TR / EN.

### 4.5 Ürün

- [x] ✅ **Header ve menü karışıktı** (2026-10-03): tek üst çubuk her
  alanda aynı (logo · modül ▾ · modül menüsü · Şirket › Plant ▾ ·
  kullanıcı ▾); PlanningExpert'te "System" ve tek sayfalık "Analysis"
  grupları kalktı (Performance ve Decision Log → Planning); telefonda
  çekmece. Tanım tek yerde: `src/lib/navigation.ts`.
- [x] ✅ **Menüde hâlâ çok alt menü vardı** (2026-10-04): menü ağaç oldu
  (çubuk → menü → alt menü). PlanningExpert çubuğunda yalnızca Plan,
  Overview ve "Menu ▾"; menüde dört grup (Analysis, SAP data, Master data,
  Help), her grubun sayfaları sağ bölmede. OEE ve KPI de aynı düzende.
  Telefonda gruplar katlanır. Test: `src/lib/navigation.test.ts`.
- [x] ✅ **Work Center Definitions yeniden kuruldu** (2026-10-04): holding
  sayfası düzeninde — solda ağaç (Cost centers / Categories / Halls
  görünümleri), sağda seçilen düğümün paneli (sayılar, düzenlenebilir
  tablo, o düğüme hazır "Add a work center").
  - Kategori önerileri koddan silindi; kategoriler plant'in listesinde
    (`lookups`, kind `workCenterCategory`) ve bu sayfada oluşturulur,
    yeniden adlandırılır (work center'larıyla birlikte), boşsa silinir.
  - Hol isteğe bağlı: boş hol = kimseyle vinç paylaşmaz (`src/lib/hall.ts`,
    plan girdisinde uygulanır); başlıkta i ile nasıl çalıştığı anlatılır.
- [x] ✅ **Koddaki başlangıç listeleri kaldırıldı** (2026-10-04):
  `lookups.seedDefaults` ve "Fill with common defaults" düğmesi yok; bütün
  seçim listelerini kullanıcı tanımlar.
- [x] ✅ **Coil fed → Frequency stop** (2026-10-04): work center'ın
  frekansiyel duruşu plant'in listesinden seçilir (Coil setup, Fixture setup
  … ya da — none —; robot hattı, kataforez). Alan `presses.frequencyStop`;
  plan motoru yine `feedsCoil`'e bakar (ad seçilince açık). Master Data
  "Frequency stop time", Gantt, plan kontrolleri ve Planning Logic metinleri
  güncellendi; Excel'de eski "Coil Setup Time" başlığı da okunur.
  - [ ] **[G] Frekansiyel duruşun sıklığı.** Bugün aralık her zaman ruludan
    gelir (rulo ağırlığı ÷ brüt ağırlık). Fikstür setup'ı gibi rulosuz
    duruşlar için parça başına "kaç adette bir" alanı gerekir (Master Data'da
    yeni sütun, motor `piecesPerCoil` yerine onu okur). Kullanıcı bu
    hatları planlayacağı zaman yapılmalı.
- [x] ✅ **Yönetim sayfaları ayrıldı** (2026-10-03): `/admin`
  Administration (yalnızca General: holding, şirket, General, platform
  geçmişi, sistem hataları), `/settings` Company settings (creator:
  organizasyon, kullanıcı ve gruplar, seçim listeleri, geçmiş — holding /
  şirket yönetimi yok), `/account` My account (herkes: izinler, parola).
  Eski `/platform`, `/yonetim` yönlendirir.

- [x] ✅ **Kurulum listesi organizasyonu kapsamıyordu** (2026-10-03
  düzeltildi): yeni adım "Departments and cost centers"; work center adımı
  ancak her work center bir masraf yerine bağlıysa tamamlanır.
- [x] ✅ **Yetki matrisi genişletildi, ayrı sayfa** (2026-10-04): `/users`
  Users & permissions — şirket → grup → kullanıcı ağacı; modül içinde alan
  bazında yetki (PlanningExpert: Plan & rules / Master data / Work calendar /
  SAP data; OEE: data / settings; Die: problems / maintenance; Machine:
  breakdowns / maintenance; KPI: entry). Sunucu her yazmada alanı denetler.
  Eski gruplar aynen çalışır (alan yazılmamışsa modülün seviyesi).
  - [ ] **[G]** Sayfalardaki düzenleme düğmelerini alan iznine göre gizleme
    (bugün sunucu reddeder ve nedenini söyler; OEE yükleme ve KPI girişi
    alana bakıyor).
- [x] ✅ **Pres dışı hatlar ayrıldı** (2026-10-05): work center'da Model =
  Stroke (pres) / Cycle (punta, robot, montaj, kataforez). Her hattın plan
  yapısı farklıdır, birleştirilmez: pres motoru yalnızca pres hatlarını ve
  ana makinesi pres olan parçaları (talep, stok, takvim) planlar; çevrim
  hatları ve parçaları pres planına girmez (planda tek satır uyarı).
  Çevrim parçasının tanımı: çevrim süresi, dakika / adet, 3 hane
  (`products.cycleMinutes`), "her N adette" frekansiyel duruş. Pres
  parçası → punta hattı bağı bugün kurulmaz.
  Hesap kontrolü: eş ürün adedi ve kapasite tahmininde eşin kendi göz sayısı
  kullanılmıyordu (düzeltildi: vuruş × eşin gözü; kapasitede iki ürünün
  vuruşunun büyüğü). Plan Logic formülleri motorla aynı yazıldı.
  - [ ] **[K] Çevrim hatlarının planı.** Ayrı plan sayfası (talep × çevrim
    süresi ↔ hat kapasitesi, iş listesi). Kullanıcı "şimdilik plan dışı"
    dedi (2026-10-05).
  - [ ] **[G] Pres → punta bağı (ileride).** Punta / montaj parçasının pres
    bileşenleri (ürün ağacı) ve bağımlı talep; kullanıcı ileride ister.
- [ ] **P2 — SAP entegrasyonu elle.** ZPP / MB52 / MB51 Excel'le yükleniyor.
  → Zamanlanmış içe alma (SAP export klasörü ya da API) ve "veri ne kadar
  eski" göstergesi.
- [ ] **P2 — Bildirim yok.** Alarm, geciken iş ya da kalıp ömrü için
  e-posta / mobil bildirim yok; kullanıcı sayfayı açınca görüyor.

## 5. Yönetici gözüyle değerlendirme — CEO ve üretim direktörü (2026-10-05)

Soru: "Bu programı açtığımda bugün neye karar vermem gerektiğini, neden ve
ne kadar acil olduğunu görüyor muyum? Gördüğüm rakama güvenebilir miyim?"
Cevap bu değerlendirmeden önce **hayır**dı.

### 5.1 Ağır eleştiriler

1. **Ana sayfa bir menüydü, yönetim ekranı değil.** Portal yalnızca modül
   kartları (1, 2, 3 …) gösteriyordu. Bir CEO / direktör bir şey öğrenmek
   için beş sayfa gezmek zorundaydı; gezmiyorsa program onun için yoktu.
2. **Overview kayıt sayıyordu, risk değil.** "Materials 812, Demand records
   640" bir yöneticiye hiçbir şey söylemez. Söylemesi gereken: hangi müşteri
   teslimatı, kaç saat geç, neden, kim ne yapmalı. Üstelik sayfa binlerce
   parça / talep / stok satırını tarayıcıya indiriyordu (yavaş, ölçeklenmez).
3. **Gecikmenin "kaçınılmaz mı, sıralama mı" ayrımı gömülüydü.** Motor bunu
   kanıtlıyor (kapasite alt sınırı) ama yalnızca plan kontrolünün içinde.
   Fazla mesai ve alternatif makine kararı tam bu bilgiye dayanır.
4. **Verinin tazeliği görünmüyordu.** Plan elle yüklenen SAP dosyalarıyla
   kuruluyor; dosya 3 gün eskiyse plan 3 gün eski bir dünyayı planlıyor ve
   ekran bunu söylemiyordu. Yanlış veriyle verilen doğru görünümlü karar en
   pahalı hatadır.
5. **Sessiz hata.** Plan hesabı hata verirse ya da takılırsa yalnızca plan
   sayfasının içinde görünüyordu.
6. **Aksiyon sahipliği yok.** Geç parça için öneri var ("fazla mesai",
   "P3'e al") ama kim karar verdi, ne zaman, sonuç ne — kayıt yok. Aynı
   gecikme her sabah yeniden "keşfediliyor".
7. **Bildirim yok.** Kritik durumda program kimseyi aramıyor; sayfayı açanı
   bekliyor.
8. **Plana uyum (plan vs gerçekleşen) yönetim seviyesinde ölçülmüyor.**
   Performance sayfası var ama hedefi, trendi ve Board'da yeri yok. Planı
   olmayan değil, planına uymayan fabrika batar.
9. **Fazla mesainin maliyeti görünmüyor.** Plan fazla mesaiyi kullanıyor;
   haftalık mesai saati / maliyeti ve "mesaisiz kaç parça geç kalırdı"
   karşılaştırması yok.
10. **Çok fabrikada teslimat riski toplanmıyor.** Board KPI ve OEE
    gösteriyor; "holding genelinde bu hafta kaç teslimat riskte" yok.
11. **SAP elle, dil İngilizce, tek kişi bağımlılığı** (4.4, 4.5'te de):
    yüklemeyi yapan kişi tatile çıkınca plan bayatlıyor.

### 5.2 Alınan tedbirler (bu adımda)

- [x] ✅ **Today paneli** (portal ana sayfası ve Overview üstü,
  `src/lib/cockpit.ts`, `convex/cockpit.ts`): kayıt sayısı değil karar
  sinyali, en kritik önce, her kart sorunun sayfasını açar:
  - geç parçalar: adet, toplam gecikme saati, en kötü 3'ü ve motorun önerisi;
  - "N tanesini hiçbir plan kurtaramaz" (kanıtlı kapasite alt sınırı) —
    fazla mesai / başka makine kararı; geri kalanı sıralama;
  - önümüzdeki 2 haftada kapasitesi aşılan makineler (ve takvimsiz talep);
  - planı tutan kalıp ve makineler;
  - eski / hiç yüklenmemiş ZPP ve MB52 (36 saat);
  - son plan hesabı hata verdi ya da plan 3 saatten eski;
  - bağımsız plan kontrolünün bulduğu kural ihlalleri;
  - duran makineler, açık kalıp problemleri.
  Yalnızca kullanıcının izinli modüllerinin sinyalleri; sunucu yalnızca
  planın özetini okur (hızlı).
- [x] ✅ Sayfalar arası kısayollar ve kayıt bağlantıları (parça → Master
  Data, work center → Work Center Definitions) — yönetici bir sinyalden
  kaynağına iki tıkla iner.

### 5.3 Karşı tedbirler — sırada (karar ya da büyük iş)

- [ ] **P1 — Aksiyon kaydı (K13).** Geç parça / darboğaz sinyaline "karar":
  sahibi, karar (mesai, makine değişimi, müşteriye bilgi), hedef tarih,
  sonuç. Today kartında "kararı verildi / bekliyor". Haftalık: kaç gecikme
  zamanında yakalandı.
- [x] ✅ **Günlük özet (K14)** (2026-10-05): Company settings → Today & daily
  digest — açık/kapalı, saat (plant saati), günler, To / Cc (kullanıcılardan
  ya da adres), içerik (sinyal türleri), "yalnızca sorun varsa", önizleme,
  deneme gönderimi, son gönderim sonucu. Her 15 dakikada bir bakılır, günde
  bir kez gider (convex/digest.ts, tenancy.digestTick).
  - [ ] **Senin yapacağın:** Resend hesabı + gönderen alan adı doğrulaması;
    Convex ortam değişkenleri `RESEND_API_KEY`, `DIGEST_FROM`, (isteğe
    bağlı) `APP_URL`. Anahtar programda / veritabanında tutulmaz.
  - [ ] Kritik sinyalin gün içinde anında gitmesi (bugün yalnızca günlük).
- [ ] **P1 — Plana uyum KPI'ı (K15).** Haftalık plan vs gerçekleşen (MB51),
  hedefi, Board'da trendi; fabrika karşılaştırmasında.
- [ ] **P2 — Fazla mesai görünürlüğü.** Haftalık planlanan mesai saati,
  "mesaisiz geç kalacak parça" farkı (motor iki kez koşar), Today'de tek satır.
- [ ] **P2 — Holding geneli teslimat riski.** Board'da plant başına Today
  özeti (geç parça, darboğaz, veri yaşı).
- [x] ✅ **Eşikler ayara** (2026-10-05): Today eşikleri (eski SAP verisi,
  eski plan, kapasite aşımı %, kaç hafta) plant ayarı; boşsa başlangıç değeri
  (`TODAY_DEFAULTS`).

