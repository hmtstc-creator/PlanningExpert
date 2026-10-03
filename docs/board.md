# Board Dashboard ve holding (2026-10-03)

Planlamacı: board üyeleri programın detayını görmemeli; genel sonuçlar ve
trendler önemli — KPI ve OEE. Birden çok şirketi olan kişi için yapı?

## Kararlar (2026-10-03)

1. **Holding (grup) seviyesi** (seçenek A): Platform → Holding → Şirket →
   Plant → Masraf yeri. Şirket verileri ayrı kalır; holding yalnızca okuma
   ve özet seviyesidir.
2. Holding'i **General** açar ve şirketleri bağlar. General = platform
   yöneticisi: site sahibi (owner) ve onun eklediği kişiler; bütün şirketleri
   görür, şirket / fabrika açar, modül açar-kapar, creator atar.
3. Board üyesine şimdilik yalnızca Board Dashboard ve KPI / OEE
   dashboard'ları (kalıp / makine özeti yok).
4. Isı haritası ve dikkat listesindeki ölçüyü **kullanıcı seçer** (OEE,
   Efficiency, Productivity, üretim adedi, Overtime %, Absenteeism % …).
5. Grup toplamında her şirketin **kendi planlarının toplamı** kullanılır.

## Kim ne görür

| Kim | Nasıl tanımlanır | Görür |
|---|---|---|
| Holding board üyesi | Administration → holding → Board members (General) | Holding'e bağlı bütün şirketlerin bütün plantleri: KPI ve OEE, salt okunur |
| Şirket board üyesi | Admin → User groups → "Board members" şablonu (Board view işaretli grup) | Şirketin grubun kapsadığı plantleri; grubun izinleri |

Board görünümünde (holding board üyesi ya da yalnızca "Board view"
gruplarına üye kişi) menü yalnızca: Board Dashboard, KPI monthly, KPI
weekly, OEE. Giriş doğrudan Board Dashboard'la açılır; diğer sayfalar açılmaz,
yükleme / veri girişi düğmeleri görünmez. Sunucu da yazmaya izin vermez.

## Ekran (/board)

- Dönem: Monthly (seçilen yılın 12 ayı) ya da Weekly (seçilen haftayla biten
  13 hafta); ay / hafta seçimi.
- Kapsam: `Holding ▸ Şirket ▸ Plant`; tablodaki "open ›" bir alt seviyeye
  iner (şirket → plant → masraf yeri).
- Kartlar (sabit): OEE, Efficiency, Production volume, Productivity,
  Overtime %, Absenteeism % — seçili kapsamın konsolide değeri, plan, fark,
  trend.
- Kırılım tablosu, ısı haritası, dikkat listesi: seçilen ölçüyle.
  - Isı haritası: her hücre gerçekleşen; plana göre ▲ yeşil / ▼ kırmızı,
    plan yoksa gri.
  - Dikkat: plana en uzak 5 birim (planın yüzdesi olarak) ve son üç dönemde
    sürekli kötüleşenler.
- Hesap KPI ile aynı: saat ve adet toplanır, oran toplamdan; girilen
  yüzdeler / değerler saatle ağırlıklı (docs/kpi.md → Açık notlar).

## Organizasyon ağacı (2026-10-03)

Planlamacı: "ilişki yapısını güçlendir; tepeden aşağı kurulsun, her şey için
önce holding tanımı gerekir; kullanıcıları her seviyenin altında görelim."

```
Holding → Company → Plant → Department → Cost center → Work center
```

Kararlar:

1. **Şirket kalır** (kiralama birimi: kullanıcılar, gruplar, creator'lar,
   modüller, askıya alma). Ağaçta holding'in altında görünür.
2. **Holding zorunlu:** şirket yalnızca bir holding'in içinde açılır
   (`createCompany` holding ister); şirket holding'siz bırakılamaz, yalnızca
   başka holding'e taşınır. Şirketi olan holding silinmez. Eski holding'siz
   şirketler ağaçta "No holding" altında uyarıyla durur.
3. **Bölüm (Department)** plant'in altında yeni seviye
   (`plants.departments`, sıralı ad listesi). **Her masraf yeri bir bölüme
   aittir** (`costCenters[].department`): yeni masraf yeri bölümsüz
   kaydedilmez; masraf yeri olan bölüm silinmez; bölümün adı değişince
   masraf yerleri yeni adla gelir. Bölümden önceki masraf yerleri
   "Without a department" altında, bir bölüme taşınana kadar kalır (verileri
   kodla bağlı, kod değişmez).
4. ~~Bölüm ile OEE Area ayrı kalır~~ → **K3 (2026-10-03): birleşti.** OEE
   alanı = bölüm; bölümün OEE'si olur. OEE Settings'te bölüm başına yalnızca
   seçim türü (masraf yeri / makine) ve setup sonrası süre kalır; bölümler ve
   masraf yeri ataması Company settings → Organization'dan gelir. Eski OEE
   alanlarının ayarı, masraf yerlerinin çoğunun eski alanından devralınır
   (`withPlantCostCenters`, src/lib/oee.ts). Canlı testte değişiklik
   gerekirse planlamacı söyler.
5. Yetki seviyesi değişmedi: erişim plant × modül (gruplar). Bölüm ve masraf
   yeri seviyesinde ayrı yetki yok.
6. **Her work center bir masraf yerine bağlıdır** (2026-10-03, planlamacı;
   `presses.costCenter`). Bağ Work Center Definitions'ta seçilir. Yeni work
   center masraf yerisiz açılmaz, bağ boşaltılamaz, plant'in olmayan kodu
   kabul edilmez; work center'ı olan masraf yeri kaldırılamaz. Eski bağsız
   work center'lar uyarıda kalır (planlamacı düzeltir). OEE verisindeki
   masraf yeri tanımdan farklıysa satırda "OEE data: … · use" görünür;
   program kendiliğinden değiştirmez. Ağaçta work center'lar masraf yerinin
   altında listelenir; kurulum listesinde "Departments and cost centers"
   adımı work center adımından önce gelir.

Ekran (Administration ve Company settings → Organization): solda ağaç (diyagram; renkli harf: H, C, P, D,
CC), sağda (telefonda altta) seçili düğümün paneli:

| Düğüm | Panel |
|---|---|
| Holding | ad, şirketler tablosu, şirket ekle, holding board üyeleri |
| Company | ad, holding, askıya alma, modüller, dışa aktarım; sekmeler: Plants · Users & access (kullanıcı × plant izin matrisi + hesaplar) · Groups |
| Plant | ad / ülke / saat dilimi, kapatılan modüller, bölüm kartları, bölüm ekle, bu plant'i gören kullanıcılar ve modül izinleri |
| Department | ad, masraf yerleri tablosu (ad, bölüm değiştirme, kaldırma), masraf yeri ekle |

Üstte "things to finish" listesi: holding'siz şirket, şirketsiz holding,
aynı adlı iki plant, bölümsüz plant, masraf yeri olmayan bölüm, bölümsüz
masraf yeri. Kural kodu: `src/lib/orgTree.ts` (+ test), sunucu:
`convex/platform.ts`.

## Sonra konuşulacak

- Board Dashboard ve KPI kırılımında bölüm seviyesi (plant → bölüm → masraf
  yeri).
- Bölüm = OEE Area birleştirmesi.
- Bölüm sorumlusu (kullanıcıyı bölüme atama) gerekir mi?

- Board Dashboard'un A3 / PDF çıktısı (KPI dashboard'undaki gibi).
- Holding'e plan / hedef (ör. grup OEE hedefi) girilsin mi, yoksa yalnızca
  şirket planlarının toplamı mı?
