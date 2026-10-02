import { createFileRoute } from '@tanstack/react-router'

import { KpiDashboardPage } from '../../../components/KpiDashboard'

export const Route = createFileRoute('/kpi/weekly/dashboard')({
  component: () => <KpiDashboardPage period="week" />,
})
