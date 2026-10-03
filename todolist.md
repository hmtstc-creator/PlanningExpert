# PlanningExpert — yapılacaklar listesi

Tek liste. Dağınık duran açık notlar buraya toplandı (2026-10-03); her
maddenin yanında geldiği yer yazıyor. Bir madde bitince ✅ ile işaretlenir,
yeni karar ilgili docs dosyasına da yazılır. Kısaltmalar: **[S]** sen
(planlamacı / site sahibi) yaparsın · **[K]** karar gerekiyor · **[G]**
geliştirme.

---

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
- [ ] **[K]** Bölüm ile OEE **Area** birleşsin mi? Şu an iki ayrı gruplama
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
- [ ] **[K] P0 — VPS'e taşıma: Convex nerede çalışacak?** A) arayüz VPS +
  Convex Cloud, B) hepsi VPS (self-hosted Convex + Postgres). Karşılaştırma
  ve adımlar: docs/deployment.md. B seçilirse yedek ve izleme tamamen bizde.
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
  mesajları ve ağ kopmaları gönderilmez. General: Companies and plants →
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
- [ ] **P2 — Test kalitesi.** Uçtan uca (ekran) test yok; vitest kapanışta
  takılıyor ("something prevents Vite server from exiting") ve
  "module is not defined" gürültüsü var.
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
- [ ] **P1 — Dört ayrı gruplama ekseni.** Work center için hol (vinç),
  kategori (hat), bölüm (organizasyon) ve OEE Area var. Kullanıcı hangisinin
  neye yaradığını bilmek zorunda.
  → Area'yı bölümle birleştir ya da Area'yı bölümden türet. Hol ve
  kategoriyi "teknik özellik" olarak ayrı bir başlık altında topla.
- [ ] **P1 — Tarihsiz organizasyon.** Bir masraf yeri başka bölüme
  taşınınca geçmiş raporlar da yeni yapıya göre toplanıyor; geçmiş
  değişiyor.
  → "Geçerlilik başlangıcı" olan organizasyon kayıtları. En azından ağaç
  değişikliklerinin kaydı tutulsun.
- [ ] **P1 — Bölümler ad listesi.** Bugün plant kaydında metin dizisi olarak
  duruyor; hedef, sorumlu ya da yetki eklenecekse ayrı bir tablo (ID) olmalı.
- [ ] **P1 — Eski alanlar.** Şemada 8 `@deprecated` alan, kullanıcıda eski
  `role` alanı (gruplardan önceki model) hâlâ var.
  → Bir kerelik geçişle temizle; iki yetki modeli yan yana durmasın.
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
  - [ ] **[K]** Eski kısa parolaları bir sonraki girişte değiştirmeye
    zorlayalım mı?
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
- [ ] **P1 — Dev dosyalar.** `planlama.tsx` 2000, `scheduler.ts` 2146,
  `planValidator.ts` 2005, `takvim.tsx` 1371, `platform.tsx` ~1200 satır.
  İncelemek ve değiştirmek zor.
  → Sayfaları bileşenlere, motoru kural modüllerine böl.
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

- [x] ✅ **Kurulum listesi organizasyonu kapsamıyordu** (2026-10-03
  düzeltildi): yeni adım "Departments and cost centers"; work center adımı
  ancak her work center bir masraf yerine bağlıysa tamamlanır.
- [ ] **P2 — SAP entegrasyonu elle.** ZPP / MB52 / MB51 Excel'le yükleniyor.
  → Zamanlanmış içe alma (SAP export klasörü ya da API) ve "veri ne kadar
  eski" göstergesi.
- [ ] **P2 — Bildirim yok.** Alarm, geciken iş ya da kalıp ömrü için
  e-posta / mobil bildirim yok; kullanıcı sayfayı açınca görüyor.
