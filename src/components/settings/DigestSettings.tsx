import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { useQuery } from '../../lib/convexTransport'
import { SIGNAL_TYPES, type TodayThresholds } from '../../lib/cockpit'
import { DAY_KEYS, DAY_LABELS, EMPTY_DIGEST, digestProblems, validEmail, type DigestConfig } from '../../lib/digest'
import { usePlant } from '../../lib/plantContext'
import { formatPlantTime } from '../../lib/sapUploads'
import { TODAY_DEFAULTS } from '../../lib/settingsDefaults'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { ErrorBanner } from '../ErrorBanner'
import { InfoTip } from '../PageHeader'

const input = 'rounded-md border border-input bg-background px-2 py-1.5 text-sm'
const btn = 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40'

interface Settings {
  thresholds: TodayThresholds
  saved: Partial<TodayThresholds>
  digest: DigestConfig
  last: { at: number; result: string } | null
  mailConfigured: boolean
  timeZone: string
}

/**
 * Company settings → Today & daily digest (seçili plant): Today panelinin
 * eşikleri ve günlük özet e-postası (kime, hangi gün ve saatte, hangi
 * sinyaller). Kurallar: src/lib/cockpit.ts, src/lib/digest.ts.
 */
export function DigestSettings() {
  const s = useQuery(api.digest.settings) as Settings | undefined
  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>
  return (
    <div className="space-y-6">
      <Thresholds key={JSON.stringify(s.thresholds)} s={s} />
      <Digest key={JSON.stringify(s.digest)} s={s} />
    </div>
  )
}

// ---- Eşikler ----------------------------------------------------------------

const FIELDS: { key: keyof TodayThresholds; label: string; unit: string; hint: string }[] = [
  { key: 'sapStaleHours', label: 'Old SAP data', unit: 'h', hint: 'Demand (ZPP) or stock (MB52) older than this is flagged' },
  { key: 'planStaleHours', label: 'Old plan', unit: 'h', hint: 'The plan is calculated by hand (Planning → Calculate plan); warn when it is older than this' },
  { key: 'overloadPercent', label: 'Over capacity', unit: '%', hint: 'A week whose demand exceeds this share of capacity' },
  { key: 'bottleneckWeeks', label: 'Weeks ahead', unit: 'weeks', hint: 'How many weeks (this one included) the capacity check looks at' },
]

function Thresholds({ s }: { s: Settings }) {
  const { run: save, error, clearError, pending } = useSafeMutation(api.digest.saveThresholds)
  const [d, setD] = useState<Record<keyof TodayThresholds, string>>(
    () => Object.fromEntries(FIELDS.map((f) => [f.key, String(s.thresholds[f.key])])) as Record<keyof TodayThresholds, string>,
  )
  const dirty = FIELDS.some((f) => Number(d[f.key]) !== s.thresholds[f.key])
  return (
    <section className="rounded-lg border border-border p-4">
      <ErrorBanner message={error} onDismiss={clearError} />
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        Today panel — limits of this plant
        <InfoTip label="Today limits">
          <p>The Today panel (portal home, PlanningExpert Overview) and the daily digest flag a signal when these limits are passed.</p>
          <p>An empty box returns to the program's starting value.</p>
        </InfoTip>
      </h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-xs text-muted-foreground" title={f.hint}>
            {f.label} ({f.unit})
            <input
              type="number"
              min={0}
              className={`mt-1 block w-28 ${input}`}
              placeholder={String(TODAY_DEFAULTS[f.key])}
              value={d[f.key]}
              onChange={(e) => setD({ ...d, [f.key]: e.target.value })}
            />
            <span className="mt-0.5 block text-[10px]">{s.saved[f.key] === undefined ? 'starting value' : 'set for this plant'}</span>
          </label>
        ))}
        <button
          className={btn}
          disabled={!dirty || pending}
          onClick={() =>
            void save(Object.fromEntries(FIELDS.map((f) => [f.key, d[f.key].trim() === '' ? undefined : Number(d[f.key])])))
          }
        >
          Save limits
        </button>
      </div>
    </section>
  )
}

