// Planlamacı için alarmlar: hangi kalıp ve hangi makine planı aksatıyor?
//
// İki liste var:
//  - KRİTİK: kalıp ya da makine yüzünden müşteri gecikecek. Örnek: kalıp
//    yarından sonra 10:00'da hazır olacak ama yarın 1000 adet sevk edilmeli
//    — stok o gün biter. Ya da hazır olma tarihi hiç belli değil ve ufukta
//    talep var.
//  - BİLGİ: kalıp/makine kullanılamıyor ama plan aksamıyor (ihtiyaç ondan
//    sonra ya da hiç yok). Planlamacı yine de bilmeli.
//
// Saf fonksiyon: planın sonucu (lotlar, işler, plansızlar) ve kullanılamaz
// kaynakların listesi girer, iki liste çıkar.

export type DieUnavailability =
  | { material: string; kind: 'no-date'; reason?: string }
  | { material: string; kind: 'shot-limit' }
  | { material: string; kind: 'until'; until: string; untilMinute?: number; reason?: string }
  | { material: string; kind: 'maintenance'; from: string; until: string; note?: string }

export interface MachineUnavailability {
  press: string
  kind: 'breakdown' | 'maintenance' | 'fault-running'
  from: string
  /** Yoksa süresiz (arıza çözülene kadar). */
  until?: string
  untilMinute?: number
  label: string
}

export interface AlarmLot {
  material: string
  qty: number
  /** Stoğun bittiği gün. */
  dueDate: string
}

export interface AlarmJob {
  material: string
  press: string
  date: string
  dueDate: string
  late: boolean
  frozen?: boolean
}

export interface AlarmUnplanned {
  material: string
  quantity: number
  dueDate: string
  reason: string
}

export interface DieAlarm {
  material: string
  kind: DieUnavailability['kind']
  /** "Not ready until 2026-09-26 10:00" gibi. */
  label: string
  critical: boolean
  /** İlk stok bitişi (ufukta talep varsa). */
  stockOut?: string
  /** Kalıp açılmadan önce gereken adet. */
  neededBefore: number
  /** Neden kritik / neden değil — tek cümle. */
  explanation: string
}

export interface MachineAlarm {
  press: string
  kind: MachineUnavailability['kind']
  label: string
  from: string
  until?: string
  untilMinute?: number
  critical: boolean
  /** Bu makine yüzünden geç kalan ya da plana alınamayan parçalar. */
  affected: { material: string; stockOut: string; issue: 'late' | 'unplanned' }[]
  explanation: string
}

export interface PlanAlarms {
  dies: DieAlarm[]
  machines: MachineAlarm[]
}

