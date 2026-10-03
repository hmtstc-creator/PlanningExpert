import { Navigate, createFileRoute } from '@tanstack/react-router'

import { usePlant } from '../lib/plantContext'

/** Eski adres: General → Administration, diğerleri → Company settings. */
export const Route = createFileRoute('/platform')({
  component: function PlatformRedirect() {
    const { ctx, isPlatform } = usePlant()
    if (!ctx) return null
    return <Navigate to={isPlatform ? '/admin' : '/settings'} replace />
  },
})
