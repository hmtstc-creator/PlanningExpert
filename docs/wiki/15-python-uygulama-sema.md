# 15 · Python planlama uygulaması — klasör ve dosya şeması

> Son güncelleme: 2026-11-04 (ilk taslak; kullanıcı Excel örneği vermedi, sütunlar sitenin yükleme biçiminden alındı) ·
> Kararlar: `11-karar-gunlugu.md` → *Python planlama uygulaması* · Kod: `planapp/` (iskelet)

## Kullanıcı yanıtları (2026-11-04)

- **Taslak yok:** sütunlar sitenin Excel çıktıları / yükleme biçiminden alındı (`src/lib/sapParsers.ts`, `tools/excel/build_excel.py`); kullanıcı sonra düzeltir.
- **SAP dosyaları ham dışa aktarım:** başlıklar SAP'nin verdiği gibi; program başlığı eşleştirir (büyük/küçük harf, boşluk, Türkçe karakter duyarsız). Dosyaya elle dokunulmaz.
- **3 cost center:** ikisi birlikte, biri ayrı planlanır (pres ve punta hattı konuşması). Ayrı planlanan kısmın hammaddesi diğer ikisinden gelebilir → ara mamul kuralı (`11`: ara mamul yalnız mamul tarafında sayılır) ve cost center başına depo rolü gerekir.
- **MB51 üretim deposu:** sitedeki `countProduction` aynen = depo başına "üretim girişi" tiki; 101/102 hareketleri yalnız tikli depolarda üretimdir (`src/lib/stockLocations.ts`).

## Klasörler

`PlanVeri/sabit/` (salt okunur) · `sap/` (salt okunur) · `plan/` (program yazar) · `cikti/` (program yazar).

## Dosyalar ve sütunlar (taslak)

| Dosya (sayfa) | Sütunlar | Not |
|---|---|---|
| `sabit/parcalar.xlsx` | Material, Description, Main work center, Alt work center 1–4, Flexible (Y/N), Cycle time (min/pc), SPM, Cavities, Gross weight (kg/pc), Coil weight (kg), Min. lot (pcs), Setup (min), Coil change (min), Quality approval (min), Performance factor (0-1), Max shots, Co-product (malzeme kodu), Raw material (sac kodu) | Zorunlu: Material, Main work center, çevrim ya da SPM, Gross weight |
| `sabit/presler.xlsx` | Work center, Hall, Cost center, Feeds coil (Y/N), Working days / week, Shifts / day | Hol = Hall |
| `sabit/vardiyalar.xlsx` | Shift (1-3), Start (HH:MM), Length (min) | Varsayılan 07:00, 480 dk |
| `sabit/planli_durus.xlsx` | Shift, Name, Kind (tea/meal/break/handover/maintenance/other), Start, Duration (min) | Setup tea/meal/break'te sürer |
| `sabit/tatiller.xlsx` | Date, Name | |
| `sabit/depolar.xlsx` | Storage location, Cost center, Count finished (Y/N), Count raw (Y/N), Count production (Y/N) | Cost center başına rol |
| `sabit/sac_tedarik.xlsx` | Material (sac), Lead time (gün) | `*` satırı varsayılan |
| `sap/ZPP.xlsx` | Material, Stock in storage, Overdue requirements, sonra her hafta bir sütun | Ham SAP; hafta başlığı SAP'nin yazdığı |
| `sap/ZPP_DAILY.xlsx` | aynı; her gün bir sütun | |
| `sap/MB52.xlsx` | Material, Plant, Storage Location, Unrestricted, Quality Inspection, Blocked Stock, Returns, Transit and Transfer | |
| `sap/MB51.xlsx` | Material, Posting Date, Quantity, Plant, Storage Location, Movement Type, Order | 101/102 |
| `plan/manuel_isler.xlsx` | Work center, Material, Qty (kalan), Start date, Start time (boş = ilk boş an), Setup (Y/N) | Çakışan satır reddedilir, neden yazılır |
| `plan/mesai.xlsx` | Work center, Date, Shift ya da Start–End | Takvim ekranı yazar |
| `cikti/plan.xlsx` + PDF | iş listesi, plansız, hammadde, kontrol | Program yazar |

## Açık sorular

Excel örnekleri gelince bu tablo gerçek başlıklarla değiştirilir; cost center'lar arası hammadde akışının dosyada nasıl görüneceği (hangi sac kodu hangi cost center'ın ürünü) kullanıcıya sorulacak.
