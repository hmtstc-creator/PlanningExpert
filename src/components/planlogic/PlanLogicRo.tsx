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
 * Planning Logic sayfasının Romence çevirisi.
 *
 * Kaynak: `src/routes/planlogic.tsx` (İngilizce asıl sayfa). O sayfadaki her
 * değişiklik aynı PR'da bu dosyaya da işlenmelidir; ikisi birlikte güncellenir.
 * Program arayüzündeki sayfa, düğme, alan ve sütun adları İngilizce bırakılır.
 */

/** Hammadde MRP'sinin FMEA'sı: hata türü, etkisi, S, O, D, yöntemdeki önlem. */
const FMEA_ROWS: [string, string, number, number, number, string][] = [
  ['Planul și cererea sunt numărate amândouă', 'Același oțel este comandat de două ori', 8, 8, 3, 'Independent de plan: doar cererea; stocul de siguranță absoarbe decalajele planului și surplusul de bobină'],
  ['Stocul de produse finite nu este scăzut', 'Comandă în exces', 7, 5, 4, 'Locațiile bifate „Finished goods” în Storage Locations sunt scăzute primul intrat – primul ieșit, la fel ca în plan; rândul defalcă necesarul pe fiecare produs finit'],
  ['Necesarul unei piese cu stoc, citit din rândul bobinei', 'Oțelul pare necesar, deși stocul piesei încă acoperă', 5, 6, 6, 'Defalcare pe produs: săptămânile acoperite de stocul de produse finite și săptămâna în care oțelul este necesar prima dată, pentru fiecare piesă de pe bobină'],
  ['Stocul de bobine existent nu este scăzut', 'Oțelul aflat deja în fabrică este comandat din nou', 8, 6, 5, 'Stocul de bobine din locațiile bifate „Raw material” este stocul inițial'],
  ['Coprodus numărat de două ori', 'Comandă în exces la perechi', 6, 6, 5, 'Perechea se ștanțează o singură dată: curse = necesarul mai mare, oțelul doar pe piesa principală'],
  ['Piesă fără cod de materie primă / greutate brută', 'Oțelul ei lipsește fără avertizare → linia se oprește', 10, 5, 8, 'Listată cu roșu pe pagină, cu bucățile; nu este eliminată niciodată în tăcere'],
  ['Greutate brută în unitate greșită (g / t)', 'Comandă greșită de 1000×', 9, 3, 6, 'Greutățile peste 50 kg sau sub 1 g pe bucată sunt semnalate'],
  ['Intervale săptămânale: siguranța verificată doar la începutul săptămânii', 'Sub nivelul de siguranță la sfârșitul săptămânii', 7, 7, 7, 'Fiecare sfârșit de săptămână trebuie să acopere următoarele N zile lucrătoare (10 = următoarele 2 săptămâni)'],
  ['Oțel comandat fără cerere în spate', 'Stoc mort, bani imobilizați', 6, 6, 5, 'Fără cerere, fără comandă: nu se prognozează nimic după ultima săptămână din ZPP (kanbanul vine mai târziu)'],
  ['Restanța (întârzierile) ignorată', 'Oțelul urgent lipsește acum', 8, 4, 5, 'Restanța este numărată în săptămâna curentă'],
  ['Stoc blocat / în carantină de calitate numărat ca disponibil', 'Stoc supraevaluat', 7, 4, 6, 'Doar stocul nerestricționat și doar în locațiile bifate în Storage Locations'],
  ['Rebut, capete de bobină, pierderi la setup', 'Puțin prea puțin', 5, 8, 7, 'Supliment standard pe comandă (500 kg, reglabil)'],
  ['Oțelul în tranzit necunoscut', 'Oțelul aflat deja pe drum este comandat din nou', 7, 7, 8, 'Lista Excel de tranzit: fiecare cantitate este o recepție în săptămâna ETA (fără ETA = săptămâna aceasta)'],
  ['ETA în tranzit greșit sau lipsă', 'Comandă cu o săptămână prea târziu sau prea devreme', 6, 5, 6, 'Fără ETA se consideră săptămâna aceasta; fiecare sosire își arată ETA și PO pe pagină, pentru verificare'],
]

const STEPS = [
  { id: 'inputs', title: 'Colectarea datelor' },
  { id: 'demand', title: 'Calculul cererii nete' },
  { id: 'capacity', title: 'Construirea capacității' },
  { id: 'blocks', title: 'Blocarea a ceea ce nu poate rula' },
  { id: 'order', title: 'Ordonarea lucrărilor' },
  { id: 'place', title: 'Plasarea fiecărei lucrări' },
  { id: 'check', title: 'Verificare și raportare' },
]

