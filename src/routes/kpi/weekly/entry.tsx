import { createFileRoute } from '@tanstack/react-router'

import { KpiSeriesEntry } from '../../../components/KpiSeriesEntry'

export const Route = createFileRoute('/kpi/weekly/entry')({
  component: () => <KpiSeriesEntry period="week" />,
})
