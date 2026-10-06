import { createFileRoute } from '@tanstack/react-router'

import { KpiSeriesEntry } from '../../../components/KpiSeriesEntry'

export const Route = createFileRoute('/kpi/monthly/entry')({
  component: () => <KpiSeriesEntry period="month" />,
})