function hhmm(minute: number): string {
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const dmy = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

export function PlanLogicRo() {
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
        summary="Cum se calculează planul — aceleași reguli, aplicate de fiecare dată în același fel."
        links={relatedPages('/planlogic')}
        info={
          <p>
            Nimeni nu plasează lucrările manual. Planul este calculat pe server din datele pe care
            le întrețineți, în cei șapte pași de mai jos, de fiecare dată când aceste date se schimbă.
            Pentru a schimba planul, schimbați datele de intrare.
          </p>
        }
      />

      <SingleSource />

      <Synoptic safetyDays={current.safety} />

      <h2 className="mt-10 text-lg font-semibold text-foreground">Cei șapte pași în detaliu</h2>
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
        <h2 className="text-sm font-semibold text-foreground">Setările dumneavoastră actuale</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <Setting label="Planning horizon" value={`${current.horizon} săptămâni`} />
          <Setting label="Începutul primei ture" value={`${current.shiftStart} (${current.timeZone})`} />
          <Setting label="Durata turei" value={`${current.shiftMinutes} min`} />
          <Setting label="Interval între schimbările de matriță (aceeași hală)" value={`${current.setupGap} min`} />
          <Setting label="Interval între schimbările de bobină (aceeași hală)" value={`${current.coilGap} min`} />
          <Setting label="Setup-uri simultane pe hală" value={String(current.concurrent)} />
          <Setting label="Setup-uri simultane în fabrică (normal)" value={String(current.plantNormal)} />
          <Setting label="Setup-uri simultane cu restanță / risc de întârziere" value={String(current.plantUrgent)} />
          <Setting label="Pull work forward" value={`${current.pullForward} zile`} />
          <Setting label="Setup peste schimbarea de tură" value={current.crossShifts ? 'permis' : 'nepermis'} />
          <Setting label="Factor de capacitate" value={`${current.factor}%`} />
          <Setting
            label="Frozen days"
            value={current.frozen > 0 ? `${current.frozen} zile` : 'dezactivat'}
          />
          <Setting label="Safety stock" value={`${current.safety} zile lucrătoare`} />
          <Setting label="Ora de livrare în ziua necesarului" value={current.cutoff} />
          <Setting label="Utilisation target" value={`${current.target}% (următoarele 7 zile)`} />
          <Setting label="Număr maxim de scenarii încercate" value={String(current.maxScenarios)} />
          <Setting label="Siguranță materie primă" value={`${current.rawCoverage} zile lucrătoare`} />
          <Setting label="Supliment la comanda de materie primă" value={`${current.rawExtra.toLocaleString('en-GB')} kg`} />
          <Setting label="Urgent raw material" value={`${current.rawUrgent} zile lucrătoare`} />
          <Setting label="Prediction OEE (doar în dashboard)" value={`${current.predictionOee}%`} />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Le puteți modifica în pagina{' '}
          <Link to="/takvim" className="underline hover:no-underline">
            Work Calendar
          </Link>
          ; factorul de capacitate vine din pagina{' '}
          <Link to="/performans" className="underline hover:no-underline">
            Performance
          </Link>
          ; Prediction OEE din pagina{' '}
          <Link to="/capacity" className="underline hover:no-underline">
            Capacity Dashboard
          </Link>
          .
        </p>
      </div>

      <Step n={1} id="inputs" title="Colectarea datelor">
        <p>Motorul citește tot ce influențează planul:</p>
        <Table
          rows={[
            ['Cerere', 'Necesarul net săptămânal din ZPP și cantitatea restantă', '/sapdata'],
            ['Zile de vânzare', 'ZPP_DAILY: o coloană pe zi — ziua în care se vinde fiecare cantitate', '/sapdata'],
            [
              'Stoc',
              'Stocul nerestricționat din MB52, numărat pe centru de cost: o piesă numără locațiile centrului de cost al centrului ei de lucru principal (Storage Locations → Locations per cost center) — locația de producție (WIP) și locațiile de produse finite, pentru plan, validator, Demand și Capacity Dashboard; un cod de materie primă numără locațiile de materie primă ale centrelor de cost care îl consumă. Exemplu: 171 și 173 au WIP 2009, materie primă și produse finite 1009; 172 are WIP 2010, materie primă și produse finite 1009 — stocul unei piese 172 aflat în 2009 nu este numărat. Piese intermediare: un cod pe care fabrica îl produce singură (o fișă de produs sau un coprodus) și pe care altă piesă îl folosește ca materie primă — de ex. 172 îl produce, 171 îl consumă — se numără o singură dată, ca stoc de produs finit al producătorului; nu se numără niciodată ca stoc de materie primă, nu primește niciodată necesar de bobină și nu este propus niciodată pentru achiziție, deoarece consumul lui 171 este deja în cererea ZPP a lui 172. Astfel, faptul că 1009 este materie primă pentru 171 și produs finit pentru 172 nu numără aceleași bucăți de două ori. Producția MB51 a unei piese este o mișcare 101/102 în locația WIP a centrului ei de cost. Un centru de cost fără definiție (sau o piesă fără centru de cost) folosește bifele locațiilor: Finished goods, Raw material, Production receipt',
              '/depolar',
            ],
            ['Bobine în tranzit', 'Lista Excel de tranzit: fiecare cantitate sosește în săptămâna ETA (fără ETA = săptămâna aceasta)', '/sapdata'],
            [
              'Master data',
              'Timpul de ciclu (minute pe bucată) — viteza fiecărei piese pe fiecare centru de lucru; timpii de setup și de oprire de frecvență (schimbare de bobină), timpul de aprobare a calității, greutatea bobinei și greutatea brută, limita de lovituri a matriței, centrele de lucru principale și alternative, bifa Flexible work center, coprodus, Accepted OEE. O piesă încărcată anterior cu SPM și cavități, dar fără timp de ciclu, rulează cu 1 ÷ (SPM × cavități) min/buc; cavitățile, acolo unde mai sunt introduse, numără doar cursele (limita matriței)',
              '/referanslar',
            ],
            ['Work Centers', 'Lista unică a centrelor de lucru: centru de cost, hală (pod rulant și echipă de setup), categorie (grupele din Gantt și Capacity Dashboard), oprire de frecvență (setup de bobină, setup de dispozitiv … sau niciuna), zile înghețate', '/makineler'],
            ['Work calendar', 'Pe centru de lucru: modelul săptămânal (zile de luni încolo × ture), săptămâni de excepție, ore suplimentare (cu dată sau recurente, dintr-un tip de ore suplimentare); opriri planificate; sărbători legale și zile libere introduse manual; setări de planificare', '/takvim'],
            ['Matrițe', 'Disponibilitate (dată și oră), zile de mentenanță, alarme de limită de lovituri — din Die Follow-up', '/die-followup/maintenance'],
            ['Utilaje', 'Orele planificate de mentenanță ale centrelor de lucru și defecțiunile deschise care opresc un centru de lucru — din Machine Follow-up', '/machine-followup/breakdowns'],
            ['Regulile dumneavoastră', 'Excludere, fixare pe un centru de lucru / o zi sau mutare în față', '/planlama'],
            ['Plan aprobat', 'Ultimul plan aprobat, pentru zilele înghețate', '/planlama'],
          ]}
        />
      </Step>

      <Step n={2} id="demand" title="Calculul cererii nete">
        <ul>
          <li>
            Fiecare coloană ZPP este o săptămână calendaristică, începând cu săptămâna
            curentă. Se planifică doar săptămânile din orizontul de planificare.
          </li>
          <li>
            Cantitatea restantă devine un element de <b>restanță</b> cu termen în această săptămână.
          </li>
          <li>
            Stocul se scade întâi din cel mai apropiat necesar: restanța, apoi săptămâna
            aceasta, apoi săptămâna viitoare și așa mai departe. Ce rămâne trebuie
            produs.
          </li>
          <li>
            <b>Zile de vânzare — ZPP_DAILY.</b> Pentru fiecare zi acoperită de fișierul
            ZPP_DAILY, cererea cade exact la data din fișier: 5 000 livrate
            miercuri înseamnă 5 000 miercuri, nu 1 000 pe zi. După ultima zi
            a fișierului, ZPP-ul săptămânal se distribuie uniform pe zilele lucrătoare
            ale fabricii — zile care nu sunt sărbători și în care cel puțin un centru de lucru are
            ture normale; orele suplimentare nu fac dintr-o zi o zi lucrătoare (o săptămână acoperită
            parțial primește restul totalului săptămânal în zilele neacoperite). Restanța
            are termen astăzi.
          </li>
          <li>
            <b>Întâi ZPP_DAILY — ZPP-ul săptămânal este pe termen lung.</b> Când ZPP_DAILY este
            încărcat (și ajunge până astăzi), el este angajamentul SAP pentru zilele pe care le
            acoperă. Cererea care vine din ZPP-ul săptămânal — zilele de după ultima zi din
            ZPP_DAILY și fiecare piesă care nu are rând în ZPP_DAILY — devine un lot
            separat <b>pe termen lung</b>. Loturile pe termen lung sunt plasate doar{' '}
            <b>după toate loturile zilnice</b> (restanță, urgente, de umplere și loturile mutate
            în față), doar în capacitatea rămasă, niciodată înaintea unei lucrări zilnice
            care continuă pe matrița ei fără setup, și <b>nu sunt niciodată întârziate</b>. O
            săptămână acoperită doar parțial de ZPP_DAILY este <b>împărțită</b>, niciodată amestecată:
            zilele acoperite formează lotul zilnic, restul este un lot pe termen lung etichetat{' '}
            <code>W38 LT</code>. Bobinele întregi se aplică în continuare: bucățile în plus ale lotului
            zilnic reduc lotul pe termen lung. Exemplu: ZPP_DAILY până miercuri, cu 1 000
            luni și 1 000 miercuri, W38 săptămânal = 5 000, o bobină dă 2 500
            buc → lot zilnic 2 500 (o bobină, verificată doar luni și miercuri) +
            lot pe termen lung 2 500 (3 000 joi–vineri − 500 în plus). Fără
            ZPP_DAILY nimic nu este pe termen lung, iar ZPP-ul săptămânal se planifică la fel ca înainte.
          </li>
          <li>
            <b>Momentul — stocul proiectat.</b> Parcurgând zi cu zi, motorul
            găsește ziua în care stocul — plus fiecare lot planificat înainte — ar
            scădea sub zero. Aceasta este <b>ziua de epuizare a stocului</b> pentru lot.
          </li>
          <li>
            <b>Stocul de siguranță.</b> Lotul poate începe cu{' '}
            <b>{current.safety} zi(le) lucrătoare</b> înainte de ziua de epuizare, și
            nu mai devreme, ca stocul să nu se acumuleze și centrul de lucru să rămână liber
            pentru piesele care au nevoie de el. Dacă acea zi este deja astăzi sau a trecut,
            lotul este <b>urgent</b>; altfel este <b>de umplere</b> (fill).
          </li>
          <li>
            <b>Produs, dar încă nu în fișierul de stoc.</b> Lucrările aprobate care
            au rulat după ultima încărcare MB52 contează ca stoc până la următoarea
            încărcare. Exemplu: 6 000 buc ștanțate luni, stocul încărcat din nou
            marți dimineață — între timp, cele 6 000 nu sunt planificate a doua
            oară. Production Plan arată când se folosește această
            ipoteză.
          </li>
          <li>
            <b>Coprodusele</b> ies din aceeași cursă, deci nu pot fi
            produse separat. Pentru fiecare săptămână, perechea se produce pentru cel mai mare dintre
            cele două necesare, iar perechea este <b>un singur lot și o singură lucrare</b> —
            pe piesa care o numește pe cealaltă drept coprodus. Lucrarea arată
            ambele cantități; timpul centrului de lucru și setup-ul se numără o singură dată.
          </li>
          <li>
            <b>Bobine întregi — întotdeauna.</b> O bobină montată se rulează până la capăt, deci
            fiecare lot alimentat din bobină este un număr întreg de bobine (curse pe bobină ×
            cavități). Surplusul acoperă săptămânile următoare și nu
            declanșează o altă bobină; restanța și necesarul săptămânii curente împart aceeași
            bobină și același setup. O bobină nu este <b>niciodată scurtată</b> — nici ca să
            încapă într-un gol, nici ca să salveze o lucrare întârziată.
          </li>
          <li>
            <b>Lot minim în loc de bobină.</b> Acolo unde cantitatea pe bobină este
            flexibilă (centrele de lucru transfer 106/107), în master data se introduce
            un <b>Min. lot (pcs)</b>. Acesta înlocuiește bobina: lotul are cel puțin atâtea
            bucăți, iar peste acest prag exact necesarul (necesar 300, lot minim 2 000 → 2 000;
            necesar 2 500 → 2 500). Surplusul acoperă săptămânile următoare. Greutatea
            bobinei este atunci ignorată și poate rămâne goală.
          </li>
          <li>
            <b>Niciunul?</b> O piesă fără Min. lot și fără o greutate reală de bobină (goală
            sau 1 kg ca valoare de umplutură) este o eroare de master data: se planifică
            exact necesarul, iar planul și pagina Master Data avertizează în privința ei.
          </li>
          <li>
            <b>Fără bobină deloc</b> (sudură de piulițe, sudură în puncte, asamblare …): o piesă cu
            timp de ciclu și fără bobină sau tablă se planifică exact la necesar (sau la Min.
            lot) <b>fără</b> avertisment, iar pagina Raw Material nu cere
            oțel pentru ea.
          </li>
        </ul>
        <Example>
          Restanță 200 buc, săptămâna viitoare 2 000 buc, fără stoc. O bobină dă 5 000
          buc. Restanța are nevoie de o bobină, deci se ștanțează acum 5 000 buc; surplusul de
          4 800 acoperă săptămâna viitoare. Rezultat: o lucrare, un setup — nu două.
        </Example>
      </Step>

      <div className="mt-4 max-w-4xl">
        <StockExample safetyDays={2} />
      </div>

      <Step n={3} id="capacity" title="Construirea capacității">
        <p>Pentru fiecare centru de lucru și fiecare zi din orizont:</p>
        <Formula>
          minute nete = ture normale × durata turei + ferestre de ore suplimentare − opriri planificate → × factor de capacitate
        </Formula>
        <ul>
          <li>
            Fiecare centru de lucru are <b>un singur calendar</b>: săptămâna lui standard („N zile” se completează de
            luni: 5 = Lu–Vi, 6 = Lu–Sâ; ture pe zi), o <b>excepție de săptămână</b> când
            există una și <b>orele suplimentare</b> deschise la anumite date (sau în fiecare săptămână, pe model)
            cu o definiție de ore suplimentare — ora de început și durata. Orele suplimentare deschise în
            Capacity Dashboard sunt aceeași înregistrare.
          </li>
          <li>
            O <b>înregistrare de zi</b> are ultimul cuvânt pentru un centru de lucru și o zi: în Production
            Plan, caseta <b>Work calendar</b>, apăsați <b>Edit</b>, apoi un clic pe o celulă deschide sau închide
            acea tură, iar <b>Save</b> scrie toată săptămâna deodată (Cancel o anulează). Ea are prioritate față de
            excepția de săptămână, model și sărbătoare (ordinea: înregistrare de zi → excepție de săptămână →
            model). Turele nu trebuie să fie consecutive: doar tura a 3-a (cu ture de 8 h
            de la 07:00: 23:00–07:00) înseamnă 480 min, 450 nete cu o masă de 30 min în tura a 3-a. O tură
            care se suprapune cu orele suplimentare din acea zi este refuzată; ↺ șterge înregistrarea. În același mod
            Edit, rândul OT adaugă sau șterge orele suplimentare cu dată din acea zi; Save aplică întâi
            ștergerile de ore suplimentare, apoi înregistrările de zi, apoi noile ore suplimentare. Modificarea ajunge în plan
            la următorul Calculate plan.
          </li>
          <li>
            O sărbătoare legală este o zi liberă: turele ei se pierd și nu sunt mutate niciodată în altă zi.
            Orele suplimentare deschise în ziua de sărbătoare sunt planificate. Orele suplimentare recurente nu rulează
            într-o zi de sărbătoare — deschideți-le la acea dată.
          </li>
          <li>
            Turele au aceeași durată și se succed de la începutul primei ture (de ex. 2 ×
            9 h de la 07:00: 07:00–16:00, 16:00–01:00). Orele suplimentare nu se pot suprapune cu turele normale
            sau cu alte ore suplimentare.
          </li>
          <li>
            <b>Orele suplimentare se deschid în afara grilei de ture, nu în interiorul ei.</b> Într-o zi în care
            centrul de lucru lucrează, turele formează grila zilei: o tură închisă se redeschide în
            calendarul de lucru, nu ca ore suplimentare. De aceea, orele suplimentare încap doar între sfârșitul
            grilei și sfârșitul zilei de producție. Un centru de lucru cu ture de <b>8 h</b> are
            3 ture pe zi, grila acoperă toate cele 24 h și <b>nu se pot deschide ore suplimentare într-o
            zi lucrătoare</b> — ele se deschid într-o zi în care centrul de lucru nu lucrează, de obicei
            <b>sâmbăta sau duminica</b>. Un centru de lucru cu ture de <b>9 h 40</b> are 2 ture
            (06:30–16:10 și 16:10–01:50 = 19 h 20), deci 01:50–06:30 este în afara grilei și acolo se
            deschid ore suplimentare de noapte de cel mult 4 h 40. O zi fără nicio tură normală
            (sâmbătă, duminică, sărbătoare) este în întregime în afara modelului normal: toată ziua
            poate primi ore suplimentare.
          </li>
          <li>
            Orele suplimentare trebuie totuși să încapă într-un timp efectiv liber: ziua de producție
            (24 h de la începutul primei ture) minus turele deschise și orele suplimentare deja
            deschise. Caseta <b>Work calendar</b> din Production Plan scrie rezultatul pe rândul OT al
            fiecărei zile — <i>liber 01:50–06:30</i>, <i>plin</i> când fereastra este ocupată sau
            <i>turele acoperă 24 h</i> când grila nu lasă nicio fereastră; orele suplimentare care nu încap
            nu pot fi alese. Toată săptămâna afișată poate fi editată, inclusiv sâmbăta și duminica
            închise — așa se deschide lucrul în weekend, fie ca ore suplimentare, fie ca înregistrare de zi
            care deschide turele propriu-zise.
          </li>
          <li>
            Un centru de lucru fără model în Work Calendar nu are capacitate; Production Plan afișează
            o alarmă roșie. O zi nu depășește niciodată 24 de ore (inclusiv opririle planificate), deci săptămâna unui
            centru de lucru nu depășește niciodată 168 de ore — introducerile mai lungi sunt refuzate la salvare.
          </li>
          <li>Opririle planificate care cad în timpul orelor suplimentare sunt și ele scăzute.</li>
          <OperatorPlanItem />
          <li>
            Zilele trecute sunt sărite, iar ziua de azi începe de la ora
            curentă — nimic nu se planifică în trecut. Ziua de plan începe cu
            prima tură ({current.shiftStart}), deci la 02:00 tura de noapte
            aparține încă zilei precedente.
          </li>
          <li>
            Fiecare centru de lucru este o singură axă de timp continuă: o lucrare care nu se termină
            înainte de sfârșitul turei sau al zilei continuă pur și simplu în tura următoare.
          </li>
        </ul>
      </Step>

      <Step n={4} id="blocks" title="Blocarea a ceea ce nu poate rula">
        <ul>
          <li>
            <b>Zilele înghețate (Frozen days)</b>: lucrările din planul aprobat din primele zile
            sunt păstrate exact unde sunt, iar ce produc ele se scade
            din cerere. Motorul planifică doar timpul liber din jurul lor.
          </li>
          <li>
            <b>Lucrări aprobate și mutate</b>: o lucrare aprobată individual (clic pe ea → Approve this job) sau
            trasă în Gantt pe alt centru de lucru, altă zi sau altă oră (pe telefon: țineți apăsat, apoi trageți; sau
            clic pe ea → Move…) este blocată acolo în același fel — păstrată pe loc, cantitatea ei scăzută din
            cererea acelei piese, celelalte lucrări planificate în jurul ei. O mutare păstrează în ordine minutele de setup,
            aprobare, producție și oprire de frecvență ale lucrării și le revarsă în minutele de lucru ale centrului de
            lucru țintă, din punctul unde a fost lăsată; când o zi este plină, continuă în
            următoarea zi lucrătoare (de ex. 120 min setup + 600 min producție lăsate la minutul 1200 al unei
            zile de 1350 de minute: setup 1200–1320, 30 min producție în acea zi, celelalte 570 min în următoarea
            zi lucrătoare). Nu poate începe înainte de momentul actual, trebuie să se încadreze înainte de sfârșitul planului și nu se poate
            suprapune cu altă lucrare aprobată sau înghețată ori cu o mentenanță pe acel centru de lucru.
          </li>
          <li>
            <b>Lucrări adăugate manual</b> (Plan → + Add job, de ex. o piesă rulată pe stoc): piesă, cantitate, centru
            de lucru, zi și oră de început. Un clic pe un gol neocupat din grafic (linia portocalie întreruptă) deschide
            același formular cu centrul de lucru, ziua și ora de început a golului completate. Durata este calculul propriu al motorului pentru acea piesă și
            cantitate, în ordinea motorului — setup (niciunul dacă matrița este deja montată), aprobarea
            calității, producția pe bobină cu schimbare de bobină între bobine pe un centru de lucru alimentat din bobină
            (de ex. 90 min setup + 15 min aprobare + bobine de 200 și 150 min cu o schimbare de bobină de 20 min =
            475 min). Lucrarea este blocată la acea oră ca o lucrare mutată: cantitatea ei se scade din
            cererea viitoare a piesei, astfel că loturile ulterioare ale acelei piese se micșorează sau dispar, iar celelalte
            lucrări ale centrului de lucru se mută în spatele ei. Aceleași limite ca la o mutare; o piesă nedefinită pentru acel centru de lucru este
            permisă, cu avertisment.
          </li>
          <li>
            <b>Ștergerea</b> (clic pe o lucrare): o lucrare adăugată manual → <i>Delete job</i>, iese din plan și
            cantitatea ei nu se mai scade din cerere; o lucrare aprobată sau mutată → <i>Remove approval</i>, se întoarce
            la motor, care o planifică din nou; o lucrare a motorului → <i>Delete this lot</i>, lotul este setat la 0
            bucăți, iar cererea lui trece la următoarele loturi ale acelei piese (la fel ca atunci când tastați 0 drept cantitate a lotului).
          </li>
          <li>
            <b>Mentenanța centrului de lucru</b> scoate acele ore din ziua acelui
            centru de lucru; lucrările se așază în jurul ei.
          </li>
          <li>
            <b>Defecțiunea utilajului</b> (raportată în Machine Follow-up cu „the
            work center is stopped”): centrul de lucru este închis de la momentul defecțiunii până
            la ora estimată de repunere în funcțiune — sau, fără oră estimată, până
            la rezolvarea defecțiunii. Ca o perioadă închisă, este o oprire planificată: producția rulează până
            la ea și continuă după ea, bobina întreruptă se termină, iar bobinele rămase urmează ca
            un lot nou (vezi <i>Intervenția planificatorului</i>). O defecțiune care nu oprește centrul de lucru nu
            schimbă planul.
          </li>
          <li>
            Zilele de <b>mentenanță a matriței</b>: nicio parte a unei lucrări cu acea matriță nu poate
            cădea în ele.
          </li>
          <li>
            <b>Matrița nu este gata</b>: cu o dată (și oră) de disponibilitate, matrița este
            blocată până în acel moment — gata la 10:00 înseamnă că și orele
            anterioare ale acelei zile sunt închise; fără dată, este scoasă complet
            din plan.
          </li>
          <li>
            <b>Alarmă de limită de lovituri</b>: odată ce o matriță își depășește limita de
            mentenanță periodică, este scoasă din plan până când alarma este
            închisă.
          </li>
          <li>
            Materialele <b>excluse</b> (regula dumneavoastră) nu sunt planificate.
          </li>
        </ul>
      </Step>

      <Step n={5} id="order" title="Ordonarea lucrărilor">
        <p>Necesarele sunt planificate unul câte unul, în această ordine:</p>
        <ol className="list-decimal">
          <li>Materialele pe care le-ați mutat în față (și loturile aduse înainte ca să nu întârzie)</li>
          <li>
            <b>Restanța (Backlog)</b> — cantitatea restantă din ZPP rămasă după stoc. Termen: ziua
            următoare la {current.cutoff}.
          </li>
          <li>
            <b>Urgent</b> — un lot al cărui stoc scade acum la nivelul de siguranță: se
            epuizează în {current.safety} zi(le) lucrătoare. Termen: {current.cutoff} în
            ziua în care se epuizează stocul.
          </li>
          <li>
            <b>Umplere (Fill)</b> — toate celelalte loturi: zilele și săptămânile viitoare. Poate începe cu{' '}
            {current.safety} zi(le) lucrătoare înainte de epuizarea stocului sau cu până la{' '}
            {current.pullForward} zile mai devreme când un centru de lucru ar sta nefolosit.
          </li>
          <li>
            <b>Termen lung (Long-term)</b> (doar când ZPP_DAILY este încărcat) — loturile din ZPP-ul
            săptămânal. Vin după toate cele de mai sus, chiar și după materialele mutate în
            față, și umplu doar capacitatea liberă rămasă. Exemplu: un centru
            de lucru, o tură; piesa D are nevoie de 7 000 buc miercuri în ZPP_DAILY
            (700 min + 30 min setup), piesa L are doar 4 000 săptămânal. D rulează prima,
            luni, și este la timp; L urmează marți ca lot pe termen lung și
            nu este întârziată. Dacă L ar fi mers prima, D ar fi fost gata prea târziu.
          </li>
        </ol>
        <p>
          Restanța trece întotdeauna înaintea urgentelor, chiar și atunci când ambele au termen în același
          moment. <b>O excepție — matrița montată:</b> când o lucrare urgentă ar
          necesita un setup pe un centru de lucru a cărui matriță montată mai are un lot de umplere în așteptare,
          acel lot de umplere rulează întâi, fără setup, atâta timp cât lucrarea urgentă
          este încă gata la ora de livrare. Altfel, matrița ar fi demontată
          pentru lucrarea urgentă și montată din nou mai târziu — două setup-uri în loc de
          unul. Dacă lucrarea urgentă ar întârzia, ea merge prima.
        </p>
        <p>
          În cadrul fiecărui grup, lotul al cărui stoc se epuizează primul merge primul.
          Când și acesta este egal, merge prima piesa care poate rula pe <b>cele mai puține
          centre de lucru</b>: o piesă cu un singur centru de lucru își ia locul înaintea unei
          piese cu alternative, care se distribuie apoi pe centrele de lucru
          rămase. Cine este plasat primul primește cele mai bune locuri.
        </p>
      </Step>

      <Step n={6} id="place" title="Plasarea fiecărei lucrări">
        <p>
          Candidații sunt centrul de lucru principal al materialului — plus
          alternativele lui <b>doar dacă piesa are bifa Flexible work center</b> în
          master data (sau doar centrul de lucru fixat). O piesă care nu este flexibilă
          rulează întotdeauna pe centrul ei de lucru principal, chiar dacă astfel întârzie: aprobarea
          ei de calitate aparține acelui centru de lucru. Pe fiecare candidat, motorul caută
          cel mai devreme timp liber — inclusiv în golurile lăsate anterior — și construiește
          lucrarea:
        </p>
        <div className="my-3 flex flex-wrap items-center gap-2 text-xs">
          <Block tone="bg-slate-200 text-slate-900">Schimbare de matriță</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-amber-100 text-amber-900">Aprobarea calității</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-emerald-100 text-emerald-900">Producție (bobina 1)</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-sky-100 text-sky-900">Oprire de frecvență (de ex. schimbare de bobină)</Block>
          <span aria-hidden>→</span>
          <Block tone="bg-emerald-100 text-emerald-900">Producție (bobina 2)</Block>
          <span aria-hidden>→ …</span>
        </div>
        <Formula>
          timp pur = bucăți × timp de ciclu (min/buc) · durata lucrării = max(timp pur ÷ Accepted OEE, timp pur + setup +
          opriri de frecvență + aprobare)
        </Formula>
        <p className="text-xs text-muted-foreground">
          Fiecare piesă pe fiecare centru de lucru — presă, sudură de piulițe, sudură în puncte, asamblare — este temporizată astfel;
          niciun centru de lucru nu este lăsat în afara planului. Exemplu: {cycleExample.qty.toLocaleString('en-GB')} bucăți ×{' '}
          {cycleExample.minutes.toFixed(CYCLE_DECIMALS)} min = {Math.round(cycleRun.theoreticalRunMinutes)} min de timp pur; la un{' '}
          Accepted OEE de {Math.round(cycleExample.oee * 100)} %, lucrarea durează {Math.round(cycleRunOee.totalMinutes)} min.
          O piesă fără timp de ciclu, dar cu vechile SPM și cavități, rulează cu 1 ÷ (SPM × cavități) min/buc — timpul
          ei este exact cel de dinainte (curse ÷ SPM). Fără niciunul dintre ele, piesa nu are viteză, iar verificarea planului
          o semnalează („no cycle time in master data”). Un fișier de master data poate da timpul în secunde — așa
          sunt măsurate presele, sudura în puncte și liniile de asamblare (o coloană <b>Saturasyon</b> sau{' '}
          <b>Birim süre saniye</b>) — iar încărcarea îl împarte la 60:{' '}
          {cycleSecondsExample} s = {cycleFromSeconds?.toFixed(CYCLE_DECIMALS)} min/buc. Timpii de ciclu sunt
          păstrați cu {CYCLE_STORE_DECIMALS} zecimale și afișați cu {CYCLE_DECIMALS}, deoarece o piesă de presă poate
          rula sub o secundă: {pressSecondsExample.toFixed(CYCLE_DECIMALS)} s înseamnă{' '}
          {formatCycleInput(pressCycle)} min/buc, iar cu {CYCLE_DECIMALS} zecimale ar fi{' '}
          {pressCycle.toFixed(CYCLE_DECIMALS)} — cu 2,6 % mai mult timp la fiecare lucrare a acelei piese
          ({(10_000 * pressCycle).toFixed(1)} min pentru 10.000 de bucăți față de{' '}
          {(10_000 * Number(pressCycle.toFixed(CYCLE_DECIMALS))).toFixed(1)} min).
          Cursele = ⌈bucăți ÷ cavități⌉ (= bucăți când nu sunt introduse
          cavități) contează doar pentru limita de lovituri a matriței și pentru cursele pe bobină.
          Setup-ul, opririle de frecvență (schimbări de bobină …) și aprobarea calității sunt cuprinse în acest timp; când nu încap, lucrarea este timpul
          pur plus aceste opriri. Opriri de frecvență = bobine − 1 (bobine = ⌈cantitate ÷ bucăți pe bobină⌉, bucăți pe bobină = ⌊greutatea bobinei ÷
          greutatea brută⌋); un centru de lucru a cărui oprire de frecvență este — none — nu se oprește niciodată pentru ea. Un coprodus provine din aceleași curse:
          curse × propriile lui cavități.
        </p>
        <p>Lucrarea trebuie să respecte toate regulile deodată:</p>
        <ul>
          <li>
            Dacă aceeași matriță este deja pe centrul de lucru, setup-ul este omis.
          </li>
          <li>
            {current.crossShifts
              ? 'Un setup poate începe aproape de sfârșitul unei ture și poate fi terminat de tura următoare; nu depășește niciodată ultimul minut lucrător al zilei. Producția poate.'
              : 'Un setup sau o schimbare de bobină nu depășește niciodată sfârșitul unei ture — nicio echipă nu începe un setup pe care nu îl poate termina. Producția poate.'}
          </li>
          <li>
            <b>Setup-urile continuă în timpul pauzelor de ceai și de masă.</b> Echipa de setup este
            indirectă și își ia pauza după setup. Un setup de 30 de minute care
            întâlnește o pauză de ceai de 15 minute după 15 minute durează tot 30 de minute;
            producția începe imediat după pauză, iar pauza nu costă nimic centrului
            de lucru. Predarea turei și opririle de mentenanță întrerup însă un setup.
          </li>
          <li>
            <b>Echipa de setup</b>: în mod normal, cel mult {current.plantNormal} schimbare(i) de matriță rulează
            simultan oriunde în fabrică. <b>Regula dinamică:</b> pentru restanță sau pentru o
            lucrare care altfel ar începe după epuizarea stocului, până la{' '}
            {current.plantUrgent} setup-uri se pot suprapune, ca producția să înceapă mai repede. Odată ce
            lucrările urgente sunt plasate, setup-urile revin la unul după altul.
          </li>
          <li>
            <b>Niciun centru de lucru nefolosit cât timp lucrările așteaptă</b>: un lot poate începe cu până la{' '}
            {current.pullForward} zi(le) înainte de a fi necesar, când centrul lui de lucru ar
            sta altfel nefolosit, astfel încât planul umple zilele lucrătoare pe care le-ați deschis în
            Work Calendar — aceleași ore pe care le numără Capacity Dashboard. Dacă nimic nu este
            urgent, matrița aflată deja pe centrul de lucru continuă întâi cu următorul ei lot, astfel încât
            nu se face niciun setup în plus.
          </li>
          <li>
            Fiecare gol neocupat din graficul planului arată de ce există (echipa de setup ocupată, matrița
            pe alt centru de lucru, încă nepermis, …).
          </li>
          <li>
            <b>Podul rulant</b>: într-o hală, schimbările de matriță sunt la cel puțin{' '}
            {current.setupGap} min distanță și cel mult {current.concurrent}
            simultan; schimbările de bobină sunt la cel puțin {current.coilGap} min distanță; o schimbare
            de matriță și o schimbare de bobină nu se suprapun niciodată.
          </li>
          <li>O matriță nu poate fi pe două centre de lucru în același timp.</li>
          <li>
            Dacă cantitatea necesită mai multe curse decât limita de lovituri a matriței, ea
            se împarte în tranșe la nivel de <b>bobine întregi</b> — o bobină nu se împarte niciodată
            între tranșe. Dacă o singură bobină depășește limita,
            tranșa este acea bobină, iar lucrarea este semnalată.
          </li>
          <li>
            Un lot nu începe înainte de data lui de siguranță ({current.safety} zi(le)
            lucrătoare înainte de epuizarea stocului) minus fereastra de aducere înainte de{' '}
            {current.pullForward} zi(le).
          </li>
        </ul>
        <p>
          <b>Câștigă centrul de lucru care termină lucrarea cel mai devreme</b> — cu o
          excepție: când nimic nu este urgent, se preferă continuarea matriței deja montate
          (fără setup). Pentru restanță sau pentru o lucrare care altfel ar
          începe după epuizarea stocului, motorul încearcă și regula dinamică de
          setup și o păstrează pe cea care termină mai repede. Apoi se rezervă timpul
          centrului de lucru ales, intervalele podului rulant, intervalul de setup și matrița, iar
          următorul necesar este plasat.
        </p>
      </Step>

      <Step n={7} id="check" title="Verificare și raportare">
        <ul>
          <li>
            O piesă este <b>întârziată</b> când cantitatea de care clientul are nevoie nu este
            gata până la <b>{current.cutoff}</b> în ziua în care este necesară — nu când
            se termină tot lotul. Este verificată fiecare zi acoperită de un lot, nu doar
            prima. Restanța din ZPP și tot ce este necesar astăzi au termen
            <b> a doua zi la {current.cutoff}</b>. Sărbătorile legale nu sunt sărite: un client
            poate dori piese într-o zi de sărbătoare. Întârzierea este afișată în
            ore și zile. Motorul nu o lasă așa — vezi{' '}
            <a href="#late" className="underline">
              Lucrările întârziate sunt replanificate
            </a>
            .
          </li>
          <li>
            <b>Fereastra lucrării</b> (clic pe o bară) arată aceeași verificare pentru fiecare lucrare: zilele
            <b> Req dates</b> acoperite de lucrare și cantitatea lor, ora de început și de sfârșit
            și un <b>Status</b> pe fiecare zi de necesar — câte bucăți sunt gata cu câte
            ore <b>înainte</b> sau cu câte ore <b>întârziere</b> față de {current.cutoff} în acea zi.
            Ce produce lotul peste necesar (rotunjirea la bobine întregi sau la
            Min. lot) este <b>suprastoc</b>. Exemplu: 3.000 buc restanță, o bobină
            produce 6.000 → &ldquo;3.000 buc (2 ore întârziere) și 3.000 buc
            (suprastoc)&rdquo;. O lucrare al cărei stoc ține tot orizontul nu are
            zi de necesar: totul este suprastoc (constituire de stoc).
          </li>
          <li>
            Ce nu încape nicăieri ajunge în <b>Unplanned</b>, cu
            motivul și un link spre corectare (fără master data, fără centru de lucru eligibil, fără
            capacitate liberă…).
          </li>
          <li>
            <b>Materie primă urgentă (Urgent raw material)</b>: cantitatea planificată × greutatea brută, parcursă în
            ordinea în care oțelul este <b>necesar</b>, față de stocul de bobine plus bobinele în
            tranzit din ziua sosirii lor. O bobină este urgentă când oțelul este
            necesar în următoarele {current.rawUrgent} zi(le) lucrătoare; acestea sunt
            listate în Overview. Ziua de necesar a unei lucrări este ziua ei planificată — cu excepția unei
            lucrări <b>aduse înainte</b> doar pentru ca centrul ei de lucru să nu stea: cât timp
            stocul de produse finite încă acoperă cererea, oțelul ei este necesar în ziua
            în care lotul poate începe (epuizarea stocului − zilele de stoc de siguranță), nu în
            ziua adusă înainte. O astfel de lucrare poate aștepta bobina, de aceea apare ca
            &ldquo;lipsește mai târziu&rdquo;, cu ziua planificată și ziua în care oțelul este
            necesar. Coprodusele nu sunt numărate de două ori. Necesarul săptămânal este
            separat — vezi{' '}
            <a href="#raw-mrp" className="underline">
              Necesarul de materie primă
            </a>
            .
          </li>
          <li>
            Avertismentele listează tot ce a schimbat planul: matrițe scoase din plan, centre de lucru
            în mentenanță, date lipsă.
          </li>
        </ul>
      </Step>

      <section id="late" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-950">Lucrările întârziate sunt replanificate</h2>
        <p className="mt-1 text-sm text-amber-900">
          O lucrare care începe după epuizarea stocului înseamnă că clientul se oprește —
          propriul stoc de siguranță este singura marjă. De aceea, o lucrare întârziată nu este niciodată doar
          raportată; motorul planifică din nou, în până la șase runde:
        </p>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-amber-900">
          <li>
            <b>Mutarea lotului întârziat în față</b> în cadrul propriului grup: un lot de umplere întârziat
            trece în fruntea loturilor de umplere, niciodată înaintea restanței. Apoi
            încearcă din nou fiecare centru de lucru eligibil, astfel încât este găsit un centru de lucru alternativ care este
            liber mai devreme.
          </li>
          <li>
            <b>Permiterea suprapunerii setup-ului</b>: o lucrare cu risc de întârziere poate face setup în timp ce
            rulează alt setup — inclusiv în aceeași hală — cel mult{' '}
            {current.plantUrgent} simultan în toată fabrica, ca producția să înceapă
            mai repede. De îndată ce nu mai rămâne nicio lucrare restantă sau cu risc de întârziere, setup-urile nu
            se mai suprapun (unul pe hală, {current.plantNormal} în fabrică). Schimbările de
            bobină nu se suprapun niciodată.
          </li>
          <li>
            <b>Păstrarea celui mai bun plan</b>: cele mai puține neplanificate (loturi zilnice), apoi cele mai puține
            <b> piese</b> întârziate (trei loturi întârziate ale unei piese înseamnă o singură oprire la client), apoi
            cele mai puține ore de întârziere și abia apoi cele mai puține loturi pe termen lung neplanificate.
            Loturile pe termen lung nu sunt niciodată întârziate și nu sunt niciodată mutate în față. O rundă care nu aduce îmbunătățiri nu oprește
            căutarea — runda următoare poate aduce — dar cel mai bun plan de până atunci este păstrat.
          </li>
        </ol>
        <p className="mt-2 text-sm text-amber-900">
          <b>Bobinele nu sunt niciodată tăiate pentru a salva o lucrare întârziată.</b> O bobină montată se rulează
          până la capăt; tăierea ei ar lăsa o jumătate de bobină, un al doilea setup și o
          a doua montare de bobină mai târziu. Dacă mutarea în față nu ajunge, lucrarea rămâne
          întârziată și este raportată.
        </p>
        <p className="mt-2 text-sm text-amber-900">
          Ce este încă întârziat apare în Overview cu roșu, <b>o singură dată pe
          material</b> (primul lui lot întârziat). <b>Întârzierea este o cotă, nu o comandă
          întreagă.</b> Ghidul este necesarul zilnic din ZPP: fiecare zi de necesar este un punct
          de livrare, cu termen la ora de livrare ({current.cutoff}), cu tot ce este necesar
          până în acea zi (ZPP_DAILY la propria dată; după el, ZPP-ul săptămânal distribuit pe
          zilele lucrătoare; restanța și necesarul de azi au termen a doua zi). În acel moment,
          motorul numără ce a fost deja ștanțat:
        </p>
        <ul className="mt-1 ml-5 list-disc space-y-1 text-sm text-amber-900">
          <li>
            <b>Needed qty</b> — de ce are nevoie clientul până la primul punct de livrare ratat
            (necesarul ZPP cumulat, nu mărimea lotului: un lot de 40 000 buc care acoperă 8 zile datorează
            la primul punct doar necesarul primei zile).
          </li>
          <li>
            <b>On time</b> — partea din acesta deja gata la ora de livrare. Bucățile ies
            uniform cât timp presa rulează (setup-ul și aprobarea nu dau nimic), deci o lucrare care
            a început înainte de termen a livrat deja o parte din necesar.
          </li>
          <li>
            <b>Late share</b> — restul, cu întârzierea <b>medie</b> și cea a <b>ultimei bucăți</b>:{' '}
            „15% (900 buc) · medie 0,8 h, ultima 1,5 h”. Întârzierea ultimei bucăți este{' '}
            <i>gata − ora de livrare</i>: dacă producția începe la 6 h după ora de livrare și
            durează j h, întregul necesar este complet cu 6 + j h întârziere. Clientul este alimentat din
            primele bucăți, așa că media este mai aproape de cât așteaptă de fapt linia.
          </li>
        </ul>
        <p className="mt-2 text-sm text-amber-900">
          Verificarea independentă a planului (mai jos) reia același necesar ZPP oră cu oră și raportează
          același deficit și același timp de recuperare, astfel încât cele două concordă întotdeauna.
        </p>
        <p className="mt-2 text-sm text-amber-900">
          <b>Why late</b> dă motivele găsite în planul însuși, de la
          cel mai puternic:
        </p>
        <ul className="mt-1 ml-5 list-disc space-y-1 text-sm text-amber-900">
          <li>avea deja termenul depășit când a fost calculat planul (restanță sau stocul nu a acoperit ziua de azi);</li>
          <li>
            nu poate fi gata nici dacă ar începe acum — lucrarea singură necesită mai mult timp de presă
            (setup + aprobare + producție) decât a rămas până la termen;
          </li>
          <li>
            centrul de lucru este ocupat înaintea ei: câte lucrări și câte ore, împărțite în necesare
            mai devreme, înghețate / aprobate și necesare mai târziu, și care au fost plasate primele printr-o
            intervenție în plan;
          </li>
          <li>presa a așteptat înainte de setup (echipa de setup, matrița pe altă presă…);</li>
          <li>ore între începutul setup-ului și momentul în care piesa e gata, în care presa nu lucrează (fără tură, weekend, pauze);</li>
          <li>un factor de capacitate sub 100%.</li>
        </ul>
        <p className="mt-2 text-sm text-amber-900">
          <b>Cum se calculează orele</b> (atingeți rândul): începutul setup-ului → setup +
          aprobarea calității + producția bucăților necesare la viteza piesei
          (bucăți pe oră = 60 ÷ timp de ciclu × performanță) → bucăți gata la
          ora de livrare (partea la timp) → ora la care e gata ultima bucată necesară. Întârzierea
          ultimei bucăți = gata − necesar până la (ora de livrare în ziua necesarului). Când presa
          nu poate reuși, <i>Why late</i> compară timpul de producție pe care presa îl are între
          începutul setup-ului și termen cu timpul necesar bucăților cerute. Alături sunt datele de intrare care decid — cererea și stocul
          de produse finite, viteza, minutele de setup și de aprobare, turele și ora de livrare —
          cu linkuri spre locul unde se setează. Dacă una dintre ele este greșită (de ex. un setup
          de 600 min în loc de 60, o tură lipsă), piesa doar <i>pare</i> întârziată:
          corectați acolo și recalculați.
        </p>
      </section>

      <section id="scenarios" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Scenarii — încercarea altor planuri</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          O singură ordine de plasare a lucrărilor nu este întotdeauna cea mai bună. După ce planul de mai sus
          este construit, motorul îl construiește din nou cu alte variante și îl păstrează
          pe cel mai bun:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b>Ordinea</b> în cadrul aceleiași urgențe: ziua de epuizare a stocului (standard),
            întâi lucrarea cea mai scurtă, întâi lucrarea cea mai lungă, întâi piesele cu cele mai puține centre de lucru
            și ordini amestecate aleatoriu.
          </li>
          <li>
            <b>Alegerea centrului de lucru</b>: centrul de lucru care termină primul (standard),
            cel care poate începe primul sau cel mai puțin încărcat.
          </li>
          <li>
            <b>Cel mai bun</b> înseamnă: cele mai puține loturi zilnice neplanificate, apoi cele mai puține piese întârziate, apoi
            cele mai puține ore de întârziere, apoi cele mai puține loturi pe termen lung neplanificate, apoi cel mai mare timp de producție (setup-urile nu
            contează ca producție), apoi cele mai puține setup-uri. Gradul de utilizare nu câștigă niciodată
            în fața unei piese întârziate.
          </li>
          <li>
            <b>Gradul de utilizare</b> = orele ocupate ale centrelor de lucru ÷ orele disponibile (calendarul
            de lucru minus mentenanța) în următoarele 7 zile, toate centrele de lucru împreună.
          </li>
          <li>
            <b>Căutarea se oprește</b> de îndată ce se atinge {current.target}% fără nimic
            întârziat, după{' '}
            {current.maxScenarios} scenarii, după 25 de scenarii fără
            îmbunătățire sau după două minute. Production Plan arată atunci
            nivelul atins (de ex. „best of {current.maxScenarios} scenarios
            reaches 90%”), gradul de utilizare al fiecărui centru de lucru și scenariile
            comparate.
          </li>
          <li>
            <b>Căutarea locală</b> lucrează apoi direct pe fiecare piesă întârziată: o mută
            cu 1, 2 sau 4 zile în față în grupul ei, îi comută marcajul „moved forward”
            sau mută cu 2 zile înapoi o piesă neîntârziată care rulează înaintea ei pe același centru de lucru.
            Fiecare mutare reconstruiește tot planul și este păstrată doar dacă planul
            devine mai bun (cel mult 150 de mutări sau un minut).
          </li>
          <li>
            <b>Împărțirea lotului</b> (tot căutare locală): un lot lung care rulează înaintea unei piese
            întârziate pe același centru de lucru — să zicem 30.000 buc — este tăiat în 2 sau 3 părți, astfel încât piesa întârziată
            să ruleze <i>între</i> ele: 15.000, piesa întârziată, apoi celelalte 15.000.
            Părțile sunt întotdeauna bobine întregi (o bobină montată nu este tăiată niciodată), prima parte acoperă
            ce este necesar mai întâi (rotunjit în sus la bobine întregi), iar un lot nu se împarte dacă o parte ar
            scădea sub Min. lot. Partea care nu acoperă niciun necesar este doar surplus de bobină și
            se planifică drept umplere, astfel încât nu mai blochează piesele urgente. A doua parte necesită încă un
            setup, de aceea o împărțire este păstrată doar când salvează o piesă întârziată; planul marchează lucrările{' '}
            <i>„lot split 1/2”</i>, iar verificarea planului listează loturile care au fost împărțite. O modificare
            de cantitate în grafic se aplică întregului lot.
          </li>
        </ul>
      </section>

      <section id="press-start" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Intervenția planificatorului — perioade închise și întârzieri</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Dacă nu specificați altfel, fiecare centru de lucru este planificat de acum înainte. În stânga sus, în
          Production Plan (<b>Plan settings</b>), puteți seta, pe centru de lucru, înainte de recalculare:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b>Închis de la – până la</b> (dată și oră), cu un motiv — fără operator, fără materie primă…
            Centrul de lucru nu primește lucrări între cele două momente; orele închise apar în
            grafic. Lăsați <i>de la</i> gol pentru a-l închide de acum până la <i>până la</i>. Exemplu: închis
            luni 07:30 – 10:00 la o tură de la 07:00 — o lucrare de 60 de minute nu încape în prima jumătate
            de oră, așa că începe la 10:00; o lucrare dinaintea unei perioade închise ulterioare (12:00 – 14:00) nu este
            mutată. Lucrările aprobate care ating perioada închisă sunt eliberate și planificate din nou.
          </li>
          <li>
            <b>O perioadă închisă — și o defecțiune deschisă care oprește presa — este o oprire planificată, nu un
            zid.</b> Producția rulează până la ea, presa
            se oprește cu bobina încă în ea și continuă după ea — ca o tură care nu este
            lucrată. Setup-ul, aprobarea calității și schimbările de bobină nu o traversează; dacă oprirea vine imediat
            după setup (încă nicio cursă), lucrarea începe în schimb după oprire. Când oprirea întrerupe
            o bobină, lucrarea se termină când acea bobină este terminată; bobinele rămase devin un lot nou
            care se planifică imediat după (matrița este încă montată, deci fără setup). Exemplu: 1.000 buc pe
            bobină, 100 min pe bobină, 3 bobine, oprire 09:00 – 10:00 la o tură de la 07:00: setup 07:00 – 07:30,
            prima bobină 07:30 – 09:00 și 10:00 – 10:10 → o lucrare de 1.000 de bucăți; celelalte 2.000 urmează la
            10:10. Dacă matrița ar trebui în schimb demontată, anulați manual acel lot.
          </li>
          <li>
            <b>În urmă / înainte</b> (ore): linia nu a respectat planul aprobat. +3 h mută
            lucrările aprobate (înghețate și în curs) cu 3 ore mai târziu și închide primele 3 ore ca
            „Behind plan”; −2 h le aduce înainte, niciodată înainte de momentul actual. „All work centers” setează valoarea pentru
            toată linia deodată.
          </li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          Lucrările neaprobate nu necesită corecție: fiecare Calculate plan reconstruiește planul de la
          momentul actual.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Alături, <b>Work calendar</b> arată centrul de lucru ales, săptămână cu săptămână: turele 1–3 pe
          zi așa cum le folosește planul (Work Calendar, excepții de săptămână, sărbători, înregistrări de zi) și
          orele suplimentare. Este doar pentru citire până când apăsați <b>Edit</b>: atunci un clic pe o celulă deschide
          sau închide acea tură — o înregistrare de zi (vezi <a href="#capacity">Construirea capacității</a>) — iar
          rândul OT adaugă sau șterge orele suplimentare ale acelei zile. Fiecare zi a săptămânii poate fi editată,
          inclusiv o sâmbătă sau o duminică închisă și, prin urmare, absentă din zilele planului;
          rândul OT oferă doar orele suplimentare care încap în fereastra liberă a acelei zile și scrie
          <i> plin (24 h)</i> când ziua se lucrează deja 24 de ore. Nimic nu se scrie până la
          <b> Save</b>; o celulă cu linie întreruptă nu este în plan până la următorul Calculate plan.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          În grafic, o lucrare este desenată ca <b>o bară pe fiecare interval de lucru</b>. Opririle planificate nu
          rup bara — sunt puncte mici în interiorul ei — dar o <b>tură închisă o rupe</b>: cu
          tura 1 și tura 3 deschise și tura 2 închisă, lucrarea este desenată ca 07:00–15:00 și
          23:00–07:00, cu 15:00–23:00 lăsat gol, pentru că centrul de lucru nu rulează atunci.
        </p>
      </section>

      <section id="org-filter" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Filtrul de departament, centru de cost și centru de lucru — o vedere, nu o regulă</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Trei pagini au același filtru: <Link to="/planlama" className="underline">Production Plan</Link>,{' '}
          <Link to="/referanslar" className="underline">Master Data</Link> și{' '}
          <Link to="/capacity" className="underline">Capacity Dashboard</Link>. Alegeți un{' '}
          <b>departament</b>, apoi unul sau mai multe dintre <b>centrele lui de cost</b>, apoi — în Master Data și
          în Capacity Dashboard — unul sau mai multe <b>centre de lucru</b>. Fiecare nivel îl restrânge pe următorul, astfel încât
          centrele de lucru pe care le puteți alege sunt exact cele ale centrelor de cost din acel departament.
          Fiecare pagină își reține propria selecție pentru data viitoare când o deschideți.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Ce restrânge fiecare pagină: în Production Plan, graficul, listele de centre de lucru, lista de piese
          din <b>Add job</b>, lista <b>Pin to work center</b> și numărul de lucrări întârziate; în Master
          Data, lista de piese — o piesă rămâne cât timp centrul ei de lucru principal <i>sau una dintre
          alternativele lui</i> se află printre cele alese, iar o piesă fără niciun centru de lucru nu aparține
          niciunui departament și apare doar cu filtrul dezactivat; în Capacity Dashboard, cardurile,
          graficul și lista de centre de lucru.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          <b>Filtrul nu schimbă planul sau cifrele.</b> Planul și prognoza de capacitate sunt
          calculate întotdeauna pentru toată fabrica — capacitatea, podurile rulante, echipele de setup și limitele matrițelor sunt
          corecte doar când toate centrele de lucru sunt văzute deodată — astfel încât filtrarea nu mută niciodată o lucrare,
          nu schimbă niciodată o oră în Capacity Dashboard, iar doi planificatori care se uită la departamente
          diferite văd același plan. Nimic nu este ascuns de motor; este ascuns doar de pe
          ecran.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          De aceea, <b>Calculate plan</b> calculează întotdeauna toate centrele de lucru împreună — presele și
          liniile cu plan de operatori (sudură de piulițe, sudură în puncte…) într-o singură rulare, indiferent ce arată filtrul.
          Caseta de calendar urmează filtrul: centrele de lucru ale unui centru de cost <i>Shift</i> arată{' '}
          <b>Work calendar</b> (ture și ore suplimentare pe centru de lucru), un centru de cost <i>Operator</i>
          arată <b>Operators per shift</b> (persoane pe zi și pe tură); ambele apar doar când
          selecția le conține pe amândouă. <b>Încă nelegate:</b> o piesă produsă pe o presă și folosită pe o
          linie de sudură este planificată separat pe fiecare linie — lucrarea de sudură nu așteaptă
          lucrarea de presă care îi produce piesa. Verificarea independentă avertizează când nu se potrivește (vezi{' '}
          <a href="#component-ready" className="underline">piesa intermediară nu este gata</a>).
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Legătura vine din definiții: centru de lucru → centru de cost (
          <Link to="/makineler" className="underline">Work Center Definitions</Link>) și centru de cost
          → departament (Company settings). Un centru de lucru fără centru de cost este listat la{' '}
          <i>Without a department</i>, ca să nu se piardă. Fiecare opțiune arată câte centre de lucru
          conține. Fiecare centru de lucru este în plan — presele, dar și sudura de piulițe, sudura în puncte,
          liniile robotizate și de asamblare — pentru că fiecare piesă este temporizată după timpul ei de ciclu (vezi{' '}
          <a href="#inputs" className="underline">Colectarea datelor</a>); nu există centru de lucru
          „neplanificat”.
        </p>
      </section>

      <section id="capacity-dashboard" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Capacity Dashboard — Prediction OEE și Accepted OEE</h2>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b>Capacitatea</b> reprezintă aceleași ore nete pe care le folosește planul (pasul 3): o singură formulă pentru plan,
            Work Calendar, Capacity Dashboard și Performance.
          </li>
          <li>
            <b>Orele de cerere</b> = bucăți × timp de ciclu ÷ 60 ÷ OEE, după scăderea stocului de produse finite, începând cu cea mai
            apropiată săptămână; săptămâna curentă poartă restanța. Grupele sunt <b>categoriile</b> centrelor de lucru.
          </li>
          <li>
            <b>A) Prediction OEE</b> — o singură rată pentru toate piesele ({current.predictionOee}%), setată în
            dashboard. Este o simulare doar pentru acea vedere și nu schimbă niciodată planul.
          </li>
          <li>
            <b>B) Accepted OEE</b> — valoarea fiecărei piese din Master Data, la fel ca în plan.
          </li>
          <li>
            Ambele folosesc aceeași metodă: orele disponibile așa cum sunt, timp de producție = timp ideal ÷
            OEE. <b>Factorul de capacitate</b> (pagina Performance) este un al treilea număr, separat: gradul
            de realizare măsurat față de planul aprobat, aplicat capacității planului.
          </li>
        </ul>
      </section>

      <section id="oee-short-stops" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">OEE — disponibilitate și performanță, opriri scurte</h2>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            Timpii se adună întâi, apoi se împart — niciodată o medie de procente. <b>Disponibilitatea (Availability)</b> = Production ÷ Loading,{' '}
            <b>Performanța (Performance)</b> = Operation ÷ Production, <b>Calitatea (Quality)</b> = Good ÷ (Good + Scrap + Reject), <b>OEE</b> = A × P × Q.
            Loading exclude deja opririle planificate (pauze, lipsă de lucru, probe: Reason Code 1 setat ca pauză în OEE Settings).
          </li>
          <li>
            <b>Opriri scurte</b>: o oprire neplanificată mai scurtă de {MES_SHORT_STOP_MIN} min este o pierdere de <b>performanță</b> (viteză); una de{' '}
            {MES_SHORT_STOP_MIN} min sau mai lungă este o pierdere de <b>disponibilitate</b>. MES-ul funcționează deja așa: timpul lui de producție
            scade doar opririle de {MES_SHORT_STOP_MIN} min și mai lungi, deci A și P sunt valorile din MES pe fiecare pagină OEE (Dashboard, trends,
            weekly / monthly, Daily Report, Board, KPI).
          </li>
          <li>
            Paginile de pierderi împart același cod de motiv după durata fiecărei opriri. Loss Bridge arată doar opririle lungi (de ex.
            „Machine”); cele scurte <b>nu sunt o treaptă a punții</b> — rămân în Speed loss = Production − Operation (nota
            treptei le dă minutele) și sunt analizate în intervalele de durată din MTTR &amp; MTBF. Nu ating niciodată treapta de
            disponibilitate: A, pierderea de disponibilitate și „Not explained” sunt aceleași cu sau fără ele. Losses Trend păstrează o coloană „Short
            stops” (Speed = Production − Operation − opriri scurte). Totalurile și OEE-ul nu se schimbă niciodată.
          </li>
          <li>
            Limita se setează în OEE Settings → Numbers (implicit {MES_SHORT_STOP_MIN} min, minute întregi). O altă valoare schimbă doar
            împărțirea pierderilor; A și P rămân ca în MES, iar puntea arată diferența.
          </li>
          <li>
            Duratele opririlor sunt stocate începând cu {dmy(SHORT_STOP_DATA_FROM)}; înainte de această dată opririle nu sunt împărțite (toate sunt disponibilitate), iar
            pagina afișează „duration split not available before {dmy(SHORT_STOP_DATA_FROM)}”.
          </li>
          <li>
            <b>MTTR / MTBF</b> numără implicit doar opririle egale cu limita sau mai lungi (defecțiunile și setup-urile sunt pierderi de disponibilitate);
            opririle scurte sunt primul interval de durată. Agent Report, Agent Insights și Open Topics citesc opririle lungi pentru notele despre matriță și
            utilaj (disponibilitate) și opririle scurte pentru notele despre micro-opriri / viteză.
          </li>
          <li>
            Exemplu (test): pe 21.09 la PRS-105, tura 3, Loading − Production este 140,6 min = opririle de 2 min și mai lungi; cele 21,6
            min de opriri mai scurte sunt în Production − Operation.
          </li>
          <li>
            <b>Opriri nedefinite</b>: Reason Code 1 sau Reason Code 2 „{UNDEFINED_RC1}” (ori un Reason Code 2 gol) înseamnă că operatorul nu
            a definit oprirea. Reason Code 1 „{UNDEFINED_RC1}” este întotdeauna o <b>pierdere</b> (chiar și când nu este bifat ca pierdere în OEE
            Settings → Reason Code 1) și niciodată o pauză planificată; Reason Code 2 „{UNDEFINED_RC1}” este o pierdere când Reason Code 1 al lui este pierdere. Pe
            fiecare pagină OEE (Losses Trend, Loss Bridge și Level 3, Asakai, Daily Report, Agent Report, Agent Insights, Open Topics), aceste
            opriri stau la <b>{UNASSIGNED}</b>; un rând „{UNDEFINED_RC1}” din OEE Settings → Loss groups nu este folosit. Împărțirea opririlor scurte
            funcționează la fel: opririle mai scurte decât limita merg la Short stops (viteză), cele mai lungi la {UNASSIGNED} (disponibilitate).
            Pauzele planificate nu sunt afectate.
          </li>
          <li>
            Exemplu (test): Reason Code 1 „{UNDEFINED_RC1}”, Reason Code 2 STP (Setup), 30 min → {UNASSIGNED} 30 min, Setup 0 min.
          </li>
          <li>
            <b>Ordinea coloanelor</b> este aceeași pe fiecare pagină: grupele de pierderi în ordinea lor din OEE Settings (butoanele ↑ ↓), apoi{' '}
            {SHORT_STOPS} (unde este afișat), apoi {SPEED} și la final {UNASSIGNED}. Exemplu (test): grupele KLP, STP, ARZ → KLP, STP, ARZ,{' '}
            {SHORT_STOPS}, {SPEED}, {UNASSIGNED}.
          </li>
          <li>
            <b>Paginile Asakai</b> (Asakai weekly, Asakai detail) nu arată ziua de <b>azi</b>, ziua lucrătoare a sistemului: ziua nu s-a
            încheiat, așa că datele parțiale încărcate în timpul ei ar face greșite OEE-ul și ponderile pierderilor. Ultima zi pe ambele pagini este
            ieri (caseta de dată nu poate merge mai departe), iar săptămâna și luna în curs sunt suma zilelor dinaintea zilei de azi — un
            rând Weekly / Monthly KPI încărcat care acoperă ziua de azi nu este folosit. Fiecare pagină arată și <b>toate centrele de lucru ale centrului
            de cost</b> (Machines → cost center), chiar și unul fără date în ziua sau săptămâna selectată: rândul lui rămâne gol.
          </li>
          <li>
            O pondere a pierderilor poate depăși 100 % din Loading când Loading-ul din MES al unei ture este mai scurt decât timpul turei − opririle planificate (de ex.
            21.09 PRS-104 tura 1: Loading 185,7 + planificat 209,3 = 395 din 480 min, opriri neplanificate înregistrate 191,5 min = 103 %).
            Opririle sunt numărate așa cum au fost înregistrate; Loss Bridge arată surplusul ca „{OVER_RECORDED}”.
          </li>
        </ul>
      </section>

      <section id="raw-mrp" className="mt-8 max-w-5xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Necesarul de materie primă (MRP) — independent de plan</h2>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-muted-foreground">
          <li>Cererea: ZPP până la ultima lui săptămână; restanța intră în săptămâna curentă.</li>
          <li>
            Stocul de produse finite (locațiile bifate <i>Finished goods</i> în Storage Locations) se scade
            pe piesă, începând cu cele mai apropiate săptămâni. Ce rămâne trebuie ștanțat: o piesă al cărei stoc acoperă 3
            săptămâni nu are nevoie de oțel în acele 3 săptămâni.
          </li>
          <li>
            Oțelul: bucăți × greutatea brută pe bucată. O pereche de coproduse se ștanțează o singură dată — cursele sunt
            cel mai mare dintre cele două necesare — și contează doar greutatea piesei principale.
          </li>
          <li>
            Planul de producție <b>nu se adaugă</b>: producția lui anticipată și surplusul de bobine întregi sunt
            aceeași cerere, doar programată și rotunjită diferit. Adunarea lor ar comanda același oțel de două ori.
            Stocul de siguranță absoarbe diferența.
          </li>
          <li>
            Aprovizionarea: stocul de bobine existent în locațiile bifate <i>Raw material</i>
            plus lista de tranzit, fiecare cantitate în săptămâna ei ETA (fără ETA sau cu ETA trecut = săptămâna aceasta).
          </li>
          <li>
            Săptămână cu săptămână: stocul de la începutul săptămânii + sosirile + o comandă trebuie să acopere consumul
            acelei săptămâni <b>și</b> consumul celor N <b>zile lucrătoare</b> de după sfârșitul săptămânii — cu 10 zile, fiecare
            sfârșit de săptămână acoperă următoarele 2 săptămâni. Altfel, în acea săptămână este necesară o comandă: deficitul +
            suplimentul standard (implicit 500 kg).
          </li>
          <li>Fără cerere, fără comandă: după ultima săptămână din ZPP necesarul este zero; nu se prognozează nimic (kanbanul vine mai târziu).</li>
          <li>
            Un rând este o <b>bobină</b>, nu o piesă: fiecare piesă ștanțată din ea își adaugă necesarul, iar o
            pereche de coproduse are nevoie de oțel când oricare dintre părți are nevoie. Deschideți un rând pentru a-l vedea <b>pe produs
            finit</b> — stocul de produse finite al fiecărei piese, săptămânile pe care le acoperă și săptămâna în care oțelul ei este necesar
            prima dată — și de ce prima comandă cade în săptămâna ei. O comandă într-o săptămână fără consum propriu
            este fereastra de siguranță: consumul următoarelor N zile lucrătoare (o săptămână cu sărbători ajunge mai departe).
          </li>
          <li>
            <b>Order by</b>: o comandă trebuie să sosească până în lunea săptămânii de livrare, deci se plasează
            cel târziu în acea zi de luni − <b>termenul de aprovizionare în zile calendaristice</b> al bobinei (weekendurile și
            sărbătorile se numără — furnizorul indică zile calendaristice). Fiecare bobină are propriul termen de aprovizionare în Raw
            Material Coverage → Lead times; o bobină fără termen folosește valoarea implicită și este marcată{' '}
            <i>not entered</i>. O dată deja trecută este <b>întârziată</b> (roșu), o dată din săptămâna curentă este
            galben-portocalie. Termenul de aprovizionare doar datează comanda: nu mută săptămâna de livrare, stocul de
            siguranță sau planul de producție.
          </li>
          <li>
            Acum: N = {current.rawCoverage} zile lucrătoare, supliment = {current.rawExtra.toLocaleString('en-GB')} kg, termen
            de aprovizionare implicit {current.rawLeadDefault} zile calendaristice ({current.rawLeadEntered} bobină(e) cu termen propriu). Zilele
            lucrătoare sunt zilele lucrătoare ale fabricii (nu sărbători, cel puțin un centru de lucru cu ture normale).
          </li>
        </ol>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">FMEA — ce poate merge prost și cum protejează metoda</h3>
        <div className="mt-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Mod de defectare</th>
                <th className="px-2 py-1.5 font-medium">Efect</th>
                <th className="px-2 py-1.5 font-medium">S</th>
                <th className="px-2 py-1.5 font-medium">O</th>
                <th className="px-2 py-1.5 font-medium">D</th>
                <th className="px-2 py-1.5 font-medium">RPN</th>
                <th className="px-2 py-1.5 font-medium">Măsura din metodă</th>
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
          S = severitate, O = apariție, D = detecție (1–10); evaluările sunt cele dinaintea măsurii.
          Oțelul deja comandat, dar încă neexpediat este cunoscut doar când se află pe lista de tranzit;
          țineți această listă la zi.
        </p>
      </section>

      <section id="check" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-sky-200 bg-sky-50/60 p-4">
        <h2 className="text-sm font-semibold text-foreground">Verificarea independentă — este planul cu adevărat corect?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Verificarea planului de mai sus renumără cifrele proprii ale motorului.{' '}
          <b>Verificarea independentă</b> este un cod separat care nu are nimic în comun cu
          planificatorul. După fiecare calcul, ea:
        </p>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-sm text-muted-foreground">
          <li>
            <b>Reia stocul oră cu oră</b> din fișierele SAP (ZPP, ZPP_DAILY,
            MB52 în locațiile Finished goods) și din lucrările planificate: fiecare zi de necesar are termen la{' '}
            {current.cutoff}, producția sosește pe măsură ce este ștanțată. Fiecare moment în care
            stocul scade sub zero este o oprire reală la client. Lista de întârzieri trebuie
            să corespundă exact — o piesă ratată de motor sau o alarmă falsă este
            afișată. Regula ei proprie pentru ZPP_DAILY: când lipsește doar cantitate din ZPP-ul săptămânal (pe termen lung),
            aceasta este numărată ca deficit pe termen lung, nu ca oprire
            la client.
          </li>
          <li>
            <b>Întreabă „ar fi putut vreun plan să o evite?”</b> pentru fiecare piesă deficitară: există
            suficient timp de centru de lucru înainte de termen pe centrele ei de lucru, chiar
            singură? Pot echipa de setup și podurile rulante din hală să facă până atunci toate setup-urile
            necesare? Răspunsul este „Nu” (dovedit prin capacitate), „Da” (a existat un interval
            liber) sau „nedovedit”. Dă și numărul minim dovedit de
            piese deficitare sub care niciun plan nu poate coborî.
          </li>
          <li>
            <b>Reverifică fiecare regulă</b> pe ceasul real: două lucrări pe un centru de lucru,
            o matriță pe două centre de lucru (și peste noapte), două setup-uri într-o hală (și
            peste ora 07:00), setup-urile la nivelul fabricii, centrul de lucru eligibil, timpul de lucru și
            mentenanța, bobine întregi / Min. lot, fereastra de aducere înainte, o schimbare de matriță
            fără setup, restanța înaintea urgentelor și, pe un centru de cost cu plan de operatori, faptul că
            echipele liniilor în funcțiune se încadrează în operatorii introduși pentru acea tură.
          </li>
          <li id="component-ready">
            <b>Avertizează când o piesă intermediară nu este gata</b> (informativ — nu este o regulă încălcată,
            planul rămâne „OK”): când codul de <i>materie primă</i> al unei piese este codul altei piese
            (sudură de piulițe ← piesa ștanțată pe care se sudează), acea piesă ștanțată este componenta ei, 1 buc pe
            buc. La sfârșitul fiecărei rulări a lucrării de sudură de piulițe, stocul componentei (toate
            locațiile) plus ce s-a produs până atunci trebuie să acopere ce s-a consumat până atunci. Exemplu:
            100 în stoc, 100 ștanțate până la 09:00, sudura de piulițe consumă 300 până la 11:00 → „necesită 300 buc, 200
            disponibile”. Motorul <b>nu</b> planifică această legătură: fiecare linie este încă planificată
            separat, iar cererea proprie a clientului pentru componentă nu face parte din acest calcul.
          </li>
          <li>
            <b>Măsoară eficiența</b>: setup-urile față de minimul posibil,
            timpul de producție față de maximul posibil și de unde vine timpul
            nefolosit — lipsă de lucru, încă nepermis sau așteptarea echipei de setup.
          </li>
          <li>
            <b>Semnalează datele de verificat</b> pentru piesele deficitare: stoc în alte locații
            (nebifate Finished goods), valori pozitive în ZPP, restanță mai mică decât stocul, un fișier de stoc
            vechi, master data lipsă.
          </li>
        </ol>
      </section>

      <section id="alarms" className="mt-8 max-w-4xl scroll-mt-20 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Alarme — matrițe și utilaje</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Urmărirea matrițelor și a utilajelor are propriile module. PlanningExpert
          păstrează doar ce contează pentru plan, în pagina{' '}
          <Link to="/alarms" className="underline">
            Alarms
          </Link>
          , în două liste:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <b className="text-foreground">Holding up the plan</b> — o matriță nu este
            gata, nu are dată de disponibilitate, are o alarmă de limită de lovituri sau este în
            mentenanță, ori un centru de lucru este oprit sau în mentenanță, <b className="text-foreground">și</b>{' '}
            stocul unei piese se epuizează înainte ca acestea să fie disponibile (sau lucrarea ei este întârziată
            ori nu poate fi planificată). Exemplu: matrița gata poimâine la
            10:00, 1 000 de piese de livrat mâine.
          </li>
          <li>
            <b className="text-foreground">For information</b> — indisponibil,
            dar stocul ține până la revenire sau nu există cerere în
            orizont. Planificatorul trebuie să știe; nimic nu este întârziat.
          </li>
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Când se recalculează?</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
          <li>La câteva secunde după orice modificare a datelor lui (o încărcare, o setare, o regulă).</li>
          <li>În fiecare oră, pentru că orele care trec se scad din capacitatea zilei de azi.</li>
          <li>
            De fiecare dată când apăsați <b>Recalculate now</b> în{' '}
            <Link to="/planlama" className="underline hover:no-underline">
              Production Plan
            </Link>
            .
          </li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          <b className="text-foreground">Approve plan</b> salvează planul așa cum este.
          Planul aprobat este baza pentru zilele înghețate și pentru
          lista „changes since the approved plan”.
        </p>
      </section>
    </div>
  )
}

