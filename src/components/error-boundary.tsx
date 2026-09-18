import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'

export function ErrorBoundary({ error }: ErrorComponentProps) {
  const router = useRouter()
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-4xl font-semibold">Something went wrong</h1>
      <p className="max-w-md break-words text-muted-foreground">{message}</p>
      <button
        onClick={() => router.invalidate()}
        className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
      >
        Try again
      </button>
    </div>
  )
}
