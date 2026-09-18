export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string | null
  onDismiss?: () => void
}) {
  if (!message) return null
  return (
    <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
      <div>
        <p className="text-sm font-medium text-destructive">Kaydedilemedi</p>
        <p className="mt-1 break-words text-xs text-destructive/90">{message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-xs text-destructive hover:underline"
        >
          Kapat
        </button>
      )}
    </div>
  )
}
