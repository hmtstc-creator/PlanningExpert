import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { useQuery } from '../../lib/convexTransport'
import { DEFAULT_PLANT_TIME_ZONE } from '../../lib/dates'
import { MES_SHORT_STOP_MIN, SHORT_STOPS, SPEED, UNASSIGNED, UNDEFINED_RC1 } from '../../lib/oee'
import { OVER_RECORDED } from '../../lib/oeeBridge'
import { SHORT_STOP_DATA_FROM } from '../../lib/oeeShortStops'
import { computeRunPlan } from '../../lib/planning'
import { allocateOperators, OPERATOR_EXAMPLE } from '../../lib/operatorAllocation'
import { OPERATOR_SHIFTS_PER_DAY, OPERATOR_WEEKLY_EXAMPLE, operatorWeekCapacity, shiftHeadcountFromWeekly } from '../../lib/operatorCapacity'
import { leadTimeLookup, type LeadTimeRow } from '../../lib/rawLeadTime'
import { CYCLE_DECIMALS, CYCLE_STORE_DECIMALS, cycleMinutesFromSeconds, formatCycleInput } from '../../lib/rateModel'
import { SETTINGS_DEFAULTS } from '../../lib/settingsDefaults'
import { PageHeader } from '../PageHeader'
import { relatedPages } from '../../lib/navigation'

/**
 * Planning Logic sayfasının Türkçe çevirisi.
 *
 * Bu dosya `src/routes/planlogic.tsx` (İngilizce Planning Logic sayfası) ile
 * birebir aynı yapıdadır; yalnız ekranda görünen metin Türkçedir. İngilizce
 * sayfa değiştiğinde bu dosya da aynı PR'da birlikte güncellenmelidir.
 * Kod `src/lib/planPipeline.ts`, `planning.ts` ve `scheduler.ts` içinde.
 */

/** Hammadde MRP'sinin FMEA'sı: hata türü, etkisi, S, O, D, yöntemdeki önlem. */
const FMEA_ROWS: [string, string, number, number, number, string][] = [
  ['Plan ve talep birlikte sayılır', 'Aynı sac iki kez sipariş edilir', 8, 8, 3, 'Plandan bağımsız: yalnız talep; plan zamanlamasını ve rulo fazlasını emniyet stoku karşılar'],
  ['Mamul stok düşülmez', 'Fazla sipariş', 7, 5, 4, 'Storage Locations sayfasında “Finished goods” işaretli yerlerdeki stok, plandaki gibi ilk giren ilk çıkar sırasıyla önce düşülür; satır ihtiyacı mamul bazında ayrıştırır'],
  ['Stoku olan parçanın ihtiyacı rulo satırından okunur', 'Parçanın stoku hâlâ yetiyorken sac gerekiyor görünür', 5, 6, 6, 'Mamul bazında ayrıştırma: rulodaki her parça için mamul stokunun karşıladığı hafta sayısı ve sacın ilk gerektiği hafta'],
  ['Eldeki rulo stoku düşülmez', 'Fabrikada zaten olan sac yeniden sipariş edilir', 8, 6, 5, '“Raw material” işaretli yerlerdeki rulo stoku açılış stokudur'],
  ['Ortak ürün iki kez sayılır', 'Çift parçalarda fazla sipariş', 6, 6, 5, 'Çift tek seferde basılır: vuruş = büyük olan ihtiyaç, sac yalnız ana parçada'],
  ['Hammadde kodu / brüt ağırlığı olmayan parça', 'Sacı sessizce eksik kalır → hat durur', 10, 5, 8, 'Sayfada adediyle kırmızı listelenir; hiçbir zaman sessizce düşürülmez'],
  ['Brüt ağırlık yanlış birimde (g / t)', 'Sipariş 1000 kat yanlış', 9, 3, 6, 'Parça başına 50 kg üstü ya da 1 g altı ağırlıklar işaretlenir'],
  ['Haftalık kova: emniyet yalnız hafta başında kontrol edilir', 'Hafta sonunda emniyetin altına düşülür', 7, 7, 7, 'Her hafta sonu sonraki N iş gününü karşılamalı (10 = sonraki 2 hafta)'],
  ['Arkasında talep olmayan sac sipariş edilir', 'Ölü stok, bağlanan nakit', 6, 6, 5, 'Talep yoksa sipariş yok: son ZPP haftasının ötesi tahmin edilmez (kanban daha sonra gelecek)'],
  ['Birikmiş (gecikmiş) talep yok sayılır', 'Acil sac şu an eksik', 8, 4, 5, 'Birikmiş talep içinde bulunulan haftada sayılır'],
  ['Bloke / kalite stoku kullanılabilir sayılır', 'Stok olduğundan fazla görünür', 7, 4, 6, 'Yalnız serbest stok ve yalnız Storage Locations sayfasında işaretli yerlerde'],
  ['Hurda, rulo sonu, setup kaybı', 'Biraz eksik kalır', 5, 8, 7, 'Sipariş başına standart ek miktar (500 kg, ayarlanabilir)'],
  ['Yoldaki sac bilinmez', 'Zaten yolda olan sac yeniden sipariş edilir', 7, 7, 8, 'Yoldaki malzeme Excel listesi: her miktar ETA haftasında giriş sayılır (ETA yoksa bu hafta)'],
  ['Yoldaki malzemenin ETA’sı yanlış ya da eksik', 'Sipariş bir hafta geç ya da erken verilir', 6, 5, 6, 'ETA yoksa bu hafta sayılır; her gelişin ETA’sı ve PO’su kontrol için sayfada gösterilir'],
]

const STEPS = [
  { id: 'inputs', title: 'Verileri topla' },
  { id: 'demand', title: 'Talebi netleştir' },
  { id: 'capacity', title: 'Kapasiteyi kur' },
  { id: 'blocks', title: 'Çalışamayanı kapat' },
  { id: 'order', title: 'İşleri sıraya koy' },
  { id: 'place', title: 'Her işi yerleştir' },
  { id: 'check', title: 'Kontrol et ve raporla' },
]

