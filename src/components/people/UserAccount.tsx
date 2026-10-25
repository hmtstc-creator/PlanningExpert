import { useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { useCurrentUser } from '../../lib/currentUser'
import type { PeopleUser } from '../../lib/peopleTree'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { ErrorBanner } from '../ErrorBanner'

/** Hesap alanları: e-posta, aktif / pasif, creator hakkı. */
export type AccountDraft = { email: string; active: boolean; isCreator: boolean }

export const accountDraft = (u: PeopleUser): AccountDraft => ({ email: u.email ?? '', active: u.active, isCreator: u.isCreator })

/**
 * Kullanıcının hesap alanları — Users & permissions (UserPanel, kendi Save
 * düğmesiyle) ve Organization map (kullanıcı düğümü, UserAccountForm) aynı
 * alanları ve aynı açıklamaları kullanır. Kendini pasif yapma ve kendi creator
 * hakkını kaldırma sunucuda da engellidir (`users.update`).
 */
export function UserAccountFields({
  user: u,
  value: d,
  onChange,
  compact = false,
}: {
  user: PeopleUser
  value: AccountDraft
  onChange: (d: AccountDraft) => void
  compact?: boolean
}) {
  const { name: me } = useCurrentUser()
  const self = u.name === me
  const text = compact ? 'text-xs' : 'text-sm'
  const input = `rounded-md border border-input bg-background px-2 ${compact ? 'w-48 py-1 text-xs' : 'w-56 py-1.5 text-sm'}`
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${text}`}>
      <input className={input} placeholder="Email (optional)" value={d.email} onChange={(e) => onChange({ ...d, email: e.target.value })} aria-label="Email" />
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={d.active} disabled={self} onChange={(e) => onChange({ ...d, active: e.target.checked })} /> Active
        <span className="text-xs text-muted-foreground">(an inactive user cannot sign in)</span>
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={d.isCreator} disabled={self && u.isCreator} onChange={(e) => onChange({ ...d, isCreator: e.target.checked })} /> Creator
        <span className="text-xs text-muted-foreground">(every plant, every module, users and groups)</span>
      </label>
    </div>
  )
}

/** Haritanın kullanıcı düğümü için: alanlar + kendi Save düğmesi. Ad ve gruplar değişmez. */
export function UserAccountForm({ user: u, compact = false }: { user: PeopleUser; compact?: boolean }) {
  const { run: update, error, clearError, pending } = useSafeMutation(api.users.update)
  const initial = accountDraft(u)
  const [d, setD] = useState(initial)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  const btn = 'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40'
  return (
    <div>
      <ErrorBanner message={error} onDismiss={clearError} />
      <UserAccountFields user={u} value={d} onChange={setD} compact={compact} />
      <div className="mt-2 flex items-center gap-2">
        <button
          className={btn}
          disabled={!dirty || pending}
          // groupIds gönderilmez: sunucu mevcut grupları korur.
          onClick={() => void update({ id: u._id, name: u.name, email: d.email.trim() || undefined, active: d.active, isCreator: d.isCreator })}
        >
          Save account
        </button>
        {dirty && (
          <button className="text-xs underline" onClick={() => setD(initial)}>
            Discard
          </button>
        )}
      </div>
    </div>
  )
}
