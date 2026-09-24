import { createFileRoute, redirect } from '@tanstack/react-router'

// Eski adres: sayfa /die-followup/maintenance adresine taşındı. Yer imleri ve eski linkler
// çalışmaya devam etsin diye yönlendirilir.
export const Route = createFileRoute('/kaliplar')({
  beforeLoad: () => {
    throw redirect({ to: '/die-followup/maintenance' })
  },
})
