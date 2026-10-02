import { createFileRoute } from '@tanstack/react-router'

import { KpiEntryPage } from '../../../components/KpiEntry'

export const Route = createFileRoute('/kpi/weekly/entry')({
  component: () => <KpiEntryPage period="week" />,
})
