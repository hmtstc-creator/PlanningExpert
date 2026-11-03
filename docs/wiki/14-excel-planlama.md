# 14 · Excel planlama modülü

> Son güncelleme: 2026-11-03 (ilk sürüm: talep → lot → pres planı VBA'da, site motoruyla karşılaştırma testi) ·
> Kaynak: `tools/excel/PlanEngine.bas` · Dosyalar: `docs/excel/*.xlsm`

Planlama motorunun **çekirdeği** sitenin dışında, makrolu bir Excel dosyasında da çalışır. Sistemin geri
kalanı (OEE, SOP, Board, hammadde, onaylı plan) yoktur. Site motorun tek kaynağıdır; Excel onun **kopyasıdır**
(bağımsız doğrulayıcı gibi) ve motor değişince geride kalabilir — aşağıdaki karşılaştırma testi bunu yakalar.

## Dosyalar

| Dosya | Ne |
|---|---|
| `docs/excel/PlanningExpert_Planlama.xlsm` | Boş şablon (ayarlar koddaki varsayılanlarla dolu) |
| `docs/excel/PlanningExpert_Planlama_Ornek.xlsm` | Aynı dosya, küçük örnek veriyle (plan tarihi 2026-11-03) |
| `tools/excel/PlanEngine.bas` | VBA kaynağı (tek kaynak; Excel'de elle düzenlenmez) |
| `tools/excel/build_excel.py` | Dosyaları üretir: `python3 tools/excel/build_excel.py` (xlsxwriter) |
| `tools/excel/vba_project.py` | `vbaProject.bin` yazıcısı (MS-OVBA sıkıştırma + OLE); p-code yok, Excel kaynaktan derler |
| `tools/excel/lint_vba.py` | Excel derleyicisinin LibreOffice'ten katı olduğu kurallar (çift tanım, tanımsız değişken) |
| `tools/excel/engine-compare.test.ts` | Excel sonucu ↔ `computePlan` (elle çalışır, CI'da atlanır) |

Ayarların varsayılanı `src/lib/settingsDefaults.ts`'den, onarım turu sayısı `planPipeline.ts`'den okunur;
elle yazılmaz.

## Sayfalar

Girdi: *Settings, Master Data, Work Centers, Day Shifts, Holidays, Planned Stops (tür: tea / meal / break —
setup bunlarda durmaz), Storage Locations, MB52, ZPP (1. hafta sütunu = plan haftası), ZPP_DAILY*.
Çıktı: *Lots, Production Plan (liste, Gantt yok), Unplanned, Load (pres × hafta saat), Check*.
Düğmeler (*Start*): **Run plan**, **Check data**, **Clear outputs**.

## Aktarılan kurallar

`buildDemandSchedule` (eş ürün hariç), `computeRunPlan`, `splitByMoldLimit`, `schedule` / `placeRun` /
`tryPlaceOnPress` / `reserveSlot` / `earliestFreeStart`, teslim anı ve kontrol noktaları, geç iş onarımı
(boost turları, en iyi puan). Ayrıntılı liste dosyanın *Start* sayfasındadır.

**Yok:** senaryo araması, yerel arama (lot bölme, sıra kaydırma), eş ürün, takılı kalıp kuralı, onaylı /
dondurulmuş plan, kilitli / taşınmış / elle eklenen iş, mesai tanımları, istisna haftası, operatör planı,
kalıp bakımı / alarmı / hazırlığı, arıza ve kapalı aralık, lot adedi müdahalesi, hammadde. Plan, plan
tarihinin ilk vardiyasından başlar (günün geçmiş saatleri düşülmez).

## Doğrulama (2026-11-03)

`run_in_libreoffice.py` makroyu başsız LibreOffice'te çalıştırır, `read_result.py` sonucu JSON'a çevirir,
`engine-compare.test.ts` aynı veriyi `computePlan`'a (senaryo araması kapalı: `maxScenarios: 1`) verir:

- Örnek + 8 rastgele veri seti (30 malzeme, 8 pres, yük ×0,6–×2,0; geç iş, plansız kalem, kalıp limiti,
  esnek pres, rulo değişimi): sitenin yerel araması iyileştirme bulmadıysa **iş iş aynı** (pres, malzeme,
  kova, adet, setup, başlangıç / bitiş ±1 dk). Bulduysa Excel sitenin yerel arama öncesi *Standard* planıyla
  aynı (geç iş sayısı, geç saat, plansız).
- Excel'de açılış burada denenemedi (Linux); `vbaProject.bin` olevba ile okunuyor, LibreOffice derliyor.
  Excel makroyu yüklemezse yedek yol: Alt+F11 → File → Import → `PlanEngine.bas`.

### LibreOffice farkları (kodda kaçınılanlar)

Tek satırlık `If … Then ReDim Preserve …` yanlışken sonraki satırı da atlıyor; dizi öğesinden dizi öğesine
`Type` ataması boş geliyor (`CopyLot` alan alan kopyalar); `For` sınırı her turda yeniden okunuyor (sınır
önceden değişkene alınır); bazı kısa değişken adları (`sS`, `pE` …) derlemeyi bozuyor; `Pi` ayrılmış ad.
Excel'de bunlar sorun değil ama iki ortamda aynı sonuç için kod böyle yazıldı.

## Motor değişince

Planlama mantığı değişen bir PR Excel'i bozmaz ama eskitir. Mantık Excel'in aktardığı bir kuralı
değiştiriyorsa: `PlanEngine.bas` güncellenir, `build_excel.py` çalıştırılır, karşılaştırma testi örnek ve
birkaç `--stress` tohumuyla yeniden geçirilir (`tools/excel/engine-compare.test.ts` başındaki komutlar).
