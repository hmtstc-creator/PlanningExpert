import { createFileRoute } from '@tanstack/react-router'

import { ModulePlaceholder } from '../components/ModulePlaceholder'

export const Route = createFileRoute('/kpi')({
  component: KpiPage,
})

function KpiPage() {
  return <ModulePlaceholder path="/kpi" />
}
