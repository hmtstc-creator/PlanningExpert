import { Navigate, createFileRoute } from '@tanstack/react-router'

/** Eski adres (Admin): kullanıcılar, gruplar ve listeler artık Company settings'te. */
export const Route = createFileRoute('/yonetim')({
  component: () => <Navigate to="/settings" replace />,
})