// ---- Günlük özet --------------------------------------------------------------

function Digest({ s }: { s: Settings }) {
  const { ctx } = usePlant()
  const { run: save, error, clearError, pending } = useSafeMutation(api.digest.saveDigest)
  const { run: sendTest, error: testError, pending: testing } = useSafeMutation(api.digest.sendTest)
  const users = (useQuery(api.users.list, ctx?.active ? { companyId: ctx.active.companyId } : 'skip') ?? []) as { _id: string; name: string; email?: string; active: boolean }[]
  const preview = useQuery(api.digest.preview) as { subject: string; text: string } | undefined
  const [d, setD] = useState<DigestConfig>(() => ({ ...EMPTY_DIGEST, ...s.digest }))
  const [extra, setExtra] = useState({ to: '', cc: '' })
  const [showPreview, setShowPreview] = useState(false)
  const [testSent, setTestSent] = useState(false)
  useEffect(() => setTestSent(false), [s.last?.at])
  const dirty = JSON.stringify(d) !== JSON.stringify({ ...EMPTY_DIGEST, ...s.digest })
  const problems = digestProblems(d)
  const withEmail = useMemo(() => users.filter((u) => u.active && u.email && validEmail(u.email)), [users])

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const addAddress = (field: 'to' | 'cc') => {
    const a = extra[field].trim().toLowerCase()
    if (!validEmail(a) || d[field].includes(a)) return
    setD({ ...d, [field]: [...d[field], a] })
    setExtra({ ...extra, [field]: '' })
  }

  // Düz işlev (bileşen değil): her çizimde yeni bileşen olsaydı kutu yazarken odağı kaybederdi.
  const recipients = (field: 'to' | 'cc', label: string) => (
    <div className="mt-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {d[field].map((a) => (
          <span key={a} className="flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-1 pl-2 text-xs">
            {users.find((u) => u.email?.toLowerCase() === a)?.name ?? a}
            <span className="text-muted-foreground">{users.find((u) => u.email?.toLowerCase() === a) ? `<${a}>` : ''}</span>
            <button className="px-1 text-destructive" title="Remove" onClick={() => setD({ ...d, [field]: d[field].filter((x) => x !== a) })}>
              ×
            </button>
          </span>
        ))}
        {withEmail.some((u) => !d[field].includes(u.email!.toLowerCase())) && (
          <select
            className={`${input} py-1 text-xs`}
            value=""
            onChange={(e) => e.target.value && setD({ ...d, [field]: [...d[field], e.target.value] })}
          >
            <option value="">+ A user…</option>
            {withEmail
              .filter((u) => !d[field].includes(u.email!.toLowerCase()))
              .map((u) => (
                <option key={u._id} value={u.email!.toLowerCase()}>
                  {u.name} — {u.email}
                </option>
              ))}
          </select>
        )}
        <input
          className={`${input} w-56 py-1 text-xs`}
          placeholder="+ another address"
          value={extra[field]}
          onChange={(e) => setExtra({ ...extra, [field]: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && addAddress(field)}
        />
        <button className="text-xs underline disabled:opacity-40" disabled={!validEmail(extra[field])} onClick={() => addAddress(field)}>
          Add
        </button>
      </div>
    </div>
  )

  return (
    <section className="rounded-lg border border-border p-4">
      <ErrorBanner message={error ?? testError} onDismiss={clearError} />
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Daily digest e-mail
          <InfoTip label="Daily digest">
            <p>
              On the chosen days and time (plant time, {s.timeZone}) the Today signals of this plant go to the recipients: late parts,
              blockers, over-capacity, old data, plan health — the ones you tick below. Each item links to its page.
            </p>
            <p>It goes once a day; if the server was down at that minute, it goes as soon as it is back the same day.</p>
            <p>
              Users appear in the list when they have an e-mail address (Users &amp; permissions). Anyone else can be added by address.
            </p>
          </InfoTip>
        </h3>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />
          {d.enabled ? 'On' : 'Off'}
        </label>
      </div>

      {!s.mailConfigured && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50/70 p-3 text-xs text-amber-950">
          <p className="font-medium">The mail service is not set up yet — nothing will be sent.</p>
          <p className="mt-1">
            The site sends through Resend. The key is not stored in the program: set the Convex environment variables{' '}
            <code>RESEND_API_KEY</code> and <code>DIGEST_FROM</code> (sender, e.g. <code>Production Portal &lt;portal@company.com&gt;</code>), and
            optionally <code>APP_URL</code> for the links in the e-mail. You can set everything here already.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="text-xs text-muted-foreground">
          Time (plant time)
          <input type="time" className={`mt-1 block w-32 ${input}`} value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} />
        </label>
        <div className="text-xs text-muted-foreground">
          Days
          <div className="mt-1 flex gap-1">
            {DAY_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setD({ ...d, days: DAY_KEYS.filter((x) => (x === k ? !d.days.includes(k) : d.days.includes(x))) })}
                className={`rounded-md border px-2 py-1.5 text-xs ${d.days.includes(k) ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-muted-foreground hover:text-foreground'}`}
                aria-pressed={d.days.includes(k)}
              >
                {DAY_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={d.onlyWhenIssues} onChange={(e) => setD({ ...d, onlyWhenIssues: e.target.checked })} />
          Only when there is something to act on
        </label>
      </div>

      {recipients('to', 'To')}
      {recipients('cc', 'Cc')}

      <div className="mt-4">
        <p className="text-xs font-medium text-muted-foreground">Contents {d.signals.length === 0 && '— all signals'}</p>
        <div className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {SIGNAL_TYPES.map((t) => (
            <label key={t.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={d.signals.length === 0 || d.signals.includes(t.key)}
                onChange={() => {
                  const current = d.signals.length === 0 ? SIGNAL_TYPES.map((x) => x.key) : d.signals
                  const next = toggle(current, t.key)
                  setD({ ...d, signals: next.length === SIGNAL_TYPES.length ? [] : next })
                }}
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      {problems.length > 0 && dirty && <p className="mt-3 text-xs text-destructive">{problems.join(' · ')}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className={btn} disabled={!dirty || problems.length > 0 || pending} onClick={() => void save({ digest: d })}>
          Save digest
        </button>
        {dirty && (
          <button className="text-xs underline" onClick={() => setD({ ...EMPTY_DIGEST, ...s.digest })}>
            Discard
          </button>
        )}
        <button className="text-xs underline" onClick={() => setShowPreview(!showPreview)}>
          {showPreview ? 'Hide preview' : 'Preview today’s e-mail'}
        </button>
        <button
          className="text-xs underline disabled:opacity-40"
          disabled={dirty || !s.digest.to.length || !s.mailConfigured || testing}
          title={dirty ? 'Save first' : !s.mailConfigured ? 'The mail service is not set up' : 'Send to the saved recipients now'}
          onClick={() => void sendTest({}).then((ok) => ok && setTestSent(true))}
        >
          Send a test now
        </button>
        {testSent && <span className="text-xs text-emerald-700">Test queued — the result appears below in a moment.</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          {s.last ? `Last: ${formatPlantTime(s.last.at)} — ${s.last.result}` : 'Not sent yet'}
        </span>
      </div>

      {showPreview && preview && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Subject</p>
          <p className="text-sm font-medium text-foreground">{preview.subject}</p>
          <pre className="mt-2 max-h-96 overflow-auto text-xs whitespace-pre-wrap text-foreground">{preview.text}</pre>
          <p className="mt-1 text-[11px] text-muted-foreground">With the saved contents. The e-mail itself is formatted (colours, links).</p>
        </div>
      )}
    </section>
  )
}
