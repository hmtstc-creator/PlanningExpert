# 09 · Açık konular ve riskler

> Son güncelleme: 2026-10-31 (Qwen maddesi kapandı: kaldırıldı; pres → nut welding: R15 uyarısı yapıldı, motor kısıtı sıradaki; Qwen görev modu sorunu; SOP Builder: ilk gerçek video denemesi bekleniyor) · Kaynak: bu sohbetler; **bütün açık işlerin tek listesi `todolist.md`** (burası yalnızca son dönemin özeti)

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

- **Pres → nut welding bağı (ara mamul akışı)** (2026-10-30): **bağın kaynağı kararlaştı** — nut welding parçasının
  master data'daki *raw material* kodu bir pres (stamping) parçasının kodudur; ayrı BOM yok, 1 adet / adet kabul.
  **Adım 1 yapıldı:** doğrulayıcıda R15 `component-ready` (yalnız uyarı, plan `ok`'unu bozmaz; Planning Logic
  `#component-ready`). Sınırlar: bileşenin kendi müşteri talebi sayılmaz; bileşen stoku bütün depolardan; Gantt'ta
  işaret yok. **Sıradaki adım (ayrı oturum, `derin`):** motor kısıtı — nut welding işi bileşen hazır olmadan
  başlamasın (bileşen talebi zaten ZPP'de, wiki 04 *ara mamul*). Adet / adet 1 değilse alan gerekir (kullanıcıya sor).
- **SOP Builder — ilk gerçek video** (2026-10-30): kod yayında (#121, #123), worker çalışıyor, Gemini anahtarı
  *Setup*'ta kayıtlı. Açık PR / dal yok. Sıradaki adım: kullanıcı gerçek bir videoyu yükler, sonuç birlikte okunur
  (adımlar, kare anları, kırmızı işaret, metin dili) ve gerekirse `sop-worker/prompt.md` / `prompt-verify.md`
  ayarlanır. Bakılacaklar: *Save PDF*'te fotoğraflar çıkıyor mu (depo CORS; `src/lib/pdfSheet.ts` `capture`),
  worker günlüğü `docker compose -f deploy/compose.yml logs sop-worker`. Ayrıntı [12](12-sop-olusturma.md).

- **Slayt 6 — süzgeç bitti (#114), cycle hatlarının planlanması açık.** Production Plan'ın üstünde departman (tek) +
  cost center (çoklu) süzgeci çalışıyor; Gantt, işler, *Plan settings*, *Work calendar*, *Add job*'un iş yeri ve malzeme
  listesi, *Move…*, *Pin to work center* ve geç iş sayısı ona uyar, seçim tarayıcıda kalır. Dosyalar:
  `src/lib/planOrgFilter.ts` (saf, testli), `src/components/plan/PlanOrgFilter.tsx` (`usePlanOrgFilter` + süzgeç),
  `src/routes/planlama.tsx` (`org.shows` ile süzme; memo bağımlılıkları `org.shows` üzerinden — Gantt ağır, kimlik
  her render değişmemeli), Planning Logic `#org-filter`.
  **Sıradaki adım:** nut welding / punta / robot / montaj gerçekten planlanacaksa çevrim süresi (dakika / adet) bazlı
  yerleştirme gerekir — pres motoru yalnız `rateModel: 'stroke'` iş yerlerini planlar (`pressPlanScope`,
  `src/lib/rateModel.ts:85`). Bu ayrı ve büyük bir iş (yeni oturum): plan yapısı farklı (tam rulo / sac kg / kalıp
  setup'ı yok), pres parçasıyla bağ (pres parçası → punta hattı) henüz kurulmuyor. `todolist.md` Slayt 6 altında
  ayrı madde olarak duruyor.
  **Kullanıcıda denenecek:** her bölümde seçim → Gantt ve *Add job* malzeme listesi doğru daralıyor mu; masraf yerisiz
  iş yeri *Without a department* altında görünüyor mu (Organization map'teki düzeltmeler bittiğinde bu liste boşalmalı).
  Sınır: süzgeç Overview (`/planningexpert`), KPI ve Excel çıktılarına uygulanmaz — oralar fabrika geneli kalır.
- **Düzenlemeler sunumu (2026-10-28) — slayt 1–5 bitti.** Slayt 1, 2, 3, 5 (#91, #93, #94, #95); slayt 4'ün düzeni #94'te,
  takvimden vardiya düzenleme (gün kaydı `pressDayShifts`, hücreye tıkla) #97, Edit / Save + mesai #104. Kullanıcıda
  denenecek: *Edit* → hücre tıklaması → *Save* → *Calculate plan* → Gantt'ta ve Work Calendar'da o gün; mesaiyle
  çakışan vardiya hatası; ↺ ile şablona dönüş; OT satırından mesai ekleme / kaldırma.
  Sınır: Work Calendar sayfası gün kaydını kapasiteye katar ama ayrıca işaretlemez; gün kaydının toplu listesi yok.
  Slayt 6'nın **süzgeç** kısmı bitti (#114, aşağıda).
  #95 sınırları: öne alınmış uzun vade lotu da en sona gider; `summary.longTermShort` arayüzde (`PlanChecks`) gösterilmiyor.
- **Asakai / OEE (#83–#87) — canlıda kontrol ve planlamacıya sorular:**
  1. Planlamacı OEE Settings → Loss groups'ta ↑ ↓ ile sırayı bir kez vermeli: STP, KLP, ARZ, KSD, OFC, KON, YNT (sonra kodda sabit: Short stops, Speed, Unassigned).
  2. ~~**KLP %239 — pay farkı (payda aynı)**~~ — **çözüldü: Excel hatası, site doğru (2026-10-26).** 23.10 PRS-110 v2'de Excel ≈115 dk KLP gösteriyordu, site ≈344 dk; planlamacı farkın Excel'de olduğunu doğruladı. Önlem olarak tekrar satır kuralı ve *Check duplicates* eklendi (aşağıda 11'de karar).
  3. ~~Onay bekleyen~~ — **kararlandı (2026-10-28):** Unassigned köprüde kalem, öncelik değil (kalsın); Agent notları ve MTTR/MTBF Unassigned'ı almıyor (doğru; MTBF = dönemin Production time'ı ÷ o gruptaki duruş sayısı, Unassigned duruşlar sayılmaz). Detail kırmızı: ≥ %10 değil, her iş yerinin gününde en büyük 2 duruş (`ASAKAI_TOP`, #100). Vardiya satırları (1-2-3) da kendi en büyük 2 duruşuyla boyanır (kullanıcı 2026-10-28, `asakai-detail.tsx` → `asakaiTopStops(s, columns)`).
  4. Save PDF (A4) gerçek veriyle tarayıcıda denenmedi (kullanıcı; buluttan gerçek veri yok). Risk: 1400 px sayfa A4'e ~0,76 küçülür, 11 px yazı ~6 pt; okunmazsa `SHEET_WIDTH` / font büyütülür.
- **K7 — dört geliştirme işi (karar 2026-10-24, #59):** Board / KPI kırılımına bölüm seviyesi, bölüm sorumlusu, holding hedefi (girilmezse şirket planlarının toplamı), Board A3 / PDF çıktısı. Her biri ayrı oturum; önce `docs/board.md` ve `todolist.md` §2 *Organizasyon ve Board*. Bölüm seviyesi (#61), bölüm sorumlusu (#62) ve holding hedefi (#64; yalnız oranlar, grup kapsamında) yapıldı. Board A3 / PDF da yapıldı (2026-10-25): **K7'nin dört işi tamam.** Kullanıcıda denenecek: Responsible seçimi, Group targets ve Board PDF'inin A3'e sığması (ısı haritası geniş ekranda alınırsa küçülür).
- **K5 (#59) — canlıda ilk kod değişikliğinde bak:** *Change code* sonrası OEE sayfalarında eski kod kaybolmalı, geçmiş yeni kodda görünmeli; taşıma arka planda (`convex/workCenterHistory.ts` → `move`, tablo başına sayfa). Eski kodla yüklenen dosya yeni koda yazılır (`workCenterAliases`).
- **Ders (#72):** yeni bulut oturumunda önce `npm ci`; `npx vite build` tek başına `convex/_generated` olmadığı için kırılır — `npm run verify` (typecheck adımı `scripts/stub-convex.mjs` ile üretir) kullan. Yeni yol eklenince `routeTree.gen.ts` derlemede yenilenir, commit'e girer.
- **Ders:** PR açmadan hemen önce `main` başka bir PR ile ilerlediyse ve ikisi de 08'in üst satırını değiştirdiyse PR çakışır; GitHub çakışmalı PR'da CI çalıştırmaz (check yok). Çözüm: `git merge origin/main`, iki satırı da tut.
- **Cost center depoları (#54) — çift sayım kararlandı (2026-10-24, #56):** kullanıcı: 171'in 172'den çektiği miktar 172'nin ZPP'sinde zaten var. Ara mamul (fabrikada üretilen hammadde kodu) yalnız mamul tarafında sayılır, hammadde MRP'sine girmez (`04-hammadde.md`). Açık değil; ileride ZPP bunu içermezse ara mamul talebi 171'in planından türetilmelidir.
- **OEE kısa duruşlar (#46, #47) — sunucuda elle doğrulama bekliyor (Karabasan oturumu):** bir gün × iş yeri için (a) Loading − Production = o günün ≥ 2 dk plansız duruş toplamı mı (fixture'da 7/7 vardiya tuttu; tutmazsa `MES_SHORT_STOP_MIN` varsayımı ve köprünün "Not explained" adımı yeniden ele alınır), (b) Loss Bridge'in A / P / OEE'si Dashboard'la aynı mı, (c) "Machine < 2 min" kalemleri ve MTTR'nin yeni değerleri makul mü. Kod: `src/lib/oeeShortStops.ts`, `oeeBridge.ts` `buildBridge`. Sunucudaki OEE Settings'te SCHED_DOWN'ın `breakReasonCodes`'ta olduğu da bakılmalı (SCHED_DOWN YNT kayıp sayılmasın). **Kontrol betiği:** sunucu oturumunda `bash /opt/planningexpert/scripts/oee-shortstop-check.sh` (salt okunur, en yeni günlük yedek, koddan bağımsız hesap): (a) ortalama |fark| ≥ 2 dk ile en küçükse varsayım tutuyor, "bütün plansızla" daha küçükse MES < 2 dk'yı da düşüyor demektir; (b) yazdığı haftalık A / P / Q / OEE Loss Bridge'te aynı hafta ile karşılaştırılır; (c) kısa dk / adet ve MTTR eski → yeni; SCHED_DOWN satırı "UYARI" ise ayar düzeltilir. Çıktı bulut oturumuna getirilir.
- **Yarım iş yok.** `main` ruleset ile korunuyor (bkz. [05](05-yayin-ve-isletim.md)); açık PR / dal yok.
- **Gantt müdahaleleri tamam:** sürükle-bırak (#34), elle iş (#35), silme (#36) — `todolist.md` §1 *Gantt: elle iş*. Kullanıcı geri bildirimi bekleniyor (doğru süre / yer, sonraki lotlar küçülüyor mu). Açık: elle iş dondurulmuş (tam plan onaylı) işi itemez.
- **OEE Agent Insights (#41):** gerçek veriyle ilk raporlar okunur (Karabasan oturumu üretip Ahmet'e özetleyecek); kayıp kodu anlamları artık varsayılanla geliyor (#42). Kalıplar #44'te bilinen yazımlarla genişledi (testte liste). Kalan kontrol (sunucu oturumu, gerçek veri): kayıp metinlerinde "mola / pauz / break / 5S" geçip kalıba uymayan var mı; varsa örnek teste eklenip kalıp genişletilir. Sunucu oturumunda `bash /opt/planningexpert/scripts/oee-break-check.sh` çalıştırılır (salt okunur, en yeni günlük yedek; yalnız plansız RC1 — planlı duruşlar sinyallere zaten girmez); "UYMUYOR" satırları bulut oturumuna getirilir (`src/lib/oeeInsights.ts`, sinyaller 12–13). Kullanıcı anlamları Türkçe isterse `LOSS_CODE_MEANINGS` tek yer. Dosyalar: sinyaller `src/lib/oeeInsights.ts`, ajan `convex/oeeInsights.ts`, sayfa `src/routes/oee/insights.tsx`.
- **OEE açık konular ajanı (#37) tamam:** ilk gerçek yüklemeden sonra `/oee/topics` kullanıcıda denenir (adaylar doğru mu, eşikler çok mu sıkı / gevşek). Sonraki adım `todolist.md` OEE bölümü: eşikleri OEE Settings'e taşı, listeyi Agent Report'a bağla. Dosyalar: kurallar `src/lib/oeeTopics.ts`, ajan `convex/oeeTopics.ts` (`analyse`), sayfa `src/routes/oee/topics.tsx`.
- **Sıradaki adım:** Organization map (`/admin/map`) kullanıcıda denenir — seçili düğümde *Rename / Add / Delete* (holding, şirket, plant, bölüm, masraf yeri) ve work center'ı masraf yerine sürükleme (#67, `platform.setWorkCenterCostCenter`; *Work centers* kutusu açık olmalı). *Users & groups* görünümünde grup ekleme (şirket düğümü), kullanıcı ekleme (grup düğümü), ad değiştirme ve silme de var (#69, `nodeEdits(…, 'people')`); kullanıcıda denenir. Harita creator'lara da açıldı (Company settings → *Organization map*, `/settings/map`, yalnız kendi şirketi); kullanıcıda bir creator hesabıyla denenir. Şirket düğümünde artık askıya alma, modüller ve dışa aktarım da var (`CompanyControls.tsx`); holding düğümünde *Group targets* (`HoldingTargets.tsx`, General); bölüm düğümünde *Responsible* (`DepartmentOwner.tsx`); grup düğümünde (*Users & groups*) *Access* — Board grubu, plant'ler, izin matrisi (`people/GroupAccess.tsx`); kullanıcı düğümünde *Account* — e-posta, aktif, creator (`people/UserAccount.tsx`) ve *Sign-in* — son giriş, her yerden çıkış, geçici parola (`people/UserSignIn.tsx`); şirket düğümünde (*Users & groups*) *Security check* (`SecurityPanel`). Sıradaki geliştirme `todolist.md` §1 *Organization map*: eski sayfaları kaldırmadan önce eksikler haritaya taşınır (kullanıcı kararı 2026-10-25) — eksikler tamamlandı; sıradaki adım eski sayfaları (Holdings & companies ağacı, Users & permissions) ve menü bağlantılarını kaldırmak (kullanıcı haritayı denedikten sonra; e-posta / creator / aktif de artık haritada). Kararlar (§0) bekler; iyileştirmeler todolist'ten tek tek yapılır.
- **Organization map:** #29 açılış çökmesini (React #185) düzeltti; kullanıcı geri bildirimi bekleniyor. Dikkat: `useQuery(...) ?? []` bir `useMemo`/`useEffect` bağımlılığına giriyorsa sabit boş dizi kullan.
- **Organization map dosyaları:** kurallar ve yerleşim `src/lib/orgMap.ts` (`structureGraph`, `peopleGraph`, `dropAction` — şirket → holding, masraf yeri → bölüm, work center → masraf yeri, kullanıcı → grup, grup → plant; `removeAction`, `nodeEdits`), ekran `src/components/org/OrgMap.tsx` (`apply` = sunucu çağrıları), düzenleme kutusu `OrgMapEditor.tsx` (şirket ayarları `CompanyControls.tsx`, holding hedefleri `HoldingTargets.tsx`, bölüm sorumlusu `DepartmentOwner.tsx`; üçü de Holdings & companies ile ortak; grup erişimi `people/GroupAccess.tsx`, kullanıcı hesabı `people/UserAccount.tsx`, kullanıcı girişi `people/UserSignIn.tsx`; üçü de Users & permissions ile ortak), sayfalar `src/routes/admin_.map.tsx` (General, bütün holding'ler) ve `settings_.map.tsx` (creator, `scope="company"`). Yol `admin_.map` düz dosya: `admin.tsx` Outlet çizmediği için iç içe olmamalı.
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

- **MTTR'de 2–10 dk ARZ kayıtlarının kaynağı:** program süreyi MES dosyasından ("Stoppage Duration") olduğu gibi alır, bölmez. Kullanıcıya göre < 10 dk ARZ elle girilemiyor; olası neden MES'in makine duruşuna otomatik ARZ vermesi ya da uzun arızayı vardiya / sipariş sınırında bölmesi. İstenirse `bucketDetail` (`src/lib/oeeReliability.ts`) içine "vardiya sınırında / önceki ARZ'ye bitişik" sayacı eklenir.
- Müşteri tüketim saatleriyle gerçek duruş süresi tahmini (ZPP_DAILY saat kırılımı yok; veri gerekir).
- Lot bölmede 4+ parça ve farklı preslerde parça (şu an 2–3 parça, aynı preste).
- `todolist.md` §4 (kurumsallaşma): güvence, veri modeli, güvenlik, kod ve doküman düzeni.
