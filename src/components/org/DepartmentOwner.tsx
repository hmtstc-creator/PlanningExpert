import { api } from '../../../convex/_generated/api'
import { ErrorBanner } from '../ErrorBanner'
import type { UserRow } from '../CompanyAdmin'
import { useQuery } from '../../lib/convexTransport'
import { ownerOf, type OrgPlant } from '../../lib/orgTree'
import { useSafeMutation } from '../../lib/useSafeMutation'

/**
 * Bölüm sorumlusu (K7) — tek kaynak: Holdings & companies bölüm paneli ve
 * Organization map'in bölüm düğümü aynı seçiciyi kullanır. Şirketin etkin
 * kullanıcılarından biri; yetki vermez (erişim gruplardan). Sunucu
 * `platform.setDepartmentOwner` creator / General denetler.
 */

const NONE: UserRow[] = []

export function DepartmentOwnerSelect({ plant: p, department, compact = false }: { plant: OrgPlant; department: string; compact?: boolean }) {
  const users = (useQuery(api.users.list, { companyId: p.companyId }) ?? NONE) as UserRow[]
  const { run, error, clearError, pending } = useSafeMutation(api.platform.setDepartmentOwner)
  const owner = ownerOf(p, department)
  const choices = users.filter((u) => !u.platformRole && (u.active || u._id === owner?.userId)).sort((a, b) => a.name.localeCompare(b.name))
  const input = `rounded-md border border-input bg-background px-2 ${compact ? 'w-full py-1 text-xs' : 'w-56 py-1.5 text-sm'}`
  return (
    <div className={compact ? '' : 'mt-3'}>
      <ErrorBanner message={error} onDismiss={clearError} />
      <label className={`flex flex-wrap items-center gap-2 ${compact ? 'text-xs' : 'text-sm'}`}>
        <span className="font-medium">Responsible</span>
        <select
          className={input}
          value={owner?.userId ?? ''}
          disabled={pending}
          onChange={(e) => void run({ plantId: p._id, department, ...(e.target.value ? { userId: e.target.value } : {}) })}
        >
          <option value="">— nobody —</option>
          {choices.map((u) => (
            <option key={u._id} value={u._id}>
              {u.name}
            </option>
          ))}
        </select>
        <span className={`text-muted-foreground ${compact ? 'text-[11px]' : 'text-xs'}`}>Shown on the Board for {department}; access still comes from groups.</span>
      </label>
    </div>
  )
}
