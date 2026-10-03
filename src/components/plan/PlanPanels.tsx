import { Link } from '@tanstack/react-router'
import type { PlanAudit } from '../../lib/planAudit'
import type { PlanAlarms } from '../../lib/planAlarms'
import { SAP_UPLOAD_KEYS, SAP_UPLOAD_LABELS, formatPlantTime, type PlanDataSources } from '../../lib/sapUploads'
import { InfoTip } from '../PageHeader'

/** Alarm şeridi, kural denetimi, özet kutusu ve veri satırı (Production Plan). */
export function AlarmBanner({ alarms }: { alarms: PlanAlarms }) {
  const dies = alarms.dies.filter((d) => d.critical).length
  const machines = alarms.machines.filter((m) => m.critical).length
  const info = alarms.dies.length + alarms.machines.length - dies - machines
  if (dies + machines === 0 && info === 0) return null
  return (
    <div
      className={`mt-6 rounded-lg border p-3 text-sm ${
        dies + machines > 0 ? 'border-destructive bg-destructive/10' : 'border-border bg-muted/50'
      }`}
    >
      {dies + machines > 0 ? (
        <strong className="text-destructive">
          {dies > 0 && `${dies} die(s)`}
          {dies > 0 && machines > 0 && ' and '}
          {machines > 0 && `${machines} work center(s)`} holding up deliveries.
        </strong>
      ) : (
        <span className="text-muted-foreground">No die or work center is holding up a delivery.</span>
      )}{' '}
      {info > 0 && <span className="text-muted-foreground">{info} more for information. </span>}
      <Link to="/alarms" className="font-medium text-foreground underline">
        See Alarms →
      </Link>
    </div>
  )
}

/**
 * Geç işler: stok bittikten sonra başlayan iş müşteriyi durdurur. Motor bunu
 * bırakmadan önce planı yeniden kurar; burada ne denendiği ve kalan her geç
 * iş için ne yapılabileceği yazar.
 */

export function PlanCheck({ audit, jobCount }: { audit: PlanAudit; jobCount: number }) {
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        audit.ok ? 'border-emerald-200 bg-emerald-50/60' : 'border-destructive bg-destructive/10'
      }`}
    >
      <h2 className="text-sm font-semibold text-foreground">
        Plan check {audit.ok ? '— all rules hold' : '— rules broken, do not approve'}{' '}
        <InfoTip label="About the plan check">
          After every calculation, separate checking code goes through all{' '}
          {jobCount.toLocaleString('en-GB')} jobs again and verifies each rule on its own. You do not
          need to recount the plan by hand. See <Link to="/planlogic">Planning Logic</Link>.
        </InfoTip>
      </h2>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {audit.rules.map((r) => (
          <li key={r.id}>
            <span className={r.violationCount === 0 ? 'text-emerald-700' : 'text-destructive'}>
              {r.violationCount === 0 ? '✓' : '✗'}
            </span>{' '}
            <span className="text-foreground">{r.label}</span>{' '}
            <span className="text-xs text-muted-foreground">
              ({r.checked.toLocaleString('en-GB')} checked
              {r.violationCount > 0 ? `, ${r.violationCount} broken` : ''})
            </span>
            {r.violations.length > 0 && (
              <ul className="ml-5 list-disc text-xs text-destructive">
                {r.violations.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warn ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}

/** Planın hesaplandığı SAP dosyaları — hangi veriyle çalıştığı açık olsun. */
export function PlanDataLine({ sources }: { sources: PlanDataSources | undefined }) {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Calculated with: </span>
      {sources === undefined
        ? 'file details are recorded from the next calculation on'
        : SAP_UPLOAD_KEYS.map((key, i) => {
            const source = sources[key]
            return (
              <span key={key}>
                {i > 0 && ' · '}
                {SAP_UPLOAD_LABELS[key].split(' — ')[1]}{' '}
                {source
                  ? `${source.fileName ?? 'file'} (${formatPlantTime(source.uploadedAt)})`
                  : 'not uploaded'}
              </span>
            )
          })}{' '}
      <Link to="/sapdata" className="underline hover:text-foreground">
        SAP Data →
      </Link>
    </p>
  )
}
