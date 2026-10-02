# Plant genişletme — çok şirket / çok fabrika (kiralama)

Durum: **UYGULANDI — aşama 1–5 (2026-10-02).** Planlamacı (2026-10-02):
"önemli olan sistem, sistemi genişlet". Kalan: aşama 5 (hard coding
temizliği + kurulum listesi), 6 (dışa aktarım, 90 gün sonra silme), 7
(karşılaştırma ekranı). Ayrıntı en altta "Uygulama".

## Amaç (planlamacı / site yöneticisi)

- Site yöneticisi ürünü kiralar: "yeni fabrika ekle" dediğinde o fabrikaya ait
  ayrı bir veri alanı oluşur.
- Bir kullanıcıya o fabrikanın **creator** yetkisi verilir; creator fabrikayı
  yöneticinin bugün kurduğu gibi kurar ve yönetir.
- İki fabrikanın verileri **asla karışmaz**.
- Kodda fabrikaya özel değer (**hard coding**) olmaz; filtreler, grafikler ve
  kurallar her fabrikada kendi tanımlarıyla doğru çalışır.

## Bugünkü durum (neyin değişmesi gerekiyor)

- Veritabanında 46 tablo var; **hiçbirinde "hangi fabrika" bilgisi yok.**
  Bütün veri tek fabrikaya ait varsayılıyor.
- Tek kayıtlık ayarlar `key: 'default'` ile tutuluyor (genel ayarlar, iş
  takvimi, OEE ayarları, plan durumu …; 7 dosyada 24 yer).
- Plan motoru tek plan hesaplıyor; saat başı çalışan zamanlayıcı tek fabrika
  için.
- Kullanıcıların tek rolü var (admin, planner, maintenance, viewer); rol
  fabrikaya bağlı değil.
- Kodda hâlâ fabrikaya özel varsayılanlar var (docs/fixeddefinitions.md):
  ülke `RO`, saat dilimi `Europe/Bucharest`, sayılan depolar `2009` / `1009`,
  üretim girişi deposu `2009`, boş hol adı `Hall 1`, ilk kurulum kullanıcısı
  `admin/admin`. OEE tarafı bunlardan temizlendi (Settings sayfası).

## Üç seçenek

| | A) Her fabrikaya ayrı sistem | B) Tek sistem, her kayıtta fabrika anahtarı | C) Karma |
|---|---|---|---|
| Nasıl | Her müşteri için ayrı veritabanı ve adres | Tek veritabanı; her tabloda `plantId`, her sorgu otomatik o fabrikayla sınırlı | B ile başla; büyük / özel müşteri ayrı sisteme taşınabilir |
| Karışma riski | Yok (fiziksel ayrı) | Kod hatasına bağlı → merkezi koruma ve testle sıfırlanır | B gibi |
| "Fabrika ekle" | Yeni sistem kurmak gerekir (dakikalar, ayrı maliyet, ayrı güncelleme) | Bir kayıt: anında hazır | Anında; istenirse ayrı sistem |
| Güncelleme | Her sisteme ayrı ayrı | Tek seferde herkese | Çoğu tek seferde |
| Maliyet | Fabrika sayısıyla artar | Düşük | Düşük, istisna hâlinde artar |
| Yönetici paneli | Sistemler arası ayrı iş | Tek panelden bütün fabrikalar | Tek panel |

