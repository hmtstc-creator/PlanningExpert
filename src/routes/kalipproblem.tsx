import { createFileRoute, redirect } from '@tanstack/react-router'

// Eski adres: sayfa /die-followup/problems adresine taşındı. Yer imleri ve eski linkler
// çalışmaya devam etsin diye yönlendirilir.
export const Route = createFileRoute('/kalipproblem')({
  beforeLoad: () => {
    throw redirect({ to: '/die-followup/problems' })
  },
})