function clock(minute: number | undefined): string {
  if (minute === undefined) return ''
  return ` ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

/** Kalıbın kullanılamaz olduğu son gün; süresizse null. */
function dieUntil(u: DieUnavailability): string | null {
  if (u.kind === 'until' || u.kind === 'maintenance') return u.until
  return null
}

function dieLabel(u: DieUnavailability): string {
  switch (u.kind) {
    case 'no-date':
      return `Not ready — no ready date${u.reason ? ` (${u.reason})` : ''}`
    case 'shot-limit':
      return 'Shot-limit alarm open — held until the alarm is closed'
    case 'until':
      return `Not ready until ${u.until}${clock(u.untilMinute)}${u.reason ? ` (${u.reason})` : ''}`
    case 'maintenance':
      return `Maintenance ${u.from === u.until ? u.from : `${u.from} → ${u.until}`}${u.note ? ` (${u.note})` : ''}`
  }
}

export function buildPlanAlarms(input: {
  todayIso: string
  lots: AlarmLot[]
  jobs: AlarmJob[]
  unplanned: AlarmUnplanned[]
  dies: DieUnavailability[]
  machines: MachineUnavailability[]
  /** Parçanın planlanabileceği presler (esneklik kuralı uygulanmış). */
  eligiblePresses: (material: string) => string[]
}): PlanAlarms {
  const lotsByMaterial = new Map<string, AlarmLot[]>()
  for (const lot of input.lots) {
    if (lot.qty <= 0) continue
    const list = lotsByMaterial.get(lot.material) ?? []
    list.push(lot)
    lotsByMaterial.set(lot.material, list)
  }
  for (const list of lotsByMaterial.values()) list.sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  // Müşteriyi bekletecek her şey: geç başlayan iş ya da hiç yerleşemeyen lot.
  const trouble: { material: string; stockOut: string; issue: 'late' | 'unplanned'; press?: string }[] = [
    ...input.jobs
      .filter((j) => j.late && !j.frozen)
      .map((j) => ({ material: j.material, stockOut: j.dueDate, issue: 'late' as const, press: j.press })),
    ...input.unplanned
      .filter((u) => !u.reason.startsWith('Excluded from planning by the user'))
      .map((u) => ({ material: u.material, stockOut: u.dueDate, issue: 'unplanned' as const })),
  ]

  // ---- Kalıplar -------------------------------------------------------------
  const dies: DieAlarm[] = []
  for (const u of input.dies) {
    if (u.kind === 'maintenance' && u.until < input.todayIso) continue
    const lots = lotsByMaterial.get(u.material) ?? []
    const until = dieUntil(u)
    const before = until === null ? lots : lots.filter((l) => l.dueDate <= until)
    const neededBefore = before.reduce((sum, l) => sum + l.qty, 0)
    const stockOut = lots[0]?.dueDate
    const hurt = trouble.filter(
      (t) => t.material === u.material && (until === null || t.stockOut <= until),
    )

    let critical: boolean
    let explanation: string
    if (u.kind === 'maintenance') {
      // Plan bakım günlerinin etrafından akar; ancak bir lot yine de geç
      // kalıyorsa ya da yerleşemiyorsa bakım müşteriyi bekletiyor demektir.
      critical = hurt.length > 0
      explanation = critical
        ? `A lot needed by ${hurt[0].stockOut} cannot be made in time around the maintenance.`
        : 'The plan works around the maintenance days; no delivery is late.'
    } else if (until === null) {
      critical = lots.length > 0
      explanation = critical
        ? `Stock runs out ${stockOut} and the mould has no date — the customer will wait.`
        : 'No demand in the planning horizon, so the plan is not affected yet.'
    } else {
      critical = before.length > 0 || hurt.length > 0
      explanation = critical
        ? `Stock runs out ${before[0]?.dueDate ?? hurt[0].stockOut}, before the mould is ready — the customer will wait.`
        : stockOut
          ? `Next stock-out ${stockOut}, after the mould is ready.`
          : 'No demand in the planning horizon.'
    }
    dies.push({
      material: u.material,
      kind: u.kind,
      label: dieLabel(u),
      critical,
      stockOut,
      neededBefore,
      explanation,
    })
  }

  // ---- Makineler -------------------------------------------------------------
  const machines: MachineAlarm[] = []
  for (const m of input.machines) {
    if (m.until !== undefined && m.until < input.todayIso) continue
    const affected =
      m.kind === 'fault-running'
        ? []
        : trouble
            .filter(
              (t) =>
                input.eligiblePresses(t.material).includes(m.press) &&
                (m.until === undefined || t.stockOut <= m.until),
            )
            .map(({ material, stockOut, issue }) => ({ material, stockOut, issue }))
    // Aynı parça birden çok lotla gelirse bir kere yeter.
    const unique = Array.from(new Map(affected.map((a) => [a.material, a])).values()).sort((a, b) =>
      a.stockOut.localeCompare(b.stockOut),
    )
    const critical = unique.length > 0
    machines.push({
      press: m.press,
      kind: m.kind,
      label: m.label,
      from: m.from,
      until: m.until,
      untilMinute: m.untilMinute,
      critical,
      affected: unique,
      explanation:
        m.kind === 'fault-running'
          ? 'Fault reported but the press keeps running — the plan still uses it.'
          : critical
            ? `${unique.length} part(s) that can run on ${m.press} will be late or cannot be planned.`
            : m.until === undefined
              ? 'Down until solved, but the plan covers its parts elsewhere or later.'
              : 'The plan works around it; no delivery is late.',
    })
  }

  const order = <T extends { critical: boolean }>(a: T, b: T) => Number(b.critical) - Number(a.critical)
  dies.sort((a, b) => order(a, b) || (a.stockOut ?? '9999').localeCompare(b.stockOut ?? '9999'))
  machines.sort((a, b) => order(a, b) || a.from.localeCompare(b.from))
  return { dies, machines }
}