**Öneri: B (C'ye açık).** "Fabrika ekle" düğmesiyle anında çalışan bir yapı
ancak B ile mümkün; karışma riski aşağıdaki merkezi korumayla ve otomatik
testle kapatılır.

## Taslak (B)

### 1. Kavramlar

- **Platform sahibi** (sen): fabrika ekler, creator atar, fabrikayı askıya
  alır, kullanımı görür.
- **Fabrika** (`plants`): ad, kısa kod, ülke, saat dilimi, durum (aktif /
  askıda / kapalı), açılış tarihi, açık modüller.
- **Üyelik** (`memberships`): kullanıcı × fabrika × rol. Bir kişi birden çok
  fabrikada olabilir (ör. danışman), her birinde farklı rolle.
- **Fabrika içi roller:** `creator` (fabrikanın sahibi/kurucusu — bugünkü
  admin'in fabrika içindeki her yetkisi + kullanıcı ekleme), `admin`,
  `planner`, `maintenance`, `viewer`.
- **Aktif fabrika:** oturum hangi fabrikada çalıştığını bilir; üst çubukta
  fabrika seçici (birden çok üyeliği olan için).

### 2. Verinin ayrılması (en kritik kısım)

- Fabrikaya ait **her** tabloya `plantId` eklenir; **her** index `plantId` ile
  başlar (ör. `by_plant_date: [plantId, date]`).
- Bugünkü `guardedQuery / guardedMutation` sarmalayıcısı, oturumdaki aktif
  fabrikayı ve kullanıcının o fabrikadaki rolünü doğrular ve işleve yalnızca
  **fabrikaya kilitli bir veritabanı erişimi** verir:
  - okuma: her sorgu otomatik `plantId = aktif fabrika` ile başlar,
  - yazma: eklenen kayda `plantId` otomatik konur,
  - güncelleme / silme: kaydın `plantId`'si aktif fabrika değilse reddedilir.
  İşlevlerin kendisi `plantId` yazmaz — unutulamaz.
- Tek kayıtlık ayarlar `key: 'default'` yerine **fabrika başına bir kayıt**.
- Ortak (fabrikadan bağımsız) veri yalnızca açıkça listelenenler: ülke resmi
  tatilleri (referans), platform kullanıcı hesabı, fabrika listesi.
- **Otomatik güvenlik testi:** aynı kodlara sahip iki fabrika (ikisinde de
  PRS-106, aynı malzeme kodları) kurulur; her sorgu ve her sayfa verisi
  çalıştırılır, diğer fabrikanın tek bir satırının görünmediği doğrulanır.
  Ayrıca kod taraması: fabrika tablosunu kilitli erişim dışında okuyan bir
  satır varsa test kırmızı olur.

### 3. Plan motoru ve zamanlayıcı

- Plan kuyruğu, plan sonuçları ve plan durumu fabrika başına.
- Saat başı zamanlayıcı aktif fabrikaları sırayla hesaplar (dakikalara
  yayılmış); bir fabrikanın hatası diğerini durdurmaz.
- Askıdaki fabrika hesaplanmaz.

### 4. Hard coding temizliği

Kodda kalan fabrika varsayılanları fabrika açılışında sorulan ya da kurulum
sihirbazında girilen değerlere dönüşür:

| Bugün kodda | Yeni yeri |
|---|---|
| Ülke `RO`, saat dilimi `Europe/Bucharest` | Fabrika ekleme formu |
| Sayılan depolar `2009`, `1009`; üretim girişi `2009` | Storage Locations (tanımsızsa hiçbir depo sayılmaz, uyarı çıkar) |
| Boş hol adı `Hall 1` | Hol zorunlu alan |
| İlk kullanıcı `admin/admin` | Yalnızca platform ilk kurulumu; fabrikada creator davetle gelir |
| docs/fixeddefinitions.md'deki diğer sabitler | Tek tek gözden geçirilir: "program kuralı" olanlar kalır, "fabrika değeri" olanlar ayara taşınır |

### 5. "Fabrika ekle" akışı

1. Platform sahibi: **Add plant** → ad, kod, ülke, saat dilimi, açık modüller,
   creator'ın adı / e-postası.
2. Boş fabrika oluşur (hiçbir veri yok, ayarlar boş).
3. Creator giriş yapar → **Kurulum listesi** (checklist) sayfası:
   Pres tanımları → Work Calendar (vardiya, düzen) → Storage Locations →
   Master Data yükleme → SAP verileri → OEE ayarları + ilk OEE yüklemesi →
   kullanıcılar. Her adımın durumu (tamam / eksik) görünür.
4. Creator kendi kullanıcılarını ekler ve rol verir.

### 6. Platform sahibi paneli

- Fabrikalar listesi: durum, creator, kullanıcı sayısı, son yükleme, son plan
  hesabı, veri hacmi.
- Fabrikayı askıya al / aç; modül aç / kapa.
- Fabrika verisini dışa aktar (yedek / müşteri ayrılırsa) ve kalıcı sil (iki
  adımlı onay).
- Destek girişi (fabrika verisini görme) — kararına göre: hiç yok ya da
  creator izniyle, kayıtlı (log).

### 7. Mevcut verinin taşınması

- Bugünkü bütün veri **"Fabrika 1"** (Romanya Martur) olarak etiketlenir.
- Senin hesabın: platform sahibi + Fabrika 1 creator'ı.
- Mevcut kullanıcılar Fabrika 1 üyesi olur, rolleri korunur.

### 8. Aşamalar (her biri ayrı onay ve commit)

1. **Çekirdek:** fabrikalar, üyelikler, aktif fabrika, kilitli veri erişimi,
   güvenlik testi; mevcut veri Fabrika 1'e taşınır. (Görünür değişiklik yok.)
2. **Modüller tek tek:** PlanningExpert (plan, SAP, takvim, master data …),
   OEE, Die / Machine Follow-up — her tablo `plantId`'ye geçer.
3. **Plan motoru ve zamanlayıcı** fabrika başına.
4. **Platform paneli + fabrika seçici + kullanıcı daveti.**
5. **Hard coding temizliği + kurulum listesi.**
6. **Dışa aktarma / silme, kullanım göstergeleri, dokümantasyon.**

## Açık sorular

1. Seçenek B (tek sistem, fabrika anahtarı) uygun mu, yoksa her müşteriye ayrı
   sistem (A) mi istiyorsun?
2. Bir kullanıcı birden çok fabrikada olabilsin mi?
3. Bir şirketin birden çok fabrikası olursa: fabrikalar tamamen ayrı mı kalsın,
   yoksa üstte "şirket" seviyesi (ortak kullanıcı, fabrikalar arası rapor) mı
   olsun?
4. Platform sahibi (sen) fabrika verisini görebilsin mi? (hiç / creator
   izniyle, kayıtlı)
5. Bir fabrikada birden çok creator olabilsin mi? Creator başka creator
   atayabilsin mi?
6. Modüller fabrika bazında açılıp kapansın mı (PlanningExpert, OEE, Die,
   Machine) — kiralama paketi gibi?
7. Kiralama bitince: salt okunur → dışa aktarım → X gün sonra silme?
8. Adres: tek adres + fabrika seçici mi, yoksa fabrikaya özel adres
   (ör. fabrika-adi.site…) mi?
9. Kullanıcı ekleme: e-posta ile davet (e-posta servisi gerekir) mi, yoksa
   creator geçici şifreyle kullanıcı açsın mı?
10. Ücretlendirme / fatura şimdilik kapsam dışı mı?

## Kararlar (2026-09-27, planlamacı)

1. **Tek sistem** (seçenek B). Her müşteriye ayrı güncelleme yapılmaz; bir
   güncelleme herkese aynı anda gider.
2. Platform seviyesinde **General** grubu: site yöneticisiyle aynı seviye.
   Generaller bütün şirketleri ve alt şirketlerini görür.
3. Üstte **şirket** seviyesi var. Şirketteki bir kullanıcı şirketin bütün alt
   fabrikalarını görebilir; başka bir üye yalnızca bir fabrikayla kısıtlı
   kalabilir.
4. General grubu her şeyi görür.
5. Bir fabrikada / şirkette birden çok creator olabilir; creator başka
   creator atayabilir.
6. Modüller (PlanningExpert, OEE, Die, Machine) açılıp kapanabilir (kiralama
   paketi).
7. Kiralama bitince: salt okunur → dışa aktarım → belirli gün sonra silme.
8. Herkes tek adresten girer (aşağıya bakın: ayrı VPS gerekmez).
9. Kullanıcıyı creator **geçici şifreyle** açar (ilk girişte değiştirme).
10. Ücretlendirme / fatura kapsam dışı.
11. **Kullanıcı grupları** şirket ve alt şirket için tanımlanır. Örnek:
    bir alt şirketin mühendisleri, müdürleri ve fabrika müdürü yalnızca kendi
    alt şirketini görür; **Board member** grubu şirketin bütün alt
    şirketlerini görür.

## Taslak v2 — yetki modeli

### Seviyeler

```
Platform (General grubu: sen ve seninle aynı seviyedekiler)
 └─ Şirket (kiralayan müşteri, ör. "Martur")
     ├─ Alt şirket / fabrika (ör. "Romanya", "Bursa")  ← veri burada durur
     └─ Alt şirket / fabrika …
```

- **Veri her zaman bir fabrikaya aittir** (`plantId`). Şirket, fabrikaları
  bir araya getirir; iki şirketin verisi birbirini hiçbir yoldan göremez.
- Aynı şirketin iki fabrikası da ayrıdır; "şirketin tamamını görme" yetkisi
  olan kişi ikisini birden (ayrı ayrı ya da toplamda) görür.

### Kimler ne yapar

| Kim | Kapsam | Ne yapar |
|---|---|---|
| **General** (platform) | Bütün şirketler | Şirket ve fabrika açar, askıya alır, modül açar/kapar, creator atar, her şeyi görür |
| **Şirket creator'ı** | Şirketin bütün fabrikaları | Fabrika ekler, kullanıcı ve grup tanımlar, geçici şifre verir, fabrikaları kurar (bugün senin yaptığın gibi) |
| **Fabrika creator'ı** | Yalnızca kendi fabrikası | O fabrikanın kurulumu, kullanıcıları ve grupları |
| **Grup üyeleri** | Grubun kapsamı | Grubun izin verdiği ekranlar |

### Kullanıcı grupları (creator tanımlar)

Grup = **kapsam** + **ekran izinleri**:

- **Kapsam:** "şirketin bütün fabrikaları" ya da seçilen fabrika(lar).
- **Ekran izinleri:** her modül / ekran için *yok · görür · düzenler*.
  Örnek:

| Grup | Kapsam | Plan | SAP yükleme | Master data | OEE | OEE ayarları | Kalıp / Makine takip | Kullanıcılar |
|---|---|---|---|---|---|---|---|---|
| Board members | Bütün fabrikalar | görür | yok | yok | görür | yok | görür | yok |
| Fabrika müdürü – Romanya | Romanya | görür | görür | görür | görür | düzenler | görür | yok |
| Planlama mühendisleri – Romanya | Romanya | düzenler | düzenler | düzenler | görür | yok | görür | yok |
| Bakım – Romanya | Romanya | görür | yok | yok | görür | yok | düzenler | yok |

- Bir kişi birden çok grupta olabilir; izinler birleşir (en genişi geçerli).
- Modül şirket/fabrika için kapalıysa grup izni ne olursa olsun görünmez.

### Ekranda nasıl görünür

- Giriş tek adres. Kullanıcı şirketini seçmez; hesabı hangi şirkete aitse
  oraya girer.
- Üst çubukta **fabrika seçici**: yalnızca yetkili olduğu fabrikalar. Birden
  çok fabrikası olan (ör. Board member) için **"Bütün fabrikalar"** seçeneği:
  toplamı anlamlı ekranlarda (OEE, kayıp, KPI) toplam ve fabrika karşılaştırması;
  plan gibi fabrikaya özgü ekranlarda fabrika seçmesi istenir.
- Menüde yalnızca izinli ekranlar görünür; izin yoksa sunucu da reddeder
  (yalnızca menüyü gizlemek güvenlik değildir).

### Tek adres — ayrı VPS gerekir mi?

Gerekmez. Tek sistemde bütün şirketler aynı adresten girer; ayrım giriş
yapan kişinin hesabından ve verideki fabrika anahtarından gelir. Ayrı sunucu
(VPS) her şirkete ayrı kurulum ve ayrı güncelleme demektir — kararla (1)
çelişir. İleride bir şirket kendi adıyla adres isterse (ör.
martur.site-adi.com), bu aynı sisteme yönlenen bir takma ad olur; ayrı sunucu
değil. Başlangıçta gerek yok.

### Güvenlik (değişmedi, genişledi)

- Her istekte sunucu: kullanıcı → şirket → istenen fabrika → kullanıcının o
  fabrikadaki ekran izni. Biri eksikse reddedilir.
- Veriye yalnızca fabrikaya kilitli erişimle ulaşılır (taslak v1, bölüm 2).
- "Bütün fabrikalar" görünümü, sunucuda kullanıcının yetkili olduğu
  fabrikaların listesiyle sınırlı okunur.
- Otomatik test: iki şirket, her birinde iki fabrika, aynı kodlar; her rol ve
  grup için başkasının verisine erişim denenir, hepsi reddedilmeli.
- Kim neyi değiştirdi kaydı şirket bazında (bugünkü değişiklik kaydının
  genişlemiş hâli).

## Kararlar (2026-09-27, ikinci tur)

12. Alt şirket = fabrika; alt şirketin altında ayrıca fabrika seviyesi yok.
13. Creator yalnızca **şirket** seviyesinde.
14. İzinler **modül bazında**: PlanningExpert, OEE, Die Follow-up, Machine
    Follow-up — her biri için *yok · görür · düzenler*.
15. Board member için fabrikaları **yan yana karşılaştırma** ekranı yapılacak;
    içeriği sonra konuşulacak.
16. Aynı şirketin fabrikaları hiçbir şey paylaşmaz (master data, malzeme
    kodları, ayarlar ayrı).
17. Kiralama bitince silmeden önce **90 gün**.
18. General grubuna **yalnızca site sahibi** üye ekler.
19. "Kim neyi gördü" kaydı tutulmaz (değişiklik kaydı kalır).

## Son taslak (v3)

### Seviyeler ve roller

```
Platform — General grubu (site sahibi + onun eklediği generaller)
 └─ Şirket — creator(lar)
     └─ Fabrika (= alt şirket) — veri burada durur
```

| Kim | Nerede tanımlanır | Kapsam | Yetki |
|---|---|---|---|
| Site sahibi | ilk kurulum | her şey | General ekler / çıkarır + general yetkileri |
| General | site sahibi ekler | bütün şirketler | şirket ve fabrika açar, askıya alır, modül açar/kapar, creator atar, her şeyi görür |
| Creator | general atar; creator başka creator atayabilir | kendi şirketinin bütün fabrikaları | fabrika ekler/kurar, kullanıcı açar (geçici şifre), grup tanımlar, bütün modüllerde düzenler |
| Grup üyesi | creator ekler | grubun fabrikaları | grubun modül izinleri |

### Kullanıcı grubu

- **Ad** (ör. "Board members", "Romanya — planlama mühendisleri").
- **Fabrikalar:** "şirketin bütün fabrikaları" ya da seçilen fabrikalar.
- **Modül izinleri:** PlanningExpert · OEE · Die Follow-up · Machine
  Follow-up → yok / görür / düzenler.
- Bir kişi birden çok grupta olabilir; her fabrika ve modül için en geniş
  izin geçerli.
- "Bütün fabrikalar" kapsamı, sonradan eklenen fabrikayı da otomatik kapsar.

### Modül lisansı

- General, şirket için hangi modüllerin açık olduğunu belirler (fabrika bazında
  kapatılabilir). Kapalı modül kimseye görünmez; grup izni ne olursa olsun.

### Kiralama bitişi

1. General şirketi **askıya alır** → herkes salt okunur görür, yükleme ve
   plan hesabı durur.
2. **Dışa aktarım:** şirketin bütün verisi indirilebilir.
3. **90 gün** sonra kalıcı silme (general onaylı; geri alınamaz).

### Uygulama aşamaları (her aşama ayrı "programı düzelt" ve commit)

1. **Çekirdek:** `companies`, `plants`, `memberships`/`groups`, oturumda aktif
   fabrika, fabrikaya kilitli veri erişimi, izin denetimi, iki şirketli
   güvenlik testi. Bugünkü bütün veri → "Şirket 1 / Fabrika 1"; site sahibi =
   General + creator. (Görünür değişiklik yok.)
2. **Modüller fabrika anahtarına geçer:** PlanningExpert (plan, SAP, takvim,
   master data, depolar, performans …), OEE, Die / Machine Follow-up. Tek
   kayıtlık ayarlar fabrika başına.
3. **Plan motoru ve zamanlayıcı fabrika başına.**
4. **Ekranlar:** fabrika seçici, izne göre menü, General paneli (şirket /
   fabrika / modül / creator), creator paneli (kullanıcı, geçici şifre, grup).
5. **Hard coding temizliği + kurulum listesi** (ülke, saat dilimi, depolar,
   hol, ilk kullanıcı).
6. **Askıya alma, dışa aktarım, 90 gün silme.**
7. **Fabrika karşılaştırma ekranı** (içeriği ayrıca konuşulacak).

## Açık sorular (v3)

- Karşılaştırma ekranının içeriği (7. aşamadan önce konuşulacak).

## Uygulama (2026-10-02) — aşama 1–4

### Veri ve güvenlik
- Platform tabloları: `companies` (ad, durum, kiralanan modüller, askı ve
  silme tarihi), `plants` (şirket, ad, kod, ülke, saat dilimi, fabrikada
  kapalı modüller), `userGroups` (şirket, ad, bütün fabrikalar / seçilenler,
  modül izinleri), `platformState` (geçiş durumu). `users`: `platformRole`
  (owner / general), `companyId`, `isCreator`, `groupIds`. `sessions.plantId`
  = seçili fabrika.
- Fabrikaya ait **bütün** tablolarda `plantId`; her index `plantId` ile
  başlar, ayrıca `by_plant`. Ortak olanlar yalnızca: companies, plants,
  userGroups, platformState, users, sessions, officialHolidays
  (`convex/plantDb.ts` PLATFORM_TABLES).
- `convex/plantDb.ts`: kilitli veritabanı — okuma `plantId = aktif fabrika`
  ile başlar, ekleme `plantId` koyar, başka fabrikanın kaydı get'te görünmez,
  patch / replace / delete'te "Record not found". Sonuçlarda `plantId`
  dönmez (sayfalar ve dönüş doğrulayıcıları değişmedi).
- `convex/guarded.ts`: her istekte kullanıcı → oturumdaki fabrika (yoksa ilk
  yetkili) → o fabrikadaki modül izni. Okuma "görür", yazma "düzenler"
  ister. İşlevin modülü: varsayılan PlanningExpert; OEE dosyası OEE; kalıp
  dosyaları Die **ya da** PlanningExpert; makine arızası / pres bakımı
  Machine ya da PlanningExpert; pres listesi, listeler, değişiklik kaydı ve
  plan alarmları her modül. `adminMutation` = şirket creator'ı.
- Kural `src/lib/tenancy.ts` (`accessFor`): platform her şey; creator kendi
  şirketinin her fabrikası, her modül; diğerleri gruplarının en genişi;
  kapalı modül yok; askıdaki şirket en çok "görür".
- Plan motoru, kuyruk ve saat başı hesap fabrika başına
  (`tenancy.recomputeAll`: aktif şirketlerin PlanningExpert'i açık
  fabrikaları, birer dakika arayla; birinin hatası diğerini durdurmaz).
- Test: `convex/tenancy.test.ts` (convex-test) — geçiş, iki şirket aynı pres
  adlarıyla (okuma, silme, kullanıcı yönetimi denemeleri reddedilir), grup ×
  fabrika × modül izni, askı, modül kapatma. `convex/authGuard.test.ts`:
  kilitsiz sarmalayıcılar (userQuery / userMutation / ham internal) yalnızca
  tenancy.ts, users.ts, platform.ts, authInternal.ts'te.

### Geçiş (mevcut veri)
- Yeni sürüm açıldığında ilk giriş yapan kişinin ekranı geçişi başlatır
  (ilerleme çubuğu; bir kez). Bütün veri **Company 1 / Plant 1** olur; ülke
  ve saat dilimi mevcut ayardan. Silinen bir şey yok.
- En eski aktif admin = **site sahibi (owner)** + creator; diğer adminler
  creator; planner → "Planners", maintenance → "Maintenance" (ikisi de her
  modülde düzenler — bugünkü gibi), viewer → "Viewers" (görür) grubuna.
- Şirket ve fabrika adlarını owner **Companies and plants** sayfasında
  değiştirir.

### Ekranlar
- Üst çubukta **fabrika seçici** (birden çok fabrikası olana); ana sayfada
  yalnızca izinli modüller; izni olmayan sayfa açılmaz; askıdaki şirkette
  üstte "read only" bandı.
- **/platform — Companies and plants**: General şirket açar, ad / kiralanan
  modüller / askıya alma, fabrika ekler, fabrikada modül kapatır, her
  şirketin kullanıcı ve gruplarını yönetir; owner Generalleri ekler.
  Creator kendi şirketinin fabrikalarını ekler ve düzenler.
- **/yonetim — Admin**: creator için şirket kullanıcıları (creator işareti,
  gruplar, geçici şifre) ve kullanıcı grupları (fabrikalar × modül izni);
  seçim listeleri ve değişiklik kaydı fabrika bazında.
- Kullanıcı adı bütün sistemde tektir (giriş adı).

### Aşama 5 — hard coding temizliği ve kurulum listesi (2026-10-02)
- Ülke ve saat dilimi: tek kaynak fabrika kaydı (`convex/plantLocale.ts`);
  fabrika açılırken zorunlu (ISO ülke kodu, IANA saat dilimi). Work
  Calendar'da değişince fabrika kaydı da güncellenir. Saatler ekranda
  fabrikanın diliminde. Kodda dilim yoksa UTC.
- Depolar: kodda 2009/1009 yok; tiksiz depo sayılmaz, hiç "Finished goods"
  tiki yoksa plan uyarır. Mevcut kurulumun bugünkü tikleri geçişte veriye
  yazılır (LEGACY_INSTALL, `convex/tenancy.ts` — yalnızca geçiş).
- Hol: zorunlu; "Hall 1" varsayılanı kalktı.
- admin / admin: yalnızca platformun ilk kurulumu (hiç kullanıcı yokken).
- **Kurulum listesi** (creator, portal ana sayfası, `convex/setup.ts`):
  ülke/saat dilimi, Press Definitions, Work Calendar, Storage Locations,
  Master Data, SAP verisi, OEE ayarları + ilk yükleme, kullanıcılar — veriye
  bakılarak tamam / eksik; hepsi tamamsa görünmez.

### Kalan (sıradaki aşamalar)
- Aşama 6: şirket verisinin dışa aktarımı ve 90 gün sonra kalıcı silme
  (askıya alma ve silme tarihi hazır).
- Aşama 7: Board member karşılaştırma ekranı (içeriği konuşulacak).
- Platform değişiklik kaydı (kullanıcı açma / parola) bugün fabrika
  kaydında görünmüyor.
