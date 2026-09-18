import { useEffect, useState } from 'react'

import { onMutationError } from '../lib/mutationErrors'

/**
 * Surfaces errors raised while writing to the server. Without this a failed
 * write is silent: the user believes the data was saved when it was not.
 */
export function MutationErrorToast() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => onMutationError(setMessage), [])

  if (!message) return null

  return (
    <div className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-lg rounded-lg border border-destructive/40 bg-background p-4 shadow-lg sm:inset-x-4 sm:bottom-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-destructive">Could not save</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            The data was not written to the server. Check your connection; if the
            problem persists open Settings → Connection Diagnostics.
          </p>
        </div>
        <button
          onClick={() => setMessage(null)}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
