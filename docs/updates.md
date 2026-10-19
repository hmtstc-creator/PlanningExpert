# Updates — ana sayfada son gelişmeler (2026-10-19, planlamacı)

İstek: "Ana ekrana, hoşgeldin ekranına bir bildirim alanı ekle; son
güncellemeleri insanlar takip edebilmeli — Die Follow-up konuları, OEE ve
planlamanın son güncelleme tarihleri gibi. Birisi oturum açtığında burada son
gelişmeleri görmeli, son dataların ne zaman yayınlandığını görmeli."

## 1. Kavram

Portal ana sayfasında karşılamanın hemen altında **Updates** paneli. Oturum
açan kişi ilk bakışta iki soruya cevap alır:

1. **Ne oldu?** (*What's new*) — son 7 günün olayları, yeniden eskiye:
   - Die Follow-up: yeni açılan konu (Die Problems, Loss Bridge'den açılan
     takip konuları dahil — pres ve aksiyon yazılır) ve çözülen konu.
   - Machine Follow-up: yeni arıza (pres duruyorsa söylenir) ve çözülen arıza.
   - Planlama: plan hesaplandı, plan onaylandı (kim).
   - SAP verisi yüklendi (ZPP, ZPP_DAILY, MB52, MB51, yoldakiler): dosya, kim.
   - OEE verisi yüklendi: dosya, kim.
2. **Veri ne kadar taze?** (*Latest data*) — her kaynağın son yayın anı,
   kimin yayınladığı ve kapsadığı dönem:
   - Plan: son hesap; hesaptan sonra veri değiştiyse ya da plan Today
     eşiğinden eskiyse uyarı. Son onay (varsa) ayrı satır.
   - SAP: her dosyanın son yüklemesi ve kapsadığı dönem. ZPP ve MB52 için
     Today'in eşiği (`sapStaleHours`) kullanılır: eski / hiç yüklenmemiş →
     uyarı. Diğer dosyalar yalnızca bilgi (eşikleri yok).
   - OEE: son yükleme ve verinin son günü ("data through").

**Son ziyaretten beri yeni**: kişinin bu cihazda ana sayfayı son açtığı andan
sonraki olaylar "New" işaretlidir; sayısı karşılamada (*N new since your last
visit*) ve panel başlığında görünür. Kayıt kısayollar gibi bu cihazda,
kullanıcı × plant başına (localStorage) — sunucuya gitmez; ilk ziyarette hiçbir
şey "yeni" sayılmaz.

Kurallar:
- **Yetki**: kişi yalnızca okuyabildiği modülün olayını ve tarihini görür
  (plan ve SAP → PlanningExpert; OEE → OEE; Die konuları → Die ya da Planning;
  arızalar → Machine ya da Planning — kayıtların kendi listeleriyle aynı).
  Satır açamadığı sayfaya bağlantı vermez.
- Today'den farkı: Today **karar** ister (geç parça, darboğaz, eski veri).
  Updates **haber** verir: ne değişti, veri ne zaman geldi. Eski veri her ikisinde
  de aynı eşikle görünür; eşik tek yerde (Company settings → Today & daily
  digest).
- Hesap değil, kayıt gösterilir: tarih, kişi, dosya adı kaynağın kendi
  kaydından gelir; ekranda elle girilen "duyuru" yoktur.
- Pencere ve uzunluk programda sabit (docs/fixeddefinitions.md #40, #41).

## 2. Mimari eşleştirme

```
src/routes/index.tsx            Hero: "N new since your last visit" → #updates
  └ src/components/UpdatesPanel.tsx   What's new + Latest data; "New" işareti
        │ useQuery(api.updates.feed)        │ useLastSeen (bu cihaz, localStorage)
        ▼                                   ▼
convex/updates.ts  guardedQuery (ALL_MODULES; modül izni kaynak başına; test: updates.test.ts)
        │ okur (küçük, indeksli):
        │   planRuns (son hazır plan, by_status_computed) · planStatus
        │   changeLog (son 200, by_created) → son plan onayı
        │   sapUploads → currentUploads() (SAP Data sayfasıyla aynı)
        │   oeeImports (son 10, by_uploadedAt) · oeeDays (son gün, by_date)
        │   moldProblems / machineProblems (son 50 açılan)
        ▼
src/lib/updates.ts  SAF: buildFreshness, buildFeed, countNew (test: updates.test.ts)
                    eşik: TodayThresholds (cockpit.ts, settingsDefaults.ts)
```

Tek kaynak:

| Bilgi | Kaynak | Diğer kullanan |
|---|---|---|
| Son SAP yüklemesi | `currentUploads()` (convex/sapUploads.ts) | SAP Data sayfası |
| Son plan hesabı | `planRuns` son `ready` | Today, Planning |
| Plan güncel mi | `planStatus.dataChangedAt` | Today, Planning, Capacity |
| Eskime eşikleri | `todayThresholds()` (convex/cockpit.ts) | Today, günlük özet |
| Plan onayı | `changeLog` başlığı `PLAN_APPROVED_TITLE` (src/lib/updates.ts) | Change Log |
| Son OEE yüklemesi | `oeeImports` | OEE Data |

Bilerek okunmayanlar (veritabanı okuma kotası — docs/architecture.md "Plan
hesabı elle"):
- `planSnapshots` okunmaz: doküman 1.500 işe kadar büyür; onayın zamanı ve kişisi
  aynı anda Change Log'a yazılır, oradan alınır.
- Die/Machine konularında yalnızca son açılan 50 kayıt okunur; çok eski bir
  konunun bu hafta çözülmesi (50'den fazla yeni konu açıldıysa) akışa girmez.
  Açık konuların sayısı Today'de ve modül sayfalarında zaten var.
- KPI girişlerinin güncellenme tarihi indeksli değil (bütün girişler okunmalı);
  ilk sürümde KPI yok.

## 3. Doğrulanan kod (2026-10-19)

- `moldProblems.report` Loss Bridge'den gelen konuya `press` ve `action` yazar;
  `solve` `solvedAt`/`solvedBy`/`solution` yazar → akış bu alanları okur.
- `machineProblems` aynı akış; `stopsPress` "work center stopped" diye yazılır.
- `planSnapshots.approve` Change Log'a `Plan approved — N jobs` yazar; başlık
  artık `PLAN_APPROVED_TITLE` sabitinden (iki taraf aynı metni kullanır).
- `oee.finishImport` her yüklemede `oeeImports` kaydı (dosya, an, kişi) açar.
- `sapUploads` her dosya için son yükleme kaydını tutar; eski kurulumda kayıt
  yoksa tarih veri tablosundan (`legacy`).
