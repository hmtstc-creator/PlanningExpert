import { Link } from '@tanstack/react-router'

/** Modül genel bakışındaki sayı kutusu; tıklanınca ilgili sayfaya gider. */
export function ModuleStat({
  label,
  value,
  to,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: number | string
  to?: string
  tone?: 'neutral' | 'warn' | 'critical'
  hint?: string
}) {
  const color =
    tone === 'critical' ? 'text-destructive' : tone === 'warn' ? 'text-amber-700' : 'text-foreground'
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </>
  )
  return to ? (
    <Link to={to} className="block rounded-lg border border-border p-3 hover:bg-muted/50">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-border p-3">{body}</div>
  )
}
