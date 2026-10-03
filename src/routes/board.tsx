import { createFileRoute } from '@tanstack/react-router'

import { BoardDashboardPage } from '../components/BoardDashboard'

export const Route = createFileRoute('/board')({
  component: BoardDashboardPage,
})