// ---- Tek kaynak: her bilgi nerede tanımlanır -------------------------------

const SOURCES: [string, string, string, string][] = [
  ['Centre de lucru, hale, categorii', 'Work Center Definitions', '/makineler', 'Work Calendar, Capacity Dashboard, ore suplimentare, Gantt, regulile de setup și de pod rulant'],
  ['Calendarul centrului de lucru și orele suplimentare', 'Work Calendar', '/takvim', 'Planul, Capacity Dashboard (aceeași înregistrare), Performance'],
  ['Opriri planificate, sărbători, setări', 'Work Calendar', '/takvim', 'Planul, capacitatea, zilele lucrătoare pentru materia primă'],
  ['Piese, centre de lucru pe piesă, Accepted OEE', 'Master Data', '/referanslar', 'Planul, Capacity Dashboard B, materia primă'],
  ['Ce stoc se numără', 'Storage Locations', '/depolar', 'Planul, materia primă, Capacity Dashboard, producția MB51'],
  ['Cerere, stoc, mișcări, în tranzit', 'SAP Data', '/sapdata', 'Planul, materia primă, Actuals, Performance'],
  ['Prediction OEE', 'Capacity Dashboard', '/capacity', 'Doar acea vedere din dashboard'],
  ['Factor de capacitate', 'Performance', '/performans', 'Capacitatea planului'],
  ['Disponibilitatea și mentenanța matrițelor', 'Die Follow-up', '/die-followup/maintenance', 'Planul, Alarms'],
  ['Defecțiuni și mentenanța centrelor de lucru', 'Machine Follow-up', '/machine-followup/breakdowns', 'Planul, Alarms'],
]

