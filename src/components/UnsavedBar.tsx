import { useEffect } from 'react'

/**
 * Kaydedilmemiş değişiklikler için sayfanın altına yapışan çubuk.
 *
 * Tek tek satır kaydetmek zorunda kalmamak için "Save all", yanlışlıkla
 * yapılan düzenlemeyi geri almak için "Discard" ve kaydetmeden sayfadan
 * çıkılırsa tarayıcı uyarısı.
 */
export function UnsavedBar({
  count,
  saving,
  onSaveAll,
  onDiscard,
  noun = 'row',
}: {
  count: number
  saving: boolean
  onSaveAll: () => void
  onDiscard: () => void
  /** Tekil ad; çoğul 's' eklenerek yapılır. */
  noun?: string
}) {
  useEffect(() => {
    if (count === 0) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [count])

  if (count === 0) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-amber-900">
          {count === 1
            ? `1 ${noun} has unsaved changes`
            : `${count} ${noun}s have unsaved changes`}
        </span>
        <button
          onClick={onSaveAll}
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save all'}
        </button>
        <button
          onClick={onDiscard}
          disabled={saving}
          className="text-sm text-amber-900 underline hover:no-underline disabled:opacity-50"
        >
          Discard changes
        </button>
      </div>
    </div>
  )
}
