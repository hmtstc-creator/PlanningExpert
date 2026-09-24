import { createFileRoute, redirect } from '@tanstack/react-router'

// Eski adres: sayfa /machine-followup/maintenance adresine taşındı. Yer imleri ve eski linkler
// çalışmaya devam etsin diye yönlendirilir.
export const Route = createFileRoute('/presbakim')({
  beforeLoad: () => {
    throw redirect({ to: '/machine-followup/maintenance' })
  },
})