function SingleSource() {
  return (
    <section className="mt-6 max-w-5xl rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">O singură sursă pentru fiecare dată de intrare</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Fiecare valoare se introduce într-un singur loc; fiecare pagină și planul citesc aceeași înregistrare, așa că
        același număr nu diferă niciodată între pagini. Nimic nu este scris direct în cod — grupele, de exemplu,
        vin din categoria centrului de lucru.
      </p>
      <div className="mt-2 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Ce</th>
              <th className="px-2 py-1.5 font-medium">Definit în</th>
              <th className="px-2 py-1.5 font-medium">Folosit de</th>
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
        {note ?? `ar termina la ${finish}`}
        {chosen && ' ✓ ales'}
      </span>
    </div>
  )
}

function Synoptic({ safetyDays }: { safetyDays: number }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-foreground">Algoritmul de planificare — dintr-o privire</h2>
      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        <div>
          <Box tone="border-border bg-muted/50 text-foreground" title="1 · O singură listă cu toate loturile de produs">
            Cererea minus stocul, rotunjită la bobine întregi (sau până la Min. lot, când
            acesta este setat; niciodată mai puțin); o pereche
            de coproduse este un singur lot. Fiecare lot primește două date
            din stocul proiectat: ziua în care stocul s-ar epuiza și cu{' '}
            {safetyDays} zi(le) lucrătoare înainte — cel mai devreme moment în care poate începe.
          </Box>
          <Down label="sortată o singură dată" />
          <Box tone="border-border bg-muted/50 text-foreground" title="2 · Sortarea listei">
            Mutate în față → Restanță → Urgente (deja sub stocul de siguranță) →
            Umplere. Același grup: stocul care se epuizează primul merge primul. Tot
            egal → merge prima piesa cu cele mai puține centre de lucru eligibile.
          </Box>
          <Down label="se ia următorul element de sus" />
          <Box tone="border-sky-300 bg-sky-50 text-sky-950" title="3 · Se încearcă FIECARE centru de lucru permis">
            Fără bifa Flexible work center → doar centrul de lucru principal (calitate). Cu bifă →
            centrul de lucru principal și toate alternativele (de ex. 104, 105, 108, 110). Pe fiecare
            dintre ele se caută cel mai devreme interval liber care respectă toate regulile: sfârșitul
            turelor, podul rulant, matrița, mentenanța.
          </Box>
          <Down label="fiecare centru de lucru dă o oră de terminare" />
          <Box tone="border-emerald-300 bg-emerald-50 text-emerald-950" title="4 · Se alege centrul de lucru care termină primul">
            Nu „primul centru de lucru din listă” și nu „centrul de lucru principal” — ci
            cel pe care lucrarea este gata cel mai repede. Când nimic nu este urgent, câștigă
            continuarea matriței montate (fără setup).
          </Box>
          <Down label="se rezervă" />
          <Box tone="border-border bg-muted/50 text-foreground" title="5 · Rezervarea intervalului">
            Timpul acelui centru de lucru, intervalele podului rulant și matrița sunt acum ocupate pentru
            toate elementele care urmează.
          </Box>
          <Down label="înapoi la 3 cu următorul element, până se golește lista" />
          <Box tone="border-amber-300 bg-amber-50 text-amber-950" title="6 · Ceva întârziat? → se planifică din nou">
            O lucrare care începe după epuizarea stocului oprește clientul. Loturile
            întârziate sunt mutate în față (încearcă din nou fiecare centru de lucru) și își pot
            suprapune setup-ul cu altul. Bobinele nu sunt niciodată tăiate. Până la 6
            runde; se păstrează cel mai bun plan.
          </Box>
          <Down label="ce este încă întârziat sau nu încape" />
          <Box tone="border-destructive/40 bg-destructive/10 text-foreground" title="Late jobs / Unplanned">
            Afișate cu roșu în Production Plan, cu centrele de lucru încercate și
            ce ar rezolva problema.
          </Box>
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-foreground">Exemplu — decizia #12</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Piesa A are restanță, are bifa Flexible work center și poate rula pe 104
            (principal), 105 și 108. Unsprezece
            lucrări sunt deja rezervate. Gri = deja rezervat, colorat = unde ar
            merge A.
          </p>
          <div className="mt-3 space-y-2">
            <Lane press="104" busy={58} job={22} finish="Ma 11:30" />
            <Lane press="105" busy={30} job={22} finish="Lu 23:30" chosen />
            <Lane press="108" busy={100} note="plin până la sfârșitul orizontului" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            A merge pe <b className="text-foreground">105</b>, deși 104 este
            centrul ei de lucru principal, pentru că 105 o termină cu o tură și jumătate
            mai devreme. În Production Plan, lista de lucrări arată exact acest
            rând pentru fiecare lucrare, în coloana <b className="text-foreground">Why this work center</b>
            :
          </p>
          <p className="mt-2 rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
            #12 104 Ma 11:30 · <span className="font-semibold text-emerald-700">105 ✓ Lu 23:30</span> · 108 (plin până la sfârșitul orizontului)
          </p>

          <p className="mt-4 text-sm font-semibold text-foreground">Ce înseamnă asta pentru întrebarea dumneavoastră</p>
          <ul className="mt-1 ml-5 list-disc space-y-1 text-xs text-muted-foreground">
            <li>
              O piesă nu este niciodată trecută pe un centru de lucru doar pentru că este prima într-o
              listă. Fiecare lucrare este comparată pe toate centrele ei de lucru în momentul
              în care este plasată.
            </li>
            <li>
              O piesă restantă poate ajunge a 4-a pe 104 doar dacă în acel moment 105,
              108 și 110 nu ar fi putut-o termina mai devreme. Rândul lucrării o
              dovedește.
            </li>
            <li>
              Motorul decide o lucrare pe rând și nu mută niciodată o lucrare pe care a
              rezervat-o deja. Două consecințe sunt listate mai jos, la{' '}
              <a href="#limits" className="underline">
                Limite cunoscute
              </a>
              .
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Cum verificați planul fără să-l renumărați</h3>
          <ol className="mt-2 ml-5 list-decimal space-y-1 text-xs text-muted-foreground">
            <li>
              <b className="text-foreground">Plan check</b> (pagina Production Plan): după
              fiecare calcul, un cod de verificare separat de motor parcurge
              din nou fiecare lucrare și verifică fiecare regulă — piesele care nu sunt
              flexibile doar pe centrul lor de lucru principal, o singură lucrare pe centru de lucru
              la un moment dat, alegerea celui mai devreme centru de lucru, intervalele podului rulant, setup-urile simultane în
              fabrică, doar bobine întregi, o matriță pe un singur centru de lucru, mentenanța, niciun lot
              înaintea ferestrei lui de aducere înainte, nimic în trecut. O regulă încălcată
              apare cu roșu, cu numele lucrării.
            </li>
            <li>
              <b className="text-foreground">Why this work center</b> (lista de lucrări): alegeți orice lucrare
              de care vă îndoiți și citiți-i decizia: numărul ei de ordine și
              ora de terminare pe fiecare centru de lucru eligibil.
            </li>
            <li>
              <b className="text-foreground">Teste automate</b>: înainte ca orice modificare să intre în producție,
              motorul planifică 40 de fabrici generate aleatoriu (hale progresive și
              transfer, piese unice și comune, mentenanță, opriri), iar
              aceleași verificări trebuie să găsească zero reguli încălcate. Cazul dumneavoastră 104/105 și
              cazul de bobine 1 000 / 2 000 / 6 000, ziua de vânzare de miercuri și
              reparațiile lucrărilor întârziate sunt și ele teste.
            </li>
          </ol>
        </div>

        <div id="limits" className="scroll-mt-20 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-950">Limite cunoscute</h3>
          <p className="mt-1 text-xs text-amber-900">
            Motorul plasează lucrările una după alta. Astfel, fiecare decizie poate fi
            explicată, dar nu este o căutare prin toate planurile posibile:
          </p>
          <ul className="mt-2 ml-5 list-disc space-y-1 text-xs text-amber-900">
            <li>
              O lucrare rezervată nu este niciodată mutată. Plasarea întâi a pieselor cu mai puține centre de lucru
              eligibile, la prioritate egală, previne majoritatea cazurilor
              în care o piesă flexibilă ia locul unei piese cu un singur centru de lucru, dar nu
              pe toate.
            </li>
            <li>
              Elementele egale în toate privințele — grup, zi de epuizare a stocului și număr de
              centre de lucru — păstrează ordinea rândurilor din fișierul ZPP.
            </li>
            <li>
              Pentru că o bobină nu este niciodată tăiată, o săptămână supraîncărcată se poate încheia cu o lucrare
              întârziată pe care o jumătate de bobină ar fi salvat-o. Acest lucru este intenționat: soluția
              este capacitatea (ore suplimentare în Capacity Dashboard) sau alt centru de lucru.
            </li>
            <li>
              După ultima zi din ZPP_DAILY există doar totaluri săptămânale, așa că
              acele săptămâni sunt distribuite uniform pe zilele lucrătoare ale fabricii (nu sărbători și cu cel
              puțin un centru de lucru cu ture normale). Cu ZPP_DAILY încărcat, ele sunt
              loturi pe termen lung: dacă capacitatea este consumată de loturile zilnice, ele rămân
              neplanificate, în loc să întârzie un lot zilnic.
            </li>
            <li>
              Replanificarea pentru eliminarea întârzierilor este un set de încercări, nu o căutare
              completă: dacă 6 runde nu pot elimina o lucrare întârziată, soluția este capacitatea
              (ore suplimentare, alt centru de lucru) — planul o spune.
            </li>
            <li>
              Între un plan aprobat și următoarea încărcare MB52, motorul
              presupune că lucrările aprobate au fost produse conform planului.
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
  const names = ['Lu', 'Ma', 'Mi', 'Jo', 'Vi']
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
        Exemplu — când se produce următoarea bobină?
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Restanță 1 000, 2 000 pe săptămână, fără stoc, o bobină = 6 000 buc. Prima
        bobină se ștanțează luni, 14 septembrie. Barele = stocul proiectat la
        sfârșitul fiecărei zile.
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
              title={`${d.stock} buc`}
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
          Prima bobină acoperă restanța, săptămâna aceasta, săptămâna viitoare și 1 000 din
          săptămâna de după.
        </li>
        <li>
          Stocul se epuizează în <b className="text-destructive">{days[stockout].label}</b>{' '}
          (roșu). Cu {safetyDays} zi(le) de stoc de siguranță, următoarea bobină poate începe
          de la <b className="text-amber-700">{days[start].label}</b> (galben-portocaliu) — nu
          imediat după prima bobină și nu după ce stocul s-a terminat.
        </li>
        <li>
          Dacă centrul de lucru este ocupat atunci, lucrarea se mută mai târziu; dacă începe după{' '}
          {days[stockout].label}, este marcată ca întârziată.
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
      <b className="!text-emerald-900">Exemplu. </b>
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
      <b>Planul de operatori</b> (un al doilea model de planificare pe centru de cost, de ex. liniile APR, de sudură în puncte și de sudură
      de piulițe; ales în Company settings → cost center → <b>Planning model</b>). Liniile unui astfel de
      centru de cost nu rulează doar după calendarul lor: în Production Plan, <b>Operators per
      shift</b> preia câți operatori lucrează în fiecare zi și tură, iar fiecare linie are o <b>echipă</b>{' '}
      (operatorii necesari pentru a o rula o tură, 1 dacă nu este setat; se introduce în Work Calendar → Capacity
      overview, nu în Production Plan). Înainte de construirea capacității, pentru fiecare
      zi și tură pe rând, liniile care mai au de lucru cu termen în această săptămână (până duminică) sunt sortate
      după <b>cel mai apropiat termen</b> (la egalitate: întâi cele cu mai multe minute rămase) și deschise cât timp
      echipa lor încape în operatorii rămași. Lucrul = cantitatea netă a lotului × minute pe bucată pe
      centrul de lucru principal al piesei, aceleași loturi pe care le planifică motorul. Fiecare tură care rulează (deschisă sau
      din calendar) își scade minutele nete din lucrul liniei, deci o linie al cărei lucru este terminat —
      sau al cărei lucru rămas este doar pentru săptămâna viitoare — nu primește operator. O zi și o tură fără
      număr de operatori păstrează calendarul; o sărbătoare păstrează calendarul; o <b>înregistrare de zi setată
      manual are întotdeauna prioritate</b>, iar echipa ei se ia întâi din numărul de operatori. Rezultatul ajunge la
      motor ca înregistrări de zi, deci secvențierea, setup-urile și regulile pentru lucrările întârziate rămân neschimbate. Exemplu:{' '}
      {decision.operators} operatori, {lines.length} linii cu echipă de 1, {noWork.join(', ')}{' '}
      fără lucru: {decision.open.join(', ')} rulează ({ex.workload.find((w) => w.press === decision.open[1])?.minutes} și{' '}
      {ex.workload.find((w) => w.press === decision.open[2])?.minutes} min au termen în aceeași zi, deci cea mai mare merge prima),{' '}
      {closed.join(', ')} așteaptă (nu a mai rămas niciun operator), iar {noWork.join(', ')} rămâne închisă.
      <br />
      <b>Utilajele numără {OPERATOR_SHIFTS_PER_DAY} ture în fiecare zi lucrătoare.</b> Pentru o linie a unui
      centru de cost cu plan de operatori nu se citesc șablonul centrului de lucru și săptămânile de excepție: fiecare
      zi lucrătoare din Work Calendar înseamnă {OPERATOR_SHIFTS_PER_DAY} ture (la fel în plan, Work Calendar,
      Capacity dashboard, Performance și Plan check); operatorii decid ce linii rulează.
      Înregistrările de zi și orele suplimentare cu dată se aplică în continuare.
      <br />
      <b>Operators per week</b> (Work Calendar → Capacity overview, alegeți centrul de cost): câte
      persoane lucrează în săptămână, nu pe tură. Într-o zi lucrătoare fără număr de operatori pe tură,
      planul folosește ⌊săptămânal ÷ {OPERATOR_SHIFTS_PER_DAY}⌋ operatori în fiecare dintre cele{' '}
      {OPERATOR_SHIFTS_PER_DAY} ture (grila pe tură, pentru primele două săptămâni, are întotdeauna prioritate).
      Capacity dashboard plafonează săptămâna la min(utilaje × {OPERATOR_SHIFTS_PER_DAY} × zile
      lucrătoare, operatori săptămânali ÷ echipa medie × zile lucrătoare) ture; fără un număr săptămânal, capacitatea este
      utilaje × {OPERATOR_SHIFTS_PER_DAY} × zile lucrătoare. Exemplu: {weekly.machines} linii cu echipe de{' '}
      {OPERATOR_WEEKLY_EXAMPLE.crewSizes.join(', ')} (medie {weekly.avgCrew}),{' '}
      {OPERATOR_WEEKLY_EXAMPLE.workingDays} zile lucrătoare, {OPERATOR_WEEKLY_EXAMPLE.weeklyOperators} operatori:
      limita utilajelor {weekly.cap.machineShifts}, limita operatorilor {weekly.cap.operatorShifts} → capacitate{' '}
      {weekly.cap.shifts} ture; într-o zi fără număr pe tură,{' '}
      {shiftHeadcountFromWeekly(OPERATOR_WEEKLY_EXAMPLE.weeklyOperators)} operatori pe tură.
    </li>
  )
}
