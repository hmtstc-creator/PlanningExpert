# PlanningExpert — kararlar ve bekleyen işler

Planlamacıyla netleşen kurallar. Kod bu kurallara uymalı; değişiklik ancak
planlamacı yeni bir karar verirse yapılır. Tarih: 2026-09-26.

## Çalışma kuralı

- Kararlar konuşularak netleşir, bu dosyaya yazılır.
- Kod ancak planlamacı "programı düzelt" dediğinde değiştirilir, sonra commit
  ve push (main) yapılır.
- Programda kullanıcının girmediği sabit sayı ya da koşul varsa planlamacıya
  sorulur: programda mı kalsın, kullanıcı mı tanımlasın.
- Her girdi tek kaynaktan gelir ve ilişkilidir. Elle, kodda sabit tanım
  (ör. "106 + 107 toplamı") yapılmaz; ilgili tanımdan türetilir.

## Onaylanan kararlar

### Veri ve tek kaynak
- Master data ana listedir.
- Ayarların varsayılanları tek yerdedir (`src/lib/settingsDefaults.ts`).
- Kapasite tek formülle hesaplanır (`src/lib/capacityModel.ts`): şablon,
  istisna hafta, tatiller, planlı duruşlar. Plan, Work Calendar, Capacity
  Dashboard ve Performance aynı sonucu gösterir.
- Molalar = Work Calendar'daki planlı duruşlar (çay, yemek, devir). Ayrı bir
  "vardiya başı mola" alanı gerekmez; eski alan kullanılmaz.
- Günlük vardiya süresi kopyası kaldırıldı; vardiya süresi tek yerde.
- Pres tonajı kaldırıldı.
- Çevrim süresi kullanılmaz (hesap SPM ve göz sayısıyla).

### Depolar (Storage Locations matrisi)
- Satır = depo, sütun = neye sayılır: bitmiş ürün, hammadde, üretim girişi
  (MB51). Varsayılan: 2009 ve 1009 bitmiş ürün ve hammadde; 2009 üretim girişi.
- Depo "Category" sütunu kaldırılacak (yalnızca açıklamaydı; tikler karar
  verir). → uygulanacak
- MB52 "Transit" sütunu kullanılmaz; yoldakiler yalnızca yoldakiler Excel
  listesinden gelir.

### MB51
- Üretim adedi = üretim girişi deposuna (2009) 101 hareketleri + 102
  hareketleri (102 eksi). Actual Production, Performance, kalıp ömrü ve kalıp
  alarmları aynı kuralı kullanır.
- Hareket türü sütunu olmayan eski yüklemeler sayılmayacak. → BEKLEMEDE:
  yeni formatta MB51 yüklenip kontrol edilecek.

### Presler ve kapasite
- Hol ve kategori ayrı kavramlar olarak kalır: hol = setup ekibi ve vinç;
  kategori = hat (Gantt gruplaması ve Capacity Dashboard toplamı, ör.
  Transfer = 106 + 107, 800T).
- Capacity Dashboard grupları kategoriden gelir.
- Bir presin tek takvimi vardır: Work Calendar'daki pres düzeni (gün, vardiya,
  fazla mesai, istisna haftalar). Sayfadaki "genel çalışma günleri" tikleri
  kaldırılır; pres takvimi esastır.
- Pres düzeninde "haftada N gün" Pazartesiden başlayarak sırayla dolar
  (5 = Pzt–Cuma, 6 = Pzt–Cmt). Günler pres bazında tek tek işaretlenmez.
- Pres şablonundaki haftalık "fazla mesai vardiyası sayısı" kalkar. Mesai
  yalnızca tarihli ve bir mesai tanımıyla açılır (hangi gün, hangi tanım).
- Düzenli mesai (ör. her Cumartesi tam mesai) şablonda "tekrarlayan mesai"
  olarak bir kez tanımlanabilir; iptal edilene kadar her hafta geçerlidir.
