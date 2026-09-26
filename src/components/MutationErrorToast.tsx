import { useEffect, useState } from 'react'

import { onMutationError, type FriendlyError } from '../lib/mutationErrors'

/**
 * Surfaces errors raised while writing to the server. Without this a failed
 * write is silent: the user believes the data was saved when it was not.
 */
export function MutationErrorToast() {
  const [error, setError] = useState<FriendlyError | null>(null)

  useEffect(() => onMutationError(setError), [])

  if (!error) return null

  return (
    <div className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-lg rounded-lg border border-destructive/40 bg-background p-4 shadow-lg sm:inset-x-4 sm:bottom-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-destructive">Not saved</p>
          <p className="mt-1 break-words text-sm text-foreground">{error.message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {error.kind === 'rule'
              ? 'Nothing was changed. Correct the entry and save again.'
              : 'The data was not written to the server. If the problem persists open Settings → Connection Diagnostics.'}
          </p>
        </div>
        <button
          onClick={() => setError(null)}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
