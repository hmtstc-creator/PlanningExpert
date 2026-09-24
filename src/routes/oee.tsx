import { createFileRoute } from '@tanstack/react-router'

import { ModulePlaceholder } from '../components/ModulePlaceholder'

export const Route = createFileRoute('/oee')({
  component: OeePage,
})

function OeePage() {
  return <ModulePlaceholder path="/oee" />
}