- İstisna hafta kalır: o haftaya özel gün ve vardiya sayısı (ör. 5 yerine 3
  gün, 3 yerine 2 vardiya).
- Vardiyalar aynı uzunluktadır ve ilk vardiyanın başlangıcından itibaren art
  arda dizilir (ör. 07:00'dan 2 × 9 saat: 07:00–16:00, 16:00–01:00).
- Olağandışı yönetim: planlamacı mesaiyi hangi güne açtığını girer; plan o
  güne göre çalışır. Örnekler: resmi tatilde mesai, normal çalışma günü
  dışında mesai, haftada 2 vardiya çalışan bir prese hafta içi 3. vardiya.
  Bunun için Work Calendar'da pres bazlı gün detayı bölümü olur.
- Vardiya düzeni vardiya tanımının yapıldığı yerde detaylanır: ör. 2 × 8
  saat ya da 2 × 9 saat. Bir gün 24 saati doldurmak zorunda değildir, ama
  geçemez.
- Capacity Dashboard'dan açılan fazla mesai o presin Work Calendar kaydını
  günceller (aynı kayıt; zaten böyle).
- Sınırlar: bir gün 24 saati, bir presin haftası 168 saati (7 × 24) geçemez;
  planlı duruşlar dahil. Aşan kayıt Work Calendar'da da Capacity
  Dashboard'da da reddedilir ve mesaj gösterilir.
- Work Calendar düzeni tanımlanmamış presin kapasitesi 0'dır; plan sayfasında
  kırmızı alarm çıkar. Program kendiliğinden vardiya uydurmaz. → uygulanacak
- Dondurulmuş gün hem genel hem pres bazında kalır (pres değeri geneli ezer).
- Parça performansı (master data) ve kapasite katsayısı (Performance) ikisi de
  kalır. Capacity Dashboard'da seçim: A) kabul edilen oran — tek bir oran,
  Capacity Dashboard'da tanımlanır, yalnızca o görünümde kullanılır, planı
  değiştirmez; B) master data'daki parça performansı. İkisi aynı yöntemle
  hesaplanır: kapasite olduğu gibi, üretim süresi = ideal süre ÷ oran.

- Vardiya tablosu fabrika genelinde bir kez tanımlanır (ör. 1. vardiya
  07:00–15:00, 2. 15:00–23:00, 3. 23:00–07:00); her pres kaç vardiya
  çalıştığını seçer.
- Mesai tanımları: farklı türler tanımlanır (ör. tam mesai, yarım mesai).
  Alanlar: ad, açıklama (ör. hafta içi / hafta sonu mesaisi), başlangıç
  saati, süre. Örnek: "Tam mesai — hafta sonu, 07:00, 8 saat". Mesai
  açılırken bu tanımlardan biri seçilir.
- Mesai saatlerine denk gelen planlı duruşlar (çay, yemek) mesaiden de
  düşülür.
- Normal düzen dışındaki her çalışma mesaidir; ör. 2 vardiyalı prese hafta
  içi açılan 3. vardiya raporlarda "mesai" görünür. Hangi güne açıldığı
  Work Calendar'da işaretlenir.
- Resmi tatil tatildir: o günün normal vardiyaları başka güne kaymaz.
  Çalışılacaksa mesai açılır.

### İş günü (presler dışındaki hesaplar)
- Teslim hesabında resmi tatiller kullanılmaz: müşteri tatil günü mal
  isteyebilir; o gün hazır değilse gecikme görünür.
- Bakiye ve bugünün ihtiyacı ertesi gün 08:00'de teslim sayılır (hafta sonu
  ve tatil fark etmeksizin).
- Presler dışındaki iş günü = tatil olmayan ve en az bir presin normal
  vardiyası olan gün; mesai iş günü saymaz (onaylandı).
- Tekrarlayan mesai resmi tatilde çalışmaz; tatilde mesai tarihli açılır
  (onaylandı).
