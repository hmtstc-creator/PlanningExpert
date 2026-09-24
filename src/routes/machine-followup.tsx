import { createFileRoute } from '@tanstack/react-router'

import { ModulePlaceholder } from '../components/ModulePlaceholder'

export const Route = createFileRoute('/machine-followup')({
  component: MachineFollowupPage,
})

function MachineFollowupPage() {
  return <ModulePlaceholder path="/machine-followup" />
}
