import { createFileRoute } from '@tanstack/react-router'

import { KpiDashboardPage } from '../../../components/KpiDashboard'

export const Route = createFileRoute('/kpi/monthly/dashboard')({
  component: () => <KpiDashboardPage period="month" />,
})