- Hammadde (10 iş günü) ve acil hammadde (3 iş günü) iş günüyle sayılır.
- Haftalık talebin günlere dağıtılması: ZPP_DAILY varsa ZPP haftalığı ezer;
  ZPP_DAILY'nin ulaşmadığı tarihlerde haftalık talep takvime göre dağıtılır.

### Setup
- Normal: holde tek setup, fabrikada aynı anda 1; iki setup arası 10 dk.
- Acil (ZPP bakiyesi + teslim saatine yetişemeyecek iş): fabrika genelinde,
  hol ayrımı olmadan en fazla 2 setup aynı anda.
- Setup çay/yemek molasında bölünmez.

### Hammadde
- Plandan bağımsız MRP; mamul stoğu FIFO düşülür, eş ürün bir kez sayılır.
- Arz = eldeki rulo (hammadde tikli depolar) + yoldakiler (varış haftası).
- Emniyet: her hafta sonunda sonraki 10 İŞ GÜNÜNÜN hammaddesi elde olmalı
  (satınalma yönetimi). Plandaki mamul emniyet stoğu (1 iş günü, saha
  yönetimi) ayrı bir ayardır; ikisi karıştırılmaz.
- Talep yoksa sipariş yok (kanban ileride).
- Sipariş maili: Outlook taslağı (.eml); şifre saklanmaz.
- Acil hammadde süresi (şu an 3 iş günü) Work Calendar'da ayarlanabilir
  olacak. → uygulanacak

## Aksiyon listesi

Uygulandı (2026-09-26, "programı düzelt"):

1. ✅ Depo matrisinden Category sütunu kaldırıldı (geçişte mevcut etkisi tiklere yazıldı).
2. ✅ Capacity Dashboard'a performans seçimi: A) kabule göre, B) master data parça performansı.
3. ✅ Acil hammadde süresi Work Calendar'da ayarlanabilir (varsayılan 3 iş günü).
4. ✅ Work Calendar düzeni olmayan pres: kapasite 0 + Plan sayfasında kırmızı alarm.
5. ✅ Genel çalışma günü tikleri kaldırıldı; pres günleri Pazartesiden sırayla. Şablondaki
   haftalık mesai sayısı kaldırıldı.
5a. ✅ Geçiş: mevcut fazla mesai sayıları silinir (bir sonraki plan hesabında, bir kez).
6. ✅ Work Calendar'da her haftaya gün detayı ("Days / overtime"): tarihli mesai açma ve
   kaldırma. Capacity Dashboard'daki hafta düzenleyicisi aynı bileşeni ve kaydı kullanır.
7. ✅ Vardiya tablosu (ilk vardiya saati + vardiya süresi, art arda). Gün ≤ 24 saat;
   aşan düzen, istisna hafta ve mesai kaydedilmez, mesaj gösterilir.
8. ✅ Mesai tanımları (ad, açıklama, başlangıç, süre); tarihli ve tekrarlayan mesai;
   planlı duruşlar mesaiden de düşülür.
9. ✅ Resmi tatilde normal vardiya başka güne kaymaz.
10. ✅ Teslimde tatil gözetilmez; bakiye ve bugünün ihtiyacı ertesi gün 08:00.
11. ✅ Presler dışındaki iş günü = tatil değil ve en az bir presin normal vardiyası var
    (hammadde, acil hammadde, talep dağıtımı).
12. ✅ Etkisiz "14 gün stok = acil" kodu kaldırıldı.
13. BEKLEMEDE: MB51'de hareket türü olmayan eski satırları sayma (yeni format yüklenince
    kontrol).

Ek düzeltme: aynı işin iki rulo değişimi gün sınırında (07:00) 30 dakikadan yakın
düşebiliyordu; vinç kontrolü artık önceki günün kendi rezervasyonlarını da görür.

## Açık sorular

- Koddaki sabit sayılar: `docs/fixeddefinitions.md` — ileride
  değerlendirilecek.
