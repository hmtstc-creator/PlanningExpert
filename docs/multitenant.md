# Çok fabrikalı yapı (kiralama) — fikir ve taslak

Durum: **taslak, kod yazılmadı.** Kararlar netleşince "Kararlar" bölümüne
yazılır, sonra uygulanır. Tarih: 2026-09-27.

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

## Kararlar

(henüz yok)
