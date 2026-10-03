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
| Holding board üyesi | Companies and plants → Holdings → Board members (General) | Holding'e bağlı bütün şirketlerin bütün plantleri: KPI ve OEE, salt okunur |
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

## Sonra konuşulacak

- Board Dashboard'un A3 / PDF çıktısı (KPI dashboard'undaki gibi).
- Holding'e plan / hedef (ör. grup OEE hedefi) girilsin mi, yoksa yalnızca
  şirket planlarının toplamı mı?
