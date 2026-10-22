# 09 · Açık konular ve riskler

> Son güncelleme: 2026-10-22 · Kaynak: bu sohbetler; **bütün açık işlerin tek listesi `todolist.md`** (burası yalnızca son dönemin özeti)

## Kullanıcının yapması gerekenler

| Konu | Ne | Neden |
|---|---|---|
| Organizasyonu düzelt | Administration → **Organization map**: kırmızı çerçeveli düğümler / "To fix" listesi (aynı adlı plant, holding'siz şirket, bölümsüz masraf yeri, masraf yerisiz work center) | `todolist.md` §1 |
| Yedek ve izleme | Storage Box (`BACKUP_REMOTE`), ilk geri yükleme provası, UptimeRobot | `todolist.md` §4.1 |
| E-posta özeti | Resend anahtarı — **sonra** (listede bekliyor) | `todolist.md` §5.3 |

Kullanıcı 2026-10-22'de doğruladı: gerçek veride lot bölme ve geç iş mesajları görüldü; tedarik süreleri varsayılan (14 gün) kalır; OEE sayfaları her gün açılıyor (histogram kurulmuş).

## Devam

- **Yarım iş yok.** `main` ruleset ile korunuyor (bkz. [05](05-yayin-ve-isletim.md)); açık PR / dal yok.
- **Sıradaki adım:** Organization map (`/admin/map`) kullanıcıda denenir; sonraki adımlar `todolist.md` §1 *Organization map*. Kararlar (§0) bekler; iyileştirmeler todolist'ten tek tek yapılır.
- **Organization map:** #29 açılış çökmesini (React #185) düzeltti; kullanıcı geri bildirimi bekleniyor. Dikkat: `useQuery(...) ?? []` bir `useMemo`/`useEffect` bağımlılığına giriyorsa sabit boş dizi kullan.
- **Organization map dosyaları:** kurallar ve yerleşim `src/lib/orgMap.ts` (`structureGraph`, `peopleGraph`, `dropAction`, `removeAction`), ekran `src/components/org/OrgMap.tsx` (`apply` = sunucu çağrıları), sayfa `src/routes/admin_.map.tsx`. Yol `admin_.map` düz dosya: `admin.tsx` Outlet çizmediği için iç içe olmamalı.
- **Dikkat edilecek yerler:** lot bölme `src/lib/planPipeline.ts` `planOnce` (satır ~899) ve yerel arama "Lot bölme" bloğu (~1264), `splitLot` `src/lib/scheduler.ts` (~176);
  geç iş payı `lateShare` (~1465), `explainLate` (~1511), `lateItems` (~1622). Satır numaraları kayabilir; `grep` ile bul.

## Bilinen sınırlar / riskler

- **Müşteri duruş süresi tahmindir:** müşterinin tüketim saatleri bilinmiyor; *son parça* ve *ortalama* gecikme gösterilir.
- **Lot bölme Min. lotun altına inmez** (r8 "tam rulo **ya da** ≥ Min. lot" izin verse de bölme muhafazakârdır). Min. lotlu parçalarda bölme hiç denenmez.
- **WebSocket yedek modunun kök nedeni sunucuda doğrulanamadı** (zayıf mobil sinyal ya da yayın sonrası meşgul sunucu olası). PR #20 geri dönüşü ve ölçüm satırını ekledi; tekrar ederse *Live data check* değeri istenir.
- **Sunucu oturumuna mesaj gönderilemez** (bulut oturumundan): yayın zamanlayıcıdadır; sunucu oturumu yalnızca gözlemci / işletmendir.
- **Losses Trend'den çıkan setup analizi** ayrı bir sayfa olarak istenirse yeniden eklenecek (PR #12 notu).
- **Sabit sayılar** (`docs/fixeddefinitions.md`): bazıları hâlâ kodda; kullanıcı ayarına taşınması tartışılacak.

## Sıradaki olası işler (karar bekler)

- Müşteri tüketim saatleriyle gerçek duruş süresi tahmini (ZPP_DAILY saat kırılımı yok; veri gerekir).
- Lot bölmede 4+ parça ve farklı preslerde parça (şu an 2–3 parça, aynı preste).
- `todolist.md` §4 (kurumsallaşma): güvence, veri modeli, güvenlik, kod ve doküman düzeni.
