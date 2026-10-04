import { createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '../components/PageHeader'
import { PeopleAdmin } from '../components/people/PeopleAdmin'
import { usePlant } from '../lib/plantContext'

export const Route = createFileRoute('/users')({
  component: UsersPage,
})

/**
 * Users & permissions — şirketin creator'ları (ve seçili şirkette General):
 * kullanıcılar, gruplar ve izin matrisi (modül × alan × plant). Sayfa her
 * zaman seçili plant'in şirketini gösterir.
 */
function UsersPage() {
  const { ctx } = usePlant()
  const companyId = ctx?.active?.companyId
  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Users & permissions"
        summary={`${ctx?.active?.companyName ?? ''} — who may see and change what, by group, module area and plant.`}
        info={
          <>
            <p>
              <b>Company → Group → User.</b> A group gives its members plants and a level per module; each module has areas (e.g.
              PlanningExpert: Plan &amp; rules, Master data, Work calendar, SAP data) that can be set apart from the module.
            </p>
            <p>A person in several groups gets the widest level of each area. A creator manages everything and needs no group.</p>
            <p>New users sign in with a temporary password and replace it at the first sign-in.</p>
          </>
        }
      />
      {companyId && <PeopleAdmin companyId={companyId} />}
    </div>
  )
}
