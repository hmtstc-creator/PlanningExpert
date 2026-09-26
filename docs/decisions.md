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
- Fazla mesai varsayılan olarak normal günlerden sonraki günlere konur
  (Cumartesi, sonra Pazar).
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
  kalır. Capacity Dashboard'a seçim düğmesi eklenecek: A) kabule göre
  (Performance'ta yazılan katsayı), B) master data'daki parça performansına
  göre. → uygulanacak

### İş günü (presler dışındaki hesaplar)
- Teslim hesabında resmi tatiller kullanılmaz: müşteri tatil günü mal
  isteyebilir; o gün hazır değilse gecikme görünür.
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

## Aksiyon listesi ("programı düzelt" dendiğinde uygulanır)

1. Depo matrisinden Category sütununu kaldır.
2. Capacity Dashboard'a performans seçimi: A) kabule göre (Performance
   katsayısı), B) master data parça performansına göre.
3. Acil hammadde süresini (3 iş günü) Work Calendar'da ayarlanabilir yap.
4. Work Calendar düzeni olmayan pres: kapasite 0 + plan sayfasında kırmızı
   alarm.
5. Genel çalışma günü tiklerini kaldır; pres düzenindeki N gün Pazartesiden
   sırayla, fazla mesai sonraki günlere.
6. Work Calendar'a pres bazlı gün detayı: bir haftanın her günü için vardiya
   ve mesai (tatilde mesai, hafta içi ek vardiya). Capacity Dashboard'dan
   mesai açmak aynı kaydı günceller.
7. Vardiya tanımını detaylandır (vardiya sayısı ve süresi, ör. 2 × 9 saat);
   gün ≤ 24 saat, hafta ≤ 168 saat; aşan kayıt reddedilir.
8. Teslim hesabında resmi tatilleri kullanma.
9. Hammadde, acil hammadde ve talep dağıtımı için iş günü tanımını yeni pres
   takvimine bağla (açık soru 2'ye göre).
10. Etkisiz "14 gün stok = acil" kodunu kaldır.
11. BEKLEMEDE: MB51'de hareket türü olmayan eski satırları sayma (yeni format
    yüklenince kontrol).

## Açık sorular

- Bakiye ve bugünün ihtiyacının teslim anı (tatiller kullanılmayacaksa).
- Presler dışındaki "iş günü"nün kaynağı.
- Vardiya tanımı fabrika geneli mi, pres bazında mı; mesai vardiyasının
  süresi ve molaları.
- Tatil günü normal vardiyası başka güne kayar mı.
- Koddaki sabit sayılar: `docs/fixeddefinitions.md` — ileride
  değerlendirilecek.
