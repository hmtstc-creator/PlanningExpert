# 09 · Açık konular ve riskler

> Son güncelleme: 2026-10-25 (K7 holding hedefi) · Kaynak: bu sohbetler; **bütün açık işlerin tek listesi `todolist.md`** (burası yalnızca son dönemin özeti)

## Kullanıcının yapması gerekenler

| Konu | Ne | Neden |
|---|---|---|
| Cost center depoları (#54) | Storage Locations → **Locations per cost center**: 171/173 → WIP 2009, ham + mamul 1009; 172 → WIP 2010, ham + mamul 1009. Work center'ların cost center'ı dolu olmalı | Tanım yoksa eski tikler geçerli |
| Organizasyonu düzelt | Administration → **Organization map**: kırmızı çerçeveli düğümler / "To fix" listesi (aynı adlı plant, holding'siz şirket, bölümsüz masraf yeri, masraf yerisiz work center) | `todolist.md` §1 |
| Yedek ve izleme | Storage Box (`BACKUP_REMOTE`), ilk geri yükleme provası, UptimeRobot | `todolist.md` §4.1 |
| E-posta özeti | Resend anahtarı — **sonra** (listede bekliyor) | `todolist.md` §5.3 |
| OEE açık konular yapay zekâsı | Sunucudaki (self-hosted) Convex'e `AI_API_KEY` (ücretsiz Gemini; Groq ise `AI_API_URL` + `AI_MODEL` de). Yoksa kurallar karar verir | `docs/deployment.md` → *OEE açık konular — yapay zekâ* |

Kullanıcı 2026-10-22'de doğruladı: gerçek veride lot bölme ve geç iş mesajları görüldü; tedarik süreleri varsayılan (14 gün) kalır; OEE sayfaları her gün açılıyor (histogram kurulmuş).

## Devam

- **K7 — dört geliştirme işi (karar 2026-10-24, #59):** Board / KPI kırılımına bölüm seviyesi, bölüm sorumlusu, holding hedefi (girilmezse şirket planlarının toplamı), Board A3 / PDF çıktısı. Her biri ayrı oturum; önce `docs/board.md` ve `todolist.md` §2 *Organizasyon ve Board*. Bölüm seviyesi (#61), bölüm sorumlusu (#62) ve holding hedefi (2026-10-25; yalnız oranlar, grup kapsamında) yapıldı. **Devam: K7 Board A3 / PDF** — KPI dashboard'undaki A3 / PDF çıktısının benzeri Board Dashboard için (`docs/pdf.md`, `src/components/BoardDashboard.tsx`; KPI'daki yazdırma kodunu `grep -rn "A3" src` ile bul).
- **K5 (#59) — canlıda ilk kod değişikliğinde bak:** *Change code* sonrası OEE sayfalarında eski kod kaybolmalı, geçmiş yeni kodda görünmeli; taşıma arka planda (`convex/workCenterHistory.ts` → `move`, tablo başına sayfa). Eski kodla yüklenen dosya yeni koda yazılır (`workCenterAliases`).
- **Ders:** PR açmadan hemen önce `main` başka bir PR ile ilerlediyse ve ikisi de 08'in üst satırını değiştirdiyse PR çakışır; GitHub çakışmalı PR'da CI çalıştırmaz (check yok). Çözüm: `git merge origin/main`, iki satırı da tut.
- **Cost center depoları (#54) — çift sayım kararlandı (2026-10-24, #56):** kullanıcı: 171'in 172'den çektiği miktar 172'nin ZPP'sinde zaten var. Ara mamul (fabrikada üretilen hammadde kodu) yalnız mamul tarafında sayılır, hammadde MRP'sine girmez (`04-hammadde.md`). Açık değil; ileride ZPP bunu içermezse ara mamul talebi 171'in planından türetilmelidir.
- **OEE kısa duruşlar (#46, #47) — sunucuda elle doğrulama bekliyor (Karabasan oturumu):** bir gün × iş yeri için (a) Loading − Production = o günün ≥ 2 dk plansız duruş toplamı mı (fixture'da 7/7 vardiya tuttu; tutmazsa `MES_SHORT_STOP_MIN` varsayımı ve köprünün "Not explained" adımı yeniden ele alınır), (b) Loss Bridge'in A / P / OEE'si Dashboard'la aynı mı, (c) "Machine < 2 min" kalemleri ve MTTR'nin yeni değerleri makul mü. Kod: `src/lib/oeeShortStops.ts`, `oeeBridge.ts` `buildBridge`. Sunucudaki OEE Settings'te SCHED_DOWN'ın `breakReasonCodes`'ta olduğu da bakılmalı (SCHED_DOWN YNT kayıp sayılmasın). **Kontrol betiği:** sunucu oturumunda `bash /opt/planningexpert/scripts/oee-shortstop-check.sh` (salt okunur, en yeni günlük yedek, koddan bağımsız hesap): (a) ortalama |fark| ≥ 2 dk ile en küçükse varsayım tutuyor, "bütün plansızla" daha küçükse MES < 2 dk'yı da düşüyor demektir; (b) yazdığı haftalık A / P / Q / OEE Loss Bridge'te aynı hafta ile karşılaştırılır; (c) kısa dk / adet ve MTTR eski → yeni; SCHED_DOWN satırı "UYARI" ise ayar düzeltilir. Çıktı bulut oturumuna getirilir.
- **Yarım iş yok.** `main` ruleset ile korunuyor (bkz. [05](05-yayin-ve-isletim.md)); açık PR / dal yok.
- **Gantt müdahaleleri tamam:** sürükle-bırak (#34), elle iş (#35), silme (#36) — `todolist.md` §1 *Gantt: elle iş*. Kullanıcı geri bildirimi bekleniyor (doğru süre / yer, sonraki lotlar küçülüyor mu). Açık: elle iş dondurulmuş (tam plan onaylı) işi itemez.
- **OEE Agent Insights (#41):** gerçek veriyle ilk raporlar okunur (Karabasan oturumu üretip Ahmet'e özetleyecek); kayıp kodu anlamları artık varsayılanla geliyor (#42). Kalıplar #44'te bilinen yazımlarla genişledi (testte liste). Kalan kontrol (sunucu oturumu, gerçek veri): kayıp metinlerinde "mola / pauz / break / 5S" geçip kalıba uymayan var mı; varsa örnek teste eklenip kalıp genişletilir. Sunucu oturumunda `bash /opt/planningexpert/scripts/oee-break-check.sh` çalıştırılır (salt okunur, en yeni günlük yedek; yalnız plansız RC1 — planlı duruşlar sinyallere zaten girmez); "UYMUYOR" satırları bulut oturumuna getirilir (`src/lib/oeeInsights.ts`, sinyaller 12–13). Kullanıcı anlamları Türkçe isterse `LOSS_CODE_MEANINGS` tek yer. Dosyalar: sinyaller `src/lib/oeeInsights.ts`, ajan `convex/oeeInsights.ts`, sayfa `src/routes/oee/insights.tsx`.
- **OEE açık konular ajanı (#37) tamam:** ilk gerçek yüklemeden sonra `/oee/topics` kullanıcıda denenir (adaylar doğru mu, eşikler çok mu sıkı / gevşek). Sonraki adım `todolist.md` OEE bölümü: eşikleri OEE Settings'e taşı, listeyi Agent Report'a bağla. Dosyalar: kurallar `src/lib/oeeTopics.ts`, ajan `convex/oeeTopics.ts` (`analyse`), sayfa `src/routes/oee/topics.tsx`.
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