function hhmm(minute: number): string {
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const dmy = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

export function PlanLogicTr() {
  const leadRows = useQuery(api.rawLeadTimes.list) as LeadTimeRow[] | undefined
  const settings = useQuery(api.pressCalendar.getGlobalSettings) as
    | {
        shiftMinutes: number
        setupGapMinutes?: number
        coilSetupGapMinutes?: number
        concurrentSetupsPerHall?: number
        shiftStartMinute?: number
        capacityFactor?: number
        planningHorizonWeeks?: number
        frozenDays?: number
        safetyStockDays?: number
        timeZone?: string
        maxSetupsPlantWideNormal?: number
        maxSetupsPlantWide?: number
        setupsCrossShifts?: boolean
        pullForwardDays?: number
        deliveryCutoffMinute?: number
        utilisationTarget?: number
        maxScenarios?: number
        rawCoverageDays?: number
        rawOrderExtraKg?: number
        rawUrgentDays?: number
        acceptedPerformanceRate?: number
      }
    | null
    | undefined

  // Süre örneği koddan hesaplanır; aynı sayılar src/lib/rateModel.test.ts'te.
  const cycleExample = { qty: 1200, minutes: 0.25, oee: 0.6 }
  // Punta ve pres dosyaları süreyi saniye yazar; yüklemede 60'a bölünür.
  const cycleSecondsExample = 8.22
  const cycleFromSeconds = cycleMinutesFromSeconds(cycleSecondsExample)
  // Saniyenin altında çalışan pres parçası: kayıt 5 hane olmasa süre şişerdi.
  const pressSecondsExample = 1.1111111111111112
  const pressCycle = cycleMinutesFromSeconds(pressSecondsExample)!
  const cycleRun = computeRunPlan({ code: 'X', cycleMinutes: cycleExample.minutes }, cycleExample.qty)
  const cycleRunOee = computeRunPlan(
    { code: 'X', cycleMinutes: cycleExample.minutes, performanceFactor: cycleExample.oee },
    cycleExample.qty,
  )

  const current = {
    horizon: settings?.planningHorizonWeeks ?? SETTINGS_DEFAULTS.planningHorizonWeeks,
    shiftStart: hhmm(settings?.shiftStartMinute ?? SETTINGS_DEFAULTS.shiftStartMinute),
    shiftMinutes: settings?.shiftMinutes ?? SETTINGS_DEFAULTS.shiftMinutes,
    setupGap: settings?.setupGapMinutes ?? SETTINGS_DEFAULTS.setupGapMinutes,
    plantNormal: settings?.maxSetupsPlantWideNormal ?? SETTINGS_DEFAULTS.maxSetupsPlantWideNormal,
    plantUrgent: settings?.maxSetupsPlantWide ?? SETTINGS_DEFAULTS.maxSetupsPlantWide,
    crossShifts: settings?.setupsCrossShifts ?? SETTINGS_DEFAULTS.setupsCrossShifts,
    pullForward: settings?.pullForwardDays ?? SETTINGS_DEFAULTS.pullForwardDays,
    cutoff: hhmm(settings?.deliveryCutoffMinute ?? SETTINGS_DEFAULTS.deliveryCutoffMinute),
    target: settings?.utilisationTarget ?? SETTINGS_DEFAULTS.utilisationTarget,
    maxScenarios: settings?.maxScenarios ?? SETTINGS_DEFAULTS.maxScenarios,
    coilGap: settings?.coilSetupGapMinutes ?? SETTINGS_DEFAULTS.coilSetupGapMinutes,
    concurrent: settings?.concurrentSetupsPerHall ?? SETTINGS_DEFAULTS.concurrentSetupsPerHall,
    factor: Math.round((settings?.capacityFactor ?? SETTINGS_DEFAULTS.capacityFactor) * 100),
    frozen: settings?.frozenDays ?? SETTINGS_DEFAULTS.frozenDays,
    safety: settings?.safetyStockDays ?? SETTINGS_DEFAULTS.safetyStockDays,
    timeZone: settings?.timeZone || DEFAULT_PLANT_TIME_ZONE,
    rawCoverage: settings?.rawCoverageDays ?? SETTINGS_DEFAULTS.rawCoverageDays,
    rawExtra: settings?.rawOrderExtraKg ?? SETTINGS_DEFAULTS.rawOrderExtraKg,
    rawUrgent: settings?.rawUrgentDays ?? SETTINGS_DEFAULTS.rawUrgentDays,
    rawLeadDefault: leadTimeLookup(leadRows ?? []).defaultDays,
    rawLeadEntered: (leadRows ?? []).filter((r) => r.rawMaterialCode !== '*').length,
    predictionOee: Math.round((settings?.acceptedPerformanceRate ?? SETTINGS_DEFAULTS.acceptedPerformanceRate) * 1000) / 10,
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Planning Logic"
        summary="Plan nasıl hesaplanır — her seferinde aynı kurallar, aynı şekilde uygulanır."
        links={relatedPages('/planlogic')}
        info={
          <p>
            Hiçbir iş elle yerleştirilmez. Plan, sizin güncel tuttuğunuz verilerden sunucuda,
            aşağıdaki yedi adımda ve bu veriler her değiştiğinde yeniden hesaplanır. Planı
            değiştirmek için girdilerini değiştirin.
          </p>
        }
      />

      <SingleSource />

      <Synoptic safetyDays={current.safety} />

      <h2 className="mt-10 text-lg font-semibold text-foreground">Yedi adımın ayrıntısı</h2>
      <ol className="mt-3 flex flex-wrap gap-2 text-xs">
        {STEPS.map((step, i) => (
          <li key={step.id} className="flex items-center gap-2">
            <a
              href={`#${step.id}`}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-foreground hover:bg-muted"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                {i + 1}
              </span>
              {step.title}
            </a>
            {i < STEPS.length - 1 && <span className="text-muted-foreground" aria-hidden>→</span>}
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">Geçerli ayarlarınız</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <Setting label="Planning horizon" value={`${current.horizon} hafta`} />
          <Setting label="First shift starts" value={`${current.shiftStart} (${current.timeZone})`} />
          <Setting label="Shift length" value={`${current.shiftMinutes} dk`} />
          <Setting label="Gap between mould setups (same hall)" value={`${current.setupGap} dk`} />
          <Setting label="Gap between coil changes (same hall)" value={`${current.coilGap} dk`} />
          <Setting label="Setups at the same time per hall" value={String(current.concurrent)} />
          <Setting label="Setups at once in the plant (normal)" value={String(current.plantNormal)} />
          <Setting label="Setups at once with backlog / late risk" value={String(current.plantUrgent)} />
          <Setting label="Pull work forward" value={`${current.pullForward} gün`} />
          <Setting label="Setup over a shift change" value={current.crossShifts ? 'izinli' : 'izinli değil'} />
          <Setting label="Capacity factor" value={`%${current.factor}`} />
          <Setting
            label="Frozen days"
            value={current.frozen > 0 ? `${current.frozen} gün` : 'kapalı'}
          />
          <Setting label="Safety stock" value={`${current.safety} iş günü`} />
          <Setting label="Delivery time on the need day" value={current.cutoff} />
          <Setting label="Utilisation target" value={`%${current.target} (sonraki 7 gün)`} />
          <Setting label="Scenarios tried at most" value={String(current.maxScenarios)} />
          <Setting label="Raw material safety" value={`${current.rawCoverage} iş günü`} />
          <Setting label="Raw order extra" value={`${current.rawExtra.toLocaleString('en-GB')} kg`} />
          <Setting label="Urgent raw material" value={`${current.rawUrgent} iş günü`} />
          <Setting label="Prediction OEE (dashboard only)" value={`%${current.predictionOee}`} />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Bunları{' '}
          <Link to="/takvim" className="underline hover:no-underline">
            Work Calendar
          </Link>{' '}
          sayfasında değiştirin; kapasite faktörü{' '}
          <Link to="/performans" className="underline hover:no-underline">
            Performance
          </Link>{' '}
          sayfasından, Prediction OEE ise{' '}
          <Link to="/capacity" className="underline hover:no-underline">
            Capacity Dashboard
          </Link>
          {' '}sayfasından gelir.
        </p>
      </div>

      <Step n={1} id="inputs" title="Verileri topla">
        <p>Motor, planın dayandığı her şeyi okur:</p>
        <Table
          rows={[
            ['Talep', 'ZPP haftalık net ihtiyaçları ve gecikmiş miktar', '/sapdata'],
            ['Satış günleri', 'ZPP_DAILY: her gün için bir sütun — her miktarın satıldığı gün', '/sapdata'],
            [
              'Stok',
              'MB52 serbest stoku, masraf yeri bazında sayılır: bir parça, ana iş yerinin masraf yerine ait yerleri sayar (Storage Locations → Locations per cost center) — plan, doğrulayıcı, Demand ve Capacity Dashboard için üretim (WIP) yerini ve mamul yerlerini; bir hammadde kodu ise onu tüketen masraf yerlerinin hammadde yerlerini sayar. Örnek: 171 ve 173 için WIP 2009, hammadde ve mamul 1009; 172 için WIP 2010, hammadde ve mamul 1009 — 2009’da duran bir 172 parçasının stoku sayılmaz. Ara mamuller: fabrikanın kendisinin yaptığı (ürün kartı ya da ortak ürün olan) ve başka bir parçanın hammadde olarak kullandığı bir kod — ör. 172 yapar, 171 tüketir — bir kez, yapanın mamul stoku olarak sayılır; hiçbir zaman hammadde stoku sayılmaz, rulo ihtiyacı doğurmaz ve satın alma önerisine girmez, çünkü 171’in çekişi zaten 172’nin ZPP talebinin içindedir. Bu yüzden 1009’un 171 için hammadde, 172 için mamul yeri olması aynı parçaları iki kez saydırmaz. Bir parçanın MB51 üretimi, masraf yerinin WIP yerine yapılan 101/102 hareketidir. Tanımı olmayan bir masraf yeri (ya da masraf yeri olmayan bir parça) yer işaretlerini kullanır: Finished goods, Raw material, Production receipt',
              '/depolar',
            ],
            ['Yoldaki rulolar', 'Yoldaki malzeme Excel listesi: her miktar ETA haftasında gelir (ETA yoksa bu hafta)', '/sapdata'],
            [
              'Master data',
              'Çevrim süresi (parça başına dakika) — her parçanın her iş yerindeki hızı; setup ve frekans duruşu (rulo değişimi) süreleri, kalite onay süresi, rulo ve brüt ağırlık, kalıp vuruş limiti, ana ve alternatif iş yerleri, Flexible work center işareti, ortak ürün, Accepted OEE. Daha önce SPM ve göz sayısıyla yüklenmiş ama çevrim süresi olmayan bir parça 1 ÷ (SPM × göz) dk/adet çalışır; göz sayısı girilmişse yalnız vuruşları sayar (kalıp limiti)',
              '/referanslar',
            ],
            ['Work Centers', 'Tek iş yeri listesi: masraf yeri, hol (vinç ve setup ekibi), kategori (Gantt ve Capacity Dashboard grupları), frekans duruşu (rulo setup, fikstür setup … ya da yok), dondurulmuş günler', '/makineler'],
            ['Work calendar', 'İş yeri bazında: haftalık düzen (pazartesiden itibaren gün × vardiya), istisna haftalar, mesai (tarihli ya da tekrarlayan, bir mesai türünden); planlı duruşlar; resmî ve elle girilen tatiller; planlama ayarları', '/takvim'],
            ['Kalıplar', 'Hazır olma (tarih ve saat), bakım günleri, vuruş limiti alarmları — Die Follow-up’tan', '/die-followup/maintenance'],
            ['Makineler', 'İş yerini durduran planlı bakım saatleri ve açık arızalar — Machine Follow-up’tan', '/machine-followup/breakdowns'],
            ['Kurallarınız', 'Hariç tut, bir iş yerine/güne sabitle ya da öne al', '/planlama'],
            ['Onaylı plan', 'Dondurulmuş günler için son onaylanan plan', '/planlama'],
          ]}
        />
      </Step>

      <Step n={2} id="demand" title="Talebi netleştir">
        <ul>
          <li>
            Her ZPP sütunu, içinde bulunulan haftadan başlayarak bir takvim
            haftasıdır. Yalnız planlama ufkunun içindeki haftalar planlanır.
          </li>
          <li>
            Gecikmiş miktar, bu hafta vadeli bir <b>birikmiş talep</b> kalemi olur.
          </li>
          <li>
            Stok en erken ihtiyaçtan başlayarak düşülür: önce birikmiş talep, sonra
            bu hafta, sonra gelecek hafta ve böyle devam eder. Kalan, üretilmesi
            gereken miktardır.
          </li>
          <li>
            <b>Satış günleri — ZPP_DAILY.</b> ZPP_DAILY dosyasının kapsadığı her
            gün için talep dosyadaki tam tarihe düşer: çarşamba sevk edilen 5 000,
            günde 1 000 değil, çarşamba günü 5 000’dir. Dosyanın son gününden
            sonra haftalık ZPP, fabrikanın çalışma günlerine eşit dağıtılır —
            tatil olmayan ve en az bir iş yerinin normal vardiyası olan günler;
            mesai bir günü çalışma günü yapmaz (kısmen kapsanan bir haftanın
            haftalık toplamının kalanı kapsanmayan günlere düşer). Birikmiş talep
            bugün vadelidir.
          </li>
          <li>
            <b>Önce ZPP_DAILY — haftalık ZPP uzun vadelidir.</b> ZPP_DAILY
            yüklendiğinde (ve bugüne ulaştığında), kapsadığı günler için SAP’nin
            taahhüdüdür. Haftalık ZPP’den gelen talep — ZPP_DAILY’nin son gününden
            sonraki günler ve ZPP_DAILY satırı olmayan her parça — ayrı bir{' '}
            <b>uzun vadeli</b> lot olur. Uzun vadeli lotlar yalnız{' '}
            <b>tüm günlük lotlardan sonra</b> (birikmiş, acil, dolgu ve öne alınan
            lotlar), yalnız kalan kapasiteye yerleştirilir; kalıbını setupsız sürdüren
            bir günlük işin önüne hiçbir zaman geçmez ve <b>hiçbir zaman geç olmaz</b>.
            ZPP_DAILY’nin yalnız kısmen kapsadığı bir hafta karıştırılmaz,{' '}
            <b>bölünür</b>: kapsanan günler günlük lotu, kalanı{' '}
            <code>W38 LT</code> etiketli uzun vadeli lotu oluşturur. Tam rulo kuralı
            yine geçerlidir: günlük lotun artan parçaları uzun vadeli lotu azaltır.
            Örnek: ZPP_DAILY çarşambaya kadar, pazartesi 1 000 ve çarşamba 1 000;
            haftalık W38 = 5 000; bir rulo 2 500 adet verir → günlük lot 2 500 (bir
            rulo, yalnız pazartesi ve çarşamba kontrol edilir) + uzun vadeli lot
            2 500 (perşembe–cuma 3 000 − 500 artan). ZPP_DAILY yoksa hiçbir şey uzun
            vadeli değildir ve haftalık ZPP eskisi gibi planlanır.
          </li>
          <li>
            <b>Zamanlama — öngörülen stok.</b> Motor gün gün ilerleyerek stokun
            — daha önce planlanan her lot dahil — sıfırın altına düşeceği günü
            bulur. Bu, lotun <b>stok bitiş günüdür</b>.
          </li>
          <li>
            <b>Emniyet stoku.</b> Lot, stok bitiş gününden{' '}
            <b>{current.safety} iş günü</b> önce başlayabilir, daha erken değil;
            böylece stok yığılmaz ve iş yeri ona ihtiyacı olan parçalara açık
            kalır. Bu gün bugünse ya da geçmişse lot <b>acil</b>dir; değilse{' '}
            <b>dolgu</b>dur.
          </li>
          <li>
            <b>Üretildi ama henüz stok dosyasında yok.</b> Son MB52 yüklemesinden
            sonra çalışan onaylı işler, bir sonraki yüklemeye kadar stok sayılır.
            Örnek: pazartesi 6 000 adet basıldı, stok salı sabahı yeniden yüklendi
            — aradaki sürede bu 6 000 ikinci kez planlanmaz. Bu varsayım
            kullanıldığında Production Plan bunu belirtir.
          </li>
          <li>
            <b>Ortak ürünler</b> aynı vuruştan çıkar, bu yüzden ayrı ayrı
            yapılamaz. Her hafta için çift, iki ihtiyaçtan büyük olanına göre
            yapılır ve çift <b>tek lot ve tek iş</b>tir — diğerini ortak ürünü
            olarak gösteren parçada. İş iki miktarı da gösterir; iş yeri süresi
            ve setup bir kez sayılır.
          </li>
          <li>
            <b>Tam rulo — her zaman.</b> Takılan bir rulo sonuna kadar çalışılır;
            bu yüzden rulodan beslenen her lot tam sayıda ruloya eşittir (rulo
            başına vuruş × göz). Artan miktar sonraki haftaları karşılar ve yeni
            bir rulo doğurmaz; birikmiş talep ile bu haftanın ihtiyacı aynı ruloyu
            ve aynı setup’ı paylaşır. Bir rulo <b>hiçbir zaman yarıda kesilmez</b>
            — ne bir boşluğa sığdırmak ne de geç bir işi kurtarmak için.
          </li>
          <li>
            <b>Rulo yerine Min. lot.</b> Rulo miktarının esnek olduğu yerlerde
            (transfer iş yerleri 106/107) master data’ya bir <b>Min. lot (pcs)</b>{' '}
            girilir. Ruloyu yerine geçer: lot en az o kadar adettir, üstünde ise
            tam ihtiyaç kadar (ihtiyaç 300, min. lot 2 000 → 2 000; ihtiyaç
            2 500 → 2 500). Artan miktar sonraki haftaları karşılar. Bu durumda
            rulo ağırlığı dikkate alınmaz ve boş kalabilir.
          </li>
          <li>
            <b>İkisi de yok mu?</b> Min. lot’u ve gerçek rulo ağırlığı olmayan (boş
            ya da yer tutucu olarak 1 kg) bir parça master data hatasıdır: tam
            ihtiyaç kadar planlanır; plan ve Master Data sayfası bu konuda uyarır.
          </li>
          <li>
            <b>Hiç rulo yok</b> (somun kaynağı, punta kaynağı, montaj …): çevrim
            süresi olan ve rulosu ya da sacı olmayan bir parça uyarı{' '}
            <b>olmadan</b> tam ihtiyaç kadar (ya da Min. lot’u kadar) planlanır ve
            Raw Material sayfası bunun sacını istemez.
          </li>
        </ul>
        <Example>
          Birikmiş talep 200 adet, gelecek hafta 2 000 adet, stok yok. Bir rulo
          5 000 adet verir. Birikmiş talep bir rulo gerektirir, bu yüzden şimdi
          5 000 adet basılır; artan 4 800 gelecek haftayı karşılar. Sonuç: iki
          değil, tek iş ve tek setup.
        </Example>
      </Step>

      <div className="mt-4 max-w-4xl">
        <StockExample safetyDays={2} />
      </div>

      <Step n={3} id="capacity" title="Kapasiteyi kur">
        <p>Her iş yeri ve ufkun her günü için:</p>
        <Formula>
          net dakika = normal vardiya × vardiya süresi + mesai pencereleri − planlı duruşlar → × kapasite faktörü
        </Formula>
        <ul>
          <li>
            Her iş yerinin <b>tek bir takvimi</b> vardır: standart haftası (“N gün”
            pazartesiden doldurulur: 5 = Pzt–Cum, 6 = Pzt–Cmt; günlük vardiya sayısı),
            varsa bir <b>hafta istisnası</b> ve bir mesai tanımıyla — başlangıç saati
            ve süre — tarihlere (ya da düzende her haftaya) açılan <b>mesailer</b>.
            Capacity Dashboard’da açılan mesai de aynı kayıttır.
          </li>
          <li>
            Bir <b>gün kaydı</b>, bir iş yeri ve bir gün için son sözdür: Production
            Plan’da <b>Work calendar</b> kutusunda <b>Edit</b>’e basın; ardından bir
            hücreye tıklamak o vardiyayı açar ya da kapatır, <b>Save</b> bütün haftayı
            bir kerede yazar (Cancel vazgeçer). Gün kaydı hafta istisnasına, düzene ve
            tatile üstün gelir (sıra: gün kaydı → hafta istisnası → düzen). Vardiyaların
            birbirini izlemesi gerekmez: yalnız 3. vardiya (07:00’den başlayan 8 sa’lik
            vardiyalarla 23:00–07:00) 480 dk’dır; 30 dk 3. vardiya yemeğiyle net 450 dk.
            O günün mesaisiyle çakışan bir vardiya reddedilir; ↺ kaydı siler. Aynı Edit
            modunda OT satırı o günün tarihli mesaisini ekler ya da kaldırır; Save önce
            mesai silmelerini, sonra gün kayıtlarını, sonra yeni mesaiyi uygular. Plana
            bir sonraki Calculate plan’da yansır.
          </li>
          <li>
            Resmî tatil izin günüdür: vardiyaları kaybolur, hiçbir zaman başka bir
            güne taşınmaz. Tatile açılan mesai planlanır. Tekrarlayan mesai tatilde
            çalışmaz — onu o tarihe açın.
          </li>
          <li>
            Vardiyalar aynı süreye sahiptir ve ilk vardiya başlangıcından itibaren
            birbirini izler (ör. 07:00’den 2 × 9 sa: 07:00–16:00, 16:00–01:00). Mesai
            normal vardiyalarla ya da başka bir mesaiyle çakışamaz.
          </li>
          <li>
            <b>Mesai vardiya ızgarasının içine değil, dışına açılır.</b> İş yerinin
            çalıştığı bir günde vardiyalar günün ızgarasıdır: kapalı bir vardiya mesai
            olarak değil, iş takviminde yeniden açılır. Bu yüzden mesai yalnız
            ızgaranın sonu ile üretim gününün sonu arasına sığar. <b>8 sa</b>’lik
            vardiyası olan bir iş yerine günde 3 vardiya sığar, ızgara 24 saatin
            tamamını kaplar ve <b>çalışma gününde mesai açılamaz</b> — mesai, iş
            yerinin çalışmadığı bir güne, normalde <b>cumartesi ya da pazara</b>{' '}
            açılır. <b>9 sa 40 dk</b>’lık vardiyası olan bir iş yerine 2 vardiya sığar
            (06:30–16:10 ve 16:10–01:50 = 19 sa 20 dk); bu yüzden 01:50–06:30 ızgaranın
            dışındadır ve oraya en fazla 4 sa 40 dk’lık bir gece mesaisi açılır. Hiç
            normal vardiyası olmayan bir gün (cumartesi, pazar, tatil) tamamen normal
            düzenin dışındadır: günün tamamına mesai açılabilir.
          </li>
          <li>
            Mesai yine de gerçekten boş olan zamana sığmalıdır: üretim günü
            (ilk vardiya başlangıcından itibaren 24 sa) eksi açık vardiyalar ve daha önce açılmış
            mesailer. Production Plan’daki <b>Work calendar</b> kutusu sonucu her günün OT satırına
            yazar — <i>free 01:50–06:30</i>, pencere doluysa <i>full</i>, ya da ızgara hiç pencere
            bırakmıyorsa <i>shifts cover 24 h</i>; sığmayan bir mesai seçilemez. Gösterilen haftanın
            tamamı, kapalı cumartesi ve pazar dahil, düzenlenebilir — hafta sonu çalışması da böyle
            açılır: ya mesai olarak ya da vardiyaların kendisini açan bir gün kaydı olarak.
          </li>
          <li>
            Work Calendar düzeni olmayan bir iş yerinin kapasitesi yoktur; Production Plan kırmızı
            bir alarm gösterir. Bir gün hiçbir zaman 24 saati aşmaz (planlı duruşlar dahil), bu yüzden
            bir iş yerinin haftası hiçbir zaman 168 saati aşmaz — daha uzun girişler kaydedilirken reddedilir.
          </li>
          <li>Mesainin içine düşen planlı duruşlar da düşülür.</li>
          <OperatorPlanItem />
          <li>
            Geçmiş günler atlanır ve bugün şu anki saatten başlar — geçmişe
            hiçbir şey planlanmaz. Plan günü ilk vardiyayla ({current.shiftStart})
            başlar; bu yüzden saat 02:00’de gece vardiyası hâlâ bir önceki güne
            aittir.
          </li>
          <li>
            Her iş yeri kesintisiz tek bir zaman çizgisidir: vardiya ya da gün
            bitmeden tamamlanmayan bir iş, bir sonraki vardiyada devam eder.
          </li>
        </ul>
      </Step>

      <Step n={4} id="blocks" title="Çalışamayanı kapat">
        <ul>
          <li>
            <b>Frozen days</b>: ilk günlerdeki onaylı plan işleri tam bulundukları
            yerde tutulur ve ürettikleri miktar talepten düşülür. Motor yalnız
            onların çevresindeki boş zamanı planlar.
          </li>
          <li>
            <b>Onaylanan ve taşınan işler</b>: tek başına onaylanan (tıklayın → Approve this job) ya da
            Gantt’ta başka bir iş yerine, güne veya saate sürüklenen (telefonda: basılı tutup sürükleyin;
            ya da tıklayın → Move…) bir iş, orada aynı şekilde kilitlenir — yerinde tutulur, miktarı o
            parçanın talebinden düşülür, diğer işler onun çevresine planlanır. Taşıma, işin setup, onay,
            üretim ve frekans duruşu dakikalarını sırasıyla korur ve bırakıldığı noktadan itibaren hedef
            iş yerinin çalışma dakikalarına döker; bir gün dolunca bir sonraki çalışma gününde devam eder
            (ör. 1350 dakikalık bir günün 1200. dakikasına bırakılan 120 dk setup + 600 dk üretim: setup
            1200–1320, o gün 30 dk üretim, kalan 570 dk bir sonraki çalışma günü). Şu andan önce
            başlayamaz, planın sonundan önce bitmelidir ve o iş yerindeki başka bir onaylı ya da
            dondurulmuş işle veya bakımla çakışamaz.
          </li>
          <li>
            <b>Elle eklenen işler</b> (Plan → + Add job, ör. stok için çalıştırılan bir parça): parça, miktar,
            iş yeri, gün ve başlangıç saati. Grafikteki boş bir aralığa (kesikli turuncu çizgi) tıklamak aynı
            formu o iş yeri, gün ve aralığın başlangıç saati dolu olarak açar. Süre, motorun o parça ve miktar
            için kendi hesabıdır, motorun sırasıyla — setup (kalıp zaten bağlıysa yok), kalite onayı, rulo
            başına üretim ve rulodan beslenen iş yerinde rulolar arasında rulo değişimi (ör. 90 dk setup +
            15 dk onay + 200 ve 150 dk’lık rulolar ve 20 dk rulo değişimi = 475 dk). İş, taşınan bir iş gibi
            o saate kilitlenir: miktarı parçanın gelecekteki talebinden düşülür, böylece o parçanın sonraki
            lotları küçülür ya da kaybolur ve iş yerinin diğer işleri onun arkasına kayar. Sınırlar
            taşımadakiyle aynıdır; o iş yeri için tanımlı olmayan bir parçaya uyarıyla izin verilir.
          </li>
          <li>
            <b>Silme</b> (bir işe tıklayın): elle eklenen iş → <i>Delete job</i>, plandan çıkar ve miktarı artık
            talepten düşülmez; onaylı ya da taşınmış iş → <i>Remove approval</i>, motora geri döner ve motor onu
            yeniden planlar; motor işi → <i>Delete this lot</i>, lot 0 adete çekilir ve talebi o parçanın sonraki
            lotlarına geçer (lot miktarına 0 yazmakla aynı).
          </li>
          <li>
            <b>İş yeri bakımı</b> o saat aralığını iş yerinin gününden çıkarır;
            işler onun çevresinden akar.
          </li>
          <li>
            <b>Makine arızası</b> (Machine Follow-up’ta “the work center is
            stopped” ile bildirilen): iş yeri arızadan beklenen dönüş saatine kadar
            — beklenen saat yoksa arıza çözülene kadar — kapatılır. Kapalı bir dönem
            gibi planlı bir duruştur: üretim ona kadar çalışır ve ondan sonra devam
            eder, kesilen rulo bitirilir ve kalan rulolar yeni bir lot olarak gelir
            (bkz. <i>Planlamacının müdahalesi</i>). İş yerini durdurmayan bir arıza
            planı değiştirmez.
          </li>
          <li>
            <b>Kalıp bakımı</b> günleri: o kalıpla yapılan bir işin hiçbir parçası
            bu günlere düşemez.
          </li>
          <li>
            <b>Kalıp hazır değil</b>: hazır olma tarihi (ve saati) varsa kalıp o ana
            kadar kapalıdır — saat 10:00’da hazır demek, o günün daha erken saatleri
            de kapalı demektir; tarih yoksa kalıp tamamen plan dışında tutulur.
          </li>
          <li>
            <b>Vuruş limiti alarmı</b>: bir kalıp periyodik bakım limitini geçince,
            alarm kapatılana kadar plan dışında tutulur.
          </li>
          <li>
            <b>Hariç tutulan</b> malzemeler (sizin kuralınız) planlanmaz.
          </li>
        </ul>
      </Step>

      <Step n={5} id="order" title="İşleri sıraya koy">
        <p>İhtiyaçlar şu sırayla, tek tek planlanır:</p>
        <ol className="list-decimal">
          <li>Öne aldığınız malzemeler (ve geç kalmasın diye öne alınan lotlar)</li>
          <li>
            <b>Birikmiş talep</b> — stoktan sonra kalan ZPP gecikmiş miktarı. Ertesi
            gün saat {current.cutoff}’da vadelidir.
          </li>
          <li>
            <b>Acil</b> — stoku şimdi emniyet seviyesine düşen lot: {current.safety}{' '}
            iş günü içinde biter. Stokun bittiği gün saat {current.cutoff}’da
            vadelidir.
          </li>
          <li>
            <b>Dolgu</b> — diğer her lot: ileriki günler ve haftalar. Stoku bitmeden{' '}
            {current.safety} iş günü önce, ya da bir iş yeri boş kalacaksa{' '}
            {current.pullForward} güne kadar daha erken başlayabilir.
          </li>
          <li>
            <b>Uzun vadeli</b> (yalnız ZPP_DAILY yüklüyse) — haftalık ZPP’den gelen
            lotlar. Yukarıdakilerin hepsinden, öne alınan malzemelerden bile sonra
            gelir ve yalnız kalan boş kapasiteyi doldurur. Örnek: tek iş yeri, tek
            vardiya; D parçasının ZPP_DAILY’de çarşamba 7 000 adet ihtiyacı var
            (700 dk + 30 dk setup), L parçasının yalnız haftalık 4 000’i var. D
            pazartesi önce çalışır ve zamanındadır; L salı günü uzun vadeli lot
            olarak gelir ve geç değildir. L önce gitseydi D çok geç hazır olurdu.
          </li>
        </ol>
        <p>
          Birikmiş talep, ikisi aynı anda vadeli olsa bile her zaman aciden önce
          gelir. <b>Tek istisna — bağlı kalıp:</b> acil bir iş, bağlı kalıbının hâlâ
          bekleyen bir dolgu lotu olduğu bir iş yerinde setup gerektirecekse, acil iş
          teslim saatine hâlâ yetiştiği sürece o dolgu lotu setupsız önce çalışır.
          Aksi hâlde kalıp acil iş için sökülür ve sonra yeniden bağlanırdı — bir
          yerine iki setup. Acil iş geç kalacaksa önce o gider.
        </p>
        <p>
          Her grubun içinde stoku önce biten lot önce gider. Bu da eşitse,{' '}
          <b>en az iş yerinde</b> çalışabilen parça önce gider: tek iş yerli bir
          parça, alternatifi olan bir parçadan önce yerini alır; alternatifli parça
          sonra kalan iş yerlerine dağılır. Önce yerleşen en iyi yerleri alır.
        </p>
      </Step>

      <Step n={6} id="place" title="Her işi yerleştir">
        <p>
          Adaylar malzemenin ana iş yeri ve — <b>yalnız parça master data’da
          Flexible work center olarak işaretliyse</b> — alternatifleridir (ya da
          yalnız sabitlenen iş yeri). Esnek olmayan bir parça, geç kalacak olsa bile
          her zaman ana iş yerinde çalışır: kalite onayı o iş yerine aittir. Motor her
          adayda en erken boş zamanı arar — daha önce kalan boşluklar dahil — ve
          işi kurar:
        </p>
        <div className="my-3 flex flex-wrap items-center gap-2 text-xs">
          <Block tone="bg-slate-200 text-slate-900">Kalıp setup</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-amber-100 text-amber-900">Kalite onayı</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-emerald-100 text-emerald-900">Üretim (rulo 1)</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-sky-100 text-sky-900">Frekans duruşu (ör. rulo değişimi)</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-emerald-100 text-emerald-900">Üretim (rulo 2)</Block>
          <span aria-hidden>→ …</span>
        </div>
        <Formula>
          saf süre = adet × çevrim süresi (dk/adet) · iş süresi = max(saf süre ÷ Accepted OEE, saf süre + setup +
          frekans duruşları + onay)
        </Formula>
        <p className="text-xs text-muted-foreground">
          Her iş yerindeki her parça — pres, somun kaynağı, punta kaynağı, montaj — bu şekilde süre alır;
          hiçbir iş yeri plan dışında kalmaz. Örnek: {cycleExample.qty.toLocaleString('en-GB')} adet ×{' '}
          {cycleExample.minutes.toFixed(CYCLE_DECIMALS)} dk = {Math.round(cycleRun.theoreticalRunMinutes)} dk saf süre;{' '}
          %{Math.round(cycleExample.oee * 100)} Accepted OEE ile iş {Math.round(cycleRunOee.totalMinutes)} dk’dır.
          Çevrim süresi olmayan ama eski SPM ve göz sayısı olan bir parça 1 ÷ (SPM × göz) dk/adet çalışır — süresi
          eskisinin tam aynısıdır (vuruş ÷ SPM). İkisi de yoksa parçanın hızı yoktur ve plan kontrolü onu
          işaretler (“no cycle time in master data”). Bir master data dosyası süreyi saniye olarak da verebilir —
          presler, punta kaynağı ve montaj hatlarının hepsi böyle ölçülür (<b>Saturasyon</b> ya da{' '}
          <b>Birim süre saniye</b> sütunu) — ve yükleme bunu 60’a böler:{' '}
          {cycleSecondsExample} sn = {cycleFromSeconds?.toFixed(CYCLE_DECIMALS)} dk/adet. Çevrim süreleri{' '}
          {CYCLE_STORE_DECIMALS} ondalıkla saklanır ve {CYCLE_DECIMALS} ondalıkla gösterilir, çünkü bir pres
          parçası bir saniyenin altında çalışabilir: {pressSecondsExample.toFixed(CYCLE_DECIMALS)} sn{' '}
          {formatCycleInput(pressCycle)} dk/adet’tir; {CYCLE_DECIMALS} ondalıkta{' '}
          {pressCycle.toFixed(CYCLE_DECIMALS)} olurdu — o parçanın her işinde %2,6 daha fazla süre
          (10.000 adet için {(10_000 * pressCycle).toFixed(1)} dk’ya karşı{' '}
          {(10_000 * Number(pressCycle.toFixed(CYCLE_DECIMALS))).toFixed(1)} dk).
          Vuruş = ⌈adet ÷ göz⌉ (göz girilmemişse = adet) yalnız kalıp vuruş limiti
          ve rulo başına vuruş için sayılır.
          Setup, frekans duruşları (rulo değişimleri …) ve kalite onayı bu sürenin içindedir; sığmazlarsa iş, saf
          süre artı bu duruşlardır. Frekans duruşu = rulo − 1 (rulo = ⌈miktar ÷ rulo başına adet⌉, rulo başına adet = ⌊rulo ağırlığı ÷
          brüt ağırlık⌋); frekans duruşu — none — olan bir iş yeri bunun için hiç durmaz.
          Ortak ürün aynı vuruşlardan çıkar:
          vuruş × kendi göz sayısı.
        </p>
        <p>İş aynı anda her kurala uymak zorundadır:</p>
        <ul>
          <li>
            İş yerinde aynı kalıp zaten bağlıysa setup atlanır.
          </li>
          <li>
            {current.crossShifts
              ? 'Bir setup vardiya sonuna yakın başlayıp bir sonraki vardiyada bitirilebilir; günün son çalışma dakikasını hiçbir zaman aşmaz. Üretim aşabilir.'
              : 'Bir setup ya da rulo değişimi hiçbir zaman vardiya sonunu aşmaz — hiçbir ekip bitiremeyeceği bir setup’a başlamaz. Üretim aşabilir.'}
          </li>
          <li>
            <b>Setup çay ve yemek molalarında da sürer.</b> Setup ekibi
            dolaylı işçiliktir ve molasını setup’tan sonra kullanır. 15 dakika
            sonra 15 dakikalık çay molasına denk gelen 30 dakikalık bir setup yine
            30 dakika sürer; üretim moladan hemen sonra başlar ve mola iş yerine
            hiçbir şeye mal olmaz. Vardiya devri ve bakım duruşları ise setup’ı durdurur.
          </li>
          <li>
            <b>Setup ekibi</b>: normalde fabrikanın herhangi bir yerinde aynı anda en
            fazla {current.plantNormal} kalıp setup’ı yapılır. <b>Dinamik kural:</b>{' '}
            birikmiş talep için ya da aksi hâlde stoku bittikten sonra başlayacak bir iş
            için, üretim daha erken başlasın diye en fazla {current.plantUrgent} setup
            çakışabilir. Acil işler yerleşince setup’lar yeniden birbiri ardına yapılır.
          </li>
          <li>
            <b>İş beklerken boş iş yeri yok</b>: iş yeri aksi hâlde boş kalacaksa bir
            lot, ihtiyaç duyulmadan en fazla {current.pullForward} gün önce
            başlayabilir; böylece plan Work Calendar’da açtığınız çalışma günlerini
            — Capacity Dashboard’un saydığı saatlerin aynısını — doldurur. Acil bir
            şey yoksa iş yerinde zaten bağlı olan kalıp önce bir sonraki lotu için
            çalışmaya devam eder; böylece fazladan setup yapılmaz.
          </li>
          <li>
            Plan grafiğindeki her boş aralık neden orada olduğunu gösterir (setup
            ekibi meşgul, kalıp başka iş yerinde, henüz izin yok, …).
          </li>
          <li>
            <b>Vinç</b>: bir holde kalıp setup’ları arasında en az{' '}
            {current.setupGap} dk olur ve aynı anda en fazla {current.concurrent}{' '}
            setup yapılır; rulo değişimleri arasında en az {current.coilGap} dk olur;
            bir kalıp setup’ı ile bir rulo değişimi hiçbir zaman çakışmaz.
          </li>
          <li>Bir kalıp aynı anda iki iş yerinde olamaz.</li>
          <li>
            Miktar, kalıbın vuruş limitinden fazla vuruş gerektiriyorsa{' '}
            <b>tam rulolarda</b> partilere bölünür — bir rulo hiçbir zaman partiler
            arasında bölünmez. Tek bir rulo bile limitten büyükse parti o rulodur ve
            iş işaretlenir.
          </li>
          <li>
            Bir lot, emniyet tarihinden (stoku bitmeden {current.safety} iş günü
            önce) eksi {current.pullForward} günlük öne çekme penceresinden önce
            başlamaz.
          </li>
        </ul>
        <p>
          <b>İşi en erken bitiren iş yeri kazanır</b> — tek bir istisnayla: acil bir
          şey yoksa zaten bağlı olan kalıba (setupsız) devam etmek tercih edilir.
          Birikmiş talep için ya da aksi hâlde stoku bittikten sonra başlayacak bir
          iş için motor dinamik setup kuralını da dener ve hangisi daha erken
          bitiyorsa onu tutar. Ardından seçilen iş yeri süresi, vinç aralıkları,
          setup aralığı ve kalıp rezerve edilir ve bir sonraki ihtiyaç yerleştirilir.
        </p>
      </Step>

      <Step n={7} id="check" title="Kontrol et ve raporla">
        <ul>
          <li>
            Bir parça, müşterinin ihtiyaç duyduğu miktar ihtiyaç gününde saat{' '}
            <b>{current.cutoff}</b>’a kadar hazır değilse <b>geç</b>tir — lotun
            tamamı bittiğinde değil. Lotun kapsadığı her gün kontrol edilir, yalnız
            ilki değil. ZPP’deki birikmiş talep ve bugün gereken her şey{' '}
            <b>ertesi gün saat {current.cutoff}</b>’da vadelidir. Resmî tatiller
            atlanmaz: müşteri tatilde de parça isteyebilir. Gecikme saat ve gün
            olarak gösterilir. Motor bunu öyle bırakmaz — bkz.{' '}
            <a href="#late" className="underline">
              Geç işler yeniden planlanır
            </a>
            .
          </li>
          <li>
            <b>İş penceresi</b> (bir çubuğa tıklayın) aynı kontrolü iş bazında
            gösterir: işin kapsadığı <b>Req dates</b> ve miktarları, başlangıç ve
            bitiş saati, ve her ihtiyaç günü için bir <b>Status</b> — o gün saat{' '}
            {current.cutoff}’a göre kaç adetin kaç saat <b>önce</b> ya da{' '}
            <b>geç</b> hazır olduğu. Lotun ihtiyacın ötesinde yaptığı miktar (tam
            ruloya ya da Min. lot’a yuvarlama) <b>fazla stok</b>tur. Örnek: 3.000
            adet birikmiş talep, bir rulo 6.000 yapar → &ldquo;3.000 adet (2 saat
            geç) ve 3.000 adet (fazla stok)&rdquo;. Stoku ufkun tamamı boyunca yeten
            bir işin ihtiyaç günü yoktur: tamamı fazla stoktur (stok oluşturma).
          </li>
          <li>
            Hiçbir yere sığmayan iş, nedeni ve çözüm bağlantısıyla birlikte{' '}
            <b>Unplanned</b>’a gider (master data yok, uygun iş yeri yok, boş
            kapasite yok…).
          </li>
          <li>
            <b>Acil hammadde</b>: planlanan miktar × brüt ağırlık; sacın{' '}
            <b>gerektiği</b> sırayla, rulo stoku artı geliş gününden itibaren yoldaki
            rulolara karşı yürütülür. Sac önümüzdeki {current.rawUrgent} iş günü
            içinde gerekiyorsa rulo acildir; bunlar Overview’da listelenir. Bir işin
            ihtiyaç günü planlandığı gündür — yalnız iş yeri boş kalmasın diye{' '}
            <b>öne çekilen</b> bir iş hariç: mamul stok talebi hâlâ karşılarken onun
            sacı, öne çekildiği günde değil, lotun başlayabileceği günde (stok bitişi
            − emniyet stoku günleri) gerekir. Böyle bir iş ruloyu bekleyebilir; bu
            yüzden planlanan gün ve sacın gerektiği günle birlikte &ldquo;runs short
            later&rdquo; olarak görünür. Ortak ürünler iki kez sayılmaz. Haftalık
            ihtiyaç ayrıdır — bkz.{' '}
            <a href="#raw-mrp" className="underline">
              Hammadde ihtiyacı
            </a>
            .
          </li>
          <li>
            Uyarılar planı değiştiren her şeyi listeler: plan dışı tutulan kalıplar,
            bakımdaki iş yerleri, eksik veriler.
          </li>
        </ul>
      </Step>

      <section id="late" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-950">Geç işler yeniden planlanır</h2>
        <p className="mt-1 text-sm text-amber-900">
          Stoku bittikten sonra başlayan bir iş, müşterinin durması demektir —
          tek pay sizin emniyet stokunuzdur. Bu yüzden geç bir iş hiçbir zaman
          yalnızca raporlanmaz; motor altı tura kadar yeniden planlar:
        </p>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-amber-900">
          <li>
            <b>Geç lotu öne al</b>, kendi grubu içinde: geç bir dolgu lotu dolgu
            lotlarının başına geçer, hiçbir zaman birikmiş talebin önüne değil.
            Sonra her uygun iş yerini yeniden dener; böylece daha erken boşalan
            alternatif bir iş yeri bulunur.
          </li>
          <li>
            <b>Setup’ının çakışmasına izin ver</b>: geç kalma riski olan bir iş,
            başka bir setup sürerken — aynı holde de — setup yapabilir; bütün
            fabrikada aynı anda en fazla {current.plantUrgent}; böylece üretim daha
            erken başlar. Birikmiş ya da geç kalma riskli iş kalmayınca setup’lar
            artık çakışmaz (hol başına bir, fabrikada {current.plantNormal}). Rulo
            değişimleri hiçbir zaman çakışmaz.
          </li>
          <li>
            <b>En iyi planı tut</b>: en az plansız (günlük lotlar), sonra en az geç{' '}
            <b>parça</b> (bir parçanın üç geç lotu tek müşteri duruşudur), sonra en
            az geç saat ve ancak ondan sonra en az plansız uzun vadeli lot. Uzun
            vadeli lotlar hiçbir zaman geç olmaz ve öne alınmaz. İyileştirmeyen bir
            tur aramayı durdurmaz — sonraki tur iyileştirebilir — ama o ana kadarki
            en iyi plan tutulur.
          </li>
        </ol>
        <p className="mt-2 text-sm text-amber-900">
          <b>Geç bir işi kurtarmak için rulo hiçbir zaman kesilmez.</b> Takılan bir
          rulo sonuna kadar çalışılır; kesmek yarım rulo, ikinci bir setup ve sonra
          ikinci bir rulo takma demek olurdu. Öne almak yetmezse iş geç kalır ve
          raporlanır.
        </p>
        <p className="mt-2 text-sm text-amber-900">
          Hâlâ geç olan her şey Overview’da kırmızıyla, <b>malzeme başına bir
          kez</b> (ilk geç lotu) listelenir. <b>Gecikme bütün sipariş değil, bir
          paydır.</b> Yol gösterici ZPP günlük ihtiyacıdır: her ihtiyaç günü bir
          teslim noktasıdır; o güne kadar gereken her şeyle birlikte teslim saatinde
          ({current.cutoff}) vadelidir (ZPP_DAILY kendi tarihinde; ötesinde haftalık
          ZPP çalışma günlerine dağıtılır; birikmiş talep ve bugünün ihtiyacı ertesi
          gün vadelidir). O anda motor o ana kadar basılmış olanı sayar:
        </p>
        <ul className="mt-1 ml-5 list-disc space-y-1 text-sm text-amber-900">
          <li>
            <b>Needed qty</b> — müşterinin kaçırılan ilk teslim noktasına kadar ihtiyaç
            duyduğu miktar (lot büyüklüğü değil, kümülatif ZPP ihtiyacı: 8 günü kapsayan
            40 000 adetlik bir lot, ilk noktada yalnız ilk günün ihtiyacını borçludur).
          </li>
          <li>
            <b>On time</b> — bunun teslim saatinde zaten hazır olan payı. Pres çalıştığı
            sürece parçalar eşit hızda çıkar (setup ve onay parça vermez); bu yüzden son
            tarihten önce başlamış bir iş ihtiyacın bir kısmını teslim etmiştir.
          </li>
          <li>
            <b>Late share</b> — geri kalanı, <b>ortalama</b> ve <b>son parçanın</b>{' '}
            gecikmesiyle: "15% (900 pcs) · avg 0.8 h, last 1.5 h". Son parçanın gecikmesi{' '}
            <i>hazır − teslim saati</i>dir: üretim teslim saatinden 6 sa sonra başlar ve
            j sa sürerse, ihtiyacın tamamı 6 + j sa geç tamamlanır. Müşteri ilk
            parçalardan beslenir; bu yüzden ortalama, hattın gerçekte ne kadar beklediğine daha yakındır.
          </li>
        </ul>
        <p className="mt-2 text-sm text-amber-900">
          Bağımsız plan kontrolü (aşağıda) aynı ZPP ihtiyacını saat saat yeniden oynatır ve
          aynı eksik miktarı ve toparlanma süresini raporlar; bu yüzden ikisi her zaman uyuşur.
        </p>
        <p className="mt-2 text-sm text-amber-900">
          <b>Why late</b>, planın kendisinde bulunan nedenleri en güçlüsünden
          başlayarak verir:
        </p>
        <ul className="mt-1 ml-5 list-disc space-y-1 text-sm text-amber-900">
          <li>plan hesaplandığında zaten vadesi gelmişti (birikmiş talep ya da stok bugünü karşılamadı);</li>
          <li>
            şimdi başlasa bile yetişemez — işin tek başına son tarihe kadar kalandan daha
            fazla pres süresine (setup + onay + üretim) ihtiyacı var;
          </li>
          <li>
            iş yeri ondan önce dolu: kaç iş ve kaç saat; daha önce gereken, dondurulmuş /
            onaylı ve daha sonra gereken olarak ayrılmış; hangilerinin bir plan
            müdahalesiyle önce yerleştirildiği;
          </li>
          <li>pres setup’tan önce bekledi (setup ekibi, kalıp başka preste…);</li>
          <li>setup başlangıcı ile hazır olma arasında presin çalışmadığı saatler (vardiya yok, hafta sonu, molalar);</li>
          <li>%100’ün altında bir kapasite faktörü.</li>
        </ul>
        <p className="mt-2 text-sm text-amber-900">
          <b>Saatler nasıl hesaplanır</b> (satıra dokunun): setup başlangıcı → setup +
          kalite onayı + gereken parçaların parçanın hızıyla üretimi (saatte adet =
          60 ÷ çevrim süresi × performans) → teslim saatinde hazır olan adet (zamanında
          pay) → gereken son parçanın hazır olma saati. Son parça gecikmesi = hazır −
          gerektiği an (ihtiyaç günündeki teslim saati). Pres yetiştiremiyorsa{' '}
          <i>Why late</i>, presin setup başlangıcı ile son tarih arasındaki üretim süresini
          gereken parçaların aldığı süreyle karşılaştırır. Yanında bunu belirleyen girdiler
          vardır — talep ve mamul stok, hız, setup ve onay dakikaları, vardiyalar ve teslim
          saati — ayarlandıkları yerlere bağlantılarıyla. Bunlardan biri yanlışsa (ör. 60
          yerine 600 dk setup, eksik bir vardiya) parça yalnızca geç <i>görünür</i>:
          orada düzeltin ve yeniden hesaplayın.
        </p>
      </section>

      <section id="scenarios" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Senaryolar — başka planları denemek</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          İşleri yerleştirmenin tek bir sırası her zaman en iyisi değildir. Yukarıdaki
          plan kurulduktan sonra motor onu başka varyasyonlarla yeniden kurar ve en
          iyisini tutar:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            Aynı aciliyet içinde <b>sıra</b>: stok bitiş günü (standart), önce en kısa
            iş, önce en uzun iş, önce en az iş yeri olan parçalar ve karıştırılmış
            sıralar.
          </li>
          <li>
            <b>İş yeri seçimi</b>: önce bitiren iş yeri (standart), önce
            başlayabilen ya da en az yüklü olan.
          </li>
          <li>
            <b>En iyi</b> şu demektir: en az plansız günlük lot, sonra en az geç parça,
            sonra en az geç saat, sonra en az plansız uzun vadeli lot, sonra en yüksek
            üretim süresi (setup üretim sayılmaz), sonra en az setup. Doluluk hiçbir
            zaman geç bir parçanın önüne geçmez.
          </li>
          <li>
            <b>Doluluk</b> = önümüzdeki 7 günde dolu iş yeri saati ÷ kullanılabilir saat
            (çalışma takvimi eksi bakım), bütün iş yerleri birlikte.
          </li>
          <li>
            <b>Arama durur</b>: hiçbir şey geç değilken %{current.target}’e ulaşılınca,{' '}
            {current.maxScenarios} senaryodan sonra, iyileşmesiz 25 senaryodan sonra
            ya da iki dakika sonra. Ardından Production Plan ulaşılan seviyeyi (ör.
            "best of {current.maxScenarios} scenarios reaches 90%"), her iş yerinin
            doluluğunu ve karşılaştırılan senaryoları gösterir.
          </li>
          <li>
            Ardından <b>yerel arama</b> her geç parça üzerinde doğrudan çalışır: onu
            grubunda 1, 2 ya da 4 gün öne alır, "moved forward" işaretini değiştirir ya
            da aynı iş yerinde ondan önce çalışan geç olmayan bir parçayı 2 gün geri
            alır. Her hamle bütün planı yeniden kurar ve yalnız plan iyileşirse tutulur
            (en fazla 150 hamle ya da bir dakika).
          </li>
          <li>
            <b>Lot bölme</b> (yine yerel arama): aynı iş yerinde geç bir parçadan önce
            çalışan uzun bir lot — diyelim 30.000 adet — 2 ya da 3 parçaya kesilir, böylece
            geç parça onların <i>arasında</i> çalışır: 15.000, geç parça, sonra diğer 15.000.
            Parçalar her zaman tam ruloluktur (takılı rulo hiçbir zaman kesilmez), ilk parça
            önce gerekeni karşılar (tam ruloya yuvarlanır) ve bir parça Min. lot’un altına
            düşecekse lot bölünmez. Hiçbir ihtiyacı karşılamayan parça yalnızca rulo
            fazlasıdır ve dolgu olarak planlanır; böylece artık acil parçaları
            bekletmez. İkinci parça bir setup daha gerektirir; bu yüzden bölme yalnız geç
            bir parçayı kurtarıyorsa tutulur; plan işleri{' '}
            <i>"lot split 1/2"</i> olarak işaretler ve plan kontrolü bölünen lotları
            listeler. Grafikte bir miktar değişikliği lotun tamamına uygulanır.
          </li>
        </ul>
      </section>

      <section id="press-start" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Planlamacının müdahalesi — kapalı dönemler ve gecikmeler</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Siz aksini söylemedikçe her iş yeri şu andan itibaren planlanır. Production
          Plan’ın sol üstünde (<b>Plan settings</b>) yeniden hesaplamadan önce iş yeri
          bazında şunları ayarlayabilirsiniz:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            Bir nedenle birlikte <b>Closed from – to</b> (tarih ve saat) — operatör yok,
            hammadde yok… İş yeri bu iki an arasında iş almaz; kapalı saatler grafikte
            görünür. Şu andan <i>to</i>’ya kadar kapatmak için <i>from</i>’u boş bırakın.
            Örnek: 07:00 vardiyasında pazartesi 07:30 – 10:00 kapalı — 60 dakikalık bir iş
            ilk yarım saate sığmaz, bu yüzden 10:00’da başlar; daha sonraki bir kapalı
            dönemden (12:00 – 14:00) önceki bir iş taşınmaz. Kapalı döneme dokunan onaylı
            işler serbest bırakılır ve yeniden planlanır.
          </li>
          <li>
            <b>Kapalı bir dönem — ve presi durduran açık bir arıza — duvar değil, planlı
            bir duruştur.</b> Üretim ona kadar çalışır, pres rulo hâlâ içindeyken durur
            ve ondan sonra devam eder — çalışılmayan bir vardiya gibi. Setup, kalite onayı
            ve rulo değişimleri onu aşmaz; duruş setup’tan hemen sonra gelirse (henüz
            vuruş yoksa) iş bunun yerine duruştan sonra başlar. Duruş bir ruloyu
            kestiğinde iş o rulo bitince biter; kalan rulolar hemen ardından planlanan
            yeni bir lot olur (kalıp hâlâ bağlı, bu yüzden setup yok). Örnek: rulo başına
            1.000 adet, rulo başına 100 dk, 3 rulo, 07:00 vardiyasında 09:00 – 10:00
            duruş: setup 07:00 – 07:30, ilk rulo 07:30 – 09:00 ve 10:00 – 10:10 → 1.000
            adetlik bir iş; diğer 2.000 adet 10:10’da gelir. Kalıbın bunun yerine sökülmesi
            gerekiyorsa o lotu elle iptal edin.
          </li>
          <li>
            <b>Behind / ahead</b> (saat): hat onaylı plana uymadı. +3 sa, onaylı
            (dondurulmuş ve çalışan) işleri 3 saat ileri kaydırır ve ilk 3 saati "Behind
            plan" olarak kapatır; −2 sa onları öne getirir, hiçbir zaman şu andan önceye
            değil. "All work centers" bunu tek seferde bütün hat için ayarlar.
          </li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          Onaylanmamış işler düzeltme gerektirmez: her Calculate plan planı şu andan
          itibaren yeniden kurar.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Yanında <b>Work calendar</b>, seçilen iş yerini hafta hafta gösterir: planın
          kullandığı şekliyle günlük 1–3 vardiya (Work Calendar, hafta istisnaları, tatiller,
          gün kayıtları) ve mesai saatleri. <b>Edit</b>’e basana kadar salt okunurdur: sonra
          bir hücreye tıklamak o vardiyayı açar ya da kapatır — bir gün kaydı (bkz.{' '}
          <a href="#capacity">Kapasiteyi kur</a>) — ve OT satırı o günün mesaisini ekler ya
          da kaldırır. Kapalı olduğu için plan günlerinde bulunmayan cumartesi ya da pazar
          dahil haftanın her günü düzenlenebilir; OT satırı yalnız o günün boş penceresine
          sığan mesaiyi sunar ve gün zaten 24 saat çalışıyorsa <i>full (24 h)</i> yazar.{' '}
          <b>Save</b>’e kadar hiçbir şey yazılmaz; kesikli bir hücre bir sonraki
          Calculate plan’a kadar planda değildir.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Grafikte bir iş <b>her çalışma aralığı için bir çubuk</b> olarak çizilir. Planlı
          duruşlar çubuğu bölmez — içinde küçük noktalardır — ama <b>kapalı bir vardiya
          böler</b>: 1. ve 3. vardiya açık, 2. vardiya kapalıyken iş 07:00–15:00 ve
          23:00–07:00 olarak çizilir, 15:00–23:00 boş kalır, çünkü iş yeri o sırada çalışmaz.
        </p>
      </section>

      <section id="org-filter" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Bölüm, masraf yeri ve iş yeri filtresi — kural değil, görünüm</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Üç sayfa aynı filtreyi taşır: <Link to="/planlama" className="underline">Production Plan</Link>,{' '}
          <Link to="/referanslar" className="underline">Master Data</Link> ve{' '}
          <Link to="/capacity" className="underline">Capacity Dashboard</Link>. Önce bir{' '}
          <b>bölüm</b>, sonra onun bir ya da birkaç <b>masraf yeri</b>ni, sonra — Master Data ve
          Capacity Dashboard’da — bir ya da birkaç <b>iş yeri</b>ni seçersiniz. Her seviye bir
          sonrakini daraltır; böylece seçebileceğiniz iş yerleri tam olarak o bölümün masraf
          yerlerine ait olanlardır. Her sayfa kendi seçimini bir sonraki açılış için hatırlar.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Her sayfanın daralttığı: Production Plan’da grafik, iş yeri listeleri, <b>Add job</b>{' '}
          parça listesi, <b>Pin to work center</b> listesi ve geç iş sayısı; Master Data’da
          parça listesi — bir parça, ana iş yeri <i>ya da alternatiflerinden biri</i> seçilenler
          arasında olduğu sürece kalır; hiç iş yeri olmayan bir parça hiçbir bölüme ait değildir
          ve yalnız filtre kapalıyken görünür; Capacity Dashboard’da kartlar, grafik ve iş yeri
          listesi.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          <b>Planı ya da sayıları değiştirmez.</b> Plan ve kapasite tahmini her zaman bütün
          fabrika için hesaplanır — kapasite, vinçler, setup ekipleri ve kalıp limitleri ancak
          bütün iş yerleri aynı anda görüldüğünde doğrudur — bu yüzden filtreleme hiçbir işi
          taşımaz, Capacity Dashboard’daki hiçbir saati değiştirmez ve farklı bölümlere bakan iki
          planlamacı aynı planı görür. Motordan hiçbir şey gizlenmez; yalnız ekrandan gizlenir.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Bu yüzden <b>Calculate plan</b> filtre ne gösterirse göstersin her zaman bütün iş
          yerlerini birlikte hesaplar — presleri ve operatör planlı hatları (somun kaynağı, punta
          kaynağı…) tek seferde. Takvim kutusu filtreyi izler: <i>Shift</i> masraf yerinin iş
          yerleri <b>Work calendar</b>’ı (iş yeri bazında vardiya ve mesai), <i>Operator</i> masraf
          yeri ise <b>Operators per shift</b>’i (gün ve vardiya bazında kişi) gösterir; seçim iki
          türü de içeriyorsa ikisi birden görünür. <b>Henüz bağlı değil:</b> preste yapılıp bir
          kaynak hattında kullanılan bir parça her hatta kendi başına planlanır — kaynak işi, parçasını
          yapan pres işini beklemez. Bağımsız kontrol, bu uymadığında uyarır (bkz.{' '}
          <a href="#component-ready" className="underline">ara mamul hazır değil</a>).
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Bağlantı tanımlardan gelir: iş yeri → masraf yeri (
          <Link to="/makineler" className="underline">Work Center Definitions</Link>) ve masraf yeri
          → bölüm (Company settings). Masraf yeri olmayan bir iş yeri kaybolmasın diye{' '}
          <i>Without a department</i> altında listelenir. Her seçenek kaç iş yeri içerdiğini
          gösterir. Her iş yeri plandadır — presler kadar somun kaynağı, punta kaynağı, robot ve
          montaj hatları da — çünkü her parça çevrim süresiyle süre alır (bkz.{' '}
          <a href="#inputs" className="underline">Verileri topla</a>); “planlanmayan” iş yeri
          yoktur.
        </p>
      </section>

      <section id="capacity-dashboard" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Capacity Dashboard — Prediction OEE ve Accepted OEE</h2>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b>Kapasite</b>, planın kullandığı net saatlerin aynısıdır (3. adım): plan, Work
            Calendar, Capacity Dashboard ve Performance için tek formül.
          </li>
          <li>
            <b>Talep saati</b> = adet × çevrim süresi ÷ 60 ÷ OEE; mamul stok düşüldükten sonra,
            en erken hafta önce; bu hafta birikmiş talebi taşır. Gruplar iş yeri <b>kategorileri</b>dir.
          </li>
          <li>
            <b>A) Prediction OEE</b> — dashboard’da ayarlanan, her parça için tek oran
            (%{current.predictionOee}). Yalnız o görünüm için bir “ya olursa” hesabıdır ve planı
            hiçbir zaman değiştirmez.
          </li>
          <li>
            <b>B) Accepted OEE</b> — her parçanın Master Data’daki değeri, planla aynı.
          </li>
          <li>
            İkisi de aynı yöntemi kullanır: kullanılabilir saatler olduğu gibi, üretim süresi = ideal
            süre ÷ OEE. <b>Kapasite faktörü</b> (Performance sayfası) üçüncü, ayrı bir sayıdır:
            onaylı plana karşı ölçülen gerçekleşme; planın kapasitesine uygulanır.
          </li>
        </ul>
      </section>

      <section id="oee-short-stops" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">OEE — kullanılabilirlik ve performans, kısa duruşlar</h2>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            Önce süreler toplanır, sonra bölünür — hiçbir zaman yüzdelerin ortalaması alınmaz. <b>Availability</b> = Production ÷ Loading,{' '}
            <b>Performance</b> = Operation ÷ Production, <b>Quality</b> = Good ÷ (Good + Scrap + Reject), <b>OEE</b> = A × P × Q.
            Loading planlı duruşları (molalar, iş yok, deneme: OEE Settings’te mola olarak ayarlanan Reason Code 1) zaten dışarıda bırakır.
          </li>
          <li>
            <b>Kısa duruşlar</b>: {MES_SHORT_STOP_MIN} dk’dan kısa plansız bir duruş <b>performans</b> (hız) kaybıdır;{' '}
            {MES_SHORT_STOP_MIN} dk ya da daha uzun olan <b>kullanılabilirlik</b> kaybıdır. MES zaten böyle çalışır: üretim süresinden
            yalnız {MES_SHORT_STOP_MIN} dk ve daha uzun duruşları düşer; bu yüzden her OEE sayfasında (Dashboard, trendler, haftalık /
            aylık, Daily Report, Board, KPI) A ve P, MES değerleridir.
          </li>
          <li>
            Kayıp sayfaları aynı neden kodunu her duruşun süresine göre ayırır. Loss Bridge yalnız uzun duruşları gösterir (ör.
            “Machine”); kısa olanlar <b>bir köprü adımı değildir</b> — Speed loss = Production − Operation içinde kalır (adım notu
            dakikalarını verir) ve MTTR &amp; MTBF’nin süre kovalarında analiz edilir. Kullanılabilirlik adımına hiç dokunmazlar:
            A, kullanılabilirlik kaybı ve “Not explained” onlarla da onlarsız da aynıdır. Losses Trend bir “Short stops” sütunu
            tutar (Speed = Production − Operation − kısa duruşlar). Toplamlar ve OEE hiçbir zaman değişmez.
          </li>
          <li>
            Sınır OEE Settings → Numbers’ta ayarlanır (varsayılan {MES_SHORT_STOP_MIN} dk, tam dakika). Başka bir değer yalnız kayıp
            ayrımını değiştirir; A ve P MES’teki gibi kalır ve köprü farkı gösterir.
          </li>
          <li>
            Duruş süreleri {dmy(SHORT_STOP_DATA_FROM)} tarihinden itibaren saklanır; öncesinde duruşlar ayrılmaz (hepsi
            kullanılabilirlik) ve sayfa “duration split not available before {dmy(SHORT_STOP_DATA_FROM)}” yazar.
          </li>
          <li>
            <b>MTTR / MTBF</b> varsayılan olarak yalnız sınır ve daha uzun duruşları sayar (arızalar ve setup’lar kullanılabilirlik
            kaybıdır); kısa duruşlar ilk süre kovasıdır. Agent Report, Agent Insights ve Open Topics kalıp ve makine
            (kullanılabilirlik) notları için uzun duruşları, mikro duruş / hız notları için kısa duruşları okur.
          </li>
          <li>
            Örnek (test): 21.09’da PRS-105 3. vardiyada Loading − Production 140,6 dk = 2 dk ve daha uzun duruşlar; daha kısa
            duruşların 21,6 dk’sı Production − Operation içindedir.
          </li>
          <li>
            <b>Tanımsız duruşlar</b>: Reason Code 1 ya da Reason Code 2 “{UNDEFINED_RC1}” (ya da boş bir Reason Code 2), operatörün
            duruşu tanımlamadığı anlamına gelir. Reason Code 1 “{UNDEFINED_RC1}” her zaman bir <b>kayıptır</b> (OEE Settings →
            Reason Code 1’de kayıp olarak işaretli olmasa bile) ve hiçbir zaman planlı mola değildir; Reason Code 2 “{UNDEFINED_RC1}”,
            Reason Code 1’i kayıpsa kayıptır. Her OEE sayfasında (Losses Trend, Loss Bridge ve Level 3, Asakai, Daily Report, Agent
            Report, Agent Insights, Open Topics) bu duruşlar <b>{UNASSIGNED}</b> altında durur; OEE Settings → Loss groups’taki bir
            “{UNDEFINED_RC1}” satırı kullanılmaz. Kısa duruş ayrımı da aynı şekilde çalışır: sınırdan kısa duruşlar Short stops’a
            (hız), daha uzunları {UNASSIGNED}’a (kullanılabilirlik) gider. Planlı molalar etkilenmez.
          </li>
          <li>
            Örnek (test): Reason Code 1 “{UNDEFINED_RC1}”, Reason Code 2 STP (Setup), 30 dk → {UNASSIGNED} 30 dk, Setup 0 dk.
          </li>
          <li>
            <b>Sütun sırası</b> her sayfada aynıdır: OEE Settings sırasıyla kayıp grupları (↑ ↓ düğmeleri), sonra{' '}
            {SHORT_STOPS} (gösterildiği yerde), sonra {SPEED} ve en son {UNASSIGNED}. Örnek (test): KLP, STP, ARZ grupları → KLP, STP, ARZ,{' '}
            {SHORT_STOPS}, {SPEED}, {UNASSIGNED}.
          </li>
          <li>
            <b>Asakai sayfaları</b> (Asakai weekly, Asakai detail) sistemin çalışma günü olan <b>bugünü</b> göstermez: gün bitmedi;
            gün içinde yüklenen kısmi gün verisi OEE’yi ve kayıp paylarını yanlış yapar. İki sayfada da en son gün dündür (tarih
            kutusu daha ileri gidemez); içinde bulunulan hafta ve ay bugünden önceki günlerin toplamıdır — bugünü kapsayan yüklenmiş
            bir Weekly / Monthly KPI satırı kullanılmaz. Her sayfa ayrıca seçilen gün ya da haftada verisi olmasa bile{' '}
            <b>masraf yerinin her iş yerini</b> (Machines → cost center) gösterir: satırı boş kalır.
          </li>
          <li>
            Bir vardiyanın MES Loading’i vardiya süresi − planlı duruşlardan kısaysa bir kayıp payı Loading’in %100’ünü geçebilir
            (ör. 21.09 PRS-104 1. vardiya: Loading 185,7 + planlı 209,3 = 480 dk’nın 395’i, kaydedilen plansız duruşlar 191,5 dk =
            %103). Duruşlar kaydedildiği gibi sayılır; Loss Bridge fazlayı “{OVER_RECORDED}” olarak gösterir.
          </li>
        </ul>
      </section>

      <section id="raw-mrp" className="mt-8 max-w-5xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Hammadde ihtiyacı (MRP) — plandan bağımsız</h2>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-muted-foreground">
          <li>Talep: son haftasına kadar ZPP; birikmiş talep bu haftaya girer.</li>
          <li>
            Mamul stok (Storage Locations’ta <i>Finished goods</i> işaretli yerler) parça bazında,
            en erken haftalardan başlayarak düşülür. Kalan basılmalıdır: stoku 3 haftayı karşılayan bir
            parçanın o 3 haftada sac ihtiyacı yoktur.
          </li>
          <li>
            Sac: adet × parça başına brüt ağırlık. Ortak ürün çifti bir kez basılır — vuruş iki
            ihtiyaçtan büyük olanıdır — ve yalnız ana parçanın ağırlığı sayılır.
          </li>
          <li>
            Üretim planı <b>eklenmez</b>: erken üretimi ve tam rulo fazlası aynı talebin farklı
            zamanlanmış ve yuvarlanmış hâlidir. Onları eklemek aynı sacı iki kez sipariş ettirirdi.
            Farkı emniyet stoku karşılar.
          </li>
          <li>
            Arz: <i>Raw material</i> işaretli yerlerdeki eldeki rulo stoku artı yoldaki malzeme
            listesi; her miktar ETA haftasında (ETA yoksa ya da geçmişse = bu hafta).
          </li>
          <li>
            Hafta hafta: hafta başındaki stok + gelişler + bir sipariş o haftanın tüketimini{' '}
            <b>ve</b> hafta bittikten sonraki N <b>iş gününün</b> tüketimini karşılamalıdır — 10
            günle her hafta sonu sonraki 2 haftayı tutar. Aksi hâlde o hafta bir sipariş gerekir:
            eksik miktar + standart ek miktar (varsayılan 500 kg).
          </li>
          <li>Talep yoksa sipariş yok: son ZPP haftasından sonra ihtiyaç sıfırdır; hiçbir şey tahmin edilmez (kanban daha sonra gelecek).</li>
          <li>
            Bir satır bir parça değil, bir <b>rulodur</b>: ondan basılan her parça kendi ihtiyacını
            ekler ve bir ortak ürün çifti, iki taraftan biri ihtiyaç duyduğunda sac ister. Satırı{' '}
            <b>mamul bazında</b> görmek için açın — her parçanın mamul stoku, karşıladığı haftalar ve
            sacının ilk gerektiği hafta — ve ilk siparişin neden o haftaya düştüğünü görün. Kendi
            tüketimi olmayan bir haftadaki sipariş emniyet penceresidir: sonraki N iş gününün
            tüketimi (tatilli bir hafta daha ileriye uzanır).
          </li>
          <li>
            <b>Order by</b>: bir sipariş teslim haftasının pazartesisine kadar gelmiş olmalıdır; bu
            yüzden en geç o pazartesi − rulonun <b>takvim günü olarak tedarik süresi</b> tarihinde
            verilir (hafta sonları ve tatiller sayılır — tedarikçi takvim günü verir). Her rulonun Raw
            Material Coverage → Lead times’ta kendi tedarik süresi vardır; olmayan rulo varsayılanı
            kullanır ve <i>not entered</i> olarak işaretlenir. Geçmiş bir tarih <b>geç</b>tir
            (kırmızı), bu haftaki bir tarih sarıdır. Tedarik süresi yalnız siparişe tarih verir:
            teslim haftasını, emniyet stokunu ya da üretim planını değiştirmez.
          </li>
          <li>
            Şu an: N = {current.rawCoverage} iş günü, ek miktar = {current.rawExtra.toLocaleString('en-GB')} kg,
            varsayılan tedarik süresi {current.rawLeadDefault} takvim günü ({current.rawLeadEntered} rulonun
            kendi süresi var). İş günleri fabrikanın çalışma günleridir (tatil olmayan, en az bir iş
            yerinin normal vardiyası olan günler).
          </li>
        </ol>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">FMEA — neler ters gidebilir ve yöntem buna karşı nasıl korur</h3>
        <div className="mt-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Hata türü</th>
                <th className="px-2 py-1.5 font-medium">Etki</th>
                <th className="px-2 py-1.5 font-medium">S</th>
                <th className="px-2 py-1.5 font-medium">O</th>
                <th className="px-2 py-1.5 font-medium">D</th>
                <th className="px-2 py-1.5 font-medium">RPN</th>
                <th className="px-2 py-1.5 font-medium">Yöntemdeki önlem</th>
              </tr>
            </thead>
            <tbody>
              {FMEA_ROWS.map((r) => (
                <tr key={r[0]} className="border-t border-border align-top">
                  <td className="px-2 py-1.5 font-medium text-foreground">{r[0]}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{r[1]}</td>
                  <td className="px-2 py-1.5">{r[2]}</td>
                  <td className="px-2 py-1.5">{r[3]}</td>
                  <td className="px-2 py-1.5">{r[4]}</td>
                  <td className="px-2 py-1.5 font-medium">{(r[2] as number) * (r[3] as number) * (r[4] as number)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{r[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          S = şiddet, O = olasılık, D = tespit edilebilirlik (1–10); puanlar önlemden önceki puanlardır.
          Sipariş edilmiş ama henüz sevk edilmemiş sac yalnız yoldaki malzeme listesindeyse bilinir;
          bu listeyi güncel tutun.
        </p>
      </section>

      <section id="check" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-sky-200 bg-sky-50/60 p-4">
        <h2 className="text-sm font-semibold text-foreground">Bağımsız kontrol — plan gerçekten doğru mu?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Yukarıdaki plan kontrolü motorun kendi sayılarını yeniden sayar.{' '}
          <b>Bağımsız kontrol</b> ise planlayıcıyla hiçbir şey paylaşmayan ayrı bir
          koddur. Her hesaplamadan sonra:
        </p>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-muted-foreground">
          <li>
            SAP dosyalarından (ZPP, ZPP_DAILY, Finished goods yerlerindeki MB52) ve
            planlanan işlerden <b>stoku saat saat yeniden oynatır</b>: her ihtiyaç günü
            saat {current.cutoff}’da vadelidir, üretim basıldıkça gelir. Stokun sıfırın
            altına düştüğü her an gerçek bir müşteri duruşudur. Geç listesi bununla tam
            olarak uyuşmalıdır — motorun kaçırdığı bir parça ya da yanlış bir alarm
            gösterilir. ZPP_DAILY için kendi kuralı: yalnız haftalık ZPP (uzun vadeli)
            miktarı eksikse bu müşteri duruşu değil, uzun vadeli eksik sayılır.
          </li>
          <li>
            Her eksik parça için <b>"hangi plan olsa bundan kaçınabilir miydi?" diye
            sorar</b>: parçanın iş yerlerinde son tarihten önce, tek başına bile yeterli
            iş yeri süresi var mı? Setup ekibi ve hol vinçleri o zamana kadar gereken
            bütün setup’ları yapabilir mi? Cevap "Hayır" (kapasiteyle kanıtlanmış), "Evet"
            (boş bir aralık vardı) ya da "kanıtlanmadı"dır. Ayrıca hiçbir planın altına
            inemeyeceği, kanıtlanmış en az eksik parça sayısını verir.
          </li>
          <li>
            <b>Her kuralı</b> gerçek saat üzerinde <b>yeniden kontrol eder</b>: bir iş yerinde
            iki iş, iki iş yerinde bir kalıp (gece boyunca da), bir holde iki setup (07:00’ı
            aşarken de), fabrika genelindeki setup’lar, uygun iş yeri, çalışma süresi ve bakım,
            tam rulo / Min. lot, öne çekme penceresi, setupsız kalıp değişimi, aciden önce
            birikmiş talep ve operatör planlı bir masraf yerinde çalışan hatların ekiplerinin o
            vardiya için girilen operatörlere sığması.
          </li>
          <li id="component-ready">
            <b>Ara mamul hazır değilse uyarır</b> (bilgi amaçlı — bozulan bir kural değildir, plan
            “OK” kalır): bir parçanın <i>hammadde</i> kodu başka bir parçanın koduysa (somun kaynağı ←
            üzerine kaynak yaptığı pres parçası), o pres parçası onun bileşenidir, adet başına 1 adet.
            Somun kaynağı işinin her çalışmasının sonunda bileşenin stoku (bütün yerler) artı o ana kadar
            üretilen, o ana kadar kullanılanı karşılamalıdır. Örnek: stokta 100, saat 09:00’a kadar 100
            basıldı, somun kaynağı saat 11:00’e kadar 300 kullanıyor → “needs 300 pcs, 200 available”.
            Motor bu bağlantıyı <b>planlamaz</b>: her hat hâlâ kendi başına planlanır ve bileşenin kendi
            müşteri talebi bu sayıma girmez.
          </li>
          <li>
            <b>Verimliliği ölçer</b>: mümkün olan en aza karşı setup’lar, mümkün olan en
            fazlaya karşı üretim süresi ve boş zamanın nereden geldiği — iş yok, henüz izin
            yok ya da setup ekibi bekleniyor.
          </li>
          <li>
            Eksik parçalar için <b>kontrol edilecek verileri işaretler</b>: başka yerlerdeki
            stok (Finished goods işaretli olmayan), ZPP’de pozitif değerler, stoktan küçük
            birikmiş talep, eski bir stok dosyası, eksik master data.
          </li>
        </ol>
      </section>

      <section id="alarms" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Alarmlar — kalıplar ve makineler</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Kalıp ve makine takibi kendi modüllerinde yapılır. PlanningExpert yalnız plan
          için önemli olanı,{' '}
          <Link to="/alarms" className="underline">
            Alarms
          </Link>{' '}
          sayfasında iki listede tutar:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b className="text-foreground">Holding up the plan</b> — bir kalıp hazır değil,
            hazır olma tarihi yok, vuruş limiti alarmı var ya da bakımda; veya bir iş yeri
            arızalı ya da bakımda; <b className="text-foreground">ve</b>{' '}
            bir parçanın stoku o kullanılabilir olmadan biter (ya da işi geç kalır veya
            planlanamaz). Örnek: kalıp yarından sonraki gün saat 10:00’da hazır, yarın
            1 000 parça sevk edilecek.
          </li>
          <li>
            <b className="text-foreground">For information</b> — kullanılabilir değil,
            ama stok o geri gelene kadar yetiyor ya da ufukta talep yok. Planlamacı
            bilmeli; hiçbir şey geç değil.
          </li>
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Ne zaman yeniden hesaplanır?</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
          <li>Verilerinden herhangi biri değiştikten (bir yükleme, bir ayar, bir kural) birkaç saniye sonra.</li>
          <li>Her saat, çünkü geçen saatler bugünün kapasitesinden düşer.</li>
          <li>
            <Link to="/planlama" className="underline hover:no-underline">
              Production Plan
            </Link>
            {' '}sayfasında <b>Recalculate now</b>’a her bastığınızda.
          </li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          <b className="text-foreground">Approve plan</b> planı olduğu gibi saklar.
          Onaylı plan, dondurulmuş günlerin ve "changes since the approved plan"
          listesinin temelidir.
        </p>
      </section>
    </div>
  )
}

// ---- Tek kaynak: her bilgi nerede tanımlanır -------------------------------

const SOURCES: [string, string, string, string][] = [
  ['İş yerleri, holler, kategoriler', 'Work Center Definitions', '/makineler', 'Work Calendar, Capacity Dashboard, mesai, Gantt, setup ve vinç kuralları'],
  ['İş yeri takvimi ve mesai', 'Work Calendar', '/takvim', 'Plan, Capacity Dashboard (aynı kayıt), Performance'],
  ['Planlı duruşlar, tatiller, ayarlar', 'Work Calendar', '/takvim', 'Plan, kapasite, hammadde iş günleri'],
  ['Parçalar, parça başına iş yerleri, Accepted OEE', 'Master Data', '/referanslar', 'Plan, Capacity Dashboard B, hammadde'],
  ['Hangi stok sayılır', 'Storage Locations', '/depolar', 'Plan, hammadde, Capacity Dashboard, MB51 üretimi'],
  ['Talep, stok, hareketler, yoldaki malzeme', 'SAP Data', '/sapdata', 'Plan, hammadde, Actuals, Performance'],
  ['Prediction OEE', 'Capacity Dashboard', '/capacity', 'Yalnız o dashboard görünümü'],
  ['Kapasite faktörü', 'Performance', '/performans', 'Plan kapasitesi'],
  ['Kalıp hazırlığı ve bakımı', 'Die Follow-up', '/die-followup/maintenance', 'Plan, Alarms'],
  ['Arızalar ve iş yeri bakımı', 'Machine Follow-up', '/machine-followup/breakdowns', 'Plan, Alarms'],
]

function SingleSource() {
  return (
    <section className="mt-6 max-w-5xl rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">Her girdi için tek kaynak</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Her değer yalnız tek bir yerde girilir; her sayfa ve plan aynı kaydı okur, böylece aynı
        sayı sayfalar arasında hiçbir zaman farklı çıkmaz. Hiçbir şey koda gömülü değildir —
        örneğin gruplar iş yeri kategorisinden gelir.
      </p>
      <div className="mt-2 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Ne</th>
              <th className="px-2 py-1.5 font-medium">Tanımlandığı yer</th>
              <th className="px-2 py-1.5 font-medium">Kullanan</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map(([what, page, to, used]) => (
              <tr key={what} className="border-t border-border align-top">
                <td className="px-2 py-1.5 font-medium text-foreground">{what}</td>
                <td className="px-2 py-1.5">
                  <Link to={to} className="underline hover:no-underline">
                    {page}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---- Sinoptik: algoritmanın tek bakışta resmi ------------------------------

function Box({ tone, title, children }: { tone: string; title: string; children?: ReactNode }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`}>
      <p className="text-sm font-semibold">{title}</p>
      {children && <div className="mt-0.5 text-xs opacity-90">{children}</div>}
    </div>
  )
}

function Down({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-6 text-xs text-muted-foreground">
      <span aria-hidden className="text-base leading-none">↓</span>
      {label}
    </div>
  )
}

/** Bir pres şeridi: dolu kısım gri, adayın işi renkli. */
function Lane({
  press,
  busy,
  job,
  finish,
  chosen,
  note,
}: {
  press: string
  busy: number
  job?: number
  finish?: string
  chosen?: boolean
  note?: string
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 shrink-0 font-medium text-foreground">{press}</span>
      <div className="relative h-5 flex-1 rounded bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-l bg-slate-400/70"
          style={{ width: `${busy}%` }}
        />
        {job !== undefined && (
          <div
            className={`absolute inset-y-0 rounded border-2 ${
              chosen ? 'border-emerald-600 bg-emerald-200' : 'border-dashed border-amber-500 bg-amber-100'
            }`}
            style={{ left: `${busy}%`, width: `${job}%` }}
          />
        )}
      </div>
      <span
        className={`w-44 shrink-0 ${chosen ? 'font-semibold text-emerald-700' : 'text-muted-foreground'}`}
      >
        {note ?? `bitiş: ${finish}`}
        {chosen && ' ✓ seçildi'}
      </span>
    </div>
  )
}

function Synoptic({ safetyDays }: { safetyDays: number }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-foreground">Planlama algoritması — tek bakışta</h2>
      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        <div>
          <Box tone="border-border bg-muted/50 text-foreground" title="1 · Üretilecek her lotun tek listesi">
            Talep eksi stok, tam rulolara yuvarlanır (ya da tanımlıysa Min. lot’a kadar
            yukarı; hiçbir zaman daha az değil); bir ortak ürün çifti tek lottur. Her lot
            öngörülen stoktan iki tarih alır: stokun biteceği gün ve ondan{' '}
            {safetyDays} iş günü önce — başlayabileceği en erken gün.
          </Box>
          <Down label="bir kez sıralanır" />
          <Box tone="border-border bg-muted/50 text-foreground" title="2 · Listeyi sırala">
            Öne alınan → Birikmiş → Acil (zaten emniyet stokunun altında) → Dolgu.
            Aynı grup: stoku önce biten önce gider. Hâlâ eşitse → en az uygun iş
            yeri olan parça önce gider.
          </Box>
          <Down label="sıradaki kalemi en üstten al" />
          <Box tone="border-sky-300 bg-sky-50 text-sky-950" title="3 · İzin verilen HER iş yerini dene">
            Flexible work center işaretli değil → yalnız ana iş yeri (kalite). İşaretli →
            ana iş yeri ve bütün alternatifler (ör. 104, 105, 108, 110). Her birinde
            bütün kurallara uyan en erken boş aralığı bul: vardiya sonları, vinç,
            kalıp, bakım.
          </Box>
          <Down label="her iş yeri bir bitiş saati verir" />
          <Box tone="border-emerald-300 bg-emerald-50 text-emerald-950" title="4 · Önce bitiren iş yerini seç">
            "Listedeki ilk iş yeri" değil, "ana iş yeri" de değil — işin en erken
            bittiği iş yeri. Acil bir şey yoksa bağlı kalıbı (setupsız) çalıştırmaya
            devam etmek kazanır.
          </Box>
          <Down label="rezerve et" />
          <Box tone="border-border bg-muted/50 text-foreground" title="5 · Aralığı rezerve et">
            O iş yeri süresi, vinç aralıkları ve kalıp artık sonraki bütün kalemler
            için dolu.
          </Box>
          <Down label="liste boşalana kadar sıradaki kalemle 3’e dön" />
          <Box tone="border-amber-300 bg-amber-50 text-amber-950" title="6 · Geç iş var mı? → yeniden planla">
            Stoku bittikten sonra başlayan bir iş müşteriyi durdurur. Geç lotlar öne
            alınır (her iş yerini yeniden denerler) ve setup’ları başka bir setup’la
            çakışabilir. Rulolar hiçbir zaman kesilmez. En fazla 6 tur; en iyi plan
            tutulur.
          </Box>
          <Down label="hâlâ geç olan ya da sığmayan" />
          <Box tone="border-destructive/40 bg-destructive/10 text-foreground" title="Late jobs / Unplanned">
            Production Plan’da denenen iş yerleri ve çözümüyle birlikte kırmızı
            gösterilir.
          </Box>
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-foreground">Örnek — 12 numaralı karar</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A parçasının birikmiş talebi var, Flexible work center işaretli ve 104
            (ana), 105 ve 108’de çalışabiliyor. On bir iş zaten rezerve edilmiş.
            Gri = zaten rezerve, renkli = A’nın gideceği yer.
          </p>
          <div className="mt-3 space-y-2">
            <Lane press="104" busy={58} job={22} finish="Tue 11:30" />
            <Lane press="105" busy={30} job={22} finish="Mon 23:30" chosen />
            <Lane press="108" busy={100} note="ufkun sonuna kadar dolu" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            104 ana iş yeri olduğu hâlde A <b className="text-foreground">105</b>’e
            gider, çünkü 105 işi bir buçuk vardiya daha erken bitirir. Production
            Plan’da iş listesi her iş için tam olarak bu satırı{' '}
            <b className="text-foreground">Why this work center</b> sütununda
            gösterir:
          </p>
          <p className="mt-2 rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
            #12 104 Tue 11:30 · <span className="font-semibold text-emerald-700">105 ✓ Mon 23:30</span> · 108 (full until the end of the horizon)
          </p>

          <p className="mt-4 text-sm font-semibold text-foreground">Bu, sorunuz için ne anlama gelir</p>
          <ul className="mt-1 ml-5 list-disc space-y-1 text-xs text-muted-foreground">
            <li>
              Bir parça, bir listede ilk sırada diye hiçbir zaman bir iş yerine
              yazılmaz. Her iş, yerleştirildiği anda bütün iş yerlerinde
              karşılaştırılır.
            </li>
            <li>
              Birikmiş talebi olan bir parça 104’te ancak o anda 105, 108 ve 110
              onu daha erken bitiremiyorsa 4. sıraya düşebilir. İşin satırı bunu
              kanıtlar.
            </li>
            <li>
              Motor her seferinde tek bir iş için karar verir ve rezerve ettiği bir
              işi hiçbir zaman taşımaz. Bunun iki sonucu aşağıda{' '}
              <a href="#limits" className="underline">
                Bilinen sınırlar
              </a>{' '}
              altında listelenmiştir.
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Planı yeniden saymadan nasıl kontrol edersiniz</h3>
          <ol className="mt-2 ml-5 list-decimal space-y-1 text-xs text-muted-foreground">
            <li>
              <b className="text-foreground">Plan check</b> (Production Plan sayfası): her
              hesaplamadan sonra motordan ayrı bir kontrol kodu her işi yeniden
              gözden geçirir ve her kuralı kontrol eder — esnek olmayan parçalar
              yalnız ana iş yerinde, bir iş yerinde aynı anda tek iş, en erken iş
              yeri seçilmiş, vinç aralıkları, fabrikada aynı anda setup’lar, yalnız
              tam rulo, bir kalıp tek iş yerinde, bakım, öne çekme penceresinden önce
              lot yok, geçmişte hiçbir şey yok. Bozulan bir kural, işin adıyla
              kırmızı gösterilir.
            </li>
            <li>
              <b className="text-foreground">Why this work center</b> (iş listesi): şüphelendiğiniz
              herhangi bir işi seçin ve kararını okuyun: sıra numarası ve her uygun iş
              yerindeki bitiş saati.
            </li>
            <li>
              <b className="text-foreground">Otomatik testler</b>: herhangi bir değişiklik canlıya
              geçmeden önce motor rastgele üretilmiş 40 fabrikayı (progresif ve transfer
              holler, tekil ve ortak parçalar, bakım, duruşlar) planlar ve aynı kontroller
              sıfır bozuk kural bulmalıdır. Sizin 104/105 vakanız, 1 000 / 2 000 / 6 000
              rulo vakanız, çarşamba satış günü ve geç iş onarımları da birer testtir.
            </li>
          </ol>
        </div>

        <div id="limits" className="scroll-mt-20 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-950">Bilinen sınırlar</h3>
          <p className="mt-1 text-xs text-amber-900">
            Motor işleri birbiri ardına yerleştirir. Bu her kararı açıklanabilir
            kılar, ama olası her plan üzerinde bir arama değildir:
          </p>
          <ul className="mt-2 ml-5 list-disc space-y-1 text-xs text-amber-900">
            <li>
              Rezerve edilmiş bir iş hiçbir zaman taşınmaz. Öncelik eşitken daha az
              uygun iş yeri olan parçaları önce yerleştirmek, esnek bir parçanın tek iş
              yerli bir parçanın yerini aldığı durumların çoğunu önler, ama hepsini değil.
            </li>
            <li>
              Her şeyde — grup, stok bitiş günü ve iş yeri sayısı — eşit olan kalemler
              ZPP dosyasındaki satır sırasını korur.
            </li>
            <li>
              Rulo hiçbir zaman kesilmediği için aşırı yüklü bir hafta, yarım rulonun
              kurtaracağı geç bir işle bitebilir. Bu bilinçli bir tercihtir: çözüm
              kapasitedir (Capacity Dashboard’da mesai) ya da başka bir iş yeridir.
            </li>
            <li>
              ZPP_DAILY’deki son günden sonra yalnız haftalık toplamlar vardır; bu yüzden
              o haftalar fabrikanın çalışma günlerine (tatil olmayan ve en az bir iş yerinin
              normal vardiyası olan günler) eşit dağıtılır. ZPP_DAILY yüklüyken bunlar uzun
              vadeli lotlardır: kapasite günlük lotlarca tükenmişse bir günlük lotu
              geciktirmek yerine plansız kalırlar.
            </li>
            <li>
              Geç işleri gidermek için yeniden planlama tam bir arama değil, bir dizi
              denemedir: 6 tur bir geç işi gideremiyorsa çözüm kapasitedir (mesai, başka
              bir iş yeri) — plan bunu söyler.
            </li>
            <li>
              Onaylı bir plan ile bir sonraki MB52 yüklemesi arasında motor, onaylı
              işlerin planlandığı gibi üretildiğini varsayar.
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}

/** Kullanıcının örneği: öngörülen stok gün gün, ve sonraki rulonun yeri. */
function StockExample({ safetyDays }: { safetyDays: number }) {
  // 1000 bakiye, haftada 2000 (günde 400), Pazartesi 6000'lik rulo.
  const days: { label: string; stock: number }[] = []
  let stock = 6000 - 1000
  const names = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum']
  for (let w = 0; w < 3; w++) {
    for (let d = 0; d < 5; d++) {
      stock -= 400
      days.push({ label: `${names[d]} ${14 + w * 7 + d > 30 ? 14 + w * 7 + d - 30 : 14 + w * 7 + d}`, stock })
    }
  }
  const stockout = days.findIndex((d) => d.stock < 0)
  const start = Math.max(0, stockout - safetyDays)
  const max = 4600
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm font-semibold text-foreground">
        Örnek — sonraki rulo ne zaman basılır?
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Birikmiş talep 1 000, haftada 2 000, stok yok, bir rulo = 6 000 adet. İlk
        rulo 14 Eylül pazartesi basılır. Çubuklar = her günün sonundaki öngörülen
        stok.
      </p>
      <div className="mt-3 flex h-28 items-end gap-1">
        {days.map((d, i) => (
          <div key={d.label} className="flex h-full flex-1 flex-col justify-end">
            <div
              className={`rounded-t ${
                i === stockout
                  ? 'bg-destructive'
                  : i >= start && i < stockout
                    ? 'bg-amber-400'
                    : 'bg-slate-400/70'
              }`}
              style={{ height: `${Math.max(3, (Math.max(0, d.stock) / max) * 100)}%` }}
              title={`${d.stock} adet`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
        {days.map((d) => (
          <span key={d.label} className="flex-1 text-center">
            {d.label}
          </span>
        ))}
      </div>
      <ul className="mt-3 ml-5 list-disc space-y-1 text-xs text-muted-foreground">
        <li>
          İlk rulo birikmiş talebi, bu haftayı, gelecek haftayı ve ondan sonraki
          haftanın 1 000’ini karşılar.
        </li>
        <li>
          Stok <b className="text-destructive">{days[stockout].label}</b>{' '}
          günü biter (kırmızı). {safetyDays} günlük emniyet stokuyla sonraki rulo{' '}
          <b className="text-amber-700">{days[start].label}</b> gününden (sarı)
          itibaren başlayabilir — ne ilk rulonun hemen ardından ne de stok bittikten sonra.
        </li>
        <li>
          İş yeri o sırada doluysa iş daha sonraya kayar; {days[stockout].label}{' '}
          gününden sonra başlarsa geç olarak işaretlenir.
        </li>
      </ul>
    </div>
  )
}

function Step({
  n,
  id,
  title,
  children,
}: {
  n: number
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-20 max-w-4xl">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs text-background">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground [&_b]:text-foreground [&_ol]:ml-5 [&_ol]:space-y-1 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </section>
  )
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">{children}</p>
  )
}

function Example({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-emerald-900">
      <b className="!text-emerald-900">Örnek. </b>
      {children}
    </p>
  )
}

function Block({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`rounded px-2 py-1 font-medium ${tone}`}>{children}</span>
}

function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map(([what, detail, to]) => (
            <tr key={what} className="border-t border-border first:border-t-0 align-top">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">
                <Link to={to} className="hover:underline">
                  {what}
                </Link>
              </td>
              <td className="px-3 py-2">{detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Operatör planı (src/lib/operatorAllocation.ts). Örnek, testteki örnekle
 * aynıdır: sayılar koddan (OPERATOR_EXAMPLE + allocateOperators) okunur.
 */
function OperatorPlanItem() {
  const ex = OPERATOR_EXAMPLE
  const decision = allocateOperators(ex).decisions[0]
  const lines = ex.costCenters[0].lines.map((l) => l.press)
  const minutesOf = (press: string) => ex.workload.filter((w) => w.press === press).reduce((x, w) => x + w.minutes, 0)
  const noWork = lines.filter((l) => minutesOf(l) === 0)
  const closed = lines.filter((l) => !decision.open.includes(l) && !noWork.includes(l))
  const weekly = {
    machines: OPERATOR_WEEKLY_EXAMPLE.crewSizes.length,
    avgCrew: OPERATOR_WEEKLY_EXAMPLE.crewSizes.reduce<number>((x, c) => x + c, 0) / OPERATOR_WEEKLY_EXAMPLE.crewSizes.length,
    cap: operatorWeekCapacity(OPERATOR_WEEKLY_EXAMPLE),
  }
  return (
    <li>
      <b>Operatör planı</b> (masraf yeri bazında ikinci bir planlama modeli, ör. APR, punta ve somun
      kaynağı hatları; Company settings → cost center → <b>Planning model</b>’de seçilir). Böyle bir
      masraf yerinin hatları yalnız takvimleriyle çalışmaz: Production Plan’da <b>Operators per
      shift</b> her gün ve vardiyada kaç operatörün çalıştığını alır ve her hattın bir <b>ekibi</b>{' '}
      vardır (bir vardiya çalışmak için gereken operatör sayısı, girilmemişse 1; Production Plan’da
      değil, Work Calendar → Capacity overview’da girilir). Kapasite kurulmadan önce, sırayla her gün
      ve vardiya için, bu hafta (pazara kadar) vadeli işi kalan hatlar <b>en erken vade tarihine</b>{' '}
      göre sıralanır (eşitse kalan dakikası büyük olan önce) ve ekipleri kalan operatörlere sığdığı
      sürece açılır. İş = net lot miktarı × parçanın ana iş yerindeki adet başına dakika; motorun
      planladığı lotların aynısı. Çalışan her vardiya (açılan ya da takvimden gelen) net dakikasını
      hattın işinden düşer; bu yüzden işi biten — ya da kalan işi yalnız gelecek haftaya ait olan —
      bir hat operatör almaz. Operatör sayısı girilmemiş bir gün ve vardiya takvimi korur; tatil
      takvimi korur; <b>elle girilen bir gün kaydı her zaman kazanır</b> ve ekibi önce operatör
      sayısından alınır. Sonuç motora gün kayıtları olarak gider; böylece sıralama, setup’lar ve
      geç iş kuralları değişmez. Örnek:{' '}
      {decision.operators} operatör, ekibi 1 olan {lines.length} hat, {noWork.join(', ')}{' '}
      işsiz: {decision.open.join(', ')} çalışır ({ex.workload.find((w) => w.press === decision.open[1])?.minutes} ve{' '}
      {ex.workload.find((w) => w.press === decision.open[2])?.minutes} dk aynı gün vadeli, bu yüzden büyük olan önce gider),{' '}
      {closed.join(', ')} bekler (operatör kalmadı) ve {noWork.join(', ')} kapalı kalır.
      <br />
      <b>Makineler her çalışma günü {OPERATOR_SHIFTS_PER_DAY} vardiya sayar.</b> Operatör planlı bir
      masraf yerinin hattı için iş yeri şablonu ve istisna haftaları okunmaz: Work Calendar’ın her
      çalışma günü {OPERATOR_SHIFTS_PER_DAY} vardiyadır (plan, Work Calendar, Capacity dashboard,
      Performance ve plan kontrolünde aynı şekilde); hangi hatların çalışacağına operatörler karar
      verir. Gün kayıtları ve tarihli mesai yine geçerlidir.
      <br />
      <b>Operators per week</b> (Work Calendar → Capacity overview, masraf yerini seçin): vardiya
      başına değil, haftada kaç kişinin çalıştığı. Vardiya başına operatör sayısı olmayan bir çalışma
      gününde plan, {OPERATOR_SHIFTS_PER_DAY} vardiyanın her birinde ⌊haftalık ÷ {OPERATOR_SHIFTS_PER_DAY}⌋{' '}
      operatör kullanır (ilk iki hafta için vardiya bazlı tablo her zaman kazanır). Capacity
      dashboard haftayı min(makine × {OPERATOR_SHIFTS_PER_DAY} × çalışma günü, haftalık operatör ÷
      ortalama ekip × çalışma günü) vardiyayla sınırlar; haftalık sayı yoksa makine ×{' '}
      {OPERATOR_SHIFTS_PER_DAY} × çalışma günüdür. Örnek: ekipleri{' '}
      {OPERATOR_WEEKLY_EXAMPLE.crewSizes.join(', ')} olan {weekly.machines} hat (ortalama {weekly.avgCrew}),{' '}
      {OPERATOR_WEEKLY_EXAMPLE.workingDays} çalışma günü, {OPERATOR_WEEKLY_EXAMPLE.weeklyOperators} operatör:
      makine sınırı {weekly.cap.machineShifts}, operatör sınırı {weekly.cap.operatorShifts} → kapasite{' '}
      {weekly.cap.shifts} vardiya; vardiya bazlı sayısı olmayan bir günde vardiya başına{' '}
      {shiftHeadcountFromWeekly(OPERATOR_WEEKLY_EXAMPLE.weeklyOperators)} operatör.
    </li>
  )
}
