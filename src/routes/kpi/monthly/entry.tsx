import { createFileRoute } from '@tanstack/react-router'

import { KpiEntryPage } from '../../../components/KpiEntry'

export const Route = createFileRoute('/kpi/monthly/entry')({
  component: () => <KpiEntryPage period="month" />,
})
