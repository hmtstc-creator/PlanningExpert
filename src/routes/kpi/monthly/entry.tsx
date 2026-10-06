import { createFileRoute } from '@tanstack/react-router'

import { KpiYearEntry } from '../../../components/KpiYearEntry'

export const Route = createFileRoute('/kpi/monthly/entry')({
  component: KpiYearEntry,
})
