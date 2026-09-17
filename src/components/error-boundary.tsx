import { useRouter } from '@tanstack/react-router'

export function ErrorBoundary({ error }: { error: Error }) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 p-6 text-center">
      <h1 className="text-4xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md break-words">
        {error.message}
      </p>
      <button
        onClick={() => router.invalidate()}
        className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
      >
        Retry
      </button>
    </div>
  )
}
