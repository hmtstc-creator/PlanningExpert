import { Link } from '@tanstack/react-router'

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 p-6 text-center">
      <h1 className="text-4xl font-semibold">404</h1>
      <p className="text-muted-foreground">Page not found.</p>
      <Link
        to="/"
        className="text-sm underline underline-offset-4 hover:no-underline"
      >
        Go home
      </Link>
    </div>
  )
}
