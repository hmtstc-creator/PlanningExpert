import { createFileRoute, Link } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/planlama')({
  component: PlanlamaPage,
})

interface DemandRow {
  code: string
  quantity: number
  note?: string
}

interface Job {
  code: string
  coProduct?: string
  quantity: number
  note?: string
  shots: number
  runMinutes: number
  setupMinutes: number
  coilSetupMinutes: number
  rawMaterialCode: string
  assignedMachine: string
  startMinute: number
  endMinute: number
}

function formatMinutes(min: number, capacityPerDay: number) {
  const days = Math.floor(min / capacityPerDay)
  const rest = min % capacityPerDay
  const h = Math.floor(rest / 60)
  const m = Math.round(rest % 60)
  if (days > 0) return `${days} gün ${h}s ${m}dk`
  return `${h}s ${m}dk`
}

function PlanlamaPage() {
  const { results: products, status } = usePaginatedQuery(api.products.list, {}, { initialNumItems: 300 })
  const { results: craneGroups } = usePaginatedQuery(api.craneGroups.list, {}, { initialNumItems: 50 })
  const { results: weeklyDemand } = usePaginatedQuery(api.demand.listWeekly, {}, { initialNumItems: 300 })
  const { results: stockRows } = usePaginatedQuery(api.stock.list, {}, { initialNumItems: 500 })
  const { results: locations } = usePaginatedQuery(api.storageLocations.list, {}, { initialNumItems: 100 })
  const calendar = useQuery(api.workCalendar.get)

  const [demand, setDemand] = useState<DemandRow[]>([])
  const [selectedCode, setSelectedCode] = useState('')
  const [quantity, setQuantity] = useState('')
  const [highRunnerThreshold, setHighRunnerThreshold] = useState('1500')
  const [batchSplit, setBatchSplit] = useState('2')
  const [plan, setPlan] = useState<{
    byMachine: Record<string, Job[]>
    craneTimelines: Record<string, Job[]>
    skipped: string[]
  } | null>(null)

  const capacity = calendar?.shiftMinutesPerDay ?? 480

  const productByCode = useMemo(() => new Map(products.map((p) => [p.code, p])), [products])

  const machineToGroup = useMemo(() => {
    const map = new Map<string, string>()
    for (const g of craneGroups) {
      for (const m of g.machines) if (!map.has(m)) map.set(m, g.groupName)
    }
    return map
  }, [craneGroups])

  const locCategory = useMemo(
    () => new Map(locations.map((l) => [l.code, l.category])),
    [locations],
  )

  // Sadece "planlamaya dahil" depolardaki stok sayılır.
  const stockByMaterial = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of stockRows) {
      const cat = s.storageLocation ? locCategory.get(s.storageLocation) ?? 'available' : 'available'
      if (cat !== 'available') continue
      map.set(s.material, (map.get(s.material) ?? 0) + (s.unrestricted ?? 0))
    }
    return map
  }, [stockRows, locCategory])

  function addDemand() {
    const qty = Number(quantity)
    if (!selectedCode || !qty || qty <= 0) return
    setDemand((prev) => [...prev, { code: selectedCode, quantity: qty }])
    setSelectedCode('')
    setQuantity('')
  }

  function removeDemand(index: number) {
    setDemand((prev) => prev.filter((_, i) => i !== index))
  }

  function autoFillFromZPP() {
    const threshold = Number(highRunnerThreshold) || 0
    const splits = Math.max(1, Number(batchSplit) || 2)
    const newDemand: DemandRow[] = []

    for (const d of weeklyDemand) {
      const product = productByCode.get(d.material)
      if (!product) continue

      const weeklyAvg =
        d.periods.length > 0
          ? d.periods.reduce((s, p) => s + Math.abs(p.qty), 0) / d.periods.length
          : 0
      const isHighRunner = weeklyAvg >= threshold

      const overdue = Math.abs(d.overdue ?? 0)
      const horizonPeriods = isHighRunner ? d.periods.slice(0, 1) : d.periods.slice(0, 2)
      const horizonNeed = horizonPeriods.reduce((s, p) => s + Math.abs(p.qty), 0)
      const grossNeed = overdue + horizonNeed
      const stock = stockByMaterial.get(d.material) ?? 0
      const netNeed = Math.max(0, grossNeed - stock)
      if (netNeed <= 0) continue

      if (isHighRunner && splits > 1) {
        const perBatch = Math.ceil(netNeed / splits)
        for (let i = 0; i < splits; i++) {
          newDemand.push({
            code: d.material,
            quantity: perBatch,
            note: `High Runner — Parti ${i + 1}/${splits}`,
          })
        }
      } else {
        newDemand.push({
          code: d.material,
          quantity: netNeed,
          note: isHighRunner ? 'High Runner' : '2 haftalık parti',
        })
      }
    }

    setDemand(newDemand)
  }

  function buildPlan() {
    const skipped: string[] = []
    const rawJobs = demand
      .map((d) => {
        const product = productByCode.get(d.code)
        if (!product) {
          skipped.push(d.code)
          return null
        }
        const piecesPerShot = product.moldCavities && product.moldCavities > 0 ? product.moldCavities : 1
        const shots = Math.ceil(d.quantity / piecesPerShot)
        const runMinutes = product.spm && product.spm > 0 ? shots / product.spm : 0
        const candidates = [
          product.mainMachine,
          product.altMachine1,
          product.altMachine2,
          product.altMachine3,
          product.altMachine4,
        ].filter((m): m is string => !!m && m.trim() !== '')
        return {
          code: product.code,
          coProduct: product.coProduct,
          quantity: d.quantity,
          note: d.note,
          shots,
          runMinutes,
          setupMinutes: product.setupMinutes ?? 0,
          coilSetupMinutes: product.coilSetupMinutes ?? 0,
          rawMaterialCode: product.rawMaterialCode ?? '',
          candidates,
        }
      })
      .filter((j): j is NonNullable<typeof j> => j !== null)

    const projectedLoad: Record<string, number> = {}
    const jobs: Job[] = rawJobs.map((j) => {
      let assignedMachine = 'Atanmamış'
      if (j.candidates.length > 0) {
        assignedMachine = j.candidates.reduce((best, m) =>
          (projectedLoad[m] ?? 0) < (projectedLoad[best] ?? 0) ? m : best,
        )
        const estimate = j.runMinutes + j.setupMinutes + j.coilSetupMinutes
        projectedLoad[assignedMachine] = (projectedLoad[assignedMachine] ?? 0) + estimate
      }
      return { ...j, assignedMachine, startMinute: 0, endMinute: 0 }
    })

    const byMachine: Record<string, Job[]> = {}
    for (const job of jobs) {
      if (!byMachine[job.assignedMachine]) byMachine[job.assignedMachine] = []
      byMachine[job.assignedMachine].push(job)
    }

    const craneTimelines: Record<string, Job[]> = {}
    const handledMachines = new Set<string>()

    const groupsInPlan = new Map<string, string[]>()
    for (const machine of Object.keys(byMachine)) {
      const group = machineToGroup.get(machine)
      if (group) {
        if (!groupsInPlan.has(group)) groupsInPlan.set(group, [])
        groupsInPlan.get(group)!.push(machine)
      }
    }

    // Vinç kısıtlı gruplar: setup'lar art arda (paylaşılan vinç), üretim paralel
    for (const [groupName, machines] of groupsInPlan.entries()) {
      const combined = machines.flatMap((m) => byMachine[m])
      combined.sort((a, b) => a.rawMaterialCode.localeCompare(b.rawMaterialCode))

      let craneFreeAt = 0
      const machineFreeAt: Record<string, number> = {}
      const previousMaterial: Record<string, string | null> = {}
      for (const m of machines) {
        machineFreeAt[m] = 0
        previousMaterial[m] = null
      }

      for (const job of combined) {
        const m = job.assignedMachine
        const materialChanged = previousMaterial[m] !== null && previousMaterial[m] !== job.rawMaterialCode
        const isFirst = previousMaterial[m] === null
        const setupDuration = job.setupMinutes + (materialChanged || isFirst ? job.coilSetupMinutes : 0)
        const setupStart = Math.max(craneFreeAt, machineFreeAt[m])
        const setupEnd = setupStart + setupDuration
        craneFreeAt = setupEnd
        const runEnd = setupEnd + job.runMinutes
        machineFreeAt[m] = runEnd
        job.startMinute = setupStart
        job.endMinute = runEnd
        previousMaterial[m] = job.rawMaterialCode
        handledMachines.add(m)
      }

      craneTimelines[`${groupName} — vinç paylaşımlı (${machines.join(', ')})`] = combined.sort(
        (a, b) => a.startMinute - b.startMinute,
      )
    }

    for (const machine of Object.keys(byMachine)) {
      if (handledMachines.has(machine)) continue
      const jobsForMachine = byMachine[machine]
      jobsForMachine.sort((a, b) => a.rawMaterialCode.localeCompare(b.rawMaterialCode))
      let cursor = 0
      let previousMaterial: string | null = null
      for (const job of jobsForMachine) {
        const materialChanged = previousMaterial !== null && previousMaterial !== job.rawMaterialCode
        const isFirst = previousMaterial === null
        const setup = job.setupMinutes + (materialChanged || isFirst ? job.coilSetupMinutes : 0)
        job.startMinute = cursor
        cursor += setup + job.runMinutes
        job.endMinute = cursor
        previousMaterial = job.rawMaterialCode
      }
    }

    setPlan({ byMachine, craneTimelines, skipped })
  }

  const dataMissing = weeklyDemand.length === 0 || stockRows.length === 0

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Planlama</h1>
      <p className="mt-2 text-muted-foreground">
        Talebi ZPP'den otomatik oluştur ya da elle ekle. Sistem stoku düşer,
        makine ataması yapar ve vinç kısıtına göre sıralar.
      </p>

      {/* Aktif ayarlar özeti */}
      <div className="mt-6 flex flex-wrap gap-2 text-xs">
        <SettingChip
          label="Vardiya"
          value={calendar ? `${capacity} dk/gün · ${calendar.workingDays.length} gün/hafta` : 'tanımsız (480 dk varsayılan)'}
          to="/takvim"
          warn={!calendar}
        />
        <SettingChip
          label="Depo tanımı"
          value={locations.length > 0 ? `${locations.length} depo tanımlı` : 'tanımsız (hepsi stok sayılıyor)'}
          to="/depolar"
          warn={locations.length === 0}
        />
        <SettingChip
          label="Vinç grubu"
          value={craneGroups.length > 0 ? craneGroups.map((g) => g.groupName).join(', ') : 'tanımsız'}
          to="/planlama"
          warn={craneGroups.length === 0}
        />
      </div>

      {dataMissing && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Planlama için önce{' '}
          <Link to="/siparisler" className="font-medium underline">Siparişler</Link> ve{' '}
          <Link to="/stoklar" className="font-medium underline">Stoklar</Link> sayfalarından
          SAP verilerini yükle.
        </div>
      )}

      {/* Adım 1: Talep oluştur */}
      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">1. Üretim talebini oluştur</h2>

        <div className="mt-4 rounded-md border border-border p-4">
          <p className="text-sm font-medium text-foreground">Otomatik (önerilen)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Gecikmiş + yaklaşan talepten kullanılabilir stok düşülür. Yüksek
            hacimli (High Runner) referanslar partilere bölünür.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground">High Runner eşiği (haftalık ort. adet)</span>
              <input
                type="number"
                className="mt-1 w-32 rounded-md border border-input bg-background px-2 py-1.5"
                value={highRunnerThreshold}
                onChange={(e) => setHighRunnerThreshold(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground">Kaç partiye bölünsün</span>
              <input
                type="number"
                className="mt-1 w-20 rounded-md border border-input bg-background px-2 py-1.5"
                value={batchSplit}
                onChange={(e) => setBatchSplit(e.target.value)}
              />
            </label>
            <button
              onClick={autoFillFromZPP}
              disabled={weeklyDemand.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              ZPP'den doldur
            </button>
          </div>
        </div>

        <details className="mt-3 rounded-md border border-border">
          <summary className="cursor-pointer px-4 py-2.5 text-sm text-muted-foreground">
            Elle referans ekle
          </summary>
          <div className="grid grid-cols-1 gap-2 border-t border-border p-3 sm:grid-cols-[1fr_130px_auto]">
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedCode}
              onChange={(e) => setSelectedCode(e.target.value)}
            >
              <option value="">Referans seç</option>
              {products.map((p) => (
                <option key={p._id} value={p.code}>{p.code}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Adet"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <button
              onClick={addDemand}
              className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/70"
            >
              Ekle
            </button>
          </div>
        </details>

        {demand.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">{demand.length}</strong> üretim kalemi ·{' '}
                {demand.reduce((s, d) => s + d.quantity, 0).toLocaleString('tr-TR')} adet
              </p>
              <button
                onClick={() => setDemand([])}
                className="text-xs text-destructive hover:underline"
              >
                Listeyi temizle
              </button>
            </div>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Referans</th>
                    <th className="px-3 py-2 font-medium">Adet</th>
                    <th className="px-3 py-2 font-medium">Not</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {demand.map((d, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-1.5 text-foreground">{d.code}</td>
                      <td className="px-3 py-1.5 text-foreground">{d.quantity.toLocaleString('tr-TR')}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{d.note ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button className="text-xs text-destructive hover:underline" onClick={() => removeDemand(i)}>
                          Sil
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Adım 2: Plan oluştur */}
      <section className="mt-4 rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">2. Planı oluştur</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Yük dengeli makine ataması + hammadde bazlı sıralama + vinç kısıtı.
        </p>
        <button
          onClick={buildPlan}
          disabled={demand.length === 0 || status === 'LoadingFirstPage'}
          className="mt-3 rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          Plan Oluştur
        </button>
      </section>

      {/* Vinç grupları ayarı */}
      <details className="mt-4 rounded-lg border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm text-muted-foreground">
          Vinç grupları — aynı vinci paylaşan makineler
        </summary>
        <div className="border-t border-border p-4">
          <CraneGroupEditor />
        </div>
      </details>

      {plan && (
        <div className="mt-8 space-y-6">
          <h2 className="text-xl font-semibold text-foreground">Üretim Planı</h2>
          {plan.skipped.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {plan.skipped.length} kalem referans kaydı bulunamadığı için atlandı.
            </p>
          )}
          {Object.entries(plan.craneTimelines).map(([label, jobs]) => (
            <JobTable
              key={label}
              title={label}
              jobs={jobs}
              totalMinutes={jobs.length > 0 ? Math.max(...jobs.map((j) => j.endMinute)) : 0}
              capacity={capacity}
              showMachineColumn
            />
          ))}
          {Object.entries(plan.byMachine)
            .filter(([machine]) =>
              !Object.values(plan.craneTimelines).some((jobs) =>
                jobs.some((j) => j.assignedMachine === machine),
              ),
            )
            .map(([machine, jobs]) => (
              <JobTable
                key={machine}
                title={machine}
                jobs={jobs}
                totalMinutes={jobs.length > 0 ? jobs[jobs.length - 1].endMinute : 0}
                capacity={capacity}
                warn={machine === 'Atanmamış'}
              />
            ))}
        </div>
      )}
    </div>
  )
}

function SettingChip({
  label,
  value,
  to,
  warn,
}: {
  label: string
  value: string
  to: string
  warn?: boolean
}) {
  return (
    <Link
      to={to}
      className={`rounded-full border px-3 py-1.5 transition-colors ${
        warn
          ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
          : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'
      }`}
    >
      <span className="font-medium">{label}:</span> {value}
    </Link>
  )
}

function CraneGroupEditor() {
  const { results: craneGroups } = usePaginatedQuery(api.craneGroups.list, {}, { initialNumItems: 50 })
  const [groupName, setGroupName] = useState('')
  const [groupMachines, setGroupMachines] = useState('')

  return (
    <>
      {craneGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz vinç grubu tanımlanmadı — setup'lar paralel varsayılır.
        </p>
      ) : (
        <ul className="space-y-2">
          {craneGroups.map((g) => (
            <li key={g._id} className="rounded-md border border-border px-3 py-2 text-sm text-foreground">
              <strong>{g.groupName}</strong>: {g.machines.join(', ')}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Grup eklemek/silmek için geliştirici ile iletişime geç ya da mevcut
        tanımları kullan. (Hol 1: PRS-106/107, Hol 2: PRS-104/105/108 tanımlı.)
      </p>
      <input type="hidden" value={groupName + groupMachines} readOnly />
    </>
  )
}

function JobTable({
  title,
  jobs,
  totalMinutes,
  capacity,
  warn,
  showMachineColumn,
}: {
  title: string
  jobs: Job[]
  totalMinutes: number
  capacity: number
  warn?: boolean
  showMachineColumn?: boolean
}) {
  const days = totalMinutes / capacity
  const loadColor = days > 5 ? 'text-red-600' : days > 3 ? 'text-amber-600' : 'text-emerald-600'

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2.5">
        <span className="font-medium text-foreground">
          {title}
          {warn && <span className="ml-2 text-xs text-destructive">(ana makine verisi eksik)</span>}
        </span>
        <span className={`text-sm font-medium ${warn ? 'text-muted-foreground' : loadColor}`}>
          {jobs.length} iş · {formatMinutes(totalMinutes, capacity)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Referans</th>
              {showMachineColumn && <th className="px-3 py-2 font-medium">Makine</th>}
              <th className="px-3 py-2 font-medium">Adet</th>
              <th className="px-3 py-2 font-medium">Vuruş</th>
              <th className="px-3 py-2 font-medium">Üretim</th>
              <th className="px-3 py-2 font-medium">Setup</th>
              <th className="px-3 py-2 font-medium">Başlangıç</th>
              <th className="px-3 py-2 font-medium">Bitiş</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2">
                  <span className="text-foreground">{job.code}</span>
                  {job.coProduct && (
                    <span className="text-muted-foreground"> +{job.coProduct}</span>
                  )}
                  {job.note && (
                    <span className="block text-xs text-muted-foreground">{job.note}</span>
                  )}
                </td>
                {showMachineColumn && <td className="px-3 py-2 text-foreground">{job.assignedMachine}</td>}
                <td className="px-3 py-2 text-foreground">{job.quantity.toLocaleString('tr-TR')}</td>
                <td className="px-3 py-2 text-muted-foreground">{job.shots.toLocaleString('tr-TR')}</td>
                <td className="px-3 py-2 text-foreground">{job.runMinutes.toFixed(0)} dk</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {job.setupMinutes + job.coilSetupMinutes} dk
                </td>
                <td className="px-3 py-2 text-muted-foreground">{formatMinutes(job.startMinute, capacity)}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatMinutes(job.endMinute, capacity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
