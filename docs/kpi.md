# KPI — aylık ve haftalık (2026-10-02)

Planlamacının talebi: her masraf yeri için plan ve gerçekleşen; aylık ve
haftalık ayrı; veri girişi + dashboard; dashboard tek A3'e sığsın, Ocak ve
Aralık raporu aynı ölçüde olsun; A3 PDF; birden çok masraf yeri ve fabrika
seçilebilsin; masraf yerleri fabrikanınkiler, kök veri aynı.

## Sayfalar (portal → KPI)

| Sayfa | Ne yapar |
|---|---|
| /kpi | Monthly KPI ve Weekly KPI, her birinde Data entry ve Dashboard |
| /kpi/monthly/entry | Yıl + ay seçilir; masraf yerleri sütunlarda, her birinde Plan / Actual |
| /kpi/monthly/dashboard | Tek A3 yatay sayfa: 10 KPI kartı (seçilen ay, plan, fark, Ocak–Aralık trendi) + masraf yeri tablosu; Print / PDF (A3) |
| /kpi/weekly/entry | Yıl + ISO hafta |
| /kpi/weekly/dashboard | Aynı sayfa; trend seçilen haftayla biten 13 hafta |

## Veri

- Kayıt: fabrika × dönem (ay ya da ISO hafta) × masraf yeri (`kpiEntries`).
  Masraf yerleri fabrikanınkiler (Company → Plant → Cost center, creator
  tanımlar); başka kod kaydedilmez.
- Bir masraf yerinin **birden çok satırı** olabilir: "+ line" ile eklenir,
  her satırda operatör tipi **Direct / Indirect** seçilir (ör. Transfer
  Direct + Transfer Indirect). Satır kaldırılınca kaydı da silinir.
- Girilen (plan ve gerçekleşen): operatör sayısı, üretim adedi, üretim
  saati, normal mevcudiyet saati (fazla mesaisiz), fazla mesai saati,
  **Absenteeism %** ve **Productivity %** (doğrudan yüzde); planda OEE
  hedefi (%).
- Hesaplanan: Overtime % = fazla mesai ÷ normal mevcudiyet; Total presence
  = normal mevcudiyet + fazla mesai; **Efficiency** = üretim saati ÷ total
  presence.
- Birden çok satır / masraf yeri / fabrika: girilen yüzdeler saatle
  ağırlıklı birleşir (Absenteeism normal mevcudiyetle, Productivity toplam
  mevcudiyetle; saat yoksa eşit).
- **Kök veri:** gerçekleşen OEE OEE modülünün günlerinden (Σ operating ÷ Σ
  loading); gerçekleşen üretim adedi / saati girilmemişse yine oradan (iyi
  adet, net üretim süresi).
- Birden çok masraf yeri / fabrika: saat ve adetler toplanır, oranlar
  toplamdan bir kez hesaplanır (ortalama yok). Plan OEE hedefleri planlanan
  üretim saatiyle ağırlıklı.
- Boş alan boş kalır (0 sayılmaz).

## Dashboard

- 11 KPI kartı + "How it is calculated" kartı (6 × 2).
- A3 yatay (420 × 297 mm), ölçü sabit: aylıkta her zaman 12 ay
  (Ocak–Aralık), haftalıkta 13 hafta; tablo 10 masraf yeri satırı + toplam
  (fazlası toplamda, not düşülür).
- Fabrika ve masraf yeri seçimi (yalnızca KPI izni olan fabrikalar;
  sunucu yetkisiz fabrikayı reddeder). Varsayılan: seçili fabrika, bütün
  masraf yerleri.
- Print / PDF (A3): yalnızca sayfa yazdırılır (A3 yatay, kenarsız);
  tarayıcıda "Save as PDF".
- Renkler: gerçekleşen mavi çubuk, plan turuncu çizgi (renk körlüğü
  kontrolünden geçti); fark ▲▼ ve "better / worse" yazısıyla (yalnızca renk değil).

## Yetki

Yeni modül **KPI** (General şirkette açar; gruplara KPI izni verilir).
Board members şablonu KPI'yi görür, Plant manager şablonu düzenler.

## Kararlar (2026-10-02, planlamacı)

1. Productivity girilir (boş bırakılabilir); üretim saati ÷ toplam
   mevcudiyet **Efficiency** adıyla hesaplanır.
2. Overtime % = fazla mesai ÷ normal mevcudiyet — onaylandı.
3. Absenteeism % doğrudan girilir.
4. Bir masraf yerinin birden çok satırı olabilir; her satır Direct ya da
   Indirect.
