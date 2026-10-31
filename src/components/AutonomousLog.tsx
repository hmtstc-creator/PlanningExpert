import { api } from '../../convex/_generated/api'
import kayit from '../data/otonom-gunluk.json'
import { useQuery } from '../lib/convexTransport'
import { useSafeMutation } from '../lib/useSafeMutation'

/** Otonom döngünün saatlik kaydı (scripts/otonom/gunluk.mjs yazar, wiki 13). */
export type OtonomKart = {
  zaman: string
  odak: string
  ozet: string
  durum: string
  gorevler: { baslik: string; once: string; sonra: string; dosyalar?: string[] }[]
  oneriler: string[]
}

/** "20261030-2300" → "2026-10-30 23:00" */
export function zamanYaz(z: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(z)
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : z
}

/** Aç / kapat düğmesi (yalnız site sahibi). Sunucu 5 dakika içinde uygular (scripts/otonom/anahtar.sh). */
export function AutonomousSwitch() {
  const d = useQuery(api.otonom.durum) as { aktif: boolean; updatedAt: number | null; by: string | null } | undefined
  const { run, error, pending } = useSafeMutation(api.otonom.ayarla)
  if (!d) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${d.aktif ? 'bg-green-600 text-white' : 'bg-muted'}`}>
        {d.aktif ? 'Active' : 'Off'}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => void run({ aktif: !d.aktif })}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        {d.aktif ? 'Stop autonomous development' : 'Start autonomous development'}
      </button>
      <span className="text-xs text-muted-foreground">
        Every hour: meeting :00, Claude writes :05, one PR with green CI :40, live check :50. The server picks up a change
        within 5 minutes.{d.by ? ` Last changed by ${d.by}.` : ''}
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}

/** Administration → Autonomous development (yalnız site sahibi): saat başına bir kart, öncesi / sonrası. */
export function AutonomousLog({ items = kayit as OtonomKart[] }: { items?: OtonomKart[] }) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No autonomous run yet. Press Start above to begin (wiki 13).
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {items.map((k) => (
        <section key={k.zaman} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{zamanYaz(k.zaman)}</span>
            <span>{k.odak}</span>
            <span className="rounded border border-border px-1.5 py-0.5">{k.durum === 'yayinda' ? 'Live' : 'No change'}</span>
          </div>
          {k.ozet && <p className="mt-2 text-sm">{k.ozet}</p>}
          {k.gorevler.map((g) => (
            <div key={g.baslik} className="mt-2 text-sm">
              <b>{g.baslik}</b>
              <div className="text-xs">Before: {g.once}</div>
              <div className="text-xs">After: {g.sonra}</div>
            </div>
          ))}
          {k.oneriler.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              Suggestions
              <ul className="list-disc pl-4">
                {k.oneriler.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
