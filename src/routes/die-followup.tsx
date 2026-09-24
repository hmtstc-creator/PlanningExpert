import { createFileRoute } from '@tanstack/react-router'

import { ModulePlaceholder } from '../components/ModulePlaceholder'

export const Route = createFileRoute('/die-followup')({
  component: DieFollowupPage,
})

function DieFollowupPage() {
  return <ModulePlaceholder path="/die-followup" />
}
