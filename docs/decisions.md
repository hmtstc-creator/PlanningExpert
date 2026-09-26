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
- Dondurulmuş gün hem genel hem pres bazında kalır (pres değeri geneli ezer).
- Parça performansı (master data) ve kapasite katsayısı (Performance) ikisi de
  kalır. Capacity Dashboard'a seçim düğmesi eklenecek: A) kabule göre
  (Performance'ta yazılan katsayı), B) master data'daki parça performansına
  göre. → uygulanacak

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

## Açık sorular

- Şablonu olmayan pres ve çalışma günü tutarsızlığı (bkz. sohbet, madde 5–6).
- Koddaki sabit sayılar: programda mı kalsın, kullanıcı mı tanımlasın.
